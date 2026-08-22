/**
 * City access rules and the last-mile decision.
 *
 * Indian cities restrict heavy goods vehicles by zone, by hour, by weight and by
 * permit, and the rules differ per city. This module answers one question with a
 * deterministic, explainable result:
 *
 *   "Can this vehicle reach this address at this time, and if not, what now?"
 *
 * The recommendation is derived from the matched rules, never guessed, so the
 * same input always produces the same explanation.
 */

import {
  CityAccessRecommendation,
  CityRestrictionKind,
  TruckType,
  VehicleType,
} from './enums';
import { boundingDeltas, distanceKm, type LatLng } from './geo';

/** A restriction as the matcher needs it — the storage shape, minus metadata. */
export interface CityRestrictionRule {
  id: string;
  name: string;
  kind: CityRestrictionKind;
  city: string;
  state: string;
  center: LatLng;
  radiusKm: number | null;
  /** GeoJSON-style ring: [[lng, lat], ...]. Takes precedence over the radius. */
  polygon: number[][] | null;
  /** Empty = every goods vehicle. */
  vehicleTypes: VehicleType[];
  truckTypes: TruckType[];
  minCapacityTons: number | null;
  maxHeightMetres: number | null;
  maxAxles: number | null;
  /** 0 = Sunday .. 6 = Saturday. Empty = every day. */
  daysOfWeek: number[];
  /** Minutes from local midnight. Both null = all day. */
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
  permitAuthority: string | null;
  permitUrl: string | null;
  penaltyNote: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  active: boolean;
}

/** The vehicle being checked. */
export interface VehicleAccessProfile {
  vehicleType: VehicleType;
  truckType: TruckType | null;
  capacityTons: number;
  heightMetres: number | null;
  axles: number | null;
  /** Permit codes the operator holds, e.g. city entry permits. */
  permits: string[];
}

export interface AccessWindow {
  daysOfWeek: number[];
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
}

export interface MatchedRestriction {
  id: string;
  name: string;
  kind: CityRestrictionKind;
  city: string;
  state: string;
  /** True when the restriction is in force at the checked time. */
  appliesNow: boolean;
  /** Km from the checked point to the zone edge; 0 means inside. */
  distanceToZoneKm: number;
  window: AccessWindow;
  permitAuthority: string | null;
  permitUrl: string | null;
  penaltyNote: string | null;
  /** Why this rule matched this vehicle, in one sentence. */
  explanation: string;
}

export interface CityAccessResult {
  restricted: boolean;
  restrictions: MatchedRestriction[];
  recommendation: CityAccessRecommendation;
  /** One sentence a dispatcher can act on. */
  summary: string;
  /**
   * When every blocking rule is time-based, the next moment entry is legal —
   * null when waiting cannot help.
   */
  enterAfterMinutes: number | null;
  /** True when a relay is the only realistic way in. */
  requiresLastMile: boolean;
}

const MINUTES_PER_DAY = 1440;

/** Local minutes-from-midnight for a timestamp. */
function minutesOfDay(at: Date): number {
  return at.getHours() * 60 + at.getMinutes();
}

/**
 * Is `minute` inside the window, handling windows that cross midnight?
 *
 * A 22:00-06:00 night ban has `start > end`, which a naive comparison gets
 * exactly backwards — hence the explicit wrap branch.
 */
export function isWithinWindow(
  minute: number,
  startTimeMinutes: number | null,
  endTimeMinutes: number | null,
): boolean {
  if (startTimeMinutes === null || endTimeMinutes === null) return true;
  if (startTimeMinutes === endTimeMinutes) return true;
  if (startTimeMinutes < endTimeMinutes) {
    return minute >= startTimeMinutes && minute < endTimeMinutes;
  }
  return minute >= startTimeMinutes || minute < endTimeMinutes;
}

/** Point-in-ring test (ray casting) on [[lng, lat], ...]. */
export function isPointInPolygon(point: LatLng, ring: readonly number[][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [aLng, aLat] = a as [number, number];
    const [bLng, bLat] = b as [number, number];
    const straddles = aLat > point.latitude !== bLat > point.latitude;
    if (!straddles) continue;
    const crossingLng = aLng + ((point.latitude - aLat) / (bLat - aLat)) * (bLng - aLng);
    if (point.longitude < crossingLng) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the zone edge, 0 when inside. */
function distanceToZoneKm(point: LatLng, rule: CityRestrictionRule): number {
  if (rule.polygon && rule.polygon.length >= 3) {
    if (isPointInPolygon(point, rule.polygon)) return 0;
    // Nearest vertex is a good enough proxy for "how far outside" on the scale
    // of a city zone, and avoids a full point-to-polygon projection.
    let nearest = Number.POSITIVE_INFINITY;
    for (const vertex of rule.polygon) {
      const [lng, lat] = vertex as [number, number];
      nearest = Math.min(nearest, distanceKm(point, { latitude: lat, longitude: lng }));
    }
    return Math.round(nearest * 100) / 100;
  }

  const radius = rule.radiusKm ?? 0;
  const centreDistance = distanceKm(point, rule.center);
  return centreDistance <= radius ? 0 : Math.round((centreDistance - radius) * 100) / 100;
}

/** Does the rule bite this vehicle at all, ignoring time and place? */
function ruleAppliesToVehicle(
  rule: CityRestrictionRule,
  vehicle: VehicleAccessProfile,
): { applies: boolean; explanation: string } {
  if (rule.vehicleTypes.length > 0 && !rule.vehicleTypes.includes(vehicle.vehicleType)) {
    return { applies: false, explanation: 'Vehicle type is not covered by this rule.' };
  }
  if (
    rule.truckTypes.length > 0 &&
    (vehicle.truckType === null || !rule.truckTypes.includes(vehicle.truckType))
  ) {
    return { applies: false, explanation: 'Body type is not covered by this rule.' };
  }

  if (rule.minCapacityTons !== null && vehicle.capacityTons < rule.minCapacityTons) {
    return {
      applies: false,
      explanation: `Applies at ${rule.minCapacityTons} t and above; this vehicle carries ${vehicle.capacityTons} t.`,
    };
  }

  // A height or axle rule only bites when the vehicle exceeds it. An unknown
  // height is treated as not exceeding — guessing a number here could either
  // block a legal trip or wave through an illegal one, and the honest answer is
  // to flag it for the dispatcher instead.
  if (rule.maxHeightMetres !== null) {
    if (vehicle.heightMetres === null) {
      return {
        applies: false,
        explanation: `Height limit ${rule.maxHeightMetres} m — vehicle height not recorded, so this could not be checked.`,
      };
    }
    if (vehicle.heightMetres <= rule.maxHeightMetres) {
      return {
        applies: false,
        explanation: `Under the ${rule.maxHeightMetres} m height limit.`,
      };
    }
  }
  if (rule.maxAxles !== null && vehicle.axles !== null && vehicle.axles <= rule.maxAxles) {
    return { applies: false, explanation: `Within the ${rule.maxAxles}-axle limit.` };
  }

  const parts: string[] = [];
  if (rule.minCapacityTons !== null) parts.push(`payload ${vehicle.capacityTons} t`);
  if (rule.maxHeightMetres !== null && vehicle.heightMetres !== null) {
    parts.push(`height ${vehicle.heightMetres} m`);
  }
  if (rule.maxAxles !== null && vehicle.axles !== null) parts.push(`${vehicle.axles} axles`);

  return {
    applies: true,
    explanation:
      parts.length > 0
        ? `Applies to this vehicle (${parts.join(', ')}).`
        : 'Applies to all goods vehicles in this zone.',
  };
}

function isRuleInForce(rule: CityRestrictionRule, at: Date): boolean {
  if (!rule.active) return false;
  if (rule.effectiveFrom && at < rule.effectiveFrom) return false;
  if (rule.effectiveTo && at > rule.effectiveTo) return false;
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(at.getDay())) return false;
  return isWithinWindow(minutesOfDay(at), rule.startTimeMinutes, rule.endTimeMinutes);
}

/** Minutes to wait until a time-based rule stops applying. */
function minutesUntilWindowEnds(rule: CityRestrictionRule, at: Date): number | null {
  if (rule.endTimeMinutes === null) return null;
  const now = minutesOfDay(at);
  const wait = (rule.endTimeMinutes - now + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return wait === 0 ? MINUTES_PER_DAY : wait;
}

/**
 * The whole point of the module: what should the dispatcher do?
 *
 * Precedence is deliberate. A hard ban cannot be waited out, so it produces
 * RELAY. A time window can, so it produces WAIT_FOR_WINDOW — unless the delivery
 * cannot wait, which the caller decides by passing `maxWaitMinutes`.
 */
export function checkCityAccess(
  destination: LatLng,
  vehicle: VehicleAccessProfile,
  rules: readonly CityRestrictionRule[],
  options: { at?: Date; maxWaitMinutes?: number } = {},
): CityAccessResult {
  const at = options.at ?? new Date();
  const maxWait = options.maxWaitMinutes ?? 240;

  const matched: MatchedRestriction[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;

    const zoneDistance = distanceToZoneKm(destination, rule);
    // Only rules whose zone actually contains the drop point are relevant.
    if (zoneDistance > 0) continue;

    const applicability = ruleAppliesToVehicle(rule, vehicle);
    if (!applicability.applies) continue;

    matched.push({
      id: rule.id,
      name: rule.name,
      kind: rule.kind,
      city: rule.city,
      state: rule.state,
      appliesNow: isRuleInForce(rule, at),
      distanceToZoneKm: zoneDistance,
      window: {
        daysOfWeek: rule.daysOfWeek,
        startTimeMinutes: rule.startTimeMinutes,
        endTimeMinutes: rule.endTimeMinutes,
      },
      permitAuthority: rule.permitAuthority,
      permitUrl: rule.permitUrl,
      penaltyNote: rule.penaltyNote,
      explanation: applicability.explanation,
    });
  }

  const blocking = matched.filter((entry) => entry.appliesNow);

  if (blocking.length === 0) {
    return {
      restricted: matched.length > 0,
      restrictions: matched,
      recommendation: CityAccessRecommendation.ALLOWED,
      summary:
        matched.length > 0
          ? 'Entry is allowed right now, but restrictions apply at other times of day.'
          : 'No access restrictions recorded for this destination.',
      enterAfterMinutes: null,
      requiresLastMile: false,
    };
  }

  const hardBans = blocking.filter(
    (entry) =>
      entry.kind === CityRestrictionKind.NO_ENTRY ||
      entry.kind === CityRestrictionKind.ZONE_BAN ||
      entry.kind === CityRestrictionKind.WEIGHT_LIMIT ||
      entry.kind === CityRestrictionKind.HEIGHT_LIMIT ||
      entry.kind === CityRestrictionKind.AXLE_LIMIT,
  );

  // A permanent ban (no time window at all) can never be waited out.
  const permanentBan = hardBans.find(
    (entry) => entry.window.startTimeMinutes === null && entry.window.endTimeMinutes === null,
  );
  if (permanentBan) {
    return {
      restricted: true,
      restrictions: matched,
      recommendation: CityAccessRecommendation.RELAY,
      summary: `${permanentBan.name} blocks this vehicle from the drop area at all times. Hand the load to a city pickup.`,
      enterAfterMinutes: null,
      requiresLastMile: true,
    };
  }

  const permitRules = blocking.filter(
    (entry) => entry.kind === CityRestrictionKind.PERMIT_REQUIRED,
  );
  if (permitRules.length > 0 && hardBans.length === 0) {
    const rule = permitRules[0]!;
    const holdsPermit = vehicle.permits.some(
      (permit) =>
        rule.permitAuthority !== null &&
        permit.toLowerCase().includes(rule.permitAuthority.toLowerCase()),
    );
    if (!holdsPermit) {
      return {
        restricted: true,
        restrictions: matched,
        recommendation: CityAccessRecommendation.PERMIT_REQUIRED,
        summary: `${rule.name} requires a permit${
          rule.permitAuthority ? ` from ${rule.permitAuthority}` : ''
        }. Obtain one or hand the load to a city pickup.`,
        enterAfterMinutes: null,
        requiresLastMile: false,
      };
    }
  }

  // Everything blocking is time-based. Work out the shortest wait that clears
  // every one of them.
  const waits = blocking
    .map((entry) => {
      const rule = rules.find((candidate) => candidate.id === entry.id);
      return rule ? minutesUntilWindowEnds(rule, at) : null;
    })
    .filter((value): value is number => value !== null);

  const longestWait = waits.length > 0 ? Math.max(...waits) : null;

  if (longestWait !== null && longestWait <= maxWait) {
    const hours = Math.floor(longestWait / 60);
    const minutes = longestWait % 60;
    const label = hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
    return {
      restricted: true,
      restrictions: matched,
      recommendation: CityAccessRecommendation.WAIT_FOR_WINDOW,
      summary: `Entry opens in about ${label}. Hold the vehicle outside the zone until then.`,
      enterAfterMinutes: longestWait,
      requiresLastMile: false,
    };
  }

  return {
    restricted: true,
    restrictions: matched,
    recommendation: CityAccessRecommendation.RELAY,
    summary:
      longestWait !== null
        ? `Entry is closed for about ${Math.round(longestWait / 60)} h, longer than the ${Math.round(maxWait / 60)} h this delivery can wait. Hand the load to a city pickup.`
        : 'This vehicle cannot enter the drop area. Hand the load to a city pickup.',
    enterAfterMinutes: longestWait,
    requiresLastMile: true,
  };
}

/**
 * Bounding box that would contain every rule zone relevant to a point.
 *
 * Used to build the indexed pre-filter before loading rules, so a national
 * registry never lands in memory.
 */
export function restrictionSearchBounds(
  point: LatLng,
  maxZoneRadiusKm = 60,
): { latDelta: number; lngDelta: number } {
  return boundingDeltas(point.latitude, maxZoneRadiusKm * 1000);
}

/** Vehicle types small enough to be a last-mile pickup. */
export const LAST_MILE_VEHICLE_TYPES: VehicleType[] = [
  VehicleType.PICKUP,
  VehicleType.VAN,
  VehicleType.TEMPO,
  VehicleType.AUTO_RICKSHAW,
];

/** Truck body types small enough to be a last-mile pickup. */
export const LAST_MILE_TRUCK_TYPES: TruckType[] = [TruckType.MINI_TRUCK, TruckType.CLOSED_CONTAINER];

export function isLastMileCapable(
  vehicleType: VehicleType,
  truckType: TruckType | null,
  capacityTons: number,
  maxWeightTons = 3,
): boolean {
  if (capacityTons > maxWeightTons) return false;
  if (LAST_MILE_VEHICLE_TYPES.includes(vehicleType)) return true;
  return truckType !== null && LAST_MILE_TRUCK_TYPES.includes(truckType);
}

/**
 * Rank transfer hubs for a relay.
 *
 * A good hub is outside the restricted zone, close to it, and roughly on the
 * inbound truck's approach so it does not double back.
 */
export interface HubCandidate {
  id: string;
  name: string;
  location: LatLng;
  openFromMinutes: number | null;
  openToMinutes: number | null;
  active: boolean;
  verified: boolean;
}

export interface RankedHub {
  id: string;
  name: string;
  distanceFromDropKm: number;
  detourKm: number;
  openNow: boolean;
  verified: boolean;
  score: number;
}

export function rankTransferHubs(
  hubs: readonly HubCandidate[],
  context: { approachFrom: LatLng; drop: LatLng; at?: Date },
): RankedHub[] {
  const at = context.at ?? new Date();
  const minute = minutesOfDay(at);
  const directKm = distanceKm(context.approachFrom, context.drop);

  return hubs
    .filter((hub) => hub.active)
    .map((hub) => {
      const distanceFromDropKm = distanceKm(hub.location, context.drop);
      const viaHub =
        distanceKm(context.approachFrom, hub.location) + distanceKm(hub.location, context.drop);
      const detourKm = Math.max(0, viaHub - directKm);
      const openNow = isWithinWindow(minute, hub.openFromMinutes, hub.openToMinutes);

      // Closeness to the drop matters most (it is the pickup's leg), then the
      // big truck's detour, then whether it is actually open and trusted.
      const score =
        100 *
        (0.45 * Math.max(0, 1 - distanceFromDropKm / 60) +
          0.3 * Math.max(0, 1 - detourKm / 40) +
          0.15 * (openNow ? 1 : 0) +
          0.1 * (hub.verified ? 1 : 0));

      return {
        id: hub.id,
        name: hub.name,
        distanceFromDropKm: Math.round(distanceFromDropKm * 10) / 10,
        detourKm: Math.round(detourKm * 10) / 10,
        openNow,
        verified: hub.verified,
        score: Math.round(score * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Indicative price for a relay leg, from a partner's published rates. */
export function estimateRelayPrice(
  rates: { minimumCharge: number; perKmRate: number; perTonRate: number | null },
  leg: { distanceKm: number; weightTons: number | null },
): number {
  const distanceComponent = rates.perKmRate * Math.max(0, leg.distanceKm);
  const weightComponent =
    rates.perTonRate !== null && leg.weightTons !== null
      ? rates.perTonRate * Math.max(0, leg.weightTons)
      : 0;
  return Math.round(Math.max(rates.minimumCharge, distanceComponent + weightComponent));
}
