import { z } from 'zod';
import { paginationSchema, uuidSchema } from './common';
import { lookupRegistrationNumberSchema } from './vehicle-lookup';

/**
 * Asking the Saarthi team to confirm a vehicle is the account's.
 *
 * Either the account's own vehicle (`vehicleId`) or a plate another account
 * holds (`registrationNumber`), never both. The message is the request: the
 * reviewer has to know why the automatic match failed. An RC is optional and
 * arrives as the multipart file part, not here.
 */
export const ownershipReviewRequestSchema = z
  .object({
    vehicleId: uuidSchema.optional(),
    registrationNumber: lookupRegistrationNumberSchema.optional(),
    message: z
      .string()
      .trim()
      .min(20, 'Tell us in a sentence or two why this vehicle is yours.')
      .max(1000, 'Keep it under 1,000 characters.'),
  })
  .refine((input) => Boolean(input.vehicleId) !== Boolean(input.registrationNumber), {
    message: 'Name the vehicle or its registration number.',
    path: ['registrationNumber'],
  });
export type OwnershipReviewRequestInput = z.infer<typeof ownershipReviewRequestSchema>;

/** The account's latest review for a vehicle or plate. */
export const ownershipReviewLatestQuerySchema = z
  .object({
    vehicleId: uuidSchema.optional(),
    registrationNumber: lookupRegistrationNumberSchema.optional(),
  })
  .refine((input) => Boolean(input.vehicleId) !== Boolean(input.registrationNumber), {
    message: 'Name the vehicle or its registration number.',
  });

/** The reviewer's queue. */
export const ownershipReviewListQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ALL']).default('PENDING'),
});

/** The reviewer's decision. A rejection says why, because the owner reads it. */
export const ownershipReviewDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((input) => input.decision === 'APPROVED' || (input.note?.length ?? 0) >= 5, {
    message: 'Say why the request is rejected; the owner sees this.',
    path: ['note'],
  });
export type OwnershipReviewDecisionInput = z.infer<typeof ownershipReviewDecisionSchema>;
