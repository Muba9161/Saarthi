import { z } from 'zod';
import { ALL_QR_FIELDS, QR_PRIVACY_PROFILES } from '../domain/qr-privacy';

/**
 * QR privacy policy input.
 *
 * The schema accepts only known fields and known profiles. Overrides on
 * non-configurable fields are *not* rejected here — they are stripped by
 * `sanitizeOverrides` in the service — because failing the whole save would let
 * a stale client block an owner from tightening everything else.
 */

const profileSchema = z.enum(
  QR_PRIVACY_PROFILES as unknown as [string, ...string[]],
);

const overrideSchema = z
  .object({
    minProfile: profileSchema.optional(),
    maskBelow: profileSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

export const qrPrivacyOverridesSchema = z.record(
  z.enum(ALL_QR_FIELDS as unknown as [string, ...string[]]),
  overrideSchema,
);

export const updateQrPrivacyPolicySchema = z.object({
  overrides: qrPrivacyOverridesSchema.optional(),
  /**
   * Tenant-level switch for anonymous resolution. Turning it off overrides
   * every individual code's `allowPublicResolve`, so a fleet can close public
   * scanning in one action rather than editing each sticker.
   */
  allowPublicScans: z.boolean().optional(),
});
export type UpdateQrPrivacyPolicyInput = z.infer<typeof updateQrPrivacyPolicySchema>;
