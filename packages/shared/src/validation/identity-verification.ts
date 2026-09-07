import { z } from 'zod';
import { IdentityDocumentKind, VerificationSubjectType } from '../domain/enums';
import {
  identityFormatMessage,
  isValidIdentityNumber,
  normalizeIdentityNumber,
} from '../domain/identity-verification';
import { optionalTrimmedString, uuidSchema } from './common';

/**
 * Identity verification contracts.
 *
 * Every number is normalised on the way in and then held to its own checksum,
 * so `1234 5678 9012` and `123456789012` are one Aadhaar — one stored answer
 * and one billable call rather than two — and a mistyped digit is refused here
 * instead of being paid for and reported as "not found".
 *
 * The refinement runs *before* the request reaches a service, which is what
 * makes the local check free: nothing that fails it is ever sent upstream.
 */

/** A normalised, checksum-valid number for one kind. */
const identityNumberSchema = (kind: IdentityDocumentKind) =>
  z
    .string({ required_error: 'Enter the number printed on the document.' })
    .transform((value) => normalizeIdentityNumber(value))
    .pipe(z.string().min(6, 'Enter the full number.').max(24, 'That number is too long.'))
    .refine((value) => isValidIdentityNumber(kind, value), identityFormatMessage(kind));

export const aadhaarNumberSchema = identityNumberSchema(IdentityDocumentKind.AADHAAR);
export const panNumberSchema = identityNumberSchema(IdentityDocumentKind.PAN);
export const voterIdNumberSchema = identityNumberSchema(IdentityDocumentKind.VOTER_ID);
export const gstinSchema = identityNumberSchema(IdentityDocumentKind.GST);

/**
 * Fields shared by every verify request.
 *
 * `documentId` links the check to the upload it was started from, which is what
 * lets the document row show a verified badge instead of a Verify button. It is
 * optional because a number can also be verified before any file exists.
 */
const verifyBaseSchema = z.object({
  subjectId: uuidSchema,
  /** The uploaded document this check backs, when it was started from one. */
  documentId: uuidSchema.optional(),
  /** Bypass the stored answer and pay for a fresh provider call. */
  refresh: z.boolean().default(false),
});

/**
 * Aadhaar.
 *
 * `linkedPan` is optional and is what turns this from a checksum into a real
 * online verification — see `AADHAAR_ONLINE_LIMITATION`. Without it the answer
 * is honestly reported as unconfirmed rather than dressed up as verified.
 */
export const verifyAadhaarSchema = verifyBaseSchema.extend({
  kind: z.literal(IdentityDocumentKind.AADHAAR),
  subjectType: z.literal(VerificationSubjectType.DRIVER),
  number: aadhaarNumberSchema,
  linkedPan: panNumberSchema.optional().or(z.literal('').transform(() => undefined)),
});
export type VerifyAadhaarInput = z.infer<typeof verifyAadhaarSchema>;

/**
 * PAN.
 *
 * `holderName` is optional: the department confirms the PAN either way, but
 * supplying the name turns "this PAN exists" into "this PAN belongs to the
 * person you are onboarding", which is the question a fleet actually has.
 */
export const verifyPanSchema = verifyBaseSchema.extend({
  kind: z.literal(IdentityDocumentKind.PAN),
  subjectType: z.literal(VerificationSubjectType.DRIVER),
  number: panNumberSchema,
  holderName: optionalTrimmedString(120),
});
export type VerifyPanInput = z.infer<typeof verifyPanSchema>;

export const verifyVoterIdSchema = verifyBaseSchema.extend({
  kind: z.literal(IdentityDocumentKind.VOTER_ID),
  subjectType: z.literal(VerificationSubjectType.DRIVER),
  number: voterIdNumberSchema,
});
export type VerifyVoterIdInput = z.infer<typeof verifyVoterIdSchema>;

export const verifyGstSchema = verifyBaseSchema.extend({
  kind: z.literal(IdentityDocumentKind.GST),
  subjectType: z.literal(VerificationSubjectType.ORGANIZATION),
  number: gstinSchema,
});
export type VerifyGstInput = z.infer<typeof verifyGstSchema>;

/**
 * The one endpoint body, discriminated on `kind`.
 *
 * A single route rather than four keeps the client simple — the document panel
 * posts whatever the row's document type maps to — while each branch still gets
 * its own number rules and its own required second factor.
 */
export const verifyIdentitySchema = z.discriminatedUnion('kind', [
  verifyAadhaarSchema,
  verifyPanSchema,
  verifyVoterIdSchema,
  verifyGstSchema,
]);
export type VerifyIdentityInput = z.infer<typeof verifyIdentitySchema>;

/** Reading back the checks already stored for one subject. Free. */
export const identitySubjectParamsSchema = z.object({
  subjectType: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.nativeEnum(VerificationSubjectType)),
  subjectId: uuidSchema,
});
export type IdentitySubjectParams = z.infer<typeof identitySubjectParamsSchema>;

export const identityListQuerySchema = z.object({
  kind: z.nativeEnum(IdentityDocumentKind).optional(),
  /** Only the checks backing this uploaded document. */
  documentId: uuidSchema.optional(),
});
export type IdentityListQuery = z.infer<typeof identityListQuerySchema>;
