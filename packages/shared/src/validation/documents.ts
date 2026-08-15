import { z } from 'zod';
import {
  DocumentOwnerType,
  DocumentVerificationStatus,
  VerificationStatus,
  VerificationSubjectType,
} from '../domain/enums';
import { DOCUMENT_TYPE_CODES } from '../domain/documents';
import { csvEnum, optionalTrimmedString, paginationSchema, trimmedString, uuidSchema } from './common';

/**
 * Document and verification contracts.
 *
 * Upload metadata arrives as multipart fields, so every value is coerced from
 * a string. The file itself is validated separately against magic bytes.
 */

export const documentTypeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .refine(
    (value) => DOCUMENT_TYPE_CODES.includes(value),
    'That document type is not recognised.',
  );

export const uploadDocumentMetadataSchema = z.object({
  ownerType: z.nativeEnum(DocumentOwnerType),
  ownerId: uuidSchema,
  documentType: documentTypeSchema,
  documentNumber: optionalTrimmedString(80),
  title: optionalTrimmedString(160),
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
});
export type UploadDocumentMetadata = z.infer<typeof uploadDocumentMetadataSchema>;

export const updateDocumentSchema = z.object({
  documentNumber: optionalTrimmedString(80),
  title: optionalTrimmedString(160),
  issueDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const reviewDocumentSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED', 'UNDER_REVIEW']),
    rejectionReason: optionalTrimmedString(500),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'REJECTED' && !value.rejectionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: 'Explain why the document was rejected so it can be corrected.',
      });
    }
  });
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;

export const documentListQuerySchema = paginationSchema.extend({
  ownerType: z.nativeEnum(DocumentOwnerType).optional(),
  ownerId: uuidSchema.optional(),
  documentType: optionalTrimmedString(60),
  verificationStatus: csvEnum([
    DocumentVerificationStatus.PENDING_VERIFICATION,
    DocumentVerificationStatus.UNDER_REVIEW,
    DocumentVerificationStatus.VERIFIED,
    DocumentVerificationStatus.REJECTED,
  ]),
  /** Derived filter across expiry maths and review state. */
  validity: csvEnum(['VALID', 'EXPIRING_SOON', 'EXPIRED', 'PENDING_VERIFICATION', 'REJECTED', 'NO_EXPIRY']),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  search: optionalTrimmedString(120),
  sortBy: z.enum(['createdAt', 'expiryDate', 'documentType']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

// ---------------------------------------------------------------------------
// Verification cases
// ---------------------------------------------------------------------------

export const submitVerificationSchema = z.object({
  subjectType: z.nativeEnum(VerificationSubjectType),
  subjectId: uuidSchema,
  note: optionalTrimmedString(1000),
});
export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>;

export const reviewVerificationSchema = z
  .object({
    decision: z.enum(['VERIFIED', 'REJECTED', 'UNDER_REVIEW', 'CORRECTION_REQUESTED']),
    reviewerNotes: optionalTrimmedString(1000),
    rejectionReason: optionalTrimmedString(500),
  })
  .superRefine((value, ctx) => {
    if (
      (value.decision === 'REJECTED' || value.decision === 'CORRECTION_REQUESTED') &&
      !value.rejectionReason
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReason'],
        message: 'Explain what needs to change so the applicant can fix it.',
      });
    }
  });
export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;

export const verificationListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    VerificationStatus.PENDING,
    VerificationStatus.SUBMITTED,
    VerificationStatus.UNDER_REVIEW,
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.EXPIRED,
    VerificationStatus.SUSPENDED,
  ]),
  subjectType: csvEnum([
    VerificationSubjectType.USER,
    VerificationSubjectType.DRIVER,
    VerificationSubjectType.TRUCK,
    VerificationSubjectType.ORGANIZATION,
  ]),
  search: optionalTrimmedString(120),
});
export type VerificationListQuery = z.infer<typeof verificationListQuerySchema>;

export const documentIdParamSchema = z.object({ id: uuidSchema });

export const notificationListQuerySchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const markNotificationsSchema = z.object({
  notificationIds: z.array(uuidSchema).min(1).max(200),
});
export type MarkNotificationsInput = z.infer<typeof markNotificationsSchema>;

export const organizationUpdateSchema = z.object({
  name: trimmedString(2, 160).optional(),
  registrationNumber: optionalTrimmedString(60),
  taxNumber: optionalTrimmedString(40),
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  phone: optionalTrimmedString(20),
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(80),
  state: optionalTrimmedString(80),
  postalCode: optionalTrimmedString(12),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  description: optionalTrimmedString(2000),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;
