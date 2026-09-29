import { z } from 'zod';
import { addressSchema, emailSchema, optionalTrimmedString, trimmedString } from './common';
import { createFuelRecordSchema, maintenanceTypeSchema } from './fleet';

/**
 * Contracts for vehicle sharing. The activity a shared person may add is a
 * deliberately narrower shape than the owner's: no driver, order or price on a
 * trip, no trip link on a fuel entry — the vehicle's own state supplies those,
 * so a shared account can never point a record at something that is not theirs
 * to name.
 */

/** Share with another Saarthi account, by the email it signs in with. */
export const shareVehicleSchema = z.object({ email: emailSchema });
export type ShareVehicleInput = z.infer<typeof shareVehicleSchema>;

export const sharedTripSchema = z.object({
  origin: addressSchema,
  destination: addressSchema,
  plannedStartAt: z.coerce.date().optional(),
  plannedArrivalAt: z.coerce.date().optional(),
  notes: optionalTrimmedString(2000),
});
export type SharedTripInput = z.infer<typeof sharedTripSchema>;

export const sharedFuelSchema = createFuelRecordSchema.pick({
  quantityLitres: true,
  pricePerUnit: true,
  odometerKm: true,
  stationName: true,
  recordedAt: true,
});
export type SharedFuelInput = z.infer<typeof sharedFuelSchema>;

/**
 * Work on the vehicle: done already (`performedAt`) or booked (`scheduledAt`).
 * A shared person is as likely to be telling the owner "I had it serviced" as
 * "it is due in on Friday", so both are one form.
 */
export const sharedMaintenanceSchema = z.object({
  type: maintenanceTypeSchema,
  title: trimmedString(3, 160),
  description: optionalTrimmedString(2000),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  cost: z.coerce.number().min(0).max(10_000_000).optional(),
  serviceProvider: optionalTrimmedString(160),
  performedAt: z.coerce.date().optional(),
  scheduledAt: z.coerce.date().optional(),
});
export type SharedMaintenanceInput = z.infer<typeof sharedMaintenanceSchema>;
