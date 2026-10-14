import { PaymentStatus } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';

/**
 * One settled payment, with everything a receipt prints: what it paid for,
 * who paid whom, how, when, and the gateway's own transaction reference.
 */
export interface PaymentReceipt {
  reference: string;
  purpose: string;
  status: string;
  method: string;
  amount: number;
  refundedAmount: number;
  currency: string;
  provider: string;
  /** The gateway's transaction id — what the payer quotes to their bank. */
  providerReference: string | null;
  paidAt: string;
  payerName: string | null;
  /** The business the payment was for: the fleet on an order, the operator on a booking. */
  payeeName: string | null;
  /** The booking or order number it settled. */
  forReference: string | null;
}

/** Only money that actually moved earns a receipt. */
const RECEIPTED_STATUSES = [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED];

/**
 * The receipts for one booking or one order — only the caller's own
 * payments. A business never sees what another paid on the same order:
 * the fleet's payment to a seller is not the customer's to read.
 */
export async function listReceipts(
  organizationId: string | null,
  target: { bookingId?: string | undefined; orderId?: string | undefined },
): Promise<PaymentReceipt[]> {
  if (!organizationId) throw errors.organizationRequired();

  const rows = await prisma.payment.findMany({
    where: {
      organizationId,
      status: { in: RECEIPTED_STATUSES as never },
      ...(target.bookingId ? { bookingId: target.bookingId } : { orderId: target.orderId }),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      booking: { select: { reference: true, providerOrganizationId: true } },
      order: { select: { reference: true, fleetOrganizationId: true } },
    },
  });
  if (rows.length === 0) return [];

  const payeeIds = [
    ...new Set(
      rows
        .map((row) => row.booking?.providerOrganizationId ?? row.order?.fleetOrganizationId ?? null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const organizations = await prisma.organization.findMany({
    where: { id: { in: [organizationId, ...payeeIds] } },
    select: { id: true, name: true },
  });
  const names = new Map(organizations.map((organization) => [organization.id, organization.name]));

  return rows.map((row) => {
    const payeeId = row.booking?.providerOrganizationId ?? row.order?.fleetOrganizationId ?? null;
    return {
      reference: row.reference,
      purpose: row.purpose,
      status: row.status,
      method: row.method,
      amount: Number(row.amount),
      refundedAmount: Number(row.refundedAmount),
      currency: row.currency,
      provider: row.provider,
      providerReference: row.providerReference,
      paidAt: (row.processedAt ?? row.updatedAt).toISOString(),
      payerName: names.get(organizationId) ?? null,
      payeeName: payeeId ? (names.get(payeeId) ?? null) : null,
      forReference: row.booking?.reference ?? row.order?.reference ?? null,
    };
  });
}
