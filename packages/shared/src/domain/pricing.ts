/**
 * The commercial layer: what Saarthi charges and how a charge is taxed.
 *
 * Every price a customer sees is a final, GST-inclusive figure rounded up to
 * end in 9 — the plans (₹119, ₹239, ₹179), a `+1 vehicle` top-up (₹99) and the
 * trackers (₹709, ₹2,359). That figure is what is shown, what is charged and,
 * for a subscription, what renews. The GST inside it is recovered only for the
 * invoice — see `inclusiveOfGst`.
 *
 * A tracker keeps its base price (`priceOneTime`, before GST) as the figure it
 * is catalogued and invoiced at; its customer price is derived from it by
 * `trackerFinalPrice`, so the two can never drift apart.
 *
 * Billing is monthly only.
 */

import { PlanTier, TrackerProduct } from './enums';
import { PLAN_CATALOGUE, PLAN_LIMITS, type PlanDefinition } from './entitlements';

/**
 * The free trial on every paid plan, in days.
 *
 * The default only: the API reads `SUBSCRIPTION_TRIAL_DAYS` and the pricing
 * page `VITE_SUBSCRIPTION_TRIAL_DAYS`, both falling back to this, so the two
 * cannot quote different periods when neither is set.
 */
export const DEFAULT_TRIAL_DAYS = 30;

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

/**
 * GST on a Saarthi invoice.
 *
 * 18% covers both halves of what Saarthi sells: a SaaS subscription and a
 * tracker. It lives here, named, because a statutory rate changes by
 * notification and must change in exactly one place when it does.
 */
export const GST_RATE = 0.18;

/** A charge split into its taxable value, the tax, and what is actually paid. */
export interface QuoteTotals {
  /** Taxable value, before GST. */
  subtotal: number;
  /** GST at `GST_RATE`. */
  gst: number;
  /** What leaves the customer's account. */
  total: number;
}

const toPaise = (amount: number): number => Math.round(amount * 100) / 100;

/** Add GST to a GST-exclusive price. */
export function withGst(subtotal: number): QuoteTotals {
  const gst = toPaise(subtotal * GST_RATE);
  return { subtotal: toPaise(subtotal), gst, total: toPaise(subtotal + gst) };
}

/**
 * Split a GST-inclusive price into taxable value and tax — how a subscription
 * is invoiced. The total is never changed: ₹119 charged is ₹119 paid.
 */
export function inclusiveOfGst(total: number): QuoteTotals {
  const subtotal = toPaise(total / (1 + GST_RATE));
  return { subtotal, gst: toPaise(total - subtotal), total: toPaise(total) };
}

/**
 * Round a price up to the next whole rupee ending in 9 — how every Saarthi
 * price is presented and charged. ₹116.82 → ₹119, ₹706.82 → ₹709.
 */
export function roundUpToNine(amount: number): number {
  const whole = Math.ceil(amount - 1e-9);
  return whole + ((9 - (whole % 10) + 10) % 10);
}

export function sumTotals(...parts: QuoteTotals[]): QuoteTotals {
  return parts.reduce<QuoteTotals>(
    (sum, part) => ({
      subtotal: toPaise(sum.subtotal + part.subtotal),
      gst: toPaise(sum.gst + part.gst),
      total: toPaise(sum.total + part.total),
    }),
    { subtotal: 0, gst: 0, total: 0 },
  );
}

// ---------------------------------------------------------------------------
// Vehicle capacity and top-ups
// ---------------------------------------------------------------------------

/**
 * A `+1 vehicle` top-up.
 *
 * This is how fleet size is sold. Personal and Business each include one
 * vehicle, and every vehicle after that costs the same flat monthly amount, so
 * nobody is told that their next vehicle requires a different plan.
 */
export const VEHICLE_TOPUP = {
  key: 'vehicle_topup',
  name: '+1 Vehicle',
  description: 'Adds one vehicle to your plan. Stack as many as you need.',
  /** Monthly price in INR, per vehicle, GST included. */
  priceMonthly: 99,
} as const;

/**
 * What a tenant may actually run: the plan's capacity plus its active top-ups.
 *
 * An unlimited base stays unlimited — adding top-ups to `null` would be a
 * category error, and charging for them would be worse.
 */
export function effectiveVehicleLimit(
  baseLimit: number | null,
  activeTopUps: number,
): number | null {
  if (baseLimit === null) return null;
  return baseLimit + Math.max(0, activeTopUps);
}

/** Whether another top-up may be bought on this plan. */
export function canAddVehicleTopUp(tier: PlanTier, activeTopUps: number): boolean {
  const ceiling = PLAN_LIMITS[tier]?.maxVehicleTopUps ?? 0;
  return activeTopUps < ceiling;
}

export interface VehicleCapacity {
  /** Vehicles the plan covers before top-ups. `null` = unlimited. */
  baseLimit: number | null;
  activeTopUps: number;
  /** `baseLimit + activeTopUps`, or `null` when unlimited. */
  effectiveLimit: number | null;
  used: number;
  /** `null` when unlimited. Never negative — see the note on over-capacity. */
  remaining: number | null;
  /**
   * True when the tenant is already at or above what they may run.
   *
   * Reachable without anyone doing anything wrong: a lapsed top-up or a plan
   * downgrade leaves an operator over capacity with vehicles that keep working.
   * They simply cannot add another until they upgrade or top up.
   */
  atCapacity: boolean;
  canPurchaseTopUp: boolean;
  topUpCeiling: number;
}

export function describeVehicleCapacity(input: {
  tier: PlanTier;
  baseLimit: number | null;
  activeTopUps: number;
  used: number;
}): VehicleCapacity {
  const effectiveLimit = effectiveVehicleLimit(input.baseLimit, input.activeTopUps);
  return {
    baseLimit: input.baseLimit,
    activeTopUps: input.activeTopUps,
    effectiveLimit,
    used: input.used,
    remaining: effectiveLimit === null ? null : Math.max(0, effectiveLimit - input.used),
    atCapacity: effectiveLimit !== null && input.used >= effectiveLimit,
    canPurchaseTopUp: canAddVehicleTopUp(input.tier, input.activeTopUps),
    topUpCeiling: PLAN_LIMITS[input.tier]?.maxVehicleTopUps ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Tracker hardware
// ---------------------------------------------------------------------------

export interface TrackerProductDefinition {
  product: TrackerProduct;
  name: string;
  /** How the unit gets its data out. */
  connectivity: string;
  description: string;
  /** One-time base price in INR, per vehicle, before GST — the invoice figure. */
  priceOneTime: number;
  /** What the customer pays, once: base + 18% GST, rounded up to end in 9. */
  price: number;
}

/** A tracker's customer price from its base: GST added, rounded up to end in 9. */
export function trackerFinalPrice(basePrice: number): number {
  return roundUpToNine(basePrice * (1 + GST_RATE));
}

/** What one tracker charges, split for the invoice. `basePrice` is `pricePaid` on the row. */
export function trackerCharge(basePrice: number): QuoteTotals {
  return inclusiveOfGst(trackerFinalPrice(basePrice));
}

/**
 * The Saarthi trackers on sale.
 *
 * Charged once, per vehicle, rather than monthly: the money buys a device and
 * its fitting, not a service. What a tracker unlocks is the telemetry surface
 * (`trackerFeatures`), on any plan whose account runs vehicles.
 */
export const TRACKER_PRODUCTS: readonly TrackerProductDefinition[] = [
  {
    product: TrackerProduct.OBD_BLUETOOTH,
    name: 'Saarthi OBD',
    connectivity: 'Bluetooth',
    description:
      'Plugs into the vehicle’s OBD port and reports through the Saarthi Driver App over Bluetooth.',
    priceOneTime: 599,
    price: trackerFinalPrice(599),
  },
  {
    product: TrackerProduct.CONNECTED_4G,
    name: 'Saarthi 4G Tracker',
    connectivity: '4G',
    description:
      'Carries its own 4G connection, so the vehicle reports live even when no phone is on board.',
    priceOneTime: 1999,
    price: trackerFinalPrice(1999),
  },
];

export const DEFAULT_TRACKER_PRODUCT = TrackerProduct.OBD_BLUETOOTH;

export function trackerProduct(product: TrackerProduct): TrackerProductDefinition {
  return (
    TRACKER_PRODUCTS.find((definition) => definition.product === product) ??
    (TRACKER_PRODUCTS[0] as TrackerProductDefinition)
  );
}

/** "Saarthi OBD ₹709 or Saarthi 4G Tracker ₹2359" — for messages. */
export function describeTrackerPrices(): string {
  return TRACKER_PRODUCTS.map((product) => `${product.name} ₹${product.price}`).join(
    ' or ',
  );
}

/**
 * Whether another tracker may be bought.
 *
 * Two ceilings apply, and the tighter one wins. The plan's `maxTrackers` stops
 * a personal account from being used to fit out a fleet; the vehicle count
 * stops anybody buying a fifth tracker for four vehicles, which would be
 * charging for hardware with nothing to fit it to.
 */
export function canAddVehicleTracker(input: {
  tier: PlanTier;
  activeTrackers: number;
  vehicleCount: number;
}): boolean {
  const ceiling = PLAN_LIMITS[input.tier]?.maxTrackers;
  if (ceiling !== null && ceiling !== undefined && input.activeTrackers >= ceiling) return false;
  return input.activeTrackers < Math.max(input.vehicleCount, 1);
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

/**
 * What a fleet costs per month on a plan: the plan covers its included
 * vehicles, and every vehicle after that is a top-up. GST included.
 */
export function monthlyCostFor(input: { tier: PlanTier; vehicles: number }): number {
  return quoteSubscription(input).monthly.total;
}

export interface SubscriptionQuoteLine {
  label: string;
  detail: string;
  /** The price as the customer is quoted it — see `taxIncluded`. */
  amount: number;
  /** True for subscription lines (GST inside `amount`), false for hardware. */
  taxIncluded: boolean;
  /** `once` lines are excluded from the monthly total and never renew. */
  cadence: 'monthly' | 'once';
}

export interface SubscriptionQuote {
  tier: PlanTier;
  planName: string;
  vehicles: number;
  trackers: number;
  trackerProduct: TrackerProduct;
  /** Top-ups implied by the vehicle count — one per vehicle past the included ones. */
  vehicleTopUps: number;
  /** Every charge, itemised in the order a bill would list them. */
  lines: SubscriptionQuoteLine[];
  gstRate: number;

  /** The monthly subscription: plan plus top-ups, GST included. Also what renews. */
  monthly: QuoteTotals;
  /** The trackers, GST inside their final price. Charged once and never renewed. */
  oneTime: QuoteTotals;
  /**
   * Just the add-ons: vehicle top-ups plus trackers, excluding the plan.
   *
   * What signup actually charges, because the plan itself is on trial at that
   * point. Its own figure rather than recovered by subtraction, so no rounding
   * can put it a rupee out.
   */
  addOns: QuoteTotals;
  /** The whole first invoice: the monthly subscription plus the hardware. */
  dueNow: QuoteTotals;

  /** True when the plan cannot hold this many vehicles. */
  overVehicleCeiling: boolean;
  /** Vehicles the plan can hold at most, top-ups included. `null` = no limit. */
  vehicleCeiling: number | null;
  /** True when more trackers were asked for than the plan or fleet allows. */
  overTrackerCeiling: boolean;
}

/**
 * The complete cost of a configuration: itemised, taxed and totalled.
 *
 * One function rather than arithmetic repeated per surface, because the same
 * total has to appear on the pricing card, on the signup summary, on the
 * subscription screen and in what the API actually charges.
 *
 * Monthly subscription and one-time hardware stay separate throughout: folding
 * a tracker into the monthly figure would overstate what renews, every month.
 */
export function quoteSubscription(input: {
  tier: PlanTier;
  vehicles: number;
  trackers?: number;
  trackerProduct?: TrackerProduct;
}): SubscriptionQuote {
  const plan =
    PLAN_CATALOGUE.find((candidate) => candidate.tier === input.tier) ??
    (PLAN_CATALOGUE[0] as PlanDefinition);
  const tracker = trackerProduct(input.trackerProduct ?? DEFAULT_TRACKER_PRODUCT);

  const included = plan.limits.maxTrucks ?? 1;

  /*
   * A plan that covers no vehicles and permits no top-ups prices none — Free
   * and Supplier. Without this the arithmetic below would read "0 included, 1
   * asked for" and bill a top-up against an account that runs no vehicle.
   */
  const vehicleless = included === 0 && plan.limits.maxVehicleTopUps === 0;

  const vehicles = vehicleless ? 0 : Math.max(1, Math.floor(input.vehicles));
  const vehicleTopUps = vehicleless ? 0 : Math.max(0, vehicles - included);
  // A tracker is fitted to a vehicle, so a plan with no vehicles takes none.
  const trackers = vehicleless ? 0 : Math.max(0, Math.floor(input.trackers ?? 0));

  const planPrice = plan.priceMonthly ?? 0;

  const lines: SubscriptionQuoteLine[] = [
    {
      label: plan.name,
      detail: vehicleless ? 'No vehicle needed' : `${included} vehicle included · per month`,
      amount: planPrice,
      taxIncluded: true,
      cadence: 'monthly',
    },
  ];

  if (vehicleTopUps > 0) {
    lines.push({
      label: `${VEHICLE_TOPUP.name} × ${vehicleTopUps}`,
      detail: `₹${VEHICLE_TOPUP.priceMonthly} per vehicle, per month`,
      amount: vehicleTopUps * VEHICLE_TOPUP.priceMonthly,
      taxIncluded: true,
      cadence: 'monthly',
    });
  }

  if (trackers > 0) {
    lines.push({
      label: `${tracker.name} × ${trackers}`,
      detail: `₹${tracker.price} per vehicle, charged once`,
      amount: trackers * tracker.price,
      taxIncluded: true,
      cadence: 'once',
    });
  }

  const planTotals = inclusiveOfGst(planPrice);
  const topUpTotals = inclusiveOfGst(vehicleTopUps * VEHICLE_TOPUP.priceMonthly);
  const trackerTotals = inclusiveOfGst(trackers * tracker.price);
  const monthly = sumTotals(planTotals, topUpTotals);

  const vehicleCeiling =
    plan.limits.maxTrucks === null ? null : plan.limits.maxTrucks + plan.limits.maxVehicleTopUps;
  const trackerCeiling = plan.limits.maxTrackers;

  return {
    tier: plan.tier,
    planName: plan.name,
    vehicles,
    trackers,
    trackerProduct: tracker.product,
    vehicleTopUps,
    lines,
    gstRate: GST_RATE,

    monthly,
    oneTime: trackerTotals,
    addOns: sumTotals(topUpTotals, trackerTotals),
    dueNow: sumTotals(monthly, trackerTotals),

    overVehicleCeiling: !vehicleless && vehicleCeiling !== null && vehicles > vehicleCeiling,
    vehicleCeiling,
    // A tracker per vehicle is the most that can be fitted, and the plan may
    // cap it lower still.
    overTrackerCeiling:
      trackers > vehicles || (trackerCeiling !== null && trackers > trackerCeiling),
  };
}
