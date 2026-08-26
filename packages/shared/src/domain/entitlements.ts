/**
 * Subscription feature entitlements.
 *
 * The catalogue lives in shared code so the UI can hide what a plan does not
 * include, but every gated API route re-checks the entitlement server-side.
 * Plan → feature mapping is seeded into PostgreSQL (`plan_features`) from this
 * definition so it stays configurable at runtime without a code change.
 */

import { PlanTier } from './enums';

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

const BASIC_FEATURES: Feature[] = [
  Feature.MAPS_2D,
  Feature.TRACKING_LIVE,
  Feature.FLEET_BASIC,
  Feature.DOCUMENTS_BASIC,
  Feature.ORDERS_MARKETPLACE,
  Feature.TRIPS_BASIC,
  Feature.REPORTS_BASIC,
  Feature.ALERTS_BASIC,
  // Mobility is available on every tier — see the note on Feature.TRAVEL_SERVICES.
  Feature.TRAVEL_SERVICES,
  Feature.TRAVEL_BOOKINGS,
  // Images, stock, identity and safety are table stakes, not upsells.
  Feature.MEDIA_LIBRARY,
  Feature.INVENTORY_MANAGEMENT,
  Feature.RESALE_MARKETPLACE,
  Feature.QR_IDENTITY,
  Feature.FINANCE_LOANS,
  Feature.TOLL_FASTAG,
  Feature.CITY_ACCESS_INTELLIGENCE,
  Feature.ROUTE_INTELLIGENCE_ALERTS,
];

const PRO_FEATURES: Feature[] = [
  ...BASIC_FEATURES,
  Feature.MAPS_3D,
  Feature.TRACKING_HISTORY,
  Feature.TRACKING_REPLAY,
  Feature.FLEET_ANALYTICS,
  Feature.DRIVER_SCORING,
  Feature.DRIVER_ACHIEVEMENTS,
  Feature.DOCUMENTS_AUTOMATION,
  Feature.MAINTENANCE_BASIC,
  Feature.ALERTS_SMART,
  Feature.NEARBY_SERVICES,
  Feature.NEARBY_TRUCKS,
  Feature.SOS_NETWORK,
  Feature.REPORTS_ADVANCED,
  Feature.HARDWARE_CONNECTIVITY,
  Feature.TELEMETRY_LIVE,
  Feature.TELEMETRY_HISTORY,
  Feature.RESALE_PUBLISH,
  Feature.RETURN_LOADS,
  Feature.LAST_MILE_RELAY,
  Feature.ROUTE_INTELLIGENCE,
  Feature.FINANCE_LOAN_SYNC,
  Feature.TOLL_FASTAG_SYNC,
];

const INTELLIGENCE_FEATURES: Feature[] = [
  ...PRO_FEATURES,
  Feature.AI_COPILOT,
  Feature.AI_RECOMMENDATIONS,
  Feature.AI_BUSINESS_INTELLIGENCE,
  Feature.MAINTENANCE_PREDICTIVE,
  Feature.TELEMETRY_INTELLIGENCE,
];

const ENTERPRISE_FEATURES: Feature[] = [
  ...INTELLIGENCE_FEATURES,
  Feature.API_ACCESS,
  Feature.SSO,
  Feature.ASSOCIATION_NETWORK,
];

export const PLAN_FEATURES: Record<PlanTier, Feature[]> = {
  [PlanTier.BASIC]: BASIC_FEATURES,
  [PlanTier.PRO]: PRO_FEATURES,
  [PlanTier.INTELLIGENCE]: INTELLIGENCE_FEATURES,
  [PlanTier.ENTERPRISE]: ENTERPRISE_FEATURES,
};

export interface PlanLimits {
  /**
   * Vehicles the plan itself covers. `null` means unlimited.
   *
   * This is the *base* figure. What a tenant may actually run is this plus
   * their active `+1` top-ups — see `effectiveVehicleLimit`, which is what the
   * entitlement service resolves and what every capacity check reads.
   */
  maxTrucks: number | null;
  /**
   * How many `+1 vehicle` top-ups may be held on top of the base plan.
   *
   * A ceiling exists so top-ups stay a stopgap between plans rather than a way
   * to run fifty vehicles on a one-vehicle plan and never upgrade.
   */
  maxVehicleTopUps: number;
  maxDrivers: number | null;
  maxMembers: number | null;
  trackingHistoryDays: number;
  aiRequestsPerDay: number;
  /** Connected telematics devices. `0` = hardware not included in the plan. */
  maxDevices: number | null;
  /** How long normalised telemetry readings are retained. */
  telemetryRetentionDays: number;
}

/**
 * Vehicle capacity per plan.
 *
 * Saarthi is sold by fleet size — 1, 5, 20 and 50 vehicles — because that is
 * the number an operator already knows about themselves. Feature depth rises
 * with capacity rather than being sold separately: a fifty-truck fleet needs
 * telemetry and analytics, a single owner-driver needs their documents, their
 * EMI and a working map.
 *
 * A tenant already running more vehicles than their plan covers is never cut
 * off. Capacity is checked when *adding* a vehicle, so downgrading, or a change
 * to these figures, can never strand an operator's existing fleet.
 */
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  [PlanTier.BASIC]: {
    maxTrucks: 1,
    maxVehicleTopUps: 4,
    maxDrivers: 10,
    maxMembers: 3,
    trackingHistoryDays: 7,
    aiRequestsPerDay: 0,
    maxDevices: 0,
    telemetryRetentionDays: 0,
  },
  [PlanTier.PRO]: {
    maxTrucks: 5,
    maxVehicleTopUps: 15,
    maxDrivers: 100,
    maxMembers: 15,
    trackingHistoryDays: 90,
    aiRequestsPerDay: 0,
    maxDevices: 50,
    telemetryRetentionDays: 90,
  },
  [PlanTier.INTELLIGENCE]: {
    maxTrucks: 20,
    maxVehicleTopUps: 30,
    maxDrivers: 500,
    maxMembers: 50,
    trackingHistoryDays: 365,
    aiRequestsPerDay: 200,
    maxDevices: 250,
    telemetryRetentionDays: 365,
  },
  [PlanTier.ENTERPRISE]: {
    maxTrucks: 50,
    // Enterprise capacity is negotiated, so the top-up ceiling is generous
    // rather than a real constraint.
    maxVehicleTopUps: 450,
    maxDrivers: null,
    maxMembers: null,
    trackingHistoryDays: 1095,
    aiRequestsPerDay: 2000,
    maxDevices: null,
    telemetryRetentionDays: 1095,
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
    tier: PlanTier.BASIC,
    name: 'Saarthi Basic',
    description: 'Core fleet, document, order and trip management for small operators.',
    priceMonthly: 999,
    priceYearly: 9990,
    features: BASIC_FEATURES,
    limits: PLAN_LIMITS[PlanTier.BASIC],
  },
  {
    tier: PlanTier.PRO,
    name: 'Saarthi Pro',
    description:
      '3D tracking, driver scoring, maintenance, safety network, hardware telemetry and analytics.',
    priceMonthly: 2999,
    priceYearly: 29990,
    features: PRO_FEATURES,
    limits: PLAN_LIMITS[PlanTier.PRO],
  },
  {
    tier: PlanTier.INTELLIGENCE,
    name: 'Saarthi Intelligence',
    description: 'AI Fleet Copilot, recommendations, predictive maintenance and BI.',
    priceMonthly: 6999,
    priceYearly: 69990,
    features: INTELLIGENCE_FEATURES,
    limits: PLAN_LIMITS[PlanTier.INTELLIGENCE],
  },
  {
    tier: PlanTier.ENTERPRISE,
    name: 'Saarthi Enterprise',
    description:
      'Unlimited fleet scale, association network, API access, SSO and dedicated integrations.',
    priceMonthly: null,
    priceYearly: null,
    features: ENTERPRISE_FEATURES,
    limits: PLAN_LIMITS[PlanTier.ENTERPRISE],
  },
];

export function featuresForTier(tier: PlanTier): Feature[] {
  return PLAN_FEATURES[tier] ?? [];
}

export function tierHasFeature(tier: PlanTier, feature: Feature): boolean {
  return featuresForTier(tier).includes(feature);
}

/** Lowest tier that grants the feature — used for upgrade prompts. */
export function minimumTierFor(feature: Feature): PlanTier | null {
  const order: PlanTier[] = [
    PlanTier.BASIC,
    PlanTier.PRO,
    PlanTier.INTELLIGENCE,
    PlanTier.ENTERPRISE,
  ];
  return order.find((tier) => tierHasFeature(tier, feature)) ?? null;
}

// ---------------------------------------------------------------------------
// Vehicle capacity and top-ups
// ---------------------------------------------------------------------------

/**
 * A `+1 vehicle` top-up.
 *
 * The reason this exists rather than "just upgrade": an operator who buys their
 * sixth truck on a five-vehicle plan should not have to jump to the twenty-
 * vehicle price to put it on the road. One extra vehicle costs one extra
 * vehicle's worth.
 */
export const VEHICLE_TOPUP = {
  key: 'vehicle_topup',
  name: '+1 Vehicle',
  description: 'Adds one vehicle to your plan. Stack as many as you need.',
  /** Monthly price in INR, per vehicle. */
  priceMonthly: 399,
  priceYearly: 3990,
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
