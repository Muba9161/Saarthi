import {
  FESTIVALS,
  FESTIVE_KITS,
  festiveSignature,
  festiveWish,
  resolveLocale,
  upcomingFestiveWindows,
  type FestiveCalendarFestival,
  type FestiveCalendarResponse,
  type FestivalKey,
} from '@saarthi/shared';

/** Today's calendar date in India, YYYY-MM-DD. */
export function indiaYmd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The festive calendar for a client that does not ship `@saarthi/shared`.
 * Pure: the same inputs always give the same answer, which is what lets the
 * route mark it cacheable.
 */
export function festiveCalendar(
  locale: string | undefined,
  now: Date = new Date(),
): FestiveCalendarResponse {
  const resolved = resolveLocale(locale ?? null);
  const today = indiaYmd(now);
  const windows = upcomingFestiveWindows(today);

  const festivals: Partial<Record<FestivalKey, FestiveCalendarFestival>> = {};
  for (const window of windows) {
    if (festivals[window.key]) continue;
    const festival = FESTIVALS.find((entry) => entry.key === window.key);
    if (!festival) continue;
    festivals[window.key] = {
      key: window.key,
      name: festival.name,
      wish: festiveWish(window.key, resolved),
      kit: FESTIVE_KITS[window.key],
    };
  }

  return {
    locale: resolved,
    today,
    signature: festiveSignature(resolved),
    windows,
    festivals,
  };
}
