/**
 * Vehicle finance domain.
 *
 * Two rules shape everything in this module.
 *
 * 1. **Money is computed, never guessed.** The amortisation below is ordinary
 *    deterministic arithmetic; the AI layer may explain a schedule but never
 *    produces one. Rounding residue is absorbed by the final installment so the
 *    principal columns sum exactly to the amount borrowed.
 *
 * 2. **A missing fact stays missing.** An installment imported from a lender
 *    statement without a payment state resolves to `UNKNOWN`, not to `PAID` and
 *    not to `OVERDUE`. Both of those are assertions about someone's credit that
 *    Saarthi has no standing to make.
 */

import {
  EmiFrequency,
  InstallmentStatus,
  InterestType,
  LoanReminderKind,
  LoanStatus,
} from './enums';
import { MaskStrategy, masked, type MaskedValue } from './masking';

// ---------------------------------------------------------------------------
// Periods and dates
// ---------------------------------------------------------------------------

const MONTHS_PER_PERIOD: Record<EmiFrequency, number> = {
  [EmiFrequency.MONTHLY]: 1,
  [EmiFrequency.QUARTERLY]: 3,
  [EmiFrequency.HALF_YEARLY]: 6,
  [EmiFrequency.ANNUAL]: 12,
};

export function monthsPerPeriod(frequency: EmiFrequency): number {
  return MONTHS_PER_PERIOD[frequency] ?? 1;
}

export function periodsPerYear(frequency: EmiFrequency): number {
  return 12 / monthsPerPeriod(frequency);
}

/** Installments in a tenure, rounded up so a part period is still billed. */
export function installmentCount(tenureMonths: number, frequency: EmiFrequency): number {
  return Math.max(1, Math.ceil(tenureMonths / monthsPerPeriod(frequency)));
}

/**
 * Add months while keeping the day of month, clamping to the end of a short
 * month. A loan whose EMI falls on the 31st is due on the 28th in February —
 * rolling into March would silently move the whole schedule.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const shifted = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0),
  );
  const daysInTargetMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, daysInTargetMonth));
  return shifted;
}

/** Whole days between two instants, counted on UTC calendar days. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Amortisation
// ---------------------------------------------------------------------------

/** Round to paise. Every money value crossing this module goes through it. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface LoanTerms {
  /** Amount financed. Disbursed amount may be lower; EMI is on the principal. */
  principal: number;
  /** Nominal annual rate, e.g. `10.5` for 10.5% p.a. */
  annualRatePercent: number;
  interestType: InterestType;
  /** Total tenure in months, regardless of installment frequency. */
  tenureMonths: number;
  frequency: EmiFrequency;
  /** Date of the first installment. */
  firstDueDate: Date;
}

/**
 * Periodic installment amount.
 *
 * Reducing balance uses the standard annuity formula; a zero rate degrades to
 * a straight division rather than dividing by zero.
 */
export function calculateEmi(terms: LoanTerms): number {
  const n = installmentCount(terms.tenureMonths, terms.frequency);
  if (n <= 0 || terms.principal <= 0) return 0;

  if (terms.interestType === InterestType.FLAT) {
    const years = terms.tenureMonths / 12;
    const totalInterest = terms.principal * (terms.annualRatePercent / 100) * years;
    return round2((terms.principal + totalInterest) / n);
  }

  const periodicRate = terms.annualRatePercent / 100 / periodsPerYear(terms.frequency);
  if (periodicRate <= 0) return round2(terms.principal / n);

  const growth = Math.pow(1 + periodicRate, n);
  return round2((terms.principal * periodicRate * growth) / (growth - 1));
}

export interface ScheduledInstallment {
  /** 1-based position in the schedule. */
  number: number;
  dueDate: Date;
  openingBalance: number;
  principal: number;
  interest: number;
  totalDue: number;
  closingBalance: number;
}

/**
 * Full amortisation schedule.
 *
 * The final row absorbs rounding residue in both the principal and the closing
 * balance, so `sum(principal) === terms.principal` exactly and the loan closes
 * at zero rather than at ₹0.03.
 */
export function generateSchedule(terms: LoanTerms): ScheduledInstallment[] {
  const n = installmentCount(terms.tenureMonths, terms.frequency);
  if (n <= 0 || terms.principal <= 0) return [];

  const step = monthsPerPeriod(terms.frequency);
  const emi = calculateEmi(terms);
  const rows: ScheduledInstallment[] = [];

  if (terms.interestType === InterestType.FLAT) {
    const years = terms.tenureMonths / 12;
    const totalInterest = terms.principal * (terms.annualRatePercent / 100) * years;
    const perInterest = round2(totalInterest / n);
    const perPrincipal = round2(terms.principal / n);
    let balance = terms.principal;

    for (let index = 0; index < n; index += 1) {
      const last = index === n - 1;
      const principal = last ? round2(balance) : perPrincipal;
      const interest = last ? round2(totalInterest - perInterest * (n - 1)) : perInterest;
      const opening = round2(balance);
      balance = round2(balance - principal);
      rows.push({
        number: index + 1,
        dueDate: addMonthsClamped(terms.firstDueDate, index * step),
        openingBalance: opening,
        principal,
        interest,
        totalDue: round2(principal + interest),
        closingBalance: Math.max(0, balance),
      });
    }
    return rows;
  }

  const periodicRate = terms.annualRatePercent / 100 / periodsPerYear(terms.frequency);
  let balance = terms.principal;

  for (let index = 0; index < n; index += 1) {
    const last = index === n - 1;
    const opening = round2(balance);
    const interest = round2(opening * periodicRate);
    // The closing installment settles whatever remains, which is what a lender
    // actually collects — a computed EMI would leave a few paise outstanding.
    const principal = last ? opening : round2(Math.min(emi - interest, opening));
    const totalDue = round2(principal + interest);
    balance = round2(opening - principal);

    rows.push({
      number: index + 1,
      dueDate: addMonthsClamped(terms.firstDueDate, index * step),
      openingBalance: opening,
      principal,
      interest,
      totalDue,
      closingBalance: Math.max(0, balance),
    });
  }

  return rows;
}

export interface ScheduleTotals {
  installments: number;
  principal: number;
  interest: number;
  total: number;
}

export function scheduleTotals(rows: ScheduledInstallment[]): ScheduleTotals {
  return rows.reduce<ScheduleTotals>(
    (totals, row) => ({
      installments: totals.installments + 1,
      principal: round2(totals.principal + row.principal),
      interest: round2(totals.interest + row.interest),
      total: round2(totals.total + row.totalDue),
    }),
    { installments: 0, principal: 0, interest: 0, total: 0 },
  );
}

// ---------------------------------------------------------------------------
// Installment status
// ---------------------------------------------------------------------------

/** Days before the due date at which an installment becomes DUE_SOON. */
export const DEFAULT_DUE_SOON_DAYS = 4;

export interface InstallmentStatusInput {
  dueDate: Date;
  totalDue: number;
  amountPaid: number;
  /** Set when the source explicitly told us the state; overrides derivation. */
  explicitStatus?: InstallmentStatus | null;
  /** True when the source did not disclose a payment state at all. */
  sourceUnknown?: boolean;
}

/**
 * Resolve an installment's state.
 *
 * PAID / WAIVED / UNKNOWN are terminal facts and are returned as-is. Everything
 * else is derived from the due date and how much has actually been received,
 * so a schedule stays correct without a nightly job rewriting rows.
 */
export function deriveInstallmentStatus(
  input: InstallmentStatusInput,
  now: Date = new Date(),
  dueSoonDays: number = DEFAULT_DUE_SOON_DAYS,
): InstallmentStatus {
  if (
    input.explicitStatus === InstallmentStatus.PAID ||
    input.explicitStatus === InstallmentStatus.WAIVED ||
    input.explicitStatus === InstallmentStatus.UNKNOWN
  ) {
    return input.explicitStatus;
  }
  if (input.sourceUnknown) return InstallmentStatus.UNKNOWN;

  const paid = round2(input.amountPaid);
  const due = round2(input.totalDue);
  // Tolerance of one rupee: a lender rounding an EMI down should not leave a
  // fully settled installment showing as partially paid forever.
  if (paid >= due - 1) return InstallmentStatus.PAID;

  const offset = daysBetween(now, input.dueDate);
  if (paid > 0) {
    return offset < 0 ? InstallmentStatus.OVERDUE : InstallmentStatus.PARTIALLY_PAID;
  }
  if (offset < 0) return InstallmentStatus.OVERDUE;
  if (offset === 0) return InstallmentStatus.DUE_TODAY;
  if (offset <= dueSoonDays) return InstallmentStatus.DUE_SOON;
  return InstallmentStatus.UPCOMING;
}

const OPEN_STATUSES: InstallmentStatus[] = [
  InstallmentStatus.UPCOMING,
  InstallmentStatus.DUE_SOON,
  InstallmentStatus.DUE_TODAY,
  InstallmentStatus.OVERDUE,
  InstallmentStatus.PARTIALLY_PAID,
];

export function isOpenInstallment(status: InstallmentStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function isSettledInstallment(status: InstallmentStatus): boolean {
  return status === InstallmentStatus.PAID || status === InstallmentStatus.WAIVED;
}

/** Loan states in which reminders and overdue checks are meaningful. */
export function loanIsServiceable(status: LoanStatus): boolean {
  return status === LoanStatus.ACTIVE || status === LoanStatus.DEFAULTED;
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export interface ReminderOffset {
  kind: LoanReminderKind;
  /** Days relative to the due date. Negative is before, positive is after. */
  offsetDays: number;
}

/** Spec default: T-4, T-1 and a T+1 overdue check. Configurable per loan. */
export const DEFAULT_REMINDER_OFFSETS: ReminderOffset[] = [
  { kind: LoanReminderKind.ADVANCE, offsetDays: -4 },
  { kind: LoanReminderKind.IMMINENT, offsetDays: -1 },
  { kind: LoanReminderKind.OVERDUE, offsetDays: 1 },
];

export function reminderOffsets(configured?: number[] | null): ReminderOffset[] {
  if (!configured || configured.length === 0) return DEFAULT_REMINDER_OFFSETS;
  const kinds: LoanReminderKind[] = [
    LoanReminderKind.ADVANCE,
    LoanReminderKind.IMMINENT,
    LoanReminderKind.OVERDUE,
  ];
  return configured
    .slice(0, 3)
    .map((offsetDays, index) => ({ kind: kinds[index] ?? LoanReminderKind.ADVANCE, offsetDays }));
}

/** True when `now` is on or past the reminder date for this installment. */
export function reminderIsDue(dueDate: Date, offsetDays: number, now: Date = new Date()): boolean {
  return daysBetween(now, addDays(dueDate, offsetDays)) <= 0;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

// ---------------------------------------------------------------------------
// Outstanding position
// ---------------------------------------------------------------------------

export interface InstallmentPosition {
  number: number;
  dueDate: Date;
  principal: number;
  interest: number;
  totalDue: number;
  amountPaid: number;
  status: InstallmentStatus;
}

export interface LoanPosition {
  outstandingPrincipal: number;
  outstandingInterest: number;
  totalOutstanding: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  unknownInstallments: number;
  nextDueDate: Date | null;
  nextDueAmount: number | null;
  /** True when any installment's state could not be established. */
  hasUnknownState: boolean;
  /** Progress through the schedule, 0–100. */
  completionPercent: number;
}

/**
 * Aggregate a loan's live position from its installments.
 *
 * Waived rows count as settled but contribute nothing to what has been repaid,
 * and unknown rows are excluded from *both* the paid and the outstanding sides
 * while being surfaced in their own count — averaging over a gap in the data
 * would produce a number no one could defend to a lender.
 */
export function computeLoanPosition(
  installments: InstallmentPosition[],
  now: Date = new Date(),
): LoanPosition {
  let outstandingPrincipal = 0;
  let outstandingInterest = 0;
  let paid = 0;
  let remaining = 0;
  let overdue = 0;
  let overdueAmount = 0;
  let unknown = 0;
  let nextDueDate: Date | null = null;
  let nextDueAmount: number | null = null;

  for (const installment of installments) {
    if (installment.status === InstallmentStatus.UNKNOWN) {
      unknown += 1;
      continue;
    }
    if (isSettledInstallment(installment.status)) {
      paid += 1;
      continue;
    }

    remaining += 1;
    const unpaid = Math.max(0, round2(installment.totalDue - installment.amountPaid));
    // Split what is still owed in the same proportion the installment carries,
    // so a part payment reduces principal and interest together.
    const principalShare =
      installment.totalDue > 0 ? installment.principal / installment.totalDue : 1;
    outstandingPrincipal = round2(outstandingPrincipal + unpaid * principalShare);
    outstandingInterest = round2(outstandingInterest + unpaid * (1 - principalShare));

    if (installment.status === InstallmentStatus.OVERDUE) {
      overdue += 1;
      overdueAmount = round2(overdueAmount + unpaid);
    }

    if (installment.dueDate.getTime() >= startOfDay(now).getTime()) {
      if (nextDueDate === null || installment.dueDate.getTime() < nextDueDate.getTime()) {
        nextDueDate = installment.dueDate;
        nextDueAmount = unpaid;
      }
    }
  }

  // An overdue installment is the *most* pressing thing to pay, so it becomes
  // the next due date when nothing upcoming has been scheduled yet.
  if (nextDueDate === null && overdue > 0) {
    const earliestOverdue = installments
      .filter((row) => row.status === InstallmentStatus.OVERDUE)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
    if (earliestOverdue) {
      nextDueDate = earliestOverdue.dueDate;
      nextDueAmount = round2(earliestOverdue.totalDue - earliestOverdue.amountPaid);
    }
  }

  const known = paid + remaining;
  return {
    outstandingPrincipal,
    outstandingInterest,
    totalOutstanding: round2(outstandingPrincipal + outstandingInterest),
    paidInstallments: paid,
    remainingInstallments: remaining,
    overdueInstallments: overdue,
    overdueAmount,
    unknownInstallments: unknown,
    nextDueDate,
    nextDueAmount,
    hasUnknownState: unknown > 0,
    completionPercent: known === 0 ? 0 : Math.round((paid / known) * 100),
  };
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

/**
 * How much of a loan a caller may see.
 *
 * A loan number, a mandate reference and an outstanding balance are private
 * financial data. `SUMMARY` exists for surfaces such as a QR scan or an
 * association alert, which legitimately need "this vehicle is financed" without
 * any of the numbers behind it.
 */
export const LoanDisclosureLevel = {
  /** Nothing at all. */
  NONE: 'NONE',
  /** Whether finance exists, and its status. No amounts, no identifiers. */
  SUMMARY: 'SUMMARY',
  /** Amounts and schedule, identifiers masked. */
  OPERATIONAL: 'OPERATIONAL',
  /** Everything, unmasked. Owner and platform admin only. */
  FULL: 'FULL',
} as const;
export type LoanDisclosureLevel =
  (typeof LoanDisclosureLevel)[keyof typeof LoanDisclosureLevel];

export function maskLoanNumber(
  value: string | null | undefined,
  level: LoanDisclosureLevel,
): MaskedValue {
  if (level === LoanDisclosureLevel.FULL) return masked(value, MaskStrategy.NONE);
  if (level === LoanDisclosureLevel.OPERATIONAL) return masked(value, MaskStrategy.REFERENCE);
  return { value: null, masked: true };
}

export function maskMandateReference(
  value: string | null | undefined,
  level: LoanDisclosureLevel,
): MaskedValue {
  if (level === LoanDisclosureLevel.FULL) return masked(value, MaskStrategy.NONE);
  // A mandate reference can be used to trace or dispute a debit, so it is never
  // partially disclosed below owner level.
  return { value: null, masked: true };
}

export function canSeeLoanAmounts(level: LoanDisclosureLevel): boolean {
  return level === LoanDisclosureLevel.OPERATIONAL || level === LoanDisclosureLevel.FULL;
}
