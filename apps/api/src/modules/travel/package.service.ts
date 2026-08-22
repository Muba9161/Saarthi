import {
  PricingModel,
  ProviderStatus,
  TravelPackageStatus,
  TravelServiceKind,
  VehicleCapability,
  VehicleType,
  VerificationStatus,
  buildPaginationMeta,
  canOfferServiceKind,
  quotePackage,
  vehicleSupports,
  type CreateTravelPackageInput,
  type Paginated,
  type PriceQuote,
  type TravelSearchQuery,
  type UpdateTravelPackageInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { assertTenantAccess } from '../../server/guards';
import type { AuthContext } from '../../auth/context';
import { requireProviderProfile } from './provider.service';

/**
 * Travel and tour packages.
 *
 * A package is an *offer*, not an inventory item: it describes a trip a provider
 * is willing to run, and a booking is a request against it that the provider
 * still has to accept. That is why there is no seat-level stock here — a taxi
 * operator with three SUVs sells the same Ayodhya tour to whoever asks and
 * assigns a vehicle when they confirm.
 */

export interface ItineraryDaySummary {
  dayNumber: number;
  title: string;
  description: string | null;
  highlights: string[];
  overnightAt: string | null;
  approxDistanceKm: number | null;
}

export interface PackageSummary {
  id: string;
  providerId: string;
  organizationId: string;
  provider: {
    id: string;
    displayName: string;
    ratingAverage: number;
    ratingCount: number;
    verificationStatus: VerificationStatus;
    logoUrl: string | null;
  } | null;
  title: string;
  summary: string;
  description: string | null;
  serviceKind: TravelServiceKind;
  imageUrls: string[];
  destinations: string[];
  startLocation: string;
  startLatitude: number;
  startLongitude: number;
  endLocation: string;
  durationDays: number;
  durationNights: number | null;
  approxDistanceKm: number | null;
  vehicleType: VehicleType;
  vehicle: { id: string; registrationNumber: string; model: string | null } | null;
  minPassengers: number;
  maxPassengers: number;
  pricingModel: PricingModel;
  basePrice: number;
  /** Indicative total for the smallest party, so listings can show "from ₹X". */
  fromPrice: number;
  inclusions: string[];
  exclusions: string[];
  itinerary: ItineraryDaySummary[];
  cancellationPolicy: { hoursBefore: number; refundPercent: number }[] | null;
  advanceBookingDays: number;
  availableFrom: string | null;
  availableTo: string | null;
  availableWeekdays: number[];
  driverIncluded: boolean;
  fuelIncluded: boolean;
  status: TravelPackageStatus;
  ratingAverage: number;
  ratingCount: number;
  bookingCount: number;
  publishedAt: string | null;
  createdAt: string;
}

const packageInclude = {
  provider: {
    include: {
      organization: { select: { verificationStatus: true } },
    },
  },
  vehicle: { select: { id: true, registrationNumber: true, model: true } },
  itinerary: { orderBy: { dayNumber: 'asc' as const } },
} satisfies Prisma.TravelPackageInclude;

type PackageRecord = Prisma.TravelPackageGetPayload<{ include: typeof packageInclude }>;

function parsePolicy(raw: Prisma.JsonValue | null): PackageSummary['cancellationPolicy'] {
  if (!Array.isArray(raw)) return null;
  const tiers = (raw as unknown[]).filter(
    (entry): entry is { hoursBefore: number; refundPercent: number } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { hoursBefore?: unknown }).hoursBefore === 'number' &&
      typeof (entry as { refundPercent?: unknown }).refundPercent === 'number',
  );
  return tiers.length > 0 ? tiers : null;
}

function toSummary(record: PackageRecord): PackageSummary {
  const basePrice = Number(record.basePrice);
  const pricingModel = record.pricingModel as PricingModel;

  return {
    id: record.id,
    providerId: record.providerId,
    organizationId: record.organizationId,
    provider: record.provider
      ? {
          id: record.provider.id,
          displayName: record.provider.displayName,
          ratingAverage: Number(record.provider.ratingAverage.toFixed(2)),
          ratingCount: record.provider.ratingCount,
          verificationStatus: record.provider.organization
            .verificationStatus as VerificationStatus,
          logoUrl: record.provider.logoUrl,
        }
      : null,
    title: record.title,
    summary: record.summary,
    description: record.description,
    serviceKind: record.serviceKind as TravelServiceKind,
    imageUrls: record.imageUrls,
    destinations: record.destinations,
    startLocation: record.startLocation,
    startLatitude: record.startLatitude,
    startLongitude: record.startLongitude,
    endLocation: record.endLocation,
    durationDays: record.durationDays,
    durationNights: record.durationNights,
    approxDistanceKm: record.approxDistanceKm,
    vehicleType: record.vehicleType as VehicleType,
    vehicle: record.vehicle,
    minPassengers: record.minPassengers,
    maxPassengers: record.maxPassengers,
    pricingModel,
    basePrice,
    fromPrice: quotePackage(
      {
        pricingModel,
        basePrice,
        durationDays: record.durationDays,
        distanceKm: record.approxDistanceKm,
      },
      record.minPassengers,
    ).total,
    inclusions: record.inclusions,
    exclusions: record.exclusions,
    itinerary: record.itinerary.map((day) => ({
      dayNumber: day.dayNumber,
      title: day.title,
      description: day.description,
      highlights: day.highlights,
      overnightAt: day.overnightAt,
      approxDistanceKm: day.approxDistanceKm,
    })),
    cancellationPolicy: parsePolicy(record.cancellationPolicy),
    advanceBookingDays: record.advanceBookingDays,
    availableFrom: record.availableFrom?.toISOString() ?? null,
    availableTo: record.availableTo?.toISOString() ?? null,
    availableWeekdays: record.availableWeekdays,
    driverIncluded: record.driverIncluded,
    fuelIncluded: record.fuelIncluded,
    status: record.status as TravelPackageStatus,
    ratingAverage: Number(record.ratingAverage.toFixed(2)),
    ratingCount: record.ratingCount,
    bookingCount: record.bookingCount,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Validate a package against the provider's capabilities and the vehicle model.
 *
 * Two rules that are easy to get wrong and expensive to discover later:
 *
 *  * a provider may only publish offerings its service types cover — a pure
 *    taxi licence should not be selling multi-day tours,
 *  * the vehicle type must actually be able to carry passengers on a package,
 *    which the capability model answers rather than a hard-coded list.
 */
async function assertPackageIsCoherent(
  serviceTypes: readonly string[],
  input: { serviceKind: TravelServiceKind; vehicleType: VehicleType; maxPassengers: number },
  vehicleId: string | undefined,
  organizationId: string,
): Promise<void> {
  if (!canOfferServiceKind(serviceTypes as never, input.serviceKind)) {
    throw errors.businessRule(
      `Your provider profile does not cover ${input.serviceKind.toLowerCase().replace(/_/g, ' ')}. Add the matching service type first.`,
    );
  }

  if (!vehicleSupports(input.vehicleType, VehicleCapability.TRAVEL_PACKAGES)) {
    throw errors.businessRule(
      `A ${input.vehicleType.toLowerCase().replace(/_/g, ' ')} cannot be sold as a travel package.`,
    );
  }

  if (!vehicleId) return;

  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: {
      organizationId: true,
      vehicleType: true,
      passengerCapacity: true,
      archivedAt: true,
      registrationNumber: true,
    },
  });
  if (!vehicle || vehicle.archivedAt) throw errors.notFound('Vehicle');
  if (vehicle.organizationId !== organizationId) throw errors.notFound('Vehicle');

  if (vehicle.vehicleType !== input.vehicleType) {
    throw errors.validation(
      `${vehicle.registrationNumber} is a ${vehicle.vehicleType.toLowerCase()}, not a ${input.vehicleType.toLowerCase()}.`,
    );
  }
  // Selling more seats than the vehicle has would strand a family at the kerb.
  if (vehicle.passengerCapacity !== null && input.maxPassengers > vehicle.passengerCapacity) {
    throw errors.validation(
      `${vehicle.registrationNumber} seats ${vehicle.passengerCapacity}, so it cannot take ${input.maxPassengers} passengers.`,
    );
  }
}

export async function createPackage(
  auth: AuthContext,
  input: CreateTravelPackageInput,
): Promise<PackageSummary> {
  const provider = await requireProviderProfile(auth);
  await assertPackageIsCoherent(provider.serviceTypes, input, input.vehicleId, provider.organizationId);

  const record = await prisma.travelPackage.create({
    data: {
      providerId: provider.id,
      organizationId: provider.organizationId,
      title: input.title,
      summary: input.summary,
      description: input.description ?? null,
      serviceKind: input.serviceKind,
      imageUrls: input.imageUrls,
      destinations: input.destinations,
      startLocation: input.startLocation,
      startLatitude: input.startLatitude,
      startLongitude: input.startLongitude,
      endLocation: input.endLocation,
      durationDays: input.durationDays,
      durationNights: input.durationNights ?? null,
      approxDistanceKm: input.approxDistanceKm ?? null,
      vehicleType: input.vehicleType,
      vehicleId: input.vehicleId ?? null,
      minPassengers: input.minPassengers,
      maxPassengers: input.maxPassengers,
      pricingModel: input.pricingModel,
      basePrice: input.basePrice,
      inclusions: input.inclusions,
      exclusions: input.exclusions,
      cancellationPolicy:
        input.cancellationPolicy.length > 0 ? (input.cancellationPolicy as never) : undefined,
      advanceBookingDays: input.advanceBookingDays,
      availableFrom: input.availableFrom ?? null,
      availableTo: input.availableTo ?? null,
      availableWeekdays: input.availableWeekdays,
      driverIncluded: input.driverIncluded,
      fuelIncluded: input.fuelIncluded,
      status: input.status,
      publishedAt: input.status === TravelPackageStatus.PUBLISHED ? new Date() : null,
      createdById: auth.user.id,
      itinerary: {
        create: input.itinerary.map((day) => ({
          dayNumber: day.dayNumber,
          title: day.title,
          description: day.description ?? null,
          highlights: day.highlights,
          overnightAt: day.overnightAt ?? null,
          approxDistanceKm: day.approxDistanceKm ?? null,
        })),
      },
    },
    include: packageInclude,
  });

  return toSummary(record);
}

export async function updatePackage(
  auth: AuthContext,
  packageId: string,
  input: UpdateTravelPackageInput,
): Promise<PackageSummary> {
  const existing = await prisma.travelPackage.findUnique({ where: { id: packageId } });
  if (!existing) throw errors.notFound('Package');
  assertTenantAccess(auth, existing.organizationId, 'Package');

  const provider = await requireProviderProfile(auth);
  const nextServiceKind = (input.serviceKind ?? existing.serviceKind) as TravelServiceKind;
  const nextVehicleType = (input.vehicleType ?? existing.vehicleType) as VehicleType;
  const nextMaxPassengers = input.maxPassengers ?? existing.maxPassengers;

  await assertPackageIsCoherent(
    provider.serviceTypes,
    {
      serviceKind: nextServiceKind,
      vehicleType: nextVehicleType,
      maxPassengers: nextMaxPassengers,
    },
    input.vehicleId ?? existing.vehicleId ?? undefined,
    provider.organizationId,
  );

  const becomingPublished =
    input.status === TravelPackageStatus.PUBLISHED &&
    existing.status !== TravelPackageStatus.PUBLISHED;

  const record = await prisma.$transaction(async (tx) => {
    if (input.itinerary) {
      await tx.travelItineraryDay.deleteMany({ where: { packageId } });
      await tx.travelItineraryDay.createMany({
        data: input.itinerary.map((day) => ({
          packageId,
          dayNumber: day.dayNumber,
          title: day.title,
          description: day.description ?? null,
          highlights: day.highlights,
          overnightAt: day.overnightAt ?? null,
          approxDistanceKm: day.approxDistanceKm ?? null,
        })),
      });
    }

    return tx.travelPackage.update({
      where: { id: packageId },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.serviceKind ? { serviceKind: input.serviceKind } : {}),
        ...(input.imageUrls ? { imageUrls: input.imageUrls } : {}),
        ...(input.destinations ? { destinations: input.destinations } : {}),
        ...(input.startLocation ? { startLocation: input.startLocation } : {}),
        ...(input.startLatitude !== undefined ? { startLatitude: input.startLatitude } : {}),
        ...(input.startLongitude !== undefined ? { startLongitude: input.startLongitude } : {}),
        ...(input.endLocation ? { endLocation: input.endLocation } : {}),
        ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
        ...(input.durationNights !== undefined
          ? { durationNights: input.durationNights ?? null }
          : {}),
        ...(input.approxDistanceKm !== undefined
          ? { approxDistanceKm: input.approxDistanceKm ?? null }
          : {}),
        ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}),
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId ?? null } : {}),
        ...(input.minPassengers !== undefined ? { minPassengers: input.minPassengers } : {}),
        ...(input.maxPassengers !== undefined ? { maxPassengers: input.maxPassengers } : {}),
        ...(input.pricingModel ? { pricingModel: input.pricingModel } : {}),
        ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
        ...(input.inclusions ? { inclusions: input.inclusions } : {}),
        ...(input.exclusions ? { exclusions: input.exclusions } : {}),
        ...(input.cancellationPolicy
          ? { cancellationPolicy: input.cancellationPolicy as never }
          : {}),
        ...(input.advanceBookingDays !== undefined
          ? { advanceBookingDays: input.advanceBookingDays }
          : {}),
        ...(input.availableFrom !== undefined ? { availableFrom: input.availableFrom ?? null } : {}),
        ...(input.availableTo !== undefined ? { availableTo: input.availableTo ?? null } : {}),
        ...(input.availableWeekdays ? { availableWeekdays: input.availableWeekdays } : {}),
        ...(input.driverIncluded !== undefined ? { driverIncluded: input.driverIncluded } : {}),
        ...(input.fuelIncluded !== undefined ? { fuelIncluded: input.fuelIncluded } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(becomingPublished ? { publishedAt: new Date() } : {}),
        ...(input.status === TravelPackageStatus.ARCHIVED ? { archivedAt: new Date() } : {}),
      },
      include: packageInclude,
    });
  });

  return toSummary(record);
}

/** Packages belonging to the caller's own provider profile, any status. */
export async function listOwnPackages(
  auth: AuthContext,
  query: TravelSearchQuery,
): Promise<Paginated<PackageSummary>> {
  const provider = await requireProviderProfile(auth);

  const where: Prisma.TravelPackageWhereInput = {
    providerId: provider.id,
    archivedAt: null,
    ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    ...(query.serviceKind ? { serviceKind: { in: query.serviceKind as TravelServiceKind[] } } : {}),
  };

  const [total, records] = await Promise.all([
    prisma.travelPackage.count({ where }),
    prisma.travelPackage.findMany({
      where,
      include: packageInclude,
      orderBy: { createdAt: 'desc' },
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: records.map(toSummary),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

/**
 * Customer-facing package search.
 *
 * Only PUBLISHED packages from ACTIVE providers in VERIFIED organizations are
 * discoverable. Party size filters on capacity so a family of six never sees a
 * four-seat offer they cannot book.
 */
export async function searchPackages(
  query: TravelSearchQuery,
): Promise<Paginated<PackageSummary>> {
  const where: Prisma.TravelPackageWhereInput = {
    status: TravelPackageStatus.PUBLISHED,
    archivedAt: null,
    provider: {
      archivedAt: null,
      status: ProviderStatus.ACTIVE,
      organization: { archivedAt: null, verificationStatus: VerificationStatus.VERIFIED },
    },
    ...(query.providerId ? { providerId: query.providerId } : {}),
    ...(query.serviceKind ? { serviceKind: { in: query.serviceKind as TravelServiceKind[] } } : {}),
    ...(query.vehicleType ? { vehicleType: { in: query.vehicleType as VehicleType[] } } : {}),
    ...(query.passengers
      ? {
          maxPassengers: { gte: query.passengers },
          minPassengers: { lte: query.passengers },
        }
      : {}),
    ...(query.minDays || query.maxDays
      ? {
          durationDays: {
            ...(query.minDays ? { gte: query.minDays } : {}),
            ...(query.maxDays ? { lte: query.maxDays } : {}),
          },
        }
      : {}),
    ...(query.maxPrice ? { basePrice: { lte: query.maxPrice } } : {}),
    ...(query.minRating ? { ratingAverage: { gte: query.minRating } } : {}),
    ...(query.destination
      ? {
          OR: [
            { destinations: { has: query.destination } },
            { destinations: { hasSome: [query.destination.toLowerCase(), query.destination] } },
            { endLocation: { contains: query.destination, mode: 'insensitive' } },
            { title: { contains: query.destination, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.from ? { startLocation: { contains: query.from, mode: 'insensitive' } } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { summary: { contains: query.search, mode: 'insensitive' } },
            { destinations: { has: query.search } },
          ],
        }
      : {}),
    // A package with an availability window must still be open on that date.
    ...(query.startDate
      ? {
          AND: [
            { OR: [{ availableFrom: null }, { availableFrom: { lte: query.startDate } }] },
            { OR: [{ availableTo: null }, { availableTo: { gte: query.startDate } }] },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.TravelPackageOrderByWithRelationInput =
    query.sortBy === 'price'
      ? { basePrice: query.sortOrder }
      : query.sortBy === 'rating'
        ? { ratingAverage: query.sortOrder }
        : query.sortBy === 'duration'
          ? { durationDays: query.sortOrder }
          : { publishedAt: query.sortOrder };

  const [total, records] = await Promise.all([
    prisma.travelPackage.count({ where }),
    prisma.travelPackage.findMany({
      where,
      include: packageInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  let items = records.map(toSummary);

  // Weekday availability is an array test the database index cannot serve
  // cheaply, so it is applied after the page is fetched. Documented rather than
  // hidden: a package that does not run on the requested weekday is dropped
  // from this page, so a page may return fewer rows than the page size.
  if (query.startDate) {
    const weekday = query.startDate.getDay();
    items = items.filter(
      (item) => item.availableWeekdays.length === 0 || item.availableWeekdays.includes(weekday),
    );
  }

  return {
    items,
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getPackage(packageId: string): Promise<PackageSummary> {
  const record = await prisma.travelPackage.findFirst({
    where: { id: packageId, archivedAt: null },
    include: packageInclude,
  });
  if (!record) throw errors.notFound('Package');
  return toSummary(record);
}

/** Increment the view counter. Best-effort: never fails a page load. */
export async function recordPackageView(packageId: string): Promise<void> {
  await prisma.travelPackage
    .update({ where: { id: packageId }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);
}

/** Price preview for a party size, shown before the customer commits. */
export async function quoteFor(packageId: string, passengers: number): Promise<PriceQuote> {
  const record = await prisma.travelPackage.findFirst({
    where: { id: packageId, archivedAt: null },
    select: {
      pricingModel: true,
      basePrice: true,
      durationDays: true,
      approxDistanceKm: true,
      minPassengers: true,
      maxPassengers: true,
    },
  });
  if (!record) throw errors.notFound('Package');

  if (passengers > record.maxPassengers || passengers < record.minPassengers) {
    throw errors.validation(
      `This package takes between ${record.minPassengers} and ${record.maxPassengers} passengers.`,
    );
  }

  return quotePackage(
    {
      pricingModel: record.pricingModel as PricingModel,
      basePrice: Number(record.basePrice),
      durationDays: record.durationDays,
      distanceKm: record.approxDistanceKm,
    },
    passengers,
  );
}

/** Recompute a package's rating aggregate from its reviews. */
export async function recalculatePackageRating(packageId: string): Promise<void> {
  const aggregate = await prisma.travelReview.aggregate({
    where: { packageId },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await prisma.travelPackage.update({
    where: { id: packageId },
    data: {
      ratingAverage: Number((aggregate._avg.rating ?? 0).toFixed(2)),
      ratingCount: aggregate._count._all,
    },
  });
}
