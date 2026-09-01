import {
  ACTIVE_SOS_STATUSES,
  DeviceEventType,
  NotificationPriority,
  NotificationType,
  RealtimeEvent,
  SOS_ELIGIBLE_TRUCK_STATUSES,
  SosResponderStatus,
  SosStatus,
  type SosType,
  TripStatus,
  TruckStatus,
  boundingDeltas,
  buildPaginationMeta,
  distanceKm,
  sosStateMachine,
  type DeviceSosInput,
  type Paginated,
  type ResolveSosInput,
  type SosListQuery,
  type SosResponseInput,
  type SosUpdateInput,
  type TriggerSosInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { notify, notifyOrganization } from '../notifications/notification.service';
import { routeIncidentToAssociations } from '../associations/association-alert.service';
import { broadcastSos, broadcastSosResponderRequest } from '../../realtime/realtime.service';
import type { AuthContext } from '../../auth/context';

/**
 * SOS emergency network.
 *
 *   TRIGGERED → BROADCASTING → ACKNOWLEDGED → HELP_ASSIGNED
 *             → ASSISTANCE_ARRIVED → RESOLVED
 *
 * On trigger, the incident is persisted first (so nothing is lost if the
 * broadcast fails), then nearby eligible trucks are matched and notified in
 * expanding rings until someone responds.
 *
 * Safety note: this is a peer-assistance network. It never claims to summon
 * emergency services, and the UI always shows official emergency numbers
 * alongside it.
 */

const sosLogger = logger.child({ module: 'sos' });

/** Expanding search rings, in metres. */
export const SOS_SEARCH_RADII = [5_000, 10_000, 25_000] as const;
const MAX_RESPONDERS_PER_RING = 8;
const LOCATION_FRESHNESS_MS = 30 * 60_000;

export interface SosResponderSummary {
  id: string;
  truckId: string;
  registrationNumber: string;
  driverId: string;
  driverName: string;
  driverPhone: string | null;
  organizationId: string;
  sameFleet: boolean;
  distanceKm: number;
  status: SosResponderStatus;
  notifiedAt: string;
  acknowledgedAt: string | null;
  arrivedAt: string | null;
  note: string | null;
}

export interface SosIncidentSummary {
  id: string;
  reference: string;
  organizationId: string;
  organizationName: string | null;
  type: SosType;
  status: SosStatus;
  latitude: number;
  longitude: number;
  address: string | null;
  description: string | null;
  contactPhone: string | null;
  searchRadiusMeters: number;
  driver: { id: string; name: string; phone: string | null } | null;
  truck: { id: string; registrationNumber: string } | null;
  tripId: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  assignedAt: string | null;
  arrivedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  responderCount: number;
  acknowledgedCount: number;
  updatedAt: string;
}

const incidentInclude = {
  responders: true,
} satisfies Prisma.SosIncidentInclude;

type IncidentRecord = Prisma.SosIncidentGetPayload<{ include: typeof incidentInclude }>;

async function toSummary(incident: IncidentRecord): Promise<SosIncidentSummary> {
  const [organization, driver, truck] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: incident.organizationId },
      select: { name: true },
    }),
    incident.driverId
      ? prisma.driver.findUnique({
          where: { id: incident.driverId },
          include: { user: { select: { firstName: true, lastName: true, phone: true } } },
        })
      : Promise.resolve(null),
    incident.truckId
      ? prisma.truck.findUnique({
          where: { id: incident.truckId },
          select: { id: true, registrationNumber: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    id: incident.id,
    reference: incident.reference,
    organizationId: incident.organizationId,
    organizationName: organization?.name ?? null,
    type: incident.type,
    status: incident.status,
    latitude: incident.latitude,
    longitude: incident.longitude,
    address: incident.address,
    description: incident.description,
    contactPhone: incident.contactPhone,
    searchRadiusMeters: incident.searchRadiusMeters,
    driver: driver
      ? {
          id: driver.id,
          name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
          phone: driver.user.phone,
        }
      : null,
    truck: truck ? { id: truck.id, registrationNumber: truck.registrationNumber } : null,
    tripId: incident.tripId,
    triggeredAt: incident.triggeredAt.toISOString(),
    acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
    assignedAt: incident.assignedAt?.toISOString() ?? null,
    arrivedAt: incident.arrivedAt?.toISOString() ?? null,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    resolutionNote: incident.resolutionNote,
    responderCount: incident.responders.length,
    acknowledgedCount: incident.responders.filter((responder) =>
      ([
        SosResponderStatus.ACKNOWLEDGED,
        SosResponderStatus.ASSIGNED,
        SosResponderStatus.ARRIVED,
        SosResponderStatus.COMPLETED,
      ] as SosResponderStatus[]).includes(responder.status as SosResponderStatus),
    ).length,
    updatedAt: incident.updatedAt.toISOString(),
  };
}

async function publish(
  incident: IncidentRecord,
  event: typeof RealtimeEvent.SOS_TRIGGERED | typeof RealtimeEvent.SOS_UPDATED,
): Promise<void> {
  await broadcastSos(
    {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      driverId: incident.driverId,
      truckId: incident.truckId,
      tripId: incident.tripId,
      type: incident.type,
      status: incident.status,
      latitude: incident.latitude,
      longitude: incident.longitude,
      description: incident.description,
      triggeredAt: incident.triggeredAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
    },
    event,
  );
}

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.sosIncident.count();
  return `SOS-${year}-${String(count + 1).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Responder matching
// ---------------------------------------------------------------------------

export interface ResponderCandidate {
  truckId: string;
  driverId: string;
  organizationId: string;
  distanceKm: number;
  driverScore: number | null;
}

/**
 * Rank eligible nearby trucks for an incident.
 *
 *  1. active trucks with a recent position,
 *  2. within the current radius,
 *  3. excluding the truck in trouble and unavailable vehicles,
 *  4. ordered by distance, with driver score as the tie-breaker.
 */
export async function findResponders(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  excludeTruckId: string | null,
  alreadyNotifiedTruckIds: string[] = [],
): Promise<ResponderCandidate[]> {
  const { latDelta, lngDelta } = boundingDeltas(latitude, radiusMeters);
  const since = new Date(Date.now() - LOCATION_FRESHNESS_MS);

  const trucks = await prisma.truck.findMany({
    where: {
      archivedAt: null,
      shareLocation: true,
      status: { in: SOS_ELIGIBLE_TRUCK_STATUSES as TruckStatus[] },
      currentDriverId: { not: null },
      lastLocationAt: { gte: since },
      lastLatitude: { gte: latitude - latDelta, lte: latitude + latDelta },
      lastLongitude: { gte: longitude - lngDelta, lte: longitude + lngDelta },
      ...(excludeTruckId ? { id: { not: excludeTruckId } } : {}),
      ...(alreadyNotifiedTruckIds.length > 0 ? { id: { notIn: alreadyNotifiedTruckIds } } : {}),
    },
    select: {
      id: true,
      organizationId: true,
      currentDriverId: true,
      lastLatitude: true,
      lastLongitude: true,
    },
    take: 500,
  });

  const driverIds = trucks
    .map((truck) => truck.currentDriverId)
    .filter((id): id is string => Boolean(id));

  const drivers = await prisma.driver.findMany({
    where: { id: { in: driverIds }, archivedAt: null },
    select: { id: true, overallScore: true },
  });
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));

  const origin = { latitude, longitude };
  const radiusKm = radiusMeters / 1000;

  return trucks
    .filter((truck) => truck.currentDriverId && driverMap.has(truck.currentDriverId))
    .map((truck) => ({
      truckId: truck.id,
      driverId: truck.currentDriverId!,
      organizationId: truck.organizationId,
      distanceKm: Number(
        distanceKm(origin, {
          latitude: truck.lastLatitude!,
          longitude: truck.lastLongitude!,
        }).toFixed(2),
      ),
      driverScore: driverMap.get(truck.currentDriverId!)?.overallScore ?? null,
    }))
    .filter((candidate) => candidate.distanceKm <= radiusKm)
    .sort((a, b) => {
      if (Math.abs(a.distanceKm - b.distanceKm) > 0.5) return a.distanceKm - b.distanceKm;
      return (b.driverScore ?? 0) - (a.driverScore ?? 0);
    });
}

/** Notify the next ring of responders. Returns how many were newly alerted. */
export async function broadcastToResponders(incidentId: string): Promise<number> {
  const incident = await prisma.sosIncident.findUnique({
    where: { id: incidentId },
    include: incidentInclude,
  });
  if (!incident) return 0;
  if (!ACTIVE_SOS_STATUSES.includes(incident.status as SosStatus)) return 0;

  const alreadyNotified = incident.responders.map((responder) => responder.truckId);
  const candidates = await findResponders(
    incident.latitude,
    incident.longitude,
    incident.searchRadiusMeters,
    incident.truckId,
    alreadyNotified,
  );

  const selected = candidates.slice(0, MAX_RESPONDERS_PER_RING);
  if (selected.length === 0) return 0;

  for (const candidate of selected) {
    const responder = await prisma.sosResponder.create({
      data: {
        incidentId,
        truckId: candidate.truckId,
        driverId: candidate.driverId,
        organizationId: candidate.organizationId,
        distanceKm: candidate.distanceKm,
        status: SosResponderStatus.NOTIFIED,
      },
    });

    const driver = await prisma.driver.findUnique({
      where: { id: candidate.driverId },
      select: { userId: true },
    });

    if (driver) {
      await notify({
        userId: driver.userId,
        organizationId: candidate.organizationId,
        type: NotificationType.SOS_RESPONDER_REQUEST,
        title: `Driver needs help ${candidate.distanceKm.toFixed(1)} km away`,
        body: `${incident.type.toLowerCase().replace(/_/g, ' ')} emergency. Can you assist?`,
        priority: NotificationPriority.CRITICAL,
        actionUrl: `/driver/sos/${incidentId}`,
        data: { incidentId, distanceKm: candidate.distanceKm },
      });

      await broadcastSosResponderRequest(
        {
          incidentId,
          responderId: responder.id,
          truckId: candidate.truckId,
          driverId: candidate.driverId,
          distanceKm: candidate.distanceKm,
          incidentType: incident.type,
          latitude: incident.latitude,
          longitude: incident.longitude,
          notifiedAt: responder.notifiedAt.toISOString(),
        },
        driver.userId,
        candidate.organizationId,
      );
    }

    await prisma.sosEvent.create({
      data: {
        incidentId,
        eventType: 'RESPONDER_NOTIFIED',
        description: `Notified a truck ${candidate.distanceKm.toFixed(1)} km away.`,
        metadata: { truckId: candidate.truckId, distanceKm: candidate.distanceKm } as never,
      },
    });
  }

  sosLogger.info({ incidentId, notified: selected.length }, 'SOS responders notified');
  return selected.length;
}

/** Widen the search when nobody has responded yet. */
export async function expandSearchRadius(incidentId: string): Promise<boolean> {
  const incident = await prisma.sosIncident.findUnique({ where: { id: incidentId } });
  if (!incident) return false;

  const currentIndex = SOS_SEARCH_RADII.indexOf(
    incident.searchRadiusMeters as (typeof SOS_SEARCH_RADII)[number],
  );
  const nextRadius = SOS_SEARCH_RADII[currentIndex + 1];
  if (!nextRadius) return false;

  await prisma.sosIncident.update({
    where: { id: incidentId },
    data: { searchRadiusMeters: nextRadius },
  });
  await prisma.sosEvent.create({
    data: {
      incidentId,
      eventType: 'RADIUS_EXPANDED',
      description: `Search radius expanded to ${nextRadius / 1000} km.`,
    },
  });

  await broadcastToResponders(incidentId);
  return true;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function triggerSos(
  auth: AuthContext,
  input: TriggerSosInput,
): Promise<SosIncidentSummary> {
  // Resolve the truck/trip context from the driver when not supplied.
  let truckId = input.truckId ?? null;
  let tripId = input.tripId ?? null;
  let organizationId = auth.organizationId;

  if (auth.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: auth.driverId },
      select: { organizationId: true, currentTruckId: true },
    });
    if (driver) {
      organizationId = driver.organizationId;
      truckId ??= driver.currentTruckId;
    }
    if (!tripId && truckId) {
      const truck = await prisma.truck.findUnique({
        where: { id: truckId },
        select: { currentTripId: true },
      });
      tripId = truck?.currentTripId ?? null;
    }
  }

  if (!organizationId) {
    throw errors.organizationRequired('An SOS must be raised from within an organization.');
  }

  // Do not open a second incident for the same driver while one is live.
  if (auth.driverId) {
    const existing = await prisma.sosIncident.findFirst({
      where: { driverId: auth.driverId, status: { in: ACTIVE_SOS_STATUSES } },
    });
    if (existing) {
      const record = await prisma.sosIncident.findUniqueOrThrow({
        where: { id: existing.id },
        include: incidentInclude,
      });
      return toSummary(record);
    }
  }

  const incident = await prisma.sosIncident.create({
    data: {
      reference: await nextReference(),
      organizationId,
      driverId: auth.driverId,
      truckId,
      tripId,
      triggeredByUserId: auth.user.id,
      type: input.type,
      status: SosStatus.TRIGGERED,
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address ?? null,
      description: input.description ?? null,
      contactPhone: input.contactPhone ?? auth.user.phone,
      searchRadiusMeters: SOS_SEARCH_RADII[0],
      events: {
        create: [
          {
            eventType: 'TRIGGERED',
            description: `${input.type} emergency raised.`,
            actorUserId: auth.user.id,
          },
        ],
      },
    },
    include: incidentInclude,
  });

  return escalateIncident(incident, {
    organizationId,
    truckId,
    tripId,
    type: input.type,
    latitude: input.latitude,
    longitude: input.longitude,
    description: input.description ?? null,
  });
}

/**
 * Everything that happens once an incident exists.
 *
 * Extracted so the device path and the user path share one implementation
 * rather than two that drift. Which of them raised the alarm changes who is
 * recorded as the trigger and nothing else: the truck is flagged, the trip is
 * flagged, the fleet is notified, nearby Saarthi vehicles are searched and the
 * district associations are routed to, identically either way. An emergency
 * raised by a phone bolted to a windscreen must reach exactly the same people
 * as one raised by a driver holding it.
 */
async function escalateIncident(
  incident: IncidentRecord,
  context: {
    organizationId: string;
    truckId: string | null;
    tripId: string | null;
    type: SosType;
    latitude: number;
    longitude: number;
    description: string | null;
  },
): Promise<SosIncidentSummary> {
  const { organizationId, truckId, tripId, type: incidentType } = context;
  const input = {
    type: incidentType,
    latitude: context.latitude,
    longitude: context.longitude,
    description: context.description,
  };

  // Flag the truck and trip so the whole system reflects the emergency.
  if (truckId) {
    await prisma.truck.update({
      where: { id: truckId },
      data: { status: TruckStatus.EMERGENCY },
    });
  }
  if (tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (trip && sosStateMachine.canTransition(SosStatus.TRIGGERED, SosStatus.BROADCASTING)) {
      const canFlag = ([
        TripStatus.STARTED,
        TripStatus.IN_TRANSIT,
        TripStatus.DELAYED,
      ] as TripStatus[]).includes(trip.status as TripStatus);
      if (canFlag) {
        await prisma.trip.update({
          where: { id: tripId },
          data: { status: TripStatus.EMERGENCY },
        });
        await prisma.tripEvent.create({
          data: {
            tripId,
            type: 'EMERGENCY',
            description: `SOS raised: ${input.type}.`,
            latitude: input.latitude,
            longitude: input.longitude,
          },
        });
      }
    }
  }

  await publish(incident, RealtimeEvent.SOS_TRIGGERED);

  // Alert the fleet's managers immediately, then start the responder search.
  void notifyOrganization(organizationId, {
    type: NotificationType.SOS_TRIGGERED,
    title: `SOS — ${input.type.toLowerCase().replace(/_/g, ' ')}`,
    body: input.description ?? 'A driver in your fleet has raised an emergency.',
    priority: NotificationPriority.CRITICAL,
    actionUrl: `/sos/${incident.id}`,
    roles: ['FLEET_OWNER', 'FLEET_MANAGER', 'DISPATCHER'],
  });

  const moved = await prisma.sosIncident.update({
    where: { id: incident.id },
    data: { status: SosStatus.BROADCASTING },
    include: incidentInclude,
  });
  await prisma.sosEvent.create({
    data: {
      incidentId: incident.id,
      eventType: 'BROADCAST_STARTED',
      description: `Broadcasting to Saarthi trucks within ${SOS_SEARCH_RADII[0] / 1000} km.`,
    },
  });

  const notified = await broadcastToResponders(incident.id);
  // Nobody in the first ring — widen immediately rather than waiting.
  if (notified === 0) await expandSearchRadius(incident.id);

  // Third leg of the emergency network: the district truck associations that
  // cover this location. Fire-and-forget with its own error handling, because
  // nothing in the association path is allowed to make a driver's SOS slower
  // or less likely to succeed.
  void routeIncidentToAssociations(incident.id).catch((error) => {
    sosLogger.error(
      { err: error, incidentId: incident.id },
      'Association routing failed for this incident',
    );
  });

  const final = await prisma.sosIncident.findUniqueOrThrow({
    where: { id: incident.id },
    include: incidentInclude,
  });
  await publish(final, RealtimeEvent.SOS_UPDATED);

  void moved;
  return toSummary(final);
}

/**
 * Raise an emergency from a device.
 *
 * Section 27 of the device specification, and the parts of it that matter are
 * the ones about what the device is *not* allowed to say. It sends a position,
 * a type and some context about its own state. It does not name a vehicle, a
 * driver, an organization or a recipient — all four are resolved here from the
 * device's active assignment, because a phone that could name its own driver
 * could name somebody else's, and recipient selection is a decision about
 * people's safety that does not belong on a handset.
 *
 * The escalation that follows is byte-for-byte the same as a driver-raised SOS:
 * same fleet notification, same expanding responder search, same association
 * routing. An emergency does not become less urgent because a machine noticed
 * it instead of a person.
 */
export async function triggerSosFromDevice(
  device: {
    id: string;
    deviceIdentifier: string;
    organizationId: string;
    vehicleId: string | null;
  },
  input: DeviceSosInput,
): Promise<SosIncidentSummary> {
  if (!device.vehicleId) {
    throw errors.businessRule(
      'This device is not paired to a vehicle, so Saarthi cannot tell who to alert. Pair it before raising an emergency.',
    );
  }

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
  if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');

  const driverId = vehicle.currentDriverId;

  // One live incident per vehicle. A driver hammering the button on a phone
  // that lost signal must not open six incidents when it reconnects, and a
  // second alarm for a truck already being responded to helps nobody.
  const existing = await prisma.sosIncident.findFirst({
    where: { truckId: vehicle.id, status: { in: ACTIVE_SOS_STATUSES } },
    include: incidentInclude,
  });
  if (existing) {
    await prisma.sosEvent.create({
      data: {
        incidentId: existing.id,
        eventType: 'NOTE',
        description: `${device.deviceIdentifier} raised SOS again while this incident was still open.`,
      },
    });
    return toSummary(existing);
  }

  const contactPhone = driverId
    ? (
        await prisma.driver.findUnique({
          where: { id: driverId },
          select: { user: { select: { phone: true } } },
        })
      )?.user.phone ?? null
    : null;

  const incident = await prisma.sosIncident.create({
    data: {
      reference: await nextReference(),
      organizationId: vehicle.organizationId,
      driverId,
      truckId: vehicle.id,
      tripId: vehicle.currentTripId,
      // No user acted. Recording the driver as the trigger would be a claim
      // about who pressed the button that nobody verified.
      triggeredByUserId: null,
      triggeredByDeviceId: device.id,
      type: input.type,
      status: SosStatus.TRIGGERED,
      latitude: input.latitude,
      longitude: input.longitude,
      description: input.description ?? null,
      contactPhone,
      searchRadiusMeters: SOS_SEARCH_RADII[0],
      events: {
        create: [
          {
            eventType: 'TRIGGERED',
            description:
              `${input.type} emergency raised from ${device.deviceIdentifier}` +
              // The device's own state at the moment of the alarm. A responder
              // heading out benefits from knowing the phone is on 3% and about
              // to go dark.
              (input.batteryPercent !== null && input.batteryPercent !== undefined
                ? ` (battery ${input.batteryPercent}%`
                : '') +
              (input.networkType ? `, ${input.networkType.toLowerCase()}` : '') +
              (input.batteryPercent !== null && input.batteryPercent !== undefined
                ? ').'
                : '.'),
          },
        ],
      },
    },
    include: incidentInclude,
  });

  await prisma.deviceEvent.create({
    data: {
      deviceId: device.id,
      organizationId: device.organizationId,
      eventType: DeviceEventType.SOS_RAISED,
      description: `${input.type} emergency raised for ${vehicle.registrationNumber}.`,
      metadata: {
        incidentId: incident.id,
        latitude: input.latitude,
        longitude: input.longitude,
        cameraAvailable: input.cameraAvailable ?? null,
      },
    },
  });

  sosLogger.warn(
    {
      incidentId: incident.id,
      deviceIdentifier: device.deviceIdentifier,
      vehicleId: vehicle.id,
      type: input.type,
    },
    'SOS raised by a device',
  );

  return escalateIncident(incident, {
    organizationId: vehicle.organizationId,
    truckId: vehicle.id,
    tripId: vehicle.currentTripId,
    type: input.type,
    latitude: input.latitude,
    longitude: input.longitude,
    description: input.description ?? null,
  });
}

function assertIncidentAccess(auth: AuthContext, incident: IncidentRecord): void {
  if (auth.isPlatformAdmin) return;
  if (auth.organizationId === incident.organizationId) return;
  if (auth.driverId && incident.driverId === auth.driverId) return;
  if (
    auth.driverId &&
    incident.responders.some((responder) => responder.driverId === auth.driverId)
  ) {
    return;
  }
  if (
    auth.organizationId &&
    incident.responders.some((responder) => responder.organizationId === auth.organizationId)
  ) {
    return;
  }
  throw errors.notFound('SOS incident');
}

export async function getIncident(
  auth: AuthContext,
  incidentId: string,
): Promise<SosIncidentSummary & { responders: SosResponderSummary[]; events: unknown[] }> {
  const incident = await prisma.sosIncident.findUnique({
    where: { id: incidentId },
    include: incidentInclude,
  });
  if (!incident) throw errors.notFound('SOS incident');
  assertIncidentAccess(auth, incident);

  const [summary, events, trucks, drivers] = await Promise.all([
    toSummary(incident),
    prisma.sosEvent.findMany({ where: { incidentId }, orderBy: { createdAt: 'asc' } }),
    prisma.truck.findMany({
      where: { id: { in: incident.responders.map((responder) => responder.truckId) } },
      select: { id: true, registrationNumber: true },
    }),
    prisma.driver.findMany({
      where: { id: { in: incident.responders.map((responder) => responder.driverId) } },
      include: { user: { select: { firstName: true, lastName: true, phone: true } } },
    }),
  ]);

  const truckMap = new Map(trucks.map((truck) => [truck.id, truck]));
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));

  return {
    ...summary,
    responders: incident.responders
      .map((responder) => {
        const truck = truckMap.get(responder.truckId);
        const driver = driverMap.get(responder.driverId);
        const sameFleet = responder.organizationId === incident.organizationId;
        return {
          id: responder.id,
          truckId: responder.truckId,
          registrationNumber: truck?.registrationNumber ?? 'Unknown',
          driverId: responder.driverId,
          driverName: driver
            ? `${driver.user.firstName} ${driver.user.lastName}`.trim()
            : 'Saarthi driver',
          // The phone number is shared only once help is actually assigned.
          driverPhone:
            responder.status === SosResponderStatus.ASSIGNED ||
            responder.status === SosResponderStatus.ARRIVED ||
            responder.status === SosResponderStatus.COMPLETED
              ? (driver?.user.phone ?? null)
              : null,
          organizationId: responder.organizationId,
          sameFleet,
          distanceKm: responder.distanceKm,
          status: responder.status as SosResponderStatus,
          notifiedAt: responder.notifiedAt.toISOString(),
          acknowledgedAt: responder.acknowledgedAt?.toISOString() ?? null,
          arrivedAt: responder.arrivedAt?.toISOString() ?? null,
          note: responder.note,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      description: event.description,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function listIncidents(
  auth: AuthContext,
  query: SosListQuery,
): Promise<Paginated<SosIncidentSummary>> {
  const scope: Prisma.SosIncidentWhereInput = auth.isPlatformAdmin
    ? {}
    : {
        OR: [
          { organizationId: auth.organizationId ?? '__none__' },
          ...(auth.driverId
            ? [
                { driverId: auth.driverId },
                { responders: { some: { driverId: auth.driverId } } },
              ]
            : []),
        ],
      };

  const where: Prisma.SosIncidentWhereInput = {
    AND: [
      scope,
      {
        ...(query.status ? { status: { in: query.status as SosStatus[] } } : {}),
        ...(query.activeOnly ? { status: { in: ACTIVE_SOS_STATUSES } } : {}),
        ...(query.type ? { type: { in: query.type as SosType[] } } : {}),
        ...(query.from || query.to
          ? {
              triggeredAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
    ],
  };

  const [total, incidents] = await Promise.all([
    prisma.sosIncident.count({ where }),
    prisma.sosIncident.findMany({
      where,
      include: incidentInclude,
      orderBy: { triggeredAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: await Promise.all(incidents.map((incident) => toSummary(incident))),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function updateIncidentStatus(
  auth: AuthContext,
  incidentId: string,
  input: SosUpdateInput,
): Promise<SosIncidentSummary> {
  const incident = await prisma.sosIncident.findUnique({
    where: { id: incidentId },
    include: incidentInclude,
  });
  if (!incident) throw errors.notFound('SOS incident');
  assertIncidentAccess(auth, incident);

  const check = sosStateMachine.assertTransition(incident.status, input.status);
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const now = new Date();
  const updated = await prisma.sosIncident.update({
    where: { id: incidentId },
    data: {
      status: input.status,
      ...(input.status === SosStatus.ACKNOWLEDGED ? { acknowledgedAt: now } : {}),
      ...(input.status === SosStatus.HELP_ASSIGNED ? { assignedAt: now } : {}),
      ...(input.status === SosStatus.ASSISTANCE_ARRIVED ? { arrivedAt: now } : {}),
    },
    include: incidentInclude,
  });

  await prisma.sosEvent.create({
    data: {
      incidentId,
      eventType:
        input.status === SosStatus.HELP_ASSIGNED
          ? 'HELP_ASSIGNED'
          : input.status === SosStatus.ASSISTANCE_ARRIVED
            ? 'ASSISTANCE_ARRIVED'
            : 'NOTE',
      description: input.note ?? `Incident moved to ${input.status}.`,
      actorUserId: auth.user.id,
    },
  });

  await publish(updated, RealtimeEvent.SOS_UPDATED);
  return toSummary(updated);
}

/** A notified driver accepts, declines, arrives or completes assistance. */
export async function respondToIncident(
  auth: AuthContext,
  incidentId: string,
  input: SosResponseInput,
): Promise<SosIncidentSummary> {
  if (!auth.driverId) {
    throw errors.forbidden('Only a driver can respond to an SOS request.');
  }

  const responder = await prisma.sosResponder.findFirst({
    where: { incidentId, driverId: auth.driverId },
  });
  if (!responder) throw errors.notFound('SOS request');

  const now = new Date();
  const statusMap: Record<SosResponseInput['action'], SosResponderStatus> = {
    ACKNOWLEDGE: SosResponderStatus.ACKNOWLEDGED,
    DECLINE: SosResponderStatus.DECLINED,
    ARRIVED: SosResponderStatus.ARRIVED,
    COMPLETE: SosResponderStatus.COMPLETED,
  };

  await prisma.sosResponder.update({
    where: { id: responder.id },
    data: {
      status: statusMap[input.action],
      note: input.note ?? responder.note,
      ...(input.action === 'ACKNOWLEDGE' ? { acknowledgedAt: now } : {}),
      ...(input.action === 'DECLINE' ? { declinedAt: now } : {}),
      ...(input.action === 'ARRIVED' ? { arrivedAt: now } : {}),
      ...(input.action === 'COMPLETE' ? { completedAt: now } : {}),
    },
  });

  await prisma.sosEvent.create({
    data: {
      incidentId,
      eventType:
        input.action === 'ACKNOWLEDGE'
          ? 'RESPONDER_ACKNOWLEDGED'
          : input.action === 'DECLINE'
            ? 'RESPONDER_DECLINED'
            : input.action === 'ARRIVED'
              ? 'ASSISTANCE_ARRIVED'
              : 'NOTE',
      description: input.note ?? `Responder ${input.action.toLowerCase()}.`,
      actorUserId: auth.user.id,
    },
  });

  // Advance the incident to match the strongest responder state so far.
  const incident = await prisma.sosIncident.findUniqueOrThrow({
    where: { id: incidentId },
    include: incidentInclude,
  });

  let nextStatus: SosStatus | null = null;
  if (input.action === 'ACKNOWLEDGE' && incident.status === SosStatus.BROADCASTING) {
    nextStatus = SosStatus.ACKNOWLEDGED;
  } else if (
    input.action === 'ARRIVED' &&
    ([SosStatus.ACKNOWLEDGED, SosStatus.HELP_ASSIGNED] as SosStatus[]).includes(incident.status as SosStatus)
  ) {
    nextStatus = SosStatus.ASSISTANCE_ARRIVED;
  }

  let latest = incident;
  if (nextStatus && sosStateMachine.canTransition(incident.status, nextStatus)) {
    latest = await prisma.sosIncident.update({
      where: { id: incidentId },
      data: {
        status: nextStatus,
        ...(nextStatus === SosStatus.ACKNOWLEDGED ? { acknowledgedAt: now } : {}),
        ...(nextStatus === SosStatus.ASSISTANCE_ARRIVED ? { arrivedAt: now } : {}),
      },
      include: incidentInclude,
    });
  }

  // Completing assistance is a positive safety signal for the responder.
  if (input.action === 'COMPLETE') {
    await prisma.driverScoreEvent.create({
      data: {
        driverId: auth.driverId,
        eventType: 'SOS_ASSISTANCE_PROVIDED',
        category: 'SAFETY',
        points: 6,
        reason: 'Responded to another Saarthi driver in an emergency.',
        sourceType: 'SOS',
        sourceId: incidentId,
      },
    });
    const { recalculateDriverScore, evaluateAndAwardAchievements } = await import(
      '../drivers/driver.service'
    );
    await recalculateDriverScore(auth.driverId);
    await evaluateAndAwardAchievements(auth.driverId);
  }

  if (incident.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: incident.driverId },
      select: { userId: true },
    });
    if (driver && input.action !== 'DECLINE') {
      void notify({
        userId: driver.userId,
        organizationId: incident.organizationId,
        type: NotificationType.SOS_UPDATE,
        title:
          input.action === 'ACKNOWLEDGE'
            ? 'Help is on the way'
            : input.action === 'ARRIVED'
              ? 'Help has arrived'
              : 'Assistance completed',
        body: `A Saarthi driver ${responder.distanceKm.toFixed(1)} km away responded to your SOS.`,
        priority: NotificationPriority.CRITICAL,
        actionUrl: `/driver/sos/${incidentId}`,
      });
    }
  }

  await publish(latest, RealtimeEvent.SOS_UPDATED);
  return toSummary(latest);
}

export async function resolveIncident(
  auth: AuthContext,
  incidentId: string,
  input: ResolveSosInput,
): Promise<SosIncidentSummary> {
  const incident = await prisma.sosIncident.findUnique({
    where: { id: incidentId },
    include: incidentInclude,
  });
  if (!incident) throw errors.notFound('SOS incident');
  assertIncidentAccess(auth, incident);

  if (incident.status === SosStatus.RESOLVED) {
    throw errors.conflict('This incident is already resolved.');
  }

  const now = new Date();
  const updated = await prisma.sosIncident.update({
    where: { id: incidentId },
    data: {
      status: SosStatus.RESOLVED,
      resolvedAt: now,
      resolvedByUserId: auth.user.id,
      resolutionNote: input.resolutionNote,
    },
    include: incidentInclude,
  });

  await prisma.sosEvent.create({
    data: {
      incidentId,
      eventType: 'RESOLVED',
      description: input.resolutionNote,
      actorUserId: auth.user.id,
    },
  });

  // Return the truck and trip to normal operation.
  if (incident.truckId) {
    const truck = await prisma.truck.findUnique({ where: { id: incident.truckId } });
    if (truck?.status === TruckStatus.EMERGENCY) {
      await prisma.truck.update({
        where: { id: incident.truckId },
        data: { status: truck.currentTripId ? TruckStatus.ON_TRIP : TruckStatus.AVAILABLE },
      });
    }
  }
  if (incident.tripId) {
    const trip = await prisma.trip.findUnique({ where: { id: incident.tripId } });
    if (trip?.status === TripStatus.EMERGENCY) {
      await prisma.trip.update({
        where: { id: incident.tripId },
        data: { status: TripStatus.IN_TRANSIT },
      });
    }
  }

  await publish(updated, RealtimeEvent.SOS_UPDATED);

  void notifyOrganization(incident.organizationId, {
    type: NotificationType.SOS_RESOLVED,
    title: 'SOS resolved',
    body: `${incident.reference}: ${input.resolutionNote}`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/sos/${incidentId}`,
  });

  return toSummary(updated);
}

/** SOS requests currently awaiting this driver's response. */
export async function pendingRequestsForDriver(driverId: string) {
  const responders = await prisma.sosResponder.findMany({
    where: {
      driverId,
      status: { in: [SosResponderStatus.NOTIFIED, SosResponderStatus.ACKNOWLEDGED, SosResponderStatus.ASSIGNED] },
      incident: { status: { in: ACTIVE_SOS_STATUSES } },
    },
    include: { incident: { include: incidentInclude } },
    orderBy: { notifiedAt: 'desc' },
    take: 10,
  });

  return Promise.all(
    responders.map(async (responder) => ({
      responderId: responder.id,
      status: responder.status,
      distanceKm: responder.distanceKm,
      notifiedAt: responder.notifiedAt.toISOString(),
      incident: await toSummary(responder.incident),
    })),
  );
}
