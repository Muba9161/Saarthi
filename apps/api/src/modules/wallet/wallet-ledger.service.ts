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
 * Nothing here is approved by a person. A reward is credited `HELD`, and once
 * its hold has passed it releases on its own — or is voided, if the referred
 * account did not stay on its trial or plan.
 */

const ledgerLogger = logger.child({ module: 'wallet:ledger' });

/** Statuses that keep a referred account's reward alive through its hold. */
const GOOD_STANDING = new Set(['TRIALING', 'ACTIVE']);

/**
 * Credit a referral's reward, held.
 *
 * Runs inside the caller's transaction, beside the referral row it pays for,
 * so there is never a referral that should have paid and did not, or a reward
 * without its referral.
 */
export async function creditReferralReward(
  db: Db,
  input: { referrerUserId: string; userReferralId: string; organizationId: string },
): Promise<void> {
  const amount = config.referralProgram.rewardAmount;
  if (amount <= 0) return;

  const availableAt = new Date(Date.now() + config.referralProgram.rewardHoldDays * 86_400_000);
  const entry = await db.walletEntry.create({
    data: {
      userId: input.referrerUserId,
      type: WalletEntryType.REFERRAL_REWARD,
      status: WalletEntryStatus.HELD,
      amount,
      entryKey: `referral-reward:${input.userReferralId}`,
      availableAt,
      userReferralId: input.userReferralId,
    },
    select: { id: true },
  });

  await recordAudit(
    {
      action: AuditAction.WALLET_REWARD_CREDITED,
      entityType: 'WalletEntry',
      entityId: entry.id,
      actorUserId: input.referrerUserId,
      organizationId: input.organizationId,
      after: { amount, availableAt: availableAt.toISOString() },
    },
    db,
  );
}

/**
 * Release — or void — every reward of this person whose hold has passed.
 *
 * Called before a balance is read or spent, so a figure is never shown or paid
 * from stale state. The referred account must still exist, still be active,
 * and still be on its trial or plan; otherwise the reward is voided with the
 * reason, and never becomes withdrawable.
 */
export async function releaseMatured(userId: string): Promise<void> {
  const due = await prisma.walletEntry.findMany({
    where: { userId, status: WalletEntryStatus.HELD, availableAt: { lte: new Date() } },
    select: {
      id: true,
      userReferral: {
        select: {
          organizationId: true,
          organization: { select: { archivedAt: true } },
          referred: { select: { status: true } },
        },
      },
    },
  });
  if (due.length === 0) return;

  const organizationIds = due.flatMap((entry) =>
    entry.userReferral ? [entry.userReferral.organizationId] : [],
  );
  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId: { in: organizationIds } },
    select: { organizationId: true, status: true },
  });
  const statusOf = new Map(subscriptions.map((row) => [row.organizationId, row.status as string]));

  for (const entry of due) {
    const referral = entry.userReferral;
    const reason = !referral
      ? 'The referred account no longer exists.'
      : referral.organization.archivedAt || referral.referred.status !== 'ACTIVE'
        ? 'The referred account was closed before the reward unlocked.'
        : !GOOD_STANDING.has(statusOf.get(referral.organizationId) ?? '')
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
