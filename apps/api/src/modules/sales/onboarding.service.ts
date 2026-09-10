import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_LABEL,
  TelemetryMetric,
  onboardingIsComplete,
  type OnboardingReadiness,
  type OnboardingStep,
  type OnboardingStepResult,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { config } from '../../config/env';

/**
 * The first-vehicle demonstration, read back from the systems that already
 * know the answer.
 *
 * A salesperson sets up one vehicle in front of the owner to teach them the
 * process; vehicles two to ten are then done by the owner's own drivers using
 * the same Driver App, the same vehicle QR and the same OBD flow. This file's
 * only job is to say, honestly, whether that first vehicle actually came alive.
 *
 * ## What this file does not do
 *
 * It does not connect anything. There is no pairing here, no tracker
 * activation, no OBD handshake, no telemetry ingestion, no Driver App logic —
 * every one of those already exists in `modules/devices`, `modules/terminal`
 * and `modules/telemetry`, and those remain the technical source of truth.
 * Every function below is a `SELECT`.
 *
 * There is also no tracker QR code, and there is no code path in this module
 * that would accept one. Saarthi trackers carry no QR; the vehicle does, and
 * scanning it is the existing Driver App flow.
 *
 * ## Why every step can answer "unknown"
 *
 * A checklist that only says ✓ or ✗ lies twice. A tracker fitted ninety
 * seconds ago that has not reported yet is not a failed OBD connection, and
 * telling a salesperson to go and check a cable that is fine wastes the visit
 * and their credibility. So each step reports CONFIRMED, PENDING or UNKNOWN
 * with the observation behind it, and `SALES_ONBOARDING_TELEMETRY_GRACE_MINUTES`
 * decides when silence stops being "give it a moment".
 */

type StepBuilder = () => OnboardingStepResult;

function result(
  step: OnboardingStep,
  state: OnboardingStepResult['state'],
  detail: string,
  observedAt: Date | null = null,
): OnboardingStepResult {
  return {
    step,
    label: ONBOARDING_STEP_LABEL[step],
    state,
    detail,
    observedAt: observedAt?.toISOString() ?? null,
  };
}

/**
 * Everything Saarthi currently knows about one vehicle's setup.
 *
 * Read in one pass rather than a query per step: the six answers come from
 * four tables, and a salesperson standing in a yard refreshing this screen on
 * a phone tether should cost four round trips, not eleven.
 */
async function gather(vehicleId: string) {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      lastLocationAt: true,
      lastLatitude: true,
      lastLongitude: true,
    },
  });
  if (!vehicle) throw errors.notFound('Vehicle');

  const [tracker, assignment, latestReading, terminalSession] = await Promise.all([
    /*
     * The tracker entitlement the customer paid for, fitted to this vehicle.
     *
     * `vehicle_trackers`, not a sales-owned table: this is the row the
     * subscription module creates when the tracker is bought, and the salesman
     * handover is a custody note against it.
     */
    prisma.vehicleTracker.findFirst({
      where: { truckId: vehicleId, status: 'ACTIVE' },
      select: { id: true, serialNumber: true, purchasedAt: true },
    }),
    /*
     * The active telemetry device assignment — the existing vehicle-pairing
     * record, created by the Driver App scanning the vehicle QR or by the
     * fleet approving a terminal onto the vehicle.
     */
    prisma.deviceAssignment.findFirst({
      where: { vehicleId, status: 'ACTIVE' },
      orderBy: { assignedAt: 'desc' },
      include: {
        device: {
          select: {
            id: true,
            deviceIdentifier: true,
            provider: true,
            deviceType: true,
            role: true,
            lastHeartbeatAt: true,
            lastTelemetryAt: true,
            gpsStatus: true,
            observedMetrics: true,
            readingCount: true,
            appVersion: true,
            platform: true,
          },
        },
      },
    }),
    prisma.telemetryReading.findFirst({
      where: { vehicleId },
      orderBy: { recordedAt: 'desc' },
      select: {
        recordedAt: true,
        metrics: true,
        simulatedMetrics: true,
        latitude: true,
        longitude: true,
      },
    }),
    /*
     * A driver signed on through the existing Saarthi Terminal / Driver App
     * flow. Used as corroboration for "Driver App connected" — see the note on
     * that step, and note that nothing here creates or alters a session.
     */
    prisma.terminalSession.findFirst({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true, driverId: true },
    }),
  ]);

  return { vehicle, tracker, assignment, latestReading, terminalSession };
}

/** Engine-side metrics. Their presence is what distinguishes OBD from a phone GPS. */
const OBD_METRICS: readonly string[] = [
  TelemetryMetric.RPM,
  TelemetryMetric.ENGINE_LOAD,
  TelemetryMetric.COOLANT_TEMPERATURE,
  TelemetryMetric.FUEL_LEVEL,
  TelemetryMetric.FUEL_RATE,
  TelemetryMetric.THROTTLE_POSITION,
  TelemetryMetric.INTAKE_TEMPERATURE,
  TelemetryMetric.VIN,
  TelemetryMetric.DTC,
  TelemetryMetric.ODOMETER,
];

/**
 * Assess one vehicle against the six demonstration steps.
 *
 * Read-only, and safe to poll: the salesperson's screen refreshes this while
 * they wait for the first reading to arrive.
 */
export async function readiness(
  vehicleId: string,
  organizationId?: string,
): Promise<OnboardingReadiness> {
  const { vehicle, tracker, assignment, latestReading, terminalSession } =
    await gather(vehicleId);

  /*
   * Tenant check by argument rather than by session.
   *
   * A salesperson has no organization, so the usual `assertTenantAccess` does
   * not apply to them — their claim on this vehicle comes from the lead they
   * are working, which the route resolves and passes in here. Reported as a
   * 404 for the same reason `assertTenantAccess` does: a 403 would confirm the
   * vehicle exists.
   */
  if (organizationId && vehicle.organizationId !== organizationId) {
    throw errors.notFound('Vehicle');
  }

  const now = Date.now();
  const graceMs = config.sales.onboardingTelemetryGraceMinutes * 60_000;
  const device = assignment?.device ?? null;

  const builders: Record<OnboardingStep, StepBuilder> = {
    /*
     * Is there a Saarthi tracker on this vehicle at all?
     *
     * Answered from the paid-for entitlement rather than from hardware,
     * because that is the question at this point in the visit: the customer
     * bought a tracker and it has been allocated to this vehicle. Whether the
     * unit is talking is the OBD and telemetry steps below.
     */
    TRACKER_CONNECTED: () =>
      tracker
        ? result(
            'TRACKER_CONNECTED',
            'CONFIRMED',
            tracker.serialNumber
              ? `Saarthi tracker ${tracker.serialNumber} is fitted to this vehicle.`
              : 'A Saarthi tracker is allocated to this vehicle.',
            tracker.purchasedAt,
          )
        : result(
            'TRACKER_CONNECTED',
            'PENDING',
            'No active Saarthi tracker is fitted to this vehicle yet. Record the handover, then ' +
              'fit it from the subscription screen.',
          ),

    /*
     * Is a telemetry device paired to this vehicle?
     *
     * This is the existing `device_assignments` row — the output of the
     * vehicle-QR scan or the terminal approval. Its presence is what "vehicle
     * connected" means, and nothing in this module can create one.
     */
    VEHICLE_CONNECTED: () =>
      assignment && device
        ? result(
            'VEHICLE_CONNECTED',
            'CONFIRMED',
            `${device.deviceIdentifier} is paired to ${vehicle.registrationNumber}.`,
            assignment.assignedAt,
          )
        : result(
            'VEHICLE_CONNECTED',
            'PENDING',
            'Nothing is paired to this vehicle yet. Open the Saarthi Driver App and scan the ' +
              "vehicle's QR code, or enter its registration number.",
          ),

    /*
     * Has the Driver App actually connected?
     *
     * Two independent signals, either of which is enough, because the two
     * arrangements a customer can be in look different in the data:
     *
     *   * the paired device *is* the app — a phone or a fitted terminal, which
     *     reports its platform and app version on its heartbeat;
     *   * a driver signed on to this vehicle through the terminal flow, which
     *     leaves a session behind.
     *
     * A Freematics-only vehicle with no app has neither, and reports UNKNOWN
     * rather than a failure: the vehicle is genuinely reporting, and the app is
     * an extra the owner may add later.
     */
    DRIVER_APP_CONNECTED: () => {
      const appDevice =
        device &&
        (device.provider === 'MOBILE' ||
          device.deviceType === 'VEHICLE_TERMINAL' ||
          device.deviceType === 'MOBILE_TEST_DEVICE');

      if (appDevice && device.lastHeartbeatAt) {
        return result(
          'DRIVER_APP_CONNECTED',
          'CONFIRMED',
          `${device.platform ?? 'The Saarthi app'}${
            device.appVersion ? ` ${device.appVersion}` : ''
          } last reported in.`,
          device.lastHeartbeatAt,
        );
      }

      if (
        terminalSession &&
        ['APPROVED', 'READY', 'TRIP_ACTIVE', 'COMPLETED'].includes(terminalSession.status)
      ) {
        return result(
          'DRIVER_APP_CONNECTED',
          'CONFIRMED',
          'A driver has signed on to this vehicle from the Saarthi Driver App.',
          terminalSession.createdAt,
        );
      }

      if (appDevice) {
        return result(
          'DRIVER_APP_CONNECTED',
          'PENDING',
          'The app is paired to this vehicle but has not reported in yet. Open it and leave it ' +
            'on the trip screen for a moment.',
        );
      }

      return result(
        'DRIVER_APP_CONNECTED',
        'UNKNOWN',
        'No Saarthi Driver App has connected to this vehicle. The fitted tracker reports on its ' +
          'own, so this is optional — the driver can connect the app whenever they are ready.',
      );
    },

    /*
     * Is the OBD reading the vehicle?
     *
     * The distinguishing evidence is *engine* data — RPM, coolant, fuel — as
     * opposed to a position, which any phone can produce without touching the
     * vehicle. `simulatedMetrics` is subtracted first: a phone's on-device
     * engine simulator produces perfectly well-formed RPM figures, and
     * counting those as an OBD connection would be the single most misleading
     * tick on this screen.
     */
    OBD_CONNECTED: () => {
      if (!latestReading) {
        return result(
          'OBD_CONNECTED',
          'PENDING',
          'No reading has arrived from this vehicle yet, so the OBD connection cannot be ' +
            'confirmed. Plug the adapter in and turn the ignition on.',
        );
      }

      const simulated = new Set(latestReading.simulatedMetrics ?? []);
      const measured = (latestReading.metrics ?? []).filter((metric) => !simulated.has(metric));
      const engine = measured.filter((metric) => OBD_METRICS.includes(metric));

      if (engine.length > 0) {
        return result(
          'OBD_CONNECTED',
          'CONFIRMED',
          `The vehicle is reporting ${engine.length} engine value${
            engine.length === 1 ? '' : 's'
          } from its OBD port.`,
          latestReading.recordedAt,
        );
      }

      const simulatedEngine = (latestReading.simulatedMetrics ?? []).some((metric) =>
        OBD_METRICS.includes(metric),
      );

      return result(
        'OBD_CONNECTED',
        'PENDING',
        simulatedEngine
          ? 'Engine values are arriving from the app simulator rather than the vehicle. Connect ' +
            "the OBD adapter to the driver's phone to read the vehicle itself."
          : 'Position is arriving but no engine data is. Check that the OBD adapter is seated in ' +
            'the port and the ignition is on.',
        latestReading.recordedAt,
      );
    },

    /*
     * Has a reading reached Saarthi at all?
     *
     * The plainest step, and the one the grace window is for: a vehicle that
     * has never reported inside the window is still connecting, and one that
     * has never reported outside it needs somebody to look.
     */
    TELEMETRY_RECEIVED: () => {
      if (latestReading) {
        return result(
          'TELEMETRY_RECEIVED',
          'CONFIRMED',
          'Saarthi has received telemetry from this vehicle.',
          latestReading.recordedAt,
        );
      }

      const since = assignment?.assignedAt?.getTime() ?? null;
      const waiting = since !== null && now - since < graceMs;

      return result(
        'TELEMETRY_RECEIVED',
        waiting ? 'PENDING' : device ? 'PENDING' : 'UNKNOWN',
        waiting
          ? 'Waiting for the first reading. This usually arrives within a minute of the ignition ' +
            'being turned on.'
          : device
            ? 'Nothing has reached Saarthi from this vehicle yet. Check that the unit has power ' +
              'and a mobile signal.'
            : 'Nothing can report until a device is paired to this vehicle.',
      );
    },

    /*
     * Can the owner see their vehicle move?
     *
     * The step the demonstration is actually for, and it is checked against the
     * denormalised position the fleet map renders from — not against the
     * reading table. Those are written by the same ingest, but this is the one
     * the owner will be looking at thirty seconds later, and confirming the
     * other would be confirming the wrong thing.
     */
    VISIBLE_IN_SAARTHI: () =>
      vehicle.lastLocationAt && vehicle.lastLatitude !== null && vehicle.lastLongitude !== null
        ? result(
            'VISIBLE_IN_SAARTHI',
            'CONFIRMED',
            `${vehicle.registrationNumber} is on the live map.`,
            vehicle.lastLocationAt,
          )
        : result(
            'VISIBLE_IN_SAARTHI',
            'PENDING',
            'The vehicle has no position on the live map yet. It appears as soon as the first ' +
              'location fix arrives.',
          ),
  };

  const steps = ONBOARDING_STEPS.map((step) => builders[step]());
  const complete = onboardingIsComplete(steps);

  return {
    vehicleId: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    steps,
    complete,
    completedAt: complete
      ? (steps
          .map((step) => step.observedAt)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null)
      : null,
  };
}

/**
 * The readiness report, for a salesperson.
 *
 * A salesperson has no tenant membership, so their claim on a vehicle has to
 * come from somewhere else: the customer it belongs to must be one they are
 * credited with. That is resolved here — vehicle → organization → live
 * attribution — and a vehicle belonging to anybody else is reported as not
 * found, so this endpoint cannot be used to probe for vehicle ids.
 */
export async function readinessForSalesman(
  salesmanId: string,
  vehicleId: string,
): Promise<OnboardingReadiness> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { organizationId: true },
  });
  if (!vehicle) throw errors.notFound('Vehicle');

  const attribution = await prisma.referralAttribution.findFirst({
    where: {
      salesmanId,
      organizationId: vehicle.organizationId,
      status: { in: ['ATTRIBUTED', 'CONVERTED'] },
    },
    select: { id: true },
  });
  if (!attribution) throw errors.notFound('Vehicle');

  return readiness(vehicleId, vehicle.organizationId);
}

/**
 * Whether onboarding may be recorded as complete for this vehicle.
 *
 * Called by the route before it writes anything, so the completion flag on a
 * lead can only ever be set by re-reading the real state. A client cannot post
 * its way past this: the request carries a vehicle id and nothing else, and the
 * evidence is fetched here.
 */
export async function assertComplete(
  vehicleId: string,
  organizationId: string,
): Promise<OnboardingReadiness> {
  const report = await readiness(vehicleId, organizationId);
  if (report.complete) return report;

  const outstanding = report.steps
    .filter((step) => step.state !== 'CONFIRMED')
    .map((step) => step.label);

  throw errors.businessRule(
    `This vehicle is not fully set up yet. Outstanding: ${outstanding.join(', ')}.`,
    { steps: report.steps as never },
  );
}
