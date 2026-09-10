import { PLAN_CATALOGUE, VEHICLE_TOPUP, VEHICLE_TRACKER, quoteSubscription } from '@saarthi/shared';
import { config } from '../../config/env';

/**
 * Demo Mode — showing a prospect what Saarthi does, without touching anything
 * real.
 *
 * ## Why this file is so small
 *
 * Because a demo should not have a backend. Everything a salesperson shows a
 * prospect — the fleet screens, the live map, trips, vehicle health, documents,
 * analytics — is the existing Saarthi UI, and the honest way to demonstrate it
 * is with the existing GPS simulator (`modules/simulation`), which already
 * exists, is already gated behind `DEMO_MODE`, and already refuses to boot in
 * production.
 *
 * So there is no demo data generator here, no fake vehicle, no shadow tenant
 * and no mirrored version of any screen. What this file provides is the
 * *guardrails and the script*: what the demo may and may not do, and the real
 * pricing to quote from — so the salesperson's screen is a labelled tour rather
 * than a second implementation of the product that will drift from the first.
 *
 * ## What Demo Mode must never do
 *
 * Enumerated below in `DEMO_PROHIBITIONS`, and enforced by construction rather
 * than by discipline: the salesman role holds no permission that could create a
 * subscription, take a payment, modify a vehicle, write telemetry, generate a
 * commission or change tracker state, and there is no route in this module that
 * accepts any of those. The prohibitions are stated in the payload as well
 * because they belong on the salesperson's screen, where the person who might
 * otherwise try is looking.
 */

export const DEMO_PROHIBITIONS: readonly string[] = Object.freeze([
  'No real subscription is created.',
  'No customer is charged.',
  'No real vehicle, driver or document is changed.',
  'No telemetry is written.',
  'No commission is generated.',
  'No tracker state is altered.',
]);

export interface DemoCapability {
  key: string;
  label: string;
  /** Where the existing Saarthi screen lives. Reused, never rebuilt. */
  route: string;
  /** What the salesperson should say while it is on screen. */
  talkingPoint: string;
  /** True when this screen needs the simulator running to show movement. */
  needsSimulator: boolean;
}

/**
 * The tour, in the order it makes sense to a fleet owner.
 *
 * Ordered from what the owner already worries about towards what they have not
 * thought of: where are my lorries, who is driving them, what is going wrong,
 * what is it costing. Each entry points at the *real* route, so a screen that
 * is improved next month improves the demo too.
 */
export const DEMO_CAPABILITIES: readonly DemoCapability[] = Object.freeze([
  {
    key: 'LIVE_MAP',
    label: 'Live map',
    route: '/tracking',
    talkingPoint:
      'Every vehicle, where it is now. This is the screen an owner opens twenty times a day, ' +
      'and it is the one that replaces the phone call to the driver.',
    needsSimulator: true,
  },
  {
    key: 'VEHICLES',
    label: 'Vehicles',
    route: '/fleet/trucks',
    talkingPoint:
      'One row per vehicle, with its paperwork, its servicing and its running cost attached. ' +
      'Nothing here lives in a different register or a different notebook.',
    needsSimulator: false,
  },
  {
    key: 'DRIVERS',
    label: 'Drivers',
    route: '/fleet/drivers',
    talkingPoint:
      'Who is licensed, whose licence expires next month, and who is driving well. The score is ' +
      'built from how the vehicle was actually driven, not from opinion.',
    needsSimulator: false,
  },
  {
    key: 'TRIPS',
    label: 'Trips',
    route: '/trips',
    talkingPoint:
      'Where each vehicle went, how long it stood, and what the trip cost. This is where a ' +
      'dispute with a customer about a delay gets settled.',
    needsSimulator: true,
  },
  {
    key: 'VEHICLE_HEALTH',
    label: 'Vehicle health',
    route: '/telemetry/alerts',
    talkingPoint:
      'The vehicle tells Saarthi when something is wrong — a fault code, a coolant temperature, ' +
      'a battery going flat — before the driver notices it.',
    needsSimulator: true,
  },
  {
    key: 'DOCUMENTS',
    label: 'Documents',
    route: '/fleet/documents',
    talkingPoint:
      'Insurance, fitness, permit, PUC. Saarthi warns you before one expires, which is cheaper ' +
      'than the fine.',
    needsSimulator: false,
  },
  {
    key: 'ANALYTICS',
    label: 'Analytics',
    route: '/analytics',
    talkingPoint:
      'Fuel, tolls, servicing and EMIs per vehicle. The question this answers is which lorry is ' +
      'making money and which one is not.',
    needsSimulator: false,
  },
]);

export interface DemoScript {
  /** Server-confirmed. False means the tour is available but nothing will move. */
  demoModeEnabled: boolean;
  capabilities: readonly DemoCapability[];
  prohibitions: readonly string[];
  /** Real catalogue pricing, so nobody quotes a figure from memory. */
  pricing: {
    plans: {
      tier: string;
      name: string;
      priceMonthly: number | null;
      priceYearly: number | null;
    }[];
    trackerOneTime: number;
    vehicleTopUpMonthly: number;
    /** A worked example the salesperson can read out. */
    example: {
      vehicles: number;
      trackers: number;
      tier: string;
      billing: string;
      monthlyTotal: number;
      oneOffTotal: number;
    };
  };
  /** How the salesperson should introduce it, and the label the UI must show. */
  notice: string;
}

/**
 * What the demo screen needs to render itself.
 *
 * The pricing block is the part that earns its place: it is computed from the
 * same `quoteSubscription` the pricing card and the signup order use, so the
 * figure a salesperson quotes in a yard is the figure the customer will be
 * charged. A demo screen with its own hard-coded prices is a demo screen that
 * eventually misquotes somebody.
 */
export function demoScript(): DemoScript {
  const example = quoteSubscription({
    tier: PLAN_CATALOGUE[1]?.tier ?? PLAN_CATALOGUE[0]!.tier,
    vehicles: 10,
    trackers: 10,
    billing: 'monthly',
  });

  return {
    demoModeEnabled: config.demo.enabled,
    capabilities: DEMO_CAPABILITIES,
    prohibitions: DEMO_PROHIBITIONS,
    pricing: {
      plans: PLAN_CATALOGUE.map((plan) => ({
        tier: plan.tier,
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
      })),
      trackerOneTime: VEHICLE_TRACKER.priceOneTime,
      vehicleTopUpMonthly: VEHICLE_TOPUP.priceMonthly,
      example: {
        vehicles: 10,
        trackers: 10,
        tier: PLAN_CATALOGUE[1]?.tier ?? PLAN_CATALOGUE[0]!.tier,
        billing: 'monthly',
        // `monthly` rather than `recurring`, so the figure is per month
        // whichever billing period the example uses; `oneTime` is the hardware,
        // which never renews.
        monthlyTotal: example.monthly.total,
        oneOffTotal: example.oneTime.total,
      },
    },
    notice:
      'Demo Mode. Nothing on these screens belongs to a real Saarthi customer, and nothing you ' +
      'do here charges anyone or changes any vehicle.',
  };
}
