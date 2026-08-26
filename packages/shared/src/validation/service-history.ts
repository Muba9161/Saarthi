import { z } from 'zod';
import { ALL_SERVICE_COMPONENTS } from '../domain/service-history';
import {
  csvEnum,
  dateRangeSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Service history input.
 *
 * The rule that shapes this file: a record entered badly is worth more than a
 * record not entered. Only the vehicle, a title and a date are required — a
 * driver filing an invoice from a roadside workshop should not have to know the
 * engine hours to save it. Everything else refines the record over time.
 */

const SERVICE_CATEGORIES = [
  'ROUTINE',
  'ENGINE',
  'TRANSMISSION',
  'BRAKES',
  'SUSPENSION',
  'STEERING',
  'TYRES',
  'ELECTRICAL',
  'BODY',
  'HVAC',
  'FUEL_SYSTEM',
  'COOLING',
  'EXHAUST',
  'CHASSIS',
  'ACCIDENT_REPAIR',
  'OTHER',
] as const;

const SERVICE_SOURCES = [
  'MANUAL',
  'IMPORT',
  'PROVIDER_SYNC',
  'DOCUMENT_EXTRACTION',
  'TELEMETRY_DERIVED',
  'SIMULATED',
] as const;

const SERVICE_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'PROVIDER_REPORTED',
  'PENDING_REVIEW',
  'VERIFIED',
  'CONFLICT',
  'REJECTED',
] as const;

const MAINTENANCE_TYPES = [
  'PREVENTIVE',
  'REPAIR',
  'INSPECTION',
  'TYRE',
  'OIL_CHANGE',
  'BRAKE',
  'ENGINE',
  'ELECTRICAL',
  'BODYWORK',
  'OTHER',
] as const;

export const serviceCategorySchema = z.enum(SERVICE_CATEGORIES);
export const serviceSourceSchema = z.enum(SERVICE_SOURCES);
export const serviceVerificationSchema = z.enum(SERVICE_VERIFICATION_STATUSES);

/** One line on the workshop invoice. */
export const servicePartSchema = z.object({
  name: trimmedString(1, 160),
  partNumber: optionalTrimmedString(80),
  /** Normalised key, so a component can be counted across records. */
  component: z.enum(ALL_SERVICE_COMPONENTS as unknown as [string, ...string[]]).optional(),
  quantity: z.coerce.number().min(0).max(10_000).default(1),
  unitCost: z.coerce.number().min(0).max(10_000_000).optional(),
  warrantyMonths: z.coerce.number().int().min(0).max(120).optional(),
});
export type ServicePartInput = z.infer<typeof servicePartSchema>;

const moneyField = z.coerce.number().min(0).max(10_000_000).optional();

/**
 * The full service-history payload.
 *
 * Used both to record a completed job directly and to complete a scheduled one,
 * which is why `completedAt` is optional — a scheduled record supplies it when
 * the work finishes.
 */
export const serviceRecordSchema = z.object({
  vehicleId: uuidSchema,
  type: z.enum(MAINTENANCE_TYPES).default('PREVENTIVE'),
  category: serviceCategorySchema.optional(),
  title: trimmedString(3, 160),
  description: optionalTrimmedString(4000),

  serviceDate: z.coerce.date().optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  engineHours: z.coerce.number().min(0).max(200_000).optional(),

  workshopName: optionalTrimmedString(160),
  workshopAddress: optionalTrimmedString(300),
  workshopPhone: optionalTrimmedString(20),
  mechanicName: optionalTrimmedString(160),

  labourCost: moneyField,
  partsCost: moneyField,
  taxAmount: moneyField,
  /** Total. Computed from the parts when omitted. */
  totalCost: moneyField,

  invoiceNumber: optionalTrimmedString(80),
  parts: z.array(servicePartSchema).max(100).optional(),
  replacedComponents: z
    .array(z.enum(ALL_SERVICE_COMPONENTS as unknown as [string, ...string[]]))
    .max(50)
    .optional(),
  diagnosticCodes: z.array(trimmedString(2, 20)).max(50).optional(),
  warrantyUntil: z.coerce.date().optional(),

  nextServiceDate: z.coerce.date().optional(),
  nextServiceOdometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
});

/*
 * Invoice scans and workshop photographs are uploaded against the saved record
 * through the media library (owner type MAINTENANCE_RECORD), not passed in
 * here. The library takes its owner at upload time so an asset can never be
 * orphaned or re-parented into a record it does not belong to.
 */
export type ServiceRecordInput = z.infer<typeof serviceRecordSchema>;

export const updateServiceRecordSchema = serviceRecordSchema
  .omit({ vehicleId: true })
  .partial()
  .extend({
    status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    completedAt: z.coerce.date().optional(),
  });
export type UpdateServiceRecordInput = z.infer<typeof updateServiceRecordSchema>;

export const serviceHistoryQuerySchema = paginationSchema
  .extend({
    vehicleId: uuidSchema.optional(),
    category: csvEnum(SERVICE_CATEGORIES),
    type: csvEnum(MAINTENANCE_TYPES),
    source: csvEnum(SERVICE_SOURCES),
    verificationStatus: csvEnum(SERVICE_VERIFICATION_STATUSES),
    /** Only records still needing a human to confirm them. */
    needsReview: z.coerce.boolean().default(false),
    search: optionalTrimmedString(160),
  })
  .and(dateRangeSchema);
export type ServiceHistoryQuery = z.infer<typeof serviceHistoryQuerySchema>;

/**
 * Confirm or reject a record that came from outside.
 *
 * An AI-extracted or provider-supplied record is a draft. This is the step that
 * turns it into a trusted fact, and it is always a person's decision.
 */
export const verifyServiceRecordSchema = z.object({
  verificationStatus: z.enum(['VERIFIED', 'REJECTED', 'PENDING_REVIEW']),
  note: optionalTrimmedString(1000),
});
export type VerifyServiceRecordInput = z.infer<typeof verifyServiceRecordSchema>;

/** Pull a vehicle's history from an external workshop network. */
export const syncServiceHistorySchema = z.object({
  provider: optionalTrimmedString(60),
  /** Write the retrieved records, rather than only reporting what differs. */
  apply: z.coerce.boolean().default(false),
  since: z.coerce.date().optional(),
});
export type SyncServiceHistoryInput = z.infer<typeof syncServiceHistorySchema>;
