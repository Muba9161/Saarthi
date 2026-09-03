import {
  ASSIGNABLE_TRUCK_STATUSES,
  LIVE_BID_STATUSES,
  MaterialUnit,
  NotificationPriority,
  NotificationType,
  RequirementBidScope,
  RequirementBidStatus,
  RequirementKind,
  RequirementStatus,
  TravelServiceKind,
  type TruckStatus,
  VehicleType,
  requirementBidStateMachine,
  requirementStateMachine,
  type TruckType,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { notifyOrganization } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';
import { createOrderFromRequirement } from '../orders/order.service';
import { createBookingFromRequirement } from '../travel/booking.service';
import {
  decorateRequirements,
  requirementInclude,
  type RequirementRecord,
  type RequirementSummary,
} from './requirement.view';

/**
 * Awarding — where a requirement stops being a request and becomes work.
 *
 * This is the seam of the whole feature. Everything before it is new: a
 * cross-category requirement, a board, sealed bids. Everything after it is the
 * platform as it already was — an Order that becomes a Trip that is tracked and
 * rated, or a TravelBooking that is paid, confirmed, driven and reviewed.
 * Keeping the seam in one small file is what stops the new front door from
 * growing a second copy of the fulfilment pipelines behind it.
 *
 * A material requirement can settle in two steps, which is why this is not a
 * single write: the yard that sells the cement and the fleet that carries it
 * are rarely the same business, so the customer awards the goods, the
 * requirement drops to PARTIALLY_AWARDED and stays on the transport board, and
 * the order is only raised once the second half lands.
 */

export interface AwardResult {
  requirement: RequirementSummary;
  /** Set once a freight or material award produced an order. */
  orderId: string | null;
  /** Set when that order was dispatched to a vehicle. */
  tripId: string | null;
  /** Set once a travel award produced a booking. */
  bookingId: string | null;
  /** What the customer has to do next, in their own terms. */
  nextStep: string;
}

type BidRecord = Prisma.RequirementBidGetPayload<Record<string, never>>;

/** The column on the requirement that records the winner of this scope. */
const AWARD_FIELD_BY_SCOPE = {
  [RequirementBidScope.MATERIAL]: 'awardedMaterialBidId',
  [RequirementBidScope.TRANSPORT]: 'awardedTransportBidId',
  [RequirementBidScope.TRAVEL]: 'awardedTravelBidId',
} as const;

export async function awardBid(
  auth: AuthContext,
  requirement: RequirementRecord,
  bid: BidRecord,
  note: string | undefined,
): Promise<AwardResult> {
  assertAwardable(requirement, bid);
  await assertStillDeliverable(requirement, bid);

  const scope = bid.scope as RequirementBidScope;
  const awardField = AWARD_FIELD_BY_SCOPE[scope];

  await prisma.$transaction(async (tx) => {
    await tx.requirementBid.update({
      where: { id: bid.id },
      data: { status: RequirementBidStatus.ACCEPTED, acceptedAt: new Date() },
    });

    // Every rival for the *same* scope is out. Bids for the other half of a
    // material requirement are untouched — they are still being competed for.
    await tx.requirementBid.updateMany({
      where: {
        requirementId: requirement.id,
        scope,
        id: { not: bid.id },
        status: { in: LIVE_BID_STATUSES as never },
      },
      data: {
        status: RequirementBidStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: 'The customer awarded this work to another bidder.',
      },
    });

    await tx.requirement.update({
      where: { id: requirement.id },
      data: { [awardField]: bid.id },
    });
  });

  const bidder = await prisma.organization.findUnique({
    where: { id: bid.bidderOrganizationId },
    select: { name: true },
  });

  await prisma.requirementEvent.create({
    data: {
      requirementId: requirement.id,
      type: 'BID_ACCEPTED',
      description: `${bidder?.name ?? 'A business'} won the ${scope.toLowerCase()} half at ${Number(bid.price)}.`,
      actorUserId: auth.user.id,
      metadata: { bidId: bid.id, scope, price: Number(bid.price) } as never,
    },
  });

  void notifyOrganization(bid.bidderOrganizationId, {
    type: NotificationType.REQUIREMENT_BID_ACCEPTED,
    title: 'You won the bid',
    body: note ?? `${requirement.reference}: your offer was accepted.`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/requirements/board/${requirement.id}`,
  });

  // Reload: the transaction above changed the award columns this decision
  // depends on, and reading the stale copy is how a half gets awarded twice.
  const fresh = await prisma.requirement.findUniqueOrThrow({
    where: { id: requirement.id },
    include: requirementInclude,
  });

  return settle(auth, fresh, note);
}

/** Everything that has to be true before an award can be made. */
function assertAwardable(requirement: RequirementRecord, bid: BidRecord): void {
  const status = requirement.status as RequirementStatus;

  if (
    status !== RequirementStatus.BIDDING &&
    status !== RequirementStatus.PARTIALLY_AWARDED &&
    status !== RequirementStatus.OPEN
  ) {
    throw errors.invalidTransition('This requirement is no longer open for awarding.');
  }

  const result = requirementBidStateMachine.assertTransition(
    bid.status as RequirementBidStatus,
    RequirementBidStatus.ACCEPTED,
  );
  if (!result.allowed) {
    throw errors.invalidTransition(
      bid.status === RequirementBidStatus.WITHDRAWN
        ? 'That offer was withdrawn by the bidder.'
        : (result.reason ?? 'That offer can no longer be accepted.'),
    );
  }

  if (bid.validUntil && bid.validUntil.getTime() < Date.now()) {
    throw errors.businessRule('That offer has expired. Ask the bidder to re-quote.');
  }

  const awarded = requirement[AWARD_FIELD_BY_SCOPE[bid.scope as RequirementBidScope]];
  if (awarded) {
    throw errors.businessRule('You have already awarded this part of the requirement.');
  }
}

/**
 * Everything the *other side* still has to be able to do, checked before any
 * of it is written down.
 *
 * Accepting a bid and building the order are two steps, and between the bid
 * being placed and the customer awarding it the world moves: the quoted lorry
 * gets sent somewhere else, its driver is stood down, the operator pauses its
 * profile. Without this check the first step would commit — bid accepted,
 * every rival rejected — and the second would throw, leaving a requirement
 * that has chosen a winner and produced nothing, with no losing bid left to
 * fall back on.
 *
 * So the conditions the fulfilment step depends on are asserted here, before
 * anything is written. A narrow race remains — the vehicle could be taken in
 * the milliseconds after this returns — but that is the same race
 * `acceptQuote` has always had, and it fails before the award rather than
 * halfway through it.
 */
async function assertStillDeliverable(
  requirement: RequirementRecord,
  bid: BidRecord,
): Promise<void> {
  const scope = bid.scope as RequirementBidScope;

  if (scope === RequirementBidScope.TRANSPORT && bid.vehicleId) {
    const vehicle = await prisma.truck.findUnique({
      where: { id: bid.vehicleId },
      select: {
        registrationNumber: true,
        status: true,
        archivedAt: true,
        currentDriverId: true,
      },
    });

    if (!vehicle || vehicle.archivedAt) {
      throw errors.businessRule(
        'The vehicle offered on this bid is no longer available. Ask the fleet to re-quote.',
      );
    }
    if (!ASSIGNABLE_TRUCK_STATUSES.includes(vehicle.status as TruckStatus)) {
      throw errors.businessRule(
        `${vehicle.registrationNumber} is no longer free. Ask the fleet to quote another vehicle.`,
      );
    }
    if (!bid.driverId && !vehicle.currentDriverId) {
      throw errors.businessRule(
        `${vehicle.registrationNumber} has no driver assigned. Ask the fleet to assign one before you award.`,
      );
    }
  }

  if (scope === RequirementBidScope.TRAVEL) {
    const provider = await prisma.serviceProviderProfile.findUnique({
      where: { organizationId: bid.bidderOrganizationId },
      select: { status: true },
    });
    if (!provider || provider.status !== 'ACTIVE') {
      throw errors.businessRule(
        'That operator is no longer accepting bookings. Award one of the other offers.',
      );
    }

    // Settling a travel award needs somebody for the operator to call, and
    // finding that out after the bid was accepted would be too late.
    const organization = await prisma.organization.findUnique({
      where: { id: requirement.customerOrganizationId },
      select: { phone: true },
    });
    if (!requirement.contactPhone && !organization?.phone) {
      throw errors.businessRule(
        'Add a contact phone number to this requirement before awarding — the operator needs somebody to call.',
      );
    }
  }
}

/**
 * Decide whether the requirement is now fully settled, and if so, build the
 * fulfilment record.
 */
async function settle(
  auth: AuthContext,
  requirement: RequirementRecord,
  note: string | undefined,
): Promise<AwardResult> {
  const kind = requirement.kind as RequirementKind;

  if (kind === RequirementKind.CAB_HIRE || kind === RequirementKind.TOUR_PACKAGE) {
    return settleTravel(auth, requirement);
  }

  const materialBid = requirement.awardedMaterialBidId
    ? await prisma.requirementBid.findUnique({ where: { id: requirement.awardedMaterialBidId } })
    : null;
  const transportBid = requirement.awardedTransportBidId
    ? await prisma.requirementBid.findUnique({ where: { id: requirement.awardedTransportBidId } })
    : null;

  // Transport is still owed when the customer asked for delivery and the
  // supplier did not price it in.
  const transportOutstanding =
    kind === RequirementKind.MATERIAL_SUPPLY
      ? requirement.needsTransport && !materialBid?.includesDelivery && !transportBid
      : !transportBid;

  if (transportOutstanding) {
    await moveTo(requirement, RequirementStatus.PARTIALLY_AWARDED);
    const updated = await reload(requirement.id);
    return {
      requirement: (await decorateRequirements([updated], auth))[0]!,
      orderId: null,
      tripId: null,
      bookingId: null,
      nextStep:
        'The supplier is appointed. Your requirement stays open to fleets so you can award the transport.',
    };
  }

  // Nothing is owed on the material half either, or there never was one.
  if (kind === RequirementKind.MATERIAL_SUPPLY && !materialBid) {
    await moveTo(requirement, RequirementStatus.PARTIALLY_AWARDED);
    const updated = await reload(requirement.id);
    return {
      requirement: (await decorateRequirements([updated], auth))[0]!,
      orderId: null,
      tripId: null,
      bookingId: null,
      nextStep:
        'Transport is arranged. Award a supplier for the material to complete the requirement.',
    };
  }

  return settleFreight(auth, requirement, materialBid, transportBid, note);
}

async function settleFreight(
  auth: AuthContext,
  requirement: RequirementRecord,
  materialBid: BidRecord | null,
  transportBid: BidRecord | null,
  note: string | undefined,
): Promise<AwardResult> {
  const destinationAddress = requirement.destinationAddress;
  if (
    !destinationAddress ||
    requirement.destinationLatitude == null ||
    requirement.destinationLongitude == null
  ) {
    throw errors.businessRule('This requirement has no delivery point, so no order can be raised.');
  }

  // A transport bid always names its vehicle — the schema check on the bid
  // guarantees it — but the driver may come from the vehicle's own roster.
  let driverId: string | null = null;
  if (transportBid?.vehicleId) {
    if (transportBid.driverId) {
      driverId = transportBid.driverId;
    } else {
      const vehicle = await prisma.truck.findUnique({
        where: { id: transportBid.vehicleId },
        select: { currentDriverId: true },
      });
      driverId = vehicle?.currentDriverId ?? null;
    }
  }

  const materialName =
    requirement.materialName ?? requirement.goodsDescription ?? requirement.title;

  const { order, tripId } = await createOrderFromRequirement(auth, {
    requirementId: requirement.id,
    customerId: requirement.customerId,
    customerOrganizationId: requirement.customerOrganizationId,

    materialId: materialBid?.materialId ?? requirement.materialId,
    supplierOrganizationId: materialBid?.bidderOrganizationId ?? null,
    materialName,
    quantity: requirement.quantity ?? 1,
    unit: (requirement.unit as MaterialUnit | null) ?? MaterialUnit.TON,
    materialPrice: materialBid ? Number(materialBid.price) : null,

    originAddress: requirement.originAddress,
    originLatitude: requirement.originLatitude,
    originLongitude: requirement.originLongitude,
    destinationAddress,
    destinationLatitude: requirement.destinationLatitude,
    destinationLongitude: requirement.destinationLongitude,

    requiredCapacityTons: requirement.requiredCapacityTons ?? requirement.quantity ?? 1,
    requiredTruckType: requirement.requiredTruckType as TruckType | null,
    pickupAt: requirement.startAt,
    deliverBy: requirement.endAt,
    budget: requirement.budgetAmount ? Number(requirement.budgetAmount) : null,
    notes: requirement.handlingNotes ?? requirement.description,

    transport: transportBid
      ? {
          fleetOrganizationId: transportBid.bidderOrganizationId,
          truckId: transportBid.vehicleId!,
          driverId,
          price: Number(transportBid.price),
          estimatedPickupAt: transportBid.estimatedPickupAt,
          estimatedArrivalAt: transportBid.estimatedArrivalAt,
          message: note ?? transportBid.message,
        }
      : null,
  });

  await moveTo(requirement, RequirementStatus.AWARDED, {
    order: { connect: { id: order.id } },
    awardedAt: new Date(),
  });

  await prisma.requirementEvent.createMany({
    data: [
      {
        requirementId: requirement.id,
        type: 'AWARDED',
        description: 'Requirement fully awarded.',
        actorUserId: auth.user.id,
      },
      {
        requirementId: requirement.id,
        type: 'ORDER_CREATED',
        description: `Order ${order.reference} raised from this requirement.`,
        actorUserId: auth.user.id,
        metadata: { orderId: order.id, tripId } as never,
      },
    ],
  });

  const updated = await reload(requirement.id);
  return {
    requirement: (await decorateRequirements([updated], auth))[0]!,
    orderId: order.id,
    tripId,
    bookingId: null,
    nextStep: tripId
      ? `Order ${order.reference} is on the road. Follow it on the live map.`
      : `Order ${order.reference} is confirmed with your supplier.`,
  };
}

async function settleTravel(
  auth: AuthContext,
  requirement: RequirementRecord,
): Promise<AwardResult> {
  const bid = requirement.awardedTravelBidId
    ? await prisma.requirementBid.findUnique({ where: { id: requirement.awardedTravelBidId } })
    : null;
  if (!bid) throw errors.businessRule('No travel offer has been awarded on this requirement.');

  const kind = requirement.kind as RequirementKind;
  const durationDays = requirement.durationDays ?? 1;
  const endDate =
    requirement.endAt ??
    new Date(requirement.startAt.getTime() + Math.max(0, durationDays - 1) * 86_400_000);

  // The customer's own contact details are the fallback, because a bespoke
  // journey is booked for the person who asked for it.
  const customerOrganization = await prisma.organization.findUnique({
    where: { id: requirement.customerOrganizationId },
    select: { name: true, phone: true, email: true },
  });

  const contactPhone = requirement.contactPhone ?? customerOrganization?.phone;
  if (!contactPhone) {
    throw errors.businessRule(
      'Add a contact phone number to this requirement before awarding — the operator needs somebody to call.',
    );
  }

  const created = await createBookingFromRequirement(auth, {
    requirementId: requirement.id,
    requirementReference: requirement.reference,
    requirementTitle: requirement.title,
    providerOrganizationId: bid.bidderOrganizationId,
    customerOrganizationId: requirement.customerOrganizationId,

    serviceKind:
      kind === RequirementKind.TOUR_PACKAGE
        ? TravelServiceKind.MULTI_DAY_TOUR
        : TravelServiceKind.CUSTOM_TRIP,
    startDate: requirement.startAt,
    endDate,
    passengers: requirement.passengers ?? 1,

    startLocation: requirement.originAddress,
    startLatitude: requirement.originLatitude,
    startLongitude: requirement.originLongitude,
    endLocation: requirement.destinationAddress ?? requirement.originAddress,
    destinations: requirement.destinations,
    durationDays,
    durationNights: requirement.durationNights,
    approxDistanceKm: requirement.distanceKm,

    contactName: requirement.contactName ?? customerOrganization?.name ?? 'Customer',
    contactPhone,
    contactEmail: customerOrganization?.email ?? null,
    specialRequests: requirement.description,

    offeredVehicleType:
      (bid.offeredVehicleType as VehicleType | null) ??
      (requirement.preferredVehicleType as VehicleType | null) ??
      VehicleType.CAR,
    agreedPrice: Number(bid.price),
    priceBreakdown: bid.priceBreakdown,
    inclusions: bid.inclusions,
    exclusions: bid.exclusions,
    itinerarySummary: bid.itinerarySummary,
    driverIncluded: bid.driverIncluded,
    fuelIncluded: bid.fuelIncluded,
  });

  await moveTo(requirement, RequirementStatus.AWARDED, {
    booking: { connect: { id: created.bookingId } },
    awardedAt: new Date(),
  });

  await prisma.requirementEvent.createMany({
    data: [
      {
        requirementId: requirement.id,
        type: 'AWARDED',
        description: 'Requirement awarded to a travel operator.',
        actorUserId: auth.user.id,
      },
      {
        requirementId: requirement.id,
        type: 'BOOKING_CREATED',
        description: 'Booking raised from this requirement.',
        actorUserId: auth.user.id,
        metadata: { bookingId: created.bookingId, packageId: created.packageId } as never,
      },
    ],
  });

  const updated = await reload(requirement.id);
  return {
    requirement: (await decorateRequirements([updated], auth))[0]!,
    orderId: null,
    tripId: null,
    bookingId: created.bookingId,
    nextStep: 'Pay for the booking to have the operator hold a vehicle for your dates.',
  };
}

async function moveTo(
  requirement: RequirementRecord,
  to: RequirementStatus,
  data: Prisma.RequirementUpdateInput = {},
): Promise<void> {
  const from = requirement.status as RequirementStatus;
  if (from === to) {
    await prisma.requirement.update({ where: { id: requirement.id }, data });
    return;
  }

  const result = requirementStateMachine.assertTransition(from, to);
  if (!result.allowed) throw errors.invalidTransition(result.reason ?? 'Invalid transition.');

  await prisma.requirement.update({
    where: { id: requirement.id },
    data: { ...data, status: to },
  });
}

async function reload(requirementId: string): Promise<RequirementRecord> {
  return prisma.requirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: requirementInclude,
  });
}
