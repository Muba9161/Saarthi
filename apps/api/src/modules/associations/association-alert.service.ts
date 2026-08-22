import {
  ASSOCIATION_ESCALATION_MINUTES,
  AlertSeverity,
  AssociationAlertEventType,
  AssociationAlertStatus,
  AssociationResponderKind,
  AssociationResponderStatus,
  MembershipStatus,
  NotificationPriority,
  NotificationType,
  OPEN_ASSOCIATION_ALERT_STATUSES,
  VerificationStatus,
  associationAlertStateMachine,
  boundingDeltas,
  buildPaginationMeta,
  distanceKm,
  severityForSosType,
  shouldRouteToAssociations,
  type AlertNoteInput,
  type AssignResponderInput,
  type AssociationAlertListQuery,
  type EscalateAlertInput,
  type Paginated,
  type ResolveAlertInput,
  type SosType,
  type UpdateResponderInput,
  type VehicleType,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { notify, notifyOrganization } from '../notifications/notification.service';
import { broadcastAssociationAlert } from '../../realtime/realtime.service';
import type { AuthContext } from '../../auth/context';

/**
 * Association emergency network.
 *
 *   driver SOS → Saarthi → owner + nearby trucks + *association network*
 *
 * The association leg is this file. It projects an incident into a
 * per-association alert, notifies the association, and runs the acknowledge →
 * respond → escalate → resolve workflow with a full audit trail.
 *
 * ## Why a projection and not a join
 *
 * Every field an association can see is *copied* onto `association_alerts` at
 * routing time. It would have been less code to let the association read
 * `sos_incidents` through a filtered query, but then privacy would depend on
 * every future query remembering to filter — and on nobody adding a revealing
 * column to the incident. Copying makes the association's view a closed set:
 * the only way to widen it is to change this file on purpose.
 *
 * ## What is deliberately absent
 *
 * No customer, no order, no cargo, no financials, no documents, no trip
 * history, no telemetry. Section 32 of the spec spells this out, and the
 * projection is how it is enforced rather than promised.
 */

const alertLogger = logger.child({ module: 'association-alerts' });

export interface AssociationAlertSummary {
  id: string;
  reference: string;
  associationId: string;
  incidentId: string;
  severity: AlertSeverity;
  status: AssociationAlertStatus;
  incidentType: SosType;
  vehicleRegistration: string | null;
  vehicleType: VehicleType | null;
  fleetName: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  district: string | null;
  state: string | null;
  description: string | null;
  /** Withheld until a named association user acknowledges the alert. */
  driverName: string | null;
  driverPhone: string | null;
  contactPhone: string | null;
  distanceKm: number | null;
  acknowledgedAt: string | null;
  respondingAt: string | null;
  escalatedAt: string | null;
  escalationReason: string | null;
  resolvedAt: string | null;
  outcome: string | null;
  assistanceProvided: boolean | null;
  /** Minutes since notification, for the queue's urgency ordering. */
  ageMinutes: number;
  /** True when an unacknowledged alert is past its escalation threshold. */
  overdue: boolean;
  responderCount: number;
  notifiedAt: string;
  updatedAt: string;
}

const alertInclude = {
  responders: true,
} satisfies Prisma.AssociationAlertInclude;

type AlertRecord = Prisma.AssociationAlertGetPayload<{ include: typeof alertInclude }>;

function isAcknowledged(status: AssociationAlertStatus): boolean {
  return status !== AssociationAlertStatus.NOTIFIED;
}

function toSummary(alert: AlertRecord): AssociationAlertSummary {
  const severity = alert.severity as AlertSeverity;
  const status = alert.status as AssociationAlertStatus;
  const ageMinutes = Math.floor((Date.now() - alert.notifiedAt.getTime()) / 60_000);
  const acknowledged = isAcknowledged(status);

  return {
    id: alert.id,
    reference: alert.reference,
    associationId: alert.associationId,
    incidentId: alert.incidentId,
    severity,
    status,
    incidentType: alert.incidentType as SosType,
    vehicleRegistration: alert.vehicleRegistration,
    vehicleType: alert.vehicleType as VehicleType | null,
    fleetName: alert.fleetName,
    latitude: alert.latitude,
    longitude: alert.longitude,
    address: alert.address,
    district: alert.district,
    state: alert.state,
    description: alert.description,
    // Personal contact details appear only once someone has taken the case.
    // Acknowledgement is an audited act by a named user, which is the
    // difference between "an association can browse driver phone numbers" and
    // "the responder who took this case can call the driver".
    driverName: acknowledged ? alert.driverName : null,
    driverPhone: acknowledged ? alert.driverPhone : null,
    contactPhone: acknowledged ? alert.contactPhone : null,
    distanceKm: alert.distanceKm,
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
    respondingAt: alert.respondingAt?.toISOString() ?? null,
    escalatedAt: alert.escalatedAt?.toISOString() ?? null,
    escalationReason: alert.escalationReason,
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    outcome: alert.outcome,
    assistanceProvided: alert.assistanceProvided,
    ageMinutes,
    overdue:
      !acknowledged &&
      OPEN_ASSOCIATION_ALERT_STATUSES.includes(status) &&
      ageMinutes >= ASSOCIATION_ESCALATION_MINUTES[severity],
    responderCount: alert.responders.length,
    notifiedAt: alert.notifiedAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  };
}

async function publish(alert: AlertRecord, created: boolean): Promise<void> {
  const profile = await prisma.associationProfile.findUnique({
    where: { id: alert.associationId },
    select: { organizationId: true },
  });
  if (!profile) return;

  const summary = toSummary(alert);
  await broadcastAssociationAlert(
    {
      alertId: alert.id,
      associationOrganizationId: profile.organizationId,
      reference: alert.reference,
      incidentType: summary.incidentType,
      severity: summary.severity,
      status: summary.status,
      vehicleRegistration: alert.vehicleRegistration,
      fleetName: alert.fleetName,
      latitude: alert.latitude,
      longitude: alert.longitude,
      district: alert.district,
      state: alert.state,
      distanceKm: alert.distanceKm,
      description: alert.description,
      triggeredAt: alert.notifiedAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    },
    created,
  );
}

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.associationAlert.count();
  return `ASN-${year}-${String(count + 1).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

interface MatchedAssociation {
  associationId: string;
  organizationId: string;
  district: string;
  state: string;
  distanceKm: number;
}

/**
 * Find verified associations whose coverage contains a point.
 *
 * A bounding box narrows the candidate set in SQL, then exact great-circle
 * distance decides — the same two-stage approach the SOS responder search uses.
 * Only VERIFIED, alert-accepting associations are considered.
 */
export async function findCoveringAssociations(
  latitude: number,
  longitude: number,
): Promise<MatchedAssociation[]> {
  // The widest radius any association may register, so the box cannot exclude a
  // legitimate match before the precise test runs.
  const { latDelta, lngDelta } = boundingDeltas(latitude, 250_000);

  const areas = await prisma.associationCoverageArea.findMany({
    where: {
      latitude: { gte: latitude - latDelta, lte: latitude + latDelta },
      longitude: { gte: longitude - lngDelta, lte: longitude + lngDelta },
      association: {
        archivedAt: null,
        acceptingAlerts: true,
        organization: { verificationStatus: VerificationStatus.VERIFIED, archivedAt: null },
      },
    },
    include: {
      association: { select: { id: true, organizationId: true } },
    },
    take: 500,
  });

  const origin = { latitude, longitude };
  const best = new Map<string, MatchedAssociation>();

  for (const area of areas) {
    const distance = distanceKm(origin, {
      latitude: area.latitude,
      longitude: area.longitude,
    });
    if (distance > area.radiusKm) continue;

    // An association may register several overlapping areas; keep its closest.
    const existing = best.get(area.association.id);
    if (existing && existing.distanceKm <= distance) continue;

    best.set(area.association.id, {
      associationId: area.association.id,
      organizationId: area.association.organizationId,
      district: area.district,
      state: area.state,
      distanceKm: Number(distance.toFixed(2)),
    });
  }

  return [...best.values()].sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Project an SOS incident to every association covering its location.
 *
 * Called from the SOS pipeline after the incident is persisted and the owner
 * notified. Failures are contained per association: one association's
 * notification blowing up must not stop the others being told, and must never
 * fail the driver's SOS.
 *
 * Returns the number of associations alerted.
 */
export async function routeIncidentToAssociations(incidentId: string): Promise<number> {
  const incident = await prisma.sosIncident.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      reference: true,
      organizationId: true,
      type: true,
      latitude: true,
      longitude: true,
      address: true,
      description: true,
      contactPhone: true,
      driverId: true,
      truckId: true,
      triggeredAt: true,
    },
  });
  if (!incident) return 0;

  const incidentType = incident.type as SosType;
  // A driver out of fuel does not need a district-wide callout. Routing every
  // minor SOS would train associations to ignore the feed, which would cost
  // lives the day a real accident arrives.
  if (!shouldRouteToAssociations(incidentType)) {
    alertLogger.debug({ incidentId, incidentType }, 'Incident type is not routed to associations');
    return 0;
  }

  const matches = await findCoveringAssociations(incident.latitude, incident.longitude);
  if (matches.length === 0) {
    alertLogger.info(
      { incidentId, latitude: incident.latitude, longitude: incident.longitude },
      'No verified association covers this location',
    );
    return 0;
  }

  // Gather the minimum the association needs, once, outside the loop.
  const [fleet, driver, vehicle] = await Promise.all([
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
          select: { registrationNumber: true, vehicleType: true },
        })
      : Promise.resolve(null),
  ]);

  const severity = severityForSosType(incidentType);
  let created = 0;

  for (const match of matches) {
    try {
      const existing = await prisma.associationAlert.findUnique({
        where: {
          associationId_incidentId: {
            associationId: match.associationId,
            incidentId: incident.id,
          },
        },
      });
      if (existing) continue;

      const alert = await prisma.associationAlert.create({
        data: {
          associationId: match.associationId,
          incidentId: incident.id,
          reference: await nextReference(),
          severity,
          status: AssociationAlertStatus.NOTIFIED,
          incidentType,
          vehicleRegistration: vehicle?.registrationNumber ?? null,
          vehicleType: vehicle?.vehicleType ?? null,
          fleetName: fleet?.name ?? null,
          latitude: incident.latitude,
          longitude: incident.longitude,
          address: incident.address,
          district: match.district,
          state: match.state,
          description: incident.description,
          driverName: driver
            ? `${driver.user.firstName} ${driver.user.lastName}`.trim()
            : null,
          driverPhone: driver?.user.phone ?? null,
          contactPhone: incident.contactPhone,
          distanceKm: match.distanceKm,
          events: {
            create: [
              {
                eventType: AssociationAlertEventType.CREATED,
                description: `${incidentType} emergency ${match.distanceKm.toFixed(1)} km from ${match.district}.`,
              },
            ],
          },
        },
        include: alertInclude,
      });

      await prisma.associationProfile.update({
        where: { id: match.associationId },
        data: { alertsReceived: { increment: 1 } },
      });

      await publish(alert, true);

      await notifyOrganization(match.organizationId, {
        type: NotificationType.ASSOCIATION_ALERT,
        title:
          severity === AlertSeverity.CRITICAL
            ? `Critical: ${incidentType.toLowerCase()} in ${match.district}`
            : `${incidentType.toLowerCase()} reported in ${match.district}`,
        body: `${vehicle?.registrationNumber ?? 'A Saarthi vehicle'} needs assistance ${match.distanceKm.toFixed(1)} km away.`,
        priority:
          severity === AlertSeverity.CRITICAL
            ? NotificationPriority.CRITICAL
            : NotificationPriority.HIGH,
        actionUrl: `/association/alerts/${alert.id}`,
        data: { alertId: alert.id, severity },
      });

      created += 1;
    } catch (error) {
      // One association failing must not deny the others their alert.
      alertLogger.error(
        { err: error, incidentId, associationId: match.associationId },
        'Association alert could not be created',
      );
    }
  }

  alertLogger.info({ incidentId, associations: created }, 'Incident routed to associations');
  return created;
}

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

/** Resolve and authorise the caller's own association. */
async function requireAssociationScope(auth: AuthContext): Promise<string> {
  if (!auth.organizationId) {
    throw errors.organizationRequired('Select your association first.');
  }
  const profile = await prisma.associationProfile.findUnique({
    where: { organizationId: auth.organizationId },
    select: { id: true },
  });
  if (!profile) throw errors.notFound('Association');
  return profile.id;
}

/**
 * Load an alert the caller is entitled to.
 *
 * Cross-association reads are reported as "not found" rather than "forbidden",
 * so an association cannot probe alert ids to learn that an incident exists
 * outside its coverage.
 */
async function loadAlert(auth: AuthContext, alertId: string): Promise<AlertRecord> {
  const alert = await prisma.associationAlert.findUnique({
    where: { id: alertId },
    include: alertInclude,
  });
  if (!alert) throw errors.notFound('Alert');

  if (auth.isPlatformAdmin) return alert;

  const associationId = await requireAssociationScope(auth);
  if (alert.associationId !== associationId) throw errors.notFound('Alert');
  return alert;
}

export async function listAlerts(
  auth: AuthContext,
  query: AssociationAlertListQuery,
): Promise<Paginated<AssociationAlertSummary>> {
  const where: Prisma.AssociationAlertWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { associationId: await requireAssociationScope(auth) }),
    ...(query.status ? { status: { in: query.status as AssociationAlertStatus[] } } : {}),
    ...(query.openOnly ? { status: { in: OPEN_ASSOCIATION_ALERT_STATUSES } } : {}),
    ...(query.severity ? { severity: { in: query.severity as AlertSeverity[] } } : {}),
    ...(query.incidentType ? { incidentType: { in: query.incidentType as SosType[] } } : {}),
    ...(query.district ? { district: { contains: query.district, mode: 'insensitive' } } : {}),
    ...(query.from || query.to
      ? {
          notifiedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, alerts] = await Promise.all([
    prisma.associationAlert.count({ where }),
    prisma.associationAlert.findMany({
      where,
      include: alertInclude,
      // Critical first, then oldest — an unattended critical alert must never
      // sit below a fresh informational one.
      orderBy: [{ severity: 'desc' }, { notifiedAt: 'asc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: alerts.map(toSummary),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export interface AssociationAlertDetail extends AssociationAlertSummary {
  responders: {
    id: string;
    kind: AssociationResponderKind;
    status: AssociationResponderStatus;
    userId: string | null;
    name: string | null;
    phone: string | null;
    organisation: string | null;
    etaMinutes: number | null;
    note: string | null;
    assignedAt: string;
    completedAt: string | null;
  }[];
  events: {
    id: string;
    eventType: AssociationAlertEventType;
    description: string | null;
    createdAt: string;
  }[];
}

export async function getAlert(
  auth: AuthContext,
  alertId: string,
): Promise<AssociationAlertDetail> {
  const alert = await loadAlert(auth, alertId);
  const events = await prisma.associationAlertEvent.findMany({
    where: { alertId },
    orderBy: { createdAt: 'asc' },
  });

  return {
    ...toSummary(alert),
    responders: alert.responders
      .map((responder) => ({
        id: responder.id,
        kind: responder.kind as AssociationResponderKind,
        status: responder.status as AssociationResponderStatus,
        userId: responder.userId,
        name: responder.name,
        phone: responder.phone,
        organisation: responder.organisation,
        etaMinutes: responder.etaMinutes,
        note: responder.note,
        assignedAt: responder.assignedAt.toISOString(),
        completedAt: responder.completedAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt)),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType as AssociationAlertEventType,
      description: event.description,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Association-side dashboard counters for its coverage area. */
export async function alertOverview(auth: AuthContext): Promise<{
  open: number;
  critical: number;
  unacknowledged: number;
  overdue: number;
  responding: number;
  resolvedToday: number;
  byType: { type: SosType; count: number }[];
  activeVehiclesInArea: number;
}> {
  const associationId = await requireAssociationScope(auth);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [open, critical, unacknowledged, responding, resolvedToday, grouped, openAlerts] =
    await Promise.all([
      prisma.associationAlert.count({
        where: { associationId, status: { in: OPEN_ASSOCIATION_ALERT_STATUSES } },
      }),
      prisma.associationAlert.count({
        where: {
          associationId,
          severity: AlertSeverity.CRITICAL,
          status: { in: OPEN_ASSOCIATION_ALERT_STATUSES },
        },
      }),
      prisma.associationAlert.count({
        where: { associationId, status: AssociationAlertStatus.NOTIFIED },
      }),
      prisma.associationAlert.count({
        where: { associationId, status: AssociationAlertStatus.RESPONDING },
      }),
      prisma.associationAlert.count({
        where: { associationId, resolvedAt: { gte: startOfDay } },
      }),
      prisma.associationAlert.groupBy({
        by: ['incidentType'],
        where: { associationId, status: { in: OPEN_ASSOCIATION_ALERT_STATUSES } },
        _count: { _all: true },
      }),
      prisma.associationAlert.findMany({
        where: { associationId, status: AssociationAlertStatus.NOTIFIED },
        select: { severity: true, notifiedAt: true },
      }),
    ]);

  const now = Date.now();
  const overdue = openAlerts.filter((alert) => {
    const minutes = (now - alert.notifiedAt.getTime()) / 60_000;
    return minutes >= ASSOCIATION_ESCALATION_MINUTES[alert.severity as AlertSeverity];
  }).length;

  // Deliberately *not* a live vehicle count. An association is not entitled to
  // watch trucks moving through its district — that would be a tracking feed
  // dressed up as a statistic. This counts only vehicles it has open alerts
  // about, which is exactly its operational concern.
  const activeVehiclesInArea = new Set(
    (
      await prisma.associationAlert.findMany({
        where: {
          associationId,
          status: { in: OPEN_ASSOCIATION_ALERT_STATUSES },
          vehicleRegistration: { not: null },
        },
        select: { vehicleRegistration: true },
      })
    ).map((alert) => alert.vehicleRegistration),
  ).size;

  return {
    open,
    critical,
    unacknowledged,
    overdue,
    responding,
    resolvedToday,
    byType: grouped.map((row) => ({
      type: row.incidentType as SosType,
      count: row._count._all,
    })),
    activeVehiclesInArea,
  };
}

// ---------------------------------------------------------------------------
// The response workflow
// ---------------------------------------------------------------------------

async function transition(
  alert: AlertRecord,
  next: AssociationAlertStatus,
  data: Prisma.AssociationAlertUpdateInput,
  event: { type: AssociationAlertEventType; description: string; actorUserId: string | null },
): Promise<AlertRecord> {
  const check = associationAlertStateMachine.assertTransition(
    alert.status as AssociationAlertStatus,
    next,
  );
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const updated = await prisma.associationAlert.update({
    where: { id: alert.id },
    data: { ...data, status: next },
    include: alertInclude,
  });

  await prisma.associationAlertEvent.create({
    data: {
      alertId: alert.id,
      eventType: event.type,
      description: event.description,
      actorUserId: event.actorUserId,
    },
  });

  await publish(updated, false);
  return updated;
}

/**
 * Acknowledge an alert.
 *
 * This is the act that unseals the driver's name and phone number, so it
 * records who did it. The driver and their fleet are told that a named
 * association has taken the case — being alone at a roadside is materially
 * different from knowing help is coordinating.
 */
export async function acknowledgeAlert(
  auth: AuthContext,
  alertId: string,
  note?: string,
): Promise<AssociationAlertSummary> {
  const alert = await loadAlert(auth, alertId);
  const now = new Date();

  const updated = await transition(
    alert,
    AssociationAlertStatus.ACKNOWLEDGED,
    { acknowledgedAt: now, acknowledgedById: auth.user.id },
    {
      type: AssociationAlertEventType.ACKNOWLEDGED,
      description: note ?? 'Association acknowledged the alert.',
      actorUserId: auth.user.id,
    },
  );

  const profile = await prisma.associationProfile.findUnique({
    where: { id: alert.associationId },
    select: { alertsAcknowledged: true, avgResponseMinutes: true, organizationId: true },
  });

  if (profile) {
    // Running mean, so the aggregate never needs a table scan to stay honest.
    const responseMinutes = (now.getTime() - alert.notifiedAt.getTime()) / 60_000;
    const count = profile.alertsAcknowledged;
    const average =
      profile.avgResponseMinutes === null
        ? responseMinutes
        : (profile.avgResponseMinutes * count + responseMinutes) / (count + 1);

    await prisma.associationProfile.update({
      where: { id: alert.associationId },
      data: {
        alertsAcknowledged: { increment: 1 },
        avgResponseMinutes: Number(average.toFixed(1)),
      },
    });
  }

  const association = await prisma.organization.findUnique({
    where: { id: profile?.organizationId ?? '' },
    select: { name: true },
  });

  // Tell the fleet that help is coordinating.
  const incident = await prisma.sosIncident.findUnique({
    where: { id: alert.incidentId },
    select: { organizationId: true, driverId: true, id: true },
  });
  if (incident) {
    void notifyOrganization(incident.organizationId, {
      type: NotificationType.SOS_UPDATE,
      title: 'A truck association is coordinating assistance',
      body: `${association?.name ?? 'A verified association'} has taken up ${alert.reference}.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/sos/${incident.id}`,
    });

    if (incident.driverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: incident.driverId },
        select: { userId: true },
      });
      if (driver) {
        void notify({
          userId: driver.userId,
          organizationId: incident.organizationId,
          type: NotificationType.SOS_UPDATE,
          title: 'Local truck association is helping',
          body: `${association?.name ?? 'A verified truck association'} in your area is coordinating assistance.`,
          priority: NotificationPriority.CRITICAL,
          actionUrl: `/driver/sos/${incident.id}`,
        });
      }
    }
  }

  return toSummary(updated);
}

/**
 * Assign someone to the scene.
 *
 * A member responder is checked against the association's active membership —
 * an association must not be able to name an arbitrary user id as its
 * responder, which would leak that the account exists.
 */
export async function assignResponder(
  auth: AuthContext,
  alertId: string,
  input: AssignResponderInput,
): Promise<AssociationAlertSummary> {
  const alert = await loadAlert(auth, alertId);

  if (alert.status === AssociationAlertStatus.NOTIFIED) {
    throw errors.businessRule('Acknowledge the alert before assigning a responder.');
  }
  if (
    alert.status === AssociationAlertStatus.RESOLVED ||
    alert.status === AssociationAlertStatus.CLOSED
  ) {
    throw errors.businessRule('This alert is already closed.');
  }

  if (input.kind === AssociationResponderKind.MEMBER) {
    const profile = await prisma.associationProfile.findUniqueOrThrow({
      where: { id: alert.associationId },
      select: { organizationId: true },
    });
    const membership = await prisma.membership.findFirst({
      where: {
        userId: input.userId!,
        organizationId: profile.organizationId,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (!membership) {
      throw errors.notFound('Association member');
    }
  }

  const responder = await prisma.associationResponder.create({
    data: {
      alertId,
      kind: input.kind,
      status: AssociationResponderStatus.ASSIGNED,
      userId: input.kind === AssociationResponderKind.MEMBER ? (input.userId ?? null) : null,
      name: input.kind === AssociationResponderKind.EXTERNAL ? (input.name ?? null) : null,
      phone: input.kind === AssociationResponderKind.EXTERNAL ? (input.phone ?? null) : null,
      organisation: input.organisation ?? null,
      etaMinutes: input.etaMinutes ?? null,
      note: input.note ?? null,
      assignedById: auth.user.id,
    },
  });

  const label =
    input.kind === AssociationResponderKind.EXTERNAL
      ? `${input.name}${input.organisation ? ` (${input.organisation})` : ''}`
      : 'an association member';

  const updated =
    alert.status === AssociationAlertStatus.RESPONDING
      ? await prisma.associationAlert.findUniqueOrThrow({
          where: { id: alertId },
          include: alertInclude,
        })
      : await transition(
          alert,
          AssociationAlertStatus.RESPONDING,
          { respondingAt: new Date() },
          {
            type: AssociationAlertEventType.RESPONDER_ASSIGNED,
            description: `Assigned ${label}${input.etaMinutes ? `, ETA ${input.etaMinutes} min` : ''}.`,
            actorUserId: auth.user.id,
          },
        );

  if (alert.status === AssociationAlertStatus.RESPONDING) {
    await prisma.associationAlertEvent.create({
      data: {
        alertId,
        eventType: AssociationAlertEventType.RESPONDER_ASSIGNED,
        description: `Assigned ${label}.`,
        actorUserId: auth.user.id,
      },
    });
  }

  // Let the driver know who is coming and when.
  const incident = await prisma.sosIncident.findUnique({
    where: { id: alert.incidentId },
    select: { id: true, driverId: true, organizationId: true },
  });
  if (incident?.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: incident.driverId },
      select: { userId: true },
    });
    if (driver) {
      void notify({
        userId: driver.userId,
        organizationId: incident.organizationId,
        type: NotificationType.SOS_UPDATE,
        title: 'Assistance assigned',
        body: input.etaMinutes
          ? `Help is on the way — estimated arrival in ${input.etaMinutes} minutes.`
          : 'A responder has been assigned to your location.',
        priority: NotificationPriority.CRITICAL,
        actionUrl: `/driver/sos/${incident.id}`,
      });
    }
  }

  void responder;
  return toSummary(updated);
}

export async function updateResponder(
  auth: AuthContext,
  alertId: string,
  responderId: string,
  input: UpdateResponderInput,
): Promise<AssociationAlertSummary> {
  const alert = await loadAlert(auth, alertId);

  const responder = await prisma.associationResponder.findFirst({
    where: { id: responderId, alertId },
  });
  if (!responder) throw errors.notFound('Responder');

  const now = new Date();
  await prisma.associationResponder.update({
    where: { id: responderId },
    data: {
      status: input.status,
      note: input.note ?? responder.note,
      ...(input.status === AssociationResponderStatus.EN_ROUTE ? { enRouteAt: now } : {}),
      ...(input.status === AssociationResponderStatus.ON_SCENE ? { onSceneAt: now } : {}),
      ...(input.status === AssociationResponderStatus.COMPLETED ? { completedAt: now } : {}),
      ...(input.status === AssociationResponderStatus.CANCELLED ? { cancelledAt: now } : {}),
    },
  });

  await prisma.associationAlertEvent.create({
    data: {
      alertId,
      eventType: AssociationAlertEventType.RESPONDER_UPDATED,
      description: input.note ?? `Responder is ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
      actorUserId: auth.user.id,
    },
  });

  const updated = await prisma.associationAlert.findUniqueOrThrow({
    where: { id: alertId },
    include: alertInclude,
  });
  await publish(updated, false);
  void alert;
  return toSummary(updated);
}

export async function addNote(
  auth: AuthContext,
  alertId: string,
  input: AlertNoteInput,
): Promise<AssociationAlertSummary> {
  const alert = await loadAlert(auth, alertId);

  await prisma.associationAlertEvent.create({
    data: {
      alertId,
      eventType: AssociationAlertEventType.NOTE_ADDED,
      description: input.note,
      actorUserId: auth.user.id,
    },
  });

  return toSummary(alert);
}

/**
 * Escalate.
 *
 * Escalation notifies Saarthi platform staff, not other associations: an
 * association that cannot handle a case should not be able to broadcast a
 * driver's details across the network on its own authority.
 */
export async function escalateAlert(
  auth: AuthContext,
  alertId: string,
  input: EscalateAlertInput,
): Promise<AssociationAlertSummary> {
  const alert = await loadAlert(auth, alertId);

  const updated = await transition(
    alert,
    AssociationAlertStatus.ESCALATED,
    { escalatedAt: new Date(), escalationReason: input.reason },
    {
      type: AssociationAlertEventType.ESCALATED,
      description: input.reason,
      actorUserId: auth.user.id,
    },
  );

  const platform = await prisma.organization.findFirst({
    where: { type: 'PLATFORM' },
    select: { id: true },
  });
  if (platform) {
    void notifyOrganization(platform.id, {
      type: NotificationType.ASSOCIATION_ALERT_ESCALATED,
      title: `Association escalated ${alert.reference}`,
      body: input.reason,
      priority: NotificationPriority.CRITICAL,
      actionUrl: `/admin/associations/alerts/${alertId}`,
    });
  }

  return toSummary(updated);
}

export async function resolveAlert(
  auth: AuthContext,
  alertId: string,
  input: ResolveAlertInput,
): Promise<AssociationAlertSummary> {
  const alert = await loadAlert(auth, alertId);

  const updated = await transition(
    alert,
    AssociationAlertStatus.RESOLVED,
    {
      resolvedAt: new Date(),
      resolvedById: auth.user.id,
      outcome: input.outcome,
      assistanceProvided: input.assistanceProvided,
    },
    {
      type: AssociationAlertEventType.RESOLVED,
      description: input.outcome,
      actorUserId: auth.user.id,
    },
  );

  await prisma.associationProfile.update({
    where: { id: alert.associationId },
    data: { alertsResolved: { increment: 1 } },
  });

  const incident = await prisma.sosIncident.findUnique({
    where: { id: alert.incidentId },
    select: { id: true, organizationId: true },
  });
  if (incident) {
    void notifyOrganization(incident.organizationId, {
      type: NotificationType.ASSOCIATION_ALERT_RESOLVED,
      title: 'Association closed its assistance case',
      body: input.outcome,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/sos/${incident.id}`,
    });
  }

  return toSummary(updated);
}

/**
 * Escalate alerts nobody has picked up.
 *
 * Run from the background sweep. Without this an alert that arrives while an
 * office is unstaffed simply sits there, and the driver waits for a response
 * that was never coming.
 */
export async function runAssociationEscalationSweep(): Promise<number> {
  const pending = await prisma.associationAlert.findMany({
    where: { status: AssociationAlertStatus.NOTIFIED },
    include: alertInclude,
    take: 200,
  });

  const now = Date.now();
  let escalated = 0;

  for (const alert of pending) {
    const threshold = ASSOCIATION_ESCALATION_MINUTES[alert.severity as AlertSeverity];
    const minutes = (now - alert.notifiedAt.getTime()) / 60_000;
    if (minutes < threshold) continue;

    try {
      await transition(
        alert,
        AssociationAlertStatus.ESCALATED,
        {
          escalatedAt: new Date(),
          escalationReason: `No acknowledgement within ${threshold} minutes.`,
        },
        {
          type: AssociationAlertEventType.ESCALATED,
          description: `Automatically escalated: unacknowledged for ${Math.floor(minutes)} minutes.`,
          actorUserId: null,
        },
      );
      escalated += 1;
    } catch (error) {
      alertLogger.error({ err: error, alertId: alert.id }, 'Automatic escalation failed');
    }
  }

  if (escalated > 0) {
    alertLogger.warn({ escalated }, 'Association alerts escalated for lack of response');
  }
  return escalated;
}
