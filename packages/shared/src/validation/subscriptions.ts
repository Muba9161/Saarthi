import { z } from 'zod';
import { PlanTier, TrackerProduct } from '../domain/enums';
import { DEFAULT_TRACKER_PRODUCT } from '../domain/pricing';
import { optionalTrimmedString } from './common';

/**
 * Subscription capacity input.
 *
 * Quantity is deliberately absent: one call buys one `+1 vehicle` top-up. A
 * quantity field would need its own idempotency story to avoid charging a fleet
 * five times for one mis-click, and buying five is five clicks.
 */
export const purchaseTopUpSchema = z.object({
  note: optionalTrimmedString(200),
  /**
   * Drive a declined payment through the real failure path.
   *
   * Honoured only by the mock gateway, which is refused in production — a
   * client cannot use this to skip a real charge.
   */
  simulateFailure: z.coerce.boolean().default(false),
});
export type PurchaseTopUpInput = z.infer<typeof purchaseTopUpSchema>;

/**
 * Where Cashfree sends the owner back after authorising autopay.
 *
 * A fixed choice rather than a path, so the return address can never be
 * pointed somewhere else: the subscription screen, or the activation step a
 * new account completes straight after registering.
 */
export const startAutopaySchema = z.object({
  returnTo: z.enum(['subscription', 'activation']).default('subscription'),
});
export type StartAutopayInput = z.infer<typeof startAutopaySchema>;

/**
 * Buying one Saarthi tracker.
 *
 * The vehicle is optional at purchase because the two real orders of events
 * both happen: an operator who already has the vehicle on Saarthi picks it
 * here, and an operator ordering hardware ahead of a delivery has nothing to
 * pick yet. An unassigned tracker still grants its entitlement — it was paid
 * for — and is bound to a vehicle later with `assignTrackerSchema`.
 */
export const purchaseTrackerSchema = z
  .object({
    /** Which tracker — see `TRACKER_PRODUCTS`. */
    product: z.nativeEnum(TrackerProduct).default(DEFAULT_TRACKER_PRODUCT),
    /** How many, in one payment. Bounded again by the fleet and the plan. */
    quantity: z.coerce.number().int().min(1).max(100).default(1),
    truckId: z.string().uuid().optional(),
    note: optionalTrimmedString(200),
    /** Mock-gateway only; refused in production. See `purchaseTopUpSchema`. */
    simulateFailure: z.coerce.boolean().default(false),
  })
  .refine((input) => !input.truckId || input.quantity === 1, {
    message: 'A tracker bought for a named vehicle is bought one at a time.',
    path: ['quantity'],
  });
export type PurchaseTrackerInput = z.infer<typeof purchaseTrackerSchema>;

/**
 * What the add-vehicle form pays for, in one payment: the vehicle's slot when
 * the plan is full, the tracker chosen for it, or both. Prices are never sent —
 * the server prices the order from the catalogue.
 */
export const purchaseVehicleOrderSchema = z
  .object({
    slot: z.boolean().default(false),
    trackerProduct: z.nativeEnum(TrackerProduct).optional(),
  })
  .refine((input) => input.slot || input.trackerProduct !== undefined, {
    message: 'Choose a vehicle slot, a tracker, or both.',
  });
export type PurchaseVehicleOrderInput = z.infer<typeof purchaseVehicleOrderSchema>;

/**
 * Moving a tracker to a different vehicle.
 *
 * `null` detaches it, which is what happens when a vehicle is sold: the
 * hardware comes off and goes on the shelf, and the purchase is not thereby
 * refunded or forfeited.
 */
export const assignTrackerSchema = z.object({
  truckId: z.string().uuid().nullable(),
});
export type AssignTrackerInput = z.infer<typeof assignTrackerSchema>;

/** Choosing a plan. Billing is monthly. */
export const selectPlanSchema = z.object({
  tier: z.nativeEnum(PlanTier),
});
export type SelectPlanInput = z.infer<typeof selectPlanSchema>;
