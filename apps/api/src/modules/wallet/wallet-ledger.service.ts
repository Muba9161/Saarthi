import { WalletEntryStatus, WalletEntryType } from '@saarthi/shared';
import { prisma, type Db } from '../../database/prisma';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';

/**
 * The wallet ledger.
 *
 * There is no balance column. A balance is the sum of a person's `AVAILABLE`
 * entries, so every rupee in it traces to a row: a reward, a cash-out debit, or
 * a failed cash-out's reversal. Every write is keyed by `entryKey`, which makes
 * a retried call a no-op instead of a second credit.
 *
 * Nothing here is approved by a person. A reward — Refer & Earn or a
 * salesperson's — is credited `HELD`, and once its hold has passed it releases
 * on its own, or is voided if the referred account did not stay on its trial
 * or plan.
 */

const ledgerLogger = logger.child({ module: 'wallet:ledger' });

/** Statuses that keep a referred account's reward alive through its hold. */
const GOOD_STANDING = new Set(['TRIALING', 'ACTIVE']);

/**
 * What a reward was earned by: a Refer & Earn referral, or a salesperson's
 * attribution of a customer.
 */
export type RewardSource = { userReferralId: string } | { referralAttributionId: string };

/**
 * Credit a referral's reward, held.
 *
 * Idempotent on its `entryKey`: one reward per Refer & Earn referral, and one
 * per salesperson's *customer* — keyed on the organization rather than the
 * attribution, so a customer revoked and re-attributed never pays twice.
 * Returns whether a reward was credited by this call.
 *
 * Takes the caller's transaction where there is one, so a Refer & Earn
 * referral and its reward are written together or not at all.
 */
export async function creditReferralReward(
  db: Db,
  input: { userId: string; organizationId: string; source: RewardSource },
): Promise<boolean> {
  const amount = config.referralProgram.rewardAmount;
  if (amount <= 0) return false;

  const entryKey =
    'userReferralId' in input.source
      ? `referral-reward:${input.source.userReferralId}`
      : `sales-reward:${input.organizationId}`;
  const availableAt = new Date(Date.now() + config.referralProgram.rewardHoldDays * 86_400_000);

  const written = await db.walletEntry.createMany({
    data: [
      {
        userId: input.userId,
        type: WalletEntryType.REFERRAL_REWARD,
        status: WalletEntryStatus.HELD,
        amount,
        entryKey,
        availableAt,
        referredOrganizationId: input.organizationId,
        ...input.source,
      },
    ],
    skipDuplicates: true,
  });
  if (written.count === 0) return false;

  await recordAudit(
    {
      action: AuditAction.WALLET_REWARD_CREDITED,
      entityType: 'WalletEntry',
      entityId: null,
      actorUserId: input.userId,
      organizationId: input.organizationId,
      after: { entryKey, amount, availableAt: availableAt.toISOString() },
    },
    db,
  );
  return true;
}

/** Void a reward that has not unlocked yet — its attribution was withdrawn. */
export async function voidHeldReward(referralAttributionId: string, reason: string): Promise<void> {
  const moved = await prisma.walletEntry.updateMany({
    where: { referralAttributionId, status: WalletEntryStatus.HELD },
    data: { status: WalletEntryStatus.VOID, note: reason },
  });
  if (moved.count > 0) {
    await recordAudit({
      action: AuditAction.WALLET_REWARD_VOIDED,
      entityType: 'ReferralAttribution',
      entityId: referralAttributionId,
      after: { reason },
    });
  }
}

/**
 * Release — or void — every reward of this person whose hold has passed.
 *
 * Called before a balance is read or spent, so a figure is never shown or paid
 * from stale state. The referred organization must still exist, not be closed,
 * and still be on its trial or plan; otherwise the reward is voided with the
 * reason, and never becomes withdrawable.
 */
export async function releaseMatured(userId: string): Promise<void> {
  const due = await prisma.walletEntry.findMany({
    where: { userId, status: WalletEntryStatus.HELD, availableAt: { lte: new Date() } },
    select: { id: true, referredOrganizationId: true },
  });
  if (due.length === 0) return;

  const organizationIds = due.flatMap((entry) =>
    entry.referredOrganizationId ? [entry.referredOrganizationId] : [],
  );
  const [organizations, subscriptions] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, archivedAt: true },
    }),
    prisma.subscription.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, status: true },
    }),
  ]);
  const organizationOf = new Map(organizations.map((row) => [row.id, row]));
  const statusOf = new Map(subscriptions.map((row) => [row.organizationId, row.status as string]));

  for (const entry of due) {
    const organization = entry.referredOrganizationId
      ? organizationOf.get(entry.referredOrganizationId)
      : undefined;
    const reason = !organization
      ? 'The referred account no longer exists.'
      : organization.archivedAt
        ? 'The referred account was closed before the reward unlocked.'
        : !GOOD_STANDING.has(statusOf.get(organization.id) ?? '')
          ? 'The referred account left its trial or plan before the reward unlocked.'
          : null;

    // Guarded on HELD, so two concurrent readers cannot both move it.
    const moved = await prisma.walletEntry.updateMany({
      where: { id: entry.id, status: WalletEntryStatus.HELD },
      data: reason
        ? { status: WalletEntryStatus.VOID, note: reason }
        : { status: WalletEntryStatus.AVAILABLE },
    });

    if (moved.count === 1 && reason) {
      await recordAudit({
        action: AuditAction.WALLET_REWARD_VOIDED,
        entityType: 'WalletEntry',
        entityId: entry.id,
        actorUserId: userId,
        after: { reason },
      });
      ledgerLogger.info({ entryId: entry.id }, 'Referral reward voided at release');
    }
  }
}

async function sum(db: Db, where: Parameters<typeof prisma.walletEntry.aggregate>[0]['where']) {
  const result = await db.walletEntry.aggregate({ where, _sum: { amount: true } });
  return Number(result._sum.amount ?? 0);
}

/** What can be withdrawn now. Read inside the cash-out lock as well as outside it. */
export function availableBalance(db: Db, userId: string): Promise<number> {
  return sum(db, { userId, status: WalletEntryStatus.AVAILABLE });
}

export async function balances(
  userId: string,
): Promise<{ available: number; held: number; totalEarned: number }> {
  const [available, held, totalEarned] = await Promise.all([
    availableBalance(prisma, userId),
    sum(prisma, { userId, status: WalletEntryStatus.HELD }),
    sum(prisma, {
      userId,
      type: WalletEntryType.REFERRAL_REWARD,
      status: { not: WalletEntryStatus.VOID },
    }),
  ]);
  return { available, held, totalEarned };
}
