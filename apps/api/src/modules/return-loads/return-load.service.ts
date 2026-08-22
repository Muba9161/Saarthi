import {
  NotificationPriority,
  NotificationType,
  OPEN_RETURN_LOAD_STATUSES,
  QuoteStatus,
  ReturnLoadMatchStatus,
  ReturnLoadStatus,
  buildPaginationMeta,
  emptyKilometresSaved,
  findHardBlockers,
  matchReturnLoads,
  returnLoadStateMachine,
  scoreReturnLoad,
  type CreateReturnLoadInput,
  type MatchListQuery,
  type Paginated,
  type QuoteFromMatchInput,
  type ReturnLoadDemand,
  type ReturnLoadListQuery,
  type ReturnLoadSupply,
  type TruckType,
  type UpdateReturnLoadInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { logger } from '../../lib/logger';
import { assertTenantAccess } from '../../server/guards';
import { notifyOrganization } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Return loads (backhaul).
 *
 * A truck that delivers 900 km from home and drives back empty burns the whole
 * margin on the outbound leg. This module finds a load whose pickup is near
 * where the truck becomes free and whose drop is roughly on the way home.
 *
 * The scoring itself is pure and lives in shared code, so it is unit-tested and
 * the UI can explain any ranking it shows. What happens here is the database
 * side: which orders are even candidates, and how an accepted match becomes a
 * real quote on the existing order pipeline rather than a parallel one.
 */

const returnLoadLogger = logger.child({ module: 'return-loads' });

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.returnLoadRequest.count();
  return `RL-${year}-${String(count + 1).padStart(5, '0')}`;
}

export interface ReturnLoadView {
  id: string;
  reference: string;
  organizationId: string;
  truckId: string;
  truckRegistration: string | null;
  driverId: string | null;
  outboundTripId: string | null;
  status: ReturnLoadStatus;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
  availableFrom: string;
  availableUntil: string;
  capacityTons: number;
  truckType: TruckType | null;
  detourToleranceKm: number;
  acceptsPartialLoad: boolean;
  minimumPrice: number | null;
  autoMatch: boolean;
  notes: string | null;
  matchCount: number;
  bestScore: number | null;
  matchedOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

const requestInclude = {
  truck: { select: { registrationNumber: true } },
  matches: {
    where: { status: { in: [ReturnLoadMatchStatus.SUGGESTED, ReturnLoadMatchStatus.OFFERED] } },
    select: { score: true },
  },
} satisfies Prisma.ReturnLoadRequestInclude;

type RequestRecord = Prisma.ReturnLoadRequestGetPayload<{ include: typeof requestInclude }>;

function toView(request: RequestRecord): ReturnLoadView {
  const scores = request.matches.map((match) => match.score);
  return {
    id: request.id,
    reference: request.reference,
    organizationId: request.organizationId,
    truckId: request.truckId,
    truckRegistration: request.truck?.registrationNumber ?? null,
    driverId: request.driverId,
    outboundTripId: request.outboundTripId,
    status: request.status as ReturnLoadStatus,
    originAddress: request.originAddress,
    originLatitude: request.originLatitude,
    originLongitude: request.originLongitude,
    destinationAddress: request.destinationAddress,
    destinationLatitude: request.destinationLatitude,
    destinationLongitude: request.destinationLongitude,
    availableFrom: request.availableFrom.toISOString(),
    availableUntil: request.availableUntil.toISOString(),
    capacityTons: request.capacityTons,
    truckType: request.truckType as TruckType | null,
    detourToleranceKm: request.detourToleranceKm,
    acceptsPartialLoad: request.acceptsPartialLoad,
    minimumPrice: request.minimumPrice === null ? null : Number(request.minimumPrice),
    autoMatch: request.autoMatch,
    notes: request.notes,
    matchCount: request.matches.length,
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    matchedOrderId: request.matchedOrderId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function toSupply(request: RequestRecord): ReturnLoadSupply {
  return {
    freePoint: { latitude: request.originLatitude, longitude: request.originLongitude },
    homePoint: {
      latitude: request.destinationLatitude,
      longitude: request.destinationLongitude,
    },
    availableFrom: request.availableFrom,
    availableUntil: request.availableUntil,
    capacityTons: request.capacityTons,
    truckType: request.truckType as TruckType | null,
    detourToleranceKm: request.detourToleranceKm,
    acceptsPartialLoad: request.acceptsPartialLoad,
    minimumPrice: request.minimumPrice === null ? null : Number(request.minimumPrice),
  };
}

// ---------------------------------------------------------------------------
// Candidate orders
// ---------------------------------------------------------------------------

/**
 * Orders that could plausibly be a return load.
 *
 * The pre-filter is a bounding box around the truck's free point rather than a
 * radius, because a box is indexable and the exact haversine pass happens in
 * the scorer anyway. Without it this would load every open order on the
 * platform to score a single truck.
 */
async function candidateOrders(
  request: RequestRecord,
  options: { limit?: number } = {},
): Promise<ReturnLoadDemand[]> {
  const maxPickupKm = config.returnLoads.maxPickupKm;
  const latDelta = maxPickupKm / 111.32;
  const lngDelta =
    maxPickupKm / (111.32 * Math.max(0.05, Math.cos((request.originLatitude * Math.PI) / 180)));

  const orders = await prisma.order.findMany({
    where: {
      // Only orders still looking for transport.
      status: { in: ['REQUESTED', 'QUOTED'] },
      // Never match a fleet to its own return leg twice.
      returnLoadRequestId: null,
      fleetOrganizationId: null,
      originLatitude: {
        gte: request.originLatitude - latDelta,
        lte: request.originLatitude + latDelta,
      },
      originLongitude: {
        gte: request.originLongitude - lngDelta,
        lte: request.originLongitude + lngDelta,
      },
      // A load that has to be collected after the truck leaves is not a
      // candidate; the scorer applies the precise window with its grace period.
      OR: [
        { pickupAt: null },
        { pickupAt: { lte: new Date(request.availableUntil.getTime() + 86_400_000) } },
      ],
    },
    select: {
      id: true,
      originLatitude: true,
      originLongitude: true,
      destinationLatitude: true,
      destinationLongitude: true,
      requiredCapacityTons: true,
      requiredTruckType: true,
      pickupAt: true,
      deliverBy: true,
      budget: true,
      customer: { select: { organizationId: true } },
    },
    take: options.limit ?? 300,
    orderBy: { createdAt: 'desc' },
  });

  // Customer ratings, loaded once for the whole candidate set.
  const customerOrganizationIds = orders
    .map((order) => order.customer?.organizationId)
    .filter((value): value is string => Boolean(value));

  const ratings = await prisma.orderRating.groupBy({
    by: ['fleetOrganizationId'],
    where: { fleetOrganizationId: { in: customerOrganizationIds } },
    _avg: { rating: true },
  });
  const ratingByOrganization = new Map(
    ratings.map((row) => [row.fleetOrganizationId, row._avg.rating]),
  );

  return orders.map((order) => ({
    orderId: order.id,
    origin: { latitude: order.originLatitude, longitude: order.originLongitude },
    destination: {
      latitude: order.destinationLatitude,
      longitude: order.destinationLongitude,
    },
    requiredCapacityTons: order.requiredCapacityTons,
    requiredTruckType: order.requiredTruckType as TruckType | null,
    pickupAt: order.pickupAt,
    deliverBy: order.deliverBy,
    price: order.budget === null ? null : Number(order.budget),
    customerRating: order.customer?.organizationId
      ? (ratingByOrganization.get(order.customer.organizationId) ?? null)
      : null,
  }));
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createReturnLoad(
  auth: AuthContext,
  organizationId: string,
  input: CreateReturnLoadInput,
): Promise<ReturnLoadView> {
  const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
  if (!truck) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, truck.organizationId, 'Vehicle');

  if (!truck.acceptsReturnLoads) {
    throw errors.businessRule(
      'This vehicle is set not to accept return loads. Change that on the vehicle first.',
    );
  }

  // One open request per truck: two competing requests for the same vehicle
  // would produce two sets of matches nobody can reconcile.
  const existing = await prisma.returnLoadRequest.findFirst({
    where: { truckId: input.truckId, status: { in: OPEN_RETURN_LOAD_STATUSES } },
  });
  if (existing) {
    throw errors.conflict(
      `This vehicle already has an open return-load request (${existing.reference}).`,
    );
  }

  const created = await prisma.returnLoadRequest.create({
    data: {
      reference: await nextReference(),
      organizationId,
      truckId: input.truckId,
      driverId: input.driverId ?? truck.currentDriverId ?? null,
      outboundTripId: input.outboundTripId ?? null,
      originAddress: input.originAddress,
      originLatitude: input.originLatitude,
      originLongitude: input.originLongitude,
      destinationAddress: input.destinationAddress,
      destinationLatitude: input.destinationLatitude,
      destinationLongitude: input.destinationLongitude,
      availableFrom: input.availableFrom,
      availableUntil: input.availableUntil,
      capacityTons: input.capacityTons > 0 ? input.capacityTons : truck.capacityTons,
      truckType: input.truckType ?? truck.truckType,
      detourToleranceKm: input.detourToleranceKm,
      acceptsPartialLoad: input.acceptsPartialLoad,
      minimumPrice: input.minimumPrice ?? null,
      autoMatch: input.autoMatch,
      notes: input.notes ?? null,
      createdById: auth.user.id,
    },
    include: requestInclude,
  });

  if (created.autoMatch) {
    await refreshMatches(auth, created.id, { notify: false });
    const reloaded = await prisma.returnLoadRequest.findUnique({
      where: { id: created.id },
      include: requestInclude,
    });
    if (reloaded) return toView(reloaded);
  }

  return toView(created);
}

/**
 * Open a return-load request for a trip that is about to arrive.
 *
 * Called from the trip pipeline. Idempotent, and silent when the fleet has
 * opted the vehicle out — an automation that argues with a setting is worse
 * than no automation.
 */
export async function ensureForTrip(tripId: string): Promise<ReturnLoadView | null> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return null;

  // A return leg does not itself get a return leg.
  if (trip.legType !== 'PRIMARY') return null;

  // `trips` carries `truckId` as a plain column with no Prisma relation, so the
  // vehicle is a second read rather than an include.
  const truck = await prisma.truck.findUnique({ where: { id: trip.truckId } });
  if (!truck || !truck.acceptsReturnLoads) return null;

  const existing = await prisma.returnLoadRequest.findFirst({
    where: { truckId: trip.truckId, status: { in: OPEN_RETURN_LOAD_STATUSES } },
  });
  if (existing) return null;

  // Home base falls back to the trip origin: for most operators the outbound
  // start *is* where the truck lives, and that is a better guess than nothing.
  const homeLatitude = truck.homeBaseLatitude ?? trip.originLatitude;
  const homeLongitude = truck.homeBaseLongitude ?? trip.originLongitude;
  const homeAddress = truck.homeBaseAddress ?? trip.originAddress;

  const availableFrom = trip.etaAt ?? trip.plannedArrivalAt ?? new Date();
  const availableUntil = new Date(
    availableFrom.getTime() + config.returnLoads.defaultWindowHours * 3_600_000,
  );

  const created = await prisma.returnLoadRequest.create({
    data: {
      reference: await nextReference(),
      organizationId: trip.organizationId,
      truckId: trip.truckId,
      driverId: trip.driverId,
      outboundTripId: trip.id,
      originAddress: trip.destinationAddress,
      originLatitude: trip.destinationLatitude,
      originLongitude: trip.destinationLongitude,
      destinationAddress: homeAddress,
      destinationLatitude: homeLatitude,
      destinationLongitude: homeLongitude,
      availableFrom,
      availableUntil,
      capacityTons: truck.capacityTons,
      truckType: truck.truckType,
      detourToleranceKm: 50,
      acceptsPartialLoad: true,
      autoMatch: true,
      notes: 'Opened automatically from the arriving trip.',
      createdById: trip.createdById,
    },
    include: requestInclude,
  });

  returnLoadLogger.info(
    { requestId: created.id, tripId, truckId: trip.truckId },
    'Opened a return-load request for an arriving trip',
  );

  return toView(created);
}

export async function updateReturnLoad(
  auth: AuthContext,
  id: string,
  input: UpdateReturnLoadInput,
): Promise<ReturnLoadView> {
  const request = await loadRequest(auth, id);

  if (
    request.status !== ReturnLoadStatus.OPEN &&
    request.status !== ReturnLoadStatus.MATCHED
  ) {
    throw errors.businessRule(
      `A ${request.status.toLowerCase()} return-load request can no longer be edited.`,
    );
  }

  const updated = await prisma.returnLoadRequest.update({
    where: { id },
    data: {
      ...(input.destinationAddress !== undefined
        ? { destinationAddress: input.destinationAddress }
        : {}),
      ...(input.destinationLatitude !== undefined
        ? { destinationLatitude: input.destinationLatitude }
        : {}),
      ...(input.destinationLongitude !== undefined
        ? { destinationLongitude: input.destinationLongitude }
        : {}),
      ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom } : {}),
      ...(input.availableUntil !== undefined ? { availableUntil: input.availableUntil } : {}),
      ...(input.capacityTons !== undefined ? { capacityTons: input.capacityTons } : {}),
      ...(input.truckType !== undefined ? { truckType: input.truckType } : {}),
      ...(input.detourToleranceKm !== undefined
        ? { detourToleranceKm: input.detourToleranceKm }
        : {}),
      ...(input.acceptsPartialLoad !== undefined
        ? { acceptsPartialLoad: input.acceptsPartialLoad }
        : {}),
      ...(input.minimumPrice !== undefined ? { minimumPrice: input.minimumPrice } : {}),
      ...(input.autoMatch !== undefined ? { autoMatch: input.autoMatch } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: requestInclude,
  });

  // Any change to the window, the geography or the tolerance invalidates every
  // score that was computed against the old values.
  await refreshMatches(auth, id, { notify: false });

  const reloaded = await prisma.returnLoadRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
  return toView(reloaded ?? updated);
}

export async function cancelReturnLoad(
  auth: AuthContext,
  id: string,
  reason?: string,
): Promise<ReturnLoadView> {
  const request = await loadRequest(auth, id);

  const transition = returnLoadStateMachine.assertTransition(
    request.status as ReturnLoadStatus,
    ReturnLoadStatus.CANCELLED,
  );
  if (!transition.allowed) throw errors.invalidTransition(transition.reason ?? 'Cannot cancel.');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.returnLoadMatch.updateMany({
      where: {
        returnLoadRequestId: id,
        status: { in: [ReturnLoadMatchStatus.SUGGESTED, ReturnLoadMatchStatus.OFFERED] },
      },
      data: { status: ReturnLoadMatchStatus.EXPIRED },
    });

    return tx.returnLoadRequest.update({
      where: { id },
      data: {
        status: ReturnLoadStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason ?? null,
      },
      include: requestInclude,
    });
  });

  return toView(updated);
}

async function loadRequest(auth: AuthContext, id: string): Promise<RequestRecord> {
  const request = await prisma.returnLoadRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
  if (!request) throw errors.notFound('Return-load request');
  assertTenantAccess(auth, request.organizationId, 'Return-load request');
  return request;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchView {
  id: string;
  orderId: string;
  orderReference: string;
  materialName: string;
  quantity: number;
  unit: string;
  originAddress: string;
  destinationAddress: string;
  pickupAt: string | null;
  deliverBy: string | null;
  status: ReturnLoadMatchStatus;
  score: number;
  distanceToPickupKm: number;
  detourKm: number;
  directionAlignment: number;
  capacityFitPercent: number;
  timingFitHours: number;
  estimatedRevenue: number | null;
  emptyKmSaved: number | null;
  reasons: string[];
  quoteId: string | null;
  createdAt: string;
}

/**
 * Recompute this request's matches.
 *
 * Existing SUGGESTED rows are updated in place rather than deleted and
 * recreated, so a dispatcher watching the list does not see it flicker, and a
 * match that has already been offered keeps its identity.
 */
export async function refreshMatches(
  auth: AuthContext,
  id: string,
  options: { notify?: boolean } = {},
): Promise<{ created: number; updated: number; removed: number }> {
  const request = await loadRequest(auth, id);

  if (!OPEN_RETURN_LOAD_STATUSES.includes(request.status as ReturnLoadStatus)) {
    throw errors.businessRule('Only an open return-load request can be matched.');
  }

  const demands = await candidateOrders(request);
  const { matches } = matchReturnLoads(toSupply(request), demands, {
    minScore: config.returnLoads.minScore,
    limit: 50,
  });

  const existing = await prisma.returnLoadMatch.findMany({
    where: { returnLoadRequestId: id },
  });
  const existingByOrder = new Map(existing.map((match) => [match.orderId, match]));

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  const freshOrderIds: string[] = [];

  for (const match of matches) {
    seen.add(match.orderId);
    const previous = existingByOrder.get(match.orderId);

    const data = {
      score: match.score,
      distanceToPickupKm: match.distanceToPickupKm,
      detourKm: match.detourKm,
      directionAlignment: match.directionAlignment,
      capacityFitPercent: match.capacityFitPercent,
      timingFitHours: match.timingFitHours,
      estimatedRevenue: match.estimatedRevenue,
      reasons: match.reasons,
    };

    if (previous) {
      // A match already acted on is left alone — rescoring an accepted match
      // would rewrite history.
      if (previous.status === ReturnLoadMatchStatus.SUGGESTED) {
        await prisma.returnLoadMatch.update({ where: { id: previous.id }, data });
        updated += 1;
      }
    } else {
      await prisma.returnLoadMatch.create({
        data: { returnLoadRequestId: id, orderId: match.orderId, ...data },
      });
      created += 1;
      freshOrderIds.push(match.orderId);
    }
  }

  // Suggestions that no longer qualify expire rather than vanish, so the
  // dispatcher can see that something was withdrawn.
  const stale = existing.filter(
    (match) => match.status === ReturnLoadMatchStatus.SUGGESTED && !seen.has(match.orderId),
  );
  if (stale.length > 0) {
    await prisma.returnLoadMatch.updateMany({
      where: { id: { in: stale.map((match) => match.id) } },
      data: { status: ReturnLoadMatchStatus.EXPIRED },
    });
  }

  const hasMatches = matches.length > 0;
  if (hasMatches && request.status === ReturnLoadStatus.OPEN) {
    await prisma.returnLoadRequest.update({
      where: { id },
      data: { status: ReturnLoadStatus.MATCHED },
    });
  } else if (!hasMatches && request.status === ReturnLoadStatus.MATCHED) {
    await prisma.returnLoadRequest.update({
      where: { id },
      data: { status: ReturnLoadStatus.OPEN },
    });
  }

  if (options.notify !== false && freshOrderIds.length > 0) {
    const best = matches[0]!;
    await notifyOrganization(request.organizationId, {
      type: NotificationType.RETURN_LOAD_MATCH_FOUND,
      title: `Return load found for ${request.truck?.registrationNumber ?? 'your vehicle'}`,
      body: `${freshOrderIds.length} return load${freshOrderIds.length === 1 ? '' : 's'} near ${request.originAddress}. Best match scores ${best.score} with ${Math.round(best.detourKm)} km of detour.`,
      priority: NotificationPriority.NORMAL,
      data: { returnLoadRequestId: id, matchCount: freshOrderIds.length },
    });
    await prisma.returnLoadMatch.updateMany({
      where: { returnLoadRequestId: id, orderId: { in: freshOrderIds } },
      data: { notifiedAt: new Date() },
    });
  }

  return { created, updated, removed: stale.length };
}

export async function listMatches(
  auth: AuthContext,
  id: string,
  query: MatchListQuery,
): Promise<Paginated<MatchView>> {
  const request = await loadRequest(auth, id);

  const where: Prisma.ReturnLoadMatchWhereInput = {
    returnLoadRequestId: id,
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.minScore !== undefined ? { score: { gte: query.minScore } } : {}),
  };

  const [total, matches] = await Promise.all([
    prisma.returnLoadMatch.count({ where }),
    prisma.returnLoadMatch.findMany({
      where,
      include: {
        order: {
          select: {
            reference: true,
            materialName: true,
            quantity: true,
            unit: true,
            originAddress: true,
            destinationAddress: true,
            originLatitude: true,
            originLongitude: true,
            destinationLatitude: true,
            destinationLongitude: true,
            pickupAt: true,
            deliverBy: true,
            requiredCapacityTons: true,
            requiredTruckType: true,
            budget: true,
          },
        },
      },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const supply = toSupply(request);

  return {
    items: matches.map((match) => ({
      id: match.id,
      orderId: match.orderId,
      orderReference: match.order.reference,
      materialName: match.order.materialName,
      quantity: match.order.quantity,
      unit: match.order.unit,
      originAddress: match.order.originAddress,
      destinationAddress: match.order.destinationAddress,
      pickupAt: match.order.pickupAt?.toISOString() ?? null,
      deliverBy: match.order.deliverBy?.toISOString() ?? null,
      status: match.status as ReturnLoadMatchStatus,
      score: match.score,
      distanceToPickupKm: match.distanceToPickupKm,
      detourKm: match.detourKm,
      directionAlignment: match.directionAlignment,
      capacityFitPercent: match.capacityFitPercent,
      timingFitHours: match.timingFitHours,
      estimatedRevenue: match.estimatedRevenue === null ? null : Number(match.estimatedRevenue),
      emptyKmSaved: emptyKilometresSaved(supply, {
        orderId: match.orderId,
        origin: {
          latitude: match.order.originLatitude,
          longitude: match.order.originLongitude,
        },
        destination: {
          latitude: match.order.destinationLatitude,
          longitude: match.order.destinationLongitude,
        },
        requiredCapacityTons: match.order.requiredCapacityTons,
        requiredTruckType: match.order.requiredTruckType as TruckType | null,
        pickupAt: match.order.pickupAt,
        deliverBy: match.order.deliverBy,
        price: match.order.budget === null ? null : Number(match.order.budget),
        customerRating: null,
      }),
      reasons: match.reasons,
      quoteId: match.quoteId,
      createdAt: match.createdAt.toISOString(),
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function rejectMatch(
  auth: AuthContext,
  matchId: string,
  reason?: string,
): Promise<void> {
  const match = await prisma.returnLoadMatch.findUnique({
    where: { id: matchId },
    include: { request: true },
  });
  if (!match) throw errors.notFound('Match');
  assertTenantAccess(auth, match.request.organizationId, 'Match');

  await prisma.returnLoadMatch.update({
    where: { id: matchId },
    data: {
      status: ReturnLoadMatchStatus.REJECTED,
      respondedAt: new Date(),
      rejectionReason: reason ?? null,
    },
  });
}

/**
 * Turn a match into a real quote.
 *
 * This is the join between backhaul matching and the order pipeline that
 * already exists. Nothing about acceptance, assignment or trip creation is
 * reimplemented here — the quote enters the same flow a manually-offered quote
 * does, which is why a return load produces an ordinary, fully-tracked trip.
 */
export async function quoteFromMatch(
  auth: AuthContext,
  matchId: string,
  input: QuoteFromMatchInput,
): Promise<{ quoteId: string; orderId: string; matchId: string }> {
  const match = await prisma.returnLoadMatch.findUnique({
    where: { id: matchId },
    include: { request: { include: requestInclude } },
  });
  if (!match) throw errors.notFound('Match');
  assertTenantAccess(auth, match.request.organizationId, 'Match');

  // A quote already exists for this match. Checked before the status, because
  // quoting moves a match to OFFERED — so a status-only guard would let the
  // second attempt through and fail on the order-quote unique constraint
  // instead, surfacing a database conflict rather than a clear refusal.
  if (match.quoteId !== null) {
    throw errors.businessRule(
      'A quote has already been offered for this match. Withdraw it before quoting again.',
    );
  }

  if (
    match.status !== ReturnLoadMatchStatus.SUGGESTED &&
    match.status !== ReturnLoadMatchStatus.OFFERED
  ) {
    throw errors.businessRule(
      `This match has already been ${match.status.toLowerCase()} and cannot be quoted again.`,
    );
  }

  const order = await prisma.order.findUnique({ where: { id: match.orderId } });
  if (!order) throw errors.notFound('Order');
  if (!['REQUESTED', 'QUOTED'].includes(order.status)) {
    throw errors.businessRule('That order is no longer accepting quotes.');
  }

  // Re-verify the match against current data. Between the sweep that scored it
  // and the dispatcher clicking, the truck may have been reassigned or the order
  // changed — quoting on a stale score would commit the fleet to a bad trip.
  const supply = toSupply(match.request);
  const demand: ReturnLoadDemand = {
    orderId: order.id,
    origin: { latitude: order.originLatitude, longitude: order.originLongitude },
    destination: {
      latitude: order.destinationLatitude,
      longitude: order.destinationLongitude,
    },
    requiredCapacityTons: order.requiredCapacityTons,
    requiredTruckType: order.requiredTruckType as TruckType | null,
    pickupAt: order.pickupAt,
    deliverBy: order.deliverBy,
    price: input.price,
    customerRating: null,
  };

  const blocker = findHardBlockers(supply, demand);
  if (blocker) throw errors.businessRule(`This return load no longer fits: ${blocker}`);

  const rescored = scoreReturnLoad(supply, demand);

  const result = await prisma.$transaction(async (tx) => {
    const quote = await tx.orderQuote.create({
      data: {
        orderId: order.id,
        fleetOrganizationId: match.request.organizationId,
        truckId: match.request.truckId,
        driverId: match.request.driverId,
        price: input.price,
        estimatedPickupAt: input.estimatedPickupAt ?? null,
        estimatedArrivalAt: input.estimatedArrivalAt ?? null,
        distanceToPickupKm: rescored.distanceToPickupKm,
        message:
          input.message ??
          `Return load offer — this vehicle is already returning from ${match.request.originAddress}, so only ${Math.round(rescored.detourKm)} km of detour is involved.`,
        status: QuoteStatus.OFFERED,
        expiresAt: input.expiresAt ?? null,
        createdById: auth.user.id,
      },
    });

    await tx.returnLoadMatch.update({
      where: { id: matchId },
      data: {
        status: ReturnLoadMatchStatus.OFFERED,
        quoteId: quote.id,
        respondedAt: new Date(),
        score: rescored.score,
        detourKm: rescored.detourKm,
        distanceToPickupKm: rescored.distanceToPickupKm,
        reasons: rescored.reasons,
      },
    });

    // Mark the order as a backhaul fill so the saved empty kilometres can be
    // reported later, and so analytics can tell the two apart.
    await tx.order.update({
      where: { id: order.id },
      data: { isReturnLoad: true, returnLoadRequestId: match.returnLoadRequestId },
    });

    if (order.status === 'REQUESTED') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'QUOTED' } });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'QUOTE_ADDED',
          description: 'A return-load quote was offered by a vehicle already heading this way.',
          actorUserId: auth.user.id,
        },
      });
    }

    return quote;
  });

  await notifyOrganization(order.customerOrganizationId, {
    type: NotificationType.ORDER_QUOTED,
    title: `Return-load quote on ${order.reference}`,
    body: `A vehicle already returning through ${match.request.originAddress} has quoted for this order.`,
    priority: NotificationPriority.NORMAL,
    data: { orderId: order.id, quoteId: result.id },
  });

  return { quoteId: result.id, orderId: order.id, matchId };
}

// ---------------------------------------------------------------------------
// Lists & dashboards
// ---------------------------------------------------------------------------

export async function listReturnLoads(
  auth: AuthContext,
  query: ReturnLoadListQuery,
): Promise<Paginated<ReturnLoadView>> {
  const where: Prisma.ReturnLoadRequestWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { organizationId: auth.organizationId ?? '__none__' }),
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.truckId ? { truckId: query.truckId } : {}),
    ...(query.from || query.to
      ? {
          availableFrom: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const orderBy: Prisma.ReturnLoadRequestOrderByWithRelationInput =
    query.sortBy === 'createdAt'
      ? { createdAt: query.sortOrder }
      : { availableFrom: query.sortOrder };

  const [total, requests] = await Promise.all([
    prisma.returnLoadRequest.count({ where }),
    prisma.returnLoadRequest.findMany({
      where,
      include: requestInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: requests.map(toView),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getReturnLoad(auth: AuthContext, id: string): Promise<ReturnLoadView> {
  return toView(await loadRequest(auth, id));
}

export interface EmptyRiskRow {
  tripId: string;
  tripReference: string;
  truckId: string;
  truckRegistration: string;
  driverName: string | null;
  destinationAddress: string;
  arrivingAt: string | null;
  /** Kilometres the truck would run empty getting home. */
  emptyReturnKm: number | null;
  hasReturnLoad: boolean;
  returnLoadRequestId: string | null;
  matchCount: number;
}

/**
 * Trips arriving soon with nothing lined up for the way back.
 *
 * This is the number that makes the feature worth using — a dispatcher sees the
 * empty kilometres coming before they happen rather than after.
 */
export async function emptyReturnRisk(
  auth: AuthContext,
  organizationId: string,
  horizonHours: number,
): Promise<EmptyRiskRow[]> {
  void auth;
  const horizon = new Date(Date.now() + horizonHours * 3_600_000);

  const trips = await prisma.trip.findMany({
    where: {
      organizationId,
      legType: 'PRIMARY',
      status: { in: ['STARTED', 'IN_TRANSIT', 'DELAYED', 'ARRIVED', 'UNLOADING'] },
      OR: [{ etaAt: { lte: horizon } }, { plannedArrivalAt: { lte: horizon } }],
    },
    orderBy: { etaAt: 'asc' },
    take: 100,
  });

  // `trips` holds `truckId` as a plain column with no Prisma relation, so the
  // vehicles are a second read keyed by id rather than an include.
  const trucks = await prisma.truck.findMany({
    where: { id: { in: trips.map((trip) => trip.truckId) } },
  });
  const truckById = new Map(trucks.map((truck) => [truck.id, truck]));

  const requests = await prisma.returnLoadRequest.findMany({
    where: {
      truckId: { in: trips.map((trip) => trip.truckId) },
      status: { in: OPEN_RETURN_LOAD_STATUSES },
    },
    include: {
      matches: {
        where: {
          status: { in: [ReturnLoadMatchStatus.SUGGESTED, ReturnLoadMatchStatus.OFFERED] },
        },
        select: { id: true },
      },
    },
  });
  const requestByTruck = new Map(requests.map((request) => [request.truckId, request]));

  const driverIds = trips
    .map((trip) => trip.driverId)
    .filter((value): value is string => value !== null);
  const drivers = await prisma.driver.findMany({
    where: { id: { in: driverIds } },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

  const { distanceKm } = await import('@saarthi/shared');

  return trips.map((trip) => {
    const request = requestByTruck.get(trip.truckId);
    const driver = trip.driverId ? driverById.get(trip.driverId) : null;
    const truck = truckById.get(trip.truckId);

    const homeLatitude = truck?.homeBaseLatitude ?? trip.originLatitude;
    const homeLongitude = truck?.homeBaseLongitude ?? trip.originLongitude;

    return {
      tripId: trip.id,
      tripReference: trip.reference,
      truckId: trip.truckId,
      truckRegistration: truck?.registrationNumber ?? '',
      driverName: driver ? `${driver.user.firstName} ${driver.user.lastName}`.trim() : null,
      destinationAddress: trip.destinationAddress,
      arrivingAt: (trip.etaAt ?? trip.plannedArrivalAt)?.toISOString() ?? null,
      emptyReturnKm: Math.round(
        distanceKm(
          { latitude: trip.destinationLatitude, longitude: trip.destinationLongitude },
          { latitude: homeLatitude, longitude: homeLongitude },
        ),
      ),
      hasReturnLoad: Boolean(request),
      returnLoadRequestId: request?.id ?? null,
      matchCount: request?.matches.length ?? 0,
    };
  });
}

/**
 * Open orders near the caller's soon-to-be-free trucks.
 *
 * The inverse of the per-request view: instead of "what can this truck carry",
 * it answers "where is my next return load", across the whole fleet.
 */
export async function opportunities(
  auth: AuthContext,
  organizationId: string,
  options: { horizonHours: number; minScore?: number; truckId?: string },
): Promise<Array<MatchView & { requestId: string; truckRegistration: string }>> {
  void auth;

  const requests = await prisma.returnLoadRequest.findMany({
    where: {
      organizationId,
      status: { in: OPEN_RETURN_LOAD_STATUSES },
      availableFrom: { lte: new Date(Date.now() + options.horizonHours * 3_600_000) },
      ...(options.truckId ? { truckId: options.truckId } : {}),
    },
    include: requestInclude,
    take: 50,
  });

  const results: Array<MatchView & { requestId: string; truckRegistration: string }> = [];

  for (const request of requests) {
    const demands = await candidateOrders(request, { limit: 120 });
    const { matches } = matchReturnLoads(toSupply(request), demands, {
      minScore: options.minScore ?? config.returnLoads.minScore,
      limit: 10,
    });
    if (matches.length === 0) continue;

    const orders = await prisma.order.findMany({
      where: { id: { in: matches.map((match) => match.orderId) } },
      select: {
        id: true,
        reference: true,
        materialName: true,
        quantity: true,
        unit: true,
        originAddress: true,
        destinationAddress: true,
        pickupAt: true,
        deliverBy: true,
      },
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));

    for (const match of matches) {
      const order = orderById.get(match.orderId);
      if (!order) continue;

      results.push({
        id: `${request.id}:${match.orderId}`,
        requestId: request.id,
        truckRegistration: request.truck?.registrationNumber ?? '',
        orderId: match.orderId,
        orderReference: order.reference,
        materialName: order.materialName,
        quantity: order.quantity,
        unit: order.unit,
        originAddress: order.originAddress,
        destinationAddress: order.destinationAddress,
        pickupAt: order.pickupAt?.toISOString() ?? null,
        deliverBy: order.deliverBy?.toISOString() ?? null,
        status: ReturnLoadMatchStatus.SUGGESTED,
        score: match.score,
        distanceToPickupKm: match.distanceToPickupKm,
        detourKm: match.detourKm,
        directionAlignment: match.directionAlignment,
        capacityFitPercent: match.capacityFitPercent,
        timingFitHours: match.timingFitHours,
        estimatedRevenue: match.estimatedRevenue,
        emptyKmSaved: null,
        reasons: match.reasons,
        quoteId: null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Trucks that could take a given order as their return leg.
 *
 * Used from the order screen so a dispatcher looking at a requirement can see
 * which of their own vehicles is already heading that way.
 */
export async function returnCandidatesForOrder(
  auth: AuthContext,
  orderId: string,
  options: { minScore?: number; limit: number },
): Promise<
  Array<{
    requestId: string;
    truckId: string;
    truckRegistration: string;
    score: number;
    detourKm: number;
    distanceToPickupKm: number;
    emptyKmSaved: number;
    reasons: string[];
  }>
> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw errors.notFound('Order');

  const requests = await prisma.returnLoadRequest.findMany({
    where: {
      status: { in: OPEN_RETURN_LOAD_STATUSES },
      // A fleet only sees its own vehicles here; the marketplace is where
      // cross-tenant offers happen, and this is a dispatch aid.
      ...(auth.isPlatformAdmin ? {} : { organizationId: auth.organizationId ?? '__none__' }),
    },
    include: requestInclude,
    take: 200,
  });

  const demand: ReturnLoadDemand = {
    orderId: order.id,
    origin: { latitude: order.originLatitude, longitude: order.originLongitude },
    destination: {
      latitude: order.destinationLatitude,
      longitude: order.destinationLongitude,
    },
    requiredCapacityTons: order.requiredCapacityTons,
    requiredTruckType: order.requiredTruckType as TruckType | null,
    pickupAt: order.pickupAt,
    deliverBy: order.deliverBy,
    price: order.budget === null ? null : Number(order.budget),
    customerRating: null,
  };

  const scored = requests
    .map((request) => {
      const supply = toSupply(request);
      if (findHardBlockers(supply, demand)) return null;
      const score = scoreReturnLoad(supply, demand);
      return {
        requestId: request.id,
        truckId: request.truckId,
        truckRegistration: request.truck?.registrationNumber ?? '',
        score: score.score,
        detourKm: score.detourKm,
        distanceToPickupKm: score.distanceToPickupKm,
        emptyKmSaved: emptyKilometresSaved(supply, demand),
        reasons: score.reasons,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .filter((entry) => entry.score >= (options.minScore ?? config.returnLoads.minScore))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, options.limit);
}

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

/** Recompute matches for every open request and expire stale ones. */
export async function runReturnLoadMatchSweep(): Promise<{
  refreshed: number;
  expired: number;
}> {
  const now = new Date();

  const expired = await prisma.returnLoadRequest.updateMany({
    where: {
      status: { in: OPEN_RETURN_LOAD_STATUSES },
      availableUntil: { lt: now },
    },
    data: { status: ReturnLoadStatus.EXPIRED },
  });

  const open = await prisma.returnLoadRequest.findMany({
    where: {
      status: { in: OPEN_RETURN_LOAD_STATUSES },
      autoMatch: true,
      availableUntil: { gte: now },
    },
    include: requestInclude,
    take: 200,
  });

  let refreshed = 0;
  for (const request of open) {
    try {
      // A sweep acts on behalf of the owning tenant, so it uses a synthetic
      // context scoped to exactly that organization.
      const sweepAuth = {
        isPlatformAdmin: false,
        organizationId: request.organizationId,
        user: { id: request.createdById },
        permissions: [],
      } as unknown as AuthContext;

      await refreshMatches(sweepAuth, request.id, { notify: true });
      refreshed += 1;
    } catch (error) {
      returnLoadLogger.warn(
        { err: error, requestId: request.id },
        'Return-load match refresh failed for one request',
      );
    }
  }

  if (refreshed > 0 || expired.count > 0) {
    returnLoadLogger.info(
      { refreshed, expired: expired.count },
      'Return-load match sweep finished',
    );
  }

  return { refreshed, expired: expired.count };
}
