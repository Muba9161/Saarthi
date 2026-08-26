import {
  MaintenanceStatus,
  MediaOwnerType,
  ServiceDataSource,
  ServiceVerificationStatus,
  TruckStatus,
  buildPaginationMeta,
  categoryForType,
  detectServiceConflicts,
  repeatedComponents,
  resolveServiceHealth,
  serviceCostTrend,
  summariseSpend,
  type MaintenanceType,
  type Paginated,
  type ServiceCategory,
  type ServiceHistoryQuery,
  type ServiceRecordInput,
  type SyncServiceHistoryInput,
  type UpdateServiceRecordInput,
  type VerifyServiceRecordInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { assertTenantAccess } from '../../server/guards';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { primaryUrlsFor } from '../media/media.service';
import { serviceHistoryProvider } from '../../providers/service-history';
import type { AuthContext } from '../../auth/context';

/**
 * Service history.
 *
 * The extension of the maintenance module from "what is scheduled" into "what
 * this vehicle has actually had done to it". Three rules run through it:
 *
 *   • **Provenance travels with the record.** Every row knows whether a person
 *     typed it, an invoice was read by AI, or a workshop network supplied it —
 *     and nothing from outside is verified until a human says so.
 *   • **Disagreements surface, they do not resolve themselves.** When an
 *     external record contradicts one already held, both are kept and the
 *     record is flagged CONFLICT rather than overwritten by whoever wrote last.
 *   • **An incomplete history says it is incomplete.** No provider sees every
 *     roadside workshop, and presenting a partial history as a full one is how
 *     a buyer ends up paying for a truck's hidden repair record.
 */

const serviceLogger = logger.child({ module: 'service-history' });

type ServiceRow = Prisma.MaintenanceRecordGetPayload<Record<string, never>>;

const num = (value: Prisma.Decimal | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export interface ServicePartView {
  name: string;
  partNumber: string | null;
  component: string | null;
  quantity: number;
  unitCost: number | null;
  warrantyMonths: number | null;
}

export interface ServiceRecordView {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  type: MaintenanceType;
  category: ServiceCategory | null;
  title: string;
  description: string | null;
  status: MaintenanceStatus;

  serviceDate: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  odometerKm: number | null;
  engineHours: number | null;

  workshopName: string | null;
  workshopAddress: string | null;
  workshopPhone: string | null;
  mechanicName: string | null;

  labourCost: number | null;
  partsCost: number | null;
  taxAmount: number | null;
  totalCost: number | null;

  invoiceNumber: string | null;
  parts: ServicePartView[];
  replacedComponents: string[];
  diagnosticCodes: string[];
  warrantyUntil: string | null;
  warrantyActive: boolean;

  nextServiceDate: string | null;
  nextServiceOdometerKm: number | null;

  source: ServiceDataSource;
  verificationStatus: ServiceVerificationStatus;
  providerName: string | null;
  retrievedAt: string | null;
  conflictNote: string | null;
  /** True while the record still needs a person to confirm it. */
  needsReview: boolean;

  mediaUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function parsePartsJson(value: Prisma.JsonValue | null): ServicePartView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : null;
    if (!name) return [];
    return [
      {
        name,
        partNumber: typeof record.partNumber === 'string' ? record.partNumber : null,
        component: typeof record.component === 'string' ? record.component : null,
        quantity: typeof record.quantity === 'number' ? record.quantity : 1,
        unitCost: typeof record.unitCost === 'number' ? record.unitCost : null,
        warrantyMonths:
          typeof record.warrantyMonths === 'number' ? record.warrantyMonths : null,
      },
    ];
  });
}

function toView(
  row: ServiceRow,
  registrationNumber: string,
  mediaUrl: string | null,
): ServiceRecordView {
  const verificationStatus = row.verificationStatus as ServiceVerificationStatus;

  return {
    id: row.id,
    vehicleId: row.truckId,
    registrationNumber,
    type: row.type as MaintenanceType,
    category: (row.category as ServiceCategory | null) ?? null,
    title: row.title,
    description: row.description,
    status: row.status as MaintenanceStatus,

    // The service date is when the work happened; a scheduled job has none yet.
    serviceDate: (row.completedAt ?? row.startedAt)?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    odometerKm: row.odometerKm,
    engineHours: row.engineHours,

    workshopName: row.workshopName ?? row.serviceProvider,
    workshopAddress: row.workshopAddress,
    workshopPhone: row.workshopPhone,
    mechanicName: row.mechanicName,

    labourCost: num(row.labourCost),
    partsCost: num(row.partsCost),
    taxAmount: num(row.taxAmount),
    totalCost: num(row.cost),

    invoiceNumber: row.invoiceNumber,
    parts: parsePartsJson(row.parts),
    replacedComponents: row.replacedComponents,
    diagnosticCodes: row.diagnosticCodes,
    warrantyUntil: row.warrantyUntil?.toISOString() ?? null,
    warrantyActive:
      row.warrantyUntil !== null && row.warrantyUntil.getTime() > Date.now(),

    nextServiceDate: row.nextDueAt?.toISOString() ?? null,
    nextServiceOdometerKm: row.nextDueOdometerKm,

    source: row.source as ServiceDataSource,
    verificationStatus,
    providerName: row.providerName,
    retrievedAt: row.retrievedAt?.toISOString() ?? null,
    conflictNote: row.conflictNote,
    needsReview:
      verificationStatus === ServiceVerificationStatus.PENDING_REVIEW ||
      verificationStatus === ServiceVerificationStatus.CONFLICT,

    mediaUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function vehicleLabels(vehicleIds: string[]): Promise<Map<string, string>> {
  if (vehicleIds.length === 0) return new Map();
  const vehicles = await prisma.truck.findMany({
    where: { id: { in: [...new Set(vehicleIds)] } },
    select: { id: true, registrationNumber: true },
  });
  return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));
}

async function decorate(rows: ServiceRow[]): Promise<ServiceRecordView[]> {
  const [labels, media] = await Promise.all([
    vehicleLabels(rows.map((row) => row.truckId)),
    primaryUrlsFor(
      MediaOwnerType.MAINTENANCE_RECORD,
      rows.map((row) => row.id),
    ),
  ]);
  return rows.map((row) =>
    toView(row, labels.get(row.truckId) ?? 'Unknown', media.get(row.id) ?? null),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listServiceRecords(
  auth: AuthContext,
  organizationId: string,
  query: ServiceHistoryQuery,
): Promise<Paginated<ServiceRecordView>> {
  const where: Prisma.MaintenanceRecordWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.vehicleId ? { truckId: query.vehicleId } : {}),
    ...(query.category ? { category: { in: query.category as never } } : {}),
    ...(query.type ? { type: { in: query.type as never } } : {}),
    ...(query.source ? { source: { in: query.source as never } } : {}),
    ...(query.verificationStatus
      ? { verificationStatus: { in: query.verificationStatus as never } }
      : {}),
    ...(query.needsReview
      ? {
          verificationStatus: {
            in: [ServiceVerificationStatus.PENDING_REVIEW, ServiceVerificationStatus.CONFLICT],
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { workshopName: { contains: query.search, mode: 'insensitive' } },
            { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.from || query.to
      ? {
          completedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.maintenanceRecord.count({ where }),
    prisma.maintenanceRecord.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: await decorate(rows),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export interface ServiceTimeline {
  vehicleId: string;
  registrationNumber: string;
  records: ServiceRecordView[];
  health: ReturnType<typeof resolveServiceHealth>;
  spend: ReturnType<typeof summariseSpend>;
  costTrend: ReturnType<typeof serviceCostTrend>;
  repeated: ReturnType<typeof repeatedComponents>;
  lastServiceAt: string | null;
  nextDueAt: string | null;
  nextDueOdometerKm: number | null;
  /** What Saarthi cannot see, stated rather than implied. */
  coverageNote: string;
  basis: 'calculated';
}

/**
 * The full history for one vehicle, with the analysis an operator asks for.
 *
 * Returned as one payload rather than five endpoints because every consumer —
 * the passport screen, a resale evidence pack, the AI service tool — needs the
 * same combination, and splitting it would guarantee they drift apart.
 */
export async function vehicleServiceTimeline(
  auth: AuthContext,
  vehicleId: string,
): Promise<ServiceTimeline> {
  const vehicle = await prisma.truck.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const rows = await prisma.maintenanceRecord.findMany({
    where: { truckId: vehicleId },
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });

  const records = await decorate(rows);
  const completed = rows.filter(
    (row) => row.status === MaintenanceStatus.COMPLETED && row.completedAt !== null,
  );

  const lastService = completed[0] ?? null;
  const overdueScheduled = rows.filter(
    (row) =>
      row.status === MaintenanceStatus.SCHEDULED &&
      row.scheduledAt !== null &&
      row.scheduledAt.getTime() < Date.now(),
  ).length;

  const entries = completed.map((row) => ({
    id: row.id,
    serviceDate: row.completedAt!,
    odometerKm: row.odometerKm,
    category: (row.category as ServiceCategory | null) ?? null,
    totalCost: num(row.cost),
    replacedComponents: row.replacedComponents,
    verificationStatus: row.verificationStatus as ServiceVerificationStatus,
  }));

  // Distance covered across the recorded history, for a cost-per-km figure that
  // is honest about the window it covers rather than using lifetime odometer.
  const odometers = completed
    .map((row) => row.odometerKm)
    .filter((value): value is number => value !== null);
  const distanceKm =
    odometers.length >= 2 ? Math.max(...odometers) - Math.min(...odometers) : null;

  // The next upcoming scheduled job, not the newest record's next-due hint.
  const upcoming = rows
    .filter((row) => row.status === MaintenanceStatus.SCHEDULED && row.scheduledAt !== null)
    .sort((a, b) => (a.scheduledAt!.getTime() > b.scheduledAt!.getTime() ? 1 : -1))[0];

  return {
    vehicleId,
    registrationNumber: vehicle.registrationNumber,
    records,
    health: resolveServiceHealth({
      odometerKm: vehicle.odometerKm,
      lastServiceAt: lastService?.completedAt ?? null,
      lastServiceOdometerKm: lastService?.odometerKm ?? null,
      overdueScheduledJobs: overdueScheduled,
    }),
    spend: summariseSpend(
      completed.map((row) => ({
        totalCost: num(row.cost),
        labourCost: num(row.labourCost),
        partsCost: num(row.partsCost),
        verificationStatus: row.verificationStatus as ServiceVerificationStatus,
      })),
      distanceKm,
    ),
    costTrend: serviceCostTrend(entries),
    repeated: repeatedComponents(entries),
    lastServiceAt: lastService?.completedAt?.toISOString() ?? null,
    nextDueAt: upcoming?.scheduledAt?.toISOString() ?? lastService?.nextDueAt?.toISOString() ?? null,
    nextDueOdometerKm: lastService?.nextDueOdometerKm ?? null,
    coverageNote: serviceHistoryProvider.supportsRetrieval
      ? 'Includes records your team entered plus anything retrieved from the connected service network. No network sees every roadside workshop.'
      : 'This history is what you and your team recorded. Saarthi is not connected to an external service network on this environment, so work done elsewhere will not appear unless you add it.',
    basis: 'calculated',
  };
}

export async function getServiceRecord(
  auth: AuthContext,
  recordId: string,
): Promise<ServiceRecordView> {
  const row = await prisma.maintenanceRecord.findUnique({ where: { id: recordId } });
  if (!row) throw errors.notFound('Service record');
  assertTenantAccess(auth, row.organizationId, 'Service record');
  const [view] = await decorate([row]);
  return view!;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Total from the invoice split, when the caller did not give one. */
function resolveTotal(input: {
  totalCost?: number;
  labourCost?: number;
  partsCost?: number;
  taxAmount?: number;
}): number | null {
  if (input.totalCost !== undefined) return input.totalCost;
  const parts = [input.labourCost, input.partsCost, input.taxAmount].filter(
    (value): value is number => value !== undefined,
  );
  if (parts.length === 0) return null;
  return Number(parts.reduce((sum, value) => sum + value, 0).toFixed(2));
}

/**
 * Record a completed service.
 *
 * Distinct from `createMaintenance`, which schedules future work: this files
 * something that already happened, so it lands COMPLETED with a service date
 * and takes the whole invoice.
 */
export async function recordService(
  auth: AuthContext,
  organizationId: string,
  input: ServiceRecordInput,
  options: {
    source?: ServiceDataSource;
    verificationStatus?: ServiceVerificationStatus;
    providerName?: string | null;
  } = {},
): Promise<ServiceRecordView> {
  const vehicle = await prisma.truck.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const serviceDate = input.serviceDate ?? new Date();
  const source = options.source ?? ServiceDataSource.MANUAL;

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.maintenanceRecord.create({
      data: {
        truckId: input.vehicleId,
        organizationId,
        type: input.type,
        category: input.category ?? categoryForType(input.type),
        title: input.title,
        description: input.description ?? null,
        status: MaintenanceStatus.COMPLETED,
        completedAt: serviceDate,
        startedAt: serviceDate,
        odometerKm: input.odometerKm ?? vehicle.odometerKm,
        engineHours: input.engineHours ?? null,

        serviceProvider: input.workshopName ?? null,
        workshopName: input.workshopName ?? null,
        workshopAddress: input.workshopAddress ?? null,
        workshopPhone: input.workshopPhone ?? null,
        mechanicName: input.mechanicName ?? null,

        labourCost: input.labourCost ?? null,
        partsCost: input.partsCost ?? null,
        taxAmount: input.taxAmount ?? null,
        cost: resolveTotal(input),

        invoiceNumber: input.invoiceNumber ?? null,
        parts: (input.parts ?? undefined) as never,
        replacedComponents: input.replacedComponents ?? [],
        diagnosticCodes: input.diagnosticCodes ?? [],
        warrantyUntil: input.warrantyUntil ?? null,

        nextDueAt: input.nextServiceDate ?? null,
        nextDueOdometerKm: input.nextServiceOdometerKm ?? null,

        source,
        // Anything that did not come from a person in this tenant is a draft.
        verificationStatus:
          options.verificationStatus ??
          (source === ServiceDataSource.MANUAL
            ? ServiceVerificationStatus.UNVERIFIED
            : ServiceVerificationStatus.PENDING_REVIEW),
        providerName: options.providerName ?? null,
        retrievedAt: source === ServiceDataSource.PROVIDER_SYNC ? new Date() : null,
        createdById: auth.user.id,
      },
    });

    // A service visit is one of the few reliable odometer readings a fleet
    // gets, so it moves the vehicle's own reading forward — never backward.
    if (input.odometerKm !== undefined && input.odometerKm > vehicle.odometerKm) {
      await tx.truck.update({
        where: { id: vehicle.id },
        data: { odometerKm: input.odometerKm },
      });
    }

    // A vehicle sitting in the workshop is not available for dispatch; one
    // whose service just completed is free again.
    if (vehicle.status === TruckStatus.MAINTENANCE && !vehicle.currentTripId) {
      await tx.truck.update({
        where: { id: vehicle.id },
        data: {
          status: vehicle.currentDriverId ? TruckStatus.ASSIGNED : TruckStatus.AVAILABLE,
        },
      });
    }

    return created;
  });

  await invalidateServiceCache(organizationId, input.vehicleId);

  await recordAudit({
    action: AuditAction.SERVICE_RECORDED,
    entityType: 'MaintenanceRecord',
    entityId: record.id,
    actorUserId: auth.user.id,
    organizationId,
    after: { vehicleId: input.vehicleId, title: input.title, source },
  });

  serviceLogger.info(
    { recordId: record.id, vehicleId: input.vehicleId, source },
    'Service record filed',
  );

  return getServiceRecord(auth, record.id);
}

export async function updateServiceRecord(
  auth: AuthContext,
  recordId: string,
  input: UpdateServiceRecordInput,
): Promise<ServiceRecordView> {
  const existing = await prisma.maintenanceRecord.findUnique({ where: { id: recordId } });
  if (!existing) throw errors.notFound('Service record');
  assertTenantAccess(auth, existing.organizationId, 'Service record');

  const completing =
    input.status === MaintenanceStatus.COMPLETED && existing.status !== MaintenanceStatus.COMPLETED;

  const updated = await prisma.maintenanceRecord.update({
    where: { id: recordId },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
      ...(input.engineHours !== undefined ? { engineHours: input.engineHours } : {}),
      ...(input.workshopName !== undefined
        ? { workshopName: input.workshopName, serviceProvider: input.workshopName }
        : {}),
      ...(input.workshopAddress !== undefined ? { workshopAddress: input.workshopAddress } : {}),
      ...(input.workshopPhone !== undefined ? { workshopPhone: input.workshopPhone } : {}),
      ...(input.mechanicName !== undefined ? { mechanicName: input.mechanicName } : {}),
      ...(input.labourCost !== undefined ? { labourCost: input.labourCost } : {}),
      ...(input.partsCost !== undefined ? { partsCost: input.partsCost } : {}),
      ...(input.taxAmount !== undefined ? { taxAmount: input.taxAmount } : {}),
      ...(input.totalCost !== undefined ? { cost: input.totalCost } : {}),
      ...(input.invoiceNumber !== undefined ? { invoiceNumber: input.invoiceNumber } : {}),
      ...(input.parts !== undefined ? { parts: input.parts as never } : {}),
      ...(input.replacedComponents !== undefined
        ? { replacedComponents: input.replacedComponents }
        : {}),
      ...(input.diagnosticCodes !== undefined ? { diagnosticCodes: input.diagnosticCodes } : {}),
      ...(input.warrantyUntil !== undefined ? { warrantyUntil: input.warrantyUntil } : {}),
      ...(input.nextServiceDate !== undefined ? { nextDueAt: input.nextServiceDate } : {}),
      ...(input.nextServiceOdometerKm !== undefined
        ? { nextDueOdometerKm: input.nextServiceOdometerKm }
        : {}),
      ...(completing
        ? { completedAt: input.completedAt ?? input.serviceDate ?? new Date() }
        : input.completedAt !== undefined
          ? { completedAt: input.completedAt }
          : {}),
      // Editing a record by hand makes it this tenant's own statement again,
      // so a provider-supplied row that someone corrected stops claiming to be
      // what the provider said.
      ...(existing.source !== ServiceDataSource.MANUAL
        ? { conflictNote: existing.conflictNote }
        : {}),
    },
  });

  await invalidateServiceCache(existing.organizationId, existing.truckId);
  return getServiceRecord(auth, updated.id);
}

/**
 * Confirm or reject a record that came from outside the fleet.
 *
 * This is the only path to VERIFIED. Nothing automatic sets it — not an import,
 * not a provider sync, and above all not AI extraction.
 */
export async function verifyServiceRecord(
  auth: AuthContext,
  recordId: string,
  input: VerifyServiceRecordInput,
): Promise<ServiceRecordView> {
  const existing = await prisma.maintenanceRecord.findUnique({ where: { id: recordId } });
  if (!existing) throw errors.notFound('Service record');
  assertTenantAccess(auth, existing.organizationId, 'Service record');

  await prisma.maintenanceRecord.update({
    where: { id: recordId },
    data: {
      verificationStatus: input.verificationStatus,
      ...(input.note !== undefined ? { conflictNote: input.note } : {}),
      ...(input.verificationStatus === ServiceVerificationStatus.VERIFIED
        ? { conflictNote: null }
        : {}),
    },
  });

  await invalidateServiceCache(existing.organizationId, existing.truckId);

  await recordAudit({
    action: AuditAction.SERVICE_VERIFIED,
    entityType: 'MaintenanceRecord',
    entityId: recordId,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    before: { verificationStatus: existing.verificationStatus },
    after: { verificationStatus: input.verificationStatus },
  });

  return getServiceRecord(auth, recordId);
}

// ---------------------------------------------------------------------------
// External retrieval
// ---------------------------------------------------------------------------

export interface ServiceSyncResult {
  provider: string;
  retrievedAt: string;
  simulated: boolean;
  coverageNote: string;
  applied: boolean;
  imported: number;
  duplicates: number;
  conflicts: Array<{ recordId: string; externalId: string; fields: string[] }>;
}

/**
 * Retrieve a vehicle's history from an external network and reconcile it.
 *
 * Reports by default and writes only when asked. A record that matches one
 * already held on date and workshop is treated as the same visit: if the
 * figures agree it is a duplicate, and if they do not it is a conflict that a
 * person resolves — never an overwrite.
 */
export async function syncServiceHistory(
  auth: AuthContext,
  vehicleId: string,
  input: SyncServiceHistoryInput,
): Promise<ServiceSyncResult> {
  const vehicle = await prisma.truck.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  if (!serviceHistoryProvider.supportsRetrieval) {
    throw errors.providerNotConfigured(
      'service-history',
      serviceHistoryProvider.retrievalUnavailableReason,
    );
  }

  const history = await serviceHistoryProvider.fetchHistory({
    registrationNumber: vehicle.registrationNumber,
    vin: null,
    since: input.since ?? null,
  });

  const existing = await prisma.maintenanceRecord.findMany({
    where: { truckId: vehicleId },
    orderBy: { completedAt: 'desc' },
    take: 500,
  });

  let imported = 0;
  let duplicates = 0;
  const conflicts: ServiceSyncResult['conflicts'] = [];

  for (const incoming of history.records) {
    const incomingDate = new Date(incoming.serviceDate);

    // Same visit = same day (± 1) at the same workshop. Matching on the
    // provider id alone would re-import every record the fleet had already
    // typed in by hand, which is the common case.
    const match = existing.find((row) => {
      if (row.providerReference === incoming.externalId) return true;
      if (!row.completedAt) return false;
      const sameDay =
        Math.abs(
          Math.round((row.completedAt.getTime() - incomingDate.getTime()) / 86_400_000),
        ) <= 1;
      const sameWorkshop =
        (row.workshopName ?? row.serviceProvider ?? '').trim().toLowerCase() ===
        (incoming.workshopName ?? '').trim().toLowerCase();
      return sameDay && sameWorkshop;
    });

    if (match) {
      const differing = detectServiceConflicts(
        {
          odometerKm: match.odometerKm,
          totalCost: num(match.cost),
          completedAt: match.completedAt,
          workshopName: match.workshopName ?? match.serviceProvider,
        },
        {
          odometerKm: incoming.odometerKm,
          totalCost: incoming.totalCost,
          completedAt: incomingDate,
          workshopName: incoming.workshopName,
        },
      );

      if (differing.length === 0) {
        duplicates += 1;
        continue;
      }

      conflicts.push({
        recordId: match.id,
        externalId: incoming.externalId,
        fields: differing.map((field) => field.field),
      });

      if (input.apply) {
        await prisma.maintenanceRecord.update({
          where: { id: match.id },
          data: {
            verificationStatus: ServiceVerificationStatus.CONFLICT,
            conflictNote:
              `${history.provider} reports different ` +
              `${differing.map((field) => field.field).join(', ')} for this visit. ` +
              'Both versions have been kept — check the invoice and confirm which is right.',
            providerName: history.provider,
            providerReference: incoming.externalId,
            retrievedAt: new Date(history.retrievedAt),
          },
        });
      }
      continue;
    }

    if (!input.apply) {
      imported += 1;
      continue;
    }

    await prisma.maintenanceRecord.create({
      data: {
        truckId: vehicleId,
        organizationId: vehicle.organizationId,
        type: incoming.type,
        category: incoming.category,
        title: incoming.title,
        description: incoming.description,
        status: MaintenanceStatus.COMPLETED,
        completedAt: incomingDate,
        odometerKm: incoming.odometerKm,
        workshopName: incoming.workshopName,
        serviceProvider: incoming.workshopName,
        workshopAddress: incoming.workshopAddress,
        invoiceNumber: incoming.invoiceNumber,
        labourCost: incoming.labourCost,
        partsCost: incoming.partsCost,
        cost: incoming.totalCost,
        replacedComponents: incoming.replacedComponents,
        diagnosticCodes: incoming.diagnosticCodes,
        warrantyUntil: incoming.warrantyUntil ? new Date(incoming.warrantyUntil) : null,
        // Simulated data is labelled as simulated, all the way into storage.
        source: history.simulated
          ? ServiceDataSource.SIMULATED
          : ServiceDataSource.PROVIDER_SYNC,
        // A network's word is a report, not a verified fact.
        verificationStatus: ServiceVerificationStatus.PROVIDER_REPORTED,
        providerName: history.provider,
        providerReference: incoming.externalId,
        retrievedAt: new Date(history.retrievedAt),
        createdById: auth.user.id,
      },
    });
    imported += 1;
  }

  await invalidateServiceCache(vehicle.organizationId, vehicleId);

  await recordAudit({
    action: AuditAction.SERVICE_SYNCED,
    entityType: 'Truck',
    entityId: vehicleId,
    actorUserId: auth.user.id,
    organizationId: vehicle.organizationId,
    after: {
      provider: history.provider,
      applied: input.apply,
      imported,
      duplicates,
      conflicts: conflicts.length,
    },
  });

  return {
    provider: history.provider,
    retrievedAt: history.retrievedAt,
    simulated: history.simulated,
    coverageNote: history.coverageNote,
    applied: input.apply,
    imported,
    duplicates,
    conflicts,
  };
}

async function invalidateServiceCache(organizationId: string, vehicleId: string): Promise<void> {
  await cache.delete(cacheKeys.vehicleServiceSummary(vehicleId));
  await cache.delete(cacheKeys.fleetSummary(organizationId));
}
