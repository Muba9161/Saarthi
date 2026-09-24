import { z } from 'zod';
import { VerificationCheckType, VerificationSubjectType } from '../domain/enums';
import { uuidSchema } from './common';
import {
  verifyAadhaarSchema,
  verifyGstSchema,
  verifyPanSchema,
  verifyVoterIdSchema,
} from './identity-verification';
import { registryVerifySchema } from './documents';

/**
 * Pay & Verify.
 *
 * One body for every billable check, discriminated on `kind`. The identity
 * branches are the existing verify schemas unchanged, so a number is held to
 * the same checksum rules whether it is paid for or not — and a number that
 * fails them is refused before any payment is opened.
 *
 * Nothing about price or payment is accepted from the client: the amount comes
 * from the server's pricing, the outcome from the gateway.
 */

const drivingLicenceCheckSchema = registryVerifySchema.extend({
  kind: z.literal(VerificationCheckType.DRIVING_LICENCE),
  subjectType: z.literal(VerificationSubjectType.DRIVER),
  subjectId: uuidSchema,
});

const vehicleRcCheckSchema = z.object({
  kind: z.literal(VerificationCheckType.VEHICLE_RC),
  subjectType: z.literal(VerificationSubjectType.TRUCK),
  subjectId: uuidSchema,
  refresh: z.boolean().default(false),
});

export const startVerificationSchema = z.discriminatedUnion('kind', [
  verifyAadhaarSchema,
  verifyPanSchema,
  verifyVoterIdSchema,
  verifyGstSchema,
  drivingLicenceCheckSchema,
  vehicleRcCheckSchema,
]);
export type StartVerificationInput = z.infer<typeof startVerificationSchema>;
export type RegistryCheckInput =
  | z.infer<typeof drivingLicenceCheckSchema>
  | z.infer<typeof vehicleRcCheckSchema>;

export const verificationChargeParamsSchema = z.object({ id: uuidSchema });

/** The verification centre for the caller's own account, or for one driver. */
export const verificationCenterQuerySchema = z.object({
  driverId: uuidSchema.optional(),
});
export type VerificationCenterQuery = z.infer<typeof verificationCenterQuerySchema>;
