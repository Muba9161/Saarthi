import { z } from 'zod';
import { isPlausibleIndianLicence, normalizeLicenceNumber } from '../domain/driving-licence';

/**
 * Driving licence lookup contracts.
 *
 * The licence number is normalised on the way in, so `DL-04 2011 0149646` and
 * `DL0420110149646` are one licence: one cache entry and one billable lookup
 * rather than two.
 */

export const lookupLicenceNumberSchema = z
  .string({ required_error: 'Enter a driving licence number.' })
  .transform((value) => normalizeLicenceNumber(value))
  .pipe(
    z
      .string()
      .min(8, 'Enter a valid driving licence number.')
      .max(20, 'Enter a valid driving licence number.'),
  )
  .refine(
    (value) => isPlausibleIndianLicence(value),
    'That does not look like an Indian driving licence number. Check it and try again.',
  );

/**
 * The provider verifies a licence *against* a date of birth — it is a second
 * factor, not a nicety, which is what stops the endpoint being a way to look up
 * a stranger from a number seen on a photocopy.
 */
export const licenceLookupSchema = z.object({
  licenceNumber: lookupLicenceNumberSchema,
  dateOfBirth: z.coerce.date({
    required_error: "Enter the licence holder's date of birth.",
    invalid_type_error: 'Enter a valid date of birth.',
  }),
  /** Bypass the stored record and pay for a fresh provider call. */
  refresh: z.boolean().default(false),
});
export type LicenceLookupInput = z.infer<typeof licenceLookupSchema>;

/** Reading back an already-fetched record costs nothing and needs only the number. */
export const storedLicenceQuerySchema = z.object({
  licenceNumber: lookupLicenceNumberSchema,
});
export type StoredLicenceQuery = z.infer<typeof storedLicenceQuerySchema>;
