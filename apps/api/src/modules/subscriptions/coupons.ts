/**
 * Subscription coupons.
 *
 * Hard-coded, and kept on the server only — the web bundle must never carry a
 * code. A coupon takes a percentage off the monthly plan bill (the plan plus
 * extra vehicles; a tracker is one-off hardware and is never discounted) for
 * `COUPON_MONTHS` billing months:
 *
 *   • 100% — there is nothing to charge, so the months are granted at once:
 *     the paid period moves on by three months, after any trial or month
 *     already paid for.
 *   • less — the next three plan charges, paid by hand or by autopay, are
 *     taken at the reduced price.
 *
 * Once a code is entered, coupons are locked for the account for the same
 * three months — neither code can be entered again until they pass. Entered
 * after that, a coupon tops back up to three months. It never stacks.
 */

import { BILLING_PERIOD_DAYS } from '@saarthi/shared';

export const COUPON_MONTHS = 3;

/** Three billing months: what a coupon covers, and how long coupons stay locked after one is entered. */
export const COUPON_SPAN_MS = COUPON_MONTHS * BILLING_PERIOD_DAYS * 86_400_000;

interface CouponDefinition {
  code: string;
  percentOff: number;
}

const COUPONS: readonly CouponDefinition[] = [
  { code: 'SAARTHIFREE', percentOff: 100 },
  { code: 'WELCOME50', percentOff: 50 },
];

/** The coupon a typed code names, ignoring case and spaces. */
export function findCoupon(input: string): CouponDefinition | null {
  const code = input.replace(/\s+/g, '').toUpperCase();
  return COUPONS.find((coupon) => coupon.code === code) ?? null;
}

/** The coupon columns of a subscription row. */
export interface CouponFields {
  couponCode: string | null;
  couponPercentOff: number | null;
  couponMonthsLeft: number;
  couponFreeUntil: Date | null;
  couponAppliedAt: Date | null;
}

/** Until when no coupon may be entered, or null when one may be now. */
export function couponLockedUntil(fields: Pick<CouponFields, 'couponAppliedAt'>, now = Date.now()): Date | null {
  if (!fields.couponAppliedAt) return null;
  const until = fields.couponAppliedAt.getTime() + COUPON_SPAN_MS;
  return until > now ? new Date(until) : null;
}

/** A coupon still in force, as the billing screens show it. */
export interface ActiveCoupon {
  code: string;
  percentOff: number;
  /** A partial discount: plan charges still to be taken at its price. */
  monthsLeft: number | null;
  /** 100%: the day the free months end. */
  freeUntil: string | null;
}

export function activeCoupon(fields: CouponFields, now = Date.now()): ActiveCoupon | null {
  const { couponCode: code, couponPercentOff: percentOff } = fields;
  if (!code || percentOff === null) return null;

  if (percentOff >= 100) {
    return fields.couponFreeUntil && fields.couponFreeUntil.getTime() > now
      ? { code, percentOff, monthsLeft: null, freeUntil: fields.couponFreeUntil.toISOString() }
      : null;
  }
  return fields.couponMonthsLeft > 0
    ? { code, percentOff, monthsLeft: fields.couponMonthsLeft, freeUntil: null }
    : null;
}

/**
 * A monthly charge with a partial-discount coupon taken off, to the paisa.
 * A 100% coupon's months were granted when it was applied, so it never
 * discounts a charge — the next one falls after them, at the full price.
 */
export function discountedCharge(amount: number, coupon: ActiveCoupon | null): number {
  if (!coupon || coupon.percentOff >= 100) return amount;
  return Math.round(amount * (100 - coupon.percentOff)) / 100;
}
