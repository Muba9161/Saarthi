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
  /** Sharing a vehicle with another Saarthi account, and receiving one. */
  VEHICLE_SHARING: 'fleet.sharing',

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
    key: Feature.VEHICLE_SHARING,
    name: 'Vehicle sharing',
    description:
      'Share a vehicle with up to three other Saarthi accounts, who can track it and add its trips, fuel and maintenance.',
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
 * a tracker (`TRACKER_PRODUCTS`) instead — on any plan, since a person with one car has
 * exactly the same right to know what their engine is doing as a fleet does.
 */
const TRACKER_ONLY_FEATURES: Feature[] = [
  Feature.HARDWARE_CONNECTIVITY,
  Feature.TELEMETRY_LIVE,
  Feature.TELEMETRY_HISTORY,
  Feature.TELEMETRY_INTELLIGENCE,
];

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

/**
 * What every paid plan includes: everything the platform does, other than the
 * tracker-only capabilities above.
 *
 * Personal, Business and Supplier share this list on purpose. A plan is the
 * commercial layer, not a feature ladder, so a cheaper plan never withholds
 * functionality. What an account can actually use is this list narrowed by its
 * account type (`accountFeatures`) and by the resources it holds — telemetry
 * appears only once there is a tracker, and nothing vehicle-shaped reaches an
 * account that runs no vehicle.
 *
 * Derived rather than listed so a newly added capability is available to
 * paying customers the day it ships.
 */
const PAID_PLAN_FEATURES: Feature[] = ALL_FEATURES.filter(
  (feature) => !TRACKER_ONLY_FEATURES.includes(feature),
);

/**
 * What a lapsed (expired or cancelled) subscription keeps.
 *
 * Not a plan: it is the floor an unpaid account falls to, so a tenant never
 * loses sight of their own records, and never loses the safety net, over a
 * lapsed card. Narrowed by account type like any other list, so a supplier's
 * floor carries nothing vehicle-shaped.
 */
export const LAPSED_FEATURES: Feature[] = [
  ...FREE_FEATURES,
  Feature.FLEET_BASIC,
  Feature.TRACKING_HISTORY,
  Feature.TRACKING_REPLAY,
  Feature.DRIVER_SCORING,
  Feature.MAINTENANCE_BASIC,
  Feature.REPORTS_BASIC,
  Feature.QR_IDENTITY,
  Feature.FINANCE_LOANS,
  Feature.TOLL_FASTAG,
  Feature.SOS_NETWORK,
  Feature.CITY_ACCESS_INTELLIGENCE,
  Feature.ROUTE_INTELLIGENCE_ALERTS,
];

export const PLAN_FEATURES: Record<PlanTier, Feature[]> = {
  [PlanTier.FREE]: FREE_FEATURES,
  [PlanTier.PERSONAL]: PAID_PLAN_FEATURES,
  [PlanTier.BUSINESS]: PAID_PLAN_FEATURES,
  [PlanTier.SUPPLIER]: PAID_PLAN_FEATURES,
};

export interface PlanLimits {
  /**
   * Vehicles the plan itself covers. `null` means unlimited.
   *
   * This is the *base* figure: one on Personal and Business, none on Free and
   * Supplier. What a tenant may
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
  /** How many trackers (`TRACKER_PRODUCTS`) may be held. `null` = unlimited. */
  maxTrackers: number | null;
  /** How long normalised telemetry readings are retained. */
  telemetryRetentionDays: number;
}

/**
 * Capacity per plan.
 *
 * Vehicle plans start at one vehicle, because that is the honest unit: a plan
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
    // Retention and AI match Business: a cheaper plan does not degrade a
    // capability, only the commercial quantities above.
    trackingHistoryDays: 365,
    aiRequestsPerDay: 200,
    // Replaced at resolution time by the number of trackers actually held.
    maxDevices: 0,
    maxTrackers: 5,
    telemetryRetentionDays: 365,
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
  /*
   * A supplier sells material and runs no vehicle, so every vehicle-shaped
   * figure is zero — a description, exactly as on Free. The team and the AI
   * are the supplier's own and are not capped.
   */
  [PlanTier.SUPPLIER]: {
    maxTrucks: 0,
    maxVehicleTopUps: 0,
    maxDrivers: 0,
    maxMembers: null,
    trackingHistoryDays: 365,
    aiRequestsPerDay: 200,
    maxDevices: 0,
    maxTrackers: 0,
    telemetryRetentionDays: 0,
  },
};

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  description: string;
  /**
   * Monthly price in INR, GST included — the amount the customer pays and the
   * figure every pricing surface shows. `null` = custom pricing. The GST inside
   * it is recovered only for invoices; see `inclusiveOfGst`.
   */
  priceMonthly: number | null;
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
    features: FREE_FEATURES,
    limits: PLAN_LIMITS[PlanTier.FREE],
  },
  {
    tier: PlanTier.PERSONAL,
    name: 'Saarthi Personal',
    description:
      'For your own car, SUV, two-wheeler or other personal vehicle. Drive it yourself or hand it to a driver — a tracker is optional.',
    priceMonthly: 119,
    features: PAID_PLAN_FEATURES,
    limits: PLAN_LIMITS[PlanTier.PERSONAL],
  },
  {
    tier: PlanTier.BUSINESS,
    name: 'Saarthi Business',
    description:
      'For fleet owners running trucks and for tour, travel and mobility providers running passenger vehicles.',
    priceMonthly: 239,
    features: PAID_PLAN_FEATURES,
    limits: PLAN_LIMITS[PlanTier.BUSINESS],
  },
  {
    tier: PlanTier.SUPPLIER,
    name: 'Saarthi Supplier',
    description:
      'For material suppliers. Catalogue, stock, requirements and orders — no vehicle or fleet setup needed.',
    priceMonthly: 179,
    features: PAID_PLAN_FEATURES,
    limits: PLAN_LIMITS[PlanTier.SUPPLIER],
  },
];

/**
 * Whether a Personal account holder must have verified their own Aadhaar
 * before adding one more vehicle.
 *
 * The vehicles the plan itself includes go on without it, so somebody who has
 * just signed up can put their car on the road straight away. The check starts
 * at the first vehicle beyond them — the one a +1 top-up pays for.
 *
 * Takes every vehicle the account has *ever* added, archived ones included.
 * The allowance is spent once: removing the free vehicle does not hand it
 * back, or adding and removing would skip the check indefinitely.
 */
export function personalVehicleNeedsAadhaar(vehiclesEverAdded: number): boolean {
  const included = PLAN_LIMITS[PlanTier.PERSONAL].maxTrucks;
  return included !== null && vehiclesEverAdded >= included;
}

/**
 * The same rule for trackers: the first one — the included vehicle's — is
 * bought and fitted without Aadhaar, and the check starts at the next. Counted
 * over every tracker ever granted, retired or refunded ones included.
 */
export function personalTrackerNeedsAadhaar(trackersEverGranted: number): boolean {
  return personalVehicleNeedsAadhaar(trackersEverGranted);
}

export function featuresForTier(tier: PlanTier): Feature[] {
  return PLAN_FEATURES[tier] ?? [];
}

export function tierHasFeature(tier: PlanTier, feature: Feature): boolean {
  return featuresForTier(tier).includes(feature);
}

/** The tiers in price order — Free, Personal, Supplier, Business. */
export const PLAN_TIER_ORDER: PlanTier[] = [
  PlanTier.FREE,
  PlanTier.PERSONAL,
  PlanTier.SUPPLIER,
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
  // Sharing a vehicle, or receiving one, is still running one.
  Feature.VEHICLE_SHARING,
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
 * Free and Supplier are always false - neither runs a vehicle, which is what
 * those plans are rather than a restriction on them. Personal is always true.
 * Business depends entirely on the kind of business, so the type must be
 * supplied; an unknown type answers false, because a registration form that
 * has not yet been told what kind of business this is must not start by asking
 * how many trucks it has.
 */
export function accountRunsVehicles(input: {
  tier: PlanTier | null | undefined;
  organizationType?: OrganizationType | null;
}): boolean {
  if (input.tier === PlanTier.FREE || input.tier === PlanTier.SUPPLIER) return false;
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

/**
 * Whether an account of this type may hold this plan.
 *
 * The one pairing the catalogue fixes is Supplier, both ways: the Supplier plan
 * is priced for a materials business, and a materials business is sold only
 * that plan. Every other combination is allowed — the plan only decides the
 * bill, and the account type decides the rest.
 */
export function planAllowedForOrganizationType(
  tier: PlanTier,
  organizationType: OrganizationType | null | undefined,
): boolean {
  return (tier === PlanTier.SUPPLIER) === (organizationType === OrganizationType.SUPPLIER);
}
