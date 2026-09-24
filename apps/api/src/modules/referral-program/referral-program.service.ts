import { randomInt } from 'node:crypto';
import {
  PlanTier,
  REFERRAL_PROGRAM_CODE_ALPHABET,
  REFERRAL_PROGRAM_CODE_LENGTH,
  REFERRAL_PROGRAM_CODE_PREFIX,
  UserReferralStatus,
  WalletEntryStatus,
  WalletEntryType,
  canJoinReferralProgram,
  isReferralProgramCode,
  normalizeReferralProgramCode,
  referralProgramUrl,
  type PaginationQuery,
  type ReferralProgramSummary,
  type UserReferralView,
} from '@saarthi/shared';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { config } from '../../config/env';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { creditReferralReward } from '../wallet/wallet-ledger.service';
import type { AuthContext } from '../../auth/context';

/**
 * Refer & Earn — the generic referral program.
 *
 * Three moments, and this file owns all of them:
 *
 *   1. **Issue** — a person opens the Referral Center and is given a code.
 *   2. **Sign up** — somebody registers quoting it; one `UserReferral` row.
 *      If the new account starts on a paid plan, the referrer's wallet is
 *      credited the reward in the same transaction — held, then released on
 *      its own (see `wallet-ledger.service`). No payment and no approval.
 *   3. **Qualify** — that new organization's first successful subscription
 *      payment is recorded against the row, for reporting.
 *
 * Entirely separate from `modules/sales`: a program code is never a GODID, the
 * two never share a table, and the registration hook tries this program only
 * for codes carrying its prefix.
 */

const programLogger = logger.child({ module: 'referral-program' });

/** Refer & Earn and its wallet are closed to anyone the program excludes. */
export function requireEligible(auth: AuthContext): void {
  if (!canJoinReferralProgram(auth.user.roles)) {
    throw errors.forbidden(
      'Saarthi salespeople refer customers through their GODID link, on the Sales screens.',
    );
  }
}

function generateCode(): string {
  let suffix = '';
  for (let index = 0; index < REFERRAL_PROGRAM_CODE_LENGTH; index += 1) {
    suffix += REFERRAL_PROGRAM_CODE_ALPHABET[randomInt(REFERRAL_PROGRAM_CODE_ALPHABET.length)];
  }
  return `${REFERRAL_PROGRAM_CODE_PREFIX}${suffix}`;
}

/**
 * The caller's code, issued on first request.
 *
 * Both unique constraints can be hit by a race — two tabs opening the page at
 * once (`userId`) or, rarely, two people drawing the same code (`code`). Either
 * way the answer is to read back what now exists, or draw again.
 */
async function ensureCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await prisma.referralProgramCode.findUnique({
      where: { userId },
      select: { code: true },
    });
    if (existing) return existing.code;

    try {
      const row = await prisma.referralProgramCode.create({
        data: { userId, code: generateCode() },
        select: { id: true, code: true },
      });
      await recordAudit({
        action: AuditAction.REFERRAL_PROGRAM_CODE_ISSUED,
        entityType: 'ReferralProgramCode',
        entityId: row.id,
        actorUserId: userId,
        after: { code: row.code },
      });
      return row.code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw errors.internal('Could not issue a referral code.');
}

// ---------------------------------------------------------------------------
// The referrer's own view
// ---------------------------------------------------------------------------

export async function summary(auth: AuthContext, baseUrl: string): Promise<ReferralProgramSummary> {
  requireEligible(auth);

  const [code, total, rewards] = await Promise.all([
    ensureCode(auth.user.id),
    prisma.userReferral.count({ where: { referrerUserId: auth.user.id } }),
    prisma.walletEntry.aggregate({
      where: {
        userId: auth.user.id,
        type: WalletEntryType.REFERRAL_REWARD,
        status: { not: WalletEntryStatus.VOID },
      },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
  const url = referralProgramUrl(baseUrl, code);

  return {
    code,
    url,
    shareText:
      'I use Saarthi to keep track of vehicles, drivers, documents and running costs in one ' +
      `place. Sign up with my referral code ${code}: ${url}`,
    stats: {
      total,
      rewarded: rewards._count._all,
      earned: Number(rewards._sum.amount ?? 0),
    },
    reward: {
      amount: config.referralProgram.rewardAmount,
      holdDays: config.referralProgram.rewardHoldDays,
    },
  };
}

export async function listReferrals(
  auth: AuthContext,
  query: PaginationQuery,
): Promise<{ items: UserReferralView[]; total: number }> {
  requireEligible(auth);

  const where = { referrerUserId: auth.user.id };
  const [rows, total] = await Promise.all([
    prisma.userReferral.findMany({
      where,
      select: {
        id: true,
        status: true,
        signedUpAt: true,
        qualifiedAt: true,
        organization: { select: { name: true } },
        walletEntry: { select: { amount: true, status: true, availableAt: true } },
      },
      orderBy: { signedUpAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.userReferral.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      organizationName: row.organization.name,
      status: row.status as UserReferralStatus,
      signedUpAt: row.signedUpAt.toISOString(),
      qualifiedAt: row.qualifiedAt?.toISOString() ?? null,
      reward: row.walletEntry
        ? {
            amount: Number(row.walletEntry.amount),
            status: row.walletEntry.status as WalletEntryStatus,
            availableAt: row.walletEntry.availableAt.toISOString(),
          }
        : null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Record that a new account registered with a program code, and pay its reward.
 *
 * Returns whether the code belonged to this program at all, so registration
 * knows not to try it as a GODID as well. Never throws: by the time this runs
 * the account is committed, and a referral problem must not cost anybody their
 * signup — the same contract as the salesman channel's registration hook.
 *
 * The reward is only for an account that starts on a paid plan, and so on its
 * trial. A Free signup is recorded as a referral and earns nothing.
 *
 * "First referral wins" is the unique index on `organizationId`, not a check
 * here, so a retried registration cannot credit two people — or pay twice.
 */
export async function recordSignup(input: {
  code: string;
  organizationId: string;
  referredUserId: string;
  planTier: PlanTier;
}): Promise<boolean> {
  if (!isReferralProgramCode(input.code)) return false;
  const code = normalizeReferralProgramCode(input.code);

  try {
    const owner = await prisma.referralProgramCode.findUnique({
      where: { code },
      select: {
        userId: true,
        user: { select: { status: true, roles: { select: { role: { select: { name: true } } } } } },
      },
    });

    const roles = owner?.user.roles.map((entry) => entry.role.name) ?? [];
    if (!owner || owner.user.status !== 'ACTIVE' || !canJoinReferralProgram(roles)) {
      programLogger.info({ code }, 'Referral code did not match an eligible referrer');
      return true;
    }

    const rewarded = input.planTier !== PlanTier.FREE;
    await prisma.$transaction(async (tx) => {
      const row = await tx.userReferral.create({
        data: {
          referrerUserId: owner.userId,
          referredUserId: input.referredUserId,
          organizationId: input.organizationId,
          code,
        },
        select: { id: true },
      });

      if (rewarded) {
        await creditReferralReward(tx, {
          referrerUserId: owner.userId,
          userReferralId: row.id,
          organizationId: input.organizationId,
        });
      }

      await recordAudit(
        {
          action: AuditAction.REFERRAL_PROGRAM_SIGNUP,
          entityType: 'UserReferral',
          entityId: row.id,
          actorUserId: input.referredUserId,
          organizationId: input.organizationId,
          after: { code, referrerUserId: owner.userId, planTier: input.planTier, rewarded },
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      programLogger.info(
        { organizationId: input.organizationId },
        'Organization already carries a referral — first referral stands',
      );
    } else {
      programLogger.error(
        { err: error, organizationId: input.organizationId },
        'Referral signup could not be recorded',
      );
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

/**
 * Mark a referral qualified on its organization's first successful
 * subscription payment.
 *
 * Idempotent by construction: only a `SIGNED_UP` row moves, so a retried
 * webhook or a second month's payment changes nothing. Never throws — the
 * caller has already taken the customer's money.
 */
export async function qualifyForPayment(input: {
  organizationId: string;
  paymentReference: string;
  /** Pre-GST, in rupees. */
  baseAmount: number;
}): Promise<void> {
  try {
    const moved = await prisma.userReferral.updateMany({
      where: { organizationId: input.organizationId, status: UserReferralStatus.SIGNED_UP },
      data: {
        status: UserReferralStatus.QUALIFIED,
        qualifiedAt: new Date(),
        qualifyingPaymentReference: input.paymentReference,
        qualifyingAmount: input.baseAmount,
      },
    });
    if (moved.count === 0) return;

    await recordAudit({
      action: AuditAction.REFERRAL_PROGRAM_QUALIFIED,
      entityType: 'UserReferral',
      entityId: null,
      organizationId: input.organizationId,
      after: { paymentReference: input.paymentReference, baseAmount: input.baseAmount },
    });
  } catch (error) {
    programLogger.error(
      { err: error, organizationId: input.organizationId },
      'Referral qualification failed for a successful payment',
    );
  }
}
