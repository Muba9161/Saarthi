import { z } from 'zod';
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
