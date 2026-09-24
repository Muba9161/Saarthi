import {
  NotificationPriority,
  NotificationType,
  OPERATOR_OWNER_ROLES,
  SubscriptionStatus,
  archiveDateFor,
  purgeDateFor,
  unpaidWarning,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';

/**
 * A paid account whose period ended unpaid — the trial or any month.
 *
 *   period ends → warnUnpaid      (PAST_DUE, full access, warned once)
 *   + 3 days    → archiveUnpaid   (EXPIRED, locked, purge scheduled)
 *   + 90 days   → account-purge   (own data deleted)
 *
 * `restoreArchivedAccount` undoes the archive the moment a renewal is paid.
 * The lifecycle sweep in `autopay.service` decides *when* each step runs;
 * this module is what each step does. It deliberately imports nothing from
 * billing, so billing can call `restoreArchivedAccount` without a cycle.
 */

const retentionLogger = logger.child({ module: 'account-retention' });

/**
 * Start the grace period: keep everything working, and say plainly what
 * happens if the account is not renewed. Returns false when already warned.
 */
export async function warnUnpaid(input: {
  organizationId: string;
  planName: string;
  periodEnd: Date;
}): Promise<boolean> {
  // The status move is the "warned" marker, so the warning goes out once
  // however often the sweep runs.
  const moved = await prisma.subscription.updateMany({
    where: {
      organizationId: input.organizationId,
      status: { in: [SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE] },
    },
    data: { status: SubscriptionStatus.PAST_DUE },
  });
  if (moved.count === 0) return false;

  await notifyOrganization(input.organizationId, {
    type: NotificationType.SUBSCRIPTION_UPDATED,
    title: 'Renew now to keep your account',
    body: unpaidWarning(input.planName, archiveDateFor(input.periodEnd)),
    priority: NotificationPriority.HIGH,
    actionUrl: '/settings/subscription',
    roles: OPERATOR_OWNER_ROLES,
  });
  return true;
}

/**
 * Grace is over and nothing was paid: lock the account and schedule the
 * purge. Returns false when it was archived already.
 */
export async function archiveUnpaid(input: {
  organizationId: string;
  planName: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const purgeAt = purgeDateFor(now);

  const archived = await prisma.$transaction(async (tx) => {
    const marked = await tx.organization.updateMany({
      where: { id: input.organizationId, billingArchivedAt: null },
      data: { billingArchivedAt: now, dataPurgeAt: purgeAt },
    });
    if (marked.count === 0) return false;
    await tx.subscription.update({
      where: { organizationId: input.organizationId },
      data: { status: SubscriptionStatus.EXPIRED },
    });
    return true;
  });
  if (!archived) return false;

  await recordAudit({
    action: AuditAction.ACCOUNT_ARCHIVED_UNPAID,
    entityType: 'Organization',
    entityId: input.organizationId,
    actorUserId: null,
    organizationId: input.organizationId,
    after: { archivedAt: now.toISOString(), dataPurgeAt: purgeAt.toISOString() },
  });

  await notifyOrganization(input.organizationId, {
    type: NotificationType.SUBSCRIPTION_UPDATED,
    title: 'Your account has been archived',
    body: `${input.planName} was not renewed, so this account is archived and locked. Renew by ${purgeAt.toLocaleDateString('en-IN')} to restore everything - after that, its data is permanently deleted.`,
    priority: NotificationPriority.HIGH,
    actionUrl: '/settings/subscription',
    roles: OPERATOR_OWNER_ROLES,
  });

  retentionLogger.info({ organizationId: input.organizationId, purgeAt }, 'Unpaid account archived');
  return true;
}

/** A renewal was paid: unlock the account and cancel the scheduled purge. */
export async function restoreArchivedAccount(organizationId: string): Promise<boolean> {
  const restored = await prisma.organization.updateMany({
    where: { id: organizationId, billingArchivedAt: { not: null }, dataPurgedAt: null },
    data: { billingArchivedAt: null, dataPurgeAt: null },
  });
  if (restored.count === 0) return false;

  await recordAudit({
    action: AuditAction.ACCOUNT_RESTORED,
    entityType: 'Organization',
    entityId: organizationId,
    actorUserId: null,
    organizationId,
  });
  retentionLogger.info({ organizationId }, 'Archived account restored by renewal');
  return true;
}
