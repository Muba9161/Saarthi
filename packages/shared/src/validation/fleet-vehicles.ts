import { z } from 'zod';
import {
  FuelType,
  TruckStatus,
  TruckType,
  VehicleType,
  VerificationStatus,
} from '../domain/enums';
import { validateVehicleCapacities, vehicleTypeDefinition } from '../domain/vehicles';
import {
  csvEnum,
  optionalTrimmedString,
  paginationSchema,
  uuidSchema,
} from './common';
import { registrationNumberSchema } from './fleet';

/**
 * Generalized vehicle contracts.
 *
 * A vehicle is the same database row as a truck — the fleet surface and this one
 * read and write the same table, differing only in which vehicle types they
 * present. Where the truck schema requires a payload capacity unconditionally,
 * this one asks the capability model what the given type actually needs, so a
 * taxi is not forced to declare tonnage and a truck cannot omit it.
 */

const passengerCapacitySchema = z.coerce
  .number()
  .int()
  .min(1, 'A passenger vehicle must seat at least one person.')
  .max(80, 'Passenger capacity looks unrealistically high.');

const baseVehicleFields = {
  registrationNumber: registrationNumberSchema,
  vehicleType: z.nativeEnum(VehicleType),
  /**
   * Body type. Only meaningful for goods vehicles; the capability model supplies
   * a value for passenger vehicles so the legacy column stays populated.
   */
  truckType: z.nativeEnum(TruckType).optional(),
  manufacturer: optionalTrimmedString(80),
  model: optionalTrimmedString(80),
  year: z.coerce
    .number()
    .int()
    .min(1980, 'Enter a valid manufacturing year.')
    .max(new Date().getFullYear() + 1, 'Enter a valid manufacturing year.')
    .optional(),
  colour: optionalTrimmedString(40),
  capacityTons: z.coerce
    .number()
    .min(0, 'Capacity cannot be negative.')
    .max(200, 'Capacity looks unrealistically high.')
    .optional(),
  passengerCapacity: passengerCapacitySchema.optional(),
  /** Air conditioning matters to a travel customer; irrelevant to freight. */
  airConditioned: z.boolean().optional(),
  fuelType: z.nativeEnum(FuelType).default(FuelType.DIESEL),
  fuelEfficiency: z.coerce.number().min(1).max(200).optional(),
  odometerKm: z.coerce.number().min(0).max(5_000_000).default(0),
  notes: optionalTrimmedString(2000),
  shareLocation: z.boolean().default(true),
};

/**
 * Reject capacities the vehicle type cannot have, and require the ones it must.
 * The same function backs the form, so the client and the API agree on what is
 * wrong before a request is even sent.
 */
function refineCapacities<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    const input = value as {
      vehicleType?: VehicleType;
      capacityTons?: number | null;
      passengerCapacity?: number | null;
    };
    if (!input.vehicleType) return;
    for (const problem of validateVehicleCapacities(input.vehicleType, input)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  }) as unknown as T;
}

export const createVehicleSchema = refineCapacities(z.object(baseVehicleFields));
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object(baseVehicleFields)
  .partial()
  .extend({ status: z.nativeEnum(TruckStatus).optional() });
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const vehicleListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  vehicleType: csvEnum([
    VehicleType.TRUCK,
    VehicleType.TAXI,
    VehicleType.CAR,
    VehicleType.BUS,
    VehicleType.VAN,
    VehicleType.SUV,
    VehicleType.TEMPO,
    VehicleType.AUTO_RICKSHAW,
    VehicleType.OTHER,
  ]),
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
  verificationStatus: csvEnum([
    VerificationStatus.PENDING,
    VerificationStatus.SUBMITTED,
    VerificationStatus.UNDER_REVIEW,
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.EXPIRED,
    VerificationStatus.SUSPENDED,
  ]),
  /** Filter to vehicles that can carry goods, or that can carry people. */
  capability: z.enum(['FREIGHT', 'PASSENGER', 'TRAVEL']).optional(),
  driverId: uuidSchema.optional(),
  /** Only vehicles with an active telematics device. */
  hasDevice: z.coerce.boolean().optional(),
  minPassengerCapacity: z.coerce.number().int().min(1).optional(),
  minCapacityTons: z.coerce.number().min(0).optional(),
  includeArchived: z.coerce.boolean().default(false),
  sortBy: z
    .enum(['registrationNumber', 'status', 'vehicleType', 'createdAt', 'lastLocationAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;

/** Fill in the body type a passenger vehicle has no opinion about. */
export function resolveTruckType(
  vehicleType: VehicleType,
  supplied: TruckType | undefined,
): TruckType {
  return supplied ?? vehicleTypeDefinition(vehicleType).legacyTruckType;
}
