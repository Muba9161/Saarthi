/**
 * Selling Saarthi — referral codes, commission arithmetic and the onboarding
 * checklist, shared by the API and the client.
 *
 * The division of ownership this file assumes, stated once because everything
 * in it follows from it:
 *
 *   * **GODWeb owns who a salesperson is.** Saarthi holds a mirror of that
 *     identity and never mints one.
 *   * **Saarthi owns the sale.** Leads, attribution, subscriptions, payments,
 *     commission and tracker custody are Saarthi records.
 *   * **The existing tracker, Driver App, vehicle pairing, OBD and telemetry
 *     systems are the technical source of truth.** Nothing here connects a
 *     vehicle; the onboarding checklist below only *reads* what they already
 *     know, so a "✓ telemetry received" tick is evidence rather than an
 *     assertion.
 */

import {
  CommissionStatus,
  CommissionType,
  ReferralSource,
  SalesLeadStatus,
  SalesmanStatus,
  TrackerHandoverStatus,
} from './enums';

// ---------------------------------------------------------------------------
// GODID and referral codes
// ---------------------------------------------------------------------------

/**
 * The shape of a GODID.
 *
 * Permissive on purpose: GODWeb owns the format and may widen it, and a
 * Saarthi-side regex that is stricter than the real thing rejects legitimate
 * salespeople with no way for them to appeal. This exists to keep obvious
 * rubbish out of a provider call and out of a URL — it is emphatically not a
 * substitute for verification, which only GODWeb can give.
 */
export const GODID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,31}$/;

export const GODID_MAX_LENGTH = 32;

/**
 * Normalise a typed GODID.
 *
 * Upper-cased and stripped of spaces, because it arrives from a phone keyboard
 * as often as from a copy-paste, and `god-7f42k` and `GOD 7F42K` are the same
 * identity written by two different people.
 */
export function normalizeGodId(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

/** Whether a string could be a GODID at all. Says nothing about whether it is one. */
export function isPlausibleGodId(value: string): boolean {
  const normalized = normalizeGodId(value);
  return normalized.length <= GODID_MAX_LENGTH && GODID_PATTERN.test(normalized);
}

/**
 * The referral code that goes in a link and a QR.
 *
 * It *is* the GODID, deliberately. A second opaque code would have to be
 * mapped back to a salesperson on every capture, and the failure mode of that
 * mapping — a code that resolves to the wrong person — is a misdirected
 * commission. Using the identity itself means there is nothing to get wrong,
 * and it makes the link legible to the salesperson sharing it, who can read
 * their own GODID in the URL and see that it is theirs.
 *
 * It is not a secret and is not treated as one: the code decides *credit*, and
 * nothing else. Following a link grants no access, reveals nothing about the
 * salesperson beyond a display name, and — because the backend re-resolves and
 * re-verifies the code at registration — a fabricated one attributes nothing.
 */
export function referralCodeForGodId(godId: string): string {
  return normalizeGodId(godId);
}

/** The path a referral link points at, relative to the app's origin. */
export function referralPath(code: string): string {
  return `/r/${encodeURIComponent(referralCodeForGodId(code))}`;
}

/**
 * The absolute referral URL.
 *
 * Built from a base the caller supplies rather than a constant, for the same
 * reason a QR code's target is: a link generated in development has to be
 * followable from the phone that scanned it, and one generated in production
 * has to carry the canonical Saarthi host for years. The API passes
 * `publicAppUrl(request)`, which resolves that.
 */
export function referralUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, '')}${referralPath(code)}`;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Sources that can create an attribution without a salesperson present.
 *
 * A manually typed GODID is here and PHYSICAL is not, because the two are
 * trusted differently: a physical sale is recorded by an authenticated
 * salesperson acting on their own profile, while a manual GODID is a string
 * somebody typed into a form and has to be resolved and verified before it
 * means anything.
 */
export const SELF_SERVICE_REFERRAL_SOURCES: readonly ReferralSource[] = Object.freeze([
  ReferralSource.REFERRAL_LINK,
  ReferralSource.REFERRAL_QR,
  ReferralSource.MANUAL_GODID,
]);

/**
 * Whether an attribution is still the one that counts.
 *
 * "First valid attribution wins" is the rule, and this is what makes it
 * enforceable: a live attribution blocks a later one, and only a window that
 * has run out or an administrator's revocation clears the field.
 */
export function attributionIsLive(status: string): boolean {
  return status === 'CAPTURED' || status === 'ATTRIBUTED' || status === 'CONVERTED';
}

/**
 * When a captured referral stops counting.
 *
 * The duration is configuration — see `SALES_ATTRIBUTION_WINDOW_DAYS` — and is
 * returned to the client alongside every referral so no screen has to guess
 * it and no salesperson has to be told a number nobody wrote down.
 */
export function attributionExpiresAt(capturedAt: Date, windowDays: number): Date {
  return new Date(capturedAt.getTime() + windowDays * 86_400_000);
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

/**
 * A commission rule, as both sides of the wire see it.
 *
 * There is no default rule anywhere in this codebase and no rate constant.
 * Commission is a commercial agreement between Saarthi and its salespeople,
 * and a plausible-looking number invented in a shared library is one somebody
 * would eventually be paid on.
 */
export interface CommissionRuleTerms {
  commissionType: CommissionType;
  /** Percentage points, e.g. `7.5` for 7.5%. Set for PERCENTAGE rules. */
  commissionRate: number | null;
  /** Rupees per qualifying sale. Set for FIXED rules. */
  fixedAmount: number | null;
}

export interface CommissionComputation {
  /** Null when the terms cannot produce a figure. Never silently zero. */
  amount: number | null;
  /** The rate actually applied, carried onto the commission row. */
  rate: number | null;
  /** Why there is no amount, for the row's note and the screen. */
  reason: string | null;
}

/**
 * Turn a qualifying payment into a commission amount.
 *
 * Rounded to paise rather than to rupees. Commission on a ₹1,499 subscription
 * at 7.5% is ₹112.425, and rounding that to ₹112 at computation time loses
 * money on every sale in a way nobody can reconcile later; the payout run can
 * round the total once, where the discrepancy is visible.
 *
 * Returns a null amount rather than throwing, because the caller is a payment
 * webhook: a rule that has not been configured yet must leave a commission row
 * behind for somebody to look at, not lose the sale.
 */
export function computeCommission(
  terms: CommissionRuleTerms,
  baseAmount: number,
): CommissionComputation {
  if (!Number.isFinite(baseAmount) || baseAmount < 0) {
    return { amount: null, rate: null, reason: 'The qualifying amount is not a valid figure.' };
  }

  if (terms.commissionType === CommissionType.FIXED) {
    if (terms.fixedAmount === null || !Number.isFinite(terms.fixedAmount)) {
      return {
        amount: null,
        rate: null,
        reason: 'This rule is a fixed-amount rule but carries no amount.',
      };
    }
    return { amount: round2(terms.fixedAmount), rate: null, reason: null };
  }

  if (terms.commissionRate === null || !Number.isFinite(terms.commissionRate)) {
    return {
      amount: null,
      rate: null,
      reason: 'This rule is a percentage rule but carries no rate.',
    };
  }

  return {
    amount: round2((baseAmount * terms.commissionRate) / 100),
    rate: terms.commissionRate,
    reason: null,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Statuses whose amounts a salesperson is still waiting on. */
export const PENDING_COMMISSION_STATUSES: readonly CommissionStatus[] = Object.freeze([
  CommissionStatus.PENDING,
]);

/** Approved but not yet in a payout run. */
export const APPROVED_COMMISSION_STATUSES: readonly CommissionStatus[] = Object.freeze([
  CommissionStatus.APPROVED,
  CommissionStatus.PAYABLE,
]);

/** Statuses that owe the salesperson nothing further. */
export const CLOSED_COMMISSION_STATUSES: readonly CommissionStatus[] = Object.freeze([
  CommissionStatus.PAID,
  CommissionStatus.REVERSED,
  CommissionStatus.REJECTED,
]);

/**
 * Commission transitions, as the API enforces them.
 *
 * PENDING cannot jump to PAID. The gap is not bureaucracy: APPROVED is where a
 * human confirmed the amount, and PAYABLE is where a payout run picked it up,
 * so a payment that arrives without either has no record of who authorised it.
 */
export const COMMISSION_TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  [CommissionStatus.PENDING]: [
    CommissionStatus.APPROVED,
    CommissionStatus.REJECTED,
    CommissionStatus.REVERSED,
  ],
  [CommissionStatus.APPROVED]: [
    CommissionStatus.PAYABLE,
    CommissionStatus.REVERSED,
    CommissionStatus.REJECTED,
  ],
  [CommissionStatus.PAYABLE]: [CommissionStatus.PAID, CommissionStatus.REVERSED],
  // Terminal. A commission that was paid and then charged back is corrected by
  // a reversal row of its own, not by rewriting the row that was paid.
  [CommissionStatus.PAID]: [],
  [CommissionStatus.REVERSED]: [],
  [CommissionStatus.REJECTED]: [],
};

export function canTransitionCommission(
  from: CommissionStatus,
  to: CommissionStatus,
): boolean {
  return (COMMISSION_TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// Tracker custody
// ---------------------------------------------------------------------------

export const TRACKER_HANDOVER_TRANSITIONS: Record<
  TrackerHandoverStatus,
  readonly TrackerHandoverStatus[]
> = {
  [TrackerHandoverStatus.ASSIGNED_TO_SALESMAN]: [
    TrackerHandoverStatus.HANDED_TO_CUSTOMER,
    TrackerHandoverStatus.RETURNED,
    TrackerHandoverStatus.LOST,
  ],
  [TrackerHandoverStatus.HANDED_TO_CUSTOMER]: [
    TrackerHandoverStatus.INSTALLED,
    // A unit that would not fit, or would not talk, comes back.
    TrackerHandoverStatus.RETURNED,
    TrackerHandoverStatus.LOST,
  ],
  [TrackerHandoverStatus.INSTALLED]: [TrackerHandoverStatus.RETURNED],
  [TrackerHandoverStatus.RETURNED]: [TrackerHandoverStatus.ASSIGNED_TO_SALESMAN],
  [TrackerHandoverStatus.LOST]: [],
};

export function canTransitionHandover(
  from: TrackerHandoverStatus,
  to: TrackerHandoverStatus,
): boolean {
  return (TRACKER_HANDOVER_TRANSITIONS[from] ?? []).includes(to);
}

// ---------------------------------------------------------------------------
// First-vehicle demonstration
// ---------------------------------------------------------------------------

/**
 * The six things a salesperson shows an owner on their first vehicle.
 *
 * Every one is answered by querying a system that already exists — the tracker
 * purchase, the device assignment, the device's own heartbeat, its readings.
 * None of them is a checkbox somebody ticks, and that is the whole design: the
 * screen is a mirror held up to the platform, so "✓ Telemetry received" means
 * a row arrived, and a step that cannot be confirmed stays unconfirmed and
 * says why.
 */
export const ONBOARDING_STEPS = Object.freeze([
  'TRACKER_CONNECTED',
  'VEHICLE_CONNECTED',
  'DRIVER_APP_CONNECTED',
  'OBD_CONNECTED',
  'TELEMETRY_RECEIVED',
  'VISIBLE_IN_SAARTHI',
] as const);

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_LABEL: Record<OnboardingStep, string> = {
  TRACKER_CONNECTED: 'Tracker connected',
  VEHICLE_CONNECTED: 'Vehicle connected',
  DRIVER_APP_CONNECTED: 'Driver App connected',
  OBD_CONNECTED: 'OBD connected',
  TELEMETRY_RECEIVED: 'Telemetry received',
  VISIBLE_IN_SAARTHI: 'Vehicle visible in Saarthi',
};

/**
 * What Saarthi can say about one step right now.
 *
 * `UNKNOWN` is a first-class answer rather than a failure. A vehicle whose
 * tracker has not reported since the salesperson plugged it in two minutes ago
 * is not a vehicle whose OBD has failed, and reporting the second would send
 * somebody to check a cable that is fine.
 */
export type OnboardingStepState = 'CONFIRMED' | 'PENDING' | 'UNKNOWN';

export interface OnboardingStepResult {
  step: OnboardingStep;
  label: string;
  state: OnboardingStepState;
  /** What was actually observed, in the salesperson's language. */
  detail: string;
  /** When the evidence was recorded, where there is a timestamp for it. */
  observedAt: string | null;
}

export interface OnboardingReadiness {
  vehicleId: string;
  registrationNumber: string;
  steps: OnboardingStepResult[];
  /** True only when every step is CONFIRMED. */
  complete: boolean;
  completedAt: string | null;
}

/** Whether a readiness report clears the bar for completing onboarding. */
export function onboardingIsComplete(steps: readonly OnboardingStepResult[]): boolean {
  return (
    steps.length === ONBOARDING_STEPS.length &&
    steps.every((step) => step.state === 'CONFIRMED')
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const SALESMAN_STATUS_LABEL: Record<SalesmanStatus, string> = {
  [SalesmanStatus.PENDING_VERIFICATION]: 'Awaiting GODID verification',
  [SalesmanStatus.ACTIVE]: 'Active',
  [SalesmanStatus.SUSPENDED]: 'Suspended',
  [SalesmanStatus.REJECTED]: 'GODID not recognised',
};

export const SALES_LEAD_STATUS_LABEL: Record<SalesLeadStatus, string> = {
  [SalesLeadStatus.NEW]: 'New',
  [SalesLeadStatus.CONTACTED]: 'Contacted',
  [SalesLeadStatus.DEMO_SCHEDULED]: 'Demo scheduled',
  [SalesLeadStatus.DEMO_COMPLETED]: 'Demo completed',
  [SalesLeadStatus.INTERESTED]: 'Interested',
  [SalesLeadStatus.SIGNUP_PENDING]: 'Signup pending',
  [SalesLeadStatus.PAYMENT_PENDING]: 'Payment pending',
  [SalesLeadStatus.SUBSCRIBED]: 'Subscribed',
  [SalesLeadStatus.TRACKER_PENDING]: 'Tracker pending',
  [SalesLeadStatus.ONBOARDING]: 'Onboarding',
  [SalesLeadStatus.ACTIVATED]: 'Activated',
  [SalesLeadStatus.LOST]: 'Lost',
  [SalesLeadStatus.CANCELLED]: 'Cancelled',
  [SalesLeadStatus.DISQUALIFIED]: 'Disqualified',
};

/**
 * Only a verified, active salesperson has a referral link.
 *
 * The check is shared so the screen that hides the Share button and the API
 * that refuses to mint the link cannot disagree about who has one.
 */
export function canShareReferral(status: SalesmanStatus): boolean {
  return status === SalesmanStatus.ACTIVE;
}
