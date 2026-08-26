import { z } from 'zod';
import { trimmedString } from './common';

/**
 * How a person likes a list presented.
 *
 * The surface key is owned by the client: the server has no opinion about which
 * screens exist, and hard-coding an enum here would mean a new list could not
 * remember a preference until the API shipped too.
 */

export const viewModeSchema = z.enum(['TABLE', 'CARDS']);
export type ViewMode = z.infer<typeof viewModeSchema>;

/** Dotted, lowercase, e.g. "fleet.vehicles". Bounded so it cannot be abused. */
export const viewSurfaceSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/, 'A surface key looks like "fleet.vehicles".');

export const updateViewPreferenceSchema = z.object({
  viewMode: viewModeSchema.optional(),
  hiddenColumns: z.array(trimmedString(1, 48)).max(40).optional(),
  pageSize: z.coerce.number().int().min(5).max(200).optional(),
  sortKey: z.string().trim().max(48).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});
export type UpdateViewPreferenceInput = z.infer<typeof updateViewPreferenceSchema>;

export interface ViewPreference {
  surface: string;
  viewMode: ViewMode;
  hiddenColumns: string[];
  pageSize: number | null;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc' | null;
}
