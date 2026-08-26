import { z } from 'zod';
import {
  DocumentValidity,
  Feature,
  Permission,
  resolveDocumentValidity,
  documentTypeDefinition,
} from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { readLiveState } from '../../tracking/live-state.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Vehicle-level tools.
 *
 * Every one of these takes a vehicle id and every one re-checks the tenant
 * before answering. The model is perfectly capable of passing an id it saw in
 * an earlier answer, or one it invented — neither is trusted here.
 */

const vehicleArgs = z.object({
  vehicleId: z.string().uuid().describe('The vehicle to look up, as a Saarthi id.'),
});

function result<T>(
  data: T,
  options: {
    basis?: ResultBasis;
    references?: ToolResult['references'];
    caveats?: string[];
    recordCount?: number;
  } = {},
): ToolResult<T> {
  return {
    data,
    basis: options.basis ?? ResultBasis.SOURCE_DATA,
    references: options.references ?? [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 1,
  };
}

/**
 * Load a vehicle inside the caller's tenant, or refuse.
 *
 * Throwing rather than returning null on purpose: the registry converts it into
 * a message the model relays, and "that vehicle is not in your fleet" is a
 * better answer than an empty object the model will try to describe.
 */
async function loadVehicle(organizationId: string, vehicleId: string) {
  const vehicle = await prisma.truck.findFirst({
    where: { id: vehicleId, organizationId },
  });
  if (!vehicle) {
    throw new Error('No vehicle with that id in your fleet.');
  }
  return vehicle;
}

export const VEHICLE_TOOLS: AiTool[] = [
  {
    name: 'find_vehicle',
    description:
      'Find a vehicle by registration number, or list the fleet when no number is given. Use this first to turn a registration number into a vehicle id.',
    input: z.object({
      registrationNumber: z
        .string()
        .max(20)
        .optional()
        .describe('Full or partial registration number, e.g. "UP32" or "UP32AB1234".'),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    permissions: [Permission.TRUCKS_READ],
    category: 'vehicle',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }, input) => {
      const { registrationNumber, limit } = input as {
        registrationNumber?: string;
        limit: number;
      };

      const vehicles = await prisma.truck.findMany({
        where: {
          organizationId,
          archivedAt: null,
          ...(registrationNumber
            ? { registrationNumber: { contains: registrationNumber, mode: 'insensitive' } }
            : {}),
        },
        take: limit,
        select: {
          id: true,
          registrationNumber: true,
          vehicleType: true,
          manufacturer: true,
          model: true,
          status: true,
        },
      });

      return result(vehicles, {
        basis: ResultBasis.SOURCE_DATA,
        recordCount: vehicles.length,
        references: vehicles.map((vehicle) => ({
          type: 'vehicle',
          id: vehicle.id,
          label: vehicle.registrationNumber,
        })),
        caveats:
          vehicles.length === limit
            ? [`Only the first ${limit} matches are listed; there may be more.`]
            : [],
      });
    },
  },

  {
    name: 'get_vehicle_summary',
    description:
      'Identity and current state of one vehicle: type, make, odometer, status, assigned driver and current trip.',
    input: vehicleArgs,
    permissions: [Permission.TRUCKS_READ],
    category: 'vehicle',
    cacheTtlSeconds: 20,
    handler: async ({ organizationId }, input) => {
      const { vehicleId } = input as { vehicleId: string };
      const vehicle = await loadVehicle(organizationId, vehicleId);

      const [driver, trip] = await Promise.all([
        vehicle.currentDriverId
          ? prisma.driver.findUnique({
              where: { id: vehicle.currentDriverId },
              include: { user: { select: { firstName: true, lastName: true } } },
            })
          : null,
        vehicle.currentTripId
          ? prisma.trip.findUnique({
              where: { id: vehicle.currentTripId },
              select: { reference: true, status: true, etaAt: true },
            })
          : null,
      ]);

      return result(
        {
          vehicleId: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
          manufacturer: vehicle.manufacturer,
          model: vehicle.model,
          year: vehicle.year,
          capacityTons: vehicle.capacityTons,
          fuelType: vehicle.fuelType,
          odometerKm: Math.round(vehicle.odometerKm),
          status: vehicle.status,
          verificationStatus: vehicle.verificationStatus,
          driver: driver
            ? {
                driverId: driver.id,
                name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
              }
            : null,
          trip: trip
            ? { reference: trip.reference, status: trip.status, etaAt: trip.etaAt?.toISOString() ?? null }
            : null,
        },
        {
          references: [
            { type: 'vehicle', id: vehicle.id, label: vehicle.registrationNumber },
          ],
        },
      );
    },
  },

  {
    name: 'get_vehicle_documents',
    description:
      'Document compliance for one vehicle: insurance, fitness, permit, PUCC and their expiry status. Returns validity, never the files.',
    input: vehicleArgs,
    permissions: [Permission.DOCUMENTS_READ],
    category: 'vehicle',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { vehicleId } = input as { vehicleId: string };
      const vehicle = await loadVehicle(organizationId, vehicleId);

      const documents = await prisma.document.findMany({
        where: { ownerType: 'TRUCK', ownerId: vehicleId, deletedAt: null },
        select: {
          id: true,
          documentType: true,
          expiryDate: true,
          verificationStatus: true,
        },
      });

      const evaluated = documents.map((document) => {
        const { validity, daysRemaining } = resolveDocumentValidity({
          expiryDate: document.expiryDate,
          verificationStatus: document.verificationStatus,
        });
        return {
          documentId: document.id,
          type: document.documentType,
          label: documentTypeDefinition(document.documentType)?.label ?? document.documentType,
          validity,
          expiresAt: document.expiryDate?.toISOString().slice(0, 10) ?? null,
          daysRemaining,
        };
      });

      return result(
        {
          registrationNumber: vehicle.registrationNumber,
          documents: evaluated,
          expired: evaluated.filter((entry) => entry.validity === DocumentValidity.EXPIRED).length,
          expiringSoon: evaluated.filter(
            (entry) => entry.validity === DocumentValidity.EXPIRING_SOON,
          ).length,
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: evaluated.length,
          caveats:
            evaluated.length === 0
              ? ['No documents are on file for this vehicle. That is not the same as none existing.']
              : [],
        },
      );
    },
  },

  {
    name: 'get_vehicle_location',
    description:
      'Where a vehicle was last seen, how fast it was moving, and how recent that reading is.',
    input: vehicleArgs,
    permissions: [Permission.TRACKING_READ],
    feature: Feature.TRACKING_LIVE,
    category: 'vehicle',
    // Never cached: a stale position is worse than no position when someone is
    // asking where a truck is right now.
    cacheTtlSeconds: 0,
    handler: async ({ organizationId }, input) => {
      const { vehicleId } = input as { vehicleId: string };
      const vehicle = await loadVehicle(organizationId, vehicleId);
      const live = await readLiveState(vehicleId);

      const latitude = live?.lat ?? vehicle.lastLatitude;
      const longitude = live?.lng ?? vehicle.lastLongitude;
      const at = live?.timestamp ?? vehicle.lastLocationAt?.toISOString() ?? null;

      if (latitude === null || longitude === null || at === null) {
        return result(
          { registrationNumber: vehicle.registrationNumber, known: false },
          {
            recordCount: 0,
            caveats: ['This vehicle has never reported a position to Saarthi.'],
          },
        );
      }

      const ageMinutes = Math.round((Date.now() - new Date(at).getTime()) / 60_000);

      return result(
        {
          registrationNumber: vehicle.registrationNumber,
          known: true,
          latitude,
          longitude,
          speedKph: live?.speed ?? vehicle.lastSpeedKph,
          heading: live?.heading ?? vehicle.lastHeading,
          recordedAt: at,
          ageMinutes,
          simulated: live?.simulated ?? false,
        },
        {
          caveats: [
            ...(ageMinutes > 15
              ? [`This position is ${ageMinutes} minutes old — the vehicle may have moved since.`]
              : []),
            ...(live?.simulated ? ['This position came from a simulator, not a real device.'] : []),
          ],
        },
      );
    },
  },

  {
    name: 'get_vehicle_telemetry_summary',
    description:
      'Recent engine and motion telemetry for one vehicle, plus any open diagnostic fault codes.',
    input: z.object({
      vehicleId: z.string().uuid(),
      hours: z.number().int().min(1).max(168).default(24).describe('Window in hours.'),
    }),
    permissions: [Permission.TELEMETRY_READ],
    feature: Feature.TELEMETRY_LIVE,
    category: 'vehicle',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }, input) => {
      const { vehicleId, hours } = input as { vehicleId: string; hours: number };
      const vehicle = await loadVehicle(organizationId, vehicleId);
      const since = new Date(Date.now() - hours * 3_600_000);

      const [readings, faults, alerts] = await Promise.all([
        prisma.telemetryReading.findMany({
          where: { vehicleId, recordedAt: { gte: since } },
          orderBy: { recordedAt: 'desc' },
          take: 500,
          select: {
            recordedAt: true,
            speedKph: true,
            rpm: true,
            coolantTemperature: true,
            fuelLevel: true,
            batteryVoltage: true,
            metrics: true,
          },
        }),
        prisma.telemetryDiagnosticCode.findMany({
          where: { vehicleId, clearedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { code: true, description: true, createdAt: true, confirmed: true },
        }),
        prisma.telemetryAlert.count({
          where: { vehicleId, status: 'OPEN', occurredAt: { gte: since } },
        }),
      ]);

      const averageOf = (values: (number | null)[]): number | null => {
        const present = values.filter((value): value is number => value !== null);
        if (present.length === 0) return null;
        return Number((present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(1));
      };

      // Which metrics this vehicle actually reports. "No rpm" and "0 rpm" are
      // different facts, and only the reading's own metric list separates them.
      const reported = new Set<string>();
      for (const reading of readings) {
        for (const metric of reading.metrics) reported.add(metric);
      }

      return result(
        {
          registrationNumber: vehicle.registrationNumber,
          windowHours: hours,
          readingCount: readings.length,
          reportedMetrics: [...reported],
          latestAt: readings[0]?.recordedAt.toISOString() ?? null,
          averageSpeedKph: averageOf(readings.map((reading) => reading.speedKph)),
          averageEngineRpm: averageOf(readings.map((reading) => reading.rpm)),
          averageCoolantTempC: averageOf(readings.map((reading) => reading.coolantTemperature)),
          latestFuelLevelPercent: readings[0]?.fuelLevel ?? null,
          latestBatteryVoltage: readings[0]?.batteryVoltage ?? null,
          openFaultCodes: faults.map((fault) => ({
            code: fault.code,
            description: fault.description,
            reportedAt: fault.createdAt.toISOString(),
            // A confirmed code is one the vehicle re-reported; an unconfirmed
            // one may have been a single transient reading.
            confirmed: fault.confirmed,
          })),
          openAlerts: alerts,
        },
        {
          basis: ResultBasis.SOURCE_DATA,
          recordCount: readings.length,
          caveats:
            readings.length === 0
              ? ['No telemetry in this window. The vehicle may have no device fitted.']
              : [
                  'Only the metrics listed in reportedMetrics are actually sent by this vehicle. Anything else is unknown, not zero.',
                ],
        },
      );
    },
  },

  {
    name: 'get_vehicle_incidents',
    description: 'SOS and safety incidents recorded against one vehicle.',
    input: z.object({
      vehicleId: z.string().uuid(),
      days: z.number().int().min(1).max(365).default(90),
    }),
    permissions: [Permission.SOS_READ],
    category: 'safety',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }, input) => {
      const { vehicleId, days } = input as { vehicleId: string; days: number };
      const vehicle = await loadVehicle(organizationId, vehicleId);
      const since = new Date(Date.now() - days * 86_400_000);

      const incidents = await prisma.sosIncident.findMany({
        where: { truckId: vehicleId, triggeredAt: { gte: since } },
        orderBy: { triggeredAt: 'desc' },
        take: 50,
        select: {
          id: true,
          reference: true,
          type: true,
          status: true,
          triggeredAt: true,
          resolvedAt: true,
        },
      });

      return result(
        {
          registrationNumber: vehicle.registrationNumber,
          windowDays: days,
          incidents: incidents.map((incident) => ({
            reference: incident.reference,
            type: incident.type,
            status: incident.status,
            raisedAt: incident.triggeredAt.toISOString(),
            resolvedAt: incident.resolvedAt?.toISOString() ?? null,
          })),
        },
        { recordCount: incidents.length },
      );
    },
  },
];
