import {
  PaymentPurpose,
  PaymentStatus,
  VERIFICATION_CHECK_LABELS,
  VerificationChargeStatus,
  describeSubscriptionPayment,
  formatCurrency,
  type BillingHistoryEntry,
  type BillingHistoryView,
  type BillingPaymentStatus,
  type VerificationCheckType,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { AuditAction } from '../audit/audit.service';
import { billingStatus } from './autopay.service';

/**
 * The account's billing history: every payment it made to Saarthi, and the
 * events that shaped its plan, newest first — with what happens next on top.
 *
 * Read from what is already recorded. Payments are the `payments` rows — the
 * plan (autopay and months paid by hand), extra vehicles, trackers and
 * verification fees; marketplace orders and travel bookings have their own
 * screens and are not billing. Events come from the audit trail: autopay set
 * up, confirmed by the bank, stopped; a failed autopay charge, which moves no
 * money and so leaves no payment row; a vehicle slot or tracker given up.
 */

const HISTORY_LIMIT = 200;

function paymentStatus(status: string): BillingPaymentStatus {
  switch (status) {
    case PaymentStatus.SUCCEEDED:
      return 'PAID';
    case PaymentStatus.REFUNDED:
    case PaymentStatus.PARTIALLY_REFUNDED:
      return 'REFUNDED';
    case PaymentStatus.FAILED:
    case PaymentStatus.CANCELLED:
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function inrDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const VERIFICATION_OUTCOME: Partial<Record<VerificationChargeStatus, string>> = {
  [VerificationChargeStatus.VERIFIED]: 'Verified',
  [VerificationChargeStatus.FAILED]: 'Not verified',
  [VerificationChargeStatus.RETRY_REQUIRED]: 'Not completed — retry is free',
  [VerificationChargeStatus.VERIFYING]: 'Verifying',
};

/** One audit row as a history event, or null for a change the customer need not see. */
function auditEvent(row: {
  id: string;
  action: string;
  createdAt: Date;
  afterData: unknown;
}): BillingHistoryEntry | null {
  const after = (row.afterData ?? {}) as Record<string, unknown>;
  const base = {
    id: `event:${row.id}`,
    at: row.createdAt.toISOString(),
    kind: 'EVENT' as const,
    category: 'ACCOUNT' as const,
    amount: null,
    status: null,
    reference: typeof after.reference === 'string' ? after.reference : null,
  };

  if (row.action === AuditAction.SUBSCRIPTION_TOPUP_CANCELLED) {
    return { ...base, category: 'ADD_ONS', title: 'Extra vehicle cancelled', detail: null };
  }
  if (row.action === AuditAction.SUBSCRIPTION_TRACKER_RETIRED) {
    return { ...base, category: 'ADD_ONS', title: 'Tracker retired', detail: null };
  }
  if (row.action !== AuditAction.SUBSCRIPTION_CHANGED) return null;

  if (after.autopayCharge === 'FAILED') {
    return {
      ...base,
      kind: 'PAYMENT',
      category: 'PLAN',
      title: 'Monthly plan — autopay',
      detail: typeof after.reason === 'string' && after.reason ? after.reason : 'The payment did not go through.',
      amount: typeof after.amount === 'number' ? after.amount : null,
      status: 'FAILED',
    };
  }
  if (after.autopay === 'CANCELLED') {
    return { ...base, title: 'Autopay cancelled', detail: 'Payments are no longer taken automatically.' };
  }
  if (typeof after.autopay === 'string') {
    const firstCharge = typeof after.firstChargeAt === 'string' ? new Date(after.firstChargeAt) : null;
    const monthly = typeof after.monthlyAmount === 'number' ? after.monthlyAmount : null;
    return {
      ...base,
      title: 'Autopay set up',
      detail: [
        firstCharge ? `First charge on ${inrDate(firstCharge)}` : null,
        monthly !== null ? `${formatCurrency(monthly)} a month` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    };
  }
  switch (after.autopayStatus) {
    case 'ACTIVE':
      return { ...base, title: 'Autopay confirmed by your bank', detail: null };
    case 'ON_HOLD':
      return { ...base, title: 'Autopay on hold', detail: 'Your bank has paused the mandate.' };
    case 'CANCELLED':
      return { ...base, title: 'Autopay stopped', detail: 'The mandate was cancelled at the bank or Cashfree.' };
    case 'FAILED':
      return { ...base, title: 'Autopay could not be set up', detail: 'The bank did not authorise the mandate.' };
    default:
      return null;
  }
}

export async function billingHistory(organizationId: string): Promise<BillingHistoryView> {
  const [organization, status, payments, audits] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { createdAt: true } }),
    billingStatus(organizationId),
    prisma.payment.findMany({
      where: {
        organizationId,
        purpose: { in: [PaymentPurpose.SUBSCRIPTION, PaymentPurpose.VERIFICATION_FEE] },
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    }),
    prisma.auditLog.findMany({
      where: {
        organizationId,
        action: {
          in: [
            AuditAction.SUBSCRIPTION_CHANGED,
            AuditAction.SUBSCRIPTION_TOPUP_CANCELLED,
            AuditAction.SUBSCRIPTION_TRACKER_RETIRED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { id: true, action: true, createdAt: true, afterData: true },
    }),
  ]);

  const verificationRefs = payments
    .filter((payment) => payment.purpose === PaymentPurpose.VERIFICATION_FEE)
    .map((payment) => payment.reference);
  const charges = verificationRefs.length
    ? await prisma.verificationCharge.findMany({
        where: { paymentReference: { in: verificationRefs } },
        select: { paymentReference: true, checkType: true, status: true, maskedNumber: true },
      })
    : [];

  const paymentEntries = payments.map((payment): BillingHistoryEntry => {
    const state = paymentStatus(payment.status);
    const at = (payment.processedAt ?? payment.createdAt).toISOString();
    const reference = payment.providerReference ?? payment.reference;
    const failure = state === 'FAILED' ? payment.failureMessage : null;

    if (payment.purpose === PaymentPurpose.VERIFICATION_FEE) {
      const charge = charges.find((entry) => entry.paymentReference === payment.reference);
      const label = charge ? VERIFICATION_CHECK_LABELS[charge.checkType as VerificationCheckType] : 'Identity';
      const outcome = charge && state === 'PAID' ? VERIFICATION_OUTCOME[charge.status as VerificationChargeStatus] : null;
      return {
        id: payment.id,
        at,
        kind: 'PAYMENT',
        category: 'VERIFICATION',
        title: `${label} verification`,
        detail: failure ?? ([charge?.maskedNumber, outcome].filter(Boolean).join(' · ') || null),
        amount: Number(payment.amount),
        status: state,
        reference,
      };
    }

    const { category, title } = describeSubscriptionPayment(payment.reference);
    return {
      id: payment.id,
      at,
      kind: 'PAYMENT',
      category,
      title,
      detail: failure,
      amount: Number(payment.amount),
      status: state,
      reference,
    };
  });

  const eventEntries = audits.flatMap((row) => {
    const entry = auditEvent(row);
    return entry ? [entry] : [];
  });

  if (organization) {
    eventEntries.push({
      id: 'event:account-created',
      at: organization.createdAt.toISOString(),
      kind: 'EVENT',
      category: 'ACCOUNT',
      title: 'Account created',
      detail: status ? `${status.planName} plan` : null,
      amount: null,
      status: null,
      reference: null,
    });
  }

  const entries = [...paymentEntries, ...eventEntries].sort((a, b) => b.at.localeCompare(a.at));

  // What happens next, from the plan's own state.
  const upcoming: BillingHistoryEntry[] = [];
  if (status?.billable) {
    const autopayLive = status.autopay !== null && ['ACTIVE', 'PENDING', 'ON_HOLD'].includes(status.autopay.status);
    if (status.trialEndsAt) {
      upcoming.push({
        id: 'upcoming:trial-end',
        at: status.trialEndsAt,
        kind: 'EVENT',
        category: 'PLAN',
        title: 'Free trial ends',
        detail: autopayLive
          ? `Autopay then charges ${formatCurrency(status.monthlyTotal)} a month.`
          : `Set up autopay, or pay ${formatCurrency(status.monthlyTotal)}, to keep your plan.`,
        amount: autopayLive ? status.monthlyTotal : null,
        status: null,
        reference: null,
      });
    } else if (status.periodEndsAt && autopayLive) {
      upcoming.push({
        id: 'upcoming:next-charge',
        at: status.periodEndsAt,
        kind: 'EVENT',
        category: 'PLAN',
        title: 'Next autopay charge',
        detail: null,
        amount: status.monthlyTotal,
        status: null,
        reference: null,
      });
    }
  }

  return { upcoming, entries: entries.slice(0, HISTORY_LIMIT) };
}
