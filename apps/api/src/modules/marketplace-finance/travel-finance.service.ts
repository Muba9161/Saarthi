import {
  BookingStatus,
  NotificationPriority,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  profitCommission,
  type BookingCostsInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { recordCommission, recordLedgerEntry } from './ledger.service';
import { usableVendorId } from './payout-account.service';
import { createSettlement, reconcilePayment } from './settlement.service';
import type { AuthContext } from '../../auth/context';

/**
 * Tour & travel money — its own flow, not freight's.
 *
 *   package → booking → customer pays in full (held by Saarthi)
 *   → trip completed → provider records its costs
 *   → profit = payment − costs → Saarthi's 2% of profit
 *   → the rest is routed to the provider's bank account
 *
 * The commission can only be known once the costs are, so the payment is
 * split after the trip rather than when it was taken.
 */

const travelFinanceLogger = logger.child({ module: 'marketplace:travel-finance' });

async function loadBooking(bookingId: string) {
  const booking = await prisma.travelBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      status: true,
      totalAmount: true,
      refundAmount: true,
      providerOrganizationId: true,
      customerOrganizationId: true,
      providerCost: true,
      costBreakdown: true,
      costsFinalizedAt: true,
    },
  });
  if (!booking) throw errors.notFound('Booking');
  return booking;
}

export interface BookingFinanceSummary {
  bookingId: string;
  customerPayment: number;
  costs: { label: string; amount: number }[] | null;
  recordedCosts: number | null;
  profitBasis: number | null;
  commissionRate: number;
  commissionAmount: number | null;
  netAfterCommission: number | null;
  /** True once the costs are recorded and the commission calculated. */
  final: boolean;
  settlementStatus: string | null;
}

/** The provider's view of a booking's money. */
export async function bookingFinanceSummary(
  auth: AuthContext,
  bookingId: string,
): Promise<BookingFinanceSummary> {
  const booking = await loadBooking(bookingId);
  if (booking.providerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.notFound('Booking');
  }

  const revenue = Number(booking.totalAmount) - Number(booking.refundAmount ?? 0);
  const [commission, settlement] = await Promise.all([
    prisma.marketplaceCommission.findUnique({ where: { bookingId } }),
    prisma.marketplaceSettlement.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } }),
  ]);

  return {
    bookingId,
    customerPayment: revenue,
    costs: (booking.costBreakdown as { label: string; amount: number }[] | null) ?? null,
    recordedCosts: booking.providerCost !== null ? Number(booking.providerCost) : null,
    profitBasis: commission ? Number(commission.profitBasis) : null,
    commissionRate: commission ? Number(commission.rate) : profitCommission({ revenue: 0, costBasis: 0 }).rate,
    commissionAmount: commission ? Number(commission.amount) : null,
    netAfterCommission: commission
      ? Math.round((Number(commission.profitBasis) - Number(commission.amount)) * 100) / 100
      : null,
    final: commission !== null,
    settlementStatus: settlement?.status ?? null,
  };
}

/**
 * Record a completed booking's costs and settle it: commission on the profit,
 * the rest to the provider. Once only — the costs are final when recorded.
 */
export async function recordBookingCosts(
  auth: AuthContext,
  bookingId: string,
  input: BookingCostsInput,
): Promise<BookingFinanceSummary> {
  const booking = await loadBooking(bookingId);
  if (booking.providerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the provider records its costs for this booking.');
  }
  if (booking.status !== BookingStatus.COMPLETED) {
    throw errors.invalidTransition('Costs are recorded once the trip is completed.');
  }
  if (booking.costsFinalizedAt) {
    throw errors.conflict('The costs for this booking are already recorded.');
  }

  const payment = await prisma.payment.findFirst({
    where: { bookingId, purpose: PaymentPurpose.TRAVEL_BOOKING, status: PaymentStatus.SUCCEEDED },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) throw errors.businessRule('This booking has no successful payment to settle.');

  const costs = input.costs.map((cost) => ({ label: cost.label, amount: Math.round(cost.amount * 100) / 100 }));
  const recordedCosts = Math.round(costs.reduce((sum, cost) => sum + cost.amount, 0) * 100) / 100;
  const revenue = Number(payment.amount) - Number(payment.refundedAmount);
  const paymentReference = payment.providerReference ?? payment.reference;

  const commission = await prisma.$transaction(async (tx) => {
    const marked = await tx.travelBooking.updateMany({
      where: { id: bookingId, costsFinalizedAt: null },
      data: { providerCost: recordedCosts, costBreakdown: costs, costsFinalizedAt: new Date() },
    });
    if (marked.count !== 1) throw errors.conflict('The costs for this booking are already recorded.');

    const row = await recordCommission(tx, {
      kind: 'TRAVEL_BOOKING',
      bookingId,
      providerOrganizationId: booking.providerOrganizationId,
      revenue,
      costBasis: recordedCosts,
      settled: true,
    });
    await recordLedgerEntry(tx, {
      entryKey: `payment:${payment.reference}`,
      type: 'CUSTOMER_PAYMENT',
      bookingId,
      organizationId: booking.customerOrganizationId,
      counterpartyOrganizationId: booking.providerOrganizationId,
      amount: revenue,
      stage: 'FULL',
      paymentReference,
    });
    await recordLedgerEntry(tx, {
      entryKey: `commission:booking:${bookingId}`,
      type: 'COMMISSION',
      bookingId,
      organizationId: booking.providerOrganizationId,
      amount: Number(row.amount),
      stage: 'FINAL',
      note: `2% of profit ${Number(row.profitBasis)} (${row.ruleVersion})`,
    });
    // The provider's share: everything it was paid, less Saarthi's commission.
    await createSettlement(tx, {
      settlementKey: `settle:${payment.reference}:${booking.providerOrganizationId}`,
      paymentReference,
      bookingId,
      recipientOrganizationId: booking.providerOrganizationId,
      vendorId: await usableVendorId(booking.providerOrganizationId),
      amount: Math.round((revenue - Number(row.amount)) * 100) / 100,
      routed: false,
    });
    return row;
  });

  await recordAudit({
    action: AuditAction.MARKETPLACE_COMMISSION_CALCULATED,
    entityType: 'TravelBooking',
    entityId: bookingId,
    actorUserId: auth.user.id,
    organizationId: booking.providerOrganizationId,
    after: {
      revenue,
      cost: recordedCosts,
      profitBasis: Number(commission.profitBasis),
      commission: Number(commission.amount),
      ruleVersion: commission.ruleVersion,
    },
  });

  // Route it now if the provider can be paid; otherwise the sweep does once
  // its bank account is verified.
  await reconcilePayment(paymentReference);

  void notifyOrganization(booking.providerOrganizationId, {
    type: NotificationType.BOOKING_COMPLETED,
    title: 'Booking settled',
    body: `${booking.reference}: Saarthi's commission is ₹${Number(commission.amount)} — 2% of your ₹${Number(commission.profitBasis)} profit.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/travel/provider/bookings/${bookingId}`,
  });
  travelFinanceLogger.info({ bookingId, commission: Number(commission.amount) }, 'Booking costs recorded');

  return bookingFinanceSummary(auth, bookingId);
}
