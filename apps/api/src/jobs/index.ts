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
import { runVehicleLookupRetentionSweep } from '../modules/vehicle-lookup/vehicle-lookup.service';
import { runLicenceLookupRetentionSweep } from '../modules/licence-lookup/licence-lookup.service';
import { runAssociationEscalationSweep } from '../modules/associations/association-alert.service';
import { runDeviceOfflineSweep } from '../modules/devices/device.service';
import { runHeartbeatSweep } from '../modules/devices/device-status.service';
import { runCommandExpirySweep } from '../modules/devices/device-command.service';
import { runEnrolmentExpirySweep } from '../modules/devices/enrolment.service';
import { runPairingTokenSweep } from '../modules/devices/pairing.service';
import { runStreamSessionSweep } from '../modules/devices/camera.service';
import { runTelemetryRetentionSweep } from '../modules/telemetry/telemetry.service';
import { runReturnLoadMatchSweep } from '../modules/return-loads/return-load.service';
import { runMediaOrphanSweep } from '../modules/media/media.service';
import {
  runEmiReminderSweep,
  runOverdueSweep,
} from '../modules/loans/loan-reminder.service';
import { runTopUpExpirySweep } from '../modules/subscriptions/topup.service';
import { runDailyBriefSweep } from '../modules/ai/daily-brief.service';
import { runFastagBalanceSweep } from '../modules/toll/fastag.service';
import { runTerminalApprovalSweep } from '../modules/terminal/approval-sweep.service';

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

  // RC records hold personal data — purge them as soon as their TTL lapses.
  queue.registerRepeating({
    name: 'vehicles:lookup-retention',
    everyMs: 6 * HOUR,
    initialDelayMs: 150_000,
    handler: async () => {
      await runVehicleLookupRetentionSweep();
      await runLicenceLookupRetentionSweep();
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

  // An emergency alert that arrives at an unstaffed office would otherwise sit
  // there while the driver waits for a response that was never coming. Runs
  // often, because the critical threshold is ten minutes.
  queue.registerRepeating({
    name: 'associations:escalation',
    everyMs: 5 * 60_000,
    initialDelayMs: 90_000,
    handler: async () => {
      await runAssociationEscalationSweep();
    },
  });

  // "Offline" is Saarthi's own verdict, formed from silence — so something has
  // to notice the silence. Without this a dead SIM looks like a parked truck.
  queue.registerRepeating({
    name: 'devices:offline-sweep',
    everyMs: 2 * 60_000,
    initialDelayMs: 60_000,
    handler: async () => {
      await runDeviceOfflineSweep();
      // A phone parked overnight is silent and perfectly healthy; the same
      // phone with a flat battery is silent and gone. Telemetry silence cannot
      // tell those apart, so heartbeat silence is swept separately.
      await runHeartbeatSweep();
      // "Start the camera" is not a request that ages well. A device back from
      // a two-hour tunnel must not act on what somebody asked at breakfast.
      await runCommandExpirySweep();
      // A browser that closes without telling us would otherwise leave a
      // camera session showing as ACTIVE for ever, and the access log would
      // misreport how long somebody watched.
      await runStreamSessionSweep();
    },
  });

  // Bearer capabilities with a short life, both of them. Sweeping is not
  // tidiness: self-enrolment is an open endpoint, and unclaimed identities that
  // are never removed are how one becomes a storage-exhaustion vector.
  queue.registerRepeating({
    name: 'devices:credential-sweep',
    everyMs: HOUR,
    initialDelayMs: 210_000,
    handler: async () => {
      await runEnrolmentExpirySweep();
      await runPairingTokenSweep();
    },
  });

  // Telemetry is the highest-volume table in the system; retention is per plan.
  queue.registerRepeating({
    name: 'telemetry:retention',
    everyMs: 24 * HOUR,
    initialDelayMs: 240_000,
    handler: async () => {
      await runTelemetryRetentionSweep();
    },
  });

  // A return load is only useful while the truck is still free, so matches are
  // recomputed often enough to catch an order posted after the truck was.
  queue.registerRepeating({
    name: 'return-loads:match-sweep',
    everyMs: 10 * 60_000,
    initialDelayMs: 100_000,
    handler: async () => {
      await runReturnLoadMatchSweep();
    },
  });

  // Soft-deleted images keep their bytes for a recovery window; after that the
  // objects have to go, or storage grows without bound.
  queue.registerRepeating({
    name: 'media:orphan-sweep',
    everyMs: 24 * HOUR,
    initialDelayMs: 300_000,
    handler: async () => {
      await runMediaOrphanSweep();
    },
  });

  // A missed EMI can cost an owner-operator the vehicle their livelihood runs
  // on, so this is the one reminder sweep that runs several times a day rather
  // than once. Duplicate delivery is prevented by a unique key per installment
  // and reminder kind, not by the schedule.
  queue.registerRepeating({
    name: 'loan:emi-reminder',
    everyMs: 6 * HOUR,
    initialDelayMs: 45_000,
    handler: async () => {
      await runEmiReminderSweep();
    },
  });

  // Runs shortly after midnight-ish intervals so an installment that lapsed
  // overnight is reflected in the stored status the reminder sweep reads.
  queue.registerRepeating({
    name: 'loan:overdue-check',
    everyMs: 12 * HOUR,
    initialDelayMs: 200_000,
    handler: async () => {
      await runOverdueSweep();
    },
  });

  // A lapsed top-up must stop granting capacity, but the vehicles it covered
  // keep working — capacity is checked when adding, never retroactively.
  queue.registerRepeating({
    name: 'subscription:topup-expiry',
    everyMs: 6 * HOUR,
    initialDelayMs: 220_000,
    handler: async () => {
      await runTopUpExpirySweep();
    },
  });

  // The morning brief. Produced by rules rather than by a model, and sent only
  // to fleets that actually have something outstanding — a daily "all clear"
  // is how people learn to swipe the brief away without reading it.
  queue.registerRepeating({
    name: 'ai:daily-fleet-brief',
    everyMs: 24 * HOUR,
    initialDelayMs: 260_000,
    handler: async () => {
      await runDailyBriefSweep();
    },
  });

  // A tag that cannot pay stops a truck at a barrier, and the driver finds out
  // at the worst possible moment. Runs often enough to warn before that.
  queue.registerRepeating({
    name: 'fastag:balance-check',
    everyMs: 6 * HOUR,
    initialDelayMs: 140_000,
    handler: async () => {
      await runFastagBalanceSweep();
    },
  });

  /*
   * The terminal approval SLA (section 15).
   *
   * Runs every minute, which is more often than any other sweep here, because
   * the thing it is measuring is a person standing beside a truck unable to
   * start work. A five-minute reminder that arrives at minute nine is not a
   * five-minute reminder.
   *
   * It reminds, escalates and expires. It never approves — see the file header
   * for why that is not a configuration option.
   */
  queue.registerRepeating({
    name: 'terminal:approval-sla',
    everyMs: 60_000,
    initialDelayMs: 45_000,
    handler: async () => {
      await runTerminalApprovalSweep();
    },
  });

  queue.start();
}
