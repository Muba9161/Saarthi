import { PaymentMethod, type PaymentPurpose, PaymentStatus } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { withLock } from '../../infra/lock';
import {
  paymentProvider,
  type CheckoutSession,
  type PaymentIntentResult,
  type PaymentSplit,
} from '../../providers/payments';

/**
 * Payment settlement — the one place a payment's outcome is decided.
 *
 * Every charge has a `payments` row, written before the gateway is called. With
 * the mock gateway the outcome is known at once; with a hosted checkout it
 * arrives later, by webhook or when the payer returns. Either way it comes
 * through `settlePayment`, which asks the gateway itself (never the browser),
 * moves the row out of PROCESSING exactly once, and hands the outcome to the
 * domain that owns the payment — a travel booking, a vehicle top-up, a tracker.
 *
 * The domains register their handlers here rather than this module importing
 * them, so payments depend on nothing and every domain depends on payments.
 */

const settlementLogger = logger.child({ module: 'payments:settlement' });

export interface SettledPayment {
  id: string;
  reference: string;
  providerReference: string | null;
  purpose: PaymentPurpose;
  organizationId: string;
  initiatedByUserId: string;
  bookingId: string | null;
  orderId: string | null;
  amount: number;
}

export interface SettlementHandler {
  onSucceeded(payment: SettledPayment): Promise<void>;
  onFailed?(payment: SettledPayment, message: string): Promise<void>;
}

const handlers = new Map<PaymentPurpose, SettlementHandler>();

function handlerFor(purpose: PaymentPurpose): SettlementHandler | undefined {
  const handler = handlers.get(purpose);
  // A settled payment nobody applies is money taken for nothing — loud, always.
  if (!handler) settlementLogger.error({ purpose }, 'No settlement handler is registered');
  return handler;
}

export function registerSettlementHandler(purpose: PaymentPurpose, handler: SettlementHandler): void {
  handlers.set(purpose, handler);
}

/** States a payment cannot leave by settlement. */
const FINAL_STATUSES: PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.REFUNDED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.CANCELLED,
];

function toSettled(row: {
  id: string;
  reference: string;
  providerReference: string | null;
  purpose: string;
  organizationId: string;
  initiatedByUserId: string;
  bookingId: string | null;
  orderId: string | null;
  amount: unknown;
}): SettledPayment {
  return {
    id: row.id,
    reference: row.reference,
    providerReference: row.providerReference,
    purpose: row.purpose as PaymentPurpose,
    organizationId: row.organizationId,
    initiatedByUserId: row.initiatedByUserId,
    bookingId: row.bookingId,
    orderId: row.orderId,
    amount: Number(row.amount),
  };
}

/**
 * Write a payment row and hand it to the gateway.
 *
 * The row comes first, so a crash between the two leaves an auditable record
 * rather than money with no trace. A gateway that settles in-process is
 * finished here; a hosted checkout leaves the row PROCESSING with a session for
 * the web app to open.
 */
export async function openPayment(input: {
  reference: string;
  purpose: PaymentPurpose;
  organizationId: string;
  userId: string;
  bookingId?: string;
  orderId?: string;
  amount: number;
  description: string;
  customer: { name: string; email: string | null; phone: string | null };
  returnPath: string;
  metadata: Record<string, string>;
  method?: PaymentMethod;
  /** Shares routed straight to marketplace vendors. */
  splits?: PaymentSplit[];
}): Promise<{ paymentId: string; intent: PaymentIntentResult }> {
  const payment = await prisma.payment.create({
    data: {
      reference: input.reference,
      purpose: input.purpose,
      status: PaymentStatus.PROCESSING,
      method:
        paymentProvider.name === 'mock'
          ? (input.method ?? PaymentMethod.MOCK)
          : PaymentMethod.ONLINE,
      organizationId: input.organizationId,
      initiatedByUserId: input.userId,
      bookingId: input.bookingId ?? null,
      orderId: input.orderId ?? null,
      amount: input.amount,
      currency: 'INR',
      provider: paymentProvider.name,
    },
  });

  let intent: PaymentIntentResult;
  try {
    intent = await paymentProvider.createIntent({
      reference: input.reference,
      amount: input.amount,
      currency: 'INR',
      description: input.description,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      customerPhone: input.customer.phone,
      customerId: input.organizationId,
      returnPath: input.returnPath,
      ...(input.splits?.length ? { splits: input.splits } : {}),
      metadata: { organizationId: input.organizationId, ...input.metadata },
    });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: 'GATEWAY_ERROR',
        failureMessage: error instanceof Error ? error.message.slice(0, 500) : 'Gateway error',
      },
    });
    throw error;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status:
        intent.status === 'SUCCEEDED'
          ? PaymentStatus.SUCCEEDED
          : intent.status === 'FAILED'
            ? PaymentStatus.FAILED
            : PaymentStatus.PROCESSING,
      providerReference: intent.providerReference,
      failureCode: intent.failureCode,
      failureMessage: intent.failureMessage,
      processedAt: intent.processedAt,
    },
  });

  return { paymentId: payment.id, intent };
}

/**
 * Decide a payment's outcome from the gateway's own records.
 *
 * Idempotent and safe to call from anywhere — a webhook, a retried webhook, the
 * payer returning, a reconciliation sweep. The move out of PROCESSING is a
 * conditional update, so however many callers race, the owning domain is told
 * once.
 */
export async function settlePayment(reference: string): Promise<PaymentStatus> {
  const outcome = await withLock(`payments:settle:${reference}`, 60_000, async () => {
    const row = await prisma.payment.findUnique({ where: { reference } });
    if (!row) throw errors.notFound('Payment');
    if (FINAL_STATUSES.includes(row.status as PaymentStatus)) return row.status as PaymentStatus;

    const result = await paymentProvider.fetchIntent(row.providerReference ?? row.reference);
    const payment = toSettled(row);

    if (result.status === 'SUCCEEDED') {
      const moved = await prisma.payment.updateMany({
        where: { id: row.id, status: { notIn: FINAL_STATUSES } },
        data: {
          status: PaymentStatus.SUCCEEDED,
          processedAt: result.processedAt ?? new Date(),
          failureCode: null,
          failureMessage: null,
        },
      });
      if (moved.count === 1) {
        settlementLogger.info({ reference, purpose: row.purpose }, 'Payment settled');
        await handlerFor(payment.purpose)?.onSucceeded(payment);
      }
      return PaymentStatus.SUCCEEDED;
    }

    if (result.status === 'FAILED' && row.status !== PaymentStatus.FAILED) {
      const message = result.failureMessage ?? 'The payment did not go through.';
      await prisma.payment.update({
        where: { id: row.id },
        data: { status: PaymentStatus.FAILED, failureCode: 'DECLINED', failureMessage: message },
      });
      settlementLogger.info({ reference, purpose: row.purpose }, 'Payment failed');
      await handlerFor(payment.purpose)?.onFailed?.(payment, message);
      return PaymentStatus.FAILED;
    }

    return row.status as PaymentStatus;
  });

  if (!outcome) {
    throw errors.conflict('This payment is being confirmed already. Try again in a moment.');
  }
  return outcome;
}

/** Complete a payment the gateway settled in-process (the mock). */
export async function completeSettledPayment(paymentId: string): Promise<void> {
  const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (row.status === PaymentStatus.SUCCEEDED) {
    await handlerFor(row.purpose as PaymentPurpose)?.onSucceeded(toSettled(row));
  }
}

/** A payment as the web app reads it after returning from checkout. */
export async function paymentStatusFor(
  organizationId: string | null,
  isPlatformAdmin: boolean,
  reference: string,
): Promise<{ reference: string; status: PaymentStatus; purpose: PaymentPurpose; bookingId: string | null }> {
  const row = await prisma.payment.findUnique({ where: { reference } });
  if (!row || (!isPlatformAdmin && row.organizationId !== organizationId)) {
    throw errors.notFound('Payment');
  }
  return {
    reference: row.reference,
    status: row.status as PaymentStatus,
    purpose: row.purpose as PaymentPurpose,
    bookingId: row.bookingId,
  };
}

export type { CheckoutSession };
