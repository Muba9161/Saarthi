import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  BankVerificationInput,
  BankVerificationResult,
  CheckoutSession,
  MandateInput,
  MandateResult,
  MandateState,
  MandateStatus,
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  PaymentSplit,
  PaymentStatusResult,
  RefundInput,
  RefundResult,
  SplitSettlementState,
  VendorInput,
  VendorState,
} from './payment.provider';

/**
 * Cashfree Payments.
 *
 * One-time payments are Cashfree PG orders: the API creates the order, the web
 * app opens Cashfree's hosted checkout with the returned `payment_session_id`,
 * and the outcome is confirmed server-side — by webhook, or by asking for the
 * order when the payer returns. The plan's monthly autopay is a Cashfree
 * Subscription on a PERIODIC plan whose first charge is deferred to the end of
 * the free trial.
 *
 * Saarthi's own reference is used as the Cashfree `order_id` and
 * `subscription_id`, so every later call — status, refund, webhook — is keyed
 * on a value Saarthi already holds.
 *
 * The secret key never leaves this file: it authenticates API calls and
 * verifies webhook signatures, and is neither logged nor sent to a client.
 */

const log = logger.child({ module: 'payments', provider: 'cashfree' });

const REQUEST_TIMEOUT_MS = 15_000;
/** Namespace for Saarthi's order tags — see `createIntent`. */
const TAG_PREFIX = 'saarthi_';
/** Cashfree asks for a gap between the pre-debit notice and a charge. */
const MIN_FIRST_CHARGE_DELAY_MS = 26 * 60 * 60 * 1000;

interface CashfreeErrorBody {
  message?: string;
  code?: string;
  type?: string;
}

export class CashfreeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: CashfreeErrorBody,
  ) {
    super(body.message ?? `Cashfree responded ${status}`);
  }
}

/**
 * Which Cashfree API a call goes to: Payments (PG), Secure ID (verification) or
 * Payouts. Exported with `cashfree` so wallet payouts share one request path —
 * headers, timeout and error handling — rather than a copy of it.
 */
export interface CashfreeTarget {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string | null;
}

function pgTarget(): CashfreeTarget {
  return {
    baseUrl: config.cashfree.baseUrl,
    clientId: config.cashfree.appId,
    clientSecret: config.cashfree.secretKey,
    apiVersion: config.cashfree.apiVersion,
  };
}

/** Secure ID has its own keys and no version header. */
function verificationTarget(): CashfreeTarget {
  return {
    baseUrl: config.cashfree.verification.baseUrl,
    clientId: config.cashfree.verification.clientId,
    clientSecret: config.cashfree.verification.clientSecret,
    apiVersion: null,
  };
}

export async function cashfree<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  target: CashfreeTarget = pgTarget(),
): Promise<T> {
  const response = await fetch(`${target.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(target.apiVersion ? { 'x-api-version': target.apiVersion } : {}),
      'x-client-id': target.clientId,
      'x-client-secret': target.clientSecret,
      'x-request-id': randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((cause: unknown) => {
    throw errors.provider('cashfree', 'Cashfree could not be reached. Please try again.', cause);
  });

  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { message: `Cashfree responded ${response.status}` };
  }
  if (!response.ok) throw new CashfreeHttpError(response.status, parsed as CashfreeErrorBody);
  return parsed as T;
}

/** Turn a Cashfree refusal into a message the payer can act on. */
function asProviderError(error: unknown, action: string): Error {
  if (error instanceof CashfreeHttpError) {
    log.warn({ status: error.status, code: error.body.code, action }, 'Cashfree refused a request');
    return errors.provider('cashfree', error.body.message ?? `Cashfree could not ${action}.`, error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Cashfree wants a 10-digit Indian mobile number. */
function tenDigitPhone(phone: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    throw errors.businessRule(
      'A 10-digit mobile number is needed to pay online. Add one to your profile and try again.',
    );
  }
  return digits;
}

/** 3–50 alphanumeric characters. */
function customerId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 50);
  return cleaned.length >= 3 ? cleaned : `cust${cleaned}`;
}

/** ISO 8601 in India time, the form Cashfree's examples use. */
function istIso(date: Date): string {
  const shifted = new Date(date.getTime() + 330 * 60_000);
  return `${shifted.toISOString().slice(0, 19)}+05:30`;
}

function returnUrl(path: string, param: string, reference: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${config.cashfree.returnBaseUrl}${path}${separator}${param}=${encodeURIComponent(reference)}`;
}

/** Cashfree only accepts an HTTPS notify URL, so a local http one is left out. */
function notifyUrl(): string | undefined {
  const url = config.cashfree.webhookUrl;
  return url && url.startsWith('https://') ? url : undefined;
}

function session(kind: CheckoutSession['kind'], sessionId: string, reference: string): CheckoutSession {
  return { provider: 'cashfree', mode: config.cashfree.environment, kind, sessionId, reference };
}

/** Cashfree's subscription vocabulary, folded into Saarthi's. Unknown words are not active. */
export function mandateStatusFrom(providerStatus: string): MandateStatus {
  switch (providerStatus.toUpperCase().replace(/\s+/g, '_')) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'INITIALIZED':
    case 'BANK_APPROVAL_PENDING':
      return 'PENDING';
    case 'ON_HOLD':
    case 'PAUSED':
    case 'CUSTOMER_PAUSED':
      return 'ON_HOLD';
    case 'FAILED':
    case 'LINK_EXPIRED':
      return 'FAILED';
    default:
      return 'CANCELLED';
  }
}

/**
 * Verify a Cashfree webhook: base64(HMAC-SHA256(timestamp + rawBody, secret)).
 *
 * Computed over the raw body exactly as received — re-serialised JSON would
 * not match.
 */
export function verifyCashfreeSignature(input: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
}): boolean {
  if (!input.timestamp || !input.signature || !config.cashfree.secretKey) return false;
  const expected = createHmac('sha256', config.cashfree.secretKey)
    .update(input.timestamp + input.rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CashfreeOrder {
  order_id: string;
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED' | 'TERMINATION_REQUESTED';
  payment_session_id?: string;
}

interface CashfreeSubscription {
  subscription_id: string;
  subscription_status: string;
  subscription_session_id?: string;
}

export class CashfreePaymentProvider implements PaymentProvider {
  readonly name = 'cashfree' as const;
  readonly settlesSynchronously = false;

  /** Plans already known to exist at Cashfree, so each is created once. */
  private readonly knownPlans = new Set<string>();

  async createIntent(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    if (input.amount < 1) {
      return {
        providerReference: input.reference,
        status: 'FAILED',
        checkout: null,
        redirectUrl: null,
        failureCode: 'INVALID_AMOUNT',
        failureMessage: 'A payment must be for at least one rupee.',
        processedAt: null,
      };
    }

    /*
     * Every tag key is namespaced. Cashfree reads some tag names as
     * instructions rather than labels: a tag called `gst` switches the order to
     * its GST-invoice mode, which then refuses the order for want of an
     * `invoice_number` — so every top-up, tracker and vehicle order carrying
     * its GST split failed at checkout. The prefix keeps Saarthi's labels out
     * of Cashfree's reserved names, whichever ones those are.
     */
    const tags = Object.fromEntries(
      Object.entries(input.metadata)
        .filter(([key, value]) => key !== 'simulateFailure' && value !== '')
        .slice(0, 15)
        .map(([key, value]) => [`${TAG_PREFIX}${key}`.slice(0, 255), value.slice(0, 255)]),
    );

    try {
      const order = await cashfree<CashfreeOrder>('POST', '/orders', {
        order_id: input.reference,
        order_amount: Math.round(input.amount * 100) / 100,
        order_currency: input.currency,
        order_note: input.description.slice(0, 200),
        customer_details: {
          customer_id: customerId(input.customerId ?? input.metadata.organizationId ?? input.reference),
          customer_name: input.customerName.slice(0, 100) || 'Saarthi customer',
          customer_email: input.customerEmail ?? undefined,
          customer_phone: tenDigitPhone(input.customerPhone),
        },
        order_meta: {
          return_url: returnUrl(input.returnPath ?? '/settings/subscription', 'order_id', input.reference),
          notify_url: notifyUrl(),
        },
        order_tags: Object.keys(tags).length > 0 ? tags : undefined,
        // Marketplace money goes straight to the vendors it belongs to.
        order_splits: input.splits?.length
          ? input.splits.map((split) => ({
              vendor_id: split.vendorId,
              amount: Math.round(split.amount * 100) / 100,
            }))
          : undefined,
      });

      if (!order.payment_session_id) {
        throw errors.provider('cashfree', 'Cashfree did not return a checkout session.');
      }

      log.info({ reference: input.reference, amount: input.amount }, 'Cashfree order created');

      return {
        providerReference: order.order_id,
        status: 'PENDING',
        checkout: session('payment', order.payment_session_id, order.order_id),
        redirectUrl: null,
        failureCode: null,
        failureMessage: null,
        processedAt: null,
      };
    } catch (error) {
      throw asProviderError(error, 'create the payment');
    }
  }

  async fetchIntent(reference: string): Promise<PaymentStatusResult> {
    try {
      const order = await cashfree<CashfreeOrder>('GET', `/orders/${encodeURIComponent(reference)}`);
      if (order.order_status === 'PAID') {
        return { status: 'SUCCEEDED', failureMessage: null, processedAt: new Date() };
      }
      if (order.order_status !== 'ACTIVE') {
        return { status: 'FAILED', failureMessage: 'The payment window closed.', processedAt: null };
      }
      // Still open. A declined attempt does not close the order — the payer can
      // try again on the same checkout — so it stays pending until Cashfree
      // expires it. Reporting it failed would release what it is paying for
      // while it can still be paid.
      return { status: 'PENDING', failureMessage: null, processedAt: null };
    } catch (error) {
      throw asProviderError(error, 'check the payment');
    }
  }

  async resumeCheckout(reference: string): Promise<CheckoutSession | null> {
    try {
      const order = await cashfree<CashfreeOrder>('GET', `/orders/${encodeURIComponent(reference)}`);
      return order.order_status === 'ACTIVE' && order.payment_session_id
        ? session('payment', order.payment_session_id, order.order_id)
        : null;
    } catch (error) {
      throw asProviderError(error, 'reopen the payment');
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    try {
      const refund = await cashfree<{ refund_status: string; refund_amount: number }>(
        'POST',
        `/orders/${encodeURIComponent(input.providerReference)}/refunds`,
        {
          refund_amount: Math.round(input.amount * 100) / 100,
          refund_id: `RF${randomUUID().replace(/-/g, '').slice(0, 30)}`,
          refund_note: input.reason.slice(0, 100).padEnd(3, '.'),
        },
      );
      const status =
        refund.refund_status === 'SUCCESS'
          ? 'SUCCEEDED'
          : ['CANCELLED', 'REJECTED'].includes(refund.refund_status)
            ? 'FAILED'
            : 'PENDING';
      return {
        providerReference: input.providerReference,
        status,
        refundedAmount: status === 'FAILED' ? 0 : refund.refund_amount,
        failureMessage: status === 'FAILED' ? `Refund ${refund.refund_status.toLowerCase()}.` : null,
        processedAt: status === 'SUCCEEDED' ? new Date() : null,
      };
    } catch (error) {
      throw asProviderError(error, 'refund the payment');
    }
  }

  /** One PERIODIC monthly plan per amount, created the first time it is needed. */
  private async ensurePlan(monthlyAmount: number): Promise<string> {
    const amount = Math.round(monthlyAmount * 100) / 100;
    const planId = `saarthi_monthly_${Math.round(amount * 100)}`;
    if (this.knownPlans.has(planId)) return planId;

    try {
      await cashfree('GET', `/plans/${planId}`);
    } catch (error) {
      // Cashfree reports a missing plan as 400 `plan_not_found`, not 404 —
      // both mean "create it". Anything else is a real failure.
      const missing =
        error instanceof CashfreeHttpError &&
        (error.status === 404 || error.body.code === 'plan_not_found');
      if (!missing) {
        throw asProviderError(error, 'look up the autopay plan');
      }
      try {
        await cashfree('POST', '/plans', {
          plan_id: planId,
          plan_name: `Saarthi Rs ${amount} monthly`.slice(0, 40),
          plan_type: 'PERIODIC',
          plan_currency: 'INR',
          plan_recurring_amount: amount,
          plan_max_amount: amount,
          plan_max_cycles: 120,
          plan_intervals: 1,
          plan_interval_type: 'MONTH',
          plan_note: 'Saarthi subscription, GST included',
        });
      } catch (createError) {
        throw asProviderError(createError, 'create the autopay plan');
      }
    }

    this.knownPlans.add(planId);
    return planId;
  }

  async createMandate(input: MandateInput): Promise<MandateResult> {
    const planId = await this.ensurePlan(input.monthlyAmount);
    const firstChargeAt = new Date(
      Math.max(input.firstChargeAt.getTime(), Date.now() + MIN_FIRST_CHARGE_DELAY_MS),
    );

    try {
      const subscription = await cashfree<CashfreeSubscription>('POST', '/subscriptions', {
        subscription_id: input.reference,
        customer_details: {
          customer_name: input.customer.name.slice(0, 100) || 'Saarthi customer',
          customer_email: input.customer.email ?? undefined,
          customer_phone: tenDigitPhone(input.customer.phone),
        },
        plan_details: { plan_id: planId },
        authorization_details: {
          // Card and UPI mandates cannot be authorised for zero, so ₹1 is
          // taken and refunded.
          authorization_amount: 1,
          authorization_amount_refund: true,
          payment_methods: ['upi', 'card', 'enach'],
        },
        subscription_meta: {
          return_url: returnUrl(input.returnPath, 'subscription_id', input.reference),
        },
        subscription_first_charge_time: istIso(firstChargeAt),
        subscription_expiry_time: istIso(new Date(Date.now() + 10 * 365 * 86_400_000)),
        subscription_tags: { customerId: customerId(input.customer.id) },
      });

      if (!subscription.subscription_session_id) {
        throw errors.provider('cashfree', 'Cashfree did not return an autopay session.');
      }

      log.info({ reference: input.reference, planId }, 'Cashfree subscription created');

      return {
        reference: subscription.subscription_id,
        status: mandateStatusFrom(subscription.subscription_status),
        providerStatus: subscription.subscription_status,
        checkout: session('subscription', subscription.subscription_session_id, subscription.subscription_id),
      };
    } catch (error) {
      throw asProviderError(error, 'set up autopay');
    }
  }

  async fetchMandate(reference: string): Promise<MandateState> {
    try {
      const subscription = await cashfree<CashfreeSubscription>(
        'GET',
        `/subscriptions/${encodeURIComponent(reference)}`,
      );
      return {
        status: mandateStatusFrom(subscription.subscription_status),
        providerStatus: subscription.subscription_status,
      };
    } catch (error) {
      throw asProviderError(error, 'check autopay');
    }
  }

  async changeMandateAmount(reference: string, monthlyAmount: number): Promise<void> {
    const planId = await this.ensurePlan(monthlyAmount);
    try {
      await cashfree('POST', `/subscriptions/${encodeURIComponent(reference)}/manage`, {
        subscription_id: reference,
        action: 'CHANGE_PLAN',
        action_details: { plan_id: planId },
      });
    } catch (error) {
      throw asProviderError(error, 'update the autopay amount');
    }
  }

  /**
   * Penny validation through Cashfree Secure ID (Bank Account Verification v2).
   *
   * Without Secure ID keys the account is left pending rather than guessed at;
   * a bank's temporary failure is pending too, so it can be retried.
   */
  async verifyBankAccount(input: BankVerificationInput): Promise<BankVerificationResult> {
    const target = verificationTarget();
    if (!target.clientId || !target.clientSecret) {
      return {
        status: 'PENDING',
        nameAtBank: null,
        bankName: null,
        reference: null,
        reason: 'Bank verification is not configured yet (CASHFREE_VERIFICATION_CLIENT_ID).',
      };
    }

    try {
      const result = await cashfree<{
        reference_id?: number | string;
        name_at_bank?: string;
        bank_name?: string;
        account_status?: string;
        account_status_code?: string;
      }>(
        'POST',
        '/bank-account/sync',
        {
          bank_account: input.accountNumber,
          ifsc: input.ifsc,
          name: input.name.slice(0, 100),
          ...(input.phone ? { phone: input.phone.replace(/\D/g, '').slice(-10) } : {}),
        },
        target,
      );
      const valid = result.account_status === 'VALID';
      return {
        status: valid ? 'VALID' : result.account_status === 'INVALID' ? 'INVALID' : 'PENDING',
        nameAtBank: result.name_at_bank ?? null,
        bankName: result.bank_name ?? null,
        reference: result.reference_id !== undefined ? String(result.reference_id) : null,
        reason: valid ? null : (result.account_status_code ?? 'The bank did not confirm this account.'),
      };
    } catch (error) {
      if (error instanceof CashfreeHttpError && error.status === 422) {
        const permanent = ['fraud_account', 'failed_at_bank', 'bene_bank_declined'].includes(
          error.body.code ?? '',
        );
        return {
          status: permanent ? 'INVALID' : 'PENDING',
          nameAtBank: null,
          bankName: null,
          reference: null,
          reason: error.body.message ?? 'The bank could not verify this account.',
        };
      }
      throw asProviderError(error, 'verify the bank account');
    }
  }

  /** An Easy Split vendor: where Cashfree routes a fleet's or supplier's share. */
  async createVendor(input: VendorInput): Promise<VendorState> {
    try {
      const vendor = await cashfree<{ vendor_id: string; status: string }>('POST', '/easy-split/vendors', {
        vendor_id: input.vendorId,
        status: 'ACTIVE',
        name: input.name.replace(/[^A-Za-z0-9 ./&-]/g, '').slice(0, 100) || 'Saarthi vendor',
        email: input.email,
        phone: input.phone.replace(/\D/g, '').slice(-10),
        // Penny validation already ran through Secure ID.
        verify_account: false,
        dashboard_access: false,
        bank: {
          account_number: input.accountNumber,
          account_holder: input.accountHolder,
          ifsc: input.ifsc,
        },
        kyc_details: {
          account_type: 'BUSINESS',
          business_type: config.cashfree.vendorBusinessType,
          pan: input.pan,
        },
      });
      return { vendorId: vendor.vendor_id, active: vendor.status === 'ACTIVE', providerStatus: vendor.status };
    } catch (error) {
      // Connected before: the vendor already exists, so read where it stands.
      if (error instanceof CashfreeHttpError && error.status === 409) return this.fetchVendor(input.vendorId);
      throw asProviderError(error, 'register the bank account for payouts');
    }
  }

  async fetchVendor(vendorId: string): Promise<VendorState> {
    try {
      const vendor = await cashfree<{ vendor_id: string; status: string }>(
        'GET',
        `/easy-split/vendors/${encodeURIComponent(vendorId)}`,
      );
      return { vendorId: vendor.vendor_id, active: vendor.status === 'ACTIVE', providerStatus: vendor.status };
    } catch (error) {
      throw asProviderError(error, 'check the payout account');
    }
  }

  async splitAfterPayment(reference: string, splits: PaymentSplit[]): Promise<void> {
    try {
      await cashfree('POST', `/easy-split/orders/${encodeURIComponent(reference)}/split`, {
        split: splits.map((split) => ({
          vendor_id: split.vendorId,
          amount: Math.round(split.amount * 100) / 100,
        })),
        disable_split: true,
      });
    } catch (error) {
      throw asProviderError(error, 'route the payment to the provider');
    }
  }

  async fetchSplitSettlement(reference: string, vendorIds: string[]): Promise<SplitSettlementState> {
    try {
      const details = await cashfree<{ vendors?: { vendor_id: string; settlement_id?: unknown }[] }>(
        'GET',
        `/easy-split/orders/${encodeURIComponent(reference)}`,
      );
      const settled = new Set(
        (details.vendors ?? [])
          .filter((vendor) => vendor.settlement_id !== null && vendor.settlement_id !== undefined)
          .map((vendor) => vendor.vendor_id),
      );
      return { settledVendorIds: vendorIds.filter((id) => settled.has(id)) };
    } catch (error) {
      // Not settled into the split ledger yet — nothing to report.
      if (error instanceof CashfreeHttpError && error.status === 404) return { settledVendorIds: [] };
      throw asProviderError(error, 'check the settlement');
    }
  }

  async cancelMandate(reference: string): Promise<void> {
    try {
      await cashfree('POST', `/subscriptions/${encodeURIComponent(reference)}/manage`, {
        subscription_id: reference,
        action: 'CANCEL',
      });
    } catch (error) {
      throw asProviderError(error, 'cancel autopay');
    }
  }
}
