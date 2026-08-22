import {
  ProviderStatus,
  ServiceType,
  VerificationStatus,
  buildPaginationMeta,
  distanceKm,
  type Paginated,
  type ProviderListQuery,
  type UpsertProviderProfileInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import type { AuthContext } from '../../auth/context';

/**
 * Service provider profiles — the mobility capability of an organization.
 *
 * A provider profile is deliberately *not* a new account type. A fleet owner
 * who buys two SUVs to run Ayodhya tours adds TRAVEL to their service types and
 * keeps one login, one vehicle list, one driver roster and one dashboard. That
 * is the whole point of section 2 of the spec: the customer never feels they
 * have walked into a different website, and the operator never manages two.
 *
 * Verification is inherited from the organization rather than duplicated here.
 * A fleet already verified for freight does not re-verify to sell travel — the
 * legal entity is the same one.
 */

export interface ProviderServiceAreaSummary {
  id: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface ProviderSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  serviceTypes: ServiceType[];
  about: string | null;
  contactPhone: string;
  contactEmail: string | null;
  whatsappPhone: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  businessRegistrationNumber: string | null;
  yearsInBusiness: number | null;
  languages: string[];
  status: ProviderStatus;
  verificationStatus: VerificationStatus;
  ratingAverage: number;
  ratingCount: number;
  bookingsCompleted: number;
  serviceAreas: ProviderServiceAreaSummary[];
  publishedPackages: number;
  createdAt: string;
}

const providerInclude = {
  organization: {
    select: { id: true, name: true, verificationStatus: true },
  },
  serviceAreas: { orderBy: { createdAt: 'asc' as const } },
  _count: { select: { packages: true } },
} satisfies Prisma.ServiceProviderProfileInclude;

type ProviderRecord = Prisma.ServiceProviderProfileGetPayload<{
  include: typeof providerInclude;
}>;

function toSummary(record: ProviderRecord, publishedPackages: number): ProviderSummary {
  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    displayName: record.displayName,
    serviceTypes: record.serviceTypes as ServiceType[],
    about: record.about,
    contactPhone: record.contactPhone,
    contactEmail: record.contactEmail,
    whatsappPhone: record.whatsappPhone,
    logoUrl: record.logoUrl,
    bannerUrl: record.bannerUrl,
    businessRegistrationNumber: record.businessRegistrationNumber,
    yearsInBusiness: record.yearsInBusiness,
    languages: record.languages,
    status: record.status as ProviderStatus,
    verificationStatus: record.organization.verificationStatus as VerificationStatus,
    ratingAverage: Number(record.ratingAverage.toFixed(2)),
    ratingCount: record.ratingCount,
    bookingsCompleted: record.bookingsCompleted,
    serviceAreas: record.serviceAreas.map((area) => ({
      id: area.id,
      city: area.city,
      state: area.state,
      latitude: area.latitude,
      longitude: area.longitude,
      radiusKm: area.radiusKm,
    })),
    publishedPackages,
    createdAt: record.createdAt.toISOString(),
  };
}

async function publishedCounts(providerIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (providerIds.length === 0) return map;
  const grouped = await prisma.travelPackage.groupBy({
    by: ['providerId'],
    where: { providerId: { in: providerIds }, status: 'PUBLISHED', archivedAt: null },
    _count: { _all: true },
  });
  for (const row of grouped) map.set(row.providerId, row._count._all);
  return map;
}

/**
 * Create or update the caller organization's provider profile.
 *
 * Upsert rather than separate create/update endpoints: an organization has at
 * most one provider profile, so "do I already have one?" is a question the
 * client should never have to ask before saving a form.
 */
export async function upsertProviderProfile(
  auth: AuthContext,
  input: UpsertProviderProfileInput,
): Promise<ProviderSummary> {
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw errors.organizationRequired('Select the organization this profile belongs to.');
  }

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceProviderProfile.findUnique({ where: { organizationId } });

    const profile = existing
      ? await tx.serviceProviderProfile.update({
          where: { organizationId },
          data: {
            displayName: input.displayName,
            serviceTypes: input.serviceTypes,
            about: input.about ?? null,
            contactPhone: input.contactPhone,
            contactEmail: input.contactEmail ?? null,
            whatsappPhone: input.whatsappPhone ?? null,
            logoUrl: input.logoUrl ?? null,
            bannerUrl: input.bannerUrl ?? null,
            businessRegistrationNumber: input.businessRegistrationNumber ?? null,
            yearsInBusiness: input.yearsInBusiness ?? null,
            languages: input.languages,
            status: input.status,
            archivedAt: null,
          },
        })
      : await tx.serviceProviderProfile.create({
          data: {
            organizationId,
            displayName: input.displayName,
            serviceTypes: input.serviceTypes,
            about: input.about ?? null,
            contactPhone: input.contactPhone,
            contactEmail: input.contactEmail ?? null,
            whatsappPhone: input.whatsappPhone ?? null,
            logoUrl: input.logoUrl ?? null,
            bannerUrl: input.bannerUrl ?? null,
            businessRegistrationNumber: input.businessRegistrationNumber ?? null,
            yearsInBusiness: input.yearsInBusiness ?? null,
            languages: input.languages,
            status: input.status,
          },
        });

    // Service areas are replaced wholesale: they are the discovery rule, and a
    // provider editing where it operates needs to see exactly the resulting set.
    await tx.providerServiceArea.deleteMany({ where: { providerId: profile.id } });
    await tx.providerServiceArea.createMany({
      data: input.serviceAreas.map((area) => ({
        providerId: profile.id,
        city: area.city,
        state: area.state,
        latitude: area.latitude,
        longitude: area.longitude,
        radiusKm: area.radiusKm,
      })),
    });

    return tx.serviceProviderProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: providerInclude,
    });
  });

  const counts = await publishedCounts([record.id]);
  return toSummary(record, counts.get(record.id) ?? 0);
}

export async function getOwnProviderProfile(auth: AuthContext): Promise<ProviderSummary | null> {
  if (!auth.organizationId) return null;
  const record = await prisma.serviceProviderProfile.findUnique({
    where: { organizationId: auth.organizationId },
    include: providerInclude,
  });
  if (!record) return null;
  const counts = await publishedCounts([record.id]);
  return toSummary(record, counts.get(record.id) ?? 0);
}

/**
 * Public provider directory.
 *
 * Only ACTIVE providers belonging to VERIFIED organizations are listed: a
 * customer browsing travel should not be shown an unvetted operator, and an
 * operator who has paused should not take bookings it cannot honour.
 */
export async function listProviders(query: ProviderListQuery): Promise<Paginated<ProviderSummary>> {
  const where: Prisma.ServiceProviderProfileWhereInput = {
    archivedAt: null,
    status: ProviderStatus.ACTIVE,
    organization: {
      archivedAt: null,
      ...(query.verifiedOnly === false
        ? {}
        : { verificationStatus: VerificationStatus.VERIFIED }),
    },
    ...(query.serviceType ? { serviceTypes: { hasSome: query.serviceType as ServiceType[] } } : {}),
    ...(query.minRating ? { ratingAverage: { gte: query.minRating } } : {}),
    ...(query.city || query.state
      ? {
          serviceAreas: {
            some: {
              ...(query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {}),
              ...(query.state ? { state: { contains: query.state, mode: 'insensitive' } } : {}),
            },
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { displayName: { contains: query.search, mode: 'insensitive' } },
            { about: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.serviceProviderProfile.count({ where }),
    prisma.serviceProviderProfile.findMany({
      where,
      include: providerInclude,
      orderBy: [{ ratingAverage: 'desc' }, { bookingsCompleted: 'desc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const counts = await publishedCounts(records.map((record) => record.id));
  return {
    items: records.map((record) => toSummary(record, counts.get(record.id) ?? 0)),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getProvider(providerId: string): Promise<ProviderSummary> {
  const record = await prisma.serviceProviderProfile.findFirst({
    where: { id: providerId, archivedAt: null },
    include: providerInclude,
  });
  if (!record) throw errors.notFound('Provider');
  const counts = await publishedCounts([record.id]);
  return toSummary(record, counts.get(record.id) ?? 0);
}

/**
 * The caller's provider profile, or a clear error explaining what is missing.
 *
 * Used by every package and booking write, so the failure message has to tell a
 * provider what to do next rather than just refusing.
 */
export async function requireProviderProfile(auth: AuthContext): Promise<{
  id: string;
  organizationId: string;
  serviceTypes: ServiceType[];
  status: ProviderStatus;
}> {
  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw errors.organizationRequired('Select the organization you are selling travel through.');
  }

  const profile = await prisma.serviceProviderProfile.findUnique({
    where: { organizationId },
    select: { id: true, organizationId: true, serviceTypes: true, status: true, archivedAt: true },
  });
  if (!profile || profile.archivedAt) {
    throw errors.businessRule(
      'Set up your travel provider profile before publishing packages or taking bookings.',
    );
  }
  if (profile.status === ProviderStatus.SUSPENDED) {
    throw errors.forbidden('This provider account is suspended. Contact Saarthi support.');
  }

  return {
    id: profile.id,
    organizationId: profile.organizationId,
    serviceTypes: profile.serviceTypes as ServiceType[],
    status: profile.status as ProviderStatus,
  };
}

/** Does the provider cover the given point? Used by search relevance. */
export function coversPoint(
  areas: ProviderServiceAreaSummary[],
  latitude: number,
  longitude: number,
): boolean {
  return areas.some(
    (area) =>
      distanceKm({ latitude, longitude }, { latitude: area.latitude, longitude: area.longitude }) <=
      area.radiusKm,
  );
}

/** Recompute a provider's rating aggregate from its reviews. */
export async function recalculateProviderRating(providerOrganizationId: string): Promise<void> {
  const aggregate = await prisma.travelReview.aggregate({
    where: { providerOrganizationId },
    _avg: { rating: true },
    _count: { _all: true },
  });

  await prisma.serviceProviderProfile.updateMany({
    where: { organizationId: providerOrganizationId },
    data: {
      ratingAverage: Number((aggregate._avg.rating ?? 0).toFixed(2)),
      ratingCount: aggregate._count._all,
    },
  });
}
