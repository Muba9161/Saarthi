/**
 * Truck-association emergency network rules.
 *
 * An association is a district body that coordinates roadside help. It is a
 * responder, not an operator: it needs to know *that* a truck near it is in
 * trouble and where, and nothing else. Section 9 and 32 of the expansion spec
 * are enforced here by construction — the projection below is the complete list
 * of fields an association may see about an incident, so a future field added
 * to `SosIncident` cannot leak to associations by default.
 */

import { AlertSeverity, SosType } from './enums';

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * How urgent each emergency type is to an association.
 *
 * Accident and security emergencies are life-safety events and page the whole
 * district. A tyre or fuel problem is real but not urgent, so it arrives as
 * information rather than an alarm — an association that is woken for a flat
 * tyre stops reading its alerts.
 */
export const SOS_TYPE_SEVERITY: Record<SosType, AlertSeverity> = {
  [SosType.ACCIDENT]: AlertSeverity.CRITICAL,
  [SosType.SECURITY]: AlertSeverity.CRITICAL,
  [SosType.MEDICAL]: AlertSeverity.CRITICAL,
  [SosType.BREAKDOWN]: AlertSeverity.WARNING,
  [SosType.TYRE]: AlertSeverity.INFO,
  [SosType.FUEL]: AlertSeverity.INFO,
  [SosType.OTHER]: AlertSeverity.WARNING,
};

export function severityForSosType(type: SosType): AlertSeverity {
  return SOS_TYPE_SEVERITY[type] ?? AlertSeverity.WARNING;
}

/**
 * Emergency types that reach the association network at all.
 *
 * A driver who has run out of fuel does not need a district-wide callout, and
 * routing every minor SOS to associations would train them to ignore the feed.
 */
export const ASSOCIATION_ROUTED_SOS_TYPES: SosType[] = [
  SosType.ACCIDENT,
  SosType.SECURITY,
  SosType.MEDICAL,
  SosType.BREAKDOWN,
  SosType.OTHER,
];

export function shouldRouteToAssociations(type: SosType): boolean {
  return ASSOCIATION_ROUTED_SOS_TYPES.includes(type);
}

/**
 * Escalate an unacknowledged critical alert after this long. The association
 * dashboard surfaces these first, and the platform is notified.
 */
export const ASSOCIATION_ESCALATION_MINUTES: Record<AlertSeverity, number> = {
  [AlertSeverity.CRITICAL]: 10,
  [AlertSeverity.WARNING]: 30,
  [AlertSeverity.INFO]: 120,
};

/** Default radius an association covers around each registered coverage point. */
export const DEFAULT_COVERAGE_RADIUS_KM = 60;
export const MAX_COVERAGE_RADIUS_KM = 250;

// ---------------------------------------------------------------------------
// The privacy projection
// ---------------------------------------------------------------------------

/**
 * Exactly what an association may see about an incident.
 *
 * Note what is *not* here: customer identity, order or trip contents, financial
 * data, documents, full route history, and every raw telemetry parameter. The
 * driver's name and phone number are present only because someone has to be
 * called at the roadside, and both are withheld until the association has
 * acknowledged the alert (see `redactUntilAcknowledged`).
 */
export interface AssociationIncidentView {
  alertId: string;
  reference: string;
  severity: AlertSeverity;
  incidentType: SosType;
  /** Coarse status only — the association does not see internal fleet state. */
  incidentStatus: string;
  vehicleRegistration: string | null;
  vehicleType: string | null;
  /** Fleet name, so the association knows who to coordinate with. */
  fleetName: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  district: string | null;
  state: string | null;
  /** Free-text description the driver supplied. */
  description: string | null;
  driverName: string | null;
  driverPhone: string | null;
  contactPhone: string | null;
  distanceKm: number | null;
  triggeredAt: string;
}

/**
 * Withhold personal contact details until the association has acknowledged.
 *
 * Acknowledgement is a deliberate, audited action by a named user, which is
 * what turns "an association can browse driver phone numbers" into "a
 * responder who took the case can call the driver".
 */
export function redactUntilAcknowledged(
  view: AssociationIncidentView,
  acknowledged: boolean,
): AssociationIncidentView {
  if (acknowledged) return view;
  return {
    ...view,
    driverName: null,
    driverPhone: null,
    contactPhone: null,
  };
}

/** Association-side actions, used by both the API guard and the UI. */
export const ASSOCIATION_ALERT_ACTIONS = [
  'ACKNOWLEDGE',
  'ASSIGN_RESPONDER',
  'ADD_NOTE',
  'ESCALATE',
  'RESOLVE',
  'CLOSE',
] as const;

export type AssociationAlertAction = (typeof ASSOCIATION_ALERT_ACTIONS)[number];
