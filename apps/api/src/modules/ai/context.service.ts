import {
  ACTIVE_TRIP_STATUSES,
  DocumentValidity,
  MaintenanceStatus,
  TruckStatus,
  formatCurrency,
  resolveDocumentValidity,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import type { AiContext, AiFact } from '../../providers/ai';
import type { AuthContext } from '../../auth/context';
import { dashboardMetrics } from '../analytics/analytics.service';
import { maintenanceRisk } from '../maintenance/maintenance.service';

/**
 * AI permission boundary.
 *
 * This module is the *only* path by which operational data reaches an AI
 * provider. It authenticates, resolves the tenant, reads a bounded set of
 * records that the caller is already entitled to see, minimises them into
 * plain statements, and returns a context object. The model itself never
 * queries the database and never sees a record the caller could not open in
 * the UI.
 *
 * Personal data is minimised deliberately: names of drivers inside the
 * caller's own organisation are included (the fleet owner sees them anyway),
 * but phone numbers, addresses, licence numbers and document contents are not.
 */

const MAX_FACTS_PER_CATEGORY = 15;

export interface ContextOptions {
  /** Narrow the context to what a specific question needs. */
  focus?: 'fleet' | 'documents' | 'drivers' | 'trips' | 'maintenance' | 'financial' | 'all';
  truckId?: string;
  tripId?: string;
  orderId?: string;
}

export async function buildFleetContext(
  auth: AuthContext,
  organizationId: string,
  options: ContextOptions = {},
): Promise<AiContext> {
  const focus = options.focus ?? 'all';
  const facts: AiFact[] = [];

  const [organization, metrics] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, type: true },
    }),
    dashboardMetrics(organizationId),
  ]);

  const include = (category: ContextOptions['focus']): boolean =>
    focus === 'all' || focus === category;

  // --- Fleet ------------------------------------------------------------
  if (include('fleet')) {
    const trucks = await prisma.truck.findMany({
      where: { organizationId, archivedAt: null },
      include: {
        assignments: {
          where: { status: 'ACTIVE' },
          take: 1,
          include: { driver: { include: { user: { select: { firstName: true, lastName: true } } } } },
        },
      },
      take: 100,
    });

    const idle = trucks.filter((truck) =>
      ([TruckStatus.IDLE, TruckStatus.AVAILABLE, TruckStatus.OFFLINE] as TruckStatus[]).includes(
        truck.status as TruckStatus,
      ),
    );

    for (const truck of idle.slice(0, MAX_FACTS_PER_CATEGORY)) {
      const lastSeen = truck.lastLocationAt
        ? `last reported ${Math.round((Date.now() - truck.lastLocationAt.getTime()) / 3_600_000)} h ago`
        : 'no recent position';
      facts.push({
        reference: { type: 'truck', id: truck.id, label: truck.registrationNumber },
        statement: `${truck.registrationNumber} (${truck.capacityTons}T ${truck.truckType.toLowerCase().replace(/_/g, ' ')}) is ${truck.status.toLowerCase().replace(/_/g, ' ')} — ${lastSeen}.`,
        basis: 'recorded',
      });
    }

    for (const truck of trucks.filter((entry) => entry.status === TruckStatus.MAINTENANCE)) {
      facts.push({
        reference: { type: 'truck', id: truck.id, label: truck.registrationNumber },
        statement: `${truck.registrationNumber} is in maintenance and unavailable for dispatch.`,
        basis: 'recorded',
      });
    }
  }

  // --- Documents --------------------------------------------------------
  if (include('documents')) {
    const documents = await prisma.document.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          { expiryDate: { lte: new Date(Date.now() + 30 * 86_400_000) } },
          { verificationStatus: { in: ['REJECTED', 'PENDING_VERIFICATION'] } },
        ],
      },
      orderBy: { expiryDate: 'asc' },
      take: 60,
    });

    // Resolve owner labels without exposing anything beyond an identifier.
    const truckIds = documents.filter((d) => d.ownerType === 'TRUCK').map((d) => d.ownerId);
    const driverIds = documents.filter((d) => d.ownerType === 'DRIVER').map((d) => d.ownerId);

    const [trucks, drivers] = await Promise.all([
      truckIds.length > 0
        ? prisma.truck.findMany({
            where: { id: { in: truckIds } },
            select: { id: true, registrationNumber: true },
          })
        : Promise.resolve([]),
      driverIds.length > 0
        ? prisma.driver.findMany({
            where: { id: { in: driverIds } },
            include: { user: { select: { firstName: true, lastName: true } } },
          })
        : Promise.resolve([]),
    ]);

    const labels = new Map<string, string>([
      ...trucks.map((truck) => [truck.id, truck.registrationNumber] as const),
      ...drivers.map(
        (driver) =>
          [driver.id, `${driver.user.firstName} ${driver.user.lastName}`.trim()] as const,
      ),
    ]);

    let added = 0;
    for (const document of documents) {
      if (added >= MAX_FACTS_PER_CATEGORY) break;
      const { validity, daysRemaining } = resolveDocumentValidity({
        expiryDate: document.expiryDate,
        verificationStatus: document.verificationStatus,
      });
      if (validity === DocumentValidity.VALID || validity === DocumentValidity.NO_EXPIRY) continue;

      const owner = labels.get(document.ownerId) ?? document.ownerType.toLowerCase();
      const description =
        validity === DocumentValidity.EXPIRED
          ? `expired ${Math.abs(daysRemaining ?? 0)} days ago`
          : validity === DocumentValidity.EXPIRING_SOON
            ? `expires in ${daysRemaining} days`
            : validity === DocumentValidity.REJECTED
              ? 'was rejected and needs re-uploading'
              : 'is awaiting verification';

      facts.push({
        reference: { type: 'document', id: document.id, label: `${owner} — ${document.documentType}` },
        statement: `${document.documentType.replace(/_/g, ' ').toLowerCase()} for ${owner} ${description}.`,
        basis: 'recorded',
      });
      added += 1;
    }
  }

  // --- Drivers ----------------------------------------------------------
  if (include('drivers')) {
    const drivers = await prisma.driver.findMany({
      where: { organizationId, archivedAt: null },
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { overallScore: 'desc' },
      take: 40,
    });

    for (const driver of drivers.slice(0, MAX_FACTS_PER_CATEGORY)) {
      const name = `${driver.user.firstName} ${driver.user.lastName}`.trim();
      facts.push({
        reference: { type: 'driver', id: driver.id, label: name },
        statement:
          `${name}: score ${driver.overallScore ?? 'not yet calculated'}, ` +
          `${driver.totalTrips} completed trips, ${Math.round(driver.totalDistanceKm).toLocaleString('en-IN')} km driven, ` +
          `currently ${driver.availability.toLowerCase().replace(/_/g, ' ')}.`,
        basis: 'calculated',
      });
    }
  }

  // --- Trips ------------------------------------------------------------
  if (include('trips')) {
    const trips = await prisma.trip.findMany({
      where: { organizationId, status: { in: ACTIVE_TRIP_STATUSES } },
      include: { order: { select: { reference: true } } },
      orderBy: { delayMinutes: 'desc' },
      take: 40,
    });

    const truckIds = [...new Set(trips.map((trip) => trip.truckId))];
    const trucks = await prisma.truck.findMany({
      where: { id: { in: truckIds } },
      select: { id: true, registrationNumber: true },
    });
    const truckMap = new Map(trucks.map((truck) => [truck.id, truck.registrationNumber]));

    for (const trip of trips.slice(0, MAX_FACTS_PER_CATEGORY)) {
      const registration = truckMap.get(trip.truckId) ?? 'a truck';
      const progress =
        trip.plannedDistanceKm && trip.plannedDistanceKm > 0
          ? Math.round((trip.actualDistanceKm / trip.plannedDistanceKm) * 100)
          : 0;
      const delay =
        trip.delayMinutes > 0
          ? ` and is running ${trip.delayMinutes} minutes late`
          : ' and is on schedule';

      facts.push({
        reference: { type: 'trip', id: trip.id, label: trip.reference },
        statement:
          `${trip.reference} (${registration}) ${trip.originAddress.split(',')[0]} → ${trip.destinationAddress.split(',')[0]} ` +
          `is ${progress}% complete${delay}.`,
        basis: 'calculated',
      });
    }
  }

  // --- Maintenance ------------------------------------------------------
  if (include('maintenance')) {
    const [overdue, risks] = await Promise.all([
      prisma.maintenanceRecord.findMany({
        where: {
          organizationId,
          status: MaintenanceStatus.SCHEDULED,
          scheduledAt: { lt: new Date() },
        },
        take: 20,
      }),
      maintenanceRisk(organizationId),
    ]);

    const truckMap = new Map(
      (
        await prisma.truck.findMany({
          where: { id: { in: overdue.map((record) => record.truckId) } },
          select: { id: true, registrationNumber: true },
        })
      ).map((truck) => [truck.id, truck.registrationNumber]),
    );

    for (const record of overdue.slice(0, 8)) {
      const days = record.scheduledAt
        ? Math.round((Date.now() - record.scheduledAt.getTime()) / 86_400_000)
        : 0;
      facts.push({
        reference: {
          type: 'maintenance',
          id: record.id,
          label: truckMap.get(record.truckId) ?? 'Truck',
        },
        statement: `${record.title} for ${truckMap.get(record.truckId) ?? 'a truck'} is ${days} days overdue.`,
        basis: 'recorded',
      });
    }

    for (const risk of risks.filter((entry) => entry.level !== 'LOW').slice(0, 8)) {
      facts.push({
        reference: { type: 'maintenance', id: risk.truckId, label: risk.registrationNumber },
        statement:
          `${risk.registrationNumber} has ${risk.level.toLowerCase()} maintenance risk (${risk.riskScore}/100): ` +
          risk.reasons.join(' '),
        // Rule-based scoring over recorded facts, not a model prediction.
        basis: 'calculated',
      });
    }
  }

  // --- Financial --------------------------------------------------------
  if (include('financial')) {
    facts.push({
      reference: { type: 'financial', id: organizationId, label: 'This month' },
      statement:
        `Revenue this month is ${formatCurrency(metrics.financial.revenueThisMonth)} ` +
        `against ${formatCurrency(metrics.financial.revenuePreviousMonth)} last month. ` +
        `Fuel cost ${formatCurrency(metrics.financial.fuelCostThisMonth)}, ` +
        `maintenance ${formatCurrency(metrics.financial.maintenanceCostThisMonth)}, ` +
        `gross margin ${formatCurrency(metrics.financial.grossMarginThisMonth)}.`,
      basis: 'calculated',
    });
  }

  // --- Safety alerts ----------------------------------------------------
  if (metrics.safety.activeSosIncidents > 0) {
    facts.unshift({
      reference: { type: 'sos', id: organizationId, label: 'Active SOS' },
      statement: `${metrics.safety.activeSosIncidents} SOS incident(s) are currently active and need immediate attention.`,
      basis: 'recorded',
    });
  }

  return {
    scope: `${organization?.name ?? 'your organization'} — ${metrics.fleet.totalTrucks} trucks, ${metrics.drivers.total} drivers`,
    organizationId,
    role: auth.organization?.membershipRole ?? auth.user.roles[0] ?? 'FLEET_OWNER',
    facts,
    metrics: {
      totalTrucks: metrics.fleet.totalTrucks,
      availableTrucks: metrics.fleet.available,
      trucksOnTrip: metrics.fleet.onTrip,
      trucksInMaintenance: metrics.fleet.maintenance,
      fleetUtilizationPercent: metrics.fleet.utilizationPercent,
      totalDrivers: metrics.drivers.total,
      averageDriverScore: metrics.drivers.averageScore,
      activeTrips: metrics.trips.active,
      delayedTrips: metrics.trips.delayed,
      onTimePercent: metrics.trips.onTimePercent,
      completedTripsThisMonth: metrics.trips.completedThisMonth,
      distanceThisMonthKm: metrics.trips.totalDistanceThisMonthKm,
      openOrders: metrics.orders.open,
      revenueThisMonth: metrics.financial.revenueThisMonth,
      fuelCostThisMonth: metrics.financial.fuelCostThisMonth,
      maintenanceCostThisMonth: metrics.financial.maintenanceCostThisMonth,
      grossMarginThisMonth: metrics.financial.grossMarginThisMonth,
      documentsExpiringSoon: metrics.compliance.documentsExpiringSoon,
      documentsExpired: metrics.compliance.documentsExpired,
      maintenanceOverdue: metrics.compliance.maintenanceOverdue,
      activeSosIncidents: metrics.safety.activeSosIncidents,
      safetyEventsThisMonth: metrics.safety.safetyEventsThisMonth,
    },
    generatedAt: new Date().toISOString(),
  };
}
