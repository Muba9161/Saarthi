import {
  ACTIVE_REQUIREMENT_STATUSES,
  BIDDER_TYPES_BY_SCOPE,
  BID_SCOPES_BY_KIND,
  DEFAULT_BID_WINDOW_HOURS,
  LIVE_BID_STATUSES,
  NotificationPriority,
  NotificationType,
  type OrganizationType,
  REQUIREMENT_KIND_LABELS,
  RequirementBidScope,
  RequirementBidStatus,
  RequirementKind,
  RequirementStatus,
  buildPaginationMeta,
  distanceKm,
  isRequirementBiddable,
  requirementBidStateMachine,
  requirementKindsVisibleTo,
  requirementStateMachine,
  type CancelRequirementInput,
  type CreateRequirementInput,
  type Paginated,
  type PlaceBidInput,
  type RequirementBoardQuery,
  type RequirementListQuery,
  type UpdateRequirementInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { notifyOrganization } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';
import * as award from './award.service';
import {
  type RequirementBidSummary,
  type RequirementSummary,
  decorateBids,
  decorateRequirements,
  requirementInclude,
  type RequirementRecord,
} from './requirement.view';

/**
 * Requirements — the customer's single front door.
 *
 * A customer states what they need in one of four shapes (material, freight,
 * cab, tour); the businesses whose organization type qualifies them see it and
 * bid; the customer awards. Awarding is where this module hands over: it
 * builds an Order or a TravelBooking and lets the pipelines that already exist
 * carry the work to completion. See `award.service.ts` for that half.
 *
 * The rule that makes the whole thing safe is in one place — `assertCanBid`.
 * Permissions say whether a person may bid at all; the organization type says
 * whether the business they work for is in that market. Both must hold, so a
 * fleet cannot quote for cement and a supplier cannot quote for a tour.
 */

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * A requirement is visible to the customer who raised it, to any business that
 * has bid on it, and to any business that *could* bid on it while it is still
 * open. The third case is what makes the board work at all.
 */
async function assertRequirementAccess(
  auth: AuthContext,
  requirement: RequirementRecord,
): Promise<void> {
  if (auth.isPlatformAdmin) return;
  if (auth.organizationId === requirement.customerOrganizationId) return;

  if (auth.organizationId) {
    const bid = await prisma.requirementBid.findFirst({
      where: { requirementId: requirement.id, bidderOrganizationId: auth.organizationId },
      select: { id: true },
    });
    if (bid) return;

    const type = auth.organization?.type;
    if (
      type &&
      isRequirementBiddable(requirement.status as RequirementStatus) &&
      requirementKindsVisibleTo(type).includes(requirement.kind as RequirementKind)
    ) {
      return;
    }
  }

  throw errors.notFound('Requirement');
}

/** The customer who raised it, and nobody else. */
function assertOwner(auth: AuthContext, requirement: RequirementRecord): void {
  if (auth.isPlatformAdmin) return;
  if (requirement.customerOrganizationId !== auth.organizationId) {
    throw errors.forbidden('Only the customer who posted this requirement can do that.');
  }
}

/**
 * Whether this organization may answer this requirement with this scope.
 *
 * Deliberately one function rather than a guard on each route: the same three
 * questions — is the scope valid for the kind, is my business type allowed to
 * offer it, is the requirement still open — have to be asked identically when
 * placing a bid, revising one and reading the board, and answering them in
 * three places is how they drift apart.
 */
function assertCanBid(
  auth: AuthContext,
  requirement: RequirementRecord,
  scope: RequirementBidScope,
): void {
  const kind = requirement.kind as RequirementKind;

  if (!BID_SCOPES_BY_KIND[kind].includes(scope)) {
    throw errors.businessRule(
      `A ${REQUIREMENT_KIND_LABELS[kind].toLowerCase()} requirement does not take a ${scope.toLowerCase()} offer.`,
    );
  }

  // Material requirements that the customer will transport themselves must not
  // attract transport bids, or a fleet would price work that does not exist.
  if (
    kind === RequirementKind.MATERIAL_SUPPLY &&
    scope === RequirementBidScope.TRANSPORT &&
    !requirement.needsTransport
  ) {
    throw errors.businessRule(
      'This customer is arranging their own transport, so only material offers are being taken.',
    );
  }

  if (!isRequirementBiddable(requirement.status as RequirementStatus)) {
    throw errors.businessRule('This requirement is no longer taking bids.');
  }

  if (requirement.bidsCloseAt.getTime() < Date.now()) {
    throw errors.businessRule('Bidding on this requirement has closed.');
  }

  if (auth.isPlatformAdmin && !auth.organizationId) {
    throw errors.organizationRequired('Select the organization you are bidding on behalf of.');
  }

  const type = auth.organization?.type;
  if (!type) throw errors.organizationRequired();

  if (!BIDDER_TYPES_BY_SCOPE[scope].includes(type)) {
    throw errors.forbidden(
      'This kind of offer is made by a different type of Saarthi account. ' +
        'Register the appropriate account type to bid on it.',
    );
  }

  // A customer bidding on their own requirement would be able to close it at
  // any price and pollute every provider's win rate.
  if (requirement.customerOrganizationId === auth.organizationId) {
    throw errors.businessRule('You cannot bid on your own requirement.');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.requirement.count();
  return `RQ-${year}-${String(count + 1).padStart(5, '0')}`;
}

async function recordEvent(
  requirementId: string,
  type: Prisma.RequirementEventCreateInput['type'],
  description: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.requirementEvent.create({
    data: {
      requirementId,
      type,
      description,
      actorUserId,
      metadata: (metadata ?? undefined) as never,
    },
  });
}

/**
 * Re-derive the denormalised bid figures.
 *
 * Kept as a recount rather than an increment because bids are withdrawn and
 * expire as well as arrive, and a counter that only ever goes up would quietly
 * tell the customer they have offers that are no longer on the table.
 */
async function refreshBidAggregates(requirementId: string): Promise<void> {
  const live = await prisma.requirementBid.findMany({
    where: { requirementId, status: { in: LIVE_BID_STATUSES } },
    select: { price: true },
  });

  await prisma.requirement.update({
    where: { id: requirementId },
    data: {
      bidCount: live.length,
      lowestBid:
        live.length > 0
          ? live.reduce(
              (lowest, bid) => (Number(bid.price) < Number(lowest) ? bid.price : lowest),
              live[0]!.price,
            )
          : null,
    },
  });
}

/** Move the requirement's status, refusing anything the machine forbids. */
async function transition(
  requirementId: string,
  from: RequirementStatus,
  to: RequirementStatus,
  data: Prisma.RequirementUpdateInput = {},
): Promise<void> {
  if (from === to) {
    await prisma.requirement.update({ where: { id: requirementId }, data });
    return;
  }

  const result = requirementStateMachine.assertTransition(from, to);
  if (!result.allowed) throw errors.invalidTransition(result.reason ?? 'Invalid transition.');

  await prisma.requirement.update({ where: { id: requirementId }, data: { ...data, status: to } });
}

/**
 * How far a business will realistically travel for work it did not already
 * have. Beyond this the notification is noise, and noise is what makes people
 * stop reading notifications.
 */
const ANNOUNCE_RADIUS_KM = 600;

/**
 * The most businesses one requirement will notify.
 *
 * A cap rather than a fan-out to everybody who qualifies: on a national
 * platform "every supplier in the country" is thousands of rows written on the
 * request path, and the thousandth-nearest yard was never going to quote for a
 * job in Jaipur anyway. Nearest first, so the cap trims the least useful end.
 */
const ANNOUNCE_LIMIT = 100;

interface AnnounceTarget {
  organizationId: string;
  distanceKm: number | null;
}

/**
 * The businesses that should be told a requirement of this kind exists.
 *
 * Notifying by organization type is what replaces the browse-and-hope model: a
 * tour operator now hears about a customer who wants a tour, instead of waiting
 * for that customer to stumble onto its catalogue.
 *
 * Ranked by distance from the origin and capped. An organization with no
 * recorded location is still included — a new account has not set one yet, and
 * excluding it would mean it never heard about any work at all — but it sorts
 * behind everything that does.
 */
async function announceTargets(
  requirement: RequirementRecord,
  kind: RequirementKind,
): Promise<AnnounceTarget[]> {
  const scopes = BID_SCOPES_BY_KIND[kind].filter(
    (scope) =>
      !(
        kind === RequirementKind.MATERIAL_SUPPLY &&
        scope === RequirementBidScope.TRANSPORT &&
        !requirement.needsTransport
      ),
  );

  const types = [...new Set(scopes.flatMap((scope) => BIDDER_TYPES_BY_SCOPE[scope]))];

  const organizations = await prisma.organization.findMany({
    where: {
      type: { in: types as never },
      archivedAt: null,
      id: { not: requirement.customerOrganizationId },
    },
    select: { id: true, latitude: true, longitude: true },
    take: 1000,
  });

  const origin = {
    latitude: requirement.originLatitude,
    longitude: requirement.originLongitude,
  };

  return organizations
    .map((organization) => ({
      organizationId: organization.id,
      distanceKm:
        organization.latitude != null && organization.longitude != null
          ? distanceKm(origin, {
              latitude: organization.latitude,
              longitude: organization.longitude,
            })
          : null,
    }))
    .filter((target) => target.distanceKm === null || target.distanceKm <= ANNOUNCE_RADIUS_KM)
    .sort((a, b) => (a.distanceKm ?? Number.MAX_SAFE_INTEGER) - (b.distanceKm ?? Number.MAX_SAFE_INTEGER))
    .slice(0, ANNOUNCE_LIMIT);
}

/**
 * Tell the qualifying businesses that a requirement they can serve exists.
 *
 * Runs off the request path, and swallows its own failures: a customer who has
 * successfully posted a requirement must not be shown an error because a
 * notification could not be written. The requirement is on the board either
 * way, so the work is still findable.
 */
async function announce(requirement: RequirementRecord): Promise<void> {
  const kind = requirement.kind as RequirementKind;

  try {
    const targets = await announceTargets(requirement, kind);

    for (const target of targets) {
      await notifyOrganization(target.organizationId, {
        type: NotificationType.REQUIREMENT_POSTED,
        title: `New ${REQUIREMENT_KIND_LABELS[kind].toLowerCase()} requirement`,
        body: `${requirement.reference}: ${requirement.title}`,
        priority: NotificationPriority.NORMAL,
        actionUrl: `/requirements/board/${requirement.id}`,
      });
    }
  } catch (error) {
    logger.error(
      { err: error, requirementId: requirement.id },
      'Failed to announce a requirement to its bidders',
    );
  }
}

// ---------------------------------------------------------------------------
// Create / read — customer side
// ---------------------------------------------------------------------------

export async function createRequirement(
  auth: AuthContext,
  organizationId: string,
  input: CreateRequirementInput,
): Promise<RequirementSummary> {
  const customer = await prisma.customer.findUnique({ where: { organizationId } });
  if (!customer) {
    throw errors.businessRule('Only a customer organization can post a requirement.');
  }

  const material = input.materialDetail;
  const freight = input.freightDetail;
  const cab = input.cabDetail;
  const tour = input.tourDetail;

  // A referenced listing has to exist and be sellable, or the supplier board
  // would show an offer against something that was withdrawn yesterday.
  if (material?.materialId) {
    const listing = await prisma.material.findFirst({
      where: { id: material.materialId, archivedAt: null },
      select: { id: true, status: true, name: true },
    });
    if (!listing) throw errors.notFound('Material');
    if (listing.status !== 'ACTIVE') {
      throw errors.businessRule(`${listing.name} is not currently available to order.`);
    }
  }

  const distance = input.destination
    ? Number(
        distanceKm(
          { latitude: input.origin.latitude, longitude: input.origin.longitude },
          { latitude: input.destination.latitude, longitude: input.destination.longitude },
        ).toFixed(1),
      )
    : null;

  const bidsCloseAt =
    input.bidsCloseAt ?? new Date(Date.now() + DEFAULT_BID_WINDOW_HOURS * 3_600_000);

  const requirement = await prisma.requirement.create({
    data: {
      reference: await nextReference(),
      kind: input.kind,
      customerId: customer.id,
      customerOrganizationId: organizationId,
      title: input.title,
      description: input.description ?? null,

      originAddress: input.origin.addressLine,
      originLatitude: input.origin.latitude,
      originLongitude: input.origin.longitude,
      originCity: input.origin.city ?? null,
      originState: input.origin.state ?? null,

      destinationAddress: input.destination?.addressLine ?? null,
      destinationLatitude: input.destination?.latitude ?? null,
      destinationLongitude: input.destination?.longitude ?? null,
      destinationCity: input.destination?.city ?? null,
      destinationState: input.destination?.state ?? null,
      distanceKm: distance,

      startAt: input.startAt,
      endAt: input.endAt ?? null,
      scheduleNotes: input.scheduleNotes ?? null,
      budgetAmount: input.budgetAmount ?? null,
      budgetIsPublic: input.budgetIsPublic,
      bidsCloseAt,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,

      materialId: material?.materialId ?? null,
      materialName: material?.materialName ?? null,
      materialCategory: material?.category ?? null,
      specification: material?.specification ?? null,
      quantity: material?.quantity ?? freight?.quantity ?? null,
      unit: material?.unit ?? freight?.unit ?? null,
      needsTransport: material?.needsTransport ?? false,

      goodsDescription: freight?.goodsDescription ?? null,
      requiredCapacityTons: freight?.requiredCapacityTons ?? null,
      requiredTruckType: freight?.requiredTruckType ?? null,
      handlingNotes: freight?.handlingNotes ?? null,

      hireBasis: cab?.hireBasis ?? null,
      passengers: cab?.passengers ?? tour?.passengers ?? null,
      preferredVehicleType: cab?.preferredVehicleType ?? tour?.preferredVehicleType ?? null,
      durationHours: cab?.durationHours ?? null,
      durationDays: cab?.durationDays ?? tour?.durationDays ?? null,
      durationNights: tour?.durationNights ?? null,
      luggageCount: cab?.luggageCount ?? null,
      acRequired: cab?.acRequired ?? null,
      destinations: tour?.destinations ?? [],
      requiredInclusions: tour?.requiredInclusions ?? [],
      accommodationNeeded: tour?.accommodationNeeded ?? null,
      mealsNeeded: tour?.mealsNeeded ?? null,

      status: RequirementStatus.OPEN,
      createdById: auth.user.id,
    },
    include: requirementInclude,
  });

  await recordEvent(
    requirement.id,
    'CREATED',
    `${REQUIREMENT_KIND_LABELS[input.kind]} requirement posted.`,
    auth.user.id,
  );

  void announce(requirement);

  return (await decorateRequirements([requirement], auth))[0]!;
}

export async function listRequirements(
  auth: AuthContext,
  query: RequirementListQuery,
): Promise<Paginated<RequirementSummary>> {
  const where: Prisma.RequirementWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId
      ? {}
      : { customerOrganizationId: auth.organizationId ?? '__none__' }),
    ...(query.kind ? { kind: { in: query.kind as never } } : {}),
    ...(query.status ? { status: { in: query.status as never } } : {}),
    ...(query.activeOnly ? { status: { in: ACTIVE_REQUIREMENT_STATUSES as never } } : {}),
    ...(query.from || query.to
      ? {
          startAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { reference: { contains: query.search, mode: 'insensitive' as const } },
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { materialName: { contains: query.search, mode: 'insensitive' as const } },
            { goodsDescription: { contains: query.search, mode: 'insensitive' as const } },
            { originAddress: { contains: query.search, mode: 'insensitive' as const } },
            { destinationAddress: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.RequirementOrderByWithRelationInput =
    query.sortBy === 'bidCount'
      ? { bidCount: query.sortOrder }
      : query.sortBy === 'startAt'
        ? { startAt: query.sortOrder }
        : query.sortBy === 'bidsCloseAt'
          ? { bidsCloseAt: query.sortOrder }
          : { createdAt: query.sortOrder };

  const [total, rows] = await Promise.all([
    prisma.requirement.count({ where }),
    prisma.requirement.findMany({
      where,
      include: requirementInclude,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: await decorateRequirements(rows, auth),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getRequirement(
  auth: AuthContext,
  requirementId: string,
): Promise<RequirementSummary> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  await assertRequirementAccess(auth, requirement);

  return (await decorateRequirements([requirement], auth))[0]!;
}

export async function getTimeline(auth: AuthContext, requirementId: string) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  await assertRequirementAccess(auth, requirement);

  const events = await prisma.requirementEvent.findMany({
    where: { requirementId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  return events.map((event) => ({
    id: event.id,
    type: event.type,
    description: event.description,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function updateRequirement(
  auth: AuthContext,
  requirementId: string,
  input: UpdateRequirementInput,
): Promise<RequirementSummary> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  assertOwner(auth, requirement);

  if (!isRequirementBiddable(requirement.status as RequirementStatus)) {
    throw errors.businessRule('This requirement can no longer be edited.');
  }

  // Extending the window is fair; shortening it after fleets have started
  // pricing is not, so the close date can only move outwards.
  if (input.bidsCloseAt && input.bidsCloseAt < requirement.bidsCloseAt) {
    throw errors.businessRule(
      'Bidding can be extended but not cut short — bidders have already been told when it closes.',
    );
  }

  const updated = await prisma.requirement.update({
    where: { id: requirementId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.scheduleNotes !== undefined ? { scheduleNotes: input.scheduleNotes } : {}),
      ...(input.budgetAmount !== undefined ? { budgetAmount: input.budgetAmount } : {}),
      ...(input.budgetIsPublic !== undefined ? { budgetIsPublic: input.budgetIsPublic } : {}),
      ...(input.bidsCloseAt !== undefined ? { bidsCloseAt: input.bidsCloseAt } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
    },
    include: requirementInclude,
  });

  await recordEvent(requirementId, 'UPDATED', 'Customer updated the requirement.', auth.user.id);

  return (await decorateRequirements([updated], auth))[0]!;
}

export async function cancelRequirement(
  auth: AuthContext,
  requirementId: string,
  input: CancelRequirementInput,
): Promise<RequirementSummary> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  assertOwner(auth, requirement);

  const status = requirement.status as RequirementStatus;
  if (status === RequirementStatus.AWARDED) {
    throw errors.businessRule(
      'This requirement has been awarded. Cancel the order or booking it created instead.',
    );
  }

  await transition(requirementId, status, RequirementStatus.CANCELLED, {
    cancellationReason: input.reason,
    cancelledAt: new Date(),
  });

  // Everything still on the table is rejected in one write, so no bidder is
  // left watching an offer against a requirement that no longer exists.
  const live = await prisma.requirementBid.findMany({
    where: { requirementId, status: { in: LIVE_BID_STATUSES } },
    select: { id: true, bidderOrganizationId: true },
  });
  await prisma.requirementBid.updateMany({
    where: { requirementId, status: { in: LIVE_BID_STATUSES } },
    data: {
      status: RequirementBidStatus.REJECTED,
      rejectedAt: new Date(),
      rejectionReason: 'The customer withdrew the requirement.',
    },
  });

  await recordEvent(
    requirementId,
    'CANCELLED',
    `Requirement cancelled: ${input.reason}`,
    auth.user.id,
  );

  for (const bid of live) {
    void notifyOrganization(bid.bidderOrganizationId, {
      type: NotificationType.REQUIREMENT_CANCELLED,
      title: 'Requirement withdrawn',
      body: `${requirement.reference} was withdrawn by the customer.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/requirements/board`,
    });
  }

  const updated = await prisma.requirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: requirementInclude,
  });
  return (await decorateRequirements([updated], auth))[0]!;
}

// ---------------------------------------------------------------------------
// The provider board
// ---------------------------------------------------------------------------

export interface BoardRequirement extends RequirementSummary {
  distanceToOriginKm: number | null;
  /** The scopes this caller may offer against this requirement. */
  availableScopes: RequirementBidScope[];
  myBid: RequirementBidSummary | null;
}

/**
 * Open requirements this organization can bid on.
 *
 * The visible set comes from the caller's organization type, never from the
 * query: `kind` narrows what they already qualify for, so a filter cannot be
 * used to look into a market they are not in.
 */
export async function listBoard(
  auth: AuthContext,
  query: RequirementBoardQuery,
): Promise<Paginated<BoardRequirement>> {
  const type = auth.organization?.type;
  if (!type) throw errors.organizationRequired();

  const allowedKinds = requirementKindsVisibleTo(type as OrganizationType);
  if (allowedKinds.length === 0) {
    return { items: [], pagination: buildPaginationMeta(query.page, query.pageSize, 0) };
  }

  const kinds = query.kind
    ? allowedKinds.filter((kind) => (query.kind as string[]).includes(kind))
    : allowedKinds;
  if (kinds.length === 0) {
    return { items: [], pagination: buildPaginationMeta(query.page, query.pageSize, 0) };
  }

  const myScopes = new Set(
    (Object.keys(BIDDER_TYPES_BY_SCOPE) as RequirementBidScope[]).filter((scope) =>
      BIDDER_TYPES_BY_SCOPE[scope].includes(type as OrganizationType),
    ),
  );

  const where: Prisma.RequirementWhereInput = {
    kind: { in: kinds as never },
    status: { in: [RequirementStatus.OPEN, RequirementStatus.BIDDING, RequirementStatus.PARTIALLY_AWARDED] as never },
    bidsCloseAt: { gt: new Date() },
    // Never show a business its own demand.
    ...(auth.organizationId ? { customerOrganizationId: { not: auth.organizationId } } : {}),
    ...(query.startingAfter || query.startingBefore
      ? {
          startAt: {
            ...(query.startingAfter ? { gte: query.startingAfter } : {}),
            ...(query.startingBefore ? { lte: query.startingBefore } : {}),
          },
        }
      : {}),
    ...(query.minBudget !== undefined
      ? { budgetAmount: { gte: query.minBudget }, budgetIsPublic: true }
      : {}),
    ...(query.search
      ? {
          OR: [
            { reference: { contains: query.search, mode: 'insensitive' as const } },
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { materialName: { contains: query.search, mode: 'insensitive' as const } },
            { goodsDescription: { contains: query.search, mode: 'insensitive' as const } },
            { originAddress: { contains: query.search, mode: 'insensitive' as const } },
            { destinationAddress: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  // Distance ranking needs the whole candidate set in memory, so it is capped
  // rather than paged in SQL. The cap is generous against a realistic board.
  const rows = await prisma.requirement.findMany({
    where,
    include: requirementInclude,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const myBids = auth.organizationId
    ? await prisma.requirementBid.findMany({
        where: {
          bidderOrganizationId: auth.organizationId,
          requirementId: { in: rows.map((row) => row.id) },
        },
      })
    : [];
  const decoratedBids = await decorateBids(myBids);
  const bidByRequirement = new Map(decoratedBids.map((bid) => [bid.requirementId, bid]));

  const reference = await resolveBoardOrigin(auth, query);
  const summaries = await decorateRequirements(rows, auth);

  const enriched: BoardRequirement[] = summaries
    .map((summary, index) => {
      const row = rows[index]!;
      const distance = reference
        ? Number(
            distanceKm(reference, {
              latitude: summary.originLatitude,
              longitude: summary.originLongitude,
            }).toFixed(1),
          )
        : null;

      const availableScopes = BID_SCOPES_BY_KIND[row.kind as RequirementKind].filter((scope) => {
        if (!myScopes.has(scope)) return false;
        if (
          row.kind === RequirementKind.MATERIAL_SUPPLY &&
          scope === RequirementBidScope.TRANSPORT &&
          !row.needsTransport
        ) {
          return false;
        }
        // A half that is already awarded is not open for further offers.
        if (scope === RequirementBidScope.MATERIAL && row.awardedMaterialBidId) return false;
        if (scope === RequirementBidScope.TRANSPORT && row.awardedTransportBidId) return false;
        if (scope === RequirementBidScope.TRAVEL && row.awardedTravelBidId) return false;
        return true;
      });

      return {
        ...summary,
        distanceToOriginKm: distance,
        availableScopes,
        myBid: bidByRequirement.get(summary.id) ?? null,
      };
    })
    .filter((row) => {
      if (row.availableScopes.length === 0 && !row.myBid) return false;
      if (query.excludeBid && row.myBid) return false;
      if (row.distanceToOriginKm === null) return true;
      return row.distanceToOriginKm <= query.radiusKm;
    });

  enriched.sort((a, b) => {
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    if (query.sortBy === 'distance') {
      return (
        ((a.distanceToOriginKm ?? Number.POSITIVE_INFINITY) -
          (b.distanceToOriginKm ?? Number.POSITIVE_INFINITY)) *
        (query.sortOrder === 'desc' ? -1 : 1)
      );
    }
    if (query.sortBy === 'startAt') {
      return (Date.parse(a.startAt) - Date.parse(b.startAt)) * direction;
    }
    if (query.sortBy === 'bidsCloseAt') {
      return (Date.parse(a.bidsCloseAt) - Date.parse(b.bidsCloseAt)) * direction;
    }
    return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * direction;
  });

  const start = (query.page - 1) * query.pageSize;
  return {
    items: enriched.slice(start, start + query.pageSize),
    pagination: buildPaginationMeta(query.page, query.pageSize, enriched.length),
  };
}

/**
 * Where "near me" is measured from on the board.
 *
 * An explicit point wins; otherwise the most recently located vehicle, which
 * is the closest thing to where the business actually is. Falling back to the
 * registered address would rank a Jaipur fleet's Delhi lorry as far away.
 */
async function resolveBoardOrigin(
  auth: AuthContext,
  query: RequirementBoardQuery,
): Promise<{ latitude: number; longitude: number } | null> {
  if (query.nearLatitude !== undefined && query.nearLongitude !== undefined) {
    return { latitude: query.nearLatitude, longitude: query.nearLongitude };
  }
  if (!auth.organizationId) return null;

  const vehicle = await prisma.truck.findFirst({
    where: {
      organizationId: auth.organizationId,
      archivedAt: null,
      lastLatitude: { not: null },
      lastLongitude: { not: null },
    },
    orderBy: { lastLocationAt: 'desc' },
    select: { lastLatitude: true, lastLongitude: true },
  });
  if (vehicle?.lastLatitude != null && vehicle.lastLongitude != null) {
    return { latitude: vehicle.lastLatitude, longitude: vehicle.lastLongitude };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: auth.organizationId },
    select: { latitude: true, longitude: true },
  });
  if (organization?.latitude != null && organization.longitude != null) {
    return { latitude: organization.latitude, longitude: organization.longitude };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bids — provider side
// ---------------------------------------------------------------------------

export async function placeBid(
  auth: AuthContext,
  organizationId: string,
  requirementId: string,
  input: PlaceBidInput,
): Promise<RequirementBidSummary> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');

  assertCanBid(auth, requirement, input.scope);

  if (input.validUntil && input.validUntil > requirement.startAt) {
    throw errors.businessRule('A bid cannot stay valid past the date the job starts.');
  }

  let distanceToPickupKm: number | null = null;

  if (input.scope === RequirementBidScope.TRANSPORT) {
    const vehicle = await prisma.truck.findFirst({
      where: { id: input.vehicleId!, organizationId, archivedAt: null },
      select: {
        id: true,
        registrationNumber: true,
        capacityTons: true,
        lastLatitude: true,
        lastLongitude: true,
        currentDriverId: true,
      },
    });
    if (!vehicle) {
      throw errors.notFound('Vehicle', 'That vehicle is not in your fleet.');
    }
    if (
      requirement.requiredCapacityTons &&
      vehicle.capacityTons < requirement.requiredCapacityTons
    ) {
      throw errors.businessRule(
        `${vehicle.registrationNumber} carries ${vehicle.capacityTons}T; this load needs ${requirement.requiredCapacityTons}T.`,
      );
    }
    // Accepting the bid creates a trip, and a trip needs somebody to drive it.
    if (!input.driverId && !vehicle.currentDriverId) {
      throw errors.businessRule(
        'That vehicle has no driver assigned. Name a driver on the bid, or assign one to the vehicle first.',
      );
    }
    if (input.driverId) {
      const driver = await prisma.driver.findFirst({
        where: { id: input.driverId, organizationId, archivedAt: null },
        select: { id: true },
      });
      if (!driver) throw errors.notFound('Driver', 'That driver is not in your fleet.');
    }

    if (vehicle.lastLatitude != null && vehicle.lastLongitude != null) {
      distanceToPickupKm = Number(
        distanceKm(
          { latitude: vehicle.lastLatitude, longitude: vehicle.lastLongitude },
          { latitude: requirement.originLatitude, longitude: requirement.originLongitude },
        ).toFixed(1),
      );
    }
  }

  if (input.scope === RequirementBidScope.MATERIAL && input.materialId) {
    const listing = await prisma.material.findFirst({
      where: { id: input.materialId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!listing) throw errors.notFound('Material', 'That material is not one of yours.');
  }

  if (input.scope === RequirementBidScope.TRAVEL) {
    const provider = await prisma.serviceProviderProfile.findUnique({
      where: { organizationId },
      select: { status: true },
    });
    if (!provider) {
      throw errors.businessRule(
        'Complete your travel provider profile before bidding on passenger work.',
      );
    }
    if (provider.status !== 'ACTIVE') {
      throw errors.businessRule('Your provider profile is not accepting new work right now.');
    }
  }

  // A revision replaces the standing offer rather than stacking beside it, so
  // the customer never sees two live prices from the same business.
  const data = {
    price: input.price,
    priceBreakdown: input.priceBreakdown ?? null,
    message: input.message ?? null,
    validUntil: input.validUntil ?? null,
    vehicleId: input.vehicleId ?? null,
    driverId: input.driverId ?? null,
    estimatedPickupAt: input.estimatedPickupAt ?? null,
    estimatedArrivalAt: input.estimatedArrivalAt ?? null,
    distanceToPickupKm,
    materialId: input.materialId ?? null,
    includesDelivery: input.includesDelivery,
    availableQuantity: input.availableQuantity ?? null,
    leadTimeDays: input.leadTimeDays ?? null,
    offeredVehicleType: input.offeredVehicleType ?? null,
    inclusions: input.inclusions,
    exclusions: input.exclusions,
    itinerarySummary: input.itinerarySummary ?? null,
    driverIncluded: input.driverIncluded,
    fuelIncluded: input.fuelIncluded,
  };

  const existing = await prisma.requirementBid.findUnique({
    where: {
      requirementId_bidderOrganizationId_scope: {
        requirementId,
        bidderOrganizationId: organizationId,
        scope: input.scope,
      },
    },
  });

  if (existing && !LIVE_BID_STATUSES.includes(existing.status as RequirementBidStatus)) {
    throw errors.businessRule(
      existing.status === RequirementBidStatus.ACCEPTED
        ? 'Your offer has already been accepted.'
        : 'Your previous offer on this requirement is closed and cannot be revised.',
    );
  }

  const bid = await prisma.requirementBid.upsert({
    where: {
      requirementId_bidderOrganizationId_scope: {
        requirementId,
        bidderOrganizationId: organizationId,
        scope: input.scope,
      },
    },
    create: {
      requirementId,
      scope: input.scope,
      bidderOrganizationId: organizationId,
      createdById: auth.user.id,
      ...data,
    },
    // Revising drops a shortlist back to OFFERED: the customer shortlisted a
    // price that no longer stands, so the signal has to be re-earned.
    update: { ...data, status: RequirementBidStatus.OFFERED, shortlistedAt: null },
  });

  await refreshBidAggregates(requirementId);

  if (requirement.status === RequirementStatus.OPEN) {
    await transition(requirementId, RequirementStatus.OPEN, RequirementStatus.BIDDING);
  }

  const bidder = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  await recordEvent(
    requirementId,
    existing ? 'BID_UPDATED' : 'BID_PLACED',
    `${bidder?.name ?? 'A business'} ${existing ? 'revised its' : 'placed a'} ${input.scope.toLowerCase()} offer.`,
    auth.user.id,
    { bidId: bid.id, price: Number(bid.price), scope: input.scope },
  );

  if (!existing) {
    void notifyOrganization(requirement.customerOrganizationId, {
      type: NotificationType.REQUIREMENT_BID_RECEIVED,
      title: 'New bid received',
      body: `${bidder?.name ?? 'A business'} bid on ${requirement.reference}.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/requirements/${requirementId}`,
    });
  }

  return (await decorateBids([bid]))[0]!;
}

export async function withdrawBid(
  auth: AuthContext,
  organizationId: string,
  bidId: string,
): Promise<void> {
  const bid = await prisma.requirementBid.findUnique({ where: { id: bidId } });
  if (!bid) throw errors.notFound('Bid');
  if (!auth.isPlatformAdmin && bid.bidderOrganizationId !== organizationId) {
    throw errors.notFound('Bid');
  }

  const result = requirementBidStateMachine.assertTransition(
    bid.status as RequirementBidStatus,
    RequirementBidStatus.WITHDRAWN,
  );
  if (!result.allowed) {
    throw errors.invalidTransition(
      bid.status === RequirementBidStatus.ACCEPTED
        ? 'This offer has been accepted and can no longer be withdrawn.'
        : (result.reason ?? 'This offer can no longer be withdrawn.'),
    );
  }

  await prisma.requirementBid.update({
    where: { id: bidId },
    data: { status: RequirementBidStatus.WITHDRAWN, withdrawnAt: new Date() },
  });
  await refreshBidAggregates(bid.requirementId);

  const bidder = await prisma.organization.findUnique({
    where: { id: bid.bidderOrganizationId },
    select: { name: true },
  });
  await recordEvent(
    bid.requirementId,
    'BID_WITHDRAWN',
    `${bidder?.name ?? 'A business'} withdrew its ${bid.scope.toLowerCase()} offer.`,
    auth.user.id,
    { bidId },
  );
}

/** Every bid this organization has made, across all requirements. */
export async function listOwnBids(
  auth: AuthContext,
  organizationId: string,
  query: RequirementListQuery,
): Promise<Paginated<RequirementBidSummary>> {
  const where: Prisma.RequirementBidWhereInput = { bidderOrganizationId: organizationId };

  const [total, rows] = await Promise.all([
    prisma.requirementBid.count({ where }),
    prisma.requirementBid.findMany({
      where,
      orderBy: { createdAt: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: await decorateBids(rows),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

// ---------------------------------------------------------------------------
// Bids — customer side
// ---------------------------------------------------------------------------

export async function listBids(
  auth: AuthContext,
  requirementId: string,
): Promise<RequirementBidSummary[]> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  await assertRequirementAccess(auth, requirement);

  const isCustomer =
    auth.isPlatformAdmin || requirement.customerOrganizationId === auth.organizationId;

  // A bidder sees its own offer and nothing else. Showing rivals' prices would
  // turn a sealed auction into a race to undercut by one rupee.
  const bids = await prisma.requirementBid.findMany({
    where: {
      requirementId,
      ...(isCustomer ? {} : { bidderOrganizationId: auth.organizationId ?? '__none__' }),
    },
    orderBy: [{ status: 'asc' }, { price: 'asc' }],
  });

  return decorateBids(bids);
}

export async function shortlistBid(
  auth: AuthContext,
  requirementId: string,
  bidId: string,
  shortlisted: boolean,
): Promise<RequirementBidSummary> {
  const { requirement, bid } = await loadOwnedBid(auth, requirementId, bidId);

  const target = shortlisted ? RequirementBidStatus.SHORTLISTED : RequirementBidStatus.OFFERED;
  const result = requirementBidStateMachine.assertTransition(
    bid.status as RequirementBidStatus,
    target,
  );
  if (!result.allowed) throw errors.invalidTransition(result.reason ?? 'That is not possible now.');

  const updated = await prisma.requirementBid.update({
    where: { id: bidId },
    data: { status: target, shortlistedAt: shortlisted ? new Date() : null },
  });

  await recordEvent(
    requirementId,
    'BID_SHORTLISTED',
    shortlisted ? 'Customer shortlisted an offer.' : 'Customer removed an offer from the shortlist.',
    auth.user.id,
    { bidId },
  );

  void requirement;
  return (await decorateBids([updated]))[0]!;
}

export async function rejectBid(
  auth: AuthContext,
  requirementId: string,
  bidId: string,
  reason: string | undefined,
): Promise<RequirementBidSummary> {
  const { bid } = await loadOwnedBid(auth, requirementId, bidId);

  const result = requirementBidStateMachine.assertTransition(
    bid.status as RequirementBidStatus,
    RequirementBidStatus.REJECTED,
  );
  if (!result.allowed) {
    throw errors.invalidTransition(result.reason ?? 'This offer can no longer be rejected.');
  }

  const updated = await prisma.requirementBid.update({
    where: { id: bidId },
    data: {
      status: RequirementBidStatus.REJECTED,
      rejectedAt: new Date(),
      rejectionReason: reason ?? null,
    },
  });
  await refreshBidAggregates(requirementId);

  await recordEvent(requirementId, 'BID_REJECTED', 'Customer rejected an offer.', auth.user.id, {
    bidId,
  });

  void notifyOrganization(bid.bidderOrganizationId, {
    type: NotificationType.REQUIREMENT_BID_REJECTED,
    title: 'Bid not taken forward',
    body: reason ?? 'The customer did not take your offer forward.',
    priority: NotificationPriority.LOW,
    actionUrl: `/requirements/board`,
  });

  return (await decorateBids([updated]))[0]!;
}

async function loadOwnedBid(auth: AuthContext, requirementId: string, bidId: string) {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  assertOwner(auth, requirement);

  const bid = await prisma.requirementBid.findUnique({ where: { id: bidId } });
  if (!bid || bid.requirementId !== requirementId) throw errors.notFound('Bid');

  return { requirement, bid };
}

/**
 * Award a bid.
 *
 * The decision and its bookkeeping live here; turning the award into an order
 * or a booking lives in `award.service.ts`, because that is where this module
 * hands the work to pipelines it does not own.
 */
export async function awardBid(
  auth: AuthContext,
  requirementId: string,
  bidId: string,
  note: string | undefined,
) {
  const { requirement, bid } = await loadOwnedBid(auth, requirementId, bidId);
  return award.awardBid(auth, requirement, bid, note);
}
