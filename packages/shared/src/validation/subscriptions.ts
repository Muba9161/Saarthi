import { z } from 'zod';
import { PlanTier } from '../domain/enums';
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
 * Buying one Saarthi tracker.
 *
 * The vehicle is optional at purchase because the two real orders of events
 * both happen: an operator who already has the vehicle on Saarthi picks it
 * here, and an operator ordering hardware ahead of a delivery has nothing to
 * pick yet. An unassigned tracker still grants its entitlement — it was paid
 * for — and is bound to a vehicle later with `assignTrackerSchema`.
 */
export const purchaseTrackerSchema = z.object({
  truckId: z.string().uuid().optional(),
  note: optionalTrimmedString(200),
  /** Mock-gateway only; refused in production. See `purchaseTopUpSchema`. */
  simulateFailure: z.coerce.boolean().default(false),
});
export type PurchaseTrackerInput = z.infer<typeof purchaseTrackerSchema>;

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

/**
 * Choosing a plan.
 *
 * Used both at registration and by an existing tenant changing plans. Billing
 * period is part of the choice rather than a separate step, because the price
 * a customer agreed to is the monthly-or-yearly one and storing the plan
 * without it loses half the agreement.
 */
export const selectPlanSchema = z.object({
  tier: z.nativeEnum(PlanTier),
  billing: z.enum(['monthly', 'yearly']).default('monthly'),
});
export type SelectPlanInput = z.infer<typeof selectPlanSchema>;
