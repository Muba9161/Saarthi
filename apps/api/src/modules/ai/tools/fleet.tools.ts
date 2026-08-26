import { z } from 'zod';
import {
  Feature,
  MaintenanceStatus,
  Permission,
  TruckStatus,
  resolveServiceHealth,
} from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { dashboardMetrics } from '../../analytics/analytics.service';
import { maintenanceRisk } from '../../maintenance/maintenance.service';
import { fleetLoanSummary } from '../../loans/loan.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Fleet-level tools.
 *
 * These answer the question an owner actually opens Saarthi with: *is anything
 * wrong today?* Each one returns a small, already-aggregated object rather than
 * rows — partly for cost, mostly because a model handed two hundred vehicle
 * records will summarise them itself, and its arithmetic is not something to
 * put in front of someone making a dispatch decision.
 */

const noArgs = z.object({}).describe('No arguments.');

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
    basis: options.basis ?? ResultBasis.RULE_RESULT,
    references: options.references ?? [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 0,
  };
}

export const FLEET_TOOLS: AiTool[] = [
  {
    name: 'get_fleet_summary',
    description:
      'Overall fleet position: vehicle counts by status, active trips, open orders, revenue and cost for the current period.',
    input: noArgs,
    permissions: [Permission.ANALYTICS_READ],
    category: 'fleet',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }) => {
      const metrics = await dashboardMetrics(organizationId);
      return result(metrics, {
        basis: ResultBasis.RULE_RESULT,
        recordCount: metrics.fleet?.totalTrucks ?? 0,
      });
    },
  },

  {
    name: 'get_fleet_health',
    description:
      'Which vehicles need attention right now, and why: overdue service, expired documents, offline devices and open incidents.',
    input: noArgs,
    permissions: [Permission.TRUCKS_READ],
    category: 'fleet',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }) => {
      const now = new Date();

      const [vehicles, overdueService, expiredDocuments, openIncidents, offlineDevices] =
        await Promise.all([
          prisma.truck.findMany({
            where: { organizationId, archivedAt: null },
            select: {
              id: true,
              registrationNumber: true,
              status: true,
              odometerKm: true,
              lastLocationAt: true,
            },
          }),
          prisma.maintenanceRecord.findMany({
            where: {
              organizationId,
              status: MaintenanceStatus.SCHEDULED,
              scheduledAt: { lt: now },
            },
            select: { truckId: true, title: true, scheduledAt: true },
            take: 100,
          }),
          prisma.document.count({
            where: {
              organizationId,
              deletedAt: null,
              expiryDate: { lt: now },
            },
          }),
          prisma.sosIncident.count({
            where: {
              organizationId,
              status: {
                in: ['TRIGGERED', 'BROADCASTING', 'ACKNOWLEDGED', 'HELP_ASSIGNED', 'ASSISTANCE_ARRIVED'],
              },
            },
          }),
          prisma.hardwareDevice.count({
            where: { organizationId, status: 'OFFLINE', archivedAt: null },
          }),
        ]);

      const overdueByVehicle = new Map<string, number>();
      for (const record of overdueService) {
        overdueByVehicle.set(record.truckId, (overdueByVehicle.get(record.truckId) ?? 0) + 1);
      }

      const needsAttention = vehicles
        .filter((vehicle) => overdueByVehicle.has(vehicle.id))
        .map((vehicle) => ({
          vehicleId: vehicle.id,
          registrationNumber: vehicle.registrationNumber,
          overdueJobs: overdueByVehicle.get(vehicle.id) ?? 0,
          status: vehicle.status,
        }));

      return result(
        {
          totalVehicles: vehicles.length,
          available: vehicles.filter((vehicle) => vehicle.status === TruckStatus.AVAILABLE).length,
          inMaintenance: vehicles.filter((vehicle) => vehicle.status === TruckStatus.MAINTENANCE)
            .length,
          needsAttention,
          expiredDocuments,
          openIncidents,
          offlineDevices,
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: vehicles.length,
          references: needsAttention.slice(0, 10).map((entry) => ({
            type: 'vehicle',
            id: entry.vehicleId,
            label: entry.registrationNumber,
          })),
        },
      );
    },
  },

  {
    name: 'get_fleet_service_status',
    description:
      'Service position across the fleet: which vehicles are overdue, due soon, or have never had a service recorded.',
    input: noArgs,
    permissions: [Permission.MAINTENANCE_READ],
    feature: Feature.MAINTENANCE_BASIC,
    category: 'service',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }) => {
      const vehicles = await prisma.truck.findMany({
        where: { organizationId, archivedAt: null },
        select: { id: true, registrationNumber: true, odometerKm: true },
      });

      const entries = await Promise.all(
        vehicles.map(async (vehicle) => {
          const [lastService, overdueJobs] = await Promise.all([
            prisma.maintenanceRecord.findFirst({
              where: { truckId: vehicle.id, status: MaintenanceStatus.COMPLETED },
              orderBy: { completedAt: 'desc' },
              select: { completedAt: true, odometerKm: true },
            }),
            prisma.maintenanceRecord.count({
              where: {
                truckId: vehicle.id,
                status: MaintenanceStatus.SCHEDULED,
                scheduledAt: { lt: new Date() },
              },
            }),
          ]);

          const health = resolveServiceHealth({
            odometerKm: vehicle.odometerKm,
            lastServiceAt: lastService?.completedAt ?? null,
            lastServiceOdometerKm: lastService?.odometerKm ?? null,
            overdueScheduledJobs: overdueJobs,
          });

          return {
            vehicleId: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            health: health.health,
            reasons: health.reasons,
            lastServiceAt: lastService?.completedAt?.toISOString() ?? null,
          };
        }),
      );

      const byHealth = (health: string) => entries.filter((entry) => entry.health === health);

      return result(
        {
          overdue: byHealth('Service overdue'),
          due: byHealth('Service due'),
          neverServiced: byHealth('No service recorded'),
          healthy: byHealth('Healthy').length,
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: entries.length,
          caveats:
            byHealth('No service recorded').length > 0
              ? [
                  'Vehicles with no service on record are listed separately. An absence of records is not evidence that a vehicle has been maintained.',
                ]
              : [],
        },
      );
    },
  },

  {
    name: 'get_fleet_maintenance_risk',
    description:
      'Rule-based maintenance risk score per vehicle, computed from mileage since last service, overdue jobs and recent repair frequency.',
    input: noArgs,
    permissions: [Permission.MAINTENANCE_READ],
    feature: Feature.MAINTENANCE_BASIC,
    category: 'service',
    cacheTtlSeconds: 60,
    handler: async ({ organizationId }) => {
      const risks = await maintenanceRisk(organizationId);
      return result(risks.slice(0, 25), {
        basis: ResultBasis.RULE_RESULT,
        recordCount: risks.length,
        caveats: [
          'Risk is calculated from recorded facts and fixed rules. It is not a prediction of failure, and it does not diagnose a fault.',
        ],
        references: risks.slice(0, 10).map((risk) => ({
          type: 'vehicle',
          id: risk.truckId,
          label: risk.registrationNumber,
        })),
      });
    },
  },

  {
    name: 'get_fleet_loan_summary',
    description:
      'Finance position across the fleet: monthly EMI obligation, total outstanding, overdue installments and what falls due this month.',
    input: noArgs,
    permissions: [Permission.LOANS_READ],
    feature: Feature.FINANCE_LOANS,
    category: 'finance',
    // Financial figures get a short window: an owner who has just recorded a
    // payment must not be told by the assistant that it is still outstanding.
    cacheTtlSeconds: 20,
    handler: async ({ auth, organizationId }) => {
      const summary = await fleetLoanSummary(auth, organizationId);
      return result(summary, {
        basis: ResultBasis.RULE_RESULT,
        recordCount: summary.activeLoans,
        caveats:
          summary.unknownInstallments > 0
            ? [
                `${summary.unknownInstallments} installment(s) have no confirmed payment state and are excluded from every figure here, so the totals are a floor rather than a complete picture.`,
              ]
            : [],
      });
    },
  },

  {
    name: 'get_fleet_device_health',
    description:
      'Connected hardware status: how many devices are online, offline or never reported, and which vehicles have no device fitted.',
    input: noArgs,
    permissions: [Permission.DEVICES_READ],
    feature: Feature.HARDWARE_CONNECTIVITY,
    category: 'fleet',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }) => {
      const [devices, assignedVehicleIds, totalVehicles] = await Promise.all([
        prisma.hardwareDevice.findMany({
          where: { organizationId, archivedAt: null },
          select: {
            id: true,
            deviceIdentifier: true,
            status: true,
            lastSeenAt: true,
            provider: true,
          },
        }),
        prisma.deviceAssignment.findMany({
          where: { organizationId, status: 'ACTIVE' },
          select: { vehicleId: true },
        }),
        prisma.truck.count({ where: { organizationId, archivedAt: null } }),
      ]);

      const byStatus = (status: string) =>
        devices.filter((device) => device.status === status).length;

      return result(
        {
          totalDevices: devices.length,
          online: byStatus('ACTIVE'),
          offline: byStatus('OFFLINE'),
          neverReported: devices.filter((device) => device.lastSeenAt === null).length,
          vehiclesWithDevice: new Set(assignedVehicleIds.map((row) => row.vehicleId)).size,
          vehiclesWithoutDevice:
            totalVehicles - new Set(assignedVehicleIds.map((row) => row.vehicleId)).size,
          offlineDevices: devices
            .filter((device) => device.status === 'OFFLINE')
            .slice(0, 10)
            .map((device) => ({
              deviceId: device.id,
              identifier: device.deviceIdentifier,
              lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
            })),
        },
        { basis: ResultBasis.SOURCE_DATA, recordCount: devices.length },
      );
    },
  },

  {
    name: 'get_fleet_anomalies',
    description:
      'Open anomalies detected by Saarthi rules: telemetry alerts, route deviations, fuel irregularities and repeated harsh driving events.',
    input: z.object({
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .default(7)
        .describe('How many days back to look. Defaults to 7.'),
    }),
    permissions: [Permission.TELEMETRY_ALERTS_READ],
    category: 'fleet',
    cacheTtlSeconds: 30,
    handler: async ({ organizationId }, input) => {
      const { days } = input as { days: number };
      const since = new Date(Date.now() - days * 86_400_000);

      const alerts = await prisma.telemetryAlert.findMany({
        where: { organizationId, status: 'OPEN', occurredAt: { gte: since } },
        orderBy: { occurredAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          severity: true,
          occurredAt: true,
          vehicleId: true,
          message: true,
        },
      });

      const grouped = new Map<string, number>();
      for (const alert of alerts) {
        grouped.set(alert.type, (grouped.get(alert.type) ?? 0) + 1);
      }

      return result(
        {
          windowDays: days,
          totalOpen: alerts.length,
          byType: Object.fromEntries(grouped),
          recent: alerts.slice(0, 15).map((alert) => ({
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity,
            occurredAt: alert.occurredAt.toISOString(),
            vehicleId: alert.vehicleId,
            message: alert.message,
          })),
        },
        {
          basis: ResultBasis.RULE_RESULT,
          recordCount: alerts.length,
          caveats: [
            'These are rule-based detections, not diagnoses. Each one says something looked unusual, not why.',
          ],
        },
      );
    },
  },
];
