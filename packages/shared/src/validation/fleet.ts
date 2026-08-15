import { z } from 'zod';
import {
  DriverAvailability,
  FuelType,
  TruckStatus,
  TruckType,
  VerificationStatus,
} from '../domain/enums';
import { normalizeRegistrationNumber } from '../utils/format';
import {
  csvEnum,
  dateRangeSchema,
  optionalPhoneSchema,
  optionalTrimmedString,
  paginationSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Truck and driver contracts. The registration number is normalised on the way
 * in so `UP 16 AB 1234`, `up16ab1234` and `UP-16-AB-1234` are all the same
 * vehicle and the uniqueness constraint actually works.
 */

export const registrationNumberSchema = z
  .string()
  .transform((value) => normalizeRegistrationNumber(value))
  .pipe(
    z
      .string()
      .min(6, 'Enter a valid vehicle registration number.')
      .max(15, 'Enter a valid vehicle registration number.')
      .regex(/^[A-Z0-9]+$/, 'Registration numbers may only contain letters and digits.'),
  );

export const createTruckSchema = z.object({
  registrationNumber: registrationNumberSchema,
  truckType: z.nativeEnum(TruckType),
  manufacturer: optionalTrimmedString(80),
  model: optionalTrimmedString(80),
  year: z.coerce
    .number()
    .int()
    .min(1980, 'Enter a valid manufacturing year.')
    .max(new Date().getFullYear() + 1, 'Enter a valid manufacturing year.')
    .optional(),
  capacityTons: z.coerce
    .number()
    .positive('Capacity must be greater than zero.')
    .max(200, 'Capacity looks unrealistically high.'),
  fuelType: z.nativeEnum(FuelType).default(FuelType.DIESEL),
  /** Litres per 100 km. */
  fuelEfficiency: z.coerce.number().min(1).max(200).optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).default(0),
  notes: optionalTrimmedString(2000),
  shareLocation: z.boolean().default(true),
});
export type CreateTruckInput = z.infer<typeof createTruckSchema>;

export const updateTruckSchema = createTruckSchema.partial().extend({
  status: z.nativeEnum(TruckStatus).optional(),
});
export type UpdateTruckInput = z.infer<typeof updateTruckSchema>;

export const truckListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  status: csvEnum([
    TruckStatus.AVAILABLE,
    TruckStatus.ASSIGNED,
    TruckStatus.ON_TRIP,
    TruckStatus.LOADING,
    TruckStatus.UNLOADING,
    TruckStatus.IDLE,
    TruckStatus.MAINTENANCE,
    TruckStatus.OFFLINE,
    TruckStatus.EMERGENCY,
    TruckStatus.SUSPENDED,
  ]),
  truckType: csvEnum([
    TruckType.OPEN_BODY,
    TruckType.CLOSED_CONTAINER,
    TruckType.TIPPER,
    TruckType.TRAILER,
    TruckType.TANKER,
    TruckType.FLATBED,
    TruckType.REFRIGERATED,
    TruckType.MINI_TRUCK,
    TruckType.MULTI_AXLE,
    TruckType.OTHER,
  ]),
  verificationStatus: csvEnum([
    VerificationStatus.PENDING,
    VerificationStatus.SUBMITTED,
    VerificationStatus.UNDER_REVIEW,
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.EXPIRED,
    VerificationStatus.SUSPENDED,
  ]),
  driverId: uuidSchema.optional(),
  minCapacityTons: z.coerce.number().min(0).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sortBy: z
    .enum(['registrationNumber', 'status', 'capacityTons', 'createdAt', 'lastLocationAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type TruckListQuery = z.infer<typeof truckListQuerySchema>;

export const assignDriverSchema = z.object({
  driverId: uuidSchema,
  note: optionalTrimmedString(500),
});
export type AssignDriverInput = z.infer<typeof assignDriverSchema>;

export const updateTruckStatusSchema = z.object({
  status: z.nativeEnum(TruckStatus),
  reason: optionalTrimmedString(500),
});
export type UpdateTruckStatusInput = z.infer<typeof updateTruckStatusSchema>;

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export const createDriverSchema = z.object({
  /** Invite an existing Saarthi user, or create the account inline. */
  firstName: trimmedString(2, 60),
  lastName: trimmedString(1, 60),
  email: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().email('Enter a valid email address.')),
  phone: z
    .string()
    .transform((value) => value.replace(/[\s()-]/g, ''))
    .pipe(
      z
        .string()
        .regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.')
        .transform((value) => (value.startsWith('+91') ? value : `+91${value}`)),
    ),
  licenseNumber: trimmedString(4, 40),
  licenseExpiryDate: z.coerce.date().optional(),
  licenseClass: optionalTrimmedString(30),
  experienceYears: z.coerce.number().int().min(0).max(60).default(0),
  dateOfBirth: z.coerce.date().optional(),
  bloodGroup: optionalTrimmedString(6),
  emergencyContactName: optionalTrimmedString(80),
  emergencyContactPhone: optionalPhoneSchema,
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(80),
  state: optionalTrimmedString(80),
  postalCode: optionalTrimmedString(12),
});
export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export const updateDriverSchema = createDriverSchema
  .omit({ email: true, firstName: true, lastName: true, phone: true })
  .partial()
  .extend({
    firstName: trimmedString(2, 60).optional(),
    lastName: trimmedString(1, 60).optional(),
    availability: z.nativeEnum(DriverAvailability).optional(),
  });
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;

export const driverListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  availability: csvEnum([
    DriverAvailability.AVAILABLE,
    DriverAvailability.ON_TRIP,
    DriverAvailability.OFF_DUTY,
    DriverAvailability.ON_LEAVE,
    DriverAvailability.SUSPENDED,
  ]),
  verificationStatus: csvEnum([
    VerificationStatus.PENDING,
    VerificationStatus.SUBMITTED,
    VerificationStatus.UNDER_REVIEW,
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.EXPIRED,
    VerificationStatus.SUSPENDED,
  ]),
  assigned: z.enum(['true', 'false']).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sortBy: z.enum(['name', 'overallScore', 'totalTrips', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type DriverListQuery = z.infer<typeof driverListQuerySchema>;

export const adjustScoreSchema = z.object({
  category: z.enum(['SAFETY', 'RELIABILITY', 'TIMELINESS', 'COMPLIANCE', 'VEHICLE_CARE']),
  points: z.coerce
    .number()
    .int()
    .min(-25, 'An adjustment cannot remove more than 25 points at once.')
    .max(25, 'An adjustment cannot add more than 25 points at once.'),
  reason: trimmedString(10, 500),
});
export type AdjustScoreInput = z.infer<typeof adjustScoreSchema>;

// ---------------------------------------------------------------------------
// Maintenance & fuel
// ---------------------------------------------------------------------------

export const maintenanceTypeSchema = z.enum([
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
]);

export const createMaintenanceSchema = z.object({
  truckId: uuidSchema,
  type: maintenanceTypeSchema,
  title: trimmedString(3, 160),
  description: optionalTrimmedString(2000),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  cost: z.coerce.number().min(0).max(10_000_000).optional(),
  scheduledAt: z.coerce.date().optional(),
  serviceProvider: optionalTrimmedString(160),
  nextDueOdometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  nextDueAt: z.coerce.date().optional(),
});
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>;

export const updateMaintenanceSchema = createMaintenanceSchema
  .omit({ truckId: true })
  .partial()
  .extend({
    status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    startedAt: z.coerce.date().optional(),
    completedAt: z.coerce.date().optional(),
  });
export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>;

export const maintenanceListQuerySchema = paginationSchema.extend({
  truckId: uuidSchema.optional(),
  status: csvEnum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  type: csvEnum([
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
  ]),
  overdueOnly: z.coerce.boolean().default(false),
});
export type MaintenanceListQuery = z.infer<typeof maintenanceListQuerySchema>;

export const createFuelRecordSchema = z.object({
  truckId: uuidSchema,
  tripId: uuidSchema.optional(),
  quantityLitres: z.coerce.number().positive('Enter the quantity filled.').max(2000),
  pricePerUnit: z.coerce.number().positive('Enter the price per litre.').max(1000),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  stationName: optionalTrimmedString(160),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  recordedAt: z.coerce.date().optional(),
});
export type CreateFuelRecordInput = z.infer<typeof createFuelRecordSchema>;

export const fuelListQuerySchema = paginationSchema
  .extend({ truckId: uuidSchema.optional(), driverId: uuidSchema.optional() })
  .and(dateRangeSchema);
export type FuelListQuery = z.infer<typeof fuelListQuerySchema>;
