import { z } from 'zod';
import {
  csvEnum,
  dateRangeSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * FASTag and toll input.
 *
 * The tag id format follows NETC: a 24-character hexadecimal EPC. Validating it
 * matters more than usual — a mistyped tag id silently attaches another
 * vehicle's toll history to yours, and nothing downstream would notice.
 */

const FASTAG_STATUSES = [
  'ACTIVE',
  'LOW_BALANCE',
  'BLACKLISTED',
  'EXCEPTION',
  'HOTLISTED',
  'CLOSED',
  'UNKNOWN',
] as const;

const TOLL_SOURCES = [
  'MANUAL',
  'IMPORT',
  'PROVIDER_SYNC',
  'DOCUMENT_EXTRACTION',
  'SIMULATED',
] as const;

const PAYMENT_MODES = ['FASTAG', 'CASH', 'UPI', 'CARD', 'EXEMPT', 'UNKNOWN'] as const;
const DIRECTIONS = ['INBOUND', 'OUTBOUND', 'UNKNOWN'] as const;

export const fastagStatusSchema = z.enum(FASTAG_STATUSES);
export const tollPaymentModeSchema = z.enum(PAYMENT_MODES);
export const tollDirectionSchema = z.enum(DIRECTIONS);

/** NETC tag id: 24 hex characters. Stored upper-case. */
export const tagIdSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[0-9A-F]{16,32}$/, 'A FASTag id is 16–32 hexadecimal characters.'),
  );

const amountSchema = z.coerce.number().min(0).max(100_000);

export const registerFastagSchema = z.object({
  vehicleId: uuidSchema,
  tagId: tagIdSchema,
  issuerBank: trimmedString(2, 120),
  issuerCode: optionalTrimmedString(20),
  vehicleClass: optionalTrimmedString(12),
  status: fastagStatusSchema.default('UNKNOWN'),
  /** Only when the operator actually knows it — see the note in domain/toll. */
  balance: amountSchema.optional(),
  lowBalanceThreshold: amountSchema.optional(),
  linkedAccountRef: optionalTrimmedString(64),
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  notes: optionalTrimmedString(1000),
});
export type RegisterFastagInput = z.infer<typeof registerFastagSchema>;

export const updateFastagSchema = registerFastagSchema
  .omit({ vehicleId: true, tagId: true })
  .partial();
export type UpdateFastagInput = z.infer<typeof updateFastagSchema>;

/**
 * Record a balance the operator read somewhere else.
 *
 * Separate from the general update because it carries a timestamp: a balance is
 * only meaningful alongside when it was true, and defaulting that to "now" when
 * somebody is entering last Tuesday's reading would quietly make a stale figure
 * look current.
 */
export const recordFastagBalanceSchema = z.object({
  balance: amountSchema,
  observedAt: z.coerce.date().optional(),
  source: z.enum(['MANUAL', 'PROVIDER_SYNC', 'IMPORT']).default('MANUAL'),
});
export type RecordFastagBalanceInput = z.infer<typeof recordFastagBalanceSchema>;

/**
 * Record a recharge.
 *
 * Saarthi does not move money to a tag — the issuer does. This records a top-up
 * that happened elsewhere so the balance and the spend history stay coherent.
 */
export const recordFastagRechargeSchema = z.object({
  amount: z.coerce.number().positive().max(100_000),
  rechargedAt: z.coerce.date().optional(),
  reference: optionalTrimmedString(120),
  /** Balance after the top-up, when the issuer showed one. */
  balanceAfter: amountSchema.optional(),
  notes: optionalTrimmedString(500),
});
export type RecordFastagRechargeInput = z.infer<typeof recordFastagRechargeSchema>;

export const fastagListQuerySchema = paginationSchema.extend({
  vehicleId: uuidSchema.optional(),
  status: csvEnum(FASTAG_STATUSES),
  /** Only tags that need attention: low, blocked, expiring or unknown. */
  needsAttention: z.coerce.boolean().default(false),
  search: optionalTrimmedString(120),
});
export type FastagListQuery = z.infer<typeof fastagListQuerySchema>;

/** Pull tag status, and any crossings the provider still holds, from NETC. */
export const syncFastagSchema = z.object({
  /** Write what the provider returns rather than only reporting it. */
  apply: z.coerce.boolean().default(true),
  /** Also pull recent toll crossings, where the provider serves them. */
  includeTransactions: z.coerce.boolean().default(true),
});
export type SyncFastagInput = z.infer<typeof syncFastagSchema>;

// ---------------------------------------------------------------------------
// Toll transactions
// ---------------------------------------------------------------------------

export const recordTollSchema = z.object({
  vehicleId: uuidSchema,
  tripId: uuidSchema.optional(),
  plazaName: trimmedString(2, 160),
  plazaCode: optionalTrimmedString(40),
  laneId: optionalTrimmedString(20),
  highway: optionalTrimmedString(60),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  direction: tollDirectionSchema.default('UNKNOWN'),
  paymentMode: tollPaymentModeSchema.default('FASTAG'),
  amount: z.coerce.number().min(0).max(50_000),
  balanceAfter: amountSchema.optional(),
  crossedAt: z.coerce.date(),
  externalReference: optionalTrimmedString(120),
  notes: optionalTrimmedString(500),
});
export type RecordTollInput = z.infer<typeof recordTollSchema>;

export const tollListQuerySchema = paginationSchema
  .extend({
    vehicleId: uuidSchema.optional(),
    tripId: uuidSchema.optional(),
    paymentMode: csvEnum(PAYMENT_MODES),
    source: csvEnum(TOLL_SOURCES),
    plaza: optionalTrimmedString(160),
  })
  .and(dateRangeSchema);
export type TollListQuery = z.infer<typeof tollListQuerySchema>;

export const tollSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  vehicleId: uuidSchema.optional(),
});
export type TollSummaryQuery = z.infer<typeof tollSummaryQuerySchema>;

/**
 * Import crossings from a statement.
 *
 * `externalReference` is what makes a repeated import idempotent. Rows without
 * one are still accepted — a paper receipt has no reference — but they are
 * matched on plaza, time and amount instead, which is weaker and says so.
 */
export const importTollSchema = z.object({
  vehicleId: uuidSchema,
  source: z.enum(['IMPORT', 'PROVIDER_SYNC', 'DOCUMENT_EXTRACTION']).default('IMPORT'),
  crossings: z
    .array(
      z.object({
        plazaName: trimmedString(2, 160),
        plazaCode: optionalTrimmedString(40),
        amount: z.coerce.number().min(0).max(50_000),
        crossedAt: z.coerce.date(),
        direction: tollDirectionSchema.default('UNKNOWN'),
        paymentMode: tollPaymentModeSchema.default('FASTAG'),
        balanceAfter: amountSchema.optional(),
        externalReference: optionalTrimmedString(120),
      }),
    )
    .min(1)
    .max(1000),
});
export type ImportTollInput = z.infer<typeof importTollSchema>;
