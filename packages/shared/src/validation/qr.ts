import { z } from 'zod';
import { QrCodeStatus, QrScanPurpose, QrScope, QrSubjectType } from '../domain/enums';
import {
  csvEnum,
  latitudeSchema,
  longitudeSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * QR validation.
 *
 * The token is validated as an opaque base64url string of a fixed length rather
 * than a UUID: it is 32 random bytes, deliberately not derived from any record
 * id, so a scanner cannot walk from one subject to the next.
 */

export const qrTokenSchema = z
  .string()
  .trim()
  .min(32, 'That QR code is not valid.')
  .max(64, 'That QR code is not valid.')
  .regex(/^[A-Za-z0-9_-]+$/, 'That QR code is not valid.');

export const qrTokenParamSchema = z.object({ token: qrTokenSchema });
export type QrTokenParam = z.infer<typeof qrTokenParamSchema>;

export const qrScopeSchema = z.nativeEnum(QrScope);

export const createQrCodeSchema = z.object({
  subjectType: z.nativeEnum(QrSubjectType),
  subjectId: uuidSchema,
  /** Omit to take the sensible defaults for the subject type. */
  scopes: z.array(qrScopeSchema).min(1).max(10).optional(),
  label: optionalTrimmedString(120),
  /**
   * Whether the code resolves without a session.
   *
   * Deliberately optional rather than defaulted: the sensible answer depends on
   * the subject, and only the server knows it. Omit the field and
   * `publicResolveDefaultFor` decides — public for a driver or vehicle, whose
   * codes get printed and fixed to something out in the world; private for a
   * trip, order or inventory code, which is an internal handle. Send it
   * explicitly to override either way.
   */
  allowPublicResolve: z.boolean().optional(),
  expiresAt: z.coerce.date().optional(),
});
export type CreateQrCodeInput = z.infer<typeof createQrCodeSchema>;

export const qrListQuerySchema = paginationSchema.extend({
  subjectType: z.nativeEnum(QrSubjectType).optional(),
  subjectId: uuidSchema.optional(),
  status: csvEnum([QrCodeStatus.ACTIVE, QrCodeStatus.REVOKED, QrCodeStatus.EXPIRED]),
  search: optionalTrimmedString(120),
});
export type QrListQuery = z.infer<typeof qrListQuerySchema>;

export const revokeQrCodeSchema = z.object({
  reason: trimmedString(3, 300),
});
export type RevokeQrCodeInput = z.infer<typeof revokeQrCodeSchema>;

export const rotateQrCodeSchema = z.object({
  reason: optionalTrimmedString(300),
  /** Carry the previous scopes across, or take fresh defaults. */
  keepScopes: z.boolean().default(true),
});
export type RotateQrCodeInput = z.infer<typeof rotateQrCodeSchema>;

/** Query for the image endpoints. */
export const qrImageQuerySchema = z.object({
  size: z.coerce.number().int().min(128).max(2048).default(512),
  /** Error-correction level. Q by default — a windscreen sticker gets dirty. */
  errorCorrection: z.enum(['L', 'M', 'Q', 'H']).default('Q'),
  margin: z.coerce.number().int().min(0).max(8).default(4),
});
export type QrImageQuery = z.infer<typeof qrImageQuerySchema>;

export const qrBadgeQuerySchema = z.object({
  /** Omit to take the preset that suits the subject — card for a person. */
  preset: z
    .enum(['vehicle-sticker', 'vehicle-windscreen', 'vehicle-strip', 'driver-card'])
    .optional(),
  /** Add bleed and crop marks for a commercial print run. */
  printMarks: z.coerce.boolean().default(false),
  /**
   * Reverse the artwork, for a windscreen sticker fitted to the inside of the
   * glass with its printed face against it.
   */
  mirror: z.coerce.boolean().default(false),
  /** Render an A4 sheet of identical stickers instead of a single one. */
  sheet: z.coerce.boolean().default(false),
  columns: z.coerce.number().int().min(1).max(10).optional(),
  rows: z.coerce.number().int().min(1).max(14).optional(),
});
export type QrBadgeQuery = z.infer<typeof qrBadgeQuerySchema>;

/** Context a scanner supplies so the scan can be logged usefully. */
export const resolveQrQuerySchema = z.object({
  purpose: z.nativeEnum(QrScanPurpose).default(QrScanPurpose.IDENTITY_CHECK),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  /** The incident the scanner is responding to, for emergency scope. */
  incidentId: uuidSchema.optional(),
  /** The relay leg the scanner is completing, for handover scope. */
  relayId: uuidSchema.optional(),
});
export type ResolveQrQuery = z.infer<typeof resolveQrQuerySchema>;

/** Actions a scan may perform, each needing its own scope. */
export const qrActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('ASSIGN_DRIVER'),
    driverId: uuidSchema,
    note: optionalTrimmedString(300),
  }),
  z.object({
    action: z.literal('CHECKPOINT'),
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    note: optionalTrimmedString(300),
  }),
  z.object({
    action: z.literal('CONFIRM_PICKUP'),
    orderId: uuidSchema,
    note: optionalTrimmedString(300),
  }),
  z.object({
    action: z.literal('CONFIRM_DELIVERY'),
    orderId: uuidSchema,
    note: optionalTrimmedString(300),
  }),
  z.object({
    action: z.literal('RELAY_HANDOVER'),
    relayId: uuidSchema,
    /** Packages actually counted at the handover. */
    packageCount: z.number().int().min(0).max(100_000).optional(),
    weightTons: z.number().min(0).max(200).optional(),
    note: optionalTrimmedString(500),
  }),
]);
export type QrActionInput = z.infer<typeof qrActionSchema>;

export const qrScanListQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  purpose: z.nativeEnum(QrScanPurpose).optional(),
});
export type QrScanListQuery = z.infer<typeof qrScanListQuerySchema>;

export const qrSubjectParamSchema = z.object({
  subjectType: z.nativeEnum(QrSubjectType),
  subjectId: uuidSchema,
});
export type QrSubjectParam = z.infer<typeof qrSubjectParamSchema>;
