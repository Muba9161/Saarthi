import {
  AlertSeverity,
  NotificationPriority,
  NotificationType,
  TELEMETRY_ALERT_RULES,
  TELEMETRY_SCORE_PENALTIES,
  TelemetryAlertType,
  TelemetryMetric,
  distanceKm,
  telemetryAlertRule,
  type NormalizedTelemetry,
  type TelemetryAlertRuleDefinition,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { notifyOrganization } from '../notifications/notification.service';
import { broadcastTelemetryAlert } from '../../realtime/realtime.service';

/**
 * Telemetry rule engine.
 *
 * Deterministic threshold rules, evaluated per reading. Three principles:
 *
 *  1. **A rule that cannot be evaluated does not fire.** Every rule declares the
 *     metric it needs; if the reading does not carry it, the rule is skipped
 *     rather than treated as satisfied. This is what stops a vehicle that
 *     cannot report coolant temperature from being permanently "cool".
 *  2. **Cooldowns are mandatory.** A truck on a motorway at 85 km/h would
 *     otherwise raise an overspeed alert every second, which is how alerting
 *     systems get muted and then ignored.
 *  3. **Every alert is explainable.** The observed value, the threshold and the
 *     unit are all stored, so a driver disputing a score deduction can be shown
 *     exactly what was measured — the requirement in section 29.
 */

const engineLogger = logger.child({ module: 'telemetry-alerts' });

export interface RuleContext {
  readingId: string;
  reading: NormalizedTelemetry;
  vehicle: {
    id: string;
    organizationId: string;
    registrationNumber: string;
    driverId: string | null;
    tripId: string | null;
  };
  deviceId: string;
}

interface ResolvedRule extends TelemetryAlertRuleDefinition {
  threshold: number | null;
  enabled: boolean;
}

/**
 * Merge the shared defaults with the organization's overrides.
 *
 * A vehicle-specific row beats an organization-wide row, so a refrigerated
 * truck can carry a different temperature limit from the rest of the fleet.
 */
async function resolveRules(
  organizationId: string,
  vehicleId: string,
): Promise<Map<TelemetryAlertType, ResolvedRule>> {
  const overrides = await prisma.telemetryAlertRule.findMany({
    where: { organizationId, OR: [{ vehicleId: null }, { vehicleId }] },
  });

  const fleetWide = new Map<string, (typeof overrides)[number]>();
  const perVehicle = new Map<string, (typeof overrides)[number]>();
  for (const row of overrides) {
    if (row.vehicleId === null) fleetWide.set(row.type, row);
    else perVehicle.set(row.type, row);
  }

  const resolved = new Map<TelemetryAlertType, ResolvedRule>();
  for (const definition of TELEMETRY_ALERT_RULES) {
    const override = perVehicle.get(definition.type) ?? fleetWide.get(definition.type);
    resolved.set(definition.type, {
      ...definition,
      enabled: override?.enabled ?? definition.enabledByDefault,
      threshold: override?.threshold ?? definition.defaultThreshold,
      severity: (override?.severity as AlertSeverity) ?? definition.severity,
      cooldownSeconds: override?.cooldownSeconds ?? definition.cooldownSeconds,
    });
  }
  return resolved;
}

/** Has this rule fired for this vehicle inside its cooldown window? */
async function inCooldown(
  vehicleId: string,
  type: TelemetryAlertType,
  cooldownSeconds: number,
): Promise<boolean> {
  if (cooldownSeconds <= 0) return false;
  const since = new Date(Date.now() - cooldownSeconds * 1000);
  const recent = await prisma.telemetryAlert.findFirst({
    where: { vehicleId, type, occurredAt: { gte: since } },
    select: { id: true },
  });
  return recent !== null;
}

interface Finding {
  type: TelemetryAlertType;
  severity: AlertSeverity;
  message: string;
  observedValue: number | null;
  threshold: number | null;
  unit: string | null;
}

/**
 * Raise an alert, notify, broadcast, and attribute it to the driver's score.
 *
 * The score event stores the alert id, so the driver's score breakdown can link
 * each deduction back to the reading that caused it.
 */
async function raise(context: RuleContext, finding: Finding): Promise<void> {
  const { vehicle, reading } = context;

  const alert = await prisma.telemetryAlert.create({
    data: {
      organizationId: vehicle.organizationId,
      vehicleId: vehicle.id,
      deviceId: context.deviceId,
      driverId: vehicle.driverId,
      tripId: vehicle.tripId,
      readingId: context.readingId,
      type: finding.type,
      severity: finding.severity,
      message: finding.message,
      observedValue: finding.observedValue,
      threshold: finding.threshold,
      unit: finding.unit,
      latitude: reading.location?.latitude ?? null,
      longitude: reading.location?.longitude ?? null,
      occurredAt: reading.recordedAt,
    },
  });

  // Driver scoring. Only behaviour the driver controls is penalised: a failing
  // alternator or an overheating engine is the vehicle's problem, not theirs,
  // so LOW_VOLTAGE and ENGINE_TEMPERATURE carry no score penalty.
  const penalty = TELEMETRY_SCORE_PENALTIES[finding.type];
  if (penalty !== undefined && vehicle.driverId) {
    const scoreEvent = await prisma.driverScoreEvent.create({
      data: {
        driverId: vehicle.driverId,
        eventType:
          finding.type === TelemetryAlertType.OVERSPEED
            ? 'SPEED_VIOLATION'
            : finding.type === TelemetryAlertType.HARSH_BRAKING
              ? 'HARSH_BRAKING'
              : finding.type === TelemetryAlertType.HARSH_ACCELERATION
                ? 'HARSH_ACCELERATION'
                : finding.type === TelemetryAlertType.EXCESSIVE_IDLING
                  ? 'EXCESSIVE_IDLING'
                  : 'ROUTE_DEVIATION',
        category:
          finding.type === TelemetryAlertType.EXCESSIVE_IDLING ? 'VEHICLE_CARE' : 'SAFETY',
        points: penalty,
        // Phrased so the driver can see the measurement, not just the verdict.
        reason: finding.message,
        sourceType: 'TELEMETRY_ALERT',
        sourceId: alert.id,
      },
    });

    await prisma.telemetryAlert.update({
      where: { id: alert.id },
      data: { scoreEventId: scoreEvent.id },
    });

    const { recalculateDriverScore } = await import('../drivers/driver.service');
    await recalculateDriverScore(vehicle.driverId);
  }

  await broadcastTelemetryAlert({
    alertId: alert.id,
    organizationId: vehicle.organizationId,
    vehicleId: vehicle.id,
    vehicleRegistration: vehicle.registrationNumber,
    deviceId: context.deviceId,
    driverId: vehicle.driverId,
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    observedValue: finding.observedValue,
    threshold: finding.threshold,
    unit: finding.unit,
    latitude: reading.location?.latitude ?? null,
    longitude: reading.location?.longitude ?? null,
    occurredAt: reading.recordedAt.toISOString(),
  });

  // Only CRITICAL findings interrupt anyone. A warning belongs in the alert
  // list, not in a notification that competes with an SOS.
  if (finding.severity === AlertSeverity.CRITICAL) {
    void notifyOrganization(vehicle.organizationId, {
      type:
        finding.type === TelemetryAlertType.DIAGNOSTIC_FAULT
          ? NotificationType.DIAGNOSTIC_FAULT
          : NotificationType.TELEMETRY_ALERT,
      title: `${vehicle.registrationNumber}: ${finding.message}`,
      body: 'Open the vehicle to see the reading that triggered this.',
      priority: NotificationPriority.HIGH,
      actionUrl: `/fleet/vehicles/${vehicle.id}/telemetry`,
      roles: ['FLEET_OWNER', 'FLEET_MANAGER', 'DISPATCHER'],
    });
  }

  engineLogger.info(
    { vehicleId: vehicle.id, type: finding.type, observed: finding.observedValue },
    'Telemetry alert raised',
  );
}

/**
 * Evaluate every enabled rule against one reading.
 *
 * Returns how many alerts were raised.
 */
export async function evaluateTelemetryRules(context: RuleContext): Promise<number> {
  const { reading, vehicle } = context;
  const rules = await resolveRules(vehicle.organizationId, vehicle.id);
  const findings: Finding[] = [];

  const has = (metric: TelemetryMetric) => reading.metrics.includes(metric);

  // --- Overspeed ----------------------------------------------------------
  const overspeed = rules.get(TelemetryAlertType.OVERSPEED);
  if (
    overspeed?.enabled &&
    overspeed.threshold !== null &&
    has(TelemetryMetric.SPEED) &&
    reading.location?.speed !== null &&
    reading.location?.speed !== undefined &&
    reading.location.speed > overspeed.threshold
  ) {
    findings.push({
      type: TelemetryAlertType.OVERSPEED,
      severity: overspeed.severity,
      message: `Travelling at ${Math.round(reading.location.speed)} km/h, above the ${overspeed.threshold} km/h limit.`,
      observedValue: Math.round(reading.location.speed),
      threshold: overspeed.threshold,
      unit: 'km/h',
    });
  }

  // --- Harsh braking / acceleration --------------------------------------
  // The adapter has already decided these from the accelerometer, because only
  // it knows the device's axis convention.
  const braking = rules.get(TelemetryAlertType.HARSH_BRAKING);
  if (braking?.enabled && has(TelemetryMetric.ACCELEROMETER) && reading.motion.harshBraking) {
    findings.push({
      type: TelemetryAlertType.HARSH_BRAKING,
      severity: braking.severity,
      message: `Harsh braking detected at ${reading.motion.accelerationX?.toFixed(2) ?? '?'} g.`,
      observedValue: reading.motion.accelerationX,
      threshold: braking.threshold,
      unit: 'g',
    });
  }

  const accelerating = rules.get(TelemetryAlertType.HARSH_ACCELERATION);
  if (
    accelerating?.enabled &&
    has(TelemetryMetric.ACCELEROMETER) &&
    reading.motion.harshAcceleration
  ) {
    findings.push({
      type: TelemetryAlertType.HARSH_ACCELERATION,
      severity: accelerating.severity,
      message: `Harsh acceleration detected at ${reading.motion.accelerationX?.toFixed(2) ?? '?'} g.`,
      observedValue: reading.motion.accelerationX,
      threshold: accelerating.threshold,
      unit: 'g',
    });
  }

  // --- Engine temperature -------------------------------------------------
  const temperature = rules.get(TelemetryAlertType.ENGINE_TEMPERATURE);
  if (
    temperature?.enabled &&
    temperature.threshold !== null &&
    has(TelemetryMetric.COOLANT_TEMPERATURE) &&
    reading.vehicleData.coolantTemperature !== null &&
    reading.vehicleData.coolantTemperature > temperature.threshold
  ) {
    findings.push({
      type: TelemetryAlertType.ENGINE_TEMPERATURE,
      severity: temperature.severity,
      message: `Coolant temperature ${Math.round(reading.vehicleData.coolantTemperature)} °C, above the ${temperature.threshold} °C limit.`,
      observedValue: Math.round(reading.vehicleData.coolantTemperature),
      threshold: temperature.threshold,
      unit: '°C',
    });
  }

  // --- Low voltage --------------------------------------------------------
  const voltage = rules.get(TelemetryAlertType.LOW_VOLTAGE);
  if (
    voltage?.enabled &&
    voltage.threshold !== null &&
    has(TelemetryMetric.BATTERY_VOLTAGE) &&
    reading.vehicleData.batteryVoltage !== null &&
    // Ignore cranking dips: voltage sags hard for a second while starting, and
    // flagging that would alert on every ignition turn.
    reading.vehicleData.batteryVoltage > 6 &&
    reading.vehicleData.batteryVoltage < voltage.threshold
  ) {
    findings.push({
      type: TelemetryAlertType.LOW_VOLTAGE,
      severity: voltage.severity,
      message: `Battery at ${reading.vehicleData.batteryVoltage.toFixed(1)} V, below the ${voltage.threshold} V threshold.`,
      observedValue: reading.vehicleData.batteryVoltage,
      threshold: voltage.threshold,
      unit: 'V',
    });
  }

  // --- Idling -------------------------------------------------------------
  // Engine turning while stationary. Needs both RPM and speed, so a device
  // reporting only GPS cannot produce a false idling alert.
  const idling = rules.get(TelemetryAlertType.EXCESSIVE_IDLING);
  if (
    idling?.enabled &&
    idling.threshold !== null &&
    has(TelemetryMetric.RPM) &&
    has(TelemetryMetric.SPEED) &&
    reading.vehicleData.rpm !== null &&
    reading.vehicleData.rpm > 300 &&
    (reading.location?.speed ?? 0) < 2
  ) {
    const windowStart = new Date(reading.recordedAt.getTime() - idling.threshold * 60_000);
    // Confirm it has been idling for the whole window, not merely at a light.
    const movedInWindow = await prisma.telemetryReading.findFirst({
      where: {
        vehicleId: vehicle.id,
        recordedAt: { gte: windowStart, lt: reading.recordedAt },
        speedKph: { gte: 5 },
      },
      select: { id: true },
    });
    const readingsInWindow = await prisma.telemetryReading.count({
      where: { vehicleId: vehicle.id, recordedAt: { gte: windowStart, lt: reading.recordedAt } },
    });

    if (!movedInWindow && readingsInWindow >= 3) {
      findings.push({
        type: TelemetryAlertType.EXCESSIVE_IDLING,
        severity: idling.severity,
        message: `Engine idling for more than ${idling.threshold} minutes without moving.`,
        observedValue: idling.threshold,
        threshold: idling.threshold,
        unit: 'minutes',
      });
    }
  }

  // --- Fuel drop ----------------------------------------------------------
  const fuelDrop = rules.get(TelemetryAlertType.FUEL_DROP);
  if (
    fuelDrop?.enabled &&
    fuelDrop.threshold !== null &&
    has(TelemetryMetric.FUEL_LEVEL) &&
    reading.vehicleData.fuelLevel !== null
  ) {
    const previous = await prisma.telemetryReading.findFirst({
      where: {
        vehicleId: vehicle.id,
        recordedAt: { lt: reading.recordedAt },
        fuelLevel: { not: null },
      },
      orderBy: { recordedAt: 'desc' },
      select: { fuelLevel: true },
    });
    if (previous?.fuelLevel !== null && previous?.fuelLevel !== undefined) {
      const drop = previous.fuelLevel - reading.vehicleData.fuelLevel;
      if (drop >= fuelDrop.threshold) {
        findings.push({
          type: TelemetryAlertType.FUEL_DROP,
          severity: fuelDrop.severity,
          message: `Fuel level fell ${drop.toFixed(0)}% between readings — check for a leak or siphoning.`,
          observedValue: Number(drop.toFixed(1)),
          threshold: fuelDrop.threshold,
          unit: '%',
        });
      }
    }
  }

  // --- Diagnostic faults --------------------------------------------------
  const diagnostic = rules.get(TelemetryAlertType.DIAGNOSTIC_FAULT);
  if (diagnostic?.enabled && has(TelemetryMetric.DTC) && reading.diagnostics.length > 0) {
    const codes = reading.diagnostics.map((entry) => entry.code).join(', ');
    findings.push({
      type: TelemetryAlertType.DIAGNOSTIC_FAULT,
      severity: diagnostic.severity,
      message: `Vehicle reported fault code(s) ${codes}.`,
      observedValue: reading.diagnostics.length,
      threshold: null,
      unit: null,
    });
  }

  // --- Geofences ----------------------------------------------------------
  const geofence = rules.get(TelemetryAlertType.GEOFENCE_BREACH);
  if (geofence?.enabled && has(TelemetryMetric.LOCATION) && reading.location) {
    const fences = await prisma.geofence.findMany({
      where: {
        organizationId: vehicle.organizationId,
        enabled: true,
        OR: [{ vehicleId: null }, { vehicleId: vehicle.id }],
      },
      take: 50,
    });

    for (const fence of fences) {
      const metres =
        distanceKm(
          { latitude: reading.location.latitude, longitude: reading.location.longitude },
          { latitude: fence.latitude, longitude: fence.longitude },
        ) * 1000;
      const inside = metres <= fence.radiusMeters;
      // An inclusion fence is breached by leaving it; an exclusion fence by
      // entering it.
      const breached = fence.kind === 'INCLUSION' ? !inside : inside;
      if (!breached) continue;

      findings.push({
        type: TelemetryAlertType.GEOFENCE_BREACH,
        severity: geofence.severity,
        message:
          fence.kind === 'INCLUSION'
            ? `Left the permitted area "${fence.name}".`
            : `Entered the restricted area "${fence.name}".`,
        observedValue: Math.round(metres),
        threshold: fence.radiusMeters,
        unit: 'm',
      });
      // One geofence alert per reading is enough; the rest would be noise.
      break;
    }
  }

  // --- Emit ---------------------------------------------------------------
  let raised = 0;
  for (const finding of findings) {
    const rule = rules.get(finding.type) ?? telemetryAlertRule(finding.type);
    const cooldown = rule?.cooldownSeconds ?? 300;
    if (await inCooldown(vehicle.id, finding.type, cooldown)) continue;

    await raise(context, finding);
    raised += 1;
  }
  return raised;
}
