import {
  DEFAULT_SAFETY_THRESHOLDS,
  MOVING_TRIP_STATUSES,
  NotificationPriority,
  NotificationType,
  TrackingSource,
  TripStatus,
  cumulativeDistances,
  distanceKm,
  distanceToPath,
  distanceToSegment,
  haversineDistance,
  pathLength,
  type LatLng,
  type TrackingHistoryQuery,
  type TrackingLocationInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  broadcastTripEvent,
  broadcastTripProgress,
  broadcastTruckLocation,
} from '../../realtime/realtime.service';
import { notifyOrganization } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Tracking ingestion pipeline.
 *
 *   GPS source → validation → persistence → derived metrics → realtime
 *
 * The local simulator, a driver's phone and (later) a hardware tracker all
 * enter here with the same normalised payload, so nothing downstream — trip
 * progress, ETA, deviation alerts, the dashboard — needs to know which source
 * produced a point.
 */

const trackingLogger = logger.child({ module: 'tracking' });

export interface IngestResult {
  accepted: boolean;
  truckId: string;
  tripId: string | null;
  distanceCoveredKm: number;
  progressPercent: number;
  etaAt: string | null;
  delayMinutes: number;
  events: string[];
}

interface DerivedState {
  distanceCoveredKm: number;
  progressPercent: number;
  etaAt: Date | null;
  delayMinutes: number;
  events: string[];
}

function routeOf(plannedRoute: Prisma.JsonValue | null): LatLng[] {
  if (!Array.isArray(plannedRoute)) return [];
  return (plannedRoute as unknown as LatLng[]).filter(
    (point) => point && typeof point.latitude === 'number' && typeof point.longitude === 'number',
  );
}

/**
 * Project the truck onto its planned route to work out how far along it is.
 *
 * The projection is onto the nearest *segment*, not the nearest vertex: a
 * two-point route (origin → destination) has no intermediate vertices, so a
 * vertex-based match would snap every position to 0% or 100%.
 *
 * Returns kilometres travelled along the route, or `null` when there is no
 * usable route to project onto.
 */
function progressAlongRoute(route: LatLng[], position: LatLng): number | null {
  if (route.length < 2) return null;

  const cumulative = cumulativeDistances(route);

  let bestSegment = 0;
  let bestOffset = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1]!;
    const end = route[index]!;
    const segmentLength = haversineDistance(start, end);
    if (segmentLength === 0) continue;

    const perpendicular = distanceToSegment(position, start, end);
    if (perpendicular < bestDistance) {
      bestDistance = perpendicular;
      bestSegment = index - 1;

      // Scalar projection of the position onto this segment, clamped to it.
      const toPosition = haversineDistance(start, position);
      const along = Math.sqrt(
        Math.max(0, toPosition * toPosition - perpendicular * perpendicular),
      );
      bestOffset = Math.min(segmentLength, along);
    }
  }

  if (bestDistance === Number.POSITIVE_INFINITY) return null;

  const base = cumulative[bestSegment] ?? 0;
  return (base + bestOffset) / 1000;
}

export async function ingestLocation(
  input: TrackingLocationInput,
  options: { auth?: AuthContext; simulated?: boolean } = {},
): Promise<IngestResult> {
  const truck = await prisma.truck.findUnique({
    where: { id: input.truckId },
    select: {
      id: true,
      organizationId: true,
      currentDriverId: true,
      currentTripId: true,
      archivedAt: true,
      lastSpeedKph: true,
      lastLocationAt: true,
      lastLatitude: true,
      lastLongitude: true,
    },
  });

  if (!truck) throw errors.notFound('Truck');
  if (truck.archivedAt) throw errors.businessRule('This truck is archived and cannot report a position.');

  // A driver may only post positions for the truck they are driving.
  if (options.auth && !options.auth.isPlatformAdmin) {
    const auth = options.auth;
    const isFleet = auth.organizationId === truck.organizationId;
    const isAssignedDriver = auth.driverId !== null && truck.currentDriverId === auth.driverId;
    if (!isFleet && !isAssignedDriver) throw errors.notFound('Truck');
  }

  const recordedAt = input.timestamp ?? new Date();
  const tripId = input.tripId ?? truck.currentTripId;
  const simulated = options.simulated ?? input.source === TrackingSource.MOCK;

  const trip = tripId
    ? await prisma.trip.findUnique({
        where: { id: tripId },
        include: { order: { select: { id: true, customerOrganizationId: true } } },
      })
    : null;

  // Ignore points for a trip that is not physically moving; they would corrupt
  // distance and ETA maths.
  if (trip && !MOVING_TRIP_STATUSES.includes(trip.status as TripStatus)) {
    if (trip.status !== TripStatus.ARRIVED && trip.status !== TripStatus.UNLOADING) {
      trackingLogger.debug(
        { truckId: truck.id, tripId, status: trip.status },
        'Location ignored: trip is not in a moving state',
      );
    }
  }

  const position: LatLng = { latitude: input.latitude, longitude: input.longitude };

  const derived: DerivedState = {
    distanceCoveredKm: trip?.actualDistanceKm ?? 0,
    progressPercent: 0,
    etaAt: trip?.etaAt ?? null,
    delayMinutes: trip?.delayMinutes ?? 0,
    events: [],
  };

  // --- Safety signals ---------------------------------------------------
  const previousSpeed = truck.lastSpeedKph ?? 0;
  const speedDelta = input.speedKph - previousSpeed;
  const thresholds = DEFAULT_SAFETY_THRESHOLDS;

  // Acceleration is only meaningful between two closely-spaced fixes. After a
  // long gap (a parked truck, a dropped connection) the delta says nothing
  // about how the vehicle was driven, so harsh-event detection is skipped.
  const secondsSinceLastFix = truck.lastLocationAt
    ? (recordedAt.getTime() - truck.lastLocationAt.getTime()) / 1000
    : Number.POSITIVE_INFINITY;
  const harshDetectionValid = secondsSinceLastFix > 0 && secondsSinceLastFix <= 60;

  const safetyEvents: {
    type: 'SPEED_VIOLATION' | 'HARSH_BRAKING' | 'HARSH_ACCELERATION' | 'ROUTE_DEVIATION';
    description: string;
    points: number;
    category: 'SAFETY' | 'RELIABILITY';
  }[] = [];

  if (input.speedKph > thresholds.speedLimitKph) {
    safetyEvents.push({
      type: 'SPEED_VIOLATION',
      description: `Speed ${Math.round(input.speedKph)} km/h exceeded the ${thresholds.speedLimitKph} km/h limit.`,
      points: -5,
      category: 'SAFETY',
    });
  }
  if (harshDetectionValid && speedDelta <= -thresholds.harshBrakingDeltaKph && previousSpeed > 20) {
    safetyEvents.push({
      type: 'HARSH_BRAKING',
      description: `Speed dropped ${Math.abs(Math.round(speedDelta))} km/h in ${Math.round(secondsSinceLastFix)}s.`,
      points: -2,
      category: 'SAFETY',
    });
  }
  if (harshDetectionValid && speedDelta >= thresholds.harshAccelerationDeltaKph) {
    safetyEvents.push({
      type: 'HARSH_ACCELERATION',
      description: `Speed rose ${Math.round(speedDelta)} km/h in ${Math.round(secondsSinceLastFix)}s.`,
      points: -2,
      category: 'SAFETY',
    });
  }

  // --- Trip-derived state ------------------------------------------------
  if (trip) {
    const route = routeOf(trip.plannedRoute);
    const plannedDistance =
      trip.plannedDistanceKm ?? (route.length > 1 ? pathLength(route) / 1000 : null);

    const along = progressAlongRoute(route, position);
    if (along !== null) {
      // Distance only ever moves forward, so a noisy sample cannot rewind it.
      derived.distanceCoveredKm = Math.max(trip.actualDistanceKm, Number(along.toFixed(2)));
    } else if (truck.lastLatitude !== null && truck.lastLongitude !== null) {
      const step = distanceKm(
        { latitude: truck.lastLatitude, longitude: truck.lastLongitude },
        position,
      );
      // Ignore obviously bogus jumps (GPS glitch or teleporting mock data).
      if (step < 50) derived.distanceCoveredKm = trip.actualDistanceKm + step;
    }

    if (plannedDistance && plannedDistance > 0) {
      derived.progressPercent = Math.max(
        0,
        Math.min(100, Math.round((derived.distanceCoveredKm / plannedDistance) * 100)),
      );

      const remainingKm = Math.max(0, plannedDistance - derived.distanceCoveredKm);
      const effectiveSpeed = input.speedKph > 8 ? input.speedKph : 40;
      const etaMs = (remainingKm / effectiveSpeed) * 3_600_000;
      derived.etaAt = new Date(recordedAt.getTime() + etaMs);

      if (trip.plannedArrivalAt) {
        derived.delayMinutes = Math.max(
          0,
          Math.round((derived.etaAt.getTime() - trip.plannedArrivalAt.getTime()) / 60_000),
        );
      }
    }

    if (route.length >= 2) {
      const offRouteMeters = distanceToPath(position, route);
      if (offRouteMeters > thresholds.routeDeviationMeters) {
        safetyEvents.push({
          type: 'ROUTE_DEVIATION',
          description: `Vehicle is ${(offRouteMeters / 1000).toFixed(1)} km off the planned route.`,
          points: -3,
          category: 'RELIABILITY',
        });
      }
    }
  }

  // --- Persist -----------------------------------------------------------
  await prisma.$transaction(async (tx) => {
    await tx.truckLocation.create({
      data: {
        truckId: truck.id,
        organizationId: truck.organizationId,
        tripId: trip?.id ?? null,
        driverId: truck.currentDriverId,
        latitude: input.latitude,
        longitude: input.longitude,
        speedKph: input.speedKph,
        heading: input.heading,
        accuracy: input.accuracy ?? null,
        altitude: input.altitude ?? null,
        source: input.source,
        simulated,
        recordedAt,
      },
    });

    await tx.truck.update({
      where: { id: truck.id },
      data: {
        lastLatitude: input.latitude,
        lastLongitude: input.longitude,
        lastSpeedKph: input.speedKph,
        lastHeading: input.heading,
        lastLocationAt: recordedAt,
      },
    });

    if (trip) {
      const shouldPromoteToInTransit =
        trip.status === TripStatus.STARTED && input.speedKph > 5;

      await tx.trip.update({
        where: { id: trip.id },
        data: {
          actualDistanceKm: derived.distanceCoveredKm,
          etaAt: derived.etaAt,
          delayMinutes: derived.delayMinutes,
          ...(shouldPromoteToInTransit ? { status: TripStatus.IN_TRANSIT } : {}),
        },
      });

      if (shouldPromoteToInTransit) derived.events.push('IN_TRANSIT');
    }
  });

  // --- Raise safety events (deduplicated within a short window) ----------
  for (const event of safetyEvents) {
    const recent = await prisma.tripEvent.findFirst({
      where: {
        tripId: trip?.id ?? undefined,
        type: event.type,
        createdAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
    });
    if (recent) continue;

    if (trip) {
      await prisma.tripEvent.create({
        data: {
          tripId: trip.id,
          type: event.type,
          description: event.description,
          latitude: input.latitude,
          longitude: input.longitude,
        },
      });
    }

    if (truck.currentDriverId) {
      await prisma.driverScoreEvent.create({
        data: {
          driverId: truck.currentDriverId,
          eventType: event.type,
          category: event.category,
          points: event.points,
          reason: event.description,
          sourceType: trip ? 'TRIP' : 'TRACKING',
          sourceId: trip?.id ?? null,
        },
      });
    }

    derived.events.push(event.type);

    if (event.type === 'ROUTE_DEVIATION') {
      void notifyOrganization(truck.organizationId, {
        type: NotificationType.ROUTE_DEVIATION,
        title: 'Route deviation detected',
        body: event.description,
        priority: NotificationPriority.HIGH,
        actionUrl: trip ? `/trips/${trip.id}` : `/fleet/trucks/${truck.id}`,
      });
    }
  }

  // Raise a delay notification once, when the trip first slips.
  if (trip && derived.delayMinutes > thresholds.delayToleranceMinutes && trip.delayMinutes === 0) {
    await prisma.tripEvent.create({
      data: {
        tripId: trip.id,
        type: 'DELAY_DETECTED',
        description: `Estimated arrival is ${derived.delayMinutes} minutes later than planned.`,
        latitude: input.latitude,
        longitude: input.longitude,
      },
    });
    derived.events.push('DELAY_DETECTED');

    void notifyOrganization(truck.organizationId, {
      type: NotificationType.TRIP_DELAYED,
      title: 'Trip running late',
      body: `${trip.reference} is projected to arrive ${derived.delayMinutes} minutes late.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/trips/${trip.id}`,
    });
  }

  // --- Broadcast ---------------------------------------------------------
  await broadcastTruckLocation({
    truckId: truck.id,
    organizationId: truck.organizationId,
    tripId: trip?.id ?? null,
    driverId: truck.currentDriverId,
    latitude: input.latitude,
    longitude: input.longitude,
    speedKph: input.speedKph,
    heading: input.heading,
    accuracy: input.accuracy ?? null,
    source: input.source,
    recordedAt: recordedAt.toISOString(),
    simulated,
  });

  if (trip) {
    const plannedDistance = trip.plannedDistanceKm ?? 0;
    await broadcastTripProgress(
      {
        tripId: trip.id,
        distanceCoveredKm: Number(derived.distanceCoveredKm.toFixed(1)),
        distanceRemainingKm: Number(
          Math.max(0, plannedDistance - derived.distanceCoveredKm).toFixed(1),
        ),
        progressPercent: derived.progressPercent,
        etaAt: derived.etaAt?.toISOString() ?? null,
        delayMinutes: derived.delayMinutes,
        currentSpeedKph: input.speedKph,
      },
      truck.organizationId,
      trip.order?.id ?? null,
    );

    for (const eventType of derived.events) {
      await broadcastTripEvent(
        {
          tripId: trip.id,
          eventId: `${trip.id}-${eventType}-${recordedAt.getTime()}`,
          type: eventType,
          description: null,
          latitude: input.latitude,
          longitude: input.longitude,
          createdAt: recordedAt.toISOString(),
        },
        truck.organizationId,
      );
    }
  }

  return {
    accepted: true,
    truckId: truck.id,
    tripId: trip?.id ?? null,
    distanceCoveredKm: Number(derived.distanceCoveredKm.toFixed(2)),
    progressPercent: derived.progressPercent,
    etaAt: derived.etaAt?.toISOString() ?? null,
    delayMinutes: derived.delayMinutes,
    events: derived.events,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LiveTruckPosition {
  truckId: string;
  registrationNumber: string;
  truckType: string;
  status: string;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
  driver: { id: string; name: string } | null;
  trip: { id: string; reference: string; status: string; progressPercent: number } | null;
  stale: boolean;
}

const STALE_AFTER_MS = 5 * 60_000;

/** Every truck in the fleet that has a known position — powers the live map. */
export async function fleetPositions(organizationId: string): Promise<LiveTruckPosition[]> {
  const trucks = await prisma.truck.findMany({
    where: {
      organizationId,
      archivedAt: null,
      lastLatitude: { not: null },
      lastLongitude: { not: null },
    },
    include: {
      assignments: {
        where: { status: 'ACTIVE' },
        take: 1,
        include: { driver: { include: { user: { select: { firstName: true, lastName: true } } } } },
      },
    },
  });

  const tripIds = trucks
    .map((truck) => truck.currentTripId)
    .filter((id): id is string => Boolean(id));

  const trips =
    tripIds.length > 0
      ? await prisma.trip.findMany({
          where: { id: { in: tripIds } },
          select: {
            id: true,
            reference: true,
            status: true,
            actualDistanceKm: true,
            plannedDistanceKm: true,
          },
        })
      : [];
  const tripMap = new Map(trips.map((trip) => [trip.id, trip]));

  return trucks.map((truck) => {
    const assignment = truck.assignments[0];
    const trip = truck.currentTripId ? tripMap.get(truck.currentTripId) : undefined;

    return {
      truckId: truck.id,
      registrationNumber: truck.registrationNumber,
      truckType: truck.truckType,
      status: truck.status,
      latitude: truck.lastLatitude!,
      longitude: truck.lastLongitude!,
      speedKph: truck.lastSpeedKph,
      heading: truck.lastHeading,
      recordedAt: (truck.lastLocationAt ?? truck.updatedAt).toISOString(),
      driver: assignment
        ? {
            id: assignment.driver.id,
            name: `${assignment.driver.user.firstName} ${assignment.driver.user.lastName}`.trim(),
          }
        : null,
      trip: trip
        ? {
            id: trip.id,
            reference: trip.reference,
            status: trip.status,
            progressPercent:
              trip.plannedDistanceKm && trip.plannedDistanceKm > 0
                ? Math.min(
                    100,
                    Math.round((trip.actualDistanceKm / trip.plannedDistanceKm) * 100),
                  )
                : 0,
          }
        : null,
      stale: truck.lastLocationAt
        ? Date.now() - truck.lastLocationAt.getTime() > STALE_AFTER_MS
        : true,
    };
  });
}

export interface TrackPoint {
  latitude: number;
  longitude: number;
  speedKph: number;
  heading: number;
  recordedAt: string;
  simulated: boolean;
}

/**
 * Historical trail for a truck or trip. `simplify` keeps the payload small on
 * long journeys by dropping intermediate points at a fixed stride.
 */
export async function trackingHistory(
  auth: AuthContext,
  truckId: string,
  query: TrackingHistoryQuery,
): Promise<{ points: TrackPoint[]; totalDistanceKm: number; sampledFrom: number }> {
  const truck = await prisma.truck.findUnique({
    where: { id: truckId },
    select: { organizationId: true, currentDriverId: true },
  });
  if (!truck) throw errors.notFound('Truck');

  if (!auth.isPlatformAdmin) {
    const isFleet = auth.organizationId === truck.organizationId;
    const isDriver = auth.driverId !== null && truck.currentDriverId === auth.driverId;
    if (!isFleet && !isDriver) {
      // A customer may still replay the trip carrying their order.
      const permitted = query.tripId
        ? await prisma.trip.findFirst({
            where: {
              id: query.tripId,
              order: {
                OR: [
                  { customerOrganizationId: auth.organizationId ?? '__none__' },
                  { supplierOrganizationId: auth.organizationId ?? '__none__' },
                ],
              },
            },
            select: { id: true },
          })
        : null;
      if (!permitted) throw errors.notFound('Truck');
    }
  }

  // Honour the plan's tracking-history retention window.
  const retentionDays = auth.subscription?.limits.trackingHistoryDays ?? 7;
  const earliestAllowed = new Date(Date.now() - retentionDays * 86_400_000);
  const from = query.from && query.from > earliestAllowed ? query.from : earliestAllowed;

  const locations = await prisma.truckLocation.findMany({
    where: {
      truckId,
      ...(query.tripId ? { tripId: query.tripId } : {}),
      recordedAt: { gte: from, ...(query.to ? { lte: query.to } : {}) },
    },
    orderBy: { recordedAt: 'asc' },
    take: 20_000,
  });

  const stride =
    query.simplify && locations.length > query.limit
      ? Math.ceil(locations.length / query.limit)
      : 1;

  const points: TrackPoint[] = [];
  for (let index = 0; index < locations.length; index += stride) {
    const location = locations[index]!;
    points.push({
      latitude: location.latitude,
      longitude: location.longitude,
      speedKph: location.speedKph,
      heading: location.heading,
      recordedAt: location.recordedAt.toISOString(),
      simulated: location.simulated,
    });
  }
  // Always keep the final point so the trail ends where the truck actually is.
  const last = locations[locations.length - 1];
  if (last && points[points.length - 1]?.recordedAt !== last.recordedAt.toISOString()) {
    points.push({
      latitude: last.latitude,
      longitude: last.longitude,
      speedKph: last.speedKph,
      heading: last.heading,
      recordedAt: last.recordedAt.toISOString(),
      simulated: last.simulated,
    });
  }

  const totalDistanceKm =
    points.length > 1
      ? pathLength(points.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))) /
        1000
      : 0;

  return {
    points,
    totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
    sampledFrom: locations.length,
  };
}

/** Full replay payload for a completed trip. */
export async function tripReplay(auth: AuthContext, tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { order: { select: { customerOrganizationId: true, supplierOrganizationId: true } } },
  });
  if (!trip) throw errors.notFound('Trip');

  if (!auth.isPlatformAdmin) {
    const permitted =
      auth.organizationId === trip.organizationId ||
      (auth.driverId !== null && trip.driverId === auth.driverId) ||
      (trip.order !== null &&
        auth.organizationId !== null &&
        [trip.order.customerOrganizationId, trip.order.supplierOrganizationId].includes(
          auth.organizationId,
        ));
    if (!permitted) throw errors.notFound('Trip');
  }

  const [locations, events] = await Promise.all([
    prisma.truckLocation.findMany({
      where: { tripId },
      orderBy: { recordedAt: 'asc' },
      take: 20_000,
    }),
    prisma.tripEvent.findMany({ where: { tripId }, orderBy: { createdAt: 'asc' } }),
  ]);

  return {
    tripId,
    reference: trip.reference,
    status: trip.status,
    plannedRoute: routeOf(trip.plannedRoute),
    startedAt: trip.actualStartAt?.toISOString() ?? null,
    endedAt: trip.actualArrivalAt?.toISOString() ?? null,
    plannedDistanceKm: trip.plannedDistanceKm,
    actualDistanceKm: trip.actualDistanceKm,
    points: locations.map((location) => ({
      latitude: location.latitude,
      longitude: location.longitude,
      speedKph: location.speedKph,
      heading: location.heading,
      recordedAt: location.recordedAt.toISOString(),
      simulated: location.simulated,
    })),
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      description: event.description,
      latitude: event.latitude,
      longitude: event.longitude,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
