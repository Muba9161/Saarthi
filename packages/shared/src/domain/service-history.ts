/**
 * Service history.
 *
 * A vehicle's service record is the one dataset that keeps earning value long
 * after the work was done: it decides what a buyer will pay, what an insurer
 * will accept, and whether the third brake job in a year is a coincidence or a
 * pattern. Everything here is deterministic analysis over recorded facts —
 * the AI layer explains these outputs, it never produces them.
 */

import { MaintenanceType, ServiceCategory, ServiceVerificationStatus } from './enums';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Normalised component keys.
 *
 * Free text cannot answer "have these brake pads been replaced twice?" —
 * "brake pad", "Brake Pads" and "front brake pad set" are three different
 * strings and one component. Records carry both: the invoice line as written,
 * and a key from this list for anything a pattern needs to see.
 */
export const ServiceComponent = {
  BRAKE_PADS: 'brake_pads',
  BRAKE_DISCS: 'brake_discs',
  BRAKE_LINER: 'brake_liner',
  CLUTCH_PLATE: 'clutch_plate',
  GEARBOX: 'gearbox',
  ENGINE_OIL: 'engine_oil',
  OIL_FILTER: 'oil_filter',
  AIR_FILTER: 'air_filter',
  FUEL_FILTER: 'fuel_filter',
  DIESEL_INJECTOR: 'diesel_injector',
  FUEL_PUMP: 'fuel_pump',
  TURBOCHARGER: 'turbocharger',
  RADIATOR: 'radiator',
  COOLANT: 'coolant',
  WATER_PUMP: 'water_pump',
  BATTERY: 'battery',
  ALTERNATOR: 'alternator',
  STARTER_MOTOR: 'starter_motor',
  TYRE: 'tyre',
  WHEEL_BEARING: 'wheel_bearing',
  LEAF_SPRING: 'leaf_spring',
  SHOCK_ABSORBER: 'shock_absorber',
  STEERING_BOX: 'steering_box',
  PROPELLER_SHAFT: 'propeller_shaft',
  DIFFERENTIAL: 'differential',
  EXHAUST: 'exhaust',
  WIRING_HARNESS: 'wiring_harness',
  HEADLAMP: 'headlamp',
  WINDSCREEN: 'windscreen',
  BODY_PANEL: 'body_panel',
  CABIN_AC: 'cabin_ac',
  OTHER: 'other',
} as const;
export type ServiceComponent = (typeof ServiceComponent)[keyof typeof ServiceComponent];

export const ALL_SERVICE_COMPONENTS = Object.values(ServiceComponent) as ServiceComponent[];

const COMPONENT_LABELS: Record<ServiceComponent, string> = {
  [ServiceComponent.BRAKE_PADS]: 'Brake pads',
  [ServiceComponent.BRAKE_DISCS]: 'Brake discs',
  [ServiceComponent.BRAKE_LINER]: 'Brake liner',
  [ServiceComponent.CLUTCH_PLATE]: 'Clutch plate',
  [ServiceComponent.GEARBOX]: 'Gearbox',
  [ServiceComponent.ENGINE_OIL]: 'Engine oil',
  [ServiceComponent.OIL_FILTER]: 'Oil filter',
  [ServiceComponent.AIR_FILTER]: 'Air filter',
  [ServiceComponent.FUEL_FILTER]: 'Fuel filter',
  [ServiceComponent.DIESEL_INJECTOR]: 'Diesel injector',
  [ServiceComponent.FUEL_PUMP]: 'Fuel pump',
  [ServiceComponent.TURBOCHARGER]: 'Turbocharger',
  [ServiceComponent.RADIATOR]: 'Radiator',
  [ServiceComponent.COOLANT]: 'Coolant',
  [ServiceComponent.WATER_PUMP]: 'Water pump',
  [ServiceComponent.BATTERY]: 'Battery',
  [ServiceComponent.ALTERNATOR]: 'Alternator',
  [ServiceComponent.STARTER_MOTOR]: 'Starter motor',
  [ServiceComponent.TYRE]: 'Tyre',
  [ServiceComponent.WHEEL_BEARING]: 'Wheel bearing',
  [ServiceComponent.LEAF_SPRING]: 'Leaf spring',
  [ServiceComponent.SHOCK_ABSORBER]: 'Shock absorber',
  [ServiceComponent.STEERING_BOX]: 'Steering box',
  [ServiceComponent.PROPELLER_SHAFT]: 'Propeller shaft',
  [ServiceComponent.DIFFERENTIAL]: 'Differential',
  [ServiceComponent.EXHAUST]: 'Exhaust',
  [ServiceComponent.WIRING_HARNESS]: 'Wiring harness',
  [ServiceComponent.HEADLAMP]: 'Headlamp',
  [ServiceComponent.WINDSCREEN]: 'Windscreen',
  [ServiceComponent.BODY_PANEL]: 'Body panel',
  [ServiceComponent.CABIN_AC]: 'Cabin AC',
  [ServiceComponent.OTHER]: 'Other',
};

export function componentLabel(component: string): string {
  return COMPONENT_LABELS[component as ServiceComponent] ?? component;
}

/** Which category a component's failure usually belongs to. */
export const COMPONENT_CATEGORY: Partial<Record<ServiceComponent, ServiceCategory>> = {
  [ServiceComponent.BRAKE_PADS]: ServiceCategory.BRAKES,
  [ServiceComponent.BRAKE_DISCS]: ServiceCategory.BRAKES,
  [ServiceComponent.BRAKE_LINER]: ServiceCategory.BRAKES,
  [ServiceComponent.CLUTCH_PLATE]: ServiceCategory.TRANSMISSION,
  [ServiceComponent.GEARBOX]: ServiceCategory.TRANSMISSION,
  [ServiceComponent.ENGINE_OIL]: ServiceCategory.ROUTINE,
  [ServiceComponent.OIL_FILTER]: ServiceCategory.ROUTINE,
  [ServiceComponent.AIR_FILTER]: ServiceCategory.ROUTINE,
  [ServiceComponent.FUEL_FILTER]: ServiceCategory.FUEL_SYSTEM,
  [ServiceComponent.DIESEL_INJECTOR]: ServiceCategory.FUEL_SYSTEM,
  [ServiceComponent.FUEL_PUMP]: ServiceCategory.FUEL_SYSTEM,
  [ServiceComponent.TURBOCHARGER]: ServiceCategory.ENGINE,
  [ServiceComponent.RADIATOR]: ServiceCategory.COOLING,
  [ServiceComponent.COOLANT]: ServiceCategory.COOLING,
  [ServiceComponent.WATER_PUMP]: ServiceCategory.COOLING,
  [ServiceComponent.BATTERY]: ServiceCategory.ELECTRICAL,
  [ServiceComponent.ALTERNATOR]: ServiceCategory.ELECTRICAL,
  [ServiceComponent.STARTER_MOTOR]: ServiceCategory.ELECTRICAL,
  [ServiceComponent.TYRE]: ServiceCategory.TYRES,
  [ServiceComponent.WHEEL_BEARING]: ServiceCategory.SUSPENSION,
  [ServiceComponent.LEAF_SPRING]: ServiceCategory.SUSPENSION,
  [ServiceComponent.SHOCK_ABSORBER]: ServiceCategory.SUSPENSION,
  [ServiceComponent.STEERING_BOX]: ServiceCategory.STEERING,
  [ServiceComponent.PROPELLER_SHAFT]: ServiceCategory.CHASSIS,
  [ServiceComponent.DIFFERENTIAL]: ServiceCategory.CHASSIS,
  [ServiceComponent.EXHAUST]: ServiceCategory.EXHAUST,
  [ServiceComponent.WIRING_HARNESS]: ServiceCategory.ELECTRICAL,
  [ServiceComponent.HEADLAMP]: ServiceCategory.ELECTRICAL,
  [ServiceComponent.WINDSCREEN]: ServiceCategory.BODY,
  [ServiceComponent.BODY_PANEL]: ServiceCategory.BODY,
  [ServiceComponent.CABIN_AC]: ServiceCategory.HVAC,
};

/** Default category for a job type, when the record does not name one. */
export function categoryForType(type: MaintenanceType): ServiceCategory {
  switch (type) {
    case MaintenanceType.OIL_CHANGE:
    case MaintenanceType.PREVENTIVE:
      return ServiceCategory.ROUTINE;
    case MaintenanceType.BRAKE:
      return ServiceCategory.BRAKES;
    case MaintenanceType.ENGINE:
      return ServiceCategory.ENGINE;
    case MaintenanceType.ELECTRICAL:
      return ServiceCategory.ELECTRICAL;
    case MaintenanceType.TYRE:
      return ServiceCategory.TYRES;
    case MaintenanceType.BODYWORK:
      return ServiceCategory.BODY;
    default:
      return ServiceCategory.OTHER;
  }
}

// ---------------------------------------------------------------------------
// Service intervals and health
// ---------------------------------------------------------------------------

/** Interval after which a routine service is considered due. */
export const SERVICE_INTERVAL_KM = 15_000;
export const SERVICE_INTERVAL_DAYS = 120;

export const ServiceHealth = {
  HEALTHY: 'Healthy',
  DUE: 'Service due',
  OVERDUE: 'Service overdue',
  UNKNOWN: 'No service recorded',
} as const;
export type ServiceHealth = (typeof ServiceHealth)[keyof typeof ServiceHealth];

export interface ServiceHealthInput {
  odometerKm: number | null;
  lastServiceAt: Date | null;
  lastServiceOdometerKm: number | null;
  overdueScheduledJobs: number;
}

/**
 * A one-line verdict on whether a vehicle is due for service.
 *
 * Shared so the QR scan, the vehicle passport and the fleet dashboard cannot
 * disagree with one another about the same truck. "No service recorded" is a
 * distinct answer from "Healthy" on purpose — an absence of records is not
 * evidence of a well-maintained vehicle.
 */
export function resolveServiceHealth(
  input: ServiceHealthInput,
  now: Date = new Date(),
): { health: ServiceHealth; reasons: string[]; basis: 'calculated' } {
  const reasons: string[] = [];

  if (input.overdueScheduledJobs > 0) {
    reasons.push(
      `${input.overdueScheduledJobs} scheduled job${input.overdueScheduledJobs === 1 ? '' : 's'} past the due date.`,
    );
    return { health: ServiceHealth.OVERDUE, reasons, basis: 'calculated' };
  }

  if (!input.lastServiceAt) {
    reasons.push('No completed service on record for this vehicle.');
    return { health: ServiceHealth.UNKNOWN, reasons, basis: 'calculated' };
  }

  const daysSince = Math.round((now.getTime() - input.lastServiceAt.getTime()) / 86_400_000);
  const kmSince =
    input.odometerKm !== null && input.lastServiceOdometerKm !== null
      ? Math.max(0, input.odometerKm - input.lastServiceOdometerKm)
      : null;

  if (daysSince > SERVICE_INTERVAL_DAYS) {
    reasons.push(`${daysSince} days since the last service.`);
  }
  if (kmSince !== null && kmSince > SERVICE_INTERVAL_KM) {
    reasons.push(`${Math.round(kmSince).toLocaleString('en-IN')} km since the last service.`);
  }

  return {
    health: reasons.length > 0 ? ServiceHealth.DUE : ServiceHealth.HEALTHY,
    reasons,
    basis: 'calculated',
  };
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export interface ServiceHistoryEntry {
  id: string;
  serviceDate: Date;
  odometerKm: number | null;
  category: ServiceCategory | null;
  totalCost: number | null;
  replacedComponents: string[];
  verificationStatus: ServiceVerificationStatus;
}

export interface RepeatedComponent {
  component: string;
  label: string;
  occurrences: number;
  firstAt: Date;
  lastAt: Date;
  /** Distance between the first and last replacement, when both are known. */
  kmBetween: number | null;
  daysBetween: number;
  totalCost: number;
}

/**
 * Components replaced more than once in the window.
 *
 * `minOccurrences` defaults to 2 because the second replacement is exactly when
 * a fleet wants to know — a third is already an expensive lesson. Consumables
 * that are *meant* to be replaced repeatedly (oil, filters) are excluded, since
 * flagging them would bury the signal under routine servicing.
 */
const CONSUMABLES = new Set<string>([
  ServiceComponent.ENGINE_OIL,
  ServiceComponent.OIL_FILTER,
  ServiceComponent.AIR_FILTER,
  ServiceComponent.FUEL_FILTER,
  ServiceComponent.COOLANT,
]);

export function repeatedComponents(
  history: ServiceHistoryEntry[],
  minOccurrences = 2,
): RepeatedComponent[] {
  const grouped = new Map<string, ServiceHistoryEntry[]>();

  for (const entry of history) {
    for (const component of entry.replacedComponents) {
      if (CONSUMABLES.has(component)) continue;
      const bucket = grouped.get(component) ?? [];
      bucket.push(entry);
      grouped.set(component, bucket);
    }
  }

  const results: RepeatedComponent[] = [];

  for (const [component, entries] of grouped) {
    if (entries.length < minOccurrences) continue;
    const sorted = [...entries].sort(
      (a, b) => a.serviceDate.getTime() - b.serviceDate.getTime(),
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;

    results.push({
      component,
      label: componentLabel(component),
      occurrences: sorted.length,
      firstAt: first.serviceDate,
      lastAt: last.serviceDate,
      kmBetween:
        first.odometerKm !== null && last.odometerKm !== null
          ? Math.max(0, Math.round(last.odometerKm - first.odometerKm))
          : null,
      daysBetween: Math.round(
        (last.serviceDate.getTime() - first.serviceDate.getTime()) / 86_400_000,
      ),
      totalCost: sorted.reduce((sum, entry) => sum + (entry.totalCost ?? 0), 0),
    });
  }

  return results.sort((a, b) => b.occurrences - a.occurrences);
}

export interface CostTrend {
  /** Cost in the most recent window. */
  recentCost: number;
  /** Cost in the window before it, for comparison. */
  previousCost: number;
  changePercent: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';
  windowDays: number;
}

/**
 * Whether service spend is rising.
 *
 * `UNKNOWN` when the earlier window has no spend at all: a jump from zero is
 * not a hundred-percent increase, it is a first service, and reporting it as a
 * trend would make every new vehicle look like a problem.
 */
export function serviceCostTrend(
  history: ServiceHistoryEntry[],
  windowDays = 90,
  now: Date = new Date(),
): CostTrend {
  const windowMs = windowDays * 86_400_000;
  const recentFrom = now.getTime() - windowMs;
  const previousFrom = recentFrom - windowMs;

  let recentCost = 0;
  let previousCost = 0;

  for (const entry of history) {
    const at = entry.serviceDate.getTime();
    const cost = entry.totalCost ?? 0;
    if (at >= recentFrom) recentCost += cost;
    else if (at >= previousFrom) previousCost += cost;
  }

  if (previousCost === 0) {
    return {
      recentCost: Math.round(recentCost),
      previousCost: 0,
      changePercent: null,
      direction: 'UNKNOWN',
      windowDays,
    };
  }

  const changePercent = Math.round(((recentCost - previousCost) / previousCost) * 100);
  return {
    recentCost: Math.round(recentCost),
    previousCost: Math.round(previousCost),
    changePercent,
    direction: changePercent > 10 ? 'UP' : changePercent < -10 ? 'DOWN' : 'FLAT',
    windowDays,
  };
}

/** Total spend, split the way an operator thinks about it. */
export interface ServiceSpend {
  total: number;
  labour: number;
  parts: number;
  recordCount: number;
  costPerKm: number | null;
  unverifiedRecords: number;
}

export function summariseSpend(
  entries: Array<{
    totalCost: number | null;
    labourCost: number | null;
    partsCost: number | null;
    verificationStatus: ServiceVerificationStatus;
  }>,
  distanceKm: number | null,
): ServiceSpend {
  const total = entries.reduce((sum, entry) => sum + (entry.totalCost ?? 0), 0);

  return {
    total: Math.round(total),
    labour: Math.round(entries.reduce((sum, entry) => sum + (entry.labourCost ?? 0), 0)),
    parts: Math.round(entries.reduce((sum, entry) => sum + (entry.partsCost ?? 0), 0)),
    recordCount: entries.length,
    costPerKm:
      distanceKm !== null && distanceKm > 0 ? Number((total / distanceKm).toFixed(2)) : null,
    unverifiedRecords: entries.filter(
      (entry) =>
        entry.verificationStatus === ServiceVerificationStatus.UNVERIFIED ||
        entry.verificationStatus === ServiceVerificationStatus.PENDING_REVIEW,
    ).length,
  };
}

/**
 * Does an external record contradict one already held?
 *
 * Returns the fields that disagree rather than a verdict. Which one is right is
 * a question for a person with the invoice in front of them — the system's job
 * is to make sure the disagreement is not silently resolved by whoever wrote
 * last.
 */
export interface ServiceConflictField {
  field: string;
  existing: string | number | null;
  incoming: string | number | null;
}

export function detectServiceConflicts(
  existing: {
    odometerKm: number | null;
    totalCost: number | null;
    completedAt: Date | null;
    workshopName: string | null;
  },
  incoming: {
    odometerKm: number | null;
    totalCost: number | null;
    completedAt: Date | null;
    workshopName: string | null;
  },
): ServiceConflictField[] {
  const conflicts: ServiceConflictField[] = [];

  const compareNumber = (field: string, a: number | null, b: number | null, tolerance = 1): void => {
    if (a === null || b === null) return;
    if (Math.abs(a - b) > tolerance) conflicts.push({ field, existing: a, incoming: b });
  };

  compareNumber('odometerKm', existing.odometerKm, incoming.odometerKm, 50);
  compareNumber('totalCost', existing.totalCost, incoming.totalCost, 1);

  if (existing.completedAt && incoming.completedAt) {
    const dayDifference = Math.abs(
      Math.round((existing.completedAt.getTime() - incoming.completedAt.getTime()) / 86_400_000),
    );
    if (dayDifference > 1) {
      conflicts.push({
        field: 'completedAt',
        existing: existing.completedAt.toISOString().slice(0, 10),
        incoming: incoming.completedAt.toISOString().slice(0, 10),
      });
    }
  }

  if (
    existing.workshopName &&
    incoming.workshopName &&
    existing.workshopName.trim().toLowerCase() !== incoming.workshopName.trim().toLowerCase()
  ) {
    conflicts.push({
      field: 'workshopName',
      existing: existing.workshopName,
      incoming: incoming.workshopName,
    });
  }

  return conflicts;
}
