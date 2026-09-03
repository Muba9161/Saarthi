import {
  HireBasis,
  OrganizationType,
  RequirementBidScope,
  RequirementKind,
  RequirementStatus,
  ServiceType,
} from './enums';

/**
 * Requirements — the customer's single front door.
 *
 * Before this module a customer could only post a freight load; a cab or a
 * tour had to be found by browsing somebody's catalogue, which meant demand
 * for passenger transport was invisible to the operators who could serve it.
 * A requirement inverts that for every category at once: the customer says
 * what they need, the businesses that can serve it bid, and the winning bid
 * becomes an order or a booking on the pipelines that already exist.
 *
 * This file holds the rules that both the API and the UI must agree on —
 * who sees which kind, what a bid may cover, and how the status moves.
 */

/** Requirement kinds that move goods. */
export const FREIGHT_REQUIREMENT_KINDS: RequirementKind[] = [
  RequirementKind.MATERIAL_SUPPLY,
  RequirementKind.FREIGHT_TRANSPORT,
];

/** Requirement kinds that move people. */
export const TRAVEL_REQUIREMENT_KINDS: RequirementKind[] = [
  RequirementKind.CAB_HIRE,
  RequirementKind.TOUR_PACKAGE,
];

export function isTravelRequirement(kind: RequirementKind): boolean {
  return TRAVEL_REQUIREMENT_KINDS.includes(kind);
}

export function isFreightRequirement(kind: RequirementKind): boolean {
  return FREIGHT_REQUIREMENT_KINDS.includes(kind);
}

/**
 * Which bid scopes a requirement of this kind can attract.
 *
 * MATERIAL_SUPPLY is the only kind that accepts two, and that is the point of
 * it: the goods and the lorry that carries them are usually sold by different
 * businesses, and forcing the customer to choose a single counterparty would
 * either exclude suppliers who do not own trucks or fleets that do not sell
 * cement.
 */
export const BID_SCOPES_BY_KIND: Record<RequirementKind, RequirementBidScope[]> = {
  [RequirementKind.MATERIAL_SUPPLY]: [
    RequirementBidScope.MATERIAL,
    RequirementBidScope.TRANSPORT,
  ],
  [RequirementKind.FREIGHT_TRANSPORT]: [RequirementBidScope.TRANSPORT],
  [RequirementKind.CAB_HIRE]: [RequirementBidScope.TRAVEL],
  [RequirementKind.TOUR_PACKAGE]: [RequirementBidScope.TRAVEL],
};

/**
 * Which kind of business may offer each scope.
 *
 * The organization type is the gate, not the permission: a fleet manager
 * holding every grant in the catalogue still cannot quote for cement, because
 * the business they work for does not sell it.
 */
export const BIDDER_TYPES_BY_SCOPE: Record<RequirementBidScope, OrganizationType[]> = {
  [RequirementBidScope.MATERIAL]: [OrganizationType.SUPPLIER],
  [RequirementBidScope.TRANSPORT]: [OrganizationType.FLEET_OWNER, OrganizationType.ENTERPRISE],
  [RequirementBidScope.TRAVEL]: [OrganizationType.MOBILITY_PROVIDER],
};

/** The scopes an organization of this type is allowed to bid with. */
export function bidScopesForOrganizationType(type: OrganizationType): RequirementBidScope[] {
  return (Object.keys(BIDDER_TYPES_BY_SCOPE) as RequirementBidScope[]).filter((scope) =>
    BIDDER_TYPES_BY_SCOPE[scope].includes(type),
  );
}

/**
 * The requirement kinds an organization of this type should be shown.
 *
 * A supplier and a fleet both see MATERIAL_SUPPLY, because both have something
 * to sell against it — they simply bid with different scopes.
 */
export function requirementKindsVisibleTo(type: OrganizationType): RequirementKind[] {
  const scopes = bidScopesForOrganizationType(type);
  if (scopes.length === 0) return [];

  return (Object.keys(BID_SCOPES_BY_KIND) as RequirementKind[]).filter((kind) =>
    BID_SCOPES_BY_KIND[kind].some((scope) => scopes.includes(scope)),
  );
}

/** The provider service type a travel requirement corresponds to. */
export const SERVICE_TYPE_BY_KIND: Partial<Record<RequirementKind, ServiceType>> = {
  [RequirementKind.CAB_HIRE]: ServiceType.TAXI,
  [RequirementKind.TOUR_PACKAGE]: ServiceType.TOUR,
};

/** Statuses in which a requirement still accepts new bids. */
export const BIDDABLE_REQUIREMENT_STATUSES: RequirementStatus[] = [
  RequirementStatus.OPEN,
  RequirementStatus.BIDDING,
  RequirementStatus.PARTIALLY_AWARDED,
];

/** Statuses a customer still considers in-flight. */
export const ACTIVE_REQUIREMENT_STATUSES: RequirementStatus[] = [
  RequirementStatus.OPEN,
  RequirementStatus.BIDDING,
  RequirementStatus.PARTIALLY_AWARDED,
  RequirementStatus.AWARDED,
];

/** Statuses past which nothing further happens. */
export const TERMINAL_REQUIREMENT_STATUSES: RequirementStatus[] = [
  RequirementStatus.FULFILLED,
  RequirementStatus.CANCELLED,
  RequirementStatus.EXPIRED,
];

export function isRequirementBiddable(status: RequirementStatus): boolean {
  return BIDDABLE_REQUIREMENT_STATUSES.includes(status);
}

/**
 * A cab or tour requirement always names a basis, because it decides what the
 * provider is actually being asked to price.
 */
export const HIRE_BASIS_BY_KIND: Record<'CAB_HIRE' | 'TOUR_PACKAGE', HireBasis[]> = {
  CAB_HIRE: [HireBasis.ONE_WAY, HireBasis.ROUND_TRIP, HireBasis.HOURLY, HireBasis.DAILY],
  TOUR_PACKAGE: [HireBasis.DAILY, HireBasis.ROUND_TRIP],
};

/** How long a requirement stays open for bids when the customer sets no date. */
export const DEFAULT_BID_WINDOW_HOURS = 72;

/** The shortest window that gives a provider a realistic chance to respond. */
export const MIN_BID_WINDOW_HOURS = 2;

/** Beyond this, prices quoted at the start are no longer meaningful. */
export const MAX_BID_WINDOW_DAYS = 30;

/**
 * Human labels. Kept beside the rules rather than in the UI so the API can use
 * the same wording in notifications and audit entries.
 */
export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  [RequirementKind.MATERIAL_SUPPLY]: 'Material supply',
  [RequirementKind.FREIGHT_TRANSPORT]: 'Freight transport',
  [RequirementKind.CAB_HIRE]: 'Cab or taxi hire',
  [RequirementKind.TOUR_PACKAGE]: 'Tour or travel package',
};

export const REQUIREMENT_KIND_DESCRIPTIONS: Record<RequirementKind, string> = {
  [RequirementKind.MATERIAL_SUPPLY]:
    'Buy goods from a verified supplier, with delivery arranged if you need it.',
  [RequirementKind.FREIGHT_TRANSPORT]:
    'You already have the goods. Fleets bid to move them for you.',
  [RequirementKind.CAB_HIRE]:
    'A vehicle with a driver — one way, return, or retained by the hour or day.',
  [RequirementKind.TOUR_PACKAGE]:
    'A multi-day itinerary. Tour operators bid with a package built for you.',
};

export const BID_SCOPE_LABELS: Record<RequirementBidScope, string> = {
  [RequirementBidScope.MATERIAL]: 'Material',
  [RequirementBidScope.TRANSPORT]: 'Transport',
  [RequirementBidScope.TRAVEL]: 'Travel',
};
