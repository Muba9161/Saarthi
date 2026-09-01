import {
  AlertSeverity,
  MaintenanceStatus,
  MaintenanceType,
  PLAN_LIMITS,
  PlanTier,
  NotificationPriority,
  NotificationType,
  TELEMETRY_ALERT_RULES,
  TELEMETRY_MAINTENANCE_RULES,
  TelemetryAlertStatus,
  TelemetryAlertType,
  TelemetryMetric,
  buildPaginationMeta,
  type Paginated,
  type TelemetryAlertListQuery,
  type TelemetryHistoryQuery,
  type UpdateTelemetryAlertInput,
  type UpsertAlertRuleInput,
  type UpsertGeofenceInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { notifyOrganization } from '../notifications/notification.service';
import { assertTenantAccess, tenantScope } from '../../server/guards';
import type { AuthContext } from '../../auth/context';

/**
 * Telemetry reads, alert management, rule configuration and retention.
 *
 * Every response carries the `metrics` list from the reading that produced it,
 * so the UI can distinguish "not reported by this vehicle" from a genuine zero.
 * That distinction is the single most important thing about this module: a fuel
 * gauge showing 0% because the vehicle has no fuel sender would send a driver
 * looking for a siphon that never happened.
 */

const telemetryLogger = logger.child({ module: 'telemetry' });

export interface TelemetryReadingSummary {
  id: string;
  deviceId: string;
  vehicleId: string;
  recordedAt: string;
  receivedAt: string;
  /** Which values below are genuinely present. */
  metrics: TelemetryMetric[];
  /**
   * Which of those values were invented rather than measured.
   *
   * A phone sends a real position and a simulated RPM in the same reading, so
   * this is a subset of `metrics` rather than a flag on the whole row. A
   * consumer that renders a value without checking this will eventually show an
   * operator a coolant temperature a test app made up, and send a working truck
   * to a workshop.
   */
  simulatedMetrics: TelemetryMetric[];
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  heading: number | null;
  altitude: number | null;
  satellites: number | null;
  rpm: number | null;
  engineLoad: number | null;
  coolantTemperature: number | null;
  intakeTemperature: number | null;
  fuelLevel: number | null;
  fuelRate: number | null;
  throttlePosition: number | null;
  batteryVoltage: number | null;
  odometerKm: number | null;
  accelerationX: number | null;
  accelerationY: number | null;
  accelerationZ: number | null;
  harshBraking: boolean;
  harshAcceleration: boolean;
  suddenMovement: boolean;
  deviceTemperature: number | null;
  signalStrength: number | null;
  diagnostics: { code: string; description: string | null; confirmed: boolean }[];
  simulated: boolean;
}

type ReadingRecord = Prisma.TelemetryReadingGetPayload<{
  include: { diagnostics: true };
}>;

function toReadingSummary(reading: ReadingRecord): TelemetryReadingSummary {
  return {
    id: reading.id,
    deviceId: reading.deviceId,
    vehicleId: reading.vehicleId,
    recordedAt: reading.recordedAt.toISOString(),
    receivedAt: reading.receivedAt.toISOString(),
    metrics: reading.metrics as TelemetryMetric[],
    simulatedMetrics: reading.simulatedMetrics as TelemetryMetric[],
    latitude: reading.latitude,
    longitude: reading.longitude,
    speedKph: reading.speedKph,
    heading: reading.heading,
    altitude: reading.altitude,
    satellites: reading.satellites,
    rpm: reading.rpm,
    engineLoad: reading.engineLoad,
    coolantTemperature: reading.coolantTemperature,
    intakeTemperature: reading.intakeTemperature,
    fuelLevel: reading.fuelLevel,
    fuelRate: reading.fuelRate,
    throttlePosition: reading.throttlePosition,
    batteryVoltage: reading.batteryVoltage,
    odometerKm: reading.odometerKm,
    accelerationX: reading.accelerationX,
    accelerationY: reading.accelerationY,
    accelerationZ: reading.accelerationZ,
    harshBraking: reading.harshBraking,
    harshAcceleration: reading.harshAcceleration,
    suddenMovement: reading.suddenMovement,
    deviceTemperature: reading.deviceTemperature,
    signalStrength: reading.signalStrength,
    diagnostics: reading.diagnostics.map((code) => ({
      code: code.code,
      description: code.description,
      confirmed: code.confirmed,
    })),
    simulated: reading.simulated,
  };
}

/** Authorise a vehicle read: fleet member, its driver, or platform staff. */
async function assertVehicleAccess(auth: AuthContext, vehicleId: string): Promise<void> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { organizationId: true, currentDriverId: true },
  });
  if (!vehicle) throw errors.notFound('Vehicle');

  if (auth.isPlatformAdmin) return;
  if (auth.organizationId === vehicle.organizationId) return;
  // A driver may see the telemetry of the vehicle they are driving — it is how
  // they understand their own score.
  if (auth.driverId && vehicle.currentDriverId === auth.driverId) return;

  throw errors.notFound('Vehicle');
}

/**
 * Latest reading for a vehicle — the live panel.
 *
 * Returns `null` rather than an empty shell when nothing has been reported, so
 * the UI shows "no data yet" instead of a dashboard of zeros.
 */
export async function latestReading(
  auth: AuthContext,
  vehicleId: string,
): Promise<TelemetryReadingSummary | null> {
  await assertVehicleAccess(auth, vehicleId);

  const reading = await prisma.telemetryReading.findFirst({
    where: { vehicleId },
    include: { diagnostics: true },
    orderBy: { recordedAt: 'desc' },
  });
  return reading ? toReadingSummary(reading) : null;
}

/**
 * Telemetry history.
 *
 * The retention window comes from the plan, and a request for more is silently
 * clamped rather than refused — the caller still gets the data they are
 * entitled to, and `windowStart` in the response says where the cut fell.
 */
export async function telemetryHistory(
  auth: AuthContext,
  query: TelemetryHistoryQuery,
): Promise<Paginated<TelemetryReadingSummary> & { windowStart: string }> {
  if (!query.vehicleId && !query.deviceId) {
    throw errors.validation('Specify a vehicle or a device to read telemetry for.');
  }
  if (query.vehicleId) await assertVehicleAccess(auth, query.vehicleId);

  const retentionDays = auth.subscription?.limits.telemetryRetentionDays ?? 0;
  const earliest = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000);
  const from = query.from && query.from > earliest ? query.from : earliest;

  const where: Prisma.TelemetryReadingWhereInput = {
    ...tenantScope(auth),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.deviceId ? { deviceId: query.deviceId } : {}),
    recordedAt: { gte: from, ...(query.to ? { lte: query.to } : {}) },
  };

  const [total, readings] = await Promise.all([
    prisma.telemetryReading.count({ where }),
    prisma.telemetryReading.findMany({
      where,
      include: { diagnostics: true },
      orderBy: { recordedAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  let items = readings.map(toReadingSummary);

  // Downsampling for charts: keep one reading per interval so a day of
  // one-second data can be plotted without shipping 86,400 points.
  if (query.intervalSeconds && query.intervalSeconds > 0) {
    const bucketMs = query.intervalSeconds * 1000;
    const seen = new Set<number>();
    items = items.filter((item) => {
      const bucket = Math.floor(new Date(item.recordedAt).getTime() / bucketMs);
      if (seen.has(bucket)) return false;
      seen.add(bucket);
      return true;
    });
  }

  return {
    items,
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
    windowStart: from.toISOString(),
  };
}

/**
 * What this vehicle can actually tell us.
 *
 * The union of metrics observed across recent readings. This is the honest
 * capability answer the dashboard uses to decide which gauges to render at all
 * — section 22 of the spec: unavailable values must not be presented as data.
 */
export async function vehicleCapabilities(
  auth: AuthContext,
  vehicleId: string,
): Promise<{
  hasDevice: boolean;
  deviceStatus: string | null;
  observedMetrics: TelemetryMetric[];
  supportedMetrics: TelemetryMetric[];
  lastReadingAt: string | null;
  readingCount: number;
}> {
  await assertVehicleAccess(auth, vehicleId);

  const assignment = await prisma.deviceAssignment.findFirst({
    where: { vehicleId, status: 'ACTIVE' },
    include: {
      device: {
        select: {
          status: true,
          observedMetrics: true,
          supportedMetrics: true,
          lastTelemetryAt: true,
          readingCount: true,
        },
      },
    },
  });

  if (!assignment) {
    return {
      hasDevice: false,
      deviceStatus: null,
      observedMetrics: [],
      supportedMetrics: [],
      lastReadingAt: null,
      readingCount: 0,
    };
  }

  return {
    hasDevice: true,
    deviceStatus: assignment.device.status,
    observedMetrics: assignment.device.observedMetrics as TelemetryMetric[],
    supportedMetrics: assignment.device.supportedMetrics as TelemetryMetric[],
    lastReadingAt: assignment.device.lastTelemetryAt?.toISOString() ?? null,
    readingCount: assignment.device.readingCount,
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export interface TelemetryAlertSummary {
  id: string;
  organizationId: string;
  vehicleId: string;
  vehicleRegistration: string;
  deviceId: string | null;
  driverId: string | null;
  driverName: string | null;
  type: TelemetryAlertType;
  severity: AlertSeverity;
  status: TelemetryAlertStatus;
  message: string;
  observedValue: number | null;
  threshold: number | null;
  unit: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Set when this alert deducted driver-score points. */
  scoreEventId: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  note: string | null;
  occurredAt: string;
}

export async function listAlerts(
  auth: AuthContext,
  query: TelemetryAlertListQuery,
): Promise<Paginated<TelemetryAlertSummary>> {
  const where: Prisma.TelemetryAlertWhereInput = {
    ...tenantScope(auth),
    // A driver sees only their own events, never the whole fleet's.
    ...(auth.driverId && !auth.organizationId ? { driverId: auth.driverId } : {}),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.deviceId ? { deviceId: query.deviceId } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.type ? { type: { in: query.type as TelemetryAlertType[] } } : {}),
    ...(query.severity ? { severity: { in: query.severity as AlertSeverity[] } } : {}),
    ...(query.status ? { status: { in: query.status as TelemetryAlertStatus[] } } : {}),
    ...(query.openOnly ? { status: TelemetryAlertStatus.OPEN } : {}),
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, alerts] = await Promise.all([
    prisma.telemetryAlert.count({ where }),
    prisma.telemetryAlert.findMany({
      where,
      include: { vehicle: { select: { registrationNumber: true } } },
      // Critical first, then most recent — a critical alert must never sit
      // below a newer informational one.
      orderBy: [{ severity: 'desc' }, { occurredAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const driverIds = [...new Set(alerts.map((a) => a.driverId).filter((id): id is string => !!id))];
  const drivers = await prisma.driver.findMany({
    where: { id: { in: driverIds } },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  const driverNames = new Map(
    drivers.map((d) => [d.id, `${d.user.firstName} ${d.user.lastName}`.trim()]),
  );

  return {
    items: alerts.map((alert) => ({
      id: alert.id,
      organizationId: alert.organizationId,
      vehicleId: alert.vehicleId,
      vehicleRegistration: alert.vehicle.registrationNumber,
      deviceId: alert.deviceId,
      driverId: alert.driverId,
      driverName: alert.driverId ? (driverNames.get(alert.driverId) ?? null) : null,
      type: alert.type as TelemetryAlertType,
      severity: alert.severity as AlertSeverity,
      status: alert.status as TelemetryAlertStatus,
      message: alert.message,
      observedValue: alert.observedValue,
      threshold: alert.threshold,
      unit: alert.unit,
      latitude: alert.latitude,
      longitude: alert.longitude,
      scoreEventId: alert.scoreEventId,
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
      note: alert.note,
      occurredAt: alert.occurredAt.toISOString(),
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function updateAlert(
  auth: AuthContext,
  alertId: string,
  input: UpdateTelemetryAlertInput,
): Promise<TelemetryAlertSummary> {
  const alert = await prisma.telemetryAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw errors.notFound('Alert');
  assertTenantAccess(auth, alert.organizationId, 'Alert');

  const now = new Date();
  await prisma.telemetryAlert.update({
    where: { id: alertId },
    data: {
      status: input.status,
      note: input.note ?? alert.note,
      ...(input.status === TelemetryAlertStatus.ACKNOWLEDGED
        ? { acknowledgedAt: now, acknowledgedById: auth.user.id }
        : {}),
      ...(input.status === TelemetryAlertStatus.RESOLVED ||
      input.status === TelemetryAlertStatus.DISMISSED
        ? { resolvedAt: now, resolvedById: auth.user.id }
        : {}),
    },
  });

  const result = await listAlerts(auth, {
    page: 1,
    pageSize: 1,
    vehicleId: alert.vehicleId,
  } as TelemetryAlertListQuery);
  const updated = result.items.find((item) => item.id === alertId);
  if (!updated) throw errors.notFound('Alert');
  return updated;
}

// ---------------------------------------------------------------------------
// Rules & geofences
// ---------------------------------------------------------------------------

/** The rule catalogue, merged with this organization's overrides. */
export async function listRules(auth: AuthContext): Promise<
  {
    type: TelemetryAlertType;
    label: string;
    description: string;
    enabled: boolean;
    severity: AlertSeverity;
    threshold: number | null;
    thresholdUnit: string | null;
    cooldownSeconds: number;
    requiresMetric: TelemetryMetric | null;
    /** True when the value differs from the Saarthi default. */
    customised: boolean;
    vehicleId: string | null;
  }[]
> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();

  const overrides = await prisma.telemetryAlertRule.findMany({ where: { organizationId } });
  const byType = new Map(overrides.filter((r) => r.vehicleId === null).map((r) => [r.type, r]));

  return TELEMETRY_ALERT_RULES.map((definition) => {
    const override = byType.get(definition.type);
    return {
      type: definition.type,
      label: definition.label,
      description: definition.description,
      enabled: override?.enabled ?? definition.enabledByDefault,
      severity: (override?.severity as AlertSeverity) ?? definition.severity,
      threshold: override?.threshold ?? definition.defaultThreshold,
      thresholdUnit: definition.thresholdUnit,
      cooldownSeconds: override?.cooldownSeconds ?? definition.cooldownSeconds,
      requiresMetric: definition.requiresMetric,
      customised: override !== undefined,
      vehicleId: override?.vehicleId ?? null,
    };
  });
}

export async function upsertRule(
  auth: AuthContext,
  input: UpsertAlertRuleInput,
): Promise<{ type: TelemetryAlertType; enabled: boolean; threshold: number | null }> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();

  if (input.vehicleId) await assertVehicleAccess(auth, input.vehicleId);

  // PostgreSQL treats NULLs as distinct, so the compound unique index cannot
  // constrain fleet-wide rows (vehicleId = null) — and Prisma will not accept a
  // null inside a compound-unique lookup for the same reason. Find-then-write,
  // so a fleet-wide rule is updated rather than duplicated.
  const existing = await prisma.telemetryAlertRule.findFirst({
    where: { organizationId, vehicleId: input.vehicleId ?? null, type: input.type },
  });

  const data = {
    enabled: input.enabled,
    threshold: input.threshold ?? null,
    severity: input.severity ?? null,
    cooldownSeconds: input.cooldownSeconds ?? null,
    updatedById: auth.user.id,
  };

  const rule = existing
    ? await prisma.telemetryAlertRule.update({ where: { id: existing.id }, data })
    : await prisma.telemetryAlertRule.create({
        data: {
          organizationId,
          vehicleId: input.vehicleId ?? null,
          type: input.type,
          ...data,
        },
      });

  return { type: rule.type as TelemetryAlertType, enabled: rule.enabled, threshold: rule.threshold };
}

export async function listGeofences(auth: AuthContext) {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();

  const fences = await prisma.geofence.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return fences.map((fence) => ({
    id: fence.id,
    name: fence.name,
    kind: fence.kind,
    latitude: fence.latitude,
    longitude: fence.longitude,
    radiusMeters: fence.radiusMeters,
    enabled: fence.enabled,
    vehicleId: fence.vehicleId,
    notes: fence.notes,
    createdAt: fence.createdAt.toISOString(),
  }));
}

export async function createGeofence(auth: AuthContext, input: UpsertGeofenceInput) {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();
  if (input.vehicleId) await assertVehicleAccess(auth, input.vehicleId);

  const fence = await prisma.geofence.create({
    data: {
      organizationId,
      vehicleId: input.vehicleId ?? null,
      name: input.name,
      kind: input.kind,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      enabled: input.enabled,
      notes: input.notes ?? null,
      createdById: auth.user.id,
    },
  });
  return { id: fence.id, name: fence.name };
}

export async function deleteGeofence(auth: AuthContext, geofenceId: string): Promise<void> {
  const fence = await prisma.geofence.findUnique({ where: { id: geofenceId } });
  if (!fence) throw errors.notFound('Geofence');
  assertTenantAccess(auth, fence.organizationId, 'Geofence');
  await prisma.geofence.delete({ where: { id: geofenceId } });
}

// ---------------------------------------------------------------------------
// Maintenance recommendations
// ---------------------------------------------------------------------------

export interface MaintenanceRecommendation {
  code: string;
  vehicleId: string;
  vehicleRegistration: string;
  label: string;
  /** Why this is being suggested, in plain language. */
  reason: string;
  recommendation: string;
  /** How many times the triggering alert fired inside the window. */
  occurrences: number;
  windowDays: number;
  severity: AlertSeverity;
}

/**
 * Deterministic telemetry-driven maintenance recommendations.
 *
 * Explicitly **not** predictive maintenance. Each of these is a threshold rule a
 * mechanic could state in one sentence, evaluated over recent alerts. Real
 * prediction needs a fleet-history baseline Saarthi does not have yet, and
 * claiming it before then — as section 30 warns — would be dishonest.
 */
export async function maintenanceRecommendations(
  auth: AuthContext,
  vehicleId?: string,
): Promise<MaintenanceRecommendation[]> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();
  if (vehicleId) await assertVehicleAccess(auth, vehicleId);

  const recommendations: MaintenanceRecommendation[] = [];

  for (const rule of TELEMETRY_MAINTENANCE_RULES) {
    const since = new Date(Date.now() - rule.windowDays * 86_400_000);

    const grouped = await prisma.telemetryAlert.groupBy({
      by: ['vehicleId'],
      where: {
        organizationId,
        ...(vehicleId ? { vehicleId } : {}),
        type: rule.triggerAlert,
        occurredAt: { gte: since },
      },
      _count: { _all: true },
      having: { vehicleId: { _count: { gte: rule.occurrences } } },
    });

    if (grouped.length === 0) continue;

    const vehicles = await prisma.truck.findMany({
      where: { id: { in: grouped.map((row) => row.vehicleId) } },
      select: { id: true, registrationNumber: true },
    });
    const names = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));

    for (const row of grouped) {
      recommendations.push({
        code: rule.code,
        vehicleId: row.vehicleId,
        vehicleRegistration: names.get(row.vehicleId) ?? 'Unknown',
        label: rule.label,
        reason: rule.reason,
        recommendation: rule.recommendation,
        occurrences: row._count._all,
        windowDays: rule.windowDays,
        severity:
          rule.triggerAlert === TelemetryAlertType.DIAGNOSTIC_FAULT ||
          rule.triggerAlert === TelemetryAlertType.ENGINE_TEMPERATURE
            ? AlertSeverity.CRITICAL
            : AlertSeverity.WARNING,
      });
    }
  }

  return recommendations;
}

/**
 * Turn a recommendation into a scheduled maintenance record.
 *
 * The owner accepts it explicitly — Saarthi suggests work, it does not book a
 * garage visit on someone's behalf.
 */
export async function acceptRecommendation(
  auth: AuthContext,
  vehicleId: string,
  code: string,
): Promise<{ maintenanceId: string }> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired();
  await assertVehicleAccess(auth, vehicleId);

  const rule = TELEMETRY_MAINTENANCE_RULES.find((entry) => entry.code === code);
  if (!rule) throw errors.notFound('Recommendation');

  const typeByCode: Record<string, MaintenanceType> = {
    COOLING_SYSTEM_CHECK: MaintenanceType.ENGINE,
    CHARGING_SYSTEM_CHECK: MaintenanceType.ELECTRICAL,
    BRAKE_INSPECTION: MaintenanceType.BRAKE,
    DIAGNOSTIC_FOLLOW_UP: MaintenanceType.INSPECTION,
  };

  const record = await prisma.maintenanceRecord.create({
    data: {
      truckId: vehicleId,
      organizationId,
      type: typeByCode[code] ?? MaintenanceType.INSPECTION,
      title: rule.label,
      description: `${rule.reason} ${rule.recommendation}`,
      status: MaintenanceStatus.SCHEDULED,
      createdById: auth.user.id,
    },
  });

  telemetryLogger.info({ vehicleId, code }, 'Telemetry maintenance recommendation accepted');
  return { maintenanceId: record.id };
}

/**
 * Notify owners about new recommendations.
 *
 * Called from the retention sweep so recommendations surface without anyone
 * having to open the telemetry screen.
 */
export async function notifyMaintenanceRecommendations(organizationId: string): Promise<number> {
  const auth = {
    organizationId,
    isPlatformAdmin: false,
    driverId: null,
  } as unknown as AuthContext;

  const recommendations = await maintenanceRecommendations(auth).catch(() => []);
  const critical = recommendations.filter((entry) => entry.severity === AlertSeverity.CRITICAL);
  if (critical.length === 0) return 0;

  await notifyOrganization(organizationId, {
    type: NotificationType.MAINTENANCE_DUE,
    title: `${critical.length} vehicle(s) need attention`,
    body: critical
      .slice(0, 3)
      .map((entry) => `${entry.vehicleRegistration}: ${entry.label}`)
      .join('; '),
    priority: NotificationPriority.HIGH,
    actionUrl: '/telemetry/maintenance',
    roles: ['FLEET_OWNER', 'FLEET_MANAGER'],
  });

  return critical.length;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Delete telemetry past each organization's retention window.
 *
 * Telemetry is the highest-volume table in the system — a 50-vehicle fleet
 * reporting every five seconds writes about 26 million rows a year — so
 * retention is not optional housekeeping. Deletes are batched to avoid holding
 * a long transaction against a table the gateway is still writing to.
 */
export async function runTelemetryRetentionSweep(): Promise<number> {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    select: { organizationId: true, plan: { select: { tier: true } } },
  });

  let deleted = 0;

  for (const subscription of subscriptions) {
    const days = PLAN_LIMITS[subscription.plan.tier as PlanTier]?.telemetryRetentionDays ?? 90;
    // A plan without telemetry has nothing to retain, so nothing to sweep.
    if (days <= 0) continue;

    const cutoff = new Date(Date.now() - days * 86_400_000);

    // Batched, because a single deleteMany over millions of rows would hold
    // locks on a table the gateway is actively inserting into.
    for (let batch = 0; batch < 20; batch += 1) {
      const stale = await prisma.telemetryReading.findMany({
        where: { organizationId: subscription.organizationId, recordedAt: { lt: cutoff } },
        select: { id: true },
        take: 1000,
      });
      if (stale.length === 0) break;

      const { count } = await prisma.telemetryReading.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
      deleted += count;
      if (stale.length < 1000) break;
    }

    await notifyMaintenanceRecommendations(subscription.organizationId).catch(() => 0);
  }

  if (deleted > 0) {
    telemetryLogger.info({ deleted }, 'Telemetry retention sweep complete');
  }
  return deleted;
}
