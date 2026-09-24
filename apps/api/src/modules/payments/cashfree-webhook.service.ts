import { createHash } from 'node:crypto';
import { type Prisma, isUniqueViolation, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { verifyCashfreeSignature } from '../../providers/payments';
import { settlePayment } from './payment-settlement.service';

/**
 * Cashfree webhooks.
 *
 * Verified, recorded once, then applied. The signature is checked over the raw
 * body before anything is parsed or trusted. Each delivery is recorded under a
 * unique key, so a retried or duplicated webhook is acknowledged without being
 * applied twice. The payload is never taken as the outcome: a payment event
 * only prompts `settlePayment`, which asks Cashfree for the order itself.
 */

const webhookLogger = logger.child({ module: 'payments:webhook', provider: 'cashfree' });

/** A Cashfree Subscriptions event — autopay — as the subscriptions module reads it. */
export interface MandateWebhookEvent {
  type: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  paymentType: string | null;
  paymentStatus: string | null;
  paymentId: string | null;
  paymentAmount: number | null;
  failureReason: string | null;
}

type MandateEventHandler = (event: MandateWebhookEvent) => Promise<void>;
let mandateEventHandler: MandateEventHandler | null = null;

/** Autopay events belong to subscriptions, which registers for them at start-up. */
export function registerMandateEventHandler(handler: MandateEventHandler): void {
  mandateEventHandler = handler;
}

/** An Easy Split vendor event — a payee's standing, or a payout to them. */
export interface VendorWebhookEvent {
  type: string;
  vendorId: string | null;
  vendorStatus: string | null;
}

type VendorEventHandler = (event: VendorWebhookEvent) => Promise<void>;
let vendorEventHandler: VendorEventHandler | null = null;

/** Vendor events belong to marketplace finance, which registers for them. */
export function registerVendorEventHandler(handler: VendorEventHandler): void {
  vendorEventHandler = handler;
}

interface CashfreeWebhookBody {
  type?: string;
  data?: {
    order?: { order_id?: string };
    subscription_details?: { subscription_id?: string; subscription_status?: string };
    merchant_vendor_id?: string;
    updated_status?: string;
    settlement?: { vendor_id?: string; status?: string };
    subscription_id?: string;
    payment_id?: string;
    payment_type?: string;
    payment_status?: string;
    payment_amount?: number;
    failure_details?: { failure_reason?: string | null };
  };
}

function mandateEventFrom(body: CashfreeWebhookBody): MandateWebhookEvent {
  const data = body.data ?? {};
  return {
    type: body.type ?? '',
    subscriptionId: data.subscription_details?.subscription_id ?? data.subscription_id ?? null,
    subscriptionStatus: data.subscription_details?.subscription_status ?? null,
    paymentType: data.payment_type ?? null,
    paymentStatus: data.payment_status ?? null,
    paymentId: data.payment_id ?? null,
    paymentAmount: typeof data.payment_amount === 'number' ? data.payment_amount : null,
    failureReason: data.failure_details?.failure_reason ?? null,
  };
}

async function apply(body: CashfreeWebhookBody): Promise<void> {
  const type = body.type ?? '';

  if (type.startsWith('PAYMENT_')) {
    const orderId = body.data?.order?.order_id;
    if (!orderId) return;
    const known = await prisma.payment.findUnique({ where: { reference: orderId }, select: { id: true } });
    // An order Saarthi did not create — another integration on the same
    // account — is acknowledged and left alone.
    if (!known) return;
    await settlePayment(orderId);
    return;
  }

  if (type.startsWith('SUBSCRIPTION_')) {
    await mandateEventHandler?.(mandateEventFrom(body));
    return;
  }

  if (type.startsWith('VENDOR_')) {
    await vendorEventHandler?.({
      type,
      vendorId: body.data?.merchant_vendor_id ?? body.data?.settlement?.vendor_id ?? null,
      vendorStatus: body.data?.updated_status ?? null,
    });
  }
}

/**
 * Handle one delivery. Returns normally for anything Cashfree should stop
 * retrying; throws only when processing failed and a retry could succeed.
 */
export async function handleCashfreeWebhook(input: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  idempotencyKey: string | undefined;
}): Promise<{ duplicate: boolean }> {
  if (!verifyCashfreeSignature(input)) {
    webhookLogger.warn('Cashfree webhook with an invalid signature was refused');
    throw errors.unauthenticated('Invalid webhook signature.');
  }

  let body: CashfreeWebhookBody;
  try {
    body = JSON.parse(input.rawBody) as CashfreeWebhookBody;
  } catch {
    throw errors.validation('The webhook body is not valid JSON.');
  }

  const eventKey =
    input.idempotencyKey ?? createHash('sha256').update(input.rawBody).digest('hex');

  let eventId: string;
  try {
    const event = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'cashfree',
        eventKey,
        eventType: body.type ?? 'UNKNOWN',
        payload: body as Prisma.InputJsonValue,
      },
    });
    eventId = event.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { eventKey } });
    // Applied already: acknowledge the retry. Recorded but not applied — an
    // earlier attempt failed part-way — so apply it now.
    if (existing.processedAt) return { duplicate: true };
    eventId = existing.id;
  }

  try {
    await apply(body);
    await prisma.paymentWebhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), error: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.paymentWebhookEvent.update({ where: { id: eventId }, data: { error: message.slice(0, 1000) } });
    webhookLogger.error({ eventType: body.type, error: message }, 'Cashfree webhook could not be applied');
    throw error;
  }

  webhookLogger.info({ eventType: body.type }, 'Cashfree webhook applied');
  return { duplicate: false };
}
