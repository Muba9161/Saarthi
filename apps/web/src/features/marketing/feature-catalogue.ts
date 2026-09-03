import {
  Banknote,
  Bot,
  Building2,
  Cpu,
  LifeBuoy,
  MapPin,
  Package,
  Plane,
  Plug,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  ADMIN_NAVIGATION,
  ASSOCIATION_NAVIGATION,
  CUSTOMER_NAVIGATION,
  DRIVER_NAVIGATION,
  FLEET_NAVIGATION,
  MOBILITY_NAVIGATION,
  SUPPLIER_NAVIGATION,
  type NavSection,
} from '@/app/navigation';
import { FEATURE_CATALOGUE, Feature, type FeatureDefinition } from '@saarthi/shared';

/**
 * What the marketing site says Saarthi does.
 *
 * Every claim on the public site is generated from data the product itself
 * runs on — `FEATURE_CATALOGUE` for the capability list, `PLAN_FEATURES` for
 * which plan includes what, and the role navigation trees for the screens a
 * given account actually gets. Nothing here is a hand-written parallel list
 * that can quietly fall out of date, which is the usual failure mode of a
 * marketing page: shipping a feature and forgetting to sell it, or selling one
 * that was removed two releases ago.
 *
 * The only thing this file adds is presentation — grouping, ordering and an
 * icon per group. `FEATURE_GROUP_OF` is a total `Record<Feature, …>`, so
 * adding a feature to the platform fails the build here until somebody decides
 * where on the site it belongs.
 */

export type FeatureGroupId =
  | 'tracking'
  | 'fleet'
  | 'safety'
  | 'marketplace'
  | 'compliance'
  | 'hardware'
  | 'travel'
  | 'intelligence'
  | 'platform';

export interface FeatureGroup {
  id: FeatureGroupId;
  label: string;
  /** One line, used as the group's blurb in the explorer. */
  summary: string;
  icon: ComponentType<{ className?: string }>;
}

/** Display order of the groups, and the copy for each. */
export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: 'tracking',
    label: 'Tracking & maps',
    summary: 'Where every vehicle is, where it has been, and what the road ahead looks like.',
    icon: MapPin,
  },
  {
    id: 'fleet',
    label: 'Fleet & trips',
    summary: 'Trucks, drivers, trips and the servicing that keeps them earning.',
    icon: Truck,
  },
  {
    id: 'safety',
    label: 'Driver & safety',
    summary:
      'The network a driver can reach when something goes wrong, and the score they can question.',
    icon: LifeBuoy,
  },
  {
    id: 'marketplace',
    label: 'Marketplace & loads',
    summary: 'Finding work, filling the return leg, and moving stock out of a yard.',
    icon: Package,
  },
  {
    id: 'compliance',
    label: 'Money & compliance',
    summary: 'Documents, EMIs, toll and identity — the paperwork that stops trucks.',
    icon: Banknote,
  },
  {
    id: 'hardware',
    label: 'Hardware & telemetry',
    summary: 'Telematics devices, live engine data, and alerts raised from it.',
    icon: Cpu,
  },
  {
    id: 'travel',
    label: 'Travel & passengers',
    summary: 'Taxis, buses and tour packages, sold and booked on the same platform.',
    icon: Plane,
  },
  {
    id: 'intelligence',
    label: 'Intelligence & reporting',
    summary: 'Analytics, forecasting and an assistant that answers from your own records.',
    icon: Bot,
  },
  {
    id: 'platform',
    label: 'Platform & integration',
    summary: 'How Saarthi connects to everything else you run.',
    icon: Plug,
  },
];

/**
 * Every feature, placed in exactly one group.
 *
 * Total by construction: a new `Feature` is a type error here until it is
 * given a home, so the public site cannot silently omit a capability.
 */
export const FEATURE_GROUP_OF: Record<Feature, FeatureGroupId> = {
  [Feature.MAPS_2D]: 'tracking',
  [Feature.MAPS_3D]: 'tracking',
  [Feature.TRACKING_LIVE]: 'tracking',
  [Feature.TRACKING_HISTORY]: 'tracking',
  [Feature.TRACKING_REPLAY]: 'tracking',
  [Feature.ROUTE_INTELLIGENCE]: 'tracking',

  [Feature.FLEET_BASIC]: 'fleet',
  [Feature.FLEET_ANALYTICS]: 'fleet',
  [Feature.TRIPS_BASIC]: 'fleet',
  [Feature.MAINTENANCE_BASIC]: 'fleet',
  [Feature.MAINTENANCE_PREDICTIVE]: 'fleet',

  [Feature.DRIVER_SCORING]: 'safety',
  [Feature.DRIVER_ACHIEVEMENTS]: 'safety',
  [Feature.SOS_NETWORK]: 'safety',
  [Feature.NEARBY_SERVICES]: 'safety',
  [Feature.NEARBY_TRUCKS]: 'safety',
  [Feature.ROUTE_INTELLIGENCE_ALERTS]: 'safety',
  [Feature.CITY_ACCESS_INTELLIGENCE]: 'safety',
  [Feature.ASSOCIATION_NETWORK]: 'safety',

  [Feature.ORDERS_MARKETPLACE]: 'marketplace',
  [Feature.INVENTORY_MANAGEMENT]: 'marketplace',
  [Feature.RETURN_LOADS]: 'marketplace',
  [Feature.LAST_MILE_RELAY]: 'marketplace',
  [Feature.RESALE_MARKETPLACE]: 'marketplace',
  [Feature.RESALE_PUBLISH]: 'marketplace',

  [Feature.DOCUMENTS_BASIC]: 'compliance',
  [Feature.DOCUMENTS_AUTOMATION]: 'compliance',
  [Feature.FINANCE_LOANS]: 'compliance',
  [Feature.FINANCE_LOAN_SYNC]: 'compliance',
  [Feature.TOLL_FASTAG]: 'compliance',
  [Feature.TOLL_FASTAG_SYNC]: 'compliance',
  [Feature.QR_IDENTITY]: 'compliance',

  [Feature.HARDWARE_CONNECTIVITY]: 'hardware',
  [Feature.TELEMETRY_LIVE]: 'hardware',
  [Feature.TELEMETRY_HISTORY]: 'hardware',
  [Feature.TELEMETRY_INTELLIGENCE]: 'hardware',
  [Feature.ALERTS_BASIC]: 'hardware',
  [Feature.ALERTS_SMART]: 'hardware',

  [Feature.TRAVEL_SERVICES]: 'travel',
  [Feature.TRAVEL_BOOKINGS]: 'travel',

  [Feature.AI_COPILOT]: 'intelligence',
  [Feature.AI_RECOMMENDATIONS]: 'intelligence',
  [Feature.AI_BUSINESS_INTELLIGENCE]: 'intelligence',
  [Feature.REPORTS_BASIC]: 'intelligence',
  [Feature.REPORTS_ADVANCED]: 'intelligence',
  [Feature.MEDIA_LIBRARY]: 'intelligence',

  [Feature.API_ACCESS]: 'platform',
  [Feature.SSO]: 'platform',
};

/** The catalogue, re-ordered so features sit beside their group siblings. */
export const GROUPED_FEATURES: { group: FeatureGroup; features: FeatureDefinition[] }[] =
  FEATURE_GROUPS.map((group) => ({
    group,
    features: FEATURE_CATALOGUE.filter(
      (definition) => FEATURE_GROUP_OF[definition.key] === group.id,
    ),
  }));

/**
 * A note beside a handful of features whose plan placement is a deliberate
 * decision rather than an accident of tiering — the reasoning already written
 * down in `entitlements.ts`. Sold honestly, these are the strongest thing on
 * the page; left unexplained, "why is safety not in the cheap plan" is the
 * first question anyone asks.
 */
export const FEATURE_NOTES: Partial<Record<Feature, string>> = {
  [Feature.SOS_NETWORK]:
    'Raising an SOS is never blocked by a plan or a lapsed payment — the responder network is what the platform is for.',
  [Feature.FINANCE_LOANS]:
    'In this market the single-truck owner with an EMI is the typical customer, so the reminder that saves their truck is not an upsell.',
  [Feature.TOLL_FASTAG]:
    'Toll is the second largest running cost after diesel. A fleet that cannot see it is losing money it never watches leave.',
  [Feature.CITY_ACCESS_INTELLIGENCE]:
    'Checked before dispatch, on every plan. Gating it would let a paying customer drive into a fine.',
  [Feature.TRAVEL_SERVICES]:
    'A two-car taxi operator earns on the booking, not on a fleet plan, so publishing packages is available from the entry tier.',
  [Feature.DRIVER_SCORING]:
    'Every point gained or lost carries a written reason and the record it came from. No black box decides a livelihood.',
  [Feature.AI_COPILOT]:
    'Answers are assembled only from records your role can already open, and cite them.',
};

/* -------------------------------------------------------------------------
 * What each kind of account actually gets
 *
 * Read from the same navigation trees the signed-in shell renders, so this
 * section lists real screens rather than aspirational ones. Individual items
 * still carry their own permission and plan gates inside the app; what is
 * shown here is the full surface for the account type.
 * ---------------------------------------------------------------------- */

export interface RoleShowcase {
  id: string;
  label: string;
  /** How somebody in this seat would describe the win, in their words. */
  quote: string;
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  navigation: NavSection[];
}

export const ROLE_SHOWCASE: RoleShowcase[] = [
  {
    id: 'fleet',
    label: 'Fleet owner',
    quote: 'I know what is happening across my whole operation.',
    blurb:
      'Trucks, drivers, documents, orders, trips, fuel, EMIs and toll in one command centre — with analytics that come from the same records rather than a monthly spreadsheet.',
    icon: Truck,
    navigation: FLEET_NAVIGATION,
  },
  {
    id: 'driver',
    label: 'Driver',
    quote: 'I am not alone on the road.',
    blurb:
      'The current trip, one-tap SOS, nearby fuel and workshops, a score that explains itself, and a career profile that travels with you between employers.',
    icon: UserRound,
    navigation: DRIVER_NAVIGATION,
  },
  {
    id: 'customer',
    label: 'Customer',
    quote: 'I know where my order and my truck are.',
    blurb:
      'Post what needs moving, compare real quotes from verified fleets, then track the actual vehicle to your gate and rate what arrived.',
    icon: ShoppingCart,
    navigation: CUSTOMER_NAVIGATION,
  },
  {
    id: 'supplier',
    label: 'Supplier',
    quote: 'I manage material and transport in one place.',
    blurb:
      'A live catalogue with yard-level stock, orders straight from customers, reservations against those orders, and dispatch you can follow out of the gate.',
    icon: Package,
    navigation: SUPPLIER_NAVIGATION,
  },
  {
    id: 'travel',
    label: 'Travel operator',
    quote: 'My taxis, buses and tours sell themselves.',
    blurb:
      'Publish passenger packages, take bookings, and run the vehicles behind them with the same fleet, document and telemetry tools freight operators use.',
    icon: Plane,
    navigation: MOBILITY_NAVIGATION,
  },
  {
    id: 'association',
    label: 'Truck association',
    quote: 'My district can answer a call for help.',
    blurb:
      'An emergency desk that receives SOS alerts raised in your district, with the nearby services and responders needed to close them out.',
    icon: Building2,
    navigation: ASSOCIATION_NAVIGATION,
  },
  {
    id: 'admin',
    label: 'Platform admin',
    quote: 'Nothing enters the network unchecked.',
    blurb:
      'Verification queue, users, organizations, connected devices and an append-only audit log of every consequential action on the platform.',
    icon: Users,
    navigation: ADMIN_NAVIGATION,
  },
];

/** Total distinct destinations across every role — used as a proof point. */
export const TOTAL_DESTINATIONS = new Set(
  ROLE_SHOWCASE.flatMap((role) =>
    role.navigation.flatMap((section) => section.items.map((item) => item.to)),
  ),
).size;
