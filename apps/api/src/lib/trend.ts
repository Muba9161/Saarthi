/**
 * Daily series for metric tiles.
 *
 * Several dashboards now draw a fortnight beside each headline figure, and
 * they must agree on what a "day" is or two tiles on the same screen will
 * bucket the same event differently. Everything here works in UTC, matching
 * the rest of the analytics module, and lays the buckets over a fixed window
 * so a quiet day arrives as a real zero rather than a missing point the client
 * would have to guess at.
 *
 * Nothing here invents data. A series is only ever as long as the window and
 * only ever holds figures counted from rows.
 */

/** One UTC day of a series. */
export interface TrendPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  value: number;
}

/** How much history a metric tile plots. */
export const TREND_WINDOW_DAYS = 14;

/** Midnight UTC on the day `date` falls in. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `YYYY-MM-DD` in UTC — the bucket key every series is grouped by. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The window's day keys, oldest first, ending today. */
export function trendDays(days: number = TREND_WINDOW_DAYS): string[] {
  const today = startOfUtcDay(new Date());
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - (days - 1 - index));
    return dayKey(day);
  });
}

/** Midnight UTC at the start of the window `trendDays` would produce. */
export function trendWindowStart(days: number = TREND_WINDOW_DAYS): Date {
  const start = startOfUtcDay(new Date());
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

/** Lays a bucket map over the window, so quiet days come back as real zeroes. */
export function toSeries(
  days: readonly string[],
  buckets: ReadonlyMap<string, number>,
  decimals = 0,
): TrendPoint[] {
  return days.map((date) => {
    const value = buckets.get(date) ?? 0;
    return { date, value: decimals > 0 ? Number(value.toFixed(decimals)) : value };
  });
}

/**
 * Groups timestamped rows into per-day counts.
 *
 * A null timestamp is skipped rather than bucketed as "now": a trip that never
 * set off has no start date, and counting it today would put activity on a day
 * it did not happen.
 */
export function countByDay<K extends string>(
  rows: readonly Record<K, Date | null>[],
  field: K,
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const at = row[field];
    if (!at) continue;
    const key = dayKey(at);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}

/** Groups timestamped rows into per-day sums of a numeric field. */
export function sumByDay<T>(
  rows: readonly T[],
  at: (row: T) => Date | null,
  amount: (row: T) => number,
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const when = at(row);
    if (!when) continue;
    const key = dayKey(when);
    buckets.set(key, (buckets.get(key) ?? 0) + amount(row));
  }
  return buckets;
}

/**
 * Counts a population backwards through the window from what it is today.
 *
 * Trucks, drivers and users have no snapshot table, but they do carry
 * `createdAt` and a soft-delete timestamp, which is enough: yesterday's
 * headcount is today's, minus anything created since, plus anything removed
 * since. Only rows that changed inside the window need to be read, so the walk
 * costs two small queries however large the population has grown.
 */
export function walkPopulationBack(
  days: readonly string[],
  currentTotal: number,
  createdAt: readonly Date[],
  removedAt: readonly Date[],
): TrendPoint[] {
  return days.map((date) => {
    // Everything that happened after this day had closed has to be undone to
    // see the headcount as it stood that evening.
    const dayEnd = new Date(`${date}T00:00:00.000Z`);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const addedSince = createdAt.reduce((count, at) => (at >= dayEnd ? count + 1 : count), 0);
    const removedSince = removedAt.reduce((count, at) => (at >= dayEnd ? count + 1 : count), 0);

    return { date, value: Math.max(0, currentTotal - addedSince + removedSince) };
  });
}
