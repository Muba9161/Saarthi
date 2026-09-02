import { describe, expect, it } from 'vitest';
import { TelemetryMetric, TerminalSessionStatus } from './enums';
import {
  DEFAULT_CHECKLIST_ITEMS,
  TERMINAL_APPROVAL_SLA,
  TerminalState,
  TerminalVoiceIntent,
  canTransition,
  classifyVoiceUtterance,
  evaluateChecklistItem,
  isCockpitAvailable,
  isDriverAuthorized,
  nearbyCategoriesFor,
  normalizeTerminalPairingCode,
  rollUpChecklist,
  terminalStateForSession,
  type ChecklistItemDefinition,
  type ChecklistTelemetryContext,
  type ChecklistVehicleContext,
} from './terminal';

/**
 * The Saarthi Terminal rules that decide whether a vehicle goes out.
 *
 * These are the pure functions behind the two most consequential behaviours in
 * the product — what a pre-trip check is allowed to claim, and when a driver
 * counts as authorised — so the tests are written as statements about safety
 * rather than as coverage.
 */

const telemetryContext = (
  overrides: Partial<ChecklistTelemetryContext> = {},
): ChecklistTelemetryContext => ({
  recordedAt: new Date().toISOString(),
  metrics: [],
  simulatedMetrics: [],
  coolantTemperature: null,
  fuelLevel: null,
  batteryVoltage: null,
  rpm: null,
  engineLoad: null,
  odometer: null,
  diagnosticCodes: [],
  ...overrides,
});

const vehicleContext = (
  overrides: Partial<ChecklistVehicleContext> = {},
): ChecklistVehicleContext => ({
  nextServiceInKm: null,
  nextServiceDueAt: null,
  openMaintenanceCodes: [],
  invalidDocuments: [],
  expiringDocuments: [],
  ...overrides,
});

const item = (code: string): ChecklistItemDefinition =>
  DEFAULT_CHECKLIST_ITEMS.find((entry) => entry.code === code)!;

describe('terminal checklist evaluation', () => {
  it('refuses to answer a telemetry item the vehicle does not report', () => {
    // The single most important assertion in this file. A tablet has no
    // connection to the engine, and a generic OBD adapter reads a subset of
    // what a truck's ECU knows — so an item with no reading must fall back to a
    // manual inspection, never quietly pass.
    const result = evaluateChecklistItem(
      item('COOLANT'),
      telemetryContext({ metrics: [TelemetryMetric.SPEED] }),
      vehicleContext(),
    );

    expect(result.status).toBeNull();
    expect(result.manualInputRequired).toBe(true);
    expect(result.observedValue).toBeNull();
    expect(result.detail).toMatch(/does not report/i);
  });

  it('refuses to answer when there is no telemetry at all', () => {
    const result = evaluateChecklistItem(item('FUEL'), null, vehicleContext());

    expect(result.status).toBeNull();
    expect(result.manualInputRequired).toBe(true);
  });

  it('answers a telemetry item the vehicle genuinely reports', () => {
    const result = evaluateChecklistItem(
      item('COOLANT'),
      telemetryContext({
        metrics: [TelemetryMetric.COOLANT_TEMPERATURE],
        coolantTemperature: 86,
      }),
      vehicleContext(),
    );

    expect(result.status).toBe('OK');
    expect(result.observedValue).toBe(86);
    expect(result.unit).toBe('°C');
    expect(result.manualInputRequired).toBe(false);
    expect(result.simulated).toBe(false);
  });

  it('carries the simulated flag through to the verdict', () => {
    // A fabricated coolant temperature that read as measured would send a
    // working truck to a workshop. The flag has to survive evaluation.
    const result = evaluateChecklistItem(
      item('COOLANT'),
      telemetryContext({
        metrics: [TelemetryMetric.COOLANT_TEMPERATURE],
        simulatedMetrics: [TelemetryMetric.COOLANT_TEMPERATURE],
        coolantTemperature: 112,
      }),
      vehicleContext(),
    );

    expect(result.status).toBe('CRITICAL');
    expect(result.simulated).toBe(true);
  });

  it('grades coolant against the documented thresholds', () => {
    const at = (value: number) =>
      evaluateChecklistItem(
        item('COOLANT'),
        telemetryContext({
          metrics: [TelemetryMetric.COOLANT_TEMPERATURE],
          coolantTemperature: value,
        }),
        vehicleContext(),
      ).status;

    expect(at(86)).toBe('OK');
    expect(at(101)).toBe('ATTENTION');
    expect(at(110)).toBe('CRITICAL');
  });

  it('grades fuel downward rather than upward', () => {
    const at = (value: number) =>
      evaluateChecklistItem(
        item('FUEL'),
        telemetryContext({ metrics: [TelemetryMetric.FUEL_LEVEL], fuelLevel: value }),
        vehicleContext(),
      ).status;

    expect(at(64)).toBe('OK');
    expect(at(15)).toBe('ATTENTION');
    expect(at(5)).toBe('CRITICAL');
  });

  it('fails the documents item on an expired document, without asking the driver', () => {
    const result = evaluateChecklistItem(
      item('DOCUMENTS'),
      null,
      vehicleContext({ invalidDocuments: ['INSURANCE'] }),
    );

    expect(result.status).toBe('CRITICAL');
    expect(result.manualInputRequired).toBe(false);
    expect(result.detail).toContain('INSURANCE');
  });

  it('leaves a manual item entirely to the driver', () => {
    const result = evaluateChecklistItem(item('TYRES'), telemetryContext(), vehicleContext());

    expect(result.status).toBeNull();
    expect(result.manualInputRequired).toBe(true);
    expect(result.kind).toBe('MANUAL');
  });
});

describe('checklist roll-up', () => {
  it('fails when a blocking item is critical', () => {
    expect(
      rollUpChecklist([
        { status: 'OK' as never, blocking: false, required: true },
        { status: 'CRITICAL' as never, blocking: true, required: true },
      ]),
    ).toBe('FAILED');
  });

  it('does not fail on a critical NON-blocking item', () => {
    // A cracked mirror should not strand a load. The distinction is what stops
    // drivers learning to tap through a checklist that fails on everything.
    expect(
      rollUpChecklist([
        { status: 'OK' as never, blocking: true, required: true },
        { status: 'CRITICAL' as never, blocking: false, required: true },
      ]),
    ).toBe('PASSED_WITH_WARNINGS');
  });

  it('warns rather than passing when a required item is unanswerable', () => {
    expect(
      rollUpChecklist([
        { status: 'OK' as never, blocking: true, required: true },
        { status: 'UNAVAILABLE' as never, blocking: false, required: true },
      ]),
    ).toBe('PASSED_WITH_WARNINGS');
  });

  it('passes only when everything is genuinely OK', () => {
    expect(
      rollUpChecklist([
        { status: 'OK' as never, blocking: true, required: true },
        { status: 'OK' as never, blocking: false, required: true },
      ]),
    ).toBe('PASSED');
  });
});

describe('terminal state machine', () => {
  it('does not treat an approved driver as authorised until the check is done', () => {
    expect(
      terminalStateForSession(TerminalSessionStatus.APPROVED, { checklistComplete: false }),
    ).toBe(TerminalState.CHECKLIST_REQUIRED);

    expect(
      terminalStateForSession(TerminalSessionStatus.APPROVED, { checklistComplete: true }),
    ).toBe(TerminalState.READY);

    expect(isDriverAuthorized(TerminalState.CHECKLIST_REQUIRED)).toBe(false);
    expect(isDriverAuthorized(TerminalState.READY)).toBe(true);
    expect(isCockpitAvailable(TerminalState.PENDING_APPROVAL)).toBe(false);
  });

  it('returns a rejected, cancelled or expired session to the idle state', () => {
    for (const status of [
      TerminalSessionStatus.CANCELLED,
      TerminalSessionStatus.EXPIRED,
    ]) {
      expect(terminalStateForSession(status)).toBe(TerminalState.AWAITING_DRIVER);
    }
    expect(terminalStateForSession(TerminalSessionStatus.REJECTED)).toBe(
      TerminalState.REJECTED,
    );
  });

  it('allows the loop the specification draws, and refuses shortcuts', () => {
    expect(canTransition(TerminalState.PENDING_APPROVAL, TerminalState.APPROVED)).toBe(true);
    expect(canTransition(TerminalState.REJECTED, TerminalState.AWAITING_DRIVER)).toBe(true);
    expect(canTransition(TerminalState.TRIP_COMPLETED, TerminalState.AWAITING_DRIVER)).toBe(true);

    // The two that matter: a driver cannot reach the cockpit without being
    // approved, and cannot start a trip without the safety check.
    expect(canTransition(TerminalState.PENDING_APPROVAL, TerminalState.READY)).toBe(false);
    expect(canTransition(TerminalState.CHECKLIST_REQUIRED, TerminalState.TRIP_ACTIVE)).toBe(
      false,
    );
    expect(canTransition(TerminalState.AWAITING_DRIVER, TerminalState.APPROVED)).toBe(false);
  });
});

describe('approval SLA', () => {
  it('escalates at fifteen minutes and never approves', () => {
    expect(TERMINAL_APPROVAL_SLA.escalateAfterMinutes).toBe(15);
    expect(TERMINAL_APPROVAL_SLA.remindAfterMinutes).toBeLessThan(
      TERMINAL_APPROVAL_SLA.escalateAfterMinutes,
    );
    expect(TERMINAL_APPROVAL_SLA.expireAfterMinutes).toBeGreaterThan(
      TERMINAL_APPROVAL_SLA.escalateAfterMinutes,
    );

    // Section 15, asserted as a test rather than trusted to review: there must
    // be no auto-approval setting, ever. If this fails because somebody added
    // one, that is the bug.
    expect(Object.keys(TERMINAL_APPROVAL_SLA)).not.toContain('autoApproveAfterMinutes');
  });
});

describe('voice classification', () => {
  it('recognises an emergency in English and Hindi', () => {
    for (const phrase of [
      'hey saarthi sos',
      'SOS',
      'hey saarthi emergency',
      'accident',
      'bachao',
      'madad',
      'help me',
    ]) {
      expect(classifyVoiceUtterance(phrase)).toBe(TerminalVoiceIntent.SOS);
    }
  });

  it('does not mistake an ordinary word for an emergency', () => {
    // Whole-word matching. A substring test would fire on "sostenuto" and would
    // miss nothing that matters, so it trades false alarms for nothing.
    for (const phrase of [
      'hey saarthi find the nearest sostenuto',
      'hey saarthi what is my fuel level',
      'how far is my destination',
    ]) {
      expect(classifyVoiceUtterance(phrase)).toBe(TerminalVoiceIntent.ASK);
    }
  });

  it('treats silence and cancellation as a dismissal', () => {
    for (const phrase of ['', '   ', 'hey saarthi', 'cancel', 'never mind']) {
      expect(classifyVoiceUtterance(phrase)).toBe(TerminalVoiceIntent.CANCEL);
    }
  });
});

describe('pairing codes', () => {
  it('normalises whatever an installer types', () => {
    expect(normalizeTerminalPairingCode('sth4k2p9xq7')).toBe('STH-4K2P-9XQ7');
    expect(normalizeTerminalPairingCode('STH-4K2P-9XQ7')).toBe('STH-4K2P-9XQ7');
    expect(normalizeTerminalPairingCode(' sth 4k2p 9xq7 ')).toBe('STH-4K2P-9XQ7');
  });

  it('rejects anything that is not a terminal code', () => {
    expect(normalizeTerminalPairingCode('4K2P9XQ7')).toBeNull();
    expect(normalizeTerminalPairingCode('STH-4K2P')).toBeNull();
    expect(normalizeTerminalPairingCode('STH-4K2P-9XQ7-EXTRA')).toBeNull();
    expect(normalizeTerminalPairingCode('')).toBeNull();
  });
});

describe('service categories', () => {
  it('maps a terminal service key onto real Saarthi categories', () => {
    expect(nearbyCategoriesFor('FUEL')).toContain('FUEL');
    expect(nearbyCategoriesFor('MECHANIC')).toContain('WORKSHOP');
  });

  it('returns nothing for a key it does not know', () => {
    // An older terminal asking for a key this server has dropped should get an
    // empty result list, not an error in a truck cab.
    expect(nearbyCategoriesFor('TELEPORTER')).toEqual([]);
  });
});

describe('the default checklist', () => {
  it('is the ten points the specification lists, in order', () => {
    expect(DEFAULT_CHECKLIST_ITEMS).toHaveLength(10);
    expect(DEFAULT_CHECKLIST_ITEMS.map((entry) => entry.code)).toEqual([
      'TYRES',
      'COOLANT',
      'ENGINE_OIL',
      'BRAKES',
      'LIGHTS',
      'BATTERY',
      'FUEL',
      'MIRRORS',
      'EMERGENCY_EQUIPMENT',
      'DOCUMENTS',
    ]);
  });

  it('blocks a trip on the things that should block a trip', () => {
    const blocking = DEFAULT_CHECKLIST_ITEMS.filter((entry) => entry.blocking).map(
      (entry) => entry.code,
    );
    expect(blocking).toContain('BRAKES');
    expect(blocking).toContain('TYRES');
    expect(blocking).toContain('DOCUMENTS');
    // Fuel is not blocking: an empty tank is a stop at a pump, not a fault.
    expect(blocking).not.toContain('FUEL');
  });
});
