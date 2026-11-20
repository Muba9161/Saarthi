import { z } from 'zod';
import type { FestivalKey, FestiveWindow } from './calendar';
import type { FestiveKit } from './kits';

/**
 * `GET /api/v1/festive?locale=hi-IN`: everything a client without this
 * package (the Android apps) needs to dress itself for the festivals ahead.
 *
 * Public and cacheable: it carries nothing about the caller. The client picks
 * today's festival from `windows` by its own local date, with the same rule as
 * `activeWindowOn` (the festival whose day it is, then the nearest still to
 * come, then the one that passed most recently), so a device far from India
 * or offline past midnight still switches on the right day.
 */
export const festiveCalendarQuerySchema = z.object({
  locale: z.string().trim().max(16).optional(),
});
export type FestiveCalendarQuery = z.infer<typeof festiveCalendarQuerySchema>;

export interface FestiveCalendarFestival {
  key: FestivalKey;
  name: string;
  /** The wish in the requested language. */
  wish: string;
  kit: FestiveKit;
}

export interface FestiveCalendarResponse {
  /** The language the wishes are in, after resolution (`hi` → `hi-IN`). */
  locale: string;
  /** Today in India (YYYY-MM-DD), for clients that cannot read a device date. */
  today: string;
  /** "from everyone at VorldX Saarthi", in `locale`. */
  signature: string;
  /** Windows that have not ended, in calendar order. */
  windows: FestiveWindow[];
  /** One entry per festival that appears in `windows`. */
  festivals: Partial<Record<FestivalKey, FestiveCalendarFestival>>;
}
