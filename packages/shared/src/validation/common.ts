import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../api/envelope';

/** Trim-then-validate string used everywhere a human types free text. */
export const trimmedString = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min).max(max));

export const optionalTrimmedString = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .optional()
    .or(z.literal('').transform(() => undefined));

export const uuidSchema = z.string().uuid('A valid identifier is required.');

export const idParamSchema = z.object({ id: uuidSchema });

export const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().email('Enter a valid email address.').max(254));

/** Indian mobile numbers, optionally prefixed with +91. Stored normalised. */
export const phoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.')
      .transform((value) => (value.startsWith('+91') ? value : `+91${value}`)),
  );

export const optionalPhoneSchema = phoneSchema.optional().or(
  z.literal('').transform(() => undefined),
);

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter.')
  .refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter.')
  .refine((value) => /\d/.test(value), 'Password must contain a number.');

// Coerced, because coordinates arrive both as JSON numbers (request bodies)
// and as strings (query parameters on map/nearby endpoints).
export const latitudeSchema = z.coerce
  .number()
  .min(-90, 'Latitude must be between -90 and 90.')
  .max(90, 'Latitude must be between -90 and 90.');

export const longitudeSchema = z.coerce
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.');

export const coordinateSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type Coordinate = z.infer<typeof coordinateSchema>;

export const addressSchema = z.object({
  label: optionalTrimmedString(120),
  addressLine: trimmedString(3, 300),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  postalCode: optionalTrimmedString(20),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type AddressInput = z.infer<typeof addressSchema>;

/** Query-string integers arrive as strings — coerce then bound. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export const searchSchema = z.object({
  search: optionalTrimmedString(160),
});

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must be before the end date.',
    path: ['from'],
  });
export type DateRangeQuery = z.infer<typeof dateRangeSchema>;

/** Comma separated query params, e.g. `?status=ACTIVE,IDLE`. */
export const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      const cleaned = list.map((item) => item.trim()).filter(Boolean);
      return cleaned.length > 0 ? (cleaned as T[number][]) : undefined;
    })
    .pipe(z.array(z.enum(values)).optional());

export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1',
  );

export const moneySchema = z
  .number()
  .min(0, 'Amount cannot be negative.')
  .max(1_000_000_000, 'Amount is unrealistically large.')
  .refine((value) => Number.isFinite(value), 'Enter a valid amount.');

export const positiveQuantitySchema = z
  .number()
  .positive('Quantity must be greater than zero.')
  .max(1_000_000, 'Quantity is unrealistically large.');
