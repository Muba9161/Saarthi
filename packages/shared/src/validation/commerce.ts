import { z } from 'zod';
import {
  CommerceAttributeScope,
  CommerceAttributeType,
  CommerceCategoryStatus,
  MaterialUnit,
} from '../domain/enums';
import {
  latitudeSchema,
  longitudeSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Smart commerce contracts: interpreting a line of text, and the
 * administrator's taxonomy management.
 *
 * These schemas bound *shape and size* only. Whether an attribute value is
 * acceptable depends on the category it is filed under, and that check —
 * `validateAttributeValues` — runs against the live taxonomy in the service.
 */

const MAX_ATTRIBUTES = 40;

/** Attribute values as submitted. Keys and values are re-checked against the schema. */
export const commerceAttributeValuesSchema = z
  .record(
    z.string().min(1).max(40),
    z.union([z.string().trim().max(200), z.number().finite(), z.boolean()]),
  )
  .refine((values) => Object.keys(values).length <= MAX_ATTRIBUTES, {
    message: `At most ${MAX_ATTRIBUTES} details can be recorded.`,
  });

export const commerceRecordScopeSchema = z.enum(['PRODUCT', 'REQUIREMENT']);

export const interpretCommerceSchema = z.object({
  text: trimmedString(2, 500),
  scope: commerceRecordScopeSchema,
  /** What the user has already confirmed or corrected. Never overridden. */
  locked: z
    .object({
      categoryId: uuidSchema.optional(),
      attributes: commerceAttributeValuesSchema.optional(),
    })
    .optional(),
});
export type InterpretCommerceInput = z.infer<typeof interpretCommerceSchema>;

export const commerceMatchQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(25),
    /**
     * Measure seller distance from here instead of the delivery point — a
     * vehicle on its return leg buys near where it is standing.
     */
    nearLatitude: latitudeSchema.optional(),
    nearLongitude: longitudeSchema.optional(),
  })
  .refine((value) => (value.nearLatitude === undefined) === (value.nearLongitude === undefined), {
    message: 'Give both a latitude and a longitude, or neither.',
    path: ['nearLongitude'],
  });
export type CommerceMatchQuery = z.infer<typeof commerceMatchQuerySchema>;

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens.')
  .max(80);

const aliasSchema = trimmedString(2, 60);

export const createCommerceCategorySchema = z.object({
  parentId: uuidSchema.optional(),
  name: trimmedString(2, 80),
  slug: slugSchema.optional(),
  description: optionalTrimmedString(500),
  defaultUnit: z.nativeEnum(MaterialUnit).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  aliases: z.array(aliasSchema).max(30).default([]),
});
export type CreateCommerceCategoryInput = z.infer<typeof createCommerceCategorySchema>;

export const updateCommerceCategorySchema = z.object({
  name: trimmedString(2, 80).optional(),
  description: optionalTrimmedString(500).nullable(),
  defaultUnit: z.nativeEnum(MaterialUnit).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  status: z.nativeEnum(CommerceCategoryStatus).optional(),
});
export type UpdateCommerceCategoryInput = z.infer<typeof updateCommerceCategorySchema>;

const attributeValidationSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    maxLength: z.number().int().min(1).max(200).optional(),
  })
  .refine((rules) => rules.min === undefined || rules.max === undefined || rules.min <= rules.max, {
    message: 'The minimum cannot be above the maximum.',
  });

const attributeFields = {
  label: trimmedString(2, 60),
  type: z.nativeEnum(CommerceAttributeType),
  required: z.boolean().default(false),
  unit: optionalTrimmedString(20),
  options: z.array(trimmedString(1, 60)).max(50).default([]),
  validation: attributeValidationSchema.optional(),
  scope: z.nativeEnum(CommerceAttributeScope).default(CommerceAttributeScope.BOTH),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(0),
};

export const createCommerceAttributeSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower-case letters, numbers and underscores.'),
    ...attributeFields,
  })
  .refine((input) => input.type !== CommerceAttributeType.SELECT || input.options.length > 0, {
    message: 'A choice attribute needs at least one option.',
    path: ['options'],
  });
export type CreateCommerceAttributeInput = z.infer<typeof createCommerceAttributeSchema>;

/** The key is the attribute's identity in stored values, so it cannot be renamed. */
export const updateCommerceAttributeSchema = z.object({
  label: attributeFields.label.optional(),
  required: z.boolean().optional(),
  unit: optionalTrimmedString(20).nullable(),
  options: z.array(trimmedString(1, 60)).max(50).optional(),
  validation: attributeValidationSchema.nullable().optional(),
  scope: z.nativeEnum(CommerceAttributeScope).optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
});
export type UpdateCommerceAttributeInput = z.infer<typeof updateCommerceAttributeSchema>;

export const createCommerceAliasSchema = z.object({ alias: aliasSchema });
export type CreateCommerceAliasInput = z.infer<typeof createCommerceAliasSchema>;

export const commerceOtherUsageQuerySchema = paginationSchema;
export type CommerceOtherUsageQuery = z.infer<typeof commerceOtherUsageQuerySchema>;
