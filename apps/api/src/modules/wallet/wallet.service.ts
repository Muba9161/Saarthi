import { randomUUID } from 'node:crypto';
import {
  BankAccountStatus,
  WalletCashoutStatus,
  WalletEntryStatus,
  WalletEntryType,
  type PaginationQuery,
  type WalletCashoutView,
  type WalletSummary,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  fetchTransfer,
  sendTransfer,
  type TransferResult,
} from '../../providers/payouts/cashfree-payouts';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { toBankView } from './wallet-bank.service';
import { availableBalance, balances, releaseMatured } from './wallet-ledger.service';
import type { AuthContext } from '../../auth/context';

/**
 * The Saarthi wallet: what a person has earned — through Refer & Earn or, for a
 * salesperson, through the customers they bring — and cashing it out.
 *
 * A cash-out takes the whole available balance to the holder's own verified
 * bank account, with no approval step. The debit is written before the
 * transfer is sent, under a row lock on the holder's bank account, so two
 * simultaneous requests cannot both spend the same balance; a transfer that
 * fails puts the money back with a reversal entry.
 */

const walletLogger = logger.child({ module: 'wallet' });

/** A transfer older than this with no answer is asked about by the sweep. */
const SWEEP_AFTER_MS = 2 * 60_000;

type CashoutRow = {
  id: string;
  amount: unknown;
  status: string;
  accountLast4: string;
  failureReason: string | null;
  requestedAt: Date;
  completedAt: Date | null;
};

function toCashoutView(row: CashoutRow): WalletCashoutView {
  return {
    id: row.id,
    amount: Number(row.amount),
    status: row.status as WalletCashoutStatus,
    accountLast4: row.accountLast4,
    failureReason: row.failureReason,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function summary(auth: AuthContext): Promise<WalletSummary> {
  await releaseMatured(auth.user.id);

  const [totals, bank] = await Promise.all([
    balances(auth.user.id),
    prisma.walletBankAccount.findUnique({ where: { userId: auth.user.id } }),
  ]);

  return {
    ...totals,
    minCashout: config.wallet.minCashout,
    holdDays: config.referralProgram.rewardHoldDays,
    rewardAmount: config.referralProgram.rewardAmount,
    cashoutEnabled: config.wallet.cashoutEnabled,
    bankAccount: bank ? toBankView(bank) : null,
  };
}

export async function listCashouts(
  auth: AuthContext,
  query: PaginationQuery,
): Promise<{ items: WalletCashoutView[]; total: number }> {
  const where = { userId: auth.user.id };
  const [rows, total] = await Promise.all([
    prisma.walletCashout.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.walletCashout.count({ where }),
  ]);
  return { items: rows.map(toCashoutView), total };
}

// ---------------------------------------------------------------------------
// Cash-out
// ---------------------------------------------------------------------------

export async function requestCashout(auth: AuthContext): Promise<WalletCashoutView> {
  if (!config.wallet.cashoutEnabled) {
    throw errors.providerNotConfigured(
      'cashfree',
      'Cash-out is not available yet. Your balance is safe and will be ready to withdraw soon.',
    );
  }

  const userId = auth.user.id;
  await releaseMatured(userId);

  const bank = await prisma.walletBankAccount.findUnique({ where: { userId } });
  if (!bank || bank.status !== BankAccountStatus.VERIFIED || !bank.beneficiaryId) {
    throw errors.businessRule('Connect and verify your bank account before cashing out.');
  }
  const beneficiaryId = bank.beneficiaryId;

  const cashout = await prisma.$transaction(async (tx) => {
    // Serialises cash-outs per person: the second waits here, then sees the
    // balance the first already spent.
    await tx.$queryRaw`SELECT id FROM "wallet_bank_accounts" WHERE "userId" = ${userId}::uuid FOR UPDATE`;

    const amount = Math.round((await availableBalance(tx, userId)) * 100) / 100;
    if (amount < config.wallet.minCashout) {
      throw errors.businessRule(
        `You need at least ₹${config.wallet.minCashout} available to cash out.`,
        { available: amount },
      );
    }

    const id = randomUUID();
    const row = await tx.walletCashout.create({
      data: {
        id,
        userId,
        amount,
        transferId: `WC_${id.replace(/-/g, '')}`,
        accountLast4: bank.accountLast4,
      },
    });
    await tx.walletEntry.create({
      data: {
        userId,
        type: WalletEntryType.CASHOUT,
        status: WalletEntryStatus.AVAILABLE,
        amount: -amount,
        entryKey: `cashout:${id}`,
        availableAt: new Date(),
        cashoutId: id,
      },
    });
    return row;
  });

  await recordAudit({
    action: AuditAction.WALLET_CASHOUT_REQUESTED,
    entityType: 'WalletCashout',
    entityId: cashout.id,
    actorUserId: userId,
    after: { amount: Number(cashout.amount), accountLast4: cashout.accountLast4 },
  });

  try {
    const result = await sendTransfer({
      transferId: cashout.transferId,
      beneficiaryId,
      amount: Number(cashout.amount),
      remarks: 'Saarthi referral rewards',
    });
    await applyOutcome(cashout.id, result);
  } catch (error) {
    // Whether the transfer landed is unknown, so the money is neither returned
    // nor marked paid here — the sweep asks the provider and settles it.
    walletLogger.warn({ err: error, cashoutId: cashout.id }, 'Payout request did not complete');
  }

  const latest = await prisma.walletCashout.findUniqueOrThrow({ where: { id: cashout.id } });
  return toCashoutView(latest);
}

/**
 * Record what the provider says happened. Guarded on PROCESSING so a status
 * seen twice — from the request and from the sweep — changes things once.
 */
async function applyOutcome(cashoutId: string, result: TransferResult): Promise<void> {
  if (result.status === 'PENDING') {
    if (result.providerReference) {
      await prisma.walletCashout.updateMany({
        where: { id: cashoutId, status: WalletCashoutStatus.PROCESSING },
        data: { providerReference: result.providerReference },
      });
    }
    return;
  }

  if (result.status === 'PAID') {
    const moved = await prisma.walletCashout.updateMany({
      where: { id: cashoutId, status: WalletCashoutStatus.PROCESSING },
      data: {
        status: WalletCashoutStatus.PAID,
        providerReference: result.providerReference,
        completedAt: new Date(),
      },
    });
    if (moved.count === 1) {
      await recordAudit({
        action: AuditAction.WALLET_CASHOUT_PAID,
        entityType: 'WalletCashout',
        entityId: cashoutId,
        after: { providerReference: result.providerReference },
      });
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    const moved = await tx.walletCashout.updateMany({
      where: { id: cashoutId, status: WalletCashoutStatus.PROCESSING },
      data: {
        status: WalletCashoutStatus.FAILED,
        providerReference: result.providerReference,
        failureReason: result.failureReason,
        completedAt: new Date(),
      },
    });
    if (moved.count !== 1) return;

    const cashout = await tx.walletCashout.findUniqueOrThrow({ where: { id: cashoutId } });
    await tx.walletEntry.create({
      data: {
        userId: cashout.userId,
        type: WalletEntryType.CASHOUT_REVERSAL,
        status: WalletEntryStatus.AVAILABLE,
        amount: cashout.amount,
        entryKey: `cashout-reversal:${cashoutId}`,
        availableAt: new Date(),
        cashoutId,
      },
    });
    await recordAudit(
      {
        action: AuditAction.WALLET_CASHOUT_FAILED,
        entityType: 'WalletCashout',
        entityId: cashoutId,
        actorUserId: cashout.userId,
        after: { reason: result.failureReason, returnedToWallet: Number(cashout.amount) },
      },
      tx,
    );
  });
}

/**
 * Settle cash-outs still waiting on the provider. The reconciliation: it asks
 * Cashfree what happened rather than assuming. Safe to run repeatedly.
 */
export async function runCashoutSweep(): Promise<number> {
  if (!config.wallet.cashoutEnabled) return 0;

  const waiting = await prisma.walletCashout.findMany({
    where: {
      status: WalletCashoutStatus.PROCESSING,
      requestedAt: { lte: new Date(Date.now() - SWEEP_AFTER_MS) },
    },
    select: { id: true, transferId: true },
    orderBy: { requestedAt: 'asc' },
    take: 50,
  });

  for (const cashout of waiting) {
    try {
      await applyOutcome(cashout.id, await fetchTransfer(cashout.transferId));
    } catch (error) {
      walletLogger.warn({ err: error, cashoutId: cashout.id }, 'Payout status check failed');
    }
  }
  return waiting.length;
}
