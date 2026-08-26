/**
 * FASTag and toll.
 *
 * Toll is the second-largest running cost on an Indian highway fleet after
 * diesel, and unlike diesel it is spent automatically, in small amounts, at
 * places nobody was watching. That shapes everything here: the job is to make
 * spend visible after the fact and to stop a truck being turned away at a
 * barrier before it happens.
 *
 * One honesty rule runs through the module. **A balance Saarthi was never told
 * is unknown, not zero.** Third-party NETC APIs return a tag's *status* — the
 * rupee balance is held by the issuing bank and is not theirs to give — so a
 * fleet that has never recorded a balance has `null`, and every screen says so
 * rather than showing ₹0 next to a working tag.
 */

import { FastagStatus, TollPaymentMode } from './enums';
import { MaskStrategy, masked, type MaskedValue } from './masking';

// ---------------------------------------------------------------------------
// Tag health
// ---------------------------------------------------------------------------

/**
 * Default balance below which a fleet is warned.
 *
 * Set against a real crossing rather than a round number: a loaded multi-axle
 * truck pays ₹300–700 at a single national plaza, so ₹500 is roughly one more
 * barrier. Below that, the next plaza is a coin flip.
 */
export const DEFAULT_LOW_BALANCE_THRESHOLD = 500;

/** Statuses that will stop a vehicle at a plaza today. */
const BLOCKING_STATUSES: FastagStatus[] = [
  FastagStatus.BLACKLISTED,
  FastagStatus.HOTLISTED,
  FastagStatus.CLOSED,
];

export function fastagBlocksTravel(status: FastagStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

export interface FastagHealthInput {
  status: FastagStatus;
  /** `null` when nobody has reported one. Never treat as zero. */
  balance: number | null;
  balanceUpdatedAt: Date | null;
  lowBalanceThreshold: number | null;
  expiresAt: Date | null;
}

export const FastagHealth = {
  OK: 'OK',
  LOW_BALANCE: 'LOW_BALANCE',
  BLOCKED: 'BLOCKED',
  EXPIRING: 'EXPIRING',
  /** No balance on record, or the last reading is too old to rely on. */
  UNKNOWN: 'UNKNOWN',
} as const;
export type FastagHealth = (typeof FastagHealth)[keyof typeof FastagHealth];

/**
 * How stale a balance may be before it stops meaning anything.
 *
 * A tag spends by itself. A reading from a fortnight ago says what the account
 * held before an unknown number of plazas, which is not a balance — it is a
 * historical note.
 */
export const BALANCE_STALE_AFTER_DAYS = 7;

export interface FastagHealthResult {
  health: FastagHealth;
  reasons: string[];
  /** Days since the balance was last reported. `null` when never reported. */
  balanceAgeDays: number | null;
  basis: 'calculated';
}

/**
 * Assess one tag.
 *
 * Order matters: a blocked tag is reported as blocked even when its balance is
 * healthy, because money in the account does not help at a barrier that has
 * blacklisted the tag.
 */
export function resolveFastagHealth(
  input: FastagHealthInput,
  now: Date = new Date(),
): FastagHealthResult {
  const reasons: string[] = [];
  const balanceAgeDays =
    input.balanceUpdatedAt === null
      ? null
      : Math.floor((now.getTime() - input.balanceUpdatedAt.getTime()) / 86_400_000);

  if (fastagBlocksTravel(input.status)) {
    reasons.push(
      input.status === FastagStatus.BLACKLISTED
        ? 'The tag is blacklisted. Toll will be charged at double the cash rate until the issuing bank clears it.'
        : input.status === FastagStatus.HOTLISTED
          ? 'The tag is hotlisted by the issuer and will not be accepted.'
          : 'The tag is closed.',
    );
    return { health: FastagHealth.BLOCKED, reasons, balanceAgeDays, basis: 'calculated' };
  }

  if (input.status === FastagStatus.LOW_BALANCE) {
    reasons.push('The issuer reports this tag as low balance.');
    return { health: FastagHealth.LOW_BALANCE, reasons, balanceAgeDays, basis: 'calculated' };
  }

  if (input.expiresAt !== null) {
    const daysToExpiry = Math.floor((input.expiresAt.getTime() - now.getTime()) / 86_400_000);
    if (daysToExpiry <= 30) {
      reasons.push(
        daysToExpiry < 0
          ? 'The tag has expired.'
          : `The tag expires in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'}.`,
      );
      return { health: FastagHealth.EXPIRING, reasons, balanceAgeDays, basis: 'calculated' };
    }
  }

  if (input.balance === null) {
    // Not a problem, and not health either — simply not known.
    reasons.push('No balance has been recorded for this tag.');
    return { health: FastagHealth.UNKNOWN, reasons, balanceAgeDays, basis: 'calculated' };
  }

  if (balanceAgeDays !== null && balanceAgeDays > BALANCE_STALE_AFTER_DAYS) {
    reasons.push(
      `The last balance reading is ${balanceAgeDays} days old, and the tag has been paying tolls since.`,
    );
    return { health: FastagHealth.UNKNOWN, reasons, balanceAgeDays, basis: 'calculated' };
  }

  const threshold = input.lowBalanceThreshold ?? DEFAULT_LOW_BALANCE_THRESHOLD;
  if (input.balance < threshold) {
    reasons.push(
      `Balance is below ₹${threshold.toLocaleString('en-IN')} — roughly one more national plaza.`,
    );
    return { health: FastagHealth.LOW_BALANCE, reasons, balanceAgeDays, basis: 'calculated' };
  }

  return { health: FastagHealth.OK, reasons, balanceAgeDays, basis: 'calculated' };
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

export interface TollCrossing {
  amount: number;
  crossedAt: Date;
  plazaName: string;
  paymentMode: TollPaymentMode;
  vehicleId: string;
}

export interface TollSpendSummary {
  total: number;
  crossings: number;
  averagePerCrossing: number | null;
  /** Spend by payment mode — cash at a plaza is a leak worth seeing. */
  byMode: Partial<Record<TollPaymentMode, number>>;
  /** The plazas this fleet pays most at, largest first. */
  topPlazas: { plazaName: string; crossings: number; total: number }[];
  windowDays: number;
  basis: 'calculated';
}

export function summariseTollSpend(
  crossings: TollCrossing[],
  windowDays: number,
): TollSpendSummary {
  const byMode: Partial<Record<TollPaymentMode, number>> = {};
  const byPlaza = new Map<string, { crossings: number; total: number }>();
  let total = 0;

  for (const crossing of crossings) {
    total += crossing.amount;
    byMode[crossing.paymentMode] = round2((byMode[crossing.paymentMode] ?? 0) + crossing.amount);

    const plaza = byPlaza.get(crossing.plazaName) ?? { crossings: 0, total: 0 };
    plaza.crossings += 1;
    plaza.total = round2(plaza.total + crossing.amount);
    byPlaza.set(crossing.plazaName, plaza);
  }

  return {
    total: round2(total),
    crossings: crossings.length,
    averagePerCrossing: crossings.length > 0 ? round2(total / crossings.length) : null,
    byMode,
    topPlazas: [...byPlaza.entries()]
      .map(([plazaName, entry]) => ({ plazaName, ...entry }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10),
    windowDays,
    basis: 'calculated',
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------

export interface TollVarianceInput {
  /** What this vehicle actually paid on the corridor. */
  actual: number;
  /** What comparable runs on the same corridor cost. */
  comparableRuns: number[];
}

export interface TollVarianceResult {
  actual: number;
  expected: number | null;
  variance: number | null;
  variancePercent: number | null;
  /** How many comparable runs the expectation was built from. */
  sampleSize: number;
  verdict: 'NORMAL' | 'HIGH' | 'LOW' | 'INSUFFICIENT_DATA';
  basis: 'calculated';
}

/**
 * Compare one run's toll against comparable runs.
 *
 * Uses the median, not the mean: a single detour through an expressway would
 * drag an average up and make every ordinary run look cheap by comparison.
 *
 * Below three comparable runs it refuses to answer. Two data points can
 * "explain" any third, and a confident variance figure derived from them is the
 * kind of number that gets a driver accused of something.
 */
export const MIN_VARIANCE_SAMPLE = 3;

export function resolveTollVariance(input: TollVarianceInput): TollVarianceResult {
  const sample = input.comparableRuns.filter((value) => value > 0).sort((a, b) => a - b);

  if (sample.length < MIN_VARIANCE_SAMPLE) {
    return {
      actual: round2(input.actual),
      expected: null,
      variance: null,
      variancePercent: null,
      sampleSize: sample.length,
      verdict: 'INSUFFICIENT_DATA',
      basis: 'calculated',
    };
  }

  const middle = Math.floor(sample.length / 2);
  const expected =
    sample.length % 2 === 0 ? (sample[middle - 1]! + sample[middle]!) / 2 : sample[middle]!;

  const variance = round2(input.actual - expected);
  const variancePercent = expected > 0 ? Math.round((variance / expected) * 100) : null;

  return {
    actual: round2(input.actual),
    expected: round2(expected),
    variance,
    variancePercent,
    sampleSize: sample.length,
    // A 20% band: toll genuinely varies with lane, class and the odd closure.
    verdict:
      variancePercent === null
        ? 'INSUFFICIENT_DATA'
        : variancePercent > 20
          ? 'HIGH'
          : variancePercent < -20
            ? 'LOW'
            : 'NORMAL',
    basis: 'calculated',
  };
}

// ---------------------------------------------------------------------------
// Trip cost
// ---------------------------------------------------------------------------

export interface TripCostInput {
  revenue: number | null;
  fuelCost: number;
  tollCost: number;
  otherExpenses: number;
  distanceKm: number | null;
}

export interface TripCostSummary {
  revenue: number | null;
  fuelCost: number;
  tollCost: number;
  otherExpenses: number;
  totalCost: number;
  margin: number | null;
  marginPercent: number | null;
  costPerKm: number | null;
  /** Toll as a share of total cost — the figure operators rarely have. */
  tollSharePercent: number | null;
  basis: 'calculated';
}

export function summariseTripCost(input: TripCostInput): TripCostSummary {
  const totalCost = round2(input.fuelCost + input.tollCost + input.otherExpenses);
  const margin = input.revenue === null ? null : round2(input.revenue - totalCost);

  return {
    revenue: input.revenue,
    fuelCost: round2(input.fuelCost),
    tollCost: round2(input.tollCost),
    otherExpenses: round2(input.otherExpenses),
    totalCost,
    margin,
    marginPercent:
      input.revenue !== null && input.revenue > 0 && margin !== null
        ? Math.round((margin / input.revenue) * 100)
        : null,
    costPerKm:
      input.distanceKm !== null && input.distanceKm > 0
        ? round2(totalCost / input.distanceKm)
        : null,
    tollSharePercent: totalCost > 0 ? Math.round((input.tollCost / totalCost) * 100) : null,
    basis: 'calculated',
  };
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

/**
 * Mask a tag id.
 *
 * A FASTag id is a payment instrument identifier: enough to query an account,
 * dispute a deduction, or present a vehicle as someone else's at a plaza. It is
 * shown in full only to the fleet that owns it.
 */
export function maskTagId(value: string | null | undefined, full: boolean): MaskedValue {
  return masked(value, full ? MaskStrategy.NONE : MaskStrategy.LAST_FOUR);
}
