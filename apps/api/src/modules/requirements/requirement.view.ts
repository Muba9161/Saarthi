import {
  type RequirementBidScope,
  type HireBasis,
  type MaterialUnit,
  type RequirementBidStatus,
  type RequirementKind,
  type RequirementStatus,
  type TruckType,
  type VehicleType,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import type { AuthContext } from '../../auth/context';

/**
 * Read models for requirements and bids.
 *
 * Separated from the service because the shaping rules here are about who is
 * looking, not about what is allowed to happen: the same requirement row is a
 * different object to the customer who raised it and to the fleet deciding
 * whether to price it. Keeping that in one file means a field cannot be
 * exposed on the board by an endpoint that forgot to strip it.
 */

export const requirementInclude = {
  _count: { select: { bids: true } },
} satisfies Prisma.RequirementInclude;

export type RequirementRecord = Prisma.RequirementGetPayload<{
  include: typeof requirementInclude;
}>;

export interface RequirementSummary {
  id: string;
  reference: string;
  kind: RequirementKind;
  status: RequirementStatus;
  title: string;
  description: string | null;

  customerOrganizationId: string;
  customerName: string;

  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  originCity: string | null;
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  destinationCity: string | null;
  distanceKm: number | null;

  startAt: string;
  endAt: string | null;
  scheduleNotes: string | null;
  bidsCloseAt: string;
  biddingClosed: boolean;

  /** Null unless the customer chose to publish it, or is the caller. */
  budgetAmount: number | null;
  budgetIsPublic: boolean;

  /** Contact details are the customer's own until a bid is awarded. */
  contactName: string | null;
  contactPhone: string | null;

  // Kind-specific detail. Null on the kinds it does not apply to.
  materialId: string | null;
  materialName: string | null;
  materialCategory: string | null;
  specification: string | null;
  quantity: number | null;
  unit: MaterialUnit | null;
  needsTransport: boolean;

  goodsDescription: string | null;
  requiredCapacityTons: number | null;
  requiredTruckType: TruckType | null;
  handlingNotes: string | null;

  hireBasis: HireBasis | null;
  passengers: number | null;
  preferredVehicleType: VehicleType | null;
  durationHours: number | null;
  durationDays: number | null;
  durationNights: number | null;
  luggageCount: number | null;
  acRequired: boolean | null;
  destinations: string[];
  requiredInclusions: string[];
  accommodationNeeded: boolean | null;
  mealsNeeded: boolean | null;

  bidCount: number;
  lowestBid: number | null;
  awardedMaterialBidId: string | null;
  awardedTransportBidId: string | null;
  awardedTravelBidId: string | null;
  orderId: string | null;
  bookingId: string | null;

  cancellationReason: string | null;
  awardedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementBidSummary {
  id: string;
  requirementId: string;
  scope: RequirementBidScope;
  status: RequirementBidStatus;

  bidderOrganizationId: string;
  bidderName: string;
  bidderVerified: boolean;
  /** Rolling rating of the bidder, when it has one. */
  bidderRating: number | null;
  bidderRatingCount: number;

  price: number;
  priceBreakdown: string | null;
  message: string | null;
  validUntil: string | null;
  expired: boolean;

  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    capacityTons: number;
    verificationStatus: string;
  } | null;
  driver: { id: string; name: string; overallScore: number | null } | null;
  estimatedPickupAt: string | null;
  estimatedArrivalAt: string | null;
  distanceToPickupKm: number | null;

  materialId: string | null;
  includesDelivery: boolean;
  availableQuantity: number | null;
  leadTimeDays: number | null;

  offeredVehicleType: VehicleType | null;
  inclusions: string[];
  exclusions: string[];
  itinerarySummary: string | null;
  driverIncluded: boolean;
  fuelIncluded: boolean;

  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape requirement rows for the caller.
 *
 * Two fields are conditional, and both for the same reason — a sealed auction
 * only works if the bidders cannot see what the customer will tolerate:
 *
 *   * the budget is hidden unless the customer published it;
 *   * the contact details are hidden until this bidder has actually won,
 *     so the board cannot be mined for a phone list.
 */
export async function decorateRequirements(
  rows: RequirementRecord[],
  auth: AuthContext,
): Promise<RequirementSummary[]> {
  if (rows.length === 0) return [];

  const organizations = await prisma.organization.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.customerOrganizationId))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(organizations.map((organization) => [organization.id, organization.name]));

  // Which of these the caller has actually won, so contact details can be
  // released to exactly that counterparty and nobody else.
  const wonRequirementIds = new Set<string>();
  if (auth.organizationId) {
    const won = await prisma.requirementBid.findMany({
      where: {
        requirementId: { in: rows.map((row) => row.id) },
        bidderOrganizationId: auth.organizationId,
        status: 'ACCEPTED',
      },
      select: { requirementId: true },
    });
    for (const bid of won) wonRequirementIds.add(bid.requirementId);
  }

  const now = Date.now();

  return rows.map((row) => {
    const isCustomer =
      auth.isPlatformAdmin || row.customerOrganizationId === auth.organizationId;
    const maySeeContact = isCustomer || wonRequirementIds.has(row.id);

    return {
      id: row.id,
      reference: row.reference,
      kind: row.kind as RequirementKind,
      status: row.status as RequirementStatus,
      title: row.title,
      description: row.description,

      customerOrganizationId: row.customerOrganizationId,
      customerName: nameById.get(row.customerOrganizationId) ?? 'Customer',

      originAddress: row.originAddress,
      originLatitude: row.originLatitude,
      originLongitude: row.originLongitude,
      originCity: row.originCity,
      destinationAddress: row.destinationAddress,
      destinationLatitude: row.destinationLatitude,
      destinationLongitude: row.destinationLongitude,
      destinationCity: row.destinationCity,
      distanceKm: row.distanceKm,

      startAt: row.startAt.toISOString(),
      endAt: row.endAt?.toISOString() ?? null,
      scheduleNotes: row.scheduleNotes,
      bidsCloseAt: row.bidsCloseAt.toISOString(),
      biddingClosed: row.bidsCloseAt.getTime() < now,

      budgetAmount:
        isCustomer || row.budgetIsPublic
          ? row.budgetAmount
            ? Number(row.budgetAmount)
            : null
          : null,
      budgetIsPublic: row.budgetIsPublic,

      contactName: maySeeContact ? row.contactName : null,
      contactPhone: maySeeContact ? row.contactPhone : null,

      materialId: row.materialId,
      materialName: row.materialName,
      materialCategory: row.materialCategory,
      specification: row.specification,
      quantity: row.quantity,
      unit: row.unit as MaterialUnit | null,
      needsTransport: row.needsTransport,

      goodsDescription: row.goodsDescription,
      requiredCapacityTons: row.requiredCapacityTons,
      requiredTruckType: row.requiredTruckType as TruckType | null,
      handlingNotes: row.handlingNotes,

      hireBasis: row.hireBasis as HireBasis | null,
      passengers: row.passengers,
      preferredVehicleType: row.preferredVehicleType as VehicleType | null,
      durationHours: row.durationHours,
      durationDays: row.durationDays,
      durationNights: row.durationNights,
      luggageCount: row.luggageCount,
      acRequired: row.acRequired,
      destinations: row.destinations,
      requiredInclusions: row.requiredInclusions,
      accommodationNeeded: row.accommodationNeeded,
      mealsNeeded: row.mealsNeeded,

      bidCount: row.bidCount,
      lowestBid: row.lowestBid ? Number(row.lowestBid) : null,
      awardedMaterialBidId: row.awardedMaterialBidId,
      awardedTransportBidId: row.awardedTransportBidId,
      awardedTravelBidId: row.awardedTravelBidId,
      orderId: row.orderId,
      bookingId: row.bookingId,

      cancellationReason: row.cancellationReason,
      awardedAt: row.awardedAt?.toISOString() ?? null,
      fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

type BidRecord = Prisma.RequirementBidGetPayload<Record<string, never>>;

export async function decorateBids(rows: BidRecord[]): Promise<RequirementBidSummary[]> {
  if (rows.length === 0) return [];

  const organizationIds = [...new Set(rows.map((row) => row.bidderOrganizationId))];
  const vehicleIds = [...new Set(rows.map((row) => row.vehicleId).filter(Boolean))] as string[];
  const driverIds = [...new Set(rows.map((row) => row.driverId).filter(Boolean))] as string[];

  const [organizations, providers, vehicles, drivers] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, name: true, verificationStatus: true },
    }),
    prisma.serviceProviderProfile.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { organizationId: true, ratingAverage: true, ratingCount: true },
    }),
    vehicleIds.length > 0
      ? prisma.truck.findMany({
          where: { id: { in: vehicleIds } },
          select: {
            id: true,
            registrationNumber: true,
            vehicleType: true,
            capacityTons: true,
            verificationStatus: true,
          },
        })
      : Promise.resolve([]),
    driverIds.length > 0
      ? prisma.driver.findMany({
          where: { id: { in: driverIds } },
          select: {
            id: true,
            overallScore: true,
            user: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const orgById = new Map(organizations.map((organization) => [organization.id, organization]));
  const providerByOrg = new Map(providers.map((provider) => [provider.organizationId, provider]));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

  const now = Date.now();

  return rows.map((row) => {
    const organization = orgById.get(row.bidderOrganizationId);
    const provider = providerByOrg.get(row.bidderOrganizationId);
    const vehicle = row.vehicleId ? vehicleById.get(row.vehicleId) : undefined;
    const driver = row.driverId ? driverById.get(row.driverId) : undefined;

    return {
      id: row.id,
      requirementId: row.requirementId,
      scope: row.scope as RequirementBidScope,
      status: row.status as RequirementBidStatus,

      bidderOrganizationId: row.bidderOrganizationId,
      bidderName: organization?.name ?? 'Bidder',
      bidderVerified: organization?.verificationStatus === 'VERIFIED',
      bidderRating: provider && provider.ratingCount > 0 ? provider.ratingAverage : null,
      bidderRatingCount: provider?.ratingCount ?? 0,

      price: Number(row.price),
      priceBreakdown: row.priceBreakdown,
      message: row.message,
      validUntil: row.validUntil?.toISOString() ?? null,
      expired: row.validUntil ? row.validUntil.getTime() < now : false,

      vehicle: vehicle
        ? {
            id: vehicle.id,
            registrationNumber: vehicle.registrationNumber,
            vehicleType: vehicle.vehicleType,
            capacityTons: vehicle.capacityTons,
            verificationStatus: vehicle.verificationStatus,
          }
        : null,
      driver: driver
        ? {
            id: driver.id,
            name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
            overallScore: driver.overallScore,
          }
        : null,
      estimatedPickupAt: row.estimatedPickupAt?.toISOString() ?? null,
      estimatedArrivalAt: row.estimatedArrivalAt?.toISOString() ?? null,
      distanceToPickupKm: row.distanceToPickupKm,

      materialId: row.materialId,
      includesDelivery: row.includesDelivery,
      availableQuantity: row.availableQuantity,
      leadTimeDays: row.leadTimeDays,

      offeredVehicleType: row.offeredVehicleType as VehicleType | null,
      inclusions: row.inclusions,
      exclusions: row.exclusions,
      itinerarySummary: row.itinerarySummary,
      driverIncluded: row.driverIncluded,
      fuelIncluded: row.fuelIncluded,

      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}
