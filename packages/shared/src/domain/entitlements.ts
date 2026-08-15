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
];

const INTELLIGENCE_FEATURES: Feature[] = [
  ...PRO_FEATURES,
  Feature.AI_COPILOT,
  Feature.AI_RECOMMENDATIONS,
  Feature.AI_BUSINESS_INTELLIGENCE,
  Feature.MAINTENANCE_PREDICTIVE,
];

const ENTERPRISE_FEATURES: Feature[] = [
  ...INTELLIGENCE_FEATURES,
  Feature.API_ACCESS,
  Feature.SSO,
];

export const PLAN_FEATURES: Record<PlanTier, Feature[]> = {
  [PlanTier.BASIC]: BASIC_FEATURES,
  [PlanTier.PRO]: PRO_FEATURES,
  [PlanTier.INTELLIGENCE]: INTELLIGENCE_FEATURES,
  [PlanTier.ENTERPRISE]: ENTERPRISE_FEATURES,
};

export interface PlanLimits {
  /** `null` means unlimited. */
  maxTrucks: number | null;
  maxDrivers: number | null;
  maxMembers: number | null;
  trackingHistoryDays: number;
  aiRequestsPerDay: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  [PlanTier.BASIC]: {
    maxTrucks: 5,
    maxDrivers: 10,
    maxMembers: 3,
    trackingHistoryDays: 7,
    aiRequestsPerDay: 0,
  },
  [PlanTier.PRO]: {
    maxTrucks: 50,
    maxDrivers: 100,
    maxMembers: 15,
    trackingHistoryDays: 90,
    aiRequestsPerDay: 0,
  },
  [PlanTier.INTELLIGENCE]: {
    maxTrucks: 250,
    maxDrivers: 500,
    maxMembers: 50,
    trackingHistoryDays: 365,
    aiRequestsPerDay: 200,
  },
  [PlanTier.ENTERPRISE]: {
    maxTrucks: null,
    maxDrivers: null,
    maxMembers: null,
    trackingHistoryDays: 1095,
    aiRequestsPerDay: 2000,
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
    description: '3D tracking, driver scoring, maintenance, safety network and analytics.',
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
    description: 'Unlimited fleet scale, API access, SSO and dedicated integrations.',
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
