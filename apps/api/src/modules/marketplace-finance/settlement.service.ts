import { prisma, type Db } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { withLock } from '../../infra/lock';
import { paymentProvider } from '../../providers/payments';
import { registerVendorEventHandler } from '../payments/cashfree-webhook.service';
import { recordLedgerEntry } from './ledger.service';
import { usableVendorId } from './payout-account.service';

/**
 * Settlements: a provider's or supplier's share of a customer payment, on its
 * way to their bank account.
 *
 *   REQUESTED  the share was routed to their vendor (a split on the payment)
 *   PENDING    owed, waiting for a usable bank account before it can be split
 *   SETTLED    the payment provider has paid it out
 *   FAILED     gave up after repeated failures — needs a person
 *
 * `runMarketplaceSettlementSweep` moves them along and is the reconciliation:
 * it asks the payment provider what was actually paid out rather than
 * assuming.
 */

const settlementLogger = logger.child({ module: 'marketplace:settlement' });

const MAX_ATTEMPTS = 10;

export async function createSettlement(
  db: Db,
  input: {
    settlementKey: string;
    paymentReference: string;
    orderId?: string | null;
    bookingId?: string | null;
    recipientOrganizationId: string;
    vendorId: string | null;
    amount: number;
    /** True when the split is already on the payment (freight); false when it must be requested. */
    routed: boolean;
  },
): Promise<void> {
  if (input.amount <= 0) return;
  await db.marketplaceSettlement.createMany({
    data: [
      {
        settlementKey: input.settlementKey,
        paymentReference: input.paymentReference,
        orderId: input.orderId ?? null,
        bookingId: input.bookingId ?? null,
        recipientOrganizationId: input.recipientOrganizationId,
        vendorId: input.vendorId,
        amount: input.amount,
        status: input.routed ? 'REQUESTED' : 'PENDING',
        requestedAt: input.routed ? new Date() : null,
      },
    ],
    skipDuplicates: true,
  });
}

/** Route one waiting settlement, if its recipient can now be paid. */
async function requestSplit(settlement: {
  id: string;
  paymentReference: string;
  recipientOrganizationId: string;
  vendorId: string | null;
  amount: unknown;
  attempts: number;
}): Promise<void> {
  const vendorId = settlement.vendorId ?? (await usableVendorId(settlement.recipientOrganizationId));
  if (!vendorId) return; // Still no usable bank account — wait.

  try {
    await paymentProvider.splitAfterPayment(settlement.paymentReference, [
      { vendorId, amount: Number(settlement.amount) },
    ]);
    await prisma.marketplaceSettlement.update({
      where: { id: settlement.id },
      data: { status: 'REQUESTED', vendorId, requestedAt: new Date(), failureReason: null },
    });
  } catch (error) {
    await recordFailure(settlement.id, settlement.attempts, error);
  }
}

async function recordFailure(id: string, attempts: number, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  await prisma.marketplaceSettlement.update({
    where: { id },
    data: {
      attempts: attempts + 1,
      failureReason: reason.slice(0, 500),
      ...(attempts + 1 >= MAX_ATTEMPTS ? { status: 'FAILED' } : {}),
    },
  });
  settlementLogger.warn({ settlementId: id, attempts: attempts + 1, reason }, 'Settlement attempt failed');
}

/** Confirm a routed share was paid out, and record it. */
async function reconcile(settlement: {
  id: string;
  paymentReference: string;
  orderId: string | null;
  bookingId: string | null;
  recipientOrganizationId: string;
  vendorId: string | null;
  amount: unknown;
  attempts: number;
}): Promise<void> {
  if (!settlement.vendorId) return;
  try {
    const state = await paymentProvider.fetchSplitSettlement(settlement.paymentReference, [
      settlement.vendorId,
    ]);
    if (!state.settledVendorIds.includes(settlement.vendorId)) return;

    const moved = await prisma.marketplaceSettlement.updateMany({
      where: { id: settlement.id, status: 'REQUESTED' },
      data: { status: 'SETTLED', settledAt: new Date() },
    });
    if (moved.count === 1) {
      await recordLedgerEntry(prisma, {
        entryKey: `settlement:${settlement.id}`,
        type: 'PROVIDER_SETTLEMENT',
        orderId: settlement.orderId,
        bookingId: settlement.bookingId,
        organizationId: settlement.recipientOrganizationId,
        amount: Number(settlement.amount),
        paymentReference: settlement.paymentReference,
      });
    }
  } catch (error) {
    await recordFailure(settlement.id, settlement.attempts, error);
  }
}

/**
 * Move every open settlement along: request the ones waiting on a bank
 * account, confirm the ones routed. Safe to run as often as needed.
 */
export async function runMarketplaceSettlementSweep(): Promise<{ requested: number; checked: number }> {
  const result = await withLock('jobs:marketplace:settlement', 10 * 60_000, async () => {
    const [pending, requested] = await Promise.all([
      prisma.marketplaceSettlement.findMany({ where: { status: 'PENDING' }, take: 200 }),
      prisma.marketplaceSettlement.findMany({ where: { status: 'REQUESTED' }, take: 200 }),
    ]);
    for (const settlement of pending) await requestSplit(settlement);
    for (const settlement of requested) await reconcile(settlement);
    return { requested: pending.length, checked: requested.length };
  });
  return result ?? { requested: 0, checked: 0 };
}

/**
 * Move one payment's settlements along now rather than on the next sweep:
 * request what is waiting, and confirm what the gateway has paid out.
 */
export async function reconcilePayment(paymentReference: string): Promise<void> {
  const pending = await prisma.marketplaceSettlement.findMany({
    where: { paymentReference, status: 'PENDING' },
  });
  for (const settlement of pending) await requestSplit(settlement);

  const requested = await prisma.marketplaceSettlement.findMany({
    where: { paymentReference, status: 'REQUESTED' },
  });
  for (const settlement of requested) await reconcile(settlement);
}

/**
 * Cashfree vendor events: a payee's standing changed (a new vendor becoming
 * ACTIVE), or a payout to one moved. The payout itself is confirmed by asking
 * Cashfree, so a settlement event only prompts the reconciliation.
 */
registerVendorEventHandler(async (event) => {
  if (event.type === 'VENDOR_STATUS_UPDATE' && event.vendorId && event.vendorStatus) {
    await prisma.payoutAccount.updateMany({
      where: { vendorId: event.vendorId },
      data: { vendorStatus: event.vendorStatus },
    });
    return;
  }
  if (event.type.startsWith('VENDOR_SETTLEMENT_')) {
    await runMarketplaceSettlementSweep();
  }
});
