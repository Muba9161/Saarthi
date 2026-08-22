import { z } from 'zod';
import {
  MediaModerationStatus,
  MediaOwnerType,
  MediaPurpose,
  MediaVisibility,
} from '../domain/enums';
import { MediaVariant } from '../domain/media';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  optionalTrimmedString,
  paginationSchema,
  uuidSchema,
} from './common';

/**
 * Media validation.
 *
 * Upload metadata arrives as multipart *fields*, so every value is a string on
 * the wire and has to be coerced. The file itself is validated by magic bytes in
 * the service, never by anything the client asserts here.
 */

export const mediaOwnerTypeSchema = z.nativeEnum(MediaOwnerType);
export const mediaPurposeSchema = z.nativeEnum(MediaPurpose);
export const mediaVisibilitySchema = z.nativeEnum(MediaVisibility);
export const mediaVariantSchema = z.nativeEnum(MediaVariant).default(MediaVariant.ORIGINAL);

export const uploadMediaMetadataSchema = z.object({
  ownerType: mediaOwnerTypeSchema,
  ownerId: uuidSchema,
  purpose: mediaPurposeSchema.default(MediaPurpose.GALLERY),
  visibility: mediaVisibilitySchema.optional(),
  altText: optionalTrimmedString(300),
  caption: optionalTrimmedString(500),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  /** Sets this asset as the primary one for its owner and purpose. */
  isPrimary: z.coerce.boolean().optional(),
  /** Where the photo was taken, when the device offered it. */
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  capturedAt: z.coerce.date().optional(),
  /** Intrinsic pixel size the client measured; re-derived server-side. */
  width: z.coerce.number().int().min(1).max(20_000).optional(),
  height: z.coerce.number().int().min(1).max(20_000).optional(),
});
export type UploadMediaMetadata = z.infer<typeof uploadMediaMetadataSchema>;

export const updateMediaSchema = z.object({
  altText: optionalTrimmedString(300),
  caption: optionalTrimmedString(500),
  sortOrder: z.number().int().min(0).max(999).optional(),
  visibility: mediaVisibilitySchema.optional(),
});
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export const mediaListQuerySchema = paginationSchema.extend({
  ownerType: mediaOwnerTypeSchema.optional(),
  ownerId: uuidSchema.optional(),
  purpose: csvEnum([
    MediaPurpose.AVATAR,
    MediaPurpose.LOGO,
    MediaPurpose.COVER,
    MediaPurpose.GALLERY,
    MediaPurpose.PRODUCT,
    MediaPurpose.VEHICLE_EXTERIOR,
    MediaPurpose.VEHICLE_INTERIOR,
    MediaPurpose.VEHICLE_DAMAGE,
    MediaPurpose.ODOMETER,
    MediaPurpose.PROOF_OF_PICKUP,
    MediaPurpose.PROOF_OF_DELIVERY,
    MediaPurpose.HANDOVER,
    MediaPurpose.INCIDENT,
    MediaPurpose.HAZARD_EVIDENCE,
    MediaPurpose.INSPECTION,
    MediaPurpose.SIGNATURE,
    MediaPurpose.ATTACHMENT,
  ]),
  moderationStatus: z.nativeEnum(MediaModerationStatus).optional(),
  primaryOnly: z.coerce.boolean().optional(),
});
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;

export const reorderMediaSchema = z.object({
  ownerType: mediaOwnerTypeSchema,
  ownerId: uuidSchema,
  /** Asset ids in their new display order. */
  mediaIds: z.array(uuidSchema).min(1).max(100),
});
export type ReorderMediaInput = z.infer<typeof reorderMediaSchema>;

export const moderateMediaSchema = z.object({
  decision: z.enum([MediaModerationStatus.APPROVED, MediaModerationStatus.REJECTED]),
  note: optionalTrimmedString(500),
});
export type ModerateMediaInput = z.infer<typeof moderateMediaSchema>;

export const mediaFileQuerySchema = z.object({
  variant: mediaVariantSchema,
});
export type MediaFileQuery = z.infer<typeof mediaFileQuerySchema>;
