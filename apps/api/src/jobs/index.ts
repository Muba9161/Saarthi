import {
  DocumentValidity,
  EXPIRY_ALERT_WINDOWS,
  NotificationPriority,
  NotificationType,
  documentTypeDefinition,
  resolveDocumentValidity,
} from '@saarthi/shared';
import { prisma } from '../database/prisma';
import { queue } from '../infra/queue';
import { logger } from '../lib/logger';
import { notifyOrganization } from '../modules/notifications/notification.service';
import { runMaintenanceReminderSweep } from '../modules/maintenance/maintenance.service';
import { recalculateDriverScore } from '../modules/drivers/driver.service';

/**
 * Scheduled background work.
 *
 * Handlers are plain async functions with no queue-specific API, so moving
 * from the in-process scheduler to BullMQ in production is a driver swap and
 * nothing here changes.
 */

const jobLogger = logger.child({ module: 'jobs' });

const HOUR = 3_600_000;

/**
 * Document expiry sweep.
 *
 * Notifies each affected organization once per alert window (7/15/30 days) and
 * records a compliance score event when a mandatory document actually lapses.
 */
export async function runDocumentExpirySweep(): Promise<{ expiring: number; expired: number }> {
  const horizon = new Date(Date.now() + Math.max(...EXPIRY_ALERT_WINDOWS) * 86_400_000);

  const documents = await prisma.document.findMany({
    where: { deletedAt: null, expiryDate: { not: null, lte: horizon } },
    orderBy: { expiryDate: 'asc' },
    take: 2000,
  });

  const expiringByOrg = new Map<string, string[]>();
  const expiredByOrg = new Map<string, string[]>();

  for (const document of documents) {
    if (!document.organizationId) continue;

    const { validity, daysRemaining } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });

    const label = documentTypeDefinition(document.documentType)?.label ?? document.documentType;

    if (validity === DocumentValidity.EXPIRED) {
      const bucket = expiredByOrg.get(document.organizationId) ?? [];
      bucket.push(label);
      expiredByOrg.set(document.organizationId, bucket);

      // A lapsed mandatory driver document is a real compliance signal.
      if (document.ownerType === 'DRIVER' && documentTypeDefinition(document.documentType)?.mandatory) {
        const alreadyRecorded = await prisma.driverScoreEvent.findFirst({
          where: {
            driverId: document.ownerId,
            eventType: 'DOCUMENT_EXPIRED',
            sourceId: document.id,
          },
        });
        if (!alreadyRecorded) {
          await prisma.driverScoreEvent.create({
            data: {
              driverId: document.ownerId,
              eventType: 'DOCUMENT_EXPIRED',
              category: 'COMPLIANCE',
              points: -10,
              reason: `${label} expired on ${document.expiryDate?.toISOString().slice(0, 10)}.`,
              sourceType: 'DOCUMENT',
              sourceId: document.id,
            },
          });
          await recalculateDriverScore(document.ownerId);
        }
      }
    } else if (
      validity === DocumentValidity.EXPIRING_SOON &&
      daysRemaining !== null &&
      EXPIRY_ALERT_WINDOWS.includes(daysRemaining as (typeof EXPIRY_ALERT_WINDOWS)[number])
    ) {
      // Only alert exactly on a window boundary, so a fleet is not nagged daily.
      const bucket = expiringByOrg.get(document.organizationId) ?? [];
      bucket.push(`${label} (${daysRemaining} days)`);
      expiringByOrg.set(document.organizationId, bucket);
    }
  }

  for (const [organizationId, labels] of expiringByOrg) {
    await notifyOrganization(organizationId, {
      type: NotificationType.DOCUMENT_EXPIRING,
      title: `${labels.length} document(s) expiring soon`,
      body: labels.slice(0, 5).join(', ') + (labels.length > 5 ? '…' : ''),
      priority: NotificationPriority.HIGH,
      actionUrl: '/fleet/documents?filter=expiring',
      roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
    });
  }

  for (const [organizationId, labels] of expiredByOrg) {
    await notifyOrganization(organizationId, {
      type: NotificationType.DOCUMENT_EXPIRED,
      title: `${labels.length} document(s) have expired`,
      body: labels.slice(0, 5).join(', ') + (labels.length > 5 ? '…' : ''),
      priority: NotificationPriority.CRITICAL,
      actionUrl: '/fleet/documents?filter=expired',
      roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
    });
  }

  const result = {
    expiring: [...expiringByOrg.values()].reduce((sum, list) => sum + list.length, 0),
    expired: [...expiredByOrg.values()].reduce((sum, list) => sum + list.length, 0),
  };

  jobLogger.info(result, 'Document expiry sweep complete');
  return result;
}

/** Purge tracking points beyond the longest retention window we offer. */
export async function runTrackingRetentionSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - 1095 * 86_400_000);
  const result = await prisma.truckLocation.deleteMany({ where: { recordedAt: { lt: cutoff } } });
  if (result.count > 0) {
    jobLogger.info({ deleted: result.count }, 'Tracking retention sweep complete');
  }
  return result.count;
}

/** Remove expired sessions and used password-reset tokens. */
export async function runSessionCleanup(): Promise<number> {
  const now = new Date();
  const [sessions, tokens] = await Promise.all([
    prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } }] },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
    }),
  ]);
  return sessions.count + tokens.count;
}

export function registerBackgroundJobs(): void {
  queue.registerRepeating({
    name: 'documents:expiry-sweep',
    everyMs: 6 * HOUR,
    // Run shortly after boot so a fresh environment surfaces alerts quickly.
    initialDelayMs: 30_000,
    handler: async () => {
      await runDocumentExpirySweep();
    },
  });

  queue.registerRepeating({
    name: 'maintenance:reminders',
    everyMs: 12 * HOUR,
    initialDelayMs: 60_000,
    handler: async () => {
      await runMaintenanceReminderSweep();
    },
  });

  queue.registerRepeating({
    name: 'sessions:cleanup',
    everyMs: 24 * HOUR,
    initialDelayMs: 120_000,
    handler: async () => {
      await runSessionCleanup();
    },
  });

  queue.registerRepeating({
    name: 'tracking:retention',
    everyMs: 24 * HOUR,
    initialDelayMs: 180_000,
    handler: async () => {
      await runTrackingRetentionSweep();
    },
  });

  queue.start();
}
