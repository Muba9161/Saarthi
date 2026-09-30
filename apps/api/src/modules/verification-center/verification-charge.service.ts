import { randomBytes } from 'node:crypto';
import {
  Feature,
  NotificationPriority,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  Permission,
  RoleName,
  VERIFICATION_CHECK_LABELS,
  VerificationChargeStatus,
  VerificationCheckType,
  VerificationStepState,
  VerificationSubjectType,
  hasPermission,
  identityKindForCheckType,
  startVerificationSchema,
  stepStateForCharge,
  type StartVerificationInput,
  type StartVerificationResult,
  type VerificationChargeView,
} from '@saarthi/shared';
import { buildAuthContext } from '../../auth/session.service';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { decryptIdentityNumber, encryptIdentityNumber } from '../../lib/identity-crypto';
import { PreflightPassed, preflightGate } from '../../lib/provider-call-gate';
import { paymentProvider } from '../../providers/payments';
import { hasFeature } from '../../server/guards';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyAsync } from '../notifications/notification.service';
import {
  openPayment,
  registerSettlementHandler,
  settlePayment,
  type SettledPayment,
} from '../payments/payment-settlement.service';
import { requireActivePrice, type ActivePrice } from './verification-pricing.service';
import { describeNumber, runVerificationCheck, type CheckRunOutcome } from './verification-runner';
import type { AuthContext } from '../../auth/context';

/**
 * Pay & Verify.
 *
 * The customer pays Saarthi — through the existing Cashfree payment flow, as a
 * `VERIFICATION_FEE` payment — and only once the gateway confirms the money
 * does Saarthi make the billable provider call. The sequence is:
 *
 *   1. Preflight. The check runs through its own module up to the provider
 *      gate, so scoping, the checksum rules and "already verified" are all
 *      settled for free. A check that needs no billable call is answered here
 *      and nothing is charged.
 *   2. Charge + payment. A `verification_charges` row snapshots the price, then
 *      `openPayment` writes the `payments` row and hands it to the gateway.
 *   3. Settlement. The existing settlement service decides the payment from the
 *      gateway's own records — by webhook or when the payer returns — and calls
 *      the handler registered here exactly once.
 *   4. Execution. PAID → VERIFYING is a conditional update, so however many
 *      webhooks, retries and returning browsers race, one provider call is
 *      made. The answer is persisted by the owning module before the charge is
 *      marked VERIFIED — which is the only state the UI celebrates.
 *
 * Failure policy: a definite answer the provider billed for (not found, a
 * mismatch) consumes the attempt. Saarthi failing to get an answer at all —
 * a timeout, an outage — leaves the charge RETRY_REQUIRED, and the next attempt
 * at the same check reuses it without a second payment. No automatic refunds.
 */

const chargeLogger = logger.child({ module: 'verification-charges' });

type ChargeRow = Prisma.VerificationChargeGetPayload<Record<string, never>>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function toChargeView(row: ChargeRow): VerificationChargeView {
  return {
    id: row.id,
    checkType: row.checkType as VerificationCheckType,
    subjectType: row.subjectType as VerificationSubjectType,
    subjectId: row.subjectId,
    status: row.status as VerificationChargeStatus,
    amount: Number(row.customerPrice),
    currency: row.currency,
    paymentReference: row.paymentReference,
    maskedNumber: row.maskedNumber,
    reason: row.reason,
    freeRetryAvailable: row.status === VerificationChargeStatus.RETRY_REQUIRED,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function outcomeState(outcome: CheckRunOutcome): VerificationStepState {
  if (outcome.verified) return VerificationStepState.VERIFIED;
  if (outcome.underReview) return VerificationStepState.UNDER_REVIEW;
  return VerificationStepState.FAILED;
}

// ---------------------------------------------------------------------------
// Guards and subject details
// ---------------------------------------------------------------------------

/** The same permissions the direct verify routes require. */
function assertMayRun(auth: AuthContext, input: StartVerificationInput): void {
  if (identityKindForCheckType(input.kind)) {
    if (!auth.isPlatformAdmin && !hasPermission(auth.permissions, Permission.IDENTITY_VERIFY)) {
      throw errors.forbidden('Your role cannot run identity checks.');
    }
    if (!hasFeature(auth, Feature.DOCUMENTS_BASIC)) {
      throw errors.featureNotAvailable(Feature.DOCUMENTS_BASIC);
    }
    return;
  }
  if (!auth.isPlatformAdmin && !hasPermission(auth.permissions, Permission.VERIFICATION_SUBMIT)) {
    throw errors.forbidden('Your role cannot submit verifications.');
  }
}

/**
 * Who pays, and where the payer returns to after checkout.
 *
 * Read only after the preflight has confirmed the caller may check this
 * subject, so these lookups never disclose another tenant's records.
 */
async function payerFor(
  auth: AuthContext,
  input: StartVerificationInput,
): Promise<{ organizationId: string; returnPath: string }> {
  switch (input.subjectType) {
    case VerificationSubjectType.DRIVER: {
      const driver = await prisma.driver.findUniqueOrThrow({
        where: { id: input.subjectId },
        select: { organizationId: true },
      });
      return {
        organizationId: driver.organizationId,
        returnPath:
          auth.driverId === input.subjectId ? '/driver/documents' : `/fleet/drivers/${input.subjectId}`,
      };
    }
    case VerificationSubjectType.TRUCK: {
      const truck = await prisma.truck.findUniqueOrThrow({
        where: { id: input.subjectId },
        select: { organizationId: true },
      });
      return { organizationId: truck.organizationId, returnPath: `/fleet/vehicles/${input.subjectId}` };
    }
    case VerificationSubjectType.ORGANIZATION:
      return { organizationId: input.subjectId, returnPath: '/verification' };
    case VerificationSubjectType.USER:
    default: {
      if (!auth.organizationId) {
        throw errors.organizationRequired('Select an organization to pay the verification fee from.');
      }
      return { organizationId: auth.organizationId, returnPath: '/verification' };
    }
  }
}

/**
 * A registry check already confirmed, so Pay & Verify has nothing to sell.
 *
 * The identity kinds answer this themselves (their stored-answer cache), which
 * is why only the licence and the RC are asked here. `refresh` is an explicit
 * request to check again and is charged.
 */
async function registryAlreadyVerified(
  auth: AuthContext,
  input: StartVerificationInput,
): Promise<boolean> {
  if (input.refresh) return false;
  // Answers only for the caller's own driver or vehicle. For anyone else's it
  // says "no" and lets the check's own tenant preflight refuse — otherwise this
  // shortcut, which runs first, told any caller whether any id was verified.
  const ours = (organizationId: string) =>
    auth.isPlatformAdmin || organizationId === auth.organizationId;

  if (input.kind === VerificationCheckType.DRIVING_LICENCE) {
    const driver = await prisma.driver.findUnique({
      where: { id: input.subjectId },
      select: { licenceVerifiedAt: true, organizationId: true },
    });
    if (!driver || (!ours(driver.organizationId) && auth.driverId !== input.subjectId)) return false;
    return Boolean(driver.licenceVerifiedAt);
  }
  if (input.kind === VerificationCheckType.VEHICLE_RC) {
    const truck = await prisma.truck.findUnique({
      where: { id: input.subjectId },
      select: { verificationStatus: true, organizationId: true },
    });
    if (!truck || !ours(truck.organizationId)) return false;
    return truck.verificationStatus === 'VERIFIED';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Stored request
// ---------------------------------------------------------------------------

/** The request, encrypted, so a webhook can run the check after checkout. */
function sealRequest(input: StartVerificationInput): string | null {
  return encryptIdentityNumber(JSON.stringify(input));
}

function openRequest(envelope: string | null): StartVerificationInput | null {
  const json = decryptIdentityNumber(envelope);
  if (!json) return null;
  const parsed = startVerificationSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

function newReference(): string {
  return `VF-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function priceSnapshot(price: ActivePrice) {
  return {
    customerPrice: price.customerPrice,
    currency: price.currency,
    provider: price.provider,
    providerCost: price.providerCost,
    providerCostCurrency: price.providerCostCurrency,
    pricingVersion: price.pricingVersion,
  };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export async function startVerification(
  auth: AuthContext,
  input: StartVerificationInput,
): Promise<StartVerificationResult> {
  assertMayRun(auth, input);
  const label = VERIFICATION_CHECK_LABELS[input.kind];

  // --- Preflight -----------------------------------------------------------
  if (await registryAlreadyVerified(auth, input)) {
    return {
      mode: 'ALREADY_VERIFIED',
      charge: null,
      checkout: null,
      state: VerificationStepState.VERIFIED,
      message: `${label} is already verified.`,
      detail: null,
    };
  }

  try {
    const outcome = await runVerificationCheck(auth, input, preflightGate);
    // Finished without reaching the gate: no billable call was needed.
    return {
      mode: outcome.alreadyVerified ? 'ALREADY_VERIFIED' : 'COMPLETED_FREE',
      charge: null,
      checkout: null,
      state: outcomeState(outcome),
      message: outcome.alreadyVerified ? `${label} is already verified.` : outcome.reason,
      detail: outcome.detail,
    };
  } catch (error) {
    if (!(error instanceof PreflightPassed)) throw error;
  }

  const price = await requireActivePrice(input.kind);
  const payer = await payerFor(auth, input);
  const { maskedNumber, numberHash } = describeNumber(input);
  const scope = {
    checkType: input.kind,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    organizationId: payer.organizationId,
  };

  // --- A check already paid for and running --------------------------------
  const running = await prisma.verificationCharge.findFirst({
    where: {
      ...scope,
      status: { in: [VerificationChargeStatus.PAID, VerificationChargeStatus.VERIFYING] },
    },
  });
  if (running) {
    return {
      mode: 'COMPLETED',
      charge: toChargeView(running),
      checkout: null,
      state: VerificationStepState.VERIFYING,
      message: `${label} is being verified.`,
      detail: null,
    };
  }

  // --- A free retry --------------------------------------------------------
  const credit = await prisma.verificationCharge.findFirst({
    where: { ...scope, status: VerificationChargeStatus.RETRY_REQUIRED },
    orderBy: { createdAt: 'asc' },
  });
  if (credit) {
    const claimed = await prisma.verificationCharge.updateMany({
      where: { id: credit.id, status: VerificationChargeStatus.RETRY_REQUIRED },
      data: {
        status: VerificationChargeStatus.PAID,
        maskedNumber,
        numberHash,
        reason: null,
        consumedAt: new Date(),
        requestedById: auth.user.id,
      },
    });
    if (claimed.count === 1) {
      chargeLogger.info({ chargeId: credit.id, checkType: input.kind }, 'Free retry claimed');
      const done = await executeCharge(credit.id, input);
      return completedResult(done.row, label, done.detail);
    }
  }

  // --- An open checkout for the same check ---------------------------------
  const open = await prisma.verificationCharge.findFirst({
    where: { ...scope, status: VerificationChargeStatus.PAYMENT_PROCESSING },
    orderBy: { createdAt: 'desc' },
  });
  const openPaymentRow = open
    ? await prisma.payment.findUnique({ where: { reference: open.paymentReference } })
    : null;
  if (open && !openPaymentRow) {
    // The charge was written but the payment never was — nothing to resume.
    await markPaymentFailed(open.id, 'The payment was not started.');
  } else if (open && openPaymentRow) {
    // Paid since, with the payer never returning: settling runs the check.
    if ((await settlePayment(open.paymentReference)) === PaymentStatus.SUCCEEDED) {
      const settled = await prisma.verificationCharge.findUniqueOrThrow({ where: { id: open.id } });
      return completedResult(settled, label);
    }
    // Still payable, and for the same number: resume rather than open a
    // second order that could be paid as well.
    if (open.numberHash === numberHash) {
      const resumed = await paymentProvider.resumeCheckout(
        openPaymentRow.providerReference ?? openPaymentRow.reference,
      );
      if (resumed) {
        return {
          mode: 'CHECKOUT',
          charge: toChargeView(open),
          checkout: resumed,
          state: VerificationStepState.PAYMENT_PROCESSING,
          message: null,
          detail: null,
        };
      }
    }
  }

  // --- A new payment -------------------------------------------------------
  const sealed = sealRequest(input);
  if (!sealed && !paymentProvider.settlesSynchronously) {
    // A hosted checkout confirms later, by webhook, so the request has to be
    // held until then — and it carries identity numbers, which are only ever
    // held encrypted.
    chargeLogger.error(
      'IDENTITY_ENCRYPTION_KEY is not set — paid verification cannot hold the request until checkout completes.',
    );
    throw errors.providerNotConfigured(
      'verification',
      'Paid verification is not available on this environment right now.',
    );
  }

  const reference = newReference();
  const charge = await prisma.verificationCharge.create({
    data: {
      ...scope,
      requestedById: auth.user.id,
      status: VerificationChargeStatus.PAYMENT_PROCESSING,
      paymentReference: reference,
      ...priceSnapshot(price),
      maskedNumber,
      numberHash,
      encryptedRequest: sealed,
    },
  });

  let opened: Awaited<ReturnType<typeof openPayment>>;
  try {
    opened = await openPayment({
      reference,
      purpose: PaymentPurpose.VERIFICATION_FEE,
      organizationId: payer.organizationId,
      userId: auth.user.id,
      amount: price.customerPrice,
      description: `${label} verification`,
      customer: {
        name: `${auth.user.firstName} ${auth.user.lastName}`.trim(),
        email: auth.user.email,
        phone: auth.user.phone,
      },
      returnPath: payer.returnPath,
      metadata: { verificationChargeId: charge.id, checkType: input.kind },
    });
  } catch (error) {
    await markPaymentFailed(charge.id, 'The payment could not be started.');
    throw error;
  }

  const { intent } = opened;
  if (intent.status === 'FAILED') {
    await markPaymentFailed(charge.id, intent.failureMessage ?? 'The payment was declined.');
    throw errors.businessRule(intent.failureMessage ?? 'The payment was declined. Please try again.', {
      paymentReference: reference,
    });
  }

  if (intent.status !== 'SUCCEEDED') {
    return {
      mode: 'CHECKOUT',
      charge: toChargeView(charge),
      checkout: intent.checkout,
      state: VerificationStepState.PAYMENT_PROCESSING,
      message: null,
      detail: null,
    };
  }

  // Settled in-process (the mock gateway): the request is still in hand.
  await markPaid(charge.id);
  const done = await executeCharge(charge.id, input);
  return completedResult(done.row, label, done.detail);
}

function completedResult(row: ChargeRow, label: string, detail: unknown = null): StartVerificationResult {
  const status = row.status as VerificationChargeStatus;
  return {
    mode: 'COMPLETED',
    charge: toChargeView(row),
    checkout: null,
    state: stepStateForCharge(status),
    message:
      status === VerificationChargeStatus.VERIFIED
        ? `${label} verified.`
        : row.reason,
    detail,
  };
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

async function markPaid(chargeId: string): Promise<boolean> {
  const moved = await prisma.verificationCharge.updateMany({
    where: {
      id: chargeId,
      status: {
        in: [VerificationChargeStatus.PAYMENT_PROCESSING, VerificationChargeStatus.PAYMENT_FAILED],
      },
    },
    data: { status: VerificationChargeStatus.PAID, paidAt: new Date() },
  });
  return moved.count === 1;
}

async function markPaymentFailed(chargeId: string, reason: string): Promise<void> {
  await prisma.verificationCharge.updateMany({
    where: { id: chargeId, status: VerificationChargeStatus.PAYMENT_PROCESSING },
    data: {
      status: VerificationChargeStatus.PAYMENT_FAILED,
      reason,
      completedAt: new Date(),
    },
  });
}

async function onFeeSucceeded(payment: SettledPayment): Promise<void> {
  const charge = await prisma.verificationCharge.findUnique({
    where: { paymentReference: payment.reference },
  });
  if (!charge) {
    chargeLogger.error({ reference: payment.reference }, 'Verification fee paid with no charge on record');
    return;
  }
  if (await markPaid(charge.id)) await executeCharge(charge.id);
}

registerSettlementHandler(PaymentPurpose.VERIFICATION_FEE, {
  onSucceeded: onFeeSucceeded,
  onFailed: async (payment, message) => {
    const charge = await prisma.verificationCharge.findUnique({
      where: { paymentReference: payment.reference },
      select: { id: true },
    });
    // The provider is never called for an unpaid charge.
    if (charge) await markPaymentFailed(charge.id, message);
  },
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

interface ExecutedCharge {
  row: ChargeRow;
  /** The owning module's reply, when the check ran in this call. */
  detail: unknown;
}

/**
 * Run the paid check, once.
 *
 * Never throws: whatever happens is recorded on the charge, so a webhook is
 * acknowledged rather than retried into a second provider call.
 */
export async function executeCharge(
  chargeId: string,
  inMemoryRequest?: StartVerificationInput,
): Promise<ExecutedCharge> {
  const claimed = await prisma.verificationCharge.updateMany({
    where: { id: chargeId, status: VerificationChargeStatus.PAID },
    data: { status: VerificationChargeStatus.VERIFYING },
  });
  const charge = await prisma.verificationCharge.findUniqueOrThrow({ where: { id: chargeId } });
  // Somebody else is running it, or it already ran.
  if (claimed.count === 0) return { row: charge, detail: null };

  const input = inMemoryRequest ?? openRequest(charge.encryptedRequest);
  if (!input) {
    return {
      row: await finish(charge, {
        status: VerificationChargeStatus.RETRY_REQUIRED,
        providerBilled: false,
        reason:
          'The details for this check could not be recovered. Enter them again — your fee is kept and the retry is free.',
      }),
      detail: null,
    };
  }

  try {
    const auth = await buildAuthContext(
      charge.requestedById,
      `verification-charge:${charge.id}`,
      charge.organizationId,
    );
    // The payment is confirmed, so the gate lets the billable call through.
    const outcome = await runVerificationCheck(auth, input, async () => {});

    const row = await finish(charge, {
      // A definite answer the provider billed for consumes the attempt. One
      // reached without a provider call cost Saarthi nothing, so it does not.
      status: outcome.verified
        ? VerificationChargeStatus.VERIFIED
        : outcome.providerBilled
          ? VerificationChargeStatus.FAILED
          : VerificationChargeStatus.RETRY_REQUIRED,
      providerBilled: outcome.providerBilled,
      providerReference: outcome.providerReference,
      resultId: outcome.resultId,
      maskedNumber: outcome.maskedNumber,
      reason: outcome.verified ? null : outcome.reason,
    });
    return { row, detail: outcome.detail };
  } catch (error) {
    // No answer at all — a timeout, an outage, an exhausted allowance. The
    // provider did not bill for an answer it never gave.
    chargeLogger.warn(
      { chargeId: charge.id, checkType: charge.checkType, err: error },
      'Paid verification could not reach an answer; free retry granted',
    );
    const message = error instanceof Error && 'expected' in error ? error.message : null;
    const row = await finish(charge, {
      status: VerificationChargeStatus.RETRY_REQUIRED,
      providerBilled: false,
      reason: `${message ?? 'The verification service did not respond.'} Your fee is kept — try again at no charge.`,
    });
    return { row, detail: null };
  }
}

async function finish(
  charge: ChargeRow,
  result: {
    status: VerificationChargeStatus;
    providerBilled: boolean;
    reason: string | null;
    providerReference?: string | null;
    resultId?: string | null;
    maskedNumber?: string | null;
  },
): Promise<ChargeRow> {
  const updated = await prisma.verificationCharge.update({
    where: { id: charge.id },
    data: {
      status: result.status,
      providerBilled: result.providerBilled,
      reason: result.reason,
      providerReference: result.providerReference ?? null,
      resultId: result.resultId ?? null,
      maskedNumber: result.maskedNumber ?? charge.maskedNumber,
      // The request has done its job; the number is not kept on the charge.
      encryptedRequest: null,
      completedAt: new Date(),
    },
  });

  await recordAudit({
    action: AuditAction.VERIFICATION_CHARGE_COMPLETED,
    entityType: 'VerificationCharge',
    entityId: updated.id,
    actorUserId: updated.requestedById,
    organizationId: updated.organizationId,
    after: {
      checkType: updated.checkType,
      subjectType: updated.subjectType,
      subjectId: updated.subjectId,
      status: updated.status,
      providerBilled: updated.providerBilled,
      provider: updated.provider,
      pricingVersion: updated.pricingVersion,
      paymentReference: updated.paymentReference,
      providerReference: updated.providerReference,
    },
  });

  if (result.status === VerificationChargeStatus.RETRY_REQUIRED) {
    notifyAsync({
      userId: updated.requestedById,
      organizationId: updated.organizationId,
      type: NotificationType.VERIFICATION_RESULT,
      title: `${VERIFICATION_CHECK_LABELS[updated.checkType as VerificationCheckType]} check could not be completed`,
      body: 'Your verification fee is kept. Try the check again at no extra charge.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/verification',
    });
  }

  chargeLogger.info(
    { chargeId: updated.id, checkType: updated.checkType, status: updated.status },
    'Paid verification completed',
  );
  return updated;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Drivers see their own attempts; managers see their organization's. */
function historyScope(auth: AuthContext): Prisma.VerificationChargeWhereInput {
  if (auth.isPlatformAdmin && !auth.organizationId) return {};
  if (!auth.organizationId) throw errors.organizationRequired();
  const ownOnly = auth.organization?.membershipRole === RoleName.DRIVER;
  return {
    organizationId: auth.organizationId,
    ...(ownOnly ? { requestedById: auth.user.id } : {}),
  };
}

export async function getCharge(auth: AuthContext, chargeId: string): Promise<VerificationChargeView> {
  const row = await prisma.verificationCharge.findFirst({
    where: { id: chargeId, ...historyScope(auth) },
  });
  if (!row) throw errors.notFound('Verification');
  return toChargeView(row);
}

export async function listVerificationHistory(auth: AuthContext): Promise<VerificationChargeView[]> {
  const rows = await prisma.verificationCharge.findMany({
    where: historyScope(auth),
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(toChargeView);
}

/** The latest attempt for each (subject, check) pair asked about. */
export async function latestChargesFor(
  organizationId: string | null,
  subjects: { subjectType: VerificationSubjectType; subjectId: string }[],
): Promise<ChargeRow[]> {
  if (!organizationId || subjects.length === 0) return [];
  return prisma.verificationCharge.findMany({
    where: {
      organizationId,
      OR: subjects.map((subject) => ({
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
      })),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Charges that stopped moving.
 *
 *  • A checkout whose webhook never arrived is settled from the gateway.
 *  • A paid charge the webhook recorded but never ran is run now.
 *  • A run interrupted mid-way cannot be told apart from one the provider
 *    billed, and is given the benefit of the doubt: a free retry.
 */
export async function runVerificationChargeSweep(): Promise<void> {
  const now = Date.now();

  const unsettled = await prisma.verificationCharge.findMany({
    where: {
      status: VerificationChargeStatus.PAYMENT_PROCESSING,
      createdAt: { lt: new Date(now - 10 * 60_000), gt: new Date(now - 2 * 86_400_000) },
    },
    select: { paymentReference: true },
    take: 50,
  });
  for (const row of unsettled) {
    try {
      const payment = await prisma.payment.findUnique({
        where: { reference: row.paymentReference },
        select: { id: true },
      });
      if (!payment) {
        await prisma.verificationCharge.updateMany({
          where: { paymentReference: row.paymentReference, status: VerificationChargeStatus.PAYMENT_PROCESSING },
          data: { status: VerificationChargeStatus.PAYMENT_FAILED, reason: 'The payment was not started.' },
        });
        continue;
      }
      await settlePayment(row.paymentReference);
    } catch (error) {
      chargeLogger.warn({ reference: row.paymentReference, err: error }, 'Verification fee could not be reconciled');
    }
  }

  const paid = await prisma.verificationCharge.findMany({
    where: { status: VerificationChargeStatus.PAID, updatedAt: { lt: new Date(now - 5 * 60_000) } },
    select: { id: true },
    take: 50,
  });
  for (const row of paid) await executeCharge(row.id);

  const stuck = await prisma.verificationCharge.updateMany({
    where: {
      status: VerificationChargeStatus.VERIFYING,
      updatedAt: { lt: new Date(now - 15 * 60_000) },
    },
    data: {
      status: VerificationChargeStatus.RETRY_REQUIRED,
      reason: 'The check was interrupted. Your fee is kept — try again at no charge.',
      encryptedRequest: null,
      completedAt: new Date(),
    },
  });
  if (stuck.count > 0) chargeLogger.warn({ count: stuck.count }, 'Interrupted verifications released for free retry');
}
