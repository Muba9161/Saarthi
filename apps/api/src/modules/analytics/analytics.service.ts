import {
  ACTIVE_TRIP_STATUSES,
  BookingStatus,
  DocumentValidity,
  MaintenanceStatus,
  OrderStatus,
  OrganizationType,
  TravelPackageStatus,
  TripStatus,
  TruckStatus,
  resolveDocumentValidity,
  type AnalyticsQuery,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { cached } from '../../infra/cache';

/**
 * Fleet analytics.
 *
 * Every number here is aggregated from PostgreSQL rows — orders, trips, fuel
 * records, maintenance jobs and documents. Nothing is hard-coded or
 * approximated for display, so a figure on the dashboard can always be traced
 * back to the records that produced it.
 */

export interface DashboardMetrics {
  fleet: {
    totalTrucks: number;
    available: number;
    onTrip: number;
    idle: number;
    maintenance: number;
    emergency: number;
    utilizationPercent: number;
  };
  drivers: {
    total: number;
    available: number;
    onTrip: number;
    verified: number;
    averageScore: number | null;
  };
  trips: {
    active: number;
    completedThisMonth: number;
    delayed: number;
    onTimePercent: number | null;
    totalDistanceThisMonthKm: number;
  };
  orders: {
    open: number;
    inTransit: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
  };
  financial: {
    revenueThisMonth: number;
    revenuePreviousMonth: number;
    fuelCostThisMonth: number;
    maintenanceCostThisMonth: number;
    grossMarginThisMonth: number;
  };
  compliance: {
    documentsExpiringSoon: number;
    documentsExpired: number;
    pendingVerification: number;
    maintenanceOverdue: number;
  };
  safety: {
    activeSosIncidents: number;
    sosThisMonth: number;
    safetyEventsThisMonth: number;
  };
  /**
   * Passenger work, for an organization that sells it.
   *
   * `null` for a freight fleet rather than a block of zeroes: a command centre
   * that shows "0 bookings" to a haulier is inventing a business it does not
   * run, and the screen would have no way to tell that apart from a travel
   * operator having a quiet week.
   */
  travel: {
    /** Requests the provider has not yet accepted or declined. */
    awaitingConfirmation: number;
    /** Confirmed and still to depart. */
    upcoming: number;
    inProgress: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
    publishedPackages: number;
  } | null;
}

function startOfMonth(offset = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/**
 * Passenger figures for a mobility provider's command centre.
 *
 * The freight equivalents — open orders, orders in transit — are meaningless
 * to a taxi or tour operator, and the questions it does ask are different in
 * kind: not "how much is moving" but "who is waiting on me to say yes".
 * `awaitingConfirmation` is therefore first, because it is the only figure on
 * the board that represents a customer being kept waiting.
 */
async function travelMetrics(
  organizationId: string,
  monthStart: Date,
): Promise<NonNullable<DashboardMetrics['travel']>> {
  const now = new Date();

  const [
    awaitingConfirmation,
    upcoming,
    inProgress,
    completedThisMonth,
    cancelledThisMonth,
    publishedPackages,
  ] = await Promise.all([
    prisma.travelBooking.count({
      where: {
        providerOrganizationId: organizationId,
        status: { in: [BookingStatus.AWAITING_CONFIRMATION, BookingStatus.PENDING_PAYMENT] },
      },
    }),
    prisma.travelBooking.count({
      where: {
        providerOrganizationId: organizationId,
        status: BookingStatus.CONFIRMED,
        startDate: { gte: now },
      },
    }),
    prisma.travelBooking.count({
      where: { providerOrganizationId: organizationId, status: BookingStatus.IN_PROGRESS },
    }),
    prisma.travelBooking.count({
      where: {
        providerOrganizationId: organizationId,
        status: BookingStatus.COMPLETED,
        completedAt: { gte: monthStart },
      },
    }),
    prisma.travelBooking.count({
      where: {
        providerOrganizationId: organizationId,
        // A declined request is a booking the operator lost, exactly as a
        // cancelled one is, so both are counted here rather than leaving
        // declines invisible.
        status: { in: [BookingStatus.CANCELLED, BookingStatus.DECLINED] },
        OR: [{ cancelledAt: { gte: monthStart } }, { declinedAt: { gte: monthStart } }],
      },
    }),
    prisma.travelPackage.count({
      where: { organizationId, status: TravelPackageStatus.PUBLISHED },
    }),
  ]);

  return {
    awaitingConfirmation,
    upcoming,
    inProgress,
    completedThisMonth,
    cancelledThisMonth,
    publishedPackages,
  };
}

export async function dashboardMetrics(organizationId: string): Promise<DashboardMetrics> {
  return cached(`analytics:dashboard:${organizationId}`, 20, async () => {
    const monthStart = startOfMonth();
    const previousMonthStart = startOfMonth(-1);

    const [
      organization,
      trucks,
      drivers,
      driverScoreAggregate,
      activeTripCount,
      completedTrips,
      delayedTripCount,
      orderCounts,
      revenueThisMonth,
      revenuePreviousMonth,
      fuelThisMonth,
      maintenanceThisMonth,
      documents,
      overdueMaintenance,
      activeSos,
      sosThisMonth,
      safetyEvents,
    ] = await Promise.all([
      // Which business this is. Read here rather than passed in, so every
      // caller of the dashboard gets the same answer without having to know
      // the organization type itself.
      prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } }),
      prisma.truck.groupBy({
        by: ['status'],
        where: { organizationId, archivedAt: null },
        _count: { _all: true },
      }),
      prisma.driver.groupBy({
        by: ['availability'],
        where: { organizationId, archivedAt: null },
        _count: { _all: true },
      }),
      prisma.driver.aggregate({
        where: { organizationId, archivedAt: null, overallScore: { not: null } },
        _avg: { overallScore: true },
      }),
      prisma.trip.count({ where: { organizationId, status: { in: ACTIVE_TRIP_STATUSES } } }),
      prisma.trip.findMany({
        where: {
          organizationId,
          status: TripStatus.COMPLETED,
          actualArrivalAt: { gte: monthStart },
        },
        select: { delayMinutes: true, actualDistanceKm: true },
      }),
      prisma.trip.count({
        where: { organizationId, status: { in: ACTIVE_TRIP_STATUSES }, delayMinutes: { gt: 0 } },
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: {
          OR: [{ fleetOrganizationId: organizationId }, { customerOrganizationId: organizationId }],
        },
        _count: { _all: true },
      }),
      prisma.trip.aggregate({
        where: {
          organizationId,
          status: TripStatus.COMPLETED,
          actualArrivalAt: { gte: monthStart },
        },
        _sum: { price: true },
      }),
      prisma.trip.aggregate({
        where: {
          organizationId,
          status: TripStatus.COMPLETED,
          actualArrivalAt: { gte: previousMonthStart, lt: monthStart },
        },
        _sum: { price: true },
      }),
      prisma.fuelRecord.aggregate({
        where: { organizationId, recordedAt: { gte: monthStart } },
        _sum: { totalCost: true },
      }),
      prisma.maintenanceRecord.aggregate({
        where: {
          organizationId,
          status: MaintenanceStatus.COMPLETED,
          completedAt: { gte: monthStart },
        },
        _sum: { cost: true },
      }),
      prisma.document.findMany({
        where: { organizationId, deletedAt: null },
        select: { expiryDate: true, verificationStatus: true },
      }),
      prisma.maintenanceRecord.count({
        where: {
          organizationId,
          status: MaintenanceStatus.SCHEDULED,
          scheduledAt: { lt: new Date() },
        },
      }),
      prisma.sosIncident.count({
        where: {
          organizationId,
          status: { in: ['TRIGGERED', 'BROADCASTING', 'ACKNOWLEDGED', 'HELP_ASSIGNED', 'ASSISTANCE_ARRIVED'] },
        },
      }),
      prisma.sosIncident.count({ where: { organizationId, triggeredAt: { gte: monthStart } } }),
      prisma.driverScoreEvent.count({
        where: {
          driver: { organizationId },
          eventType: { in: ['SPEED_VIOLATION', 'HARSH_BRAKING', 'HARSH_ACCELERATION', 'INCIDENT'] },
          createdAt: { gte: monthStart },
        },
      }),
    ]);

    const truckCount = (status: TruckStatus): number =>
      trucks.find((entry) => entry.status === status)?._count._all ?? 0;
    const totalTrucks = trucks.reduce((sum, entry) => sum + entry._count._all, 0);

    const onTrip =
      truckCount(TruckStatus.ON_TRIP) +
      truckCount(TruckStatus.LOADING) +
      truckCount(TruckStatus.UNLOADING);

    const driverCount = (availability: string): number =>
      drivers.find((entry) => entry.availability === availability)?._count._all ?? 0;
    const totalDrivers = drivers.reduce((sum, entry) => sum + entry._count._all, 0);

    const orderCount = (status: OrderStatus): number =>
      orderCounts.find((entry) => entry.status === status)?._count._all ?? 0;

    const completedThisMonth = completedTrips.length;
    const onTime = completedTrips.filter((trip) => trip.delayMinutes === 0).length;

    let expiringSoon = 0;
    let expired = 0;
    let pendingVerification = 0;
    for (const document of documents) {
      const { validity } = resolveDocumentValidity({
        expiryDate: document.expiryDate,
        verificationStatus: document.verificationStatus,
      });
      if (validity === DocumentValidity.EXPIRING_SOON) expiringSoon += 1;
      else if (validity === DocumentValidity.EXPIRED) expired += 1;
      else if (validity === DocumentValidity.PENDING_VERIFICATION) pendingVerification += 1;
    }

    const revenue = Number(revenueThisMonth._sum.price ?? 0);
    const fuelCost = Number(fuelThisMonth._sum.totalCost ?? 0);
    const maintenanceCost = Number(maintenanceThisMonth._sum.cost ?? 0);

    // Utilisation: share of the fleet actually earning right now.
    const utilization = totalTrucks > 0 ? Math.round((onTrip / totalTrucks) * 100) : 0;

    const verifiedDrivers = await prisma.driver.count({
      where: { organizationId, archivedAt: null, verificationStatus: 'VERIFIED' },
    });

    // Passenger work. Only queried for an organization that sells it — a
    // freight fleet pays for none of these round trips.
    const travel =
      organization?.type === OrganizationType.MOBILITY_PROVIDER
        ? await travelMetrics(organizationId, monthStart)
        : null;

    return {
      fleet: {
        totalTrucks,
        available: truckCount(TruckStatus.AVAILABLE) + truckCount(TruckStatus.ASSIGNED),
        onTrip,
        idle: truckCount(TruckStatus.IDLE) + truckCount(TruckStatus.OFFLINE),
        maintenance: truckCount(TruckStatus.MAINTENANCE),
        emergency: truckCount(TruckStatus.EMERGENCY),
        utilizationPercent: utilization,
      },
      drivers: {
        total: totalDrivers,
        available: driverCount('AVAILABLE'),
        onTrip: driverCount('ON_TRIP'),
        verified: verifiedDrivers,
        averageScore: driverScoreAggregate._avg.overallScore
          ? Math.round(driverScoreAggregate._avg.overallScore)
          : null,
      },
      trips: {
        active: activeTripCount,
        completedThisMonth,
        delayed: delayedTripCount,
        onTimePercent:
          completedThisMonth > 0 ? Math.round((onTime / completedThisMonth) * 100) : null,
        totalDistanceThisMonthKm: Number(
          completedTrips.reduce((sum, trip) => sum + trip.actualDistanceKm, 0).toFixed(1),
        ),
      },
      orders: {
        open: orderCount(OrderStatus.REQUESTED) + orderCount(OrderStatus.QUOTED),
        inTransit:
          orderCount(OrderStatus.IN_TRANSIT) +
          orderCount(OrderStatus.PICKUP) +
          orderCount(OrderStatus.ASSIGNED),
        completedThisMonth: await prisma.order.count({
          where: {
            OR: [
              { fleetOrganizationId: organizationId },
              { customerOrganizationId: organizationId },
            ],
            status: OrderStatus.COMPLETED,
            completedAt: { gte: monthStart },
          },
        }),
        cancelledThisMonth: await prisma.order.count({
          where: {
            OR: [
              { fleetOrganizationId: organizationId },
              { customerOrganizationId: organizationId },
            ],
            status: OrderStatus.CANCELLED,
            cancelledAt: { gte: monthStart },
          },
        }),
      },
      financial: {
        revenueThisMonth: revenue,
        revenuePreviousMonth: Number(revenuePreviousMonth._sum.price ?? 0),
        fuelCostThisMonth: fuelCost,
        maintenanceCostThisMonth: maintenanceCost,
        grossMarginThisMonth: Number((revenue - fuelCost - maintenanceCost).toFixed(2)),
      },
      compliance: {
        documentsExpiringSoon: expiringSoon,
        documentsExpired: expired,
        pendingVerification,
        maintenanceOverdue: overdueMaintenance,
      },
      travel,
      safety: {
        activeSosIncidents: activeSos,
        sosThisMonth,
        safetyEventsThisMonth: safetyEvents,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Time series & leaderboards
// ---------------------------------------------------------------------------

export interface TimeSeriesPoint {
  date: string;
  trips: number;
  distanceKm: number;
  revenue: number;
  fuelCost: number;
}

function bucketKey(date: Date, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'month') return date.toISOString().slice(0, 7);
  if (granularity === 'week') {
    const monday = new Date(date);
    const day = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - day);
    return monday.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export async function performanceSeries(
  organizationId: string,
  query: AnalyticsQuery,
): Promise<TimeSeriesPoint[]> {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);

  const [trips, fuel] = await Promise.all([
    prisma.trip.findMany({
      where: {
        organizationId,
        status: TripStatus.COMPLETED,
        actualArrivalAt: { gte: from, lte: to },
      },
      select: { actualArrivalAt: true, actualDistanceKm: true, price: true },
    }),
    prisma.fuelRecord.findMany({
      where: { organizationId, recordedAt: { gte: from, lte: to } },
      select: { recordedAt: true, totalCost: true },
    }),
  ]);

  const buckets = new Map<string, TimeSeriesPoint>();
  const ensure = (key: string): TimeSeriesPoint => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: TimeSeriesPoint = { date: key, trips: 0, distanceKm: 0, revenue: 0, fuelCost: 0 };
    buckets.set(key, created);
    return created;
  };

  for (const trip of trips) {
    if (!trip.actualArrivalAt) continue;
    const bucket = ensure(bucketKey(trip.actualArrivalAt, query.granularity));
    bucket.trips += 1;
    bucket.distanceKm += trip.actualDistanceKm;
    bucket.revenue += Number(trip.price ?? 0);
  }

  for (const record of fuel) {
    const bucket = ensure(bucketKey(record.recordedAt, query.granularity));
    bucket.fuelCost += Number(record.totalCost);
  }

  return [...buckets.values()]
    .map((point) => ({
      ...point,
      distanceKm: Number(point.distanceKm.toFixed(1)),
      revenue: Number(point.revenue.toFixed(2)),
      fuelCost: Number(point.fuelCost.toFixed(2)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface TruckPerformance {
  truckId: string;
  registrationNumber: string;
  trips: number;
  distanceKm: number;
  revenue: number;
  fuelCost: number;
  maintenanceCost: number;
  profit: number;
  utilizationPercent: number;
  fuelEfficiencyL100Km: number | null;
}

export async function truckPerformance(
  organizationId: string,
  query: AnalyticsQuery,
): Promise<TruckPerformance[]> {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
  const windowMs = to.getTime() - from.getTime();

  const trucks = await prisma.truck.findMany({
    where: { organizationId, archivedAt: null },
    select: { id: true, registrationNumber: true },
  });

  const results: TruckPerformance[] = [];

  for (const truck of trucks) {
    const [trips, fuel, maintenance] = await Promise.all([
      prisma.trip.findMany({
        where: {
          truckId: truck.id,
          status: TripStatus.COMPLETED,
          actualArrivalAt: { gte: from, lte: to },
        },
        select: { actualDistanceKm: true, price: true, actualDurationMin: true },
      }),
      prisma.fuelRecord.aggregate({
        where: { truckId: truck.id, recordedAt: { gte: from, lte: to } },
        _sum: { totalCost: true, quantityLitres: true },
      }),
      prisma.maintenanceRecord.aggregate({
        where: {
          truckId: truck.id,
          status: MaintenanceStatus.COMPLETED,
          completedAt: { gte: from, lte: to },
        },
        _sum: { cost: true },
      }),
    ]);

    const distanceKm = trips.reduce((sum, trip) => sum + trip.actualDistanceKm, 0);
    const revenue = trips.reduce((sum, trip) => sum + Number(trip.price ?? 0), 0);
    const fuelCost = Number(fuel._sum.totalCost ?? 0);
    const litres = fuel._sum.quantityLitres ?? 0;
    const maintenanceCost = Number(maintenance._sum.cost ?? 0);

    // Utilisation = share of the window the truck was actually on a trip.
    const drivingMs = trips.reduce((sum, trip) => sum + (trip.actualDurationMin ?? 0) * 60_000, 0);

    results.push({
      truckId: truck.id,
      registrationNumber: truck.registrationNumber,
      trips: trips.length,
      distanceKm: Number(distanceKm.toFixed(1)),
      revenue: Number(revenue.toFixed(2)),
      fuelCost: Number(fuelCost.toFixed(2)),
      maintenanceCost: Number(maintenanceCost.toFixed(2)),
      profit: Number((revenue - fuelCost - maintenanceCost).toFixed(2)),
      utilizationPercent: windowMs > 0 ? Math.min(100, Math.round((drivingMs / windowMs) * 100)) : 0,
      fuelEfficiencyL100Km:
        litres > 0 && distanceKm > 0 ? Number(((litres / distanceKm) * 100).toFixed(2)) : null,
    });
  }

  return results.sort((a, b) => b.profit - a.profit);
}

export interface DriverPerformance {
  driverId: string;
  name: string;
  trips: number;
  distanceKm: number;
  onTimePercent: number | null;
  overallScore: number | null;
  safetyEvents: number;
  averageRating: number | null;
}

export async function driverPerformance(
  organizationId: string,
  query: AnalyticsQuery,
): Promise<DriverPerformance[]> {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);

  const drivers = await prisma.driver.findMany({
    where: { organizationId, archivedAt: null },
    include: { user: { select: { firstName: true, lastName: true } } },
  });

  const results: DriverPerformance[] = [];

  for (const driver of drivers) {
    const [trips, safetyEvents, ratings] = await Promise.all([
      prisma.trip.findMany({
        where: {
          driverId: driver.id,
          status: TripStatus.COMPLETED,
          actualArrivalAt: { gte: from, lte: to },
        },
        select: { delayMinutes: true, actualDistanceKm: true },
      }),
      prisma.driverScoreEvent.count({
        where: {
          driverId: driver.id,
          eventType: {
            in: ['SPEED_VIOLATION', 'HARSH_BRAKING', 'HARSH_ACCELERATION', 'INCIDENT'],
          },
          createdAt: { gte: from, lte: to },
        },
      }),
      prisma.orderRating.aggregate({
        where: { driverId: driver.id, createdAt: { gte: from, lte: to } },
        _avg: { rating: true },
      }),
    ]);

    const onTime = trips.filter((trip) => trip.delayMinutes === 0).length;

    results.push({
      driverId: driver.id,
      name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
      trips: trips.length,
      distanceKm: Number(trips.reduce((sum, trip) => sum + trip.actualDistanceKm, 0).toFixed(1)),
      onTimePercent: trips.length > 0 ? Math.round((onTime / trips.length) * 100) : null,
      overallScore: driver.overallScore,
      safetyEvents,
      averageRating: ratings._avg.rating ? Number(ratings._avg.rating.toFixed(2)) : null,
    });
  }

  return results.sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
}

export interface RoutePerformance {
  route: string;
  trips: number;
  averageDistanceKm: number;
  averageDurationMin: number | null;
  averageRevenue: number;
  onTimePercent: number | null;
}

export async function routePerformance(
  organizationId: string,
  query: AnalyticsQuery,
): Promise<RoutePerformance[]> {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 90 * 86_400_000);

  const trips = await prisma.trip.findMany({
    where: {
      organizationId,
      status: TripStatus.COMPLETED,
      actualArrivalAt: { gte: from, lte: to },
    },
    select: {
      originAddress: true,
      destinationAddress: true,
      actualDistanceKm: true,
      actualDurationMin: true,
      price: true,
      delayMinutes: true,
    },
  });

  const groups = new Map<
    string,
    { trips: number; distance: number; duration: number; durationCount: number; revenue: number; onTime: number }
  >();

  for (const trip of trips) {
    // Group by town-level origin → destination so the list stays readable.
    const key = `${trip.originAddress.split(',')[0]?.trim()} → ${trip.destinationAddress.split(',')[0]?.trim()}`;
    const bucket = groups.get(key) ?? {
      trips: 0,
      distance: 0,
      duration: 0,
      durationCount: 0,
      revenue: 0,
      onTime: 0,
    };
    bucket.trips += 1;
    bucket.distance += trip.actualDistanceKm;
    if (trip.actualDurationMin !== null) {
      bucket.duration += trip.actualDurationMin;
      bucket.durationCount += 1;
    }
    bucket.revenue += Number(trip.price ?? 0);
    if (trip.delayMinutes === 0) bucket.onTime += 1;
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([route, bucket]) => ({
      route,
      trips: bucket.trips,
      averageDistanceKm: Number((bucket.distance / bucket.trips).toFixed(1)),
      averageDurationMin:
        bucket.durationCount > 0 ? Math.round(bucket.duration / bucket.durationCount) : null,
      averageRevenue: Number((bucket.revenue / bucket.trips).toFixed(2)),
      onTimePercent: Math.round((bucket.onTime / bucket.trips) * 100),
    }))
    .sort((a, b) => b.trips - a.trips);
}

/**
 * Truck passport: the complete operational history of one vehicle.
 * This is Saarthi's flagship record and is assembled entirely from stored data.
 */
export async function truckPassport(organizationId: string, truckId: string) {
  const truck = await prisma.truck.findFirst({ where: { id: truckId, organizationId } });
  if (!truck) return null;

  const [
    documents,
    assignments,
    trips,
    orders,
    maintenance,
    fuel,
    incidents,
    events,
    tripAggregate,
    fuelAggregate,
    maintenanceAggregate,
  ] = await Promise.all([
    prisma.document.findMany({
      where: { ownerType: 'TRUCK', ownerId: truckId, deletedAt: null },
      orderBy: { expiryDate: 'asc' },
    }),
    prisma.truckAssignment.findMany({
      where: { truckId },
      include: { driver: { include: { user: { select: { firstName: true, lastName: true } } } } },
      orderBy: { assignedAt: 'desc' },
      take: 50,
    }),
    prisma.trip.findMany({
      where: { truckId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        reference: true,
        status: true,
        originAddress: true,
        destinationAddress: true,
        actualDistanceKm: true,
        actualArrivalAt: true,
        delayMinutes: true,
        price: true,
      },
    }),
    prisma.order.count({ where: { assignedTruckId: truckId } }),
    prisma.maintenanceRecord.findMany({
      where: { truckId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.fuelRecord.findMany({ where: { truckId }, orderBy: { recordedAt: 'desc' }, take: 25 }),
    prisma.sosIncident.count({ where: { truckId } }),
    prisma.truckEvent.findMany({ where: { truckId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.trip.aggregate({
      where: { truckId, status: TripStatus.COMPLETED },
      _count: { _all: true },
      _sum: { actualDistanceKm: true, price: true },
    }),
    prisma.fuelRecord.aggregate({
      where: { truckId },
      _sum: { totalCost: true, quantityLitres: true },
    }),
    prisma.maintenanceRecord.aggregate({
      where: { truckId, status: MaintenanceStatus.COMPLETED },
      _sum: { cost: true },
      _count: { _all: true },
    }),
  ]);

  const totalDistance = tripAggregate._sum.actualDistanceKm ?? 0;
  const totalLitres = fuelAggregate._sum.quantityLitres ?? 0;
  const revenue = Number(tripAggregate._sum.price ?? 0);
  const fuelCost = Number(fuelAggregate._sum.totalCost ?? 0);
  const maintenanceCost = Number(maintenanceAggregate._sum.cost ?? 0);

  return {
    truck: {
      id: truck.id,
      registrationNumber: truck.registrationNumber,
      truckType: truck.truckType,
      manufacturer: truck.manufacturer,
      model: truck.model,
      year: truck.year,
      capacityTons: truck.capacityTons,
      fuelType: truck.fuelType,
      odometerKm: Math.round(truck.odometerKm),
      status: truck.status,
      verificationStatus: truck.verificationStatus,
      createdAt: truck.createdAt.toISOString(),
    },
    lifetime: {
      completedTrips: tripAggregate._count._all,
      totalOrders: orders,
      totalDistanceKm: Number(totalDistance.toFixed(1)),
      revenue: Number(revenue.toFixed(2)),
      fuelCost: Number(fuelCost.toFixed(2)),
      maintenanceCost: Number(maintenanceCost.toFixed(2)),
      profit: Number((revenue - fuelCost - maintenanceCost).toFixed(2)),
      servicesCompleted: maintenanceAggregate._count._all,
      incidents,
      fuelEfficiencyL100Km:
        totalLitres > 0 && totalDistance > 0
          ? Number(((totalLitres / totalDistance) * 100).toFixed(2))
          : null,
      costPerKm:
        totalDistance > 0
          ? Number(((fuelCost + maintenanceCost) / totalDistance).toFixed(2))
          : null,
    },
    documents: documents.map((document) => {
      const { validity, daysRemaining } = resolveDocumentValidity({
        expiryDate: document.expiryDate,
        verificationStatus: document.verificationStatus,
      });
      return {
        id: document.id,
        documentType: document.documentType,
        title: document.title,
        documentNumber: document.documentNumber,
        expiryDate: document.expiryDate?.toISOString() ?? null,
        verificationStatus: document.verificationStatus,
        validity,
        daysRemaining,
      };
    }),
    driverHistory: assignments.map((assignment) => ({
      driverId: assignment.driverId,
      name: `${assignment.driver.user.firstName} ${assignment.driver.user.lastName}`.trim(),
      status: assignment.status,
      assignedAt: assignment.assignedAt.toISOString(),
      unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
    })),
    recentTrips: trips.map((trip) => ({
      ...trip,
      price: trip.price ? Number(trip.price) : null,
      actualArrivalAt: trip.actualArrivalAt?.toISOString() ?? null,
    })),
    maintenance: maintenance.map((record) => ({
      id: record.id,
      type: record.type,
      title: record.title,
      status: record.status,
      cost: record.cost ? Number(record.cost) : null,
      odometerKm: record.odometerKm,
      scheduledAt: record.scheduledAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      serviceProvider: record.serviceProvider,
    })),
    fuel: fuel.map((record) => ({
      id: record.id,
      quantityLitres: record.quantityLitres,
      totalCost: Number(record.totalCost),
      odometerKm: record.odometerKm,
      stationName: record.stationName,
      recordedAt: record.recordedAt.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      description: event.description,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
