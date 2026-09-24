/**
 * An account's billing history — every payment it made to Saarthi and the
 * events that shaped its plan, newest first.
 *
 * Built from records that already exist (the `payments` rows and the audit
 * trail), so the history is the same money the ledger and reconciliation see.
 */

export const BillingHistoryCategory = {
  /** The plan itself — autopay charges and months paid by hand. */
  PLAN: 'PLAN',
  /** Extra vehicles and trackers, at signup or later. */
  ADD_ONS: 'ADD_ONS',
  /** Pay & Verify fees. */
  VERIFICATION: 'VERIFICATION',
  /** Trial, autopay and other account events — no money moved. */
  ACCOUNT: 'ACCOUNT',
} as const;
export type BillingHistoryCategory = (typeof BillingHistoryCategory)[keyof typeof BillingHistoryCategory];

export const BILLING_HISTORY_CATEGORY_LABELS: Record<BillingHistoryCategory, string> = {
  PLAN: 'Plan',
  ADD_ONS: 'Vehicles & trackers',
  VERIFICATION: 'Verification',
  ACCOUNT: 'Account',
};

export type BillingPaymentStatus = 'PAID' | 'FAILED' | 'PENDING' | 'REFUNDED';

export interface BillingHistoryEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: 'PAYMENT' | 'EVENT';
  category: BillingHistoryCategory;
  title: string;
  detail: string | null;
  /** INR. Null for an event. */
  amount: number | null;
  status: BillingPaymentStatus | null;
  /** The Cashfree (or Saarthi) reference, for a support query. */
  reference: string | null;
}

export interface BillingHistoryView {
  /** What will happen next — the trial ending, the next autopay charge. */
  upcoming: BillingHistoryEntry[];
  entries: BillingHistoryEntry[];
}

/**
 * What a subscription payment was for, read from its reference.
 *
 * Every subscription payment is opened with a fixed prefix by the service that
 * sells it, which makes the prefix the one fact about a charge that is always
 * present — including on autopay charges, which carry no other metadata.
 */
export function describeSubscriptionPayment(reference: string): {
  category: BillingHistoryCategory;
  title: string;
} {
  if (reference.startsWith('AUTOPAY-')) return { category: 'PLAN', title: 'Monthly plan — autopay' };
  if (reference.startsWith('PLAN-')) return { category: 'PLAN', title: 'Monthly plan' };
  if (reference.startsWith('TOPUP-')) return { category: 'ADD_ONS', title: 'Extra vehicle' };
  if (reference.startsWith('TRACKER-')) return { category: 'ADD_ONS', title: 'Tracker' };
  if (reference.startsWith('VEHICLE-')) return { category: 'ADD_ONS', title: 'New vehicle — slot and tracker' };
  if (reference.startsWith('SIGNUP-')) return { category: 'ADD_ONS', title: 'Extras ordered at signup' };
  if (reference.startsWith('ADDON-')) return { category: 'ADD_ONS', title: 'Extra vehicles and trackers' };
  return { category: 'PLAN', title: 'Subscription payment' };
}
