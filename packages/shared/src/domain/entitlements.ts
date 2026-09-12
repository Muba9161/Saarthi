/**
 * Subscription feature entitlements.
 *
 * The catalogue lives in shared code so the UI can hide what a plan does not
 * include, but every gated API route re-checks the entitlement server-side.
 * Plan → feature mapping is seeded into PostgreSQL (`plan_features`) from this
 * definition so it stays configurable at runtime without a code change.
 */

import { OrganizationType, PlanTier } from './enums';

export const Feature = {
  MAPS_2D: 'maps.2d',
  MAPS_3D: 'maps.3d',

  TRACKING_LIVE: 'tracking.live',
  TRACKING_HISTORY: 'tracking.history',
  TRACKING_REPLAY: 'tracking.replay',

  FLEET_BASIC: 'fleet.basic',
  FLEET_ANALYTICS: 'fleet.analytics',

  DRIVER_SCORING: 'driver.scoring',
  DRIVER_ACHIEVEMENTS: 'driver.achievements',

  DOCUMENTS_BASIC: 'documents.basic',
  DOCUMENTS_AUTOMATION: 'documents.automation',

  ORDERS_MARKETPLACE: 'orders.marketplace',
  TRIPS_BASIC: 'trips.basic',

  MAINTENANCE_BASIC: 'maintenance.basic',
  MAINTENANCE_PREDICTIVE: 'maintenance.predictive',

  ALERTS_BASIC: 'alerts.basic',
  ALERTS_SMART: 'alerts.smart',

  NEARBY_SERVICES: 'nearby.services',
  NEARBY_TRUCKS: 'nearby.trucks',
  SOS_NETWORK: 'sos.network',

  REPORTS_BASIC: 'reports.basic',
  REPORTS_ADVANCED: 'reports.advanced',

  AI_COPILOT: 'ai.copilot',
  AI_RECOMMENDATIONS: 'ai.recommendations',
  AI_BUSINESS_INTELLIGENCE: 'ai.business_intelligence',

  // Hardware / IoT
  HARDWARE_CONNECTIVITY: 'hardware.connectivity',
  TELEMETRY_LIVE: 'telemetry.live',
  TELEMETRY_HISTORY: 'telemetry.history',
  TELEMETRY_INTELLIGENCE: 'telemetry.intelligence',

  // Mobility & travel.
  //
  // These sit in the BASIC tier on purpose. Spec section 38 is explicit that
  // travel must not be forced into the fleet subscription model — a two-car
  // taxi operator monetises through the booking fee, not a fleet plan, so
  // gating package publishing behind Pro would price out the whole segment.
  TRAVEL_SERVICES: 'travel.services',
  TRAVEL_BOOKINGS: 'travel.bookings',

  // Association network — an enterprise-grade integration between the platform
  // and a district body, not a per-fleet feature.
  ASSOCIATION_NETWORK: 'association.network',

  // Images. Basic on purpose: a product where a supplier cannot photograph
  // their material, or a driver their damage, is not a product.
  MEDIA_LIBRARY: 'media.library',

  // Supplier stock. A supplier's core job, so it is not an upsell.
  INVENTORY_MANAGEMENT: 'inventory.management',

  // Used-vehicle marketplace. Browsing and buying grow the network and are
  // therefore Basic; publishing a listing is the monetisable side.
  RESALE_MARKETPLACE: 'resale.marketplace',
  RESALE_PUBLISH: 'resale.publish',

  QR_IDENTITY: 'qr.identity',

  // Vehicle finance. Basic on purpose: in this market the single-truck owner
  // with an EMI is the archetypal customer, not an enterprise upsell. Missing
  // an installment costs them the truck, so the reminder cannot sit behind a
  // paywall. Provider-backed sync is the part that costs money to run.
  // FASTag and toll. Basic, for the same reason as finance: toll is the second
  // largest running cost after diesel, and a fleet that cannot see it is losing
  // money it never sees leave.
  TOLL_FASTAG: 'toll.fastag',
  /** Live NETC lookup. The part that costs money per call. */
  TOLL_FASTAG_SYNC: 'toll.fastag.sync',

  FINANCE_LOANS: 'finance.loans',
  FINANCE_LOAN_SYNC: 'finance.loans.sync',

  // Backhaul matching — a margin feature, so it earns its Pro placement.
  RETURN_LOADS: 'returnloads.matching',

  // Knowing a heavy vehicle cannot enter a city is a compliance safety net.
  // Gating it would let a paying customer drive into a fine.
  CITY_ACCESS_INTELLIGENCE: 'cityaccess.intelligence',
  LAST_MILE_RELAY: 'relay.lastmile',

  // Hazard map and route-corridor analysis. Driver-facing safety alerts are
  // NOT gated by this — see ROUTE_INTELLIGENCE_ALERTS.
  ROUTE_INTELLIGENCE: 'routeintel.map',
  ROUTE_INTELLIGENCE_ALERTS: 'routeintel.alerts',

  API_ACCESS: 'api.access',
  SSO: 'auth.sso',
} as const;

export type Feature = (typeof Feature)[keyof typeof Feature];
export const ALL_FEATURES = Object.values(Feature) as Feature[];

export interface FeatureDefinition {
  key: Feature;
  name: string;
  description: string;
}

export const FEATURE_CATALOGUE: FeatureDefinition[] = [
  { key: Feature.MAPS_2D, name: '2D Maps', description: 'Standard 2D map experience.' },
  {
    key: Feature.MAPS_3D,
    name: '3D Maps',
    description: 'Tilted/terrain 3D map experience with fleet visualisation.',
  },
  { key: Feature.TRACKING_LIVE, name: 'Live tracking', description: 'Realtime truck positions.' },
  {
    key: Feature.TRACKING_HISTORY,
    name: 'Tracking history',
    description: 'Historical location trails.',
  },
  { key: Feature.TRACKING_REPLAY, name: 'Trip replay', description: 'Replay a completed trip.' },
  {
    key: Feature.FLEET_BASIC,
    name: 'Fleet management',
    description: 'Trucks, drivers, assignments.',
  },
  {
    key: Feature.FLEET_ANALYTICS,
    name: 'Fleet analytics',
    description: 'Utilisation, revenue and cost analytics.',
  },
  {
    key: Feature.DRIVER_SCORING,
    name: 'Driver scoring',
    description: 'Explainable driver performance scores.',
  },
  {
    key: Feature.DRIVER_ACHIEVEMENTS,
    name: 'Driver achievements',
    description: 'Career profile and badges.',
  },
  {
    key: Feature.DOCUMENTS_BASIC,
    name: 'Document management',
    description: 'Upload, verify and track documents.',
  },
  {
    key: Feature.DOCUMENTS_AUTOMATION,
    name: 'Document automation',
    description: 'Automated expiry detection and escalation.',
  },
  {
    key: Feature.ORDERS_MARKETPLACE,
    name: 'Marketplace',
    description: 'Customer requirements, quotes and matching.',
  },
  { key: Feature.TRIPS_BASIC, name: 'Trip management', description: 'Trip lifecycle management.' },
  {
    key: Feature.MAINTENANCE_BASIC,
    name: 'Maintenance',
    description: 'Maintenance records and schedules.',
  },
  {
    key: Feature.MAINTENANCE_PREDICTIVE,
    name: 'Predictive maintenance',
    description: 'Risk scoring and predicted service needs.',
  },
  { key: Feature.ALERTS_BASIC, name: 'Alerts', description: 'Operational alerts.' },
  {
    key: Feature.ALERTS_SMART,
    name: 'Smart alerts',
    description: 'Route deviation, delay and risk alerts.',
  },
  {
    key: Feature.NEARBY_SERVICES,
    name: 'Nearby services',
    description: 'Fuel, food, workshops and emergency POIs.',
  },
  {
    key: Feature.NEARBY_TRUCKS,
    name: 'Nearby Saarthi trucks',
    description: 'Privacy-aware nearby fleet discovery.',
  },
  { key: Feature.SOS_NETWORK, name: 'SOS network', description: 'Emergency responder network.' },
  { key: Feature.REPORTS_BASIC, name: 'Basic reports', description: 'Core operational reports.' },
  {
    key: Feature.REPORTS_ADVANCED,
    name: 'Advanced reports',
    description: 'Deep operational and financial reporting.',
  },
  { key: Feature.AI_COPILOT, name: 'AI Fleet Copilot', description: 'Conversational fleet Q&A.' },
  {
    key: Feature.AI_RECOMMENDATIONS,
    name: 'AI recommendations',
    description: 'Assignment, routing and maintenance suggestions.',
  },
  {
    key: Feature.AI_BUSINESS_INTELLIGENCE,
    name: 'AI business intelligence',
    description: 'Executive analysis and forecasting.',
  },
  {
    key: Feature.HARDWARE_CONNECTIVITY,
    name: 'Hardware connectivity',
    description: 'Register telematics devices and assign them to vehicles.',
  },
  {
    key: Feature.TELEMETRY_LIVE,
    name: 'Live telemetry',
    description: 'Realtime engine, fuel and motion data from connected hardware.',
  },
  {
    key: Feature.TELEMETRY_HISTORY,
    name: 'Telemetry history',
    description: 'Historical telemetry timeline and device history.',
  },
  {
    key: Feature.TELEMETRY_INTELLIGENCE,
    name: 'Telemetry intelligence',
    description: 'Anomaly detection and telemetry-driven maintenance rules.',
  },
  {
    key: Feature.TRAVEL_SERVICES,
    name: 'Travel & tours',
    description: 'Publish travel packages and manage passenger bookings.',
  },
  {
    key: Feature.TRAVEL_BOOKINGS,
    name: 'Travel booking',
    description: 'Search, compare and book travel across Saarthi providers.',
  },
  {
    key: Feature.ASSOCIATION_NETWORK,
    name: 'Association network',
    description: 'District truck-association emergency coordination.',
  },
  {
    key: Feature.MEDIA_LIBRARY,
    name: 'Image library',
    description: 'Photos on every record — profiles, vehicles, materials, deliveries and incidents.',
  },
  {
    key: Feature.INVENTORY_MANAGEMENT,
    name: 'Stock & availability',
    description: 'Yard-level stock, reservations against orders and a full movement ledger.',
  },
  {
    key: Feature.RESALE_MARKETPLACE,
    name: 'Used-vehicle marketplace',
    description: 'Browse and buy used vehicles from other verified Saarthi operators.',
  },
  {
    key: Feature.RESALE_PUBLISH,
    name: 'Sell vehicles',
    description: 'Publish your own vehicles for sale with a verified evidence pack.',
  },
  {
    key: Feature.TOLL_FASTAG,
    name: 'FASTag & toll',
    description: 'Tag status, balances, toll crossings and what each route actually costs.',
  },
  {
    key: Feature.TOLL_FASTAG_SYNC,
    name: 'NETC lookup',
    description: 'Pull live tag status and recent crossings from the NETC network.',
  },
  {
    key: Feature.FINANCE_LOANS,
    name: 'Loan & EMI',
    description: 'Vehicle loans, amortisation schedules, EMI reminders and repayment history.',
  },
  {
    key: Feature.FINANCE_LOAN_SYNC,
    name: 'Lender sync',
    description: 'Pull statements and balances from a supported finance provider.',
  },
  {
    key: Feature.QR_IDENTITY,
    name: 'QR identity',
    description: 'Printable QR codes for drivers and vehicles, with scoped scan resolution.',
  },
  {
    key: Feature.RETURN_LOADS,
    name: 'Return loads',
    description: 'Backhaul matching so trucks are not driven home empty.',
  },
  {
    key: Feature.CITY_ACCESS_INTELLIGENCE,
    name: 'City access rules',
    description: 'No-entry zones, time windows and permit requirements checked before dispatch.',
  },
  {
    key: Feature.LAST_MILE_RELAY,
    name: 'Last-mile relay',
    description: 'Hand a load to a small pickup at a transfer hub for delivery inside the city.',
  },
  {
    key: Feature.ROUTE_INTELLIGENCE,
    name: 'Road intelligence map',
    description: 'Signals, speed cameras, checkpoints and live road conditions on the map.',
  },
  {
    key: Feature.ROUTE_INTELLIGENCE_ALERTS,
    name: 'Driver hazard alerts',
    description: 'On-route warnings for cameras, checkpoints and hazards ahead.',
  },
  { key: Feature.API_ACCESS, name: 'API access', description: 'Programmatic API access.' },
  { key: Feature.SSO, name: 'SSO', description: 'Single sign-on integration.' },
];

/**
 * Capabilities that no subscription grants at any price.
 *
 * These need a fitted tracker, because they are the tracker: engine hours,
 * fuel draw, harsh-braking events and ignition state are read off hardware
 * wired into the vehicle. Selling them on a plan would be selling data that
 * does not exist until a device is on the vehicle, so they are unlocked by
 * `VEHICLE_TRACKER` instead — on either plan, since a person with one car has
 * exactly the same right to know what their engine is doing as a fleet does.
 */
const TRACKER_ONLY_FEATURES: Feature[] = [
  Feature.HARDWARE_CONNECTIVITY,
  Feature.TELEMETRY_LIVE,
  Feature.TELEMETRY_HISTORY,
  Feature.TELEMETRY_INTELLIGENCE,
];

/**
 * What a Personal subscription includes.
 *
 * The test for this list is "does an owner running his own two or three
 * vehicles need it to keep them on the road" — his documents, his EMI, his
 * toll, where the vehicle is, what the last service cost. Safety is in here
 * unconditionally: an SOS, a hazard alert and a no-entry warning are not
 * things to sell somebody at Rs 99, and a plan that withholds them is a plan
 * that lets a paying customer drive into a fine or sit out a breakdown alone.
 *
 * What is absent is the commercial network rather than depth: the marketplace,
 * requirements and bidding, a supplier catalogue, published tour packages, the
 * association queue, backhaul matching, AI and the analytics a dispatcher
 * needs. Somebody with three cars is not bidding on loads.
 */
/**
 * What a Free account includes.
 *
 * Free is not a cut-down fleet plan. It is the plan for somebody who does not
 * operate a vehicle at all: they look up what is nearby, say what they need,
 * compare the offers that come back, and follow the delivery or journey
 * somebody else is running. Everything here answers one of those.
 *
 * Read it for what it does *not* contain, because that is the rule this list
 * exists to enforce. There is no FLEET_BASIC, no MAINTENANCE_BASIC, no
 * TOLL_FASTAG, no FINANCE_LOANS and — above all — none of the tracker
 * capabilities, which are not merely withheld but meaningless: a Free account
 * has no vehicle for a tracker to be fitted to. That is why a Free user must
 * never be shown "Add vehicle" or "Connect tracker", and why
 * `accountRunsVehicles` answers false for this tier.
 *
 * `TRACKING_LIVE` is here and is not a contradiction. What a Free user tracks
 * is the order they placed — the carrier's vehicle on a map, which is exactly
 * what "Active Order Tracking" means — not a fleet of their own.
 */
const FREE_FEATURES: Feature[] = [
  Feature.MAPS_2D,
  // Nearby services and the location surface — the reason most Free accounts
  // exist at all.
  Feature.NEARBY_SERVICES,
  // Active order tracking: following the delivery somebody else is driving.
  Feature.TRACKING_LIVE,
  Feature.TRIPS_BASIC,
  // Posting a requirement and comparing the quotes that answer it.
  Feature.ORDERS_MARKETPLACE,
  // Booking a cab or a tour. Selling them is TRAVEL_SERVICES, which is
  // Business — see the note on the feature itself.
  Feature.TRAVEL_BOOKINGS,
  // A buyer's own paperwork: an invoice, a delivery note, a photograph of what
  // arrived. Nothing business-only lives here.
  Feature.DOCUMENTS_BASIC,
  Feature.MEDIA_LIBRARY,
  // Browsing the used-vehicle market grows the network, so it is not an
  // upsell. Publishing a listing (RESALE_PUBLISH) still is.
  Feature.RESALE_MARKETPLACE,
  Feature.ALERTS_BASIC,
];

const PERSONAL_FEATURES: Feature[] = [
  Feature.MAPS_2D,
  Feature.TRACKING_LIVE,
  Feature.TRACKING_HISTORY,
  Feature.TRACKING_REPLAY,
  Feature.FLEET_BASIC,
  Feature.TRIPS_BASIC,
  Feature.DOCUMENTS_BASIC,
  /*
   * How safely the vehicle is being driven, and by whom.
   *
   * On this plan that is very often the buyer himself — Personal is the plan
   * with "I drive one of my vehicles myself" on its registration form — and
   * charging somebody to see their own driving score is not a business Saarthi
   * should be in. It was withheld until now, so a man who bought Personal for
   * his own car, ticked that box and opened My score was told his own safety
   * record was not part of his plan.
   *
   * It is equally the answer to the question that actually keeps a small owner
   * awake: the plan covers up to six drivers, and knowing how the person
   * driving your car drives it is the same class of fact as knowing where it
   * is. The deep analytics that sit on top of this stay Business.
   */
  Feature.DRIVER_SCORING,
  Feature.MAINTENANCE_BASIC,
  Feature.REPORTS_BASIC,
  Feature.ALERTS_BASIC,
  Feature.MEDIA_LIBRARY,
  Feature.QR_IDENTITY,
  Feature.FINANCE_LOANS,
  Feature.TOLL_FASTAG,
  // Safety and compliance — never gated. See the note above.
  Feature.SOS_NETWORK,
  Feature.NEARBY_SERVICES,
  Feature.CITY_ACCESS_INTELLIGENCE,
  Feature.ROUTE_INTELLIGENCE_ALERTS,
  // Booking a cab or a tour is something an individual does; selling them is
  // not. Publishing packages is TRAVEL_SERVICES, which is Business.
  Feature.TRAVEL_BOOKINGS,
];

/**
 * What a Business subscription includes: everything the platform does, other
 * than the tracker-only capabilities above.
 *
 * Business is one plan rather than a ladder on purpose. Splitting the
 * commercial surface into tiers meant a fleet discovering mid-dispatch that
 * the screen it needed was two upgrades away — and the thing that actually
 * scales with an operator is the number of vehicles, which is already priced
 * per vehicle through `VEHICLE_TOPUP`.
 *
 * Derived rather than listed so a newly added capability is available to
 * paying commercial customers the day it ships, instead of silently sitting
 * behind a list nobody remembered to update.
 */
const BUSINESS_FEATURES: Feature[] = ALL_FEATURES.filter(
  (feature) => !TRACKER_ONLY_FEATURES.includes(feature),
);

export const PLAN_FEATURES: Record<PlanTier, Feature[]> = {
  [PlanTier.FREE]: FREE_FEATURES,
  [PlanTier.PERSONAL]: PERSONAL_FEATURES,
  [PlanTier.BUSINESS]: BUSINESS_FEATURES,
};

export interface PlanLimits {
  /**
   * Vehicles the plan itself covers. `null` means unlimited.
   *
   * This is the *base* figure, and it is one on both plans. What a tenant may
   * actually run is this plus their active `+1` top-ups — see
   * `effectiveVehicleLimit`, which is what the entitlement service resolves
   * and what every capacity check reads.
   */
  maxTrucks: number | null;
  /**
   * How many `+1 vehicle` top-ups may be held on top of the base plan.
   *
   * A ceiling exists on Personal because that plan is sold to a person rather
   * than to a business: somebody running twenty vehicles is running a
   * business, and should be on the plan that supports one.
   */
  maxVehicleTopUps: number;
  maxDrivers: number | null;
  maxMembers: number | null;
  trackingHistoryDays: number;
  aiRequestsPerDay: number;
  /**
   * Connected telematics devices.
   *
   * Resolved rather than fixed: one device may be registered per tracker the
   * tenant has actually bought, so the resolved entitlement carries the count
   * of active trackers and this figure is only the plan's starting point.
   * `maxTrackers` is the ceiling on buying them. A tenant with no tracker has
   * no device to register — which is the literal truth, not a paywall.
   */
  maxDevices: number | null;
  /** How many `VEHICLE_TRACKER` add-ons may be held. `null` = unlimited. */
  maxTrackers: number | null;
  /** How long normalised telemetry readings are retained. */
  telemetryRetentionDays: number;
}

/**
 * Capacity per plan.
 *
 * Both plans start at one vehicle, because that is the honest unit: a plan
 * bundling five vehicles overcharges the person with two and undercharges the
 * operator with nine. Extra vehicles are bought one at a time.
 *
 * A tenant already running more vehicles than their plan covers is never cut
 * off. Capacity is checked when *adding* a vehicle, so a lapsed top-up — or a
 * change to these very figures — can never strand an operator's fleet.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  /*
   * Free covers no vehicles, and that is a description rather than a limit to
   * upsell against. A Free account is somebody who does not operate a vehicle:
   * there is nothing to add, nothing to fit a tracker to, and no telemetry for
   * either to produce. Every figure below follows from that one fact.
   *
   * `maxVehicleTopUps: 0` is what stops the capacity screens offering a `+1`
   * to an account that has no zero-th vehicle, and `quoteSubscription` reads
   * the same zero to price Free at nothing rather than as a plan plus a
   * top-up.
   */
  [PlanTier.FREE]: {
    maxTrucks: 0,
    maxVehicleTopUps: 0,
    // A Free account employs nobody. Drivers belong to whoever runs the
    // vehicle they are driving.
    maxDrivers: 0,
    maxMembers: 1,
    // Nothing of this account's own is tracked, so there is no history of it
    // to retain. Following somebody else's delivery reads that carrier's trail
    // under the carrier's own plan.
    trackingHistoryDays: 0,
    aiRequestsPerDay: 0,
    maxDevices: 0,
    maxTrackers: 0,
    telemetryRetentionDays: 0,
  },
  [PlanTier.PERSONAL]: {
    maxTrucks: 1,
    // Four, so the archetype — an owner with three cars — fits with room to
    // spare, while a real fleet is pushed to Business rather than stacking
    // twenty top-ups on a plan that was never designed for it.
    maxVehicleTopUps: 4,
    // His own drivers, plus himself if he drives. Not a hiring pipeline.
    maxDrivers: 6,
    // A personal account is one person. Extra seats are what a business needs.
    maxMembers: 1,
    trackingHistoryDays: 90,
    aiRequestsPerDay: 0,
    // Replaced at resolution time by the number of trackers actually held.
    maxDevices: 0,
    maxTrackers: 5,
    telemetryRetentionDays: 90,
  },
  [PlanTier.BUSINESS]: {
    maxTrucks: 1,
    // Effectively unbounded: fleet size is priced per vehicle, so there is no
    // product reason to stop an operator adding the vehicles they run.
    maxVehicleTopUps: 999,
    maxDrivers: null,
    maxMembers: null,
    trackingHistoryDays: 365,
    aiRequestsPerDay: 200,
    maxDevices: 0,
    maxTrackers: null,
    telemetryRetentionDays: 365,
  },
};

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  description: string;
  /** Monthly price in INR. `null` = custom pricing. */
  priceMonthly: number | null;
  priceYearly: number | null;
  features: Feature[];
  limits: PlanLimits;
}

export const PLAN_CATALOGUE: PlanDefinition[] = [
  {
    tier: PlanTier.FREE,
    name: 'Saarthi Free',
    description:
      'For everything you need Saarthi for without running a vehicle. Find what is nearby, say what you need, compare the offers and follow your order to the door.',
    // Zero rather than null. `null` means negotiated pricing on this
    // catalogue, and a Free plan that renders as "custom pricing" is exactly
    // the wrong answer.
    priceMonthly: 0,
    priceYearly: 0,
    features: FREE_FEATURES,
    limits: PLAN_LIMITS[PlanTier.FREE],
  },
  {
    tier: PlanTier.PERSONAL,
    name: 'Saarthi Personal',
    description:
      'For the vehicles you own. Live location, documents, service history, EMI and toll — with the safety net included rather than sold.',
    priceMonthly: 99,
    priceYearly: 990,
    features: PERSONAL_FEATURES,
    limits: PLAN_LIMITS[PlanTier.PERSONAL],
  },
  {
    tier: PlanTier.BUSINESS,
    name: 'Saarthi Business',
    description:
      'The whole platform: marketplace and bidding, trips and dispatch, analytics, AI, travel, the association network and API access.',
    priceMonthly: 199,
    priceYearly: 1990,
    features: BUSINESS_FEATURES,
    limits: PLAN_LIMITS[PlanTier.BUSINESS],
  },
];

export function featuresForTier(tier: PlanTier): Feature[] {
  return PLAN_FEATURES[tier] ?? [];
}

export function tierHasFeature(tier: PlanTier, feature: Feature): boolean {
  return featuresForTier(tier).includes(feature);
}

/** The tiers in sell order — Free, then Personal, then Business. */
export const PLAN_TIER_ORDER: PlanTier[] = [
  PlanTier.FREE,
  PlanTier.PERSONAL,
  PlanTier.BUSINESS,
];

/**
 * Lowest tier that grants the feature — used for upgrade prompts.
 *
 * Returns `null` for the tracker-only capabilities, which no plan grants at
 * any price: they are unlocked by fitting hardware, not by upgrading. Callers
 * read that `null` as "this needs a tracker" rather than "this needs a better
 * plan", which is the difference between a useful prompt and a wrong one.
 */
export function minimumTierFor(feature: Feature): PlanTier | null {
  return PLAN_TIER_ORDER.find((tier) => tierHasFeature(tier, feature)) ?? null;
}

/** Whether this capability is unlocked by a fitted tracker rather than a plan. */
export function isTrackerFeature(feature: Feature): boolean {
  return TRACKER_ONLY_FEATURES.includes(feature);
}

/** The capabilities a tenant gains once at least one tracker is active. */
export function trackerFeatures(): Feature[] {
  return [...TRACKER_ONLY_FEATURES];
}

// ---------------------------------------------------------------------------
// What kind of account this is, and what that rules out
//
// A plan says what somebody bought. It does not say what they *do*, and on
// Business those are different questions: a freight fleet, a travel operator
// and a building-materials supplier all buy the same plan, and exactly one of
// them owns a vehicle. Gating on the plan alone is what put backhaul in front
// of a taxi operator and a tracker order in front of a supplier.
//
// So the resolved entitlement is the plan's features minus what this kind of
// business cannot use. Subtractive on purpose: a capability added to Business
// tomorrow reaches every business type unless it is named here, which is the
// safe direction for a list somebody has to remember to update.
// ---------------------------------------------------------------------------

/**
 * Capabilities that only mean anything to an account that operates a vehicle.
 *
 * Not a paywall - a description. A supplier has no odometer to read, no EMI on
 * a truck, no FASTag, no driver to score and no service due. Granting these to
 * them would put screens in the product that can only ever be empty, and the
 * permission layer refuses them anyway; this makes the entitlement say the
 * same thing the guards already do.
 */
const VEHICLE_OPERATOR_FEATURES: Feature[] = [
  Feature.FLEET_BASIC,
  Feature.FLEET_ANALYTICS,
  Feature.MAINTENANCE_BASIC,
  Feature.MAINTENANCE_PREDICTIVE,
  Feature.DRIVER_SCORING,
  Feature.DRIVER_ACHIEVEMENTS,
  Feature.TRACKING_HISTORY,
  Feature.TRACKING_REPLAY,
  Feature.TOLL_FASTAG,
  Feature.TOLL_FASTAG_SYNC,
  Feature.FINANCE_LOANS,
  Feature.FINANCE_LOAN_SYNC,
  Feature.NEARBY_TRUCKS,
  // Driver-facing on-route warnings. The hazard *map* is not here: a dispatcher
  // planning a delivery has a use for it whether or not they own the lorry.
  Feature.ROUTE_INTELLIGENCE_ALERTS,
  // Listed as well as being tracker-only, so that a tracker bought in error
  // against a supplier account grants nothing.
  ...TRACKER_ONLY_FEATURES,
];

/**
 * Heavy-freight capabilities, which belong to a fleet owner and nobody else.
 *
 * Backhaul is the return leg of a load, and the last-mile relay hands a
 * consignment to a smaller goods vehicle at a transfer hub. Both are
 * tonnes-and-loads concepts. A taxi operator has no empty return leg to sell
 * and no consignment to hand over, and showing them either is the bug this
 * list closes.
 */
const FREIGHT_ONLY_FEATURES: Feature[] = [Feature.RETURN_LOADS, Feature.LAST_MILE_RELAY];

/**
 * Publishing passenger travel - the mobility provider's own commercial surface.
 *
 * Excluded from everybody else to match `requireOrganizationType` on the
 * travel routes, which already refuses a freight fleet that tries to publish a
 * package. An entitlement that promised what the guard refuses would only
 * produce a menu entry leading to a 403.
 *
 * Booking a cab or a tour (`TRAVEL_BOOKINGS`) is deliberately *not* here:
 * anybody may be a passenger.
 */
const MOBILITY_ONLY_FEATURES: Feature[] = [Feature.TRAVEL_SERVICES];

/**
 * What each kind of business cannot use, whatever its plan grants.
 *
 * A type absent from this map loses nothing. `ENTERPRISE` is deliberately
 * absent for that reason - it is a fleet with a bigger contract, not a
 * different shape of business.
 */
const ORGANIZATION_TYPE_EXCLUSIONS: Partial<Record<OrganizationType, Feature[]>> = {
  // Runs vehicles, moves freight. Sells no passenger journeys.
  [OrganizationType.FLEET_OWNER]: [...MOBILITY_ONLY_FEATURES],
  // Runs vehicles, sells journeys. No backhaul, no load relay, no tonnage.
  [OrganizationType.MOBILITY_PROVIDER]: [...FREIGHT_ONLY_FEATURES],
  // Sells material. Owns no vehicle, employs no driver, fits no tracker.
  [OrganizationType.SUPPLIER]: [
    ...VEHICLE_OPERATOR_FEATURES,
    ...FREIGHT_ONLY_FEATURES,
    ...MOBILITY_ONLY_FEATURES,
  ],
  // Buys transport, material and travel. Operates none of it.
  [OrganizationType.CUSTOMER]: [
    ...VEHICLE_OPERATOR_FEATURES,
    ...FREIGHT_ONLY_FEATURES,
    ...MOBILITY_ONLY_FEATURES,
  ],
  // Coordinates roadside help for its members. It has an emergency queue and
  // its own profile; the members own the vehicles.
  [OrganizationType.TRUCK_ASSOCIATION]: [
    ...VEHICLE_OPERATOR_FEATURES,
    ...FREIGHT_ONLY_FEATURES,
    ...MOBILITY_ONLY_FEATURES,
  ],
};

/** What this kind of business cannot use, whatever its plan grants. */
export function featuresExcludedForOrganizationType(
  organizationType: OrganizationType | null | undefined,
): Feature[] {
  if (!organizationType) return [];
  return ORGANIZATION_TYPE_EXCLUSIONS[organizationType] ?? [];
}

/**
 * The features an account actually holds: its plan, narrowed to its shape.
 *
 * This is the single answer every surface should ask for. `featuresForTier`
 * remains the plan catalogue's own view and is still what gets seeded into
 * `plan_features`; this is that list once the kind of business is known.
 */
export function accountFeatures(input: {
  tier: PlanTier;
  organizationType?: OrganizationType | null;
  /** Defaults to the tier's catalogue features. Pass the resolved plan rows. */
  planFeatures?: Feature[];
}): Feature[] {
  const granted = input.planFeatures ?? featuresForTier(input.tier);
  const excluded = featuresExcludedForOrganizationType(input.organizationType);
  if (excluded.length === 0) return [...granted];
  return granted.filter((feature) => !excluded.includes(feature));
}

/**
 * Organization types that operate vehicles of their own.
 *
 * `ENTERPRISE` is here because it is a fleet. `CUSTOMER`, `SUPPLIER` and
 * `TRUCK_ASSOCIATION` are not, and that absence is the whole point: it is what
 * keeps Add vehicle, Connect tracker and the OBD flow out of an account that
 * has nothing to connect them to.
 */
export const VEHICLE_OPERATING_ORGANIZATION_TYPES: readonly OrganizationType[] = [
  OrganizationType.FLEET_OWNER,
  OrganizationType.MOBILITY_PROVIDER,
  OrganizationType.ENTERPRISE,
];

/**
 * Does this account enter the vehicle and tracker ecosystem at all?
 *
 * The one place that question is answered, because it is asked in at least
 * four: whether registration prices vehicles and trackers, whether the API
 * provisions them, whether capacity screens offer a `+1`, and whether the
 * onboarding path goes anywhere near the Driver App and OBD flow.
 *
 * Free is always false - a Free account does not run a vehicle, which is the
 * plan's defining characteristic rather than a restriction on it. Personal is
 * always true. Business depends entirely on the kind of business, so the type
 * must be supplied; an unknown type answers false, because a registration form
 * that has not yet been told what kind of business this is must not start by
 * asking how many trucks it has.
 */
export function accountRunsVehicles(input: {
  tier: PlanTier | null | undefined;
  organizationType?: OrganizationType | null;
}): boolean {
  if (input.tier === PlanTier.FREE) return false;
  if (input.tier === PlanTier.PERSONAL) return true;
  if (input.tier !== PlanTier.BUSINESS) return false;
  if (!input.organizationType) return false;
  return VEHICLE_OPERATING_ORGANIZATION_TYPES.includes(input.organizationType);
}

/**
 * Whether a Saarthi tracker can be sold to this account.
 *
 * The same question as `accountRunsVehicles`, deliberately - spec section 14 is
 * explicit that the tracker requirement follows the account type and not the
 * price of the plan. A tracker is fitted to a vehicle, so an account with no
 * vehicle has nowhere to fit one, and offering it hardware is selling
 * something that cannot be installed.
 */
export function accountUsesTracker(input: {
  tier: PlanTier | null | undefined;
  organizationType?: OrganizationType | null;
}): boolean {
  return accountRunsVehicles(input);
}

// ---------------------------------------------------------------------------
// Vehicle capacity, top-ups and the tracker add-on
// ---------------------------------------------------------------------------

/**
 * A `+1 vehicle` top-up.
 *
 * This is how fleet size is actually sold. Both plans cover one vehicle, and
 * every vehicle after that costs the same flat amount, so an operator with
 * nine trucks pays for nine and an owner with two pays for two. Nobody is ever
 * told that their next vehicle requires a different plan.
 */
export const VEHICLE_TOPUP = {
  key: 'vehicle_topup',
  name: '+1 Vehicle',
  description: 'Adds one vehicle or truck to your plan. Stack as many as you need.',
  /** Monthly price in INR, per vehicle. */
  priceMonthly: 75,
  /** Yearly price in INR, per vehicle — ten months for twelve. */
  priceYearly: 750,
} as const;

/**
 * The optional Saarthi tracker: hardware fitted to one vehicle.
 *
 * Charged once, per vehicle, rather than monthly. The reason is what the money
 * buys: a device and its fitting, not a service. Charging rent on a box already
 * screwed to somebody's truck is how an operator ends up with a tracker they
 * have stopped paying for and a dashboard that has gone blank.
 *
 * What it unlocks is `TRACKER_ONLY_FEATURES` — see the note there for why
 * those cannot be sold on a plan. It also raises the device allowance by one,
 * because a tracker *is* the device.
 */
export const VEHICLE_TRACKER = {
  key: 'vehicle_tracker',
  name: 'Saarthi Tracker',
  description:
    'A tracker fitted to one vehicle. Reads the vehicle itself rather than a phone, so the odometer, fuel, engine hours and trip history are measured instead of inferred.',
  /** One-time price in INR, per vehicle. There is no recurring charge. */
  priceOneTime: 499,
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

/**
 * What one vehicle costs per month on a given plan, including its top-up.
 *
 * The first vehicle is covered by the plan, so it costs the plan price; every
 * vehicle after that costs a top-up. Written once here because the pricing
 * page, the settings screen and the AI's answer to "what would ten vehicles
 * cost" must not each do this arithmetic slightly differently.
 */
export function monthlyCostFor(input: {
  tier: PlanTier;
  vehicles: number;
  billing?: 'monthly' | 'yearly';
}): number {
  const plan = PLAN_CATALOGUE.find((candidate) => candidate.tier === input.tier);
  if (!plan) return 0;

  const yearly = input.billing === 'yearly';
  const planPerMonth = yearly
    ? (plan.priceYearly ?? 0) / 12
    : (plan.priceMonthly ?? 0);
  const topUpPerMonth = yearly ? VEHICLE_TOPUP.priceYearly / 12 : VEHICLE_TOPUP.priceMonthly;

  // As in `quoteSubscription`: a plan that covers no vehicles and permits no
  // top-ups charges for none, rather than billing a `+1` for the first one.
  if ((plan.limits.maxTrucks ?? 1) === 0 && plan.limits.maxVehicleTopUps === 0) {
    return planPerMonth;
  }

  const extraVehicles = Math.max(0, Math.max(1, input.vehicles) - (plan.limits.maxTrucks ?? 1));
  return planPerMonth + extraVehicles * topUpPerMonth;
}

/**
 * GST on a Saarthi invoice.
 *
 * 18% covers both halves of what Saarthi sells: a SaaS subscription and a
 * tracker are each taxed at 18% in India, so one rate keeps the arithmetic
 * honest without pretending to be a tax engine. It lives here, named, because
 * a statutory rate changes by notification and must change in exactly one
 * place when it does.
 *
 * Every price in this catalogue is exclusive of it. That is deliberate: the
 * base figures are the ones quoted in marketing and the ones a business
 * reclaims as input credit, so mixing tax into them would corrupt both.
 */
export const GST_RATE = 0.18;

/** A charge, before tax, the tax, and what is actually paid. */
export interface QuoteTotals {
  /** Before GST. */
  subtotal: number;
  /** GST at `GST_RATE` on the subtotal. */
  gst: number;
  /** Subtotal plus GST — the figure that leaves the customer's account. */
  total: number;
}

/**
 * Apply GST to a subtotal.
 *
 * Rounded to paise rather than left as a float: this figure ends up in a
 * payment intent, and a charge is a definite amount of money rather than the
 * result of repeated binary arithmetic.
 */
export function withGst(subtotal: number): QuoteTotals {
  const gst = Math.round(subtotal * GST_RATE * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    gst,
    total: Math.round((subtotal + gst) * 100) / 100,
  };
}

export interface SubscriptionQuoteLine {
  label: string;
  detail: string;
  /** Before GST — the catalogue price, which is what an invoice itemises. */
  amount: number;
  /** `once` lines are excluded from the recurring total and never renew. */
  cadence: 'recurring' | 'once';
}

export interface SubscriptionQuote {
  tier: PlanTier;
  planName: string;
  billing: 'monthly' | 'yearly';
  vehicles: number;
  trackers: number;
  /** Top-ups implied by the vehicle count — one per vehicle past the first. */
  vehicleTopUps: number;
  /** Every charge, itemised before tax, in the order a bill would list them. */
  lines: SubscriptionQuoteLine[];
  gstRate: number;

  /** The recurring charge for the chosen period — a month, or a year. */
  recurring: QuoteTotals;
  /** The same recurring charge expressed per month, whichever period it is. */
  monthly: QuoteTotals;
  /** The trackers. Charged once and never renewed. */
  oneTime: QuoteTotals;
  /**
   * Just the add-ons: vehicle top-ups plus trackers, excluding the plan.
   *
   * What signup actually charges, because the plan itself is on trial at that
   * point. Kept as its own figure rather than recovered by subtracting the plan
   * from `dueNow` — a derived charge is one rounding change away from being
   * wrong by a rupee, and that rupee is somebody's money.
   */
  addOns: QuoteTotals;
  /**
   * The whole first invoice: the recurring charge plus the hardware.
   *
   * `dueNow.total` is the single number to put next to "total to pay".
   */
  dueNow: QuoteTotals;
  /** What renews after the first invoice, on the chosen period. */
  renews: QuoteTotals;

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
 * subscription screen and in what the API actually charges — and a customer
 * quoted one number and billed another has been mis-sold, however small the
 * discrepancy.
 *
 * Two separations run through the whole shape and neither is cosmetic:
 *
 *   • **recurring against one-time.** A tracker is hardware bought outright.
 *     Folding its price into a monthly figure would overstate what renews by
 *     the price of the hardware, every month, forever.
 *   • **subtotal against total.** The catalogue is exclusive of GST, because
 *     those are the figures quoted in marketing and reclaimed as input credit.
 *     The tax is added once, at the end, where it is visible.
 */
export function quoteSubscription(input: {
  tier: PlanTier;
  vehicles: number;
  trackers?: number;
  billing?: 'monthly' | 'yearly';
}): SubscriptionQuote {
  const plan =
    PLAN_CATALOGUE.find((candidate) => candidate.tier === input.tier) ??
    (PLAN_CATALOGUE[0] as PlanDefinition);

  const billing = input.billing === 'yearly' ? 'yearly' : 'monthly';
  const yearly = billing === 'yearly';

  const included = plan.limits.maxTrucks ?? 1;

  /*
   * A plan that covers no vehicles and permits no top-ups prices none.
   *
   * Free is such a plan. Without this the arithmetic below would read "0
   * included, 1 asked for" and bill a `+1 vehicle` top-up against an account
   * whose whole definition is that it runs no vehicle - quoting 75 rupees a
   * month for a plan the page calls free.
   */
  const vehicleless = included === 0 && plan.limits.maxVehicleTopUps === 0;

  const vehicles = vehicleless ? 0 : Math.max(1, Math.floor(input.vehicles));
  const vehicleTopUps = vehicleless ? 0 : Math.max(0, vehicles - included);
  // A tracker is fitted to a vehicle, so a plan with no vehicles takes none
  // however many the caller asked for.
  const trackers = vehicleless ? 0 : Math.max(0, Math.floor(input.trackers ?? 0));

  const planPrice = (yearly ? plan.priceYearly : plan.priceMonthly) ?? 0;
  const topUpPrice = yearly ? VEHICLE_TOPUP.priceYearly : VEHICLE_TOPUP.priceMonthly;
  const period = yearly ? 'year' : 'month';

  const lines: SubscriptionQuoteLine[] = [
    {
      label: plan.name,
      detail: vehicleless
        ? 'No vehicle needed'
        : `${included} vehicle included · per ${period}`,
      amount: planPrice,
      cadence: 'recurring',
    },
  ];

  if (vehicleTopUps > 0) {
    lines.push({
      label: `${VEHICLE_TOPUP.name} × ${vehicleTopUps}`,
      detail: `${topUpPrice} per vehicle, per ${period}`,
      amount: vehicleTopUps * topUpPrice,
      cadence: 'recurring',
    });
  }

  if (trackers > 0) {
    lines.push({
      label: `${VEHICLE_TRACKER.name} × ${trackers}`,
      detail: `${VEHICLE_TRACKER.priceOneTime} per vehicle, charged once`,
      amount: trackers * VEHICLE_TRACKER.priceOneTime,
      cadence: 'once',
    });
  }

  const topUpSubtotal = vehicleTopUps * topUpPrice;
  const recurringSubtotal = planPrice + topUpSubtotal;
  const oneTimeSubtotal = trackers * VEHICLE_TRACKER.priceOneTime;

  const vehicleCeiling =
    plan.limits.maxTrucks === null ? null : plan.limits.maxTrucks + plan.limits.maxVehicleTopUps;
  const trackerCeiling = plan.limits.maxTrackers;

  return {
    tier: plan.tier,
    planName: plan.name,
    billing,
    vehicles,
    trackers,
    vehicleTopUps,
    lines,
    gstRate: GST_RATE,

    recurring: withGst(recurringSubtotal),
    monthly: withGst(yearly ? recurringSubtotal / 12 : recurringSubtotal),
    oneTime: withGst(oneTimeSubtotal),
    addOns: withGst(topUpSubtotal + oneTimeSubtotal),
    dueNow: withGst(recurringSubtotal + oneTimeSubtotal),
    renews: withGst(recurringSubtotal),

    overVehicleCeiling: !vehicleless && vehicleCeiling !== null && vehicles > vehicleCeiling,
    vehicleCeiling,
    // A tracker per vehicle is the most that can be fitted, and the plan may
    // cap it lower still.
    overTrackerCeiling:
      trackers > vehicles || (trackerCeiling !== null && trackers > trackerCeiling),
  };
}

/**
 * Months of a yearly commitment that are free, from the real figures.
 *
 * Calculated rather than written into copy so the discount a pricing card
 * advertises cannot contradict the catalogue after a price change, and only
 * claimed when the plans and the top-up all agree on the same number.
 */
export function monthsFreeOnYearly(): number | null {
  const ratios = [
    ...PLAN_CATALOGUE.filter(
      (plan) => plan.priceMonthly !== null && plan.priceYearly !== null && plan.priceMonthly > 0,
    ).map((plan) => 12 - (plan.priceYearly as number) / (plan.priceMonthly as number)),
    12 - VEHICLE_TOPUP.priceYearly / VEHICLE_TOPUP.priceMonthly,
  ];
  if (ratios.length === 0) return null;

  const first = ratios[0] as number;
  return ratios.every((ratio) => Math.abs(ratio - first) < 0.01) ? Math.round(first) : null;
}
