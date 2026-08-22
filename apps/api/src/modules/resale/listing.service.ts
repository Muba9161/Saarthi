import {
  MediaOwnerType,
  MediaPurpose,
  VehicleListingStatus,
  VehicleListingVisibility,
  VerificationStatus,
  checkListingPublishGates,
  defaultSharedEvidenceBlocks,
  type CreateVehicleListingInput,
  type EvidenceBlock,
  type GateResult,
  type ListingListQuery,
  type UpdateVehicleListingInput,
  type WithdrawListingInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { definedOnly, skipTake } from '../../lib/http';
import type { AuthContext } from '../../auth/context';

/**
 * Vehicle resale — the seller's side.
 *
 * The point of selling a used vehicle through Saarthi rather than a classified
 * site is that the platform already holds the odometer, the service history and
 * the compliance state. A listing therefore starts from the vehicle record and
 * asks the seller only for what Saarthi cannot know: condition, price, ownership
 * count, accident history.
 *
 * A listing goes live only once the vehicle can actually be sold — verified, not
 * on a trip, not assigned to a driver — and only with enough photographs for a
 * buyer to form a real opinion. Those gates live in the shared domain module so
 * the form can show them before the seller submits.
 */

const serviceLogger = logger.child({ module: 'resale' });

/** Human-readable reference, e.g. `RSL-4F2A19`. */
function listingReference(): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RSL-${suffix}`;
}

function requireOrganization(auth: AuthContext): string {
  if (!auth.organizationId) {
    throw errors.organizationRequired('Select an organization before listing a vehicle.');
  }
  return auth.organizationId;
}

export interface ListingPhotoCounts {
  exterior: number;
  odometer: number;
  total: number;
}

/**
 * Photographs attached to the listing.
 *
 * Counted from the media library rather than tracked on the listing row, so a
 * photo deleted from the library immediately un-satisfies the publish gate
 * instead of leaving a stale count behind.
 */
async function photoCounts(listingId: string): Promise<ListingPhotoCounts> {
  const assets = await prisma.mediaAsset.findMany({
    where: {
      ownerType: MediaOwnerType.VEHICLE_LISTING,
      ownerId: listingId,
      deletedAt: null,
    },
    select: { purpose: true },
  });

  return {
    exterior: assets.filter((asset) => asset.purpose === MediaPurpose.VEHICLE_EXTERIOR).length,
    odometer: assets.filter((asset) => asset.purpose === MediaPurpose.ODOMETER).length,
    total: assets.length,
  };
}

type ListingRow = Awaited<ReturnType<typeof prisma.vehicleListing.findFirstOrThrow>>;

export interface SellerListingView {
  listing: ListingRow;
  photos: ListingPhotoCounts;
  /** Everything still standing between this listing and going live. */
  readiness: GateResult;
}

/** Assemble the publish-gate context from live records, never cached counts. */
async function readiness(listing: ListingRow, organizationId: string): Promise<GateResult> {
  const [vehicle, organization, photos, activeTrip, activeAssignment] = await Promise.all([
    prisma.truck.findUnique({
      where: { id: listing.vehicleId },
      select: { organizationId: true, verificationStatus: true },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { verificationStatus: true },
    }),
    photoCounts(listing.id),
    prisma.trip.findFirst({
      where: {
        truckId: listing.vehicleId,
        status: { in: ['ASSIGNED', 'LOADING', 'STARTED', 'IN_TRANSIT', 'DELAYED', 'ARRIVED', 'UNLOADING'] },
      },
      select: { id: true },
    }),
    prisma.truckAssignment.findFirst({
      where: { truckId: listing.vehicleId, status: 'ACTIVE' },
      select: { id: true },
    }),
  ]);

  return checkListingPublishGates({
    vehicleBelongsToSeller: vehicle?.organizationId === organizationId,
    vehicleIsVerified: vehicle?.verificationStatus === VerificationStatus.VERIFIED,
    vehicleOnActiveTrip: Boolean(activeTrip),
    vehicleHasActiveAssignment: Boolean(activeAssignment),
    sellerOrganizationVerified: organization?.verificationStatus === VerificationStatus.VERIFIED,
    exteriorPhotoCount: photos.exterior,
    hasOdometerPhoto: photos.odometer > 0,
    askingPrice: Number(listing.askingPrice),
    odometerKm: listing.odometerKm,
  });
}

async function view(listing: ListingRow, organizationId: string): Promise<SellerListingView> {
  const [photos, gates] = await Promise.all([
    photoCounts(listing.id),
    readiness(listing, organizationId),
  ]);
  return { listing, photos, readiness: gates };
}

/** The seller's own listing for a vehicle, if one exists. */
export async function findListingForVehicle(
  auth: AuthContext,
  vehicleId: string,
): Promise<SellerListingView | null> {
  const organizationId = requireOrganization(auth);

  const listing = await prisma.vehicleListing.findFirst({
    where: { vehicleId, organizationId, archivedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  return listing ? view(listing, organizationId) : null;
}

export async function getOwnListing(
  auth: AuthContext,
  listingId: string,
): Promise<SellerListingView> {
  const organizationId = requireOrganization(auth);
  const listing = await prisma.vehicleListing.findFirst({
    where: { id: listingId, organizationId, archivedAt: null },
  });
  if (!listing) throw errors.notFound('Listing');
  return view(listing, organizationId);
}

export async function createListing(
  auth: AuthContext,
  input: CreateVehicleListingInput,
): Promise<SellerListingView> {
  const organizationId = requireOrganization(auth);

  const vehicle = await prisma.truck.findFirst({
    where: { id: input.vehicleId, organizationId, archivedAt: null },
    select: { id: true, registrationNumber: true },
  });
  if (!vehicle) {
    // Reported as not-found so listing ids cannot be probed across tenants.
    throw errors.notFound('Vehicle');
  }

  // One live listing per vehicle: two open adverts for the same truck would let
  // a buyer negotiate against a price the seller has already moved on from.
  const existing = await prisma.vehicleListing.findFirst({
    where: {
      vehicleId: input.vehicleId,
      archivedAt: null,
      status: {
        in: [
          VehicleListingStatus.DRAFT,
          VehicleListingStatus.PENDING_REVIEW,
          VehicleListingStatus.PUBLISHED,
          VehicleListingStatus.RESERVED,
        ],
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw errors.conflict('This vehicle is already listed for sale.', { listingId: existing.id });
  }

  const listing = await prisma.vehicleListing.create({
    data: {
      reference: listingReference(),
      organizationId,
      vehicleId: input.vehicleId,
      status: VehicleListingStatus.DRAFT,
      visibility: input.visibility,
      title: input.title,
      description: input.description ?? null,
      askingPrice: input.askingPrice,
      negotiable: input.negotiable,
      minimumPrice: input.minimumPrice ?? null,
      condition: input.condition,
      odometerKm: input.odometerKm,
      ownershipCount: input.ownershipCount,
      accidentHistory: input.accidentHistory,
      accidentNote: input.accidentNote ?? null,
      majorRepairsNote: input.majorRepairsNote ?? null,
      tyreConditionPercent: input.tyreConditionPercent ?? null,
      engineConditionNote: input.engineConditionNote ?? null,
      insuranceValidTill: input.insuranceValidTill ?? null,
      fitnessValidTill: input.fitnessValidTill ?? null,
      permitType: input.permitType ?? null,
      permitValidTill: input.permitValidTill ?? null,
      loanOutstanding: input.loanOutstanding,
      hypothecationNote: input.hypothecationNote ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      availableFrom: input.availableFrom ?? null,
      expiresAt: input.expiresAt ?? null,
      sharedEvidence: (input.sharedEvidence ?? defaultSharedEvidenceBlocks()) as EvidenceBlock[],
      createdById: auth.user.id,
    },
  });

  serviceLogger.info(
    { listingId: listing.id, reference: listing.reference, vehicleId: input.vehicleId },
    'Vehicle listing created',
  );

  return view(listing, organizationId);
}

/** Statuses a seller may still edit. A sold vehicle is a historical record. */
const EDITABLE_STATUSES: string[] = [
  VehicleListingStatus.DRAFT,
  VehicleListingStatus.PENDING_REVIEW,
  VehicleListingStatus.PUBLISHED,
  VehicleListingStatus.REJECTED,
];

export async function updateListing(
  auth: AuthContext,
  listingId: string,
  input: UpdateVehicleListingInput,
): Promise<SellerListingView> {
  const organizationId = requireOrganization(auth);
  const current = await prisma.vehicleListing.findFirst({
    where: { id: listingId, organizationId, archivedAt: null },
  });
  if (!current) throw errors.notFound('Listing');

  if (!EDITABLE_STATUSES.includes(current.status)) {
    throw errors.invalidTransition(
      `A ${current.status.toLowerCase().replace(/_/g, ' ')} listing can no longer be edited.`,
    );
  }

  const listing = await prisma.vehicleListing.update({
    where: { id: listingId },
    data: definedOnly({
      ...input,
      sharedEvidence: input.sharedEvidence as EvidenceBlock[] | undefined,
    }),
  });

  return view(listing, organizationId);
}

/**
 * Put the listing in front of buyers.
 *
 * Every gate is evaluated here and not merely in the UI — the form is a
 * courtesy, this is the rule.
 */
export async function publishListing(
  auth: AuthContext,
  listingId: string,
): Promise<SellerListingView> {
  const organizationId = requireOrganization(auth);
  const current = await prisma.vehicleListing.findFirst({
    where: { id: listingId, organizationId, archivedAt: null },
  });
  if (!current) throw errors.notFound('Listing');

  if (current.status === VehicleListingStatus.PUBLISHED) {
    return view(current, organizationId);
  }
  if (!EDITABLE_STATUSES.includes(current.status)) {
    throw errors.invalidTransition('This listing can no longer be published.');
  }

  const gates = await readiness(current, organizationId);
  if (!gates.ready) {
    throw errors.businessRule('This listing is not ready to go live yet.', {
      blockers: gates.blockers,
    });
  }

  const listing = await prisma.vehicleListing.update({
    where: { id: listingId },
    data: {
      status: VehicleListingStatus.PUBLISHED,
      submittedAt: current.submittedAt ?? new Date(),
      publishedAt: new Date(),
      rejectionReason: null,
    },
  });

  serviceLogger.info(
    { listingId: listing.id, reference: listing.reference },
    'Vehicle listing published',
  );

  return view(listing, organizationId);
}

// ---------------------------------------------------------------------------
// Buyer side — browsing the marketplace
// ---------------------------------------------------------------------------

export interface MarketplaceListing {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  askingPrice: number;
  negotiable: boolean;
  condition: string;
  odometerKm: number;
  ownershipCount: number;
  accidentHistory: boolean;
  tyreConditionPercent: number | null;
  city: string | null;
  state: string | null;
  publishedAt: string | null;
  /** True when the signed-in organization is the seller. */
  isOwnListing: boolean;
  vehicle: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    truckType: string;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    fuelType: string;
    capacityTons: number | null;
    passengerCapacity: number | null;
  };
  photoCount: number;
  coverPhotoId: string | null;
}

/**
 * Published listings, for buyers.
 *
 * `minimumPrice` is deliberately absent from `MarketplaceListing` — it is the
 * seller's walk-away figure and serialising it here would hand every buyer the
 * other side's negotiating position.
 */
export async function browseListings(
  auth: AuthContext,
  query: ListingListQuery,
): Promise<{ items: MarketplaceListing[]; total: number }> {
  const organizationId = auth.organizationId ?? null;
  const { skip, take } = skipTake(query.page, query.pageSize);

  const vehicleFilter = definedOnly({
    vehicleType: query.vehicleType ? { in: query.vehicleType } : undefined,
    truckType: query.truckType ? { in: query.truckType } : undefined,
    fuelType: query.fuelType ? { in: query.fuelType } : undefined,
    year: query.minYear ? { gte: query.minYear } : undefined,
    capacityTons: query.minCapacityTons ? { gte: query.minCapacityTons } : undefined,
  });

  const where = {
    archivedAt: null,
    // Only live adverts. A withdrawn or sold vehicle is not on the market.
    status: query.status
      ? { in: query.status }
      : { in: [VehicleListingStatus.PUBLISHED, VehicleListingStatus.RESERVED] },
    // ORGANIZATION-scoped listings stay inside the seller's own tenant.
    ...(organizationId
      ? {
          OR: [
            { visibility: { not: VehicleListingVisibility.ORGANIZATION } },
            { organizationId },
          ],
        }
      : { visibility: { not: VehicleListingVisibility.ORGANIZATION } }),
    ...(query.condition ? { condition: { in: query.condition } } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined
      ? {
          askingPrice: definedOnly({
            gte: query.minPrice,
            lte: query.maxPrice,
          }),
        }
      : {}),
    ...(query.maxOdometerKm !== undefined ? { odometerKm: { lte: query.maxOdometerKm } } : {}),
    ...(query.city ? { city: { contains: query.city, mode: 'insensitive' as const } } : {}),
    ...(query.state ? { state: { contains: query.state, mode: 'insensitive' as const } } : {}),
    ...(Object.keys(vehicleFilter).length > 0 ? { vehicle: vehicleFilter } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
            {
              vehicle: {
                registrationNumber: { contains: query.search, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {}),
  };

  // `distance` needs coordinates we may not have; fall back to recency.
  const sortField = query.sortBy === 'distance' ? 'publishedAt' : query.sortBy;
  const orderBy =
    sortField === 'year'
      ? { vehicle: { year: query.sortOrder } }
      : { [sortField]: query.sortOrder };

  const [rows, total] = await Promise.all([
    prisma.vehicleListing.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        vehicle: {
          select: {
            id: true,
            registrationNumber: true,
            vehicleType: true,
            truckType: true,
            manufacturer: true,
            model: true,
            year: true,
            fuelType: true,
            capacityTons: true,
            passengerCapacity: true,
          },
        },
      },
    }),
    prisma.vehicleListing.count({ where }),
  ]);

  const photos = await prisma.mediaAsset.findMany({
    where: {
      ownerType: MediaOwnerType.VEHICLE_LISTING,
      ownerId: { in: rows.map((row) => row.id) },
      deletedAt: null,
    },
    select: { id: true, ownerId: true, purpose: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });

  const photosByListing = new Map<string, typeof photos>();
  for (const photo of photos) {
    const bucket = photosByListing.get(photo.ownerId) ?? [];
    bucket.push(photo);
    photosByListing.set(photo.ownerId, bucket);
  }

  const items = rows.map((row) => {
    const listingPhotos = photosByListing.get(row.id) ?? [];
    const cover =
      listingPhotos.find((photo) => photo.purpose === MediaPurpose.VEHICLE_EXTERIOR) ??
      listingPhotos[0];

    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      description: row.description,
      askingPrice: Number(row.askingPrice),
      negotiable: row.negotiable,
      condition: row.condition,
      odometerKm: row.odometerKm,
      ownershipCount: row.ownershipCount,
      accidentHistory: row.accidentHistory,
      tyreConditionPercent: row.tyreConditionPercent,
      city: row.city,
      state: row.state,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      isOwnListing: row.organizationId === organizationId,
      vehicle: {
        id: row.vehicle.id,
        registrationNumber: row.vehicle.registrationNumber,
        vehicleType: row.vehicle.vehicleType,
        truckType: row.vehicle.truckType,
        manufacturer: row.vehicle.manufacturer,
        model: row.vehicle.model,
        year: row.vehicle.year,
        fuelType: row.vehicle.fuelType,
        capacityTons: row.vehicle.capacityTons,
        passengerCapacity: row.vehicle.passengerCapacity,
      },
      photoCount: listingPhotos.length,
      coverPhotoId: cover?.id ?? null,
    } satisfies MarketplaceListing;
  });

  return { items, total };
}

export async function withdrawListing(
  auth: AuthContext,
  listingId: string,
  input: WithdrawListingInput,
): Promise<SellerListingView> {
  const organizationId = requireOrganization(auth);
  const current = await prisma.vehicleListing.findFirst({
    where: { id: listingId, organizationId, archivedAt: null },
  });
  if (!current) throw errors.notFound('Listing');

  if (current.status === VehicleListingStatus.SOLD) {
    throw errors.invalidTransition('A sold vehicle cannot be withdrawn.');
  }

  const listing = await prisma.vehicleListing.update({
    where: { id: listingId },
    data: {
      status: VehicleListingStatus.WITHDRAWN,
      withdrawnAt: new Date(),
      withdrawalReason: input.reason,
    },
  });

  return view(listing, organizationId);
}
