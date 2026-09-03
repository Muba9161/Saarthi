import {
  DEFAULT_CHECKLIST_ITEMS,
  DocumentValidity,
  MaintenanceStatus,
  NotificationPriority,
  NotificationType,
  type TerminalChecklistItemKind,
  TerminalChecklistItemStatus,
  TerminalChecklistOutcome,
  evaluateChecklistItem,
  resolveDocumentValidity,
  rollUpChecklist,
  type ChecklistItemDefinition,
  type ChecklistItemEvaluation,
  type ChecklistTelemetryContext,
  type ChecklistVehicleContext,
  type SubmitChecklistInput,
  type TelemetryMetric,
  type UpdateChecklistTemplateInput,
  type VehicleType,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { applyOdometer } from '../vehicles/odometer.service';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { notifyOrganization } from '../notifications/notification.service';
import { latestReadingForVehicle } from '../telemetry/telemetry.service';
import { markChecklistComplete } from './session.service';
import type { SessionRecord } from './session.view';
import type { AuthContext } from '../../auth/context';

/**
 * The mandatory pre-trip check.
 *
 * Two rules run through everything here, and they pull in opposite directions
 * on purpose:
 *
 *  1. **Never claim the vehicle said something it did not.** A verdict is
 *     produced from telemetry only when the metric is genuinely present in the
 *     last reading. A phone has no connection to the engine, and a generic OBD
 *     adapter reads a subset of what a truck's ECU knows — so an item whose
 *     data is missing falls back to a manual inspection, and says so. It never
 *     silently reads OK. Section 18 is explicit, and a false "✓ NORMAL" on a
 *     brake check is the worst thing this product could produce.
 *
 *  2. **Never let the terminal grade itself.** The driver's answers are taken
 *     from the payload; every automated verdict is recomputed here from the
 *     stored reading. A tablet that could post its own coolant verdict could
 *     post a passing one.
 *
 * The template is configurable per fleet (section 17) with the shared ten-point
 * catalogue as the fallback, so the feature works on day one without anybody
 * configuring anything.
 */

const checklistLogger = logger.child({ module: 'terminal-checklist' });

/**
 * Maintenance types that speak to a given checklist item.
 *
 * Explicit rather than inferred from the label, because "brake inspection
 * scheduled" has to reach the BRAKES line whatever a fleet has renamed it to.
 */
const MAINTENANCE_CODE_MAP: Record<string, string[]> = {
  ENGINE_OIL: ['OIL_CHANGE', 'ENGINE', 'PREVENTIVE'],
  BRAKES: ['BRAKE'],
  TYRES: ['TYRE'],
  BATTERY: ['ELECTRICAL'],
  LIGHTS: ['ELECTRICAL'],
};

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export interface ChecklistTemplateView {
  id: string | null;
  name: string;
  vehicleType: VehicleType | null;
  version: number;
  /** True when this is the shared fallback rather than the fleet's own. */
  isDefault: boolean;
  items: ChecklistItemDefinition[];
}

function defaultTemplate(): ChecklistTemplateView {
  return {
    id: null,
    name: 'Pre-trip safety check',
    vehicleType: null,
    version: 1,
    isDefault: true,
    items: [...DEFAULT_CHECKLIST_ITEMS],
  };
}

/**
 * The template a given vehicle should use.
 *
 * Resolution order is narrowest first: a template for this vehicle type, then
 * the fleet's catch-all, then the shared default. A fleet that has configured a
 * bus checklist and nothing else still gets a sensible list for its trucks.
 */
export async function resolveTemplate(
  organizationId: string,
  vehicleType: VehicleType | null,
): Promise<ChecklistTemplateView> {
  const templates = await prisma.terminalChecklistTemplate.findMany({
    where: {
      organizationId,
      active: true,
      OR: [{ vehicleType: null }, ...(vehicleType ? [{ vehicleType }] : [])],
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  const specific = vehicleType
    ? templates.find((template) => template.vehicleType === vehicleType)
    : undefined;
  const general = templates.find((template) => template.vehicleType === null);
  const chosen = specific ?? general;

  if (!chosen || chosen.items.length === 0) return defaultTemplate();

  return {
    id: chosen.id,
    name: chosen.name,
    vehicleType: chosen.vehicleType as VehicleType | null,
    version: chosen.version,
    isDefault: false,
    items: chosen.items.map((item, index) => ({
      code: item.code,
      label: item.label,
      description: item.description ?? '',
      kind: item.kind as TerminalChecklistItemKind,
      ...(item.metric ? { metric: item.metric as TelemetryMetric } : {}),
      blocking: item.blocking,
      required: item.required,
      sortOrder: item.sortOrder || index + 1,
    })),
  };
}

/** Read a fleet's own template, or the default it is currently falling back to. */
export async function getTemplate(
  organizationId: string,
  vehicleType: VehicleType | null,
): Promise<ChecklistTemplateView> {
  return resolveTemplate(organizationId, vehicleType);
}

/**
 * Replace a fleet's checklist.
 *
 * Whole-list replacement rather than per-item edits, because a checklist is
 * read as one thing and a partial update is how a fleet ends up with an item
 * nobody meant to keep. Existing *submissions* are untouched — they store their
 * own item codes and labels, so a year of history stays readable after a
 * rename.
 */
export async function updateTemplate(
  auth: AuthContext,
  organizationId: string,
  input: UpdateChecklistTemplateInput,
): Promise<ChecklistTemplateView> {
  const vehicleType = (input.vehicleType as VehicleType | undefined) ?? null;

  const codes = new Set<string>();
  for (const item of input.items) {
    if (codes.has(item.code)) {
      throw errors.validation(`Two checklist items share the code ${item.code}.`);
    }
    codes.add(item.code);
  }

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.terminalChecklistTemplate.findFirst({
      where: { organizationId, vehicleType },
      select: { id: true, version: true },
    });

    const template = existing
      ? await tx.terminalChecklistTemplate.update({
          where: { id: existing.id },
          data: {
            name: input.name ?? 'Pre-trip safety check',
            active: input.active,
            version: existing.version + 1,
            updatedById: auth.user.id,
          },
        })
      : await tx.terminalChecklistTemplate.create({
          data: {
            organizationId,
            vehicleType,
            name: input.name ?? 'Pre-trip safety check',
            active: input.active,
            updatedById: auth.user.id,
          },
        });

    await tx.terminalChecklistTemplateItem.deleteMany({ where: { templateId: template.id } });
    await tx.terminalChecklistTemplateItem.createMany({
      data: input.items.map((item, index) => ({
        templateId: template.id,
        code: item.code,
        label: item.label,
        description: item.description ?? null,
        kind: item.kind,
        // A metric is meaningless on anything but a TELEMETRY item, and storing
        // one would make the evaluator look for a reading nobody asked for.
        metric: item.kind === 'TELEMETRY' ? (item.metric ?? null) : null,
        blocking: item.blocking,
        required: item.required,
        sortOrder: index + 1,
      })),
    });

    return template;
  });

  checklistLogger.info(
    { organizationId, templateId: saved.id, items: input.items.length },
    'Terminal checklist template updated',
  );

  return resolveTemplate(organizationId, vehicleType);
}

// ---------------------------------------------------------------------------
// Context — what the vehicle can answer for itself
// ---------------------------------------------------------------------------

async function telemetryContext(vehicleId: string): Promise<ChecklistTelemetryContext | null> {
  const reading = await latestReadingForVehicle(vehicleId);
  if (!reading) return null;

  return {
    recordedAt: reading.recordedAt,
    metrics: reading.metrics,
    simulatedMetrics: reading.simulatedMetrics,
    coolantTemperature: reading.coolantTemperature,
    fuelLevel: reading.fuelLevel,
    batteryVoltage: reading.batteryVoltage,
    rpm: reading.rpm,
    engineLoad: reading.engineLoad,
    odometer: reading.odometerKm,
    diagnosticCodes: reading.diagnostics.map((code) => ({
      code: code.code,
      description: code.description,
    })),
  };
}

async function vehicleContext(
  organizationId: string,
  vehicleId: string,
): Promise<ChecklistVehicleContext> {
  const [vehicle, maintenance, documents] = await Promise.all([
    prisma.truck.findUnique({
      where: { id: vehicleId },
      select: { odometerKm: true },
    }),
    prisma.maintenanceRecord.findMany({
      where: {
        truckId: vehicleId,
        OR: [
          { status: { in: [MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS] } },
          { nextDueOdometerKm: { not: null } },
          { nextDueAt: { not: null } },
        ],
      },
      orderBy: [{ nextDueAt: 'asc' }, { scheduledAt: 'asc' }],
      take: 50,
      select: {
        type: true,
        status: true,
        nextDueAt: true,
        nextDueOdometerKm: true,
      },
    }),
    prisma.document.findMany({
      where: { organizationId, ownerType: 'TRUCK', ownerId: vehicleId, deletedAt: null },
      select: { documentType: true, expiryDate: true, verificationStatus: true },
    }),
  ]);

  const odometer = vehicle?.odometerKm ?? null;

  // Kilometres until the nearest upcoming service. Null when nothing scheduled
  // has an odometer target, which is the honest answer rather than a guess.
  let nextServiceInKm: number | null = null;
  let nextServiceDueAt: string | null = null;
  for (const record of maintenance) {
    if (odometer !== null && record.nextDueOdometerKm !== null) {
      const remaining = record.nextDueOdometerKm - odometer;
      if (nextServiceInKm === null || remaining < nextServiceInKm) nextServiceInKm = remaining;
    }
    if (record.nextDueAt && (nextServiceDueAt === null || record.nextDueAt.toISOString() < nextServiceDueAt)) {
      nextServiceDueAt = record.nextDueAt.toISOString();
    }
  }

  const openTypes = new Set(
    maintenance
      .filter(
        (record) =>
          record.status === MaintenanceStatus.SCHEDULED ||
          record.status === MaintenanceStatus.IN_PROGRESS,
      )
      .map((record) => record.type),
  );

  const openMaintenanceCodes = Object.entries(MAINTENANCE_CODE_MAP)
    .filter(([, types]) => types.some((type) => openTypes.has(type as never)))
    .map(([code]) => code);

  const invalidDocuments: string[] = [];
  const expiringDocuments: string[] = [];
  for (const document of documents) {
    const { validity } = resolveDocumentValidity({
      expiryDate: document.expiryDate,
      verificationStatus: document.verificationStatus,
    });
    if (validity === DocumentValidity.EXPIRED || validity === DocumentValidity.REJECTED) {
      invalidDocuments.push(document.documentType);
    } else if (validity === DocumentValidity.EXPIRING_SOON) {
      expiringDocuments.push(document.documentType);
    }
  }

  return {
    nextServiceInKm,
    nextServiceDueAt,
    openMaintenanceCodes,
    invalidDocuments,
    expiringDocuments,
  };
}

// ---------------------------------------------------------------------------
// The intelligent checklist
// ---------------------------------------------------------------------------

export interface ChecklistPreparation {
  template: ChecklistTemplateView;
  items: ChecklistItemEvaluation[];
  telemetry: {
    available: boolean;
    recordedAt: string | null;
    /** Metrics the vehicle genuinely reported in its last frame. */
    metrics: TelemetryMetric[];
    /** Which of those a simulator produced. Always a subset. */
    simulatedMetrics: TelemetryMetric[];
    diagnosticCodes: { code: string; description: string | null }[];
  };
  vehicle: ChecklistVehicleContext;
  /**
   * True when any pre-filled verdict rests on simulated data.
   *
   * Surfaced so the terminal can label those lines. A driver signing off a
   * vehicle deserves to know which figures a machine measured and which one a
   * test harness invented.
   */
  usesSimulatedData: boolean;
}

/** Build the checklist the terminal should present, with the vehicle's own answers. */
export async function prepareChecklist(
  organizationId: string,
  vehicleId: string,
): Promise<ChecklistPreparation> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { vehicleType: true },
  });

  const [template, telemetry, context] = await Promise.all([
    resolveTemplate(organizationId, (vehicle?.vehicleType as VehicleType) ?? null),
    telemetryContext(vehicleId),
    vehicleContext(organizationId, vehicleId),
  ]);

  const items = template.items.map((item) =>
    evaluateChecklistItem(item, telemetry, context),
  );

  return {
    template,
    items,
    telemetry: {
      available: telemetry !== null,
      recordedAt: telemetry?.recordedAt ?? null,
      metrics: telemetry?.metrics ?? [],
      simulatedMetrics: telemetry?.simulatedMetrics ?? [],
      diagnosticCodes: telemetry?.diagnosticCodes ?? [],
    },
    vehicle: context,
    usesSimulatedData: items.some((item) => item.simulated),
  };
}

export interface ChecklistSubmissionResult {
  submissionId: string;
  outcome: TerminalChecklistOutcome;
  items: {
    code: string;
    label: string;
    status: TerminalChecklistItemStatus;
    detail: string | null;
    simulated: boolean;
    blocking: boolean;
  }[];
  /** Set when the check failed. The driver is told exactly what blocks them. */
  blockedBy: string[];
  usedSimulatedData: boolean;
}

/**
 * Record a completed pre-trip check.
 *
 * The merge rule is the important part. For each item:
 *
 *   * an **automated** verdict (telemetry, maintenance, documents) is taken
 *     from the freshly recomputed evaluation, not from the payload;
 *   * a **manual** verdict is taken from the driver, because only they looked;
 *   * an item the driver did not answer and the vehicle cannot answer is
 *     recorded UNAVAILABLE, never OK.
 *
 * A blocking CRITICAL fails the check and the session does not become READY.
 */
export async function submitChecklist(
  session: SessionRecord,
  input: SubmitChecklistInput,
): Promise<ChecklistSubmissionResult> {
  const preparation = await prepareChecklist(session.organizationId, session.vehicleId);
  const answers = new Map(input.items.map((item) => [item.code, item]));

  const results = preparation.items.map((evaluation) => {
    const answer = answers.get(evaluation.code);

    // Automated verdicts win. The terminal cannot overrule the vehicle.
    if (!evaluation.manualInputRequired && evaluation.status) {
      return {
        code: evaluation.code,
        label: evaluation.label,
        kind: evaluation.kind,
        status: evaluation.status,
        observedValue: evaluation.observedValue,
        unit: evaluation.unit,
        metric: evaluation.metric,
        simulated: evaluation.simulated,
        note: answer?.note ?? null,
        detail: evaluation.detail,
        blocking: evaluation.blocking,
        required: evaluation.required,
      };
    }

    // Manual items take the driver's answer. Unanswered is unknown, not a pass.
    return {
      code: evaluation.code,
      label: evaluation.label,
      kind: evaluation.kind,
      status: (answer?.status ??
        TerminalChecklistItemStatus.UNAVAILABLE) as TerminalChecklistItemStatus,
      observedValue: evaluation.observedValue,
      unit: evaluation.unit,
      metric: evaluation.metric,
      simulated: evaluation.simulated,
      note: answer?.note ?? null,
      detail: evaluation.detail,
      blocking: evaluation.blocking,
      required: evaluation.required,
    };
  });

  const outcome = rollUpChecklist(results);
  const usedSimulatedData = results.some((result) => result.simulated);

  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.terminalChecklistSubmission.create({
      data: {
        organizationId: session.organizationId,
        sessionId: session.id,
        vehicleId: session.vehicleId,
        driverId: session.driverId,
        templateId: preparation.template.id,
        outcome,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        odometerKm: input.odometerKm ?? null,
        usedSimulatedData,
        notes: input.notes ?? null,
      },
    });

    await tx.terminalChecklistItemResult.createMany({
      data: results.map((result) => ({
        submissionId: created.id,
        code: result.code,
        label: result.label,
        kind: result.kind,
        status: result.status,
        observedValue: result.observedValue,
        unit: result.unit,
        metric: result.metric,
        simulated: result.simulated,
        note: result.note,
        detail: result.detail,
      })),
    });

    return created;
  });

  // A driver who read the odometer is a better source than the last device
  // frame, so the reading is carried onto the vehicle — through the one function
  // allowed to move it, outside the transaction, and never backwards. A tablet
  // moved to a different truck used to be able to overwrite the new vehicle's
  // mileage with the old one's on the first pre-trip check.
  await applyOdometer({
    vehicleId: session.vehicleId,
    odometerKm: input.odometerKm ?? null,
    reason: 'terminal-checklist',
  });

  const blockedBy = results
    .filter(
      (result) =>
        result.blocking && result.status === TerminalChecklistItemStatus.CRITICAL,
    )
    .map((result) => result.label);

  if (outcome === TerminalChecklistOutcome.FAILED) {
    checklistLogger.warn(
      { sessionId: session.id, vehicleId: session.vehicleId, blockedBy },
      'Pre-trip check failed',
    );
    await notifyOrganization(session.organizationId, {
      type: NotificationType.TERMINAL_CHECKLIST_FAILED,
      title: `Safety check failed on ${session.vehicle.registrationNumber}`,
      body: `Blocked by: ${blockedBy.join(', ')}. The driver cannot start the trip.`,
      priority: NotificationPriority.CRITICAL,
      actionUrl: `/fleet/vehicles/${session.vehicleId}`,
      roles: ['FLEET_OWNER', 'FLEET_MANAGER', 'MOBILITY_PROVIDER'],
    });
  } else {
    // Only a passing check makes the driver READY. This is the one call that
    // opens the cockpit, and it is deliberately unreachable from a route.
    await markChecklistComplete(session.id, outcome);
  }

  return {
    submissionId: submission.id,
    outcome,
    items: results.map((result) => ({
      code: result.code,
      label: result.label,
      status: result.status,
      detail: result.detail,
      simulated: result.simulated,
      blocking: result.blocking,
    })),
    blockedBy,
    usedSimulatedData,
  };
}

/** Recent checks for one vehicle — the fleet's evidence that they happen. */
export async function checklistHistory(
  vehicleId: string,
  limit = 20,
): Promise<
  {
    id: string;
    outcome: TerminalChecklistOutcome;
    submittedAt: string;
    driverName: string | null;
    usedSimulatedData: boolean;
    failures: string[];
  }[]
> {
  const rows = await prisma.terminalChecklistSubmission.findMany({
    where: { vehicleId },
    orderBy: { submittedAt: 'desc' },
    take: limit,
    include: {
      results: {
        where: { status: { in: ['CRITICAL', 'ATTENTION'] } },
        select: { label: true, status: true },
      },
      session: {
        select: { driver: { select: { user: { select: { firstName: true, lastName: true } } } } },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    outcome: row.outcome as TerminalChecklistOutcome,
    submittedAt: row.submittedAt.toISOString(),
    driverName: row.session
      ? `${row.session.driver.user.firstName} ${row.session.driver.user.lastName}`.trim()
      : null,
    usedSimulatedData: row.usedSimulatedData,
    failures: row.results.map((result) => result.label),
  }));
}
