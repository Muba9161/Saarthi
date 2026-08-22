import { z } from 'zod';
import { isPlausibleIndianRegistration } from '../domain/vehicle-rc';
import { PETROL_FUEL_FILTERS } from '../domain/petrol-stations';
import { normalizeRegistrationNumber } from '../utils/format';
import { latitudeSchema, longitudeSchema, optionalTrimmedString } from './common';

/**
 * Contracts for the two external directory integrations: RC (vehicle
 * registration) lookup and the petrol-station directory.
 *
 * These are separate from `validation/vehicles.ts` on purpose. That file
 * describes vehicles Saarthi *owns*; this one describes questions Saarthi asks
 * of an upstream provider about a registration number that may belong to
 * nobody on the platform. The trust levels, rate limits and error surfaces are
 * different, so the contracts stay apart.
 */

// ---------------------------------------------------------------------------
// Vehicle RC lookup
// ---------------------------------------------------------------------------

/**
 * A registration number bound for an upstream RTO lookup.
 *
 * Normalised first so `UP 32 AB 1234`, `up-32-ab-1234` and `UP32AB1234` are one
 * cache key rather than three, then shape-checked locally. The local check is
 * only there to avoid spending a paid provider call on obvious rubbish — the
 * provider remains the authority on whether a plate exists.
 */
export const lookupRegistrationNumberSchema = z
  .string()
  .transform((value) => normalizeRegistrationNumber(value))
  .pipe(
    z
      .string()
      .min(6, 'Enter a valid vehicle registration number.')
      .max(15, 'Enter a valid vehicle registration number.'),
  )
  .refine(
    (value) => isPlausibleIndianRegistration(value),
    'That does not look like an Indian registration number. Check it and try again.',
  );

export const vehicleLookupSchema = z.object({
  registrationNumber: lookupRegistrationNumberSchema,
  /**
   * Bypass the cached record and pay for a fresh provider call. Used when a
   * document has just been renewed and the operator needs it reflected now.
   */
  refresh: z.boolean().default(false),
});
export type VehicleLookupInput = z.infer<typeof vehicleLookupSchema>;

/** Path parameter for the stored RC PDF download. */
export const lookupIdParamSchema = z.object({
  lookupId: z.string().uuid('A valid lookup identifier is required.'),
});
export type LookupIdParam = z.infer<typeof lookupIdParamSchema>;

// ---------------------------------------------------------------------------
// Petrol stations
// ---------------------------------------------------------------------------

/**
 * Station search around a point.
 *
 * The radius is capped because the directory charges per call and a 500 km
 * request would return thousands of stations the map cannot usefully draw.
 */
export const petrolStationQuerySchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: z.coerce
    .number()
    .min(1, 'Search at least 1 km around the point.')
    .max(50, 'Search at most 50 km around the point.')
    .default(10),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  fuelType: z.enum(PETROL_FUEL_FILTERS).optional(),
  company: optionalTrimmedString(80),
});
export type PetrolStationQuery = z.infer<typeof petrolStationQuerySchema>;
