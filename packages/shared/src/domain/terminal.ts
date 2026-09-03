/**
 * The Saarthi Terminal contract.
 *
 * A terminal is a tablet bolted to a vehicle. It is a *device* in Saarthi's
 * existing sense — it enrols, pairs to one vehicle and posts through the same
 * gateway a Freematics posts through — and everything it displays is decided
 * server-side. What this module adds on top of the device contract is the one
 * thing a terminal has that no other device has: a **driver lifecycle**.
 *
 * Three rules shape the whole file, and they are the ones worth breaking a
 * build over:
 *
 *  1. **The terminal never decides who is driving.** It reports state; the
 *     backend owns it. `TerminalState` below is a projection the app renders,
 *     not an assertion it makes.
 *  2. **A driver is authorised only by an explicit human approval.** No timer,
 *     no fallback, no "assume yes after fifteen minutes". The SLA constants
 *     here drive reminders and escalation and nothing else.
 *  3. **Simulated data announces itself, everywhere.** A checklist verdict
 *     built on an invented coolant temperature carries `simulated: true` from
 *     the rule that produced it all the way to the submission stored a year
 *     later.
 *
 * The Android client mirrors these shapes as Kotlin data classes; this file is
 * the source of truth for both sides.
 */

import type {
  AlertSeverity,
  DeviceNetworkType,
  DeviceSubsystemStatus,
  NearbyCategory,
  TelemetryMetric,
  TerminalChecklistItemKind,
  TerminalChecklistItemStatus,
  TerminalChecklistOutcome,
  TerminalIssueCategory,
  TerminalIssueStatus,
  TerminalSessionStatus,
  VehicleType,
} from './enums';
import {
  TelemetryMetric as Metric,
  TerminalChecklistItemKind as ItemKind,
  TerminalSessionStatus as SessionStatus,
} from './enums';

// ---------------------------------------------------------------------------
// Terminal state machine (specification section 8)
// ---------------------------------------------------------------------------

/**
 * What the terminal is doing right now, as one value.
 *
 * Wider than `TerminalSessionStatus` because it also covers the states that
 * exist *before* any driver — an unpaired tablet has no session at all. The
 * backend derives it from the device's pairing plus its live session, so the
 * app never has to reconstruct it from a handful of booleans and get it subtly
 * wrong on a cold start.
 */
export const TerminalState = {
  /** Enrolled, but not connected to a vehicle. */
  UNPAIRED: 'UNPAIRED',
  /** A pairing code has been presented and is being redeemed. */
  PAIRING: 'PAIRING',
  /** Connected to a vehicle. Transient — resolves to AWAITING_DRIVER. */
  VEHICLE_PAIRED: 'VEHICLE_PAIRED',
  /** Idle at the vehicle, showing the permanent vehicle QR. */
  AWAITING_DRIVER: 'AWAITING_DRIVER',
  /** A driver scanned the vehicle QR from their own Saarthi account. */
  DRIVER_IDENTIFIED: 'DRIVER_IDENTIFIED',
  SELFIE_SUBMITTED: 'SELFIE_SUBMITTED',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  /** Approved, safety check outstanding. */
  CHECKLIST_REQUIRED: 'CHECKLIST_REQUIRED',
  READY: 'READY',
  TRIP_ACTIVE: 'TRIP_ACTIVE',
  TRIP_COMPLETED: 'TRIP_COMPLETED',
  REJECTED: 'REJECTED',
  /** Credentials revoked or the device suspended. Nothing works until fixed. */
  REVOKED: 'REVOKED',
} as const;
export type TerminalState = (typeof TerminalState)[keyof typeof TerminalState];

export const TERMINAL_STATES = Object.values(TerminalState) as TerminalState[];

/**
 * Legal transitions, as the specification draws them.
 *
 * Exported so both sides can *assert* rather than assume. The server is
 * authoritative; the client uses this to refuse to render a transition it was
 * never told about, which is how a stale socket message stops being able to
 * put a terminal into a state its backend does not agree with.
 */
export const TERMINAL_TRANSITIONS: Readonly<Record<TerminalState, readonly TerminalState[]>> =
  Object.freeze({
    [TerminalState.UNPAIRED]: [TerminalState.PAIRING, TerminalState.REVOKED],
    [TerminalState.PAIRING]: [
      TerminalState.VEHICLE_PAIRED,
      TerminalState.UNPAIRED,
      TerminalState.REVOKED,
    ],
    [TerminalState.VEHICLE_PAIRED]: [
      TerminalState.AWAITING_DRIVER,
      TerminalState.UNPAIRED,
      TerminalState.REVOKED,
    ],
    [TerminalState.AWAITING_DRIVER]: [
      TerminalState.DRIVER_IDENTIFIED,
      TerminalState.UNPAIRED,
      TerminalState.REVOKED,
    ],
    [TerminalState.DRIVER_IDENTIFIED]: [
      TerminalState.SELFIE_SUBMITTED,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.SELFIE_SUBMITTED]: [
      TerminalState.PENDING_APPROVAL,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.PENDING_APPROVAL]: [
      TerminalState.APPROVED,
      TerminalState.REJECTED,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.APPROVED]: [
      TerminalState.CHECKLIST_REQUIRED,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.CHECKLIST_REQUIRED]: [
      TerminalState.READY,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.READY]: [
      TerminalState.TRIP_ACTIVE,
      TerminalState.TRIP_COMPLETED,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.TRIP_ACTIVE]: [
      TerminalState.TRIP_COMPLETED,
      TerminalState.AWAITING_DRIVER,
      TerminalState.REVOKED,
    ],
    [TerminalState.TRIP_COMPLETED]: [TerminalState.AWAITING_DRIVER, TerminalState.REVOKED],
    // Rejection is not a dead end: the driver goes away, and the terminal is
    // ready for the next person. The spec draws exactly this loop.
    [TerminalState.REJECTED]: [TerminalState.AWAITING_DRIVER, TerminalState.REVOKED],
    [TerminalState.REVOKED]: [TerminalState.UNPAIRED],
  });

export function canTransition(from: TerminalState, to: TerminalState): boolean {
  if (from === to) return true;
  return TERMINAL_TRANSITIONS[from].includes(to);
}

/**
 * Project a persisted session status onto the terminal-level state.
 *
 * `checklistComplete` is what separates APPROVED from READY: the session row
 * says APPROVED for both, and the difference is whether a submission exists.
 */
export function terminalStateForSession(
  status: TerminalSessionStatus,
  options: { checklistComplete: boolean } = { checklistComplete: false },
): TerminalState {
  switch (status) {
    case SessionStatus.DRIVER_IDENTIFIED:
      return TerminalState.DRIVER_IDENTIFIED;
    case SessionStatus.SELFIE_SUBMITTED:
      return TerminalState.SELFIE_SUBMITTED;
    case SessionStatus.PENDING_APPROVAL:
      return TerminalState.PENDING_APPROVAL;
    case SessionStatus.APPROVED:
      return options.checklistComplete
        ? TerminalState.READY
        : TerminalState.CHECKLIST_REQUIRED;
    case SessionStatus.READY:
      return TerminalState.READY;
    case SessionStatus.TRIP_ACTIVE:
      return TerminalState.TRIP_ACTIVE;
    case SessionStatus.COMPLETED:
      return TerminalState.TRIP_COMPLETED;
    case SessionStatus.REJECTED:
      return TerminalState.REJECTED;
    case SessionStatus.CANCELLED:
    case SessionStatus.EXPIRED:
    default:
      return TerminalState.AWAITING_DRIVER;
  }
}

/** Whether the driver may operate the vehicle in this state. */
export function isDriverAuthorized(state: TerminalState): boolean {
  return (
    state === TerminalState.READY ||
    state === TerminalState.TRIP_ACTIVE ||
    state === TerminalState.TRIP_COMPLETED
  );
}

/** Whether the cockpit (map, services, vehicle screens) should be reachable. */
export function isCockpitAvailable(state: TerminalState): boolean {
  return isDriverAuthorized(state);
}

// ---------------------------------------------------------------------------
// Approval SLA (specification section 15)
// ---------------------------------------------------------------------------

/**
 * The approval service level, in minutes.
 *
 * Read the comment before changing any of these. `escalateAfter` is the
 * fifteen minutes the specification names, and it triggers a *louder
 * notification to more senior people* — never an approval. There is
 * deliberately no `autoApproveAfter`, and adding one would be the single most
 * dangerous change anybody could make to this product: it would let an
 * unlicensed or suspended driver take a truck out because nobody was at a desk.
 */
export const TERMINAL_APPROVAL_SLA = {
  /** First nudge to whoever can decide. */
  remindAfterMinutes: 5,
  /** Escalation to owner-level roles. Section 15's fifteen minutes. */
  escalateAfterMinutes: 15,
  /**
   * When an unanswered request stops being answerable.
   *
   * Generous, because the alternative is a driver who filled in a request at
   * shift change losing it while the owner is on the road. Expiry closes the
   * request and nothing else.
   */
  expireAfterMinutes: 120,
} as const;

/** How long a terminal may sit on an approved-but-unstarted session. */
export const TERMINAL_SESSION_IDLE_HOURS = 16;

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/**
 * The human-typeable pairing code shape shown in the specification.
 *
 * A terminal in a yard with a cracked screen still has to pair, and asking
 * somebody to read a 43-character base64url token aloud is not a plan. The code
 * is a *presentation* of the same single-use pairing token: the API accepts
 * either form and normalises here, so there is one credential rather than two.
 */
export const TERMINAL_PAIRING_CODE_PREFIX = 'STH';
export const TERMINAL_PAIRING_CODE_PATTERN = /^STH-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** `sth 1a2b 3c4d` → `STH-1A2B-3C4D`. Returns null when it is not a code. */
export function normalizeTerminalPairingCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact.startsWith(TERMINAL_PAIRING_CODE_PREFIX)) return null;
  const body = compact.slice(TERMINAL_PAIRING_CODE_PREFIX.length);
  if (body.length !== 8) return null;
  const formatted = `${TERMINAL_PAIRING_CODE_PREFIX}-${body.slice(0, 4)}-${body.slice(4)}`;
  return TERMINAL_PAIRING_CODE_PATTERN.test(formatted) ? formatted : null;
}

/**
 * The payload a Saarthi Terminal pairing QR encodes.
 *
 * Same three fields as the device pairing QR, with its own `kind` so a terminal
 * cannot silently redeem a code meant for a test phone and a test phone cannot
 * take a terminal's slot. Carries no vehicle, no registration and nothing
 * commercial — a QR on a screen is photographed by whoever walks past.
 */
export interface TerminalPairingPayload {
  v: 1;
  kind: 'saarthi.terminal.pair';
  api: string;
  token: string;
}

// ---------------------------------------------------------------------------
// Default pre-trip checklist (specification section 17)
// ---------------------------------------------------------------------------

/**
 * One line of the checklist, before any vehicle data is applied.
 *
 * `kind` says what could answer it, and `metric` says which reading would. A
 * TELEMETRY item whose metric is not in the live reading's `metrics` list falls
 * back to a manual inspection rather than reporting a number nobody measured —
 * see `evaluateChecklistItem`.
 */
export interface ChecklistItemDefinition {
  code: string;
  label: string;
  description: string;
  kind: TerminalChecklistItemKind;
  metric?: TelemetryMetric;
  /** A failure here stops the trip. A warning does not. */
  blocking: boolean;
  required: boolean;
  sortOrder: number;
}

/**
 * The ten points, in the order the specification lists them.
 *
 * This is a *fallback*, not the definition of record. A fleet with a
 * `TerminalChecklistTemplate` row uses theirs; a fleet without one uses this,
 * so the feature works on the first day without anybody configuring anything.
 * That is what section 17 asks for — configurable, but not inert until
 * configured.
 */
export const DEFAULT_CHECKLIST_ITEMS: readonly ChecklistItemDefinition[] = Object.freeze([
  {
    code: 'TYRES',
    label: 'Tyres / air pressure',
    description: 'Walk around. Check for cuts, bulges, tread depth and visibly low pressure.',
    kind: ItemKind.MANUAL,
    blocking: true,
    required: true,
    sortOrder: 1,
  },
  {
    code: 'COOLANT',
    label: 'Coolant',
    description: 'Coolant level and engine temperature.',
    kind: ItemKind.TELEMETRY,
    metric: Metric.COOLANT_TEMPERATURE,
    blocking: true,
    required: true,
    sortOrder: 2,
  },
  {
    code: 'ENGINE_OIL',
    label: 'Engine oil',
    description: 'Oil level on the dipstick, and any leak under the engine.',
    kind: ItemKind.MAINTENANCE,
    blocking: true,
    required: true,
    sortOrder: 3,
  },
  {
    code: 'BRAKES',
    label: 'Brakes',
    description: 'Pedal feel, air pressure build-up, parking brake, no warning lamp.',
    kind: ItemKind.MANUAL,
    blocking: true,
    required: true,
    sortOrder: 4,
  },
  {
    code: 'LIGHTS',
    label: 'Lights',
    description: 'Head, tail, brake, indicators, hazards and reversing lamps.',
    kind: ItemKind.MANUAL,
    blocking: true,
    required: true,
    sortOrder: 5,
  },
  {
    code: 'BATTERY',
    label: 'Battery',
    description: 'Terminals clean and tight; charging voltage healthy.',
    kind: ItemKind.TELEMETRY,
    metric: Metric.BATTERY_VOLTAGE,
    blocking: false,
    required: true,
    sortOrder: 6,
  },
  {
    code: 'FUEL',
    label: 'Fuel',
    description: 'Enough fuel for the leg ahead.',
    kind: ItemKind.TELEMETRY,
    metric: Metric.FUEL_LEVEL,
    blocking: false,
    required: true,
    sortOrder: 7,
  },
  {
    code: 'MIRRORS',
    label: 'Mirrors',
    description: 'Clean, undamaged and adjusted before moving off.',
    kind: ItemKind.MANUAL,
    blocking: false,
    required: true,
    sortOrder: 8,
  },
  {
    code: 'EMERGENCY_EQUIPMENT',
    label: 'Emergency equipment',
    description: 'Fire extinguisher, first-aid kit, warning triangle, wheel chocks.',
    kind: ItemKind.MANUAL,
    blocking: false,
    required: true,
    sortOrder: 9,
  },
  {
    code: 'DOCUMENTS',
    label: 'Documents',
    description: 'Insurance, fitness, permit and PUC valid for today.',
    kind: ItemKind.DOCUMENT,
    blocking: true,
    required: true,
    sortOrder: 10,
  },
]);

// ---------------------------------------------------------------------------
// Checklist evaluation
// ---------------------------------------------------------------------------

/**
 * Thresholds for the automated verdicts.
 *
 * Set for an Indian commercial vehicle with a 24 V electrical system, which is
 * why 27.3 V is healthy rather than 12.6 V. A vehicle whose system voltage is
 * genuinely 12 V will read low here; that is a known limitation and the reason
 * the battery item is not blocking.
 */
export const CHECKLIST_THRESHOLDS = {
  coolant: { attentionC: 100, criticalC: 108 },
  fuel: { attentionPercent: 20, criticalPercent: 8 },
  battery: { attentionVolts: 24.0, criticalVolts: 23.0 },
  /** Kilometres before the next service at which the item warns. */
  service: { attentionKm: 1_000, criticalKm: 0 },
} as const;

/** A live reading, reduced to what the checklist needs. */
export interface ChecklistTelemetryContext {
  recordedAt: string | null;
  /** Metrics this reading genuinely carries. Absence is not zero. */
  metrics: TelemetryMetric[];
  /** Which of those were produced by a simulator. Always a subset. */
  simulatedMetrics: TelemetryMetric[];
  coolantTemperature: number | null;
  fuelLevel: number | null;
  batteryVoltage: number | null;
  rpm: number | null;
  engineLoad: number | null;
  odometer: number | null;
  diagnosticCodes: { code: string; description: string | null }[];
}

/** What maintenance and documents contribute. */
export interface ChecklistVehicleContext {
  /** Kilometres until the next scheduled service. Null when unknown. */
  nextServiceInKm: number | null;
  nextServiceDueAt: string | null;
  /** Open maintenance items that touch this checklist code. */
  openMaintenanceCodes: string[];
  /** Documents that are expired or expiring, by label. */
  invalidDocuments: string[];
  expiringDocuments: string[];
}

export interface ChecklistItemEvaluation {
  code: string;
  label: string;
  kind: TerminalChecklistItemKind;
  /** Null when only the driver can answer — the UI then asks them. */
  status: TerminalChecklistItemStatus | null;
  observedValue: number | null;
  unit: string | null;
  metric: TelemetryMetric | null;
  /** True when `observedValue` came from a simulator rather than a sensor. */
  simulated: boolean;
  /** One line explaining the verdict, or why there is none. */
  detail: string | null;
  blocking: boolean;
  required: boolean;
  /** True when the driver must choose Good / Needs attention themselves. */
  manualInputRequired: boolean;
}

/**
 * Decide what the vehicle itself can say about one checklist item.
 *
 * The rule that matters is the fall-through: an item whose metric is not in
 * `metrics` returns `status: null` and `manualInputRequired: true`. It does not
 * return OK, and it does not return a value. A generic OBD adapter that cannot
 * read fuel level must never produce a fuel verdict, and a phone certainly
 * cannot — section 18 is explicit about it, and a false "✓ NORMAL" on a
 * pre-trip check is exactly the failure that puts a vehicle on the road it
 * should not be on.
 */
export function evaluateChecklistItem(
  item: ChecklistItemDefinition,
  telemetry: ChecklistTelemetryContext | null,
  vehicle: ChecklistVehicleContext | null,
): ChecklistItemEvaluation {
  const base: ChecklistItemEvaluation = {
    code: item.code,
    label: item.label,
    kind: item.kind,
    status: null,
    observedValue: null,
    unit: null,
    metric: item.metric ?? null,
    simulated: false,
    detail: null,
    blocking: item.blocking,
    required: item.required,
    manualInputRequired: true,
  };

  if (item.kind === ItemKind.TELEMETRY && item.metric) {
    const reported = telemetry?.metrics.includes(item.metric) ?? false;
    if (!telemetry || !reported) {
      return {
        ...base,
        detail: 'This vehicle does not report that reading. Manual inspection required.',
      };
    }

    const simulated = telemetry.simulatedMetrics.includes(item.metric);

    if (item.metric === Metric.COOLANT_TEMPERATURE && telemetry.coolantTemperature !== null) {
      const value = telemetry.coolantTemperature;
      const status =
        value >= CHECKLIST_THRESHOLDS.coolant.criticalC
          ? 'CRITICAL'
          : value >= CHECKLIST_THRESHOLDS.coolant.attentionC
            ? 'ATTENTION'
            : 'OK';
      return {
        ...base,
        status: status as TerminalChecklistItemStatus,
        observedValue: value,
        unit: '°C',
        simulated,
        manualInputRequired: false,
        detail: `Vehicle data: ${value.toFixed(0)} °C`,
      };
    }

    if (item.metric === Metric.FUEL_LEVEL && telemetry.fuelLevel !== null) {
      const value = telemetry.fuelLevel;
      const status =
        value <= CHECKLIST_THRESHOLDS.fuel.criticalPercent
          ? 'CRITICAL'
          : value <= CHECKLIST_THRESHOLDS.fuel.attentionPercent
            ? 'ATTENTION'
            : 'OK';
      return {
        ...base,
        status: status as TerminalChecklistItemStatus,
        observedValue: value,
        unit: '%',
        simulated,
        manualInputRequired: false,
        detail: `Vehicle data: ${value.toFixed(0)}%`,
      };
    }

    if (item.metric === Metric.BATTERY_VOLTAGE && telemetry.batteryVoltage !== null) {
      const value = telemetry.batteryVoltage;
      const status =
        value <= CHECKLIST_THRESHOLDS.battery.criticalVolts
          ? 'CRITICAL'
          : value <= CHECKLIST_THRESHOLDS.battery.attentionVolts
            ? 'ATTENTION'
            : 'OK';
      return {
        ...base,
        status: status as TerminalChecklistItemStatus,
        observedValue: value,
        unit: 'V',
        simulated,
        manualInputRequired: false,
        detail: `Vehicle data: ${value.toFixed(1)} V`,
      };
    }

    return {
      ...base,
      detail: 'That reading was not present in the last frame. Manual inspection required.',
    };
  }

  if (item.kind === ItemKind.MAINTENANCE) {
    if (!vehicle) return { ...base, detail: 'No service record available.' };

    if (vehicle.openMaintenanceCodes.includes(item.code)) {
      return {
        ...base,
        status: 'ATTENTION' as TerminalChecklistItemStatus,
        manualInputRequired: true,
        detail: 'An open maintenance item covers this. Confirm it is safe to drive.',
      };
    }
    if (vehicle.nextServiceInKm !== null) {
      const km = vehicle.nextServiceInKm;
      const status =
        km <= CHECKLIST_THRESHOLDS.service.criticalKm
          ? 'ATTENTION'
          : km <= CHECKLIST_THRESHOLDS.service.attentionKm
            ? 'ATTENTION'
            : 'OK';
      return {
        ...base,
        status: status as TerminalChecklistItemStatus,
        observedValue: km,
        unit: 'km',
        manualInputRequired: status !== 'OK',
        detail:
          km <= 0
            ? 'Service is overdue.'
            : `Next service in ${Math.round(km).toLocaleString('en-IN')} km.`,
      };
    }
    return { ...base, detail: 'No service interval recorded. Manual inspection required.' };
  }

  if (item.kind === ItemKind.DOCUMENT) {
    if (!vehicle) return { ...base, detail: 'Document status unavailable.' };
    if (vehicle.invalidDocuments.length > 0) {
      return {
        ...base,
        status: 'CRITICAL' as TerminalChecklistItemStatus,
        manualInputRequired: false,
        detail: `Expired: ${vehicle.invalidDocuments.join(', ')}.`,
      };
    }
    if (vehicle.expiringDocuments.length > 0) {
      return {
        ...base,
        status: 'ATTENTION' as TerminalChecklistItemStatus,
        manualInputRequired: false,
        detail: `Expiring soon: ${vehicle.expiringDocuments.join(', ')}.`,
      };
    }
    return {
      ...base,
      status: 'OK' as TerminalChecklistItemStatus,
      manualInputRequired: false,
      detail: 'All required documents are valid.',
    };
  }

  return { ...base, detail: item.description };
}

/**
 * Roll individual verdicts up into one outcome.
 *
 * A CRITICAL on a blocking item fails the whole check, and the trip does not
 * start. Everything else is a warning the driver has to acknowledge but may
 * proceed past — because a mirror that needs cleaning is not a reason to strand
 * a load, and a checklist that fails on everything is a checklist people learn
 * to tap through.
 */
export function rollUpChecklist(
  results: readonly {
    status: TerminalChecklistItemStatus;
    blocking: boolean;
    required: boolean;
  }[],
): TerminalChecklistOutcome {
  const blockingFailure = results.some(
    (result) => result.blocking && result.status === 'CRITICAL',
  );
  if (blockingFailure) return 'FAILED' as TerminalChecklistOutcome;

  const missingRequired = results.some(
    (result) => result.required && result.status === 'UNAVAILABLE',
  );
  const anyWarning = results.some(
    (result) => result.status === 'ATTENTION' || result.status === 'CRITICAL',
  );

  return (
    anyWarning || missingRequired ? 'PASSED_WITH_WARNINGS' : 'PASSED'
  ) as TerminalChecklistOutcome;
}

// ---------------------------------------------------------------------------
// Views returned to the terminal
// ---------------------------------------------------------------------------

/** The vehicle, as a terminal is allowed to see it. */
export interface TerminalVehicleView {
  id: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  truckType: string;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  fuelType: string;
  capacityTons: number;
  odometerKm: number;
  status: string;
  organizationName: string;
}

/** The permanent vehicle QR, exactly as the terminal must display it. */
export interface TerminalVehicleQrView {
  qrCodeId: string;
  /** Short human-typeable form, for a dirty screen or a bad camera. */
  shortLabel: string;
  /** The URL the code encodes. Resolved by Saarthi, never parsed on-device. */
  targetUrl: string;
  /** Rendered PNG data URI, ready for an `<img>` or an Android bitmap. */
  imageDataUri: string;
  /** Whether an anonymous scan resolves at all. Display-only. */
  allowPublicResolve: boolean;
  version: number;
  issuedAt: string;
}

export interface TerminalDriverView {
  driverId: string;
  userId: string;
  name: string;
  photoUrl: string | null;
  licenseClass: string | null;
  /** VALID | EXPIRING_SOON | EXPIRED | UNKNOWN — from the shared document rules. */
  licenseValidity: string;
  licenseExpiresAt: string | null;
  verificationStatus: string;
  experienceYears: number;
  totalTrips: number;
  /** Band rather than the exact score; a terminal is not a performance review. */
  scoreBand: string | null;
}

export interface TerminalSessionView {
  id: string;
  status: TerminalSessionStatus;
  state: TerminalState;
  driver: TerminalDriverView | null;
  vehicleId: string;
  registrationNumber: string;
  terminalDeviceId: string;
  requestedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  rejectionReason: string | null;
  /** Present only to callers entitled to see it — never on a public surface. */
  selfieUrl: string | null;
  selfieCapturedAt: string | null;
  expiresAt: string | null;
  remindedAt: string | null;
  escalatedAt: string | null;
  /** Seconds left before the SLA escalation fires. Negative once it has. */
  secondsUntilEscalation: number | null;
  checklistCompletedAt: string | null;
  checklistOutcome: TerminalChecklistOutcome | null;
  tripStartedAt: string | null;
  tripCompletedAt: string | null;
}

/** What the terminal reports about itself, on top of the device heartbeat. */
export interface TerminalHealthView {
  online: boolean;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  networkType: DeviceNetworkType;
  gpsStatus: DeviceSubsystemStatus;
  cameraStatus: DeviceSubsystemStatus;
  /** True when a telemetry frame arrived recently enough to be current. */
  vehicleDataConnected: boolean;
  lastHeartbeatAt: string | null;
  lastTelemetryAt: string | null;
}

/**
 * Everything the terminal needs to render any screen, in one call.
 *
 * One request rather than six, because a tablet on a 2G connection in a yard
 * cannot afford six round trips to decide which screen to show — and because
 * six independent answers can disagree with each other, which is how a terminal
 * ends up showing a welcome screen for a driver who has just been rejected.
 */
export interface TerminalStateView {
  state: TerminalState;
  terminal: {
    deviceId: string | null;
    deviceIdentifier: string;
    status: string;
    paired: boolean;
    appVersion: string | null;
  };
  organizationId: string | null;
  vehicle: TerminalVehicleView | null;
  vehicleQr: TerminalVehicleQrView | null;
  session: TerminalSessionView | null;
  health: TerminalHealthView | null;
  /** Server time, so the terminal can correct a drifted clock in its display. */
  serverTime: string;
  /** Reporting cadence, video and simulation policy — the device config. */
  reportingIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  simulationAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Nearby services (specification section 28)
// ---------------------------------------------------------------------------

/**
 * The service categories a terminal offers, in the order a driver needs them.
 *
 * Mapped onto the existing `NearbyCategory` catalogue rather than inventing a
 * second one — the terminal asks the same `/nearby/places` the web app asks.
 */
export const TERMINAL_SERVICE_CATEGORIES = [
  { key: 'FUEL', label: 'Fuel', categories: ['FUEL', 'CHARGING'] },
  { key: 'MECHANIC', label: 'Mechanic', categories: ['WORKSHOP'] },
  { key: 'TYRE', label: 'Tyres & battery', categories: ['TYRE_SHOP'] },
  { key: 'PARKING', label: 'Truck parking', categories: ['PARKING'] },
  { key: 'FOOD', label: 'Food & rest', categories: ['FOOD', 'REST_AREA'] },
  { key: 'HOSPITAL', label: 'Hospital', categories: ['HOSPITAL', 'PHARMACY'] },
  { key: 'POLICE', label: 'Police', categories: ['POLICE'] },
  { key: 'WEIGHBRIDGE', label: 'Weighbridge', categories: ['WEIGHBRIDGE'] },
] as const satisfies readonly {
  key: string;
  label: string;
  categories: readonly NearbyCategory[];
}[];
export type TerminalServiceCategoryKey =
  (typeof TERMINAL_SERVICE_CATEGORIES)[number]['key'];

/**
 * The Saarthi categories behind one terminal service key.
 *
 * Returns an empty list for an unknown key rather than throwing: a terminal
 * running an older build may ask for a key this server no longer has, and an
 * empty result list is a far better answer than a 500 in a truck cab.
 */
export function nearbyCategoriesFor(
  key: string,
): readonly NearbyCategory[] {
  return (
    TERMINAL_SERVICE_CATEGORIES.find((entry) => entry.key === key)?.categories ?? []
  );
}

// ---------------------------------------------------------------------------
// Issue reports (specification section 27)
// ---------------------------------------------------------------------------

export interface TerminalIssueView {
  id: string;
  category: TerminalIssueCategory;
  status: TerminalIssueStatus;
  severity: AlertSeverity;
  description: string;
  mediaUrls: string[];
  latitude: number | null;
  longitude: number | null;
  odometerKm: number | null;
  vehicleId: string;
  registrationNumber: string;
  driverName: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

/**
 * How urgently an issue category is treated by default.
 *
 * A driver reporting an accident is not filing a maintenance ticket, and the
 * notification that goes out has to reflect that without waiting for somebody
 * to triage it.
 */
export function defaultIssueSeverity(category: TerminalIssueCategory): AlertSeverity {
  switch (category) {
    case 'ACCIDENT':
      return 'CRITICAL' as AlertSeverity;
    case 'BRAKE':
    case 'ENGINE':
      return 'WARNING' as AlertSeverity;
    default:
      return 'INFO' as AlertSeverity;
  }
}

// ---------------------------------------------------------------------------
// Voice (specification sections 29, 33, 35)
// ---------------------------------------------------------------------------

/** The wake phrase. One string, so the app and any docs cannot disagree. */
export const TERMINAL_WAKE_PHRASE = 'hey saarthi';

/**
 * Intents the terminal resolves *without* a model.
 *
 * Emergency is the reason this exists. "Hey Saarthi, SOS" must reach the
 * emergency workflow immediately, and routing it through a language model
 * first would add a network round trip and a chance of it being answered
 * conversationally instead of acted on. Everything else falls through to
 * Gemini and the controlled tool layer.
 */
export const TerminalVoiceIntent = {
  SOS: 'SOS',
  CANCEL: 'CANCEL',
  ASK: 'ASK',
} as const;
export type TerminalVoiceIntent =
  (typeof TerminalVoiceIntent)[keyof typeof TerminalVoiceIntent];

const SOS_PHRASES = [
  'sos',
  'emergency',
  'help me',
  'accident',
  'madad',
  'bachao',
];

/** Classify an utterance before it reaches the model. */
export function classifyVoiceUtterance(utterance: string): TerminalVoiceIntent {
  const text = utterance.trim().toLowerCase();
  if (text.length === 0) return TerminalVoiceIntent.CANCEL;
  const stripped = text.startsWith(TERMINAL_WAKE_PHRASE)
    ? text.slice(TERMINAL_WAKE_PHRASE.length).trim()
    : text;
  if (stripped.length === 0) return TerminalVoiceIntent.CANCEL;
  // Whole-word match: "no sos" would be a cancellation, but "sostenuto" is not
  // an emergency, and a substring test cannot tell them apart.
  const words = new Set(stripped.split(/[^a-z]+/).filter(Boolean));
  if (SOS_PHRASES.some((phrase) => phrase.split(' ').every((word) => words.has(word)))) {
    return TerminalVoiceIntent.SOS;
  }
  if (stripped === 'cancel' || stripped === 'stop' || stripped === 'never mind') {
    return TerminalVoiceIntent.CANCEL;
  }
  return TerminalVoiceIntent.ASK;
}

/** The AI surface's visual state. Shared so the app and docs agree on names. */
export const TerminalAssistantState = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  ERROR: 'ERROR',
} as const;
export type TerminalAssistantState =
  (typeof TerminalAssistantState)[keyof typeof TerminalAssistantState];

// ---------------------------------------------------------------------------
// Telemetry source (specification sections 19, 20, 48)
// ---------------------------------------------------------------------------

/**
 * Where a normalised frame came from.
 *
 * The dashboard consumes normalised data and does not care — that is the point
 * of the abstraction — but the *label* travels with the frame so a reading can
 * never be presented as engine data when a simulator produced it.
 */
export const TerminalTelemetrySource = {
  PHONE: 'PHONE',
  SIMULATED: 'SIMULATED',
  OBD: 'OBD',
  PRODUCTION: 'PRODUCTION',
} as const;
export type TerminalTelemetrySource =
  (typeof TerminalTelemetrySource)[keyof typeof TerminalTelemetrySource];

// ---------------------------------------------------------------------------
// Distance and routing (specification sections 29 and 44)
// ---------------------------------------------------------------------------

/**
 * How a distance was arrived at.
 *
 * The single most important field in this section, and the reason it exists as
 * a type rather than a comment: a driver told the nearest fuel station is
 * 3.2 km away, when that is the crow-flies figure and the road is 11 km around
 * a river, runs out of fuel. They are then right never to trust the number
 * again — which costs more than the one bad answer did.
 *
 * So every distance Saarthi shows says which kind it is, and the UI renders
 * them differently: `ROAD` is "3.2 km", `STRAIGHT_LINE` is "3.2 km direct".
 */
export const DistanceBasis = {
  /** Measured along the road network by the routing provider. */
  ROAD: 'ROAD',
  /**
   * Great-circle distance between two points.
   *
   * The honest fallback when routing is unconfigured, out of quota, or could
   * not connect the pair. Always shorter than the real drive, sometimes by a
   * lot, and never presented as though it were not.
   */
  STRAIGHT_LINE: 'STRAIGHT_LINE',
} as const;
export type DistanceBasis = (typeof DistanceBasis)[keyof typeof DistanceBasis];

/** A measured distance, with its provenance attached. */
export interface MeasuredDistance {
  km: number;
  basis: DistanceBasis;
  /** Free-flow driving time. Null for a straight-line measurement. */
  durationMinutes: number | null;
}

/**
 * A nearby place with the distance a driver actually has to cover.
 *
 * `straightLineKm` is kept alongside `distance` deliberately. When routing is
 * available the two differ, and the gap is information: a place 800 m away in a
 * straight line but 6 km by road is on the other side of a motorway, and a
 * driver deciding whether to walk or drive wants to know that.
 */
export interface TerminalServiceResult {
  id: string;
  category: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  phone: string | null;
  open24Hours: boolean;
  openingHours: string | null;
  /** Compass direction from the vehicle, e.g. "NE". */
  direction: string;
  /** Straight-line distance. Always present — it needs no provider. */
  straightLineKm: number;
  /** What the driver will actually cover, road-measured where possible. */
  distance: MeasuredDistance;
  /** Which directory the record came from, for attribution. */
  source: string;
}

export interface TerminalServicesResponse {
  service: string | null;
  /** Where the search was centred. */
  from: { latitude: number; longitude: number };
  places: TerminalServiceResult[];
  /**
   * Whether road distances were available for this answer.
   *
   * Stated rather than inferred from the results, so a terminal can say "showing
   * direct distances — routing is unavailable" once at the top instead of
   * leaving a driver to notice the wording on every row.
   */
  roadDistancesAvailable: boolean;
  /** Why not, when they were not. Shown to the driver verbatim. */
  routingNote: string | null;
}

/** One instruction on the way. */
export interface TerminalRouteStep {
  distanceMeters: number;
  durationSeconds: number;
  /** Road name, or "Unnamed road". */
  name: string;
  instruction: string;
  /** `turn`, `roundabout`, `arrive`, `depart`, `fork`, `continue`. */
  maneuver: string;
  /** `left`, `slight right`, `uturn`, … or null when not a turn. */
  modifier: string | null;
  latitude: number;
  longitude: number;
}

/**
 * A route the terminal can draw and follow.
 *
 * Routed for the *vehicle*, not for a car: `driving-hgv` respects the weight,
 * height and access limits a car profile ignores, and sending a 40-tonne truck
 * down a lane with a 7.5 t restriction is worse than giving no route at all.
 * `profile` says which was used, so a terminal on a passenger vehicle is not
 * silently routed as a lorry either.
 */
export interface TerminalRouteView {
  distanceKm: number;
  /** Free-flow. There is no traffic model behind this, and it is not implied. */
  durationMinutes: number;
  /** The roads used, e.g. "NH 48 · Ring Road". */
  summary: string;
  profile: string;
  /** Polyline from the vehicle to the destination. */
  geometry: { latitude: number; longitude: number }[];
  steps: TerminalRouteStep[];
  destination: {
    name: string;
    latitude: number;
    longitude: number;
  };
  /** Estimated arrival, computed server-side so a drifted tablet clock cannot skew it. */
  etaAt: string;
}

/**
 * The next instruction, given where the vehicle is now.
 *
 * Computed on the device from a route it already holds — a terminal must be
 * able to keep telling a driver where to turn through a tunnel, and a
 * server round trip per instruction would be both slow and useless offline.
 */
export interface NextManeuver {
  instruction: string;
  maneuver: string;
  modifier: string | null;
  /** Metres from the vehicle's current position to the manoeuvre. */
  distanceMeters: number;
  roadName: string;
}

// ---------------------------------------------------------------------------
// Ad-hoc service runs (a trip nobody dispatched)
// ---------------------------------------------------------------------------

/**
 * A journey the vehicle made on its own account.
 *
 * A driver with no dispatched trip who takes the truck to a petrol pump, a
 * workshop or a weighbridge is still covering distance, wearing tyres and
 * burning diesel — and until now none of that was written down anywhere. The
 * terminal opens one of these the moment the driver picks a destination from
 * the nearby-services list, and closes it when the vehicle arrives.
 *
 * It is a real `Trip`, not a parallel record. That is the whole point: the
 * fleet map, the trip list, the driver score and the analytics already know how
 * to read a trip, and a second kind of movement would have to be taught to all
 * of them one at a time.
 */
export interface AdHocTripView {
  id: string;
  reference: string;
  status: string;
  destinationName: string;
  destinationLatitude: number;
  destinationLongitude: number;
  plannedDistanceKm: number | null;
  /** Distance the tracking pipeline has actually observed so far. */
  actualDistanceKm: number;
  startedAt: string;
  /** Vehicle odometer when the run opened. */
  startOdometerKm: number | null;
}

/**
 * What the terminal measured while a service run was open.
 *
 * Every figure is optional because a terminal that lost GPS for the whole run
 * has nothing honest to report, and a zero would read as "the vehicle did not
 * move" rather than "nobody knows". The server keeps the larger of its own
 * tracked distance and the terminal's, since the two measure the same journey
 * by different means and the longer one is the one with fewer gaps.
 */
export interface AdHocTripSummary {
  distanceKm: number | null;
  topSpeedKph: number | null;
  averageSpeedKph: number | null;
  harshBrakingCount: number;
  harshAccelerationCount: number;
  /** Odometer at the end of the run. Never allowed to move backwards. */
  odometerKm: number | null;
}
