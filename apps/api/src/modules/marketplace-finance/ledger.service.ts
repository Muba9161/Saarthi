import { type CommissionRule, profitCommission } from '@saarthi/shared';
import type { Db } from '../../database/prisma';

/**
 * The marketplace ledger and commission records — written once, never edited.
 *
 * Every entry carries a unique key built from what it records (the payment
 * reference and the stage), so a retried webhook or a repeated call cannot
 * write the same money twice. Corrections are new entries (REFUND,
 * ADJUSTMENT), never edits of old ones.
 */

export type LedgerType =
  | 'CUSTOMER_PAYMENT'
  | 'PROCUREMENT_PAYMENT'
  | 'COMMISSION'
  | 'PROVIDER_SETTLEMENT'
  | 'REFUND'
  | 'ADJUSTMENT';

export interface LedgerEntryInput {
  entryKey: string;
  type: LedgerType;
  orderId?: string | null;
  bookingId?: string | null;
  organizationId: string;
  counterpartyOrganizationId?: string | null;
  amount: number;
  stage?: string | null;
  paymentReference?: string | null;
  note?: string | null;
}

/** Record a movement. Returns false when it was recorded already. */
export async function recordLedgerEntry(db: Db, entry: LedgerEntryInput): Promise<boolean> {
  const result = await db.marketplaceLedgerEntry.createMany({
    data: [
      {
        entryKey: entry.entryKey,
        type: entry.type,
        orderId: entry.orderId ?? null,
        bookingId: entry.bookingId ?? null,
        organizationId: entry.organizationId,
        counterpartyOrganizationId: entry.counterpartyOrganizationId ?? null,
        amount: entry.amount,
        stage: entry.stage ?? null,
        paymentReference: entry.paymentReference ?? null,
        note: entry.note ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return result.count === 1;
}

/**
 * Calculate and record Saarthi's commission on a finalized profit.
 *
 * One per order or booking — a second call returns the first. The inputs, the
 * rate and the rule version are kept with it, so it can always be explained
 * and never silently changes when the rule does.
 */
export async function recordCommission(
  db: Db,
  input: {
    kind: 'FREIGHT_ORDER' | 'TRAVEL_BOOKING';
    orderId?: string;
    bookingId?: string;
    providerOrganizationId: string;
    revenue: number;
    costBasis: number;
    settled: boolean;
    /** Defaults to the ordinary marketplace rule; a backhaul job passes its own. */
    rule?: CommissionRule;
  },
) {
  const existing = await db.marketplaceCommission.findFirst({
    where: input.orderId ? { orderId: input.orderId } : { bookingId: input.bookingId ?? '' },
  });
  if (existing) return existing;

  const commission = profitCommission(
    { revenue: input.revenue, costBasis: input.costBasis },
    input.rule,
  );
  return db.marketplaceCommission.create({
    data: {
      kind: input.kind,
      orderId: input.orderId ?? null,
      bookingId: input.bookingId ?? null,
      providerOrganizationId: input.providerOrganizationId,
      revenueAmount: commission.revenue,
      costAmount: commission.costBasis,
      profitBasis: commission.profitBasis,
      rate: commission.rate,
      amount: commission.amount,
      ruleVersion: commission.ruleVersion,
      status: input.settled ? 'SETTLED' : 'CALCULATED',
      settledAt: input.settled ? new Date() : null,
    },
  });
}

/** A provider's own marketplace commissions, newest first. */
export async function listCommissions(db: Db, organizationId: string, page: number, pageSize: number) {
  const where = { providerOrganizationId: organizationId };
  const [total, rows] = await Promise.all([
    db.marketplaceCommission.count({ where }),
    db.marketplaceCommission.findMany({
      where,
      orderBy: { calculatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      orderId: row.orderId,
      bookingId: row.bookingId,
      revenue: Number(row.revenueAmount),
      costBasis: Number(row.costAmount),
      profitBasis: Number(row.profitBasis),
      rate: Number(row.rate),
      amount: Number(row.amount),
      ruleVersion: row.ruleVersion,
      status: row.status,
      calculatedAt: row.calculatedAt.toISOString(),
    })),
  };
}
