import { z } from 'zod';
import { ProfileVisibility } from '../domain/enums';
import { ProfileAudience } from '../domain/profiles';
import {
  emailSchema,
  optionalPhoneSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Profile builder validation.
 *
 * A section patch is validated in two passes: this schema checks the envelope,
 * and the service then checks every key against the blueprint. An unknown field
 * key is rejected rather than ignored — silently dropping a value the user typed
 * is worse than telling them it does not belong there.
 */

const tagsSchema = z.array(trimmedString(1, 60)).max(30);
const urlSchema = z.string().trim().url('Enter a valid URL.').max(300);

export const patchProfileSectionSchema = z.object({
  /**
   * Field values keyed by the blueprint field key. Deliberately permissive
   * here; the blueprint is the authority on which keys and shapes are legal.
   */
  values: z.record(z.unknown()),
});
export type PatchProfileSectionInput = z.infer<typeof patchProfileSectionSchema>;

export const updateUserProfileSchema = z.object({
  headline: optionalTrimmedString(120),
  bio: optionalTrimmedString(1200),
  languages: tagsSchema.optional(),
  skills: tagsSchema.optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  gender: optionalTrimmedString(40),
  socialLinks: z.record(urlSchema).optional(),
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  postalCode: optionalTrimmedString(20),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  emergencyContactName: optionalTrimmedString(120),
  emergencyContactPhone: optionalPhoneSchema,
  preferences: z
    .object({
      locale: optionalTrimmedString(10),
      timezone: optionalTrimmedString(60),
      theme: z.enum(['system', 'light', 'dark']).optional(),
      distanceUnit: z.enum(['km', 'mi']).optional(),
      mapStyle: optionalTrimmedString(60),
      /** Speak hazard alerts aloud in the driver app. */
      voiceAlerts: z.boolean().optional(),
    })
    .optional(),
  visibility: z.nativeEnum(ProfileVisibility).optional(),
  fieldVisibility: z.record(z.nativeEnum(ProfileVisibility)).optional(),
});
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;

export const updateOrganizationProfileSchema = z.object({
  tagline: optionalTrimmedString(160),
  about: optionalTrimmedString(2000),
  foundedYear: z.number().int().min(1900).max(2100).nullable().optional(),
  employeeCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  website: urlSchema.optional().or(z.literal('').transform(() => undefined)),
  socialLinks: z.record(urlSchema).optional(),
  serviceAreas: tagsSchema.optional(),
  specialities: tagsSchema.optional(),
  certifications: tagsSchema.optional(),
  operatingHours: z
    .object({
      openFromMinutes: z.number().int().min(0).max(1439).nullable().optional(),
      openToMinutes: z.number().int().min(0).max(1439).nullable().optional(),
      daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    })
    .optional(),
  supportEmail: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  supportPhone: optionalPhoneSchema,
  billingContactName: optionalTrimmedString(120),
  billingContactPhone: optionalPhoneSchema,
  billingEmail: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  visibility: z.nativeEnum(ProfileVisibility).optional(),
  fieldVisibility: z.record(z.nativeEnum(ProfileVisibility)).optional(),
});
export type UpdateOrganizationProfileInput = z.infer<typeof updateOrganizationProfileSchema>;

export const profileDirectoryQuerySchema = paginationSchema.extend({
  audience: z.nativeEnum(ProfileAudience).optional(),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  search: optionalTrimmedString(160),
  /** Organizations rather than people. */
  kind: z.enum(['people', 'organizations']).default('organizations'),
});
export type ProfileDirectoryQuery = z.infer<typeof profileDirectoryQuerySchema>;

export const profileSlugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, 'That profile address is not valid.'),
});
export type ProfileSlugParam = z.infer<typeof profileSlugParamSchema>;

export const profileSectionParamSchema = z.object({
  sectionKey: trimmedString(2, 60),
});
export type ProfileSectionParam = z.infer<typeof profileSectionParamSchema>;

export const setProfileSlugSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(
      z
        .string()
        .min(3, 'Use at least 3 characters.')
        .max(60, 'Use at most 60 characters.')
        .regex(
          /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
          'Use lowercase letters, numbers and hyphens only.',
        ),
    ),
  /** Which profile the slug belongs to. */
  target: z.enum(['user', 'organization']).default('user'),
});
export type SetProfileSlugInput = z.infer<typeof setProfileSlugSchema>;

export const profileCompletionQuerySchema = z.object({
  /** Score another user's profile — platform admin only. */
  userId: uuidSchema.optional(),
});
export type ProfileCompletionQuery = z.infer<typeof profileCompletionQuerySchema>;
