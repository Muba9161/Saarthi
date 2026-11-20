/**
 * The festival calendar, the single source the web app, the API and the
 * Android apps all read (ported from GodWeb's festive layer, 2026-11-20).
 *
 * There is no admin page. Every festival is written here ahead of time and
 * switches itself on and off by the viewer's own local date: it shows from two
 * days before its day until the day after (both Eids one more day, because
 * their date waits for the moon sighting). Dates that move every year are
 * listed for the years ahead; `festive.test.ts` fails when fewer than twelve
 * months of dates are left, so a festival is never silently missed.
 *
 * When two windows meet (Independence Day 2027 and Raksha Bandhan two days
 * later), the festival whose own day it is wins; otherwise the festival still
 * to come wins over one that has passed.
 *
 * Sources (checked 2026-11-10 for GodWeb):
 * - 2026 and 2027: the Government of India holiday lists, DoP&T O.M. F.No.
 *   12/2/2023-JCA of 16.07.2026 (gazetted Annexure I; restricted Annexure II
 *   for New Year, Makar Sankranti, Raksha Bandhan, Ganesh Chaturthi and Onam).
 * - Later years: Drik Panchang / DekhoPanchang / Testbook (panchang dates;
 *   Janmashtami uses the Vaishnav day, as the gazetted list does) and
 *   CalendarDate / Gulf News / time.now for both Eids (astronomical
 *   predictions; the moon sighting can move them a day). Replace each with the
 *   gazetted date when that year's list is published.
 */

export const FESTIVAL_KEYS = [
  'diwali',
  'guru-nanak-jayanti',
  'christmas',
  'new-year',
  'makar-sankranti',
  'republic-day',
  'eid-al-fitr',
  'holi',
  'eid-al-adha',
  'independence-day',
  'raksha-bandhan',
  'janmashtami',
  'ganesh-chaturthi',
  'onam',
  'dussehra',
] as const;

export type FestivalKey = (typeof FESTIVAL_KEYS)[number];

export interface Festival {
  key: FestivalKey;
  /** English name, for logs, admin tooling and accessible labels. */
  name: string;
  /** The festival's own day (YYYY-MM-DD), one per year. */
  days: readonly string[];
  /** Extra days after the festival day, on top of FESTIVE_TAIL_DAYS. */
  extraTail?: number;
}

export interface FestiveWindow {
  key: FestivalKey;
  /** The festival's own day. */
  day: string;
  /** First day it shows (inclusive). */
  start: string;
  /** Last day it shows (inclusive). */
  end: string;
}

/** A festival starts showing this many days before its day… */
export const FESTIVE_LEAD_DAYS = 2;
/** …and keeps showing until this many days after it. */
export const FESTIVE_TAIL_DAYS = 1;

export const FESTIVALS: readonly Festival[] = [
  {
    key: 'diwali',
    name: 'Diwali',
    days: ['2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26'],
  },
  {
    key: 'guru-nanak-jayanti',
    name: 'Guru Nanak Jayanti',
    days: ['2026-11-24', '2027-11-14', '2028-11-02'],
  },
  {
    key: 'christmas',
    name: 'Christmas',
    days: ['2026-12-25', '2027-12-25', '2028-12-25', '2029-12-25', '2030-12-25'],
  },
  {
    key: 'new-year',
    name: 'New Year',
    days: ['2027-01-01', '2028-01-01', '2029-01-01', '2030-01-01', '2031-01-01'],
  },
  // Pongal is the next day (15 Jan 2027), inside the same window.
  {
    key: 'makar-sankranti',
    name: 'Makar Sankranti and Pongal',
    days: ['2027-01-14', '2028-01-15'],
  },
  {
    key: 'republic-day',
    name: 'Republic Day',
    days: ['2027-01-26', '2028-01-26', '2029-01-26', '2030-01-26', '2031-01-26'],
  },
  {
    key: 'eid-al-fitr',
    name: 'Eid al-Fitr',
    days: ['2027-03-10', '2028-02-27', '2029-02-15', '2030-02-05'],
    extraTail: 1,
  },
  { key: 'holi', name: 'Holi', days: ['2027-03-23', '2028-03-11', '2029-03-01', '2030-03-20'] },
  {
    key: 'eid-al-adha',
    name: 'Eid al-Adha',
    days: ['2027-05-17', '2028-05-05', '2029-04-24', '2030-04-13'],
    extraTail: 1,
  },
  {
    key: 'independence-day',
    name: 'Independence Day',
    days: ['2027-08-15', '2028-08-15', '2029-08-15', '2030-08-15'],
  },
  { key: 'raksha-bandhan', name: 'Raksha Bandhan', days: ['2027-08-17', '2028-08-04'] },
  { key: 'janmashtami', name: 'Janmashtami', days: ['2027-08-25', '2028-08-13'] },
  { key: 'ganesh-chaturthi', name: 'Ganesh Chaturthi', days: ['2027-09-04', '2028-08-23'] },
  { key: 'onam', name: 'Onam', days: ['2027-09-12', '2028-09-01'] },
  { key: 'dussehra', name: 'Dussehra', days: ['2027-10-09', '2028-09-27'] },
];

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYmd(ymd: string): [number, number, number] {
  const match = YMD.exec(ymd);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${ymd}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** `ymd` moved by whole days (calendar arithmetic, no time zone involved). */
export function shiftDay(ymd: string, days: number): string {
  const [year, month, day] = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The viewer's own calendar day, YYYY-MM-DD, in the device's time zone. */
export function localYmd(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whether `value` names a festival in this calendar. */
export function isFestivalKey(value: unknown): value is FestivalKey {
  return typeof value === 'string' && (FESTIVAL_KEYS as readonly string[]).includes(value);
}

/** Every showing window, in calendar order. */
export function festiveWindows(festivals: readonly Festival[] = FESTIVALS): FestiveWindow[] {
  const windows: FestiveWindow[] = [];
  for (const festival of festivals) {
    for (const day of festival.days) {
      windows.push({
        key: festival.key,
        day,
        start: shiftDay(day, -FESTIVE_LEAD_DAYS),
        end: shiftDay(day, FESTIVE_TAIL_DAYS + (festival.extraTail ?? 0)),
      });
    }
  }
  return windows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * Which of two windows that both cover a date shows: the festival whose day it
 * is; else the nearest festival still to come; else the one that passed most
 * recently.
 */
function showsBefore(a: FestiveWindow, b: FestiveWindow, ymd: string): boolean {
  const rank = (window: FestiveWindow) => (window.day === ymd ? 0 : window.day > ymd ? 1 : 2);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb;
  return ra === 1 ? a.day < b.day : a.day > b.day;
}

/** The window showing on `ymd`, or null. */
export function activeWindowOn(
  ymd: string,
  windows: readonly FestiveWindow[] = festiveWindows(),
): FestiveWindow | null {
  let best: FestiveWindow | null = null;
  for (const window of windows) {
    if (ymd < window.start || ymd > window.end) continue;
    if (!best || showsBefore(window, best, ymd)) best = window;
  }
  return best;
}

/** The festival showing on `ymd`, or null. */
export function activeFestivalOn(
  ymd: string,
  windows: readonly FestiveWindow[] = festiveWindows(),
): FestivalKey | null {
  return activeWindowOn(ymd, windows)?.key ?? null;
}

/**
 * The windows still worth sending to a client on `today`: those that have not
 * ended, with a day's slack either side so a device whose clock or time zone
 * is a day off still sees the right festival.
 */
export function upcomingFestiveWindows(
  today: string,
  windows: readonly FestiveWindow[] = festiveWindows(),
): FestiveWindow[] {
  const from = shiftDay(today, -1);
  return windows.filter((window) => window.end >= from);
}

/** Milliseconds until the next local midnight (plus a second), for the day check. */
export function msUntilNextLocalDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}
