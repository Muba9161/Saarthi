import {
  DeviceEventType,
  DeviceStatus,
  TELEMETRY_ELIGIBLE_DEVICE_STATUSES,
  TELEMETRY_MAX_AGE_MS,
  TELEMETRY_MAX_CLOCK_SKEW_MS,
  TELEMETRY_BOUNDS,
  TelemetryMetric,
  TrackingSource,
  withinBounds,
  type NormalizedTelemetry,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { adapterFor } from '../../providers/devices';
import { ingestLocation } from '../tracking/tracking.service';
import { broadcastDeviceStatus, broadcastTelemetry } from '../../realtime/realtime.service';
import type { AuthenticatedDevice } from '../devices/device.service';
import { evaluateTelemetryRules } from './alert-engine';

/**
 * Device gateway — the telemetry ingestion boundary.
 *
 *   device → authenticate → adapter → validate → store → derive → broadcast
 *
 * Everything a device sends is hostile input until it has been through here.
 * The spec (section 24) requires that raw hardware payloads never touch
 * business tables directly, and this file is where that is enforced: nothing
 * downstream of `ingest` sees a vendor field name, an unbounded number or an
 * unauthenticated device.
 *
 * ## The checks, and why each exists
 *
 * * **Assignment** — a device with no active vehicle assignment has nothing to
 *   attribute its readings to. Accepting them would create orphan telemetry
 *   that later appears against whichever vehicle the unit is next fitted to.
 * * **Status** — SUSPENDED and RETIRED devices are rejected. That is what makes
 *   revoking a stolen unit meaningful rather than advisory.
 * * **Replay** — a sequence number at or below the highest already accepted is
 *   dropped, so a captured payload cannot be resubmitted to fake a position.
 * * **Clock** — a device clock running fast would let a reading claim to be
 *   from the future and win every "latest position" query for hours.
 * * **Bounds** — 900 km/h is not a truck. Bad hardware and injection look
 *   identical here, and neither belongs in a vehicle's history.
 *
 * ## Throttling
 *
 * A device reporting every second produces 86,400 rows a day. Location is
 * forwarded to the existing tracking pipeline (which the map already consumes)
 * on every accepted reading, but the *realtime telemetry* broadcast is throttled
 * per vehicle: pushing raw high-frequency data to every connected dashboard is
 * the performance trap section 49 warns about.
 */

const gatewayLogger = logger.child({ module: 'device-gateway' });

/** Minimum gap between realtime telemetry broadcasts for one vehicle. */
const BROADCAST_THROTTLE_MS = 5_000;
const lastBroadcastAt = new Map<string, number>();

export interface IngestOutcome {
  accepted: number;
  rejected: number;
  /** Human-readable reasons, returned to the device for its own logs. */
  reasons: string[];
  alertsRaised: number;
}

/** Record a rejection against the device so a misbehaving unit is visible. */
async function recordRejection(
  device: AuthenticatedDevice,
  reason: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await Promise.all([
    prisma.hardwareDevice.update({
      where: { id: device.id },
      data: { rejectedCount: { increment: 1 }, lastSeenAt: new Date() },
    }),
    prisma.deviceEvent.create({
      data: {
        deviceId: device.id,
        organizationId: device.organizationId,
        eventType: DeviceEventType.REJECTED_PAYLOAD,
        description: reason,
        ...(metadata ? { metadata: metadata as never } : {}),
      },
    }),
  ]);
  gatewayLogger.warn(
    { deviceId: device.deviceIdentifier, reason, ...metadata },
    'Telemetry rejected',
  );
}

/**
 * Validate a normalised reading.
 *
 * Returns the problem, or `null` when the reading is usable. Only values the
 * reading *claims* to carry are checked — an absent metric is not a fault.
 */
function validateReading(reading: NormalizedTelemetry, now: Date): string | null {
  const recordedAt = reading.recordedAt.getTime();

  if (!Number.isFinite(recordedAt)) return 'Reading has no usable timestamp.';
  if (recordedAt > now.getTime() + TELEMETRY_MAX_CLOCK_SKEW_MS) {
    return 'Reading is dated in the future — check the device clock.';
  }
  if (recordedAt < now.getTime() - TELEMETRY_MAX_AGE_MS) {
    return 'Reading is older than the maximum accepted age.';
  }

  if (reading.metrics.includes(TelemetryMetric.LOCATION)) {
    const location = reading.location;
    if (!location) return 'Reading claims a location but carries none.';
    if (Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) {
      return 'Location is outside valid coordinate bounds.';
    }
    if (!withinBounds(location.speed, TELEMETRY_BOUNDS.speedKph)) {
      return `Speed of ${location.speed} km/h is not physically plausible.`;
    }
    if (!withinBounds(location.heading, TELEMETRY_BOUNDS.heading)) {
      return 'Heading is outside 0–360 degrees.';
    }
  }

  const vehicle = reading.vehicleData;
  if (!withinBounds(vehicle.rpm, TELEMETRY_BOUNDS.rpm)) return 'RPM is out of range.';
  if (!withinBounds(vehicle.engineLoad, TELEMETRY_BOUNDS.enginePercent)) {
    return 'Engine load is not a percentage.';
  }
  if (!withinBounds(vehicle.fuelLevel, TELEMETRY_BOUNDS.enginePercent)) {
    return 'Fuel level is not a percentage.';
  }
  if (!withinBounds(vehicle.throttlePosition, TELEMETRY_BOUNDS.enginePercent)) {
    return 'Throttle position is not a percentage.';
  }
  if (!withinBounds(vehicle.coolantTemperature, TELEMETRY_BOUNDS.coolantTemperature)) {
    return 'Coolant temperature is out of range.';
  }
  if (!withinBounds(vehicle.batteryVoltage, TELEMETRY_BOUNDS.batteryVoltage)) {
    return 'Battery voltage is out of range.';
  }
  if (!withinBounds(vehicle.odometerKm, TELEMETRY_BOUNDS.odometerKm)) {
    return 'Odometer reading is out of range.';
  }

  for (const axis of [
    reading.motion.accelerationX,
    reading.motion.accelerationY,
    reading.motion.accelerationZ,
  ]) {
    if (!withinBounds(axis, TELEMETRY_BOUNDS.acceleration)) {
      return 'Accelerometer reading is out of range.';
    }
  }

  return null;
}

/**
 * Ingest a device payload.
 *
 * `device` has already been authenticated by the route. Everything else — the
 * shape of `payload`, the plausibility of its values, whether the device is
 * even allowed to report — is decided here.
 */
export async function ingest(
  device: AuthenticatedDevice,
  payload: unknown,
  options: { sequence?: number | null; simulated?: boolean } = {},
): Promise<IngestOutcome> {
  const now = new Date();
  const outcome: IngestOutcome = { accepted: 0, rejected: 0, reasons: [], alertsRaised: 0 };

  // --- Eligibility --------------------------------------------------------
  if (!TELEMETRY_ELIGIBLE_DEVICE_STATUSES.includes(device.status)) {
    await recordRejection(device, `Device is ${device.status} and may not submit telemetry.`);
    throw errors.forbidden(
      `This device is ${device.status.toLowerCase()} and is not accepting telemetry.`,
    );
  }

  if (!device.vehicleId) {
    await recordRejection(device, 'Device is not assigned to a vehicle.');
    throw errors.businessRule(
      'This device is not fitted to a vehicle. Assign it before sending telemetry.',
    );
  }

  // --- Replay protection --------------------------------------------------
  // A sequence number that has already been seen means either a retransmission
  // or a captured payload being replayed. Both are dropped.
  if (
    options.sequence !== null &&
    options.sequence !== undefined &&
    device.lastSequence !== null &&
    options.sequence <= device.lastSequence
  ) {
    await recordRejection(device, 'Sequence number has already been accepted (replay).', {
      sequence: options.sequence,
      lastSequence: device.lastSequence,
    });
    throw errors.conflict('This reading has already been received.');
  }

  // --- Vendor payload → normalised readings -------------------------------
  const adapter = adapterFor(device.provider);
  if (!adapter) {
    await recordRejection(device, `No adapter is registered for ${device.provider}.`);
    throw errors.internal(`Saarthi has no ingestion adapter for ${device.provider}.`);
  }

  let parsed;
  try {
    parsed = adapter.parse(payload, {
      deviceIdentifier: device.deviceIdentifier,
      vehicleId: device.vehicleId,
      receivedAt: now,
    });
  } catch (error) {
    await recordRejection(device, 'Payload could not be parsed by the device adapter.');
    gatewayLogger.error({ err: error, deviceId: device.deviceIdentifier }, 'Adapter threw');
    throw errors.validation('The payload was not in the expected format for this device.');
  }

  for (const warning of parsed.warnings) {
    outcome.reasons.push(warning);
    gatewayLogger.debug({ deviceId: device.deviceIdentifier, warning }, 'Adapter warning');
  }

  if (parsed.readings.length === 0) {
    await recordRejection(device, 'Payload produced no usable readings.');
    throw errors.validation('The payload contained no readings Saarthi could use.');
  }

  // --- Vehicle context ----------------------------------------------------
  // Resolved once per payload rather than per reading: a batch arrives from one
  // vehicle, and the driver on it does not change mid-batch.
  const vehicle = await prisma.truck.findUnique({
    where: { id: device.vehicleId },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      currentDriverId: true,
      currentTripId: true,
      archivedAt: true,
    },
  });
  if (!vehicle || vehicle.archivedAt) {
    await recordRejection(device, 'Assigned vehicle no longer exists.');
    throw errors.notFound('Vehicle');
  }

  // Seeded from the envelope so replay protection arms even when the device
  // carries its counter outside the payload — which is the documented form.
  let highestSequence =
    options.sequence !== null && options.sequence !== undefined
      ? Math.max(device.lastSequence ?? 0, options.sequence)
      : device.lastSequence;
  const observed = new Set(device.observedMetrics);
  let latestAccepted: NormalizedTelemetry | null = null;

  // Oldest first, so a batch collected out of coverage replays in real order
  // and derived state (distance, harsh-event detection) is computed correctly.
  const ordered = [...parsed.readings].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );

  for (const reading of ordered) {
    const problem = validateReading(reading, now);
    if (problem) {
      outcome.rejected += 1;
      outcome.reasons.push(problem);
      await recordRejection(device, problem, { recordedAt: reading.recordedAt.toISOString() });
      continue;
    }

    const stored = await prisma.telemetryReading.create({
      data: {
        deviceId: device.id,
        vehicleId: vehicle.id,
        organizationId: vehicle.organizationId,
        // Denormalised so driver-behaviour queries and score attribution do not
        // need a point-in-time assignment lookup years later.
        driverId: vehicle.currentDriverId,
        tripId: vehicle.currentTripId,
        metrics: reading.metrics,
        latitude: reading.location?.latitude ?? null,
        longitude: reading.location?.longitude ?? null,
        speedKph: reading.location?.speed ?? null,
        heading: reading.location?.heading ?? null,
        altitude: reading.location?.altitude ?? null,
        accuracy: reading.location?.accuracy ?? null,
        satellites: reading.location?.satellites ?? null,
        rpm: reading.vehicleData.rpm,
        engineLoad: reading.vehicleData.engineLoad,
        coolantTemperature: reading.vehicleData.coolantTemperature,
        intakeTemperature: reading.vehicleData.intakeTemperature,
        fuelLevel: reading.vehicleData.fuelLevel,
        fuelRate: reading.vehicleData.fuelRate,
        throttlePosition: reading.vehicleData.throttlePosition,
        batteryVoltage: reading.vehicleData.batteryVoltage,
        odometerKm: reading.vehicleData.odometerKm,
        vin: reading.vehicleData.vin,
        accelerationX: reading.motion.accelerationX,
        accelerationY: reading.motion.accelerationY,
        accelerationZ: reading.motion.accelerationZ,
        harshBraking: reading.motion.harshBraking,
        harshAcceleration: reading.motion.harshAcceleration,
        suddenMovement: reading.motion.suddenMovement,
        deviceTemperature: reading.deviceHealth.temperature,
        signalStrength: reading.deviceHealth.signalStrength,
        simulated: options.simulated ?? false,
        sequence: reading.sequence,
        rawPayload: reading.raw === null ? undefined : (reading.raw as never),
        recordedAt: reading.recordedAt,
        receivedAt: now,
        diagnostics: {
          create: reading.diagnostics.map((code) => ({
            vehicleId: vehicle.id,
            organizationId: vehicle.organizationId,
            code: code.code,
            description: code.description,
            confirmed: code.confirmed,
          })),
        },
      },
    });

    outcome.accepted += 1;
    latestAccepted = reading;
    for (const metric of reading.metrics) observed.add(metric);
    if (reading.sequence !== null && (highestSequence === null || reading.sequence > highestSequence)) {
      highestSequence = reading.sequence;
    }

    // --- Feed the existing tracking pipeline ------------------------------
    // Hardware location goes through exactly the same path as the simulator and
    // the driver app, so trip progress, ETA, deviation alerts and the fleet map
    // need no knowledge that a device exists.
    if (reading.location) {
      try {
        await ingestLocation(
          {
            truckId: vehicle.id,
            latitude: reading.location.latitude,
            longitude: reading.location.longitude,
            speedKph: reading.location.speed ?? 0,
            heading: reading.location.heading ?? 0,
            accuracy: reading.location.accuracy ?? undefined,
            altitude: reading.location.altitude ?? undefined,
            source: TrackingSource.DEVICE,
            timestamp: reading.recordedAt,
          },
          { simulated: options.simulated ?? false },
        );
      } catch (error) {
        // A tracking-side failure must not discard telemetry that is already
        // stored and valid.
        gatewayLogger.error(
          { err: error, vehicleId: vehicle.id },
          'Tracking pipeline rejected a hardware position',
        );
      }
    }

    // --- Rules ------------------------------------------------------------
    const alerts = await evaluateTelemetryRules({
      readingId: stored.id,
      reading,
      vehicle: {
        id: vehicle.id,
        organizationId: vehicle.organizationId,
        registrationNumber: vehicle.registrationNumber,
        driverId: vehicle.currentDriverId,
        tripId: vehicle.currentTripId,
      },
      deviceId: device.id,
    });
    outcome.alertsRaised += alerts;
  }

  // --- Device bookkeeping -------------------------------------------------
  const wasOffline = device.status === DeviceStatus.OFFLINE;
  await prisma.hardwareDevice.update({
    where: { id: device.id },
    data: {
      lastSeenAt: now,
      ...(outcome.accepted > 0 ? { lastTelemetryAt: now } : {}),
      readingCount: { increment: outcome.accepted },
      ...(highestSequence !== null ? { lastSequence: highestSequence } : {}),
      // The observed list is the honest capability record: what this unit has
      // actually managed to read from this vehicle, as opposed to what its
      // datasheet claims.
      observedMetrics: [...observed],
      ...(wasOffline && outcome.accepted > 0 ? { status: DeviceStatus.ACTIVE } : {}),
      ...(latestAccepted?.deviceHealth.firmwareVersion
        ? { firmwareVersion: latestAccepted.deviceHealth.firmwareVersion }
        : {}),
    },
  });

  if (wasOffline && outcome.accepted > 0) {
    await prisma.deviceEvent.create({
      data: {
        deviceId: device.id,
        organizationId: device.organizationId,
        eventType: DeviceEventType.ONLINE,
        description: 'Device resumed reporting.',
      },
    });
    await broadcastDeviceStatus(
      {
        deviceId: device.id,
        serialNumber: device.deviceIdentifier,
        organizationId: device.organizationId,
        vehicleId: vehicle.id,
        status: DeviceStatus.ACTIVE,
        lastSeenAt: now.toISOString(),
        silentForSeconds: null,
        updatedAt: now.toISOString(),
      },
      true,
    );
  }

  // --- Realtime, throttled ------------------------------------------------
  if (latestAccepted) {
    const previous = lastBroadcastAt.get(vehicle.id) ?? 0;
    if (now.getTime() - previous >= BROADCAST_THROTTLE_MS) {
      lastBroadcastAt.set(vehicle.id, now.getTime());
      await broadcastTelemetry({
        deviceId: device.id,
        vehicleId: vehicle.id,
        organizationId: vehicle.organizationId,
        recordedAt: latestAccepted.recordedAt.toISOString(),
        metrics: latestAccepted.metrics,
        latitude: latestAccepted.location?.latitude ?? null,
        longitude: latestAccepted.location?.longitude ?? null,
        speedKph: latestAccepted.location?.speed ?? null,
        heading: latestAccepted.location?.heading ?? null,
        rpm: latestAccepted.vehicleData.rpm,
        coolantTemperature: latestAccepted.vehicleData.coolantTemperature,
        fuelLevel: latestAccepted.vehicleData.fuelLevel,
        batteryVoltage: latestAccepted.vehicleData.batteryVoltage,
        engineLoad: latestAccepted.vehicleData.engineLoad,
        harshBraking: latestAccepted.motion.harshBraking,
        harshAcceleration: latestAccepted.motion.harshAcceleration,
        simulated: options.simulated ?? false,
      });
    }
  }

  return outcome;
}
