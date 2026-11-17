import { z } from 'zod';
import { MAX_RIDE_POINTS, MAX_RIDE_SHARE_CONTACTS } from '../domain/ride-shares';
import { emailSchema, latitudeSchema, longitudeSchema, phoneSchema } from './common';

/**
 * A family member, by Indian mobile number or by email address — whichever
 * the rider knows them by. Stored normalised, as sign-up stores each: "+91…"
 * for a number, lower case for an address.
 */
export const rideShareContactSchema = z
  .string()
  .trim()
  .pipe(
    z.union([phoneSchema, emailSchema], {
      errorMap: () => ({ message: 'Enter a 10-digit Indian mobile number or an email address.' }),
    }),
  );

export const startRideShareSchema = z.object({
  /** The vehicle's number as typed; optional, since a rider may not know it. */
  registrationNumber: z.string().trim().min(2).max(20).optional(),
  /** Family to tell, by mobile number or email address. */
  contacts: z.array(rideShareContactSchema).max(MAX_RIDE_SHARE_CONTACTS).default([]),
  /** Also show it on the rider's own owner account (the same login, in the owner app). */
  shareWithSelf: z.coerce.boolean().default(false),
});
export type StartRideShareInput = z.infer<typeof startRideShareSchema>;

export const addRideShareContactSchema = z.object({ contact: rideShareContactSchema });
export type AddRideShareContactInput = z.infer<typeof addRideShareContactSchema>;

/** Fixes from the rider's phone, with the share's reporting key. */
export const ridePointsSchema = z.object({
  points: z
    .array(
      z.object({
        latitude: latitudeSchema,
        longitude: longitudeSchema,
        speedKph: z.coerce.number().min(0).max(200).optional(),
        heading: z.coerce.number().min(0).max(360).optional(),
        accuracy: z.coerce.number().min(0).max(5000).optional(),
        recordedAt: z.coerce.date(),
      }),
    )
    .min(1)
    .max(MAX_RIDE_POINTS),
});
export type RidePointsInput = z.infer<typeof ridePointsSchema>;

export const liveRideTokenParamSchema = z.object({ token: z.string().min(20).max(200) });

/** The live link read again: `from` the last point already drawn, only the road covered since. */
export const liveRideQuerySchema = z.object({ from: z.coerce.date().optional() });
export type LiveRideQuery = z.infer<typeof liveRideQuerySchema>;
