import {
  MediaOwnerType,
  MediaPurpose,
  ProfileVisibility,
  buildPaginationMeta,
  type Paginated,
  type ProfileDirectoryQuery,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import type { AuthContext } from '../../auth/context';
import { primaryUrlsFor } from '../media/media.service';

/**
 * Internal people and organization directory.
 *
 * Saarthi has no public profile surface, so every read here needs a session and
 * the `profile.directory` grant. The visibility ladder still applies inside the
 * platform: PRIVATE means own-organization only, PARTNERS means organizations
 * you have actually transacted with, PLATFORM means any signed-in account.
 */

export interface OrganizationProfileView {
  organizationId: string;
  name: string;
  type: string;
  verificationStatus: string;
  logoUrl: string | null;
  city: string | null;
  state: string | null;
  tagline: string | null;
  about: string | null;
  foundedYear: number | null;
  employeeCount: number | null;
  website: string | null;
  serviceAreas: string[];
  specialities: string[];
  certifications: string[];
  supportEmail: string | null;
  supportPhone: string | null;
  publicSlug: string | null;
  completionPercent: number;
  visibility: ProfileVisibility;
}

export async function getOrganizationProfile(
  organizationId: string,
): Promise<OrganizationProfileView> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { profile: true },
  });
  if (!organization) throw errors.notFound('Organization');

  const logos = await primaryUrlsFor(
    MediaOwnerType.ORGANIZATION,
    [organizationId],
    MediaPurpose.LOGO,
  );

  return {
    organizationId,
    name: organization.name,
    type: organization.type,
    verificationStatus: organization.verificationStatus,
    logoUrl: logos.get(organizationId) ?? organization.logoUrl,
    city: organization.city,
    state: organization.state,
    tagline: organization.profile?.tagline ?? null,
    about: organization.profile?.about ?? organization.description,
    foundedYear: organization.profile?.foundedYear ?? null,
    employeeCount: organization.profile?.employeeCount ?? null,
    website: organization.profile?.website ?? null,
    serviceAreas: organization.profile?.serviceAreas ?? [],
    specialities: organization.profile?.specialities ?? [],
    certifications: organization.profile?.certifications ?? [],
    supportEmail: organization.profile?.supportEmail ?? organization.email,
    supportPhone: organization.profile?.supportPhone ?? organization.phone,
    publicSlug: organization.profile?.publicSlug ?? null,
    completionPercent: organization.profile?.completionPercent ?? 0,
    visibility: (organization.profile?.visibility ?? ProfileVisibility.PLATFORM) as ProfileVisibility,
  };
}

export interface DirectoryEntry {
  kind: 'organization' | 'person';
  id: string;
  name: string;
  subtitle: string | null;
  imageUrl: string | null;
  city: string | null;
  state: string | null;
  verified: boolean;
  slug: string | null;
}

/**
 * Organizations the caller has actually transacted with.
 *
 * Used to resolve PARTNERS visibility. Derived from orders rather than a
 * declared relationship list, because an order is evidence and a list is a
 * claim.
 */
async function partnerOrganizationIds(auth: AuthContext): Promise<Set<string>> {
  const own = auth.organizationId;
  if (!own) return new Set();

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { customerOrganizationId: own },
        { supplierOrganizationId: own },
        { fleetOrganizationId: own },
      ],
    },
    select: {
      customerOrganizationId: true,
      supplierOrganizationId: true,
      fleetOrganizationId: true,
    },
    take: 2000,
  });

  const partners = new Set<string>();
  for (const order of orders) {
    for (const id of [
      order.customerOrganizationId,
      order.supplierOrganizationId,
      order.fleetOrganizationId,
    ]) {
      if (id && id !== own) partners.add(id);
    }
  }
  return partners;
}

export async function searchDirectory(
  auth: AuthContext,
  query: ProfileDirectoryQuery,
): Promise<Paginated<DirectoryEntry>> {
  if (query.kind === 'people') return searchPeople(auth, query);
  return searchOrganizations(auth, query);
}

async function searchOrganizations(
  auth: AuthContext,
  query: ProfileDirectoryQuery,
): Promise<Paginated<DirectoryEntry>> {
  const partners = await partnerOrganizationIds(auth);

  const visibilityFilter: Prisma.OrganizationWhereInput = auth.isPlatformAdmin
    ? {}
    : {
        OR: [
          // Always my own organization.
          { id: auth.organizationId ?? '__none__' },
          // Anything opted in to platform-wide visibility, or with no profile
          // row yet — the default is PLATFORM and a missing row means default.
          { profile: { visibility: ProfileVisibility.PLATFORM } },
          { profile: null },
          // Partner-visible profiles, but only to actual partners.
          {
            AND: [
              { profile: { visibility: ProfileVisibility.PARTNERS } },
              { id: { in: [...partners] } },
            ],
          },
        ],
      };

  const where: Prisma.OrganizationWhereInput = {
    archivedAt: null,
    ...visibilityFilter,
    ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
    ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { city: { contains: query.search, mode: 'insensitive' } },
            { profile: { tagline: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [total, organizations] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      include: { profile: { select: { tagline: true, publicSlug: true } } },
      orderBy: [{ verificationStatus: 'asc' }, { name: 'asc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const logos = await primaryUrlsFor(
    MediaOwnerType.ORGANIZATION,
    organizations.map((organization) => organization.id),
    MediaPurpose.LOGO,
  );

  return {
    items: organizations.map((organization) => ({
      kind: 'organization' as const,
      id: organization.id,
      name: organization.name,
      subtitle: organization.profile?.tagline ?? organization.type.replace(/_/g, ' '),
      imageUrl: logos.get(organization.id) ?? organization.logoUrl,
      city: organization.city,
      state: organization.state,
      verified: organization.verificationStatus === 'VERIFIED',
      slug: organization.profile?.publicSlug ?? null,
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

/**
 * People search.
 *
 * Scoped to the caller's own organization unless they are a platform admin. A
 * cross-tenant people directory is a data-protection problem nobody asked for:
 * a fleet needs to find *businesses* on Saarthi, not other fleets' drivers.
 */
async function searchPeople(
  auth: AuthContext,
  query: ProfileDirectoryQuery,
): Promise<Paginated<DirectoryEntry>> {
  const organizationId = auth.organizationId;
  if (!organizationId && !auth.isPlatformAdmin) {
    throw errors.organizationRequired('Select an organization to browse its members.');
  }

  const where: Prisma.UserWhereInput = {
    ...(organizationId
      ? { memberships: { some: { organizationId, status: 'ACTIVE' } } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(query.city ? { profile: { city: { equals: query.city, mode: 'insensitive' } } } : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        profile: { select: { headline: true, city: true, state: true, publicSlug: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  const avatars = await primaryUrlsFor(
    MediaOwnerType.USER,
    users.map((user) => user.id),
    MediaPurpose.AVATAR,
  );

  return {
    items: users.map((user) => ({
      kind: 'person' as const,
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      subtitle: user.profile?.headline ?? null,
      imageUrl: avatars.get(user.id) ?? user.avatarUrl,
      city: user.profile?.city ?? null,
      state: user.profile?.state ?? null,
      verified: user.status === 'ACTIVE',
      slug: user.profile?.publicSlug ?? null,
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export interface SlugProfileView {
  kind: 'organization' | 'person';
  organization?: OrganizationProfileView;
  person?: {
    id: string;
    name: string;
    headline: string | null;
    bio: string | null;
    languages: string[];
    skills: string[];
    city: string | null;
    state: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
  };
}

export async function getBySlug(auth: AuthContext, slug: string): Promise<SlugProfileView> {
  const organizationProfile = await prisma.organizationProfile.findUnique({
    where: { publicSlug: slug },
    select: { organizationId: true, visibility: true },
  });

  if (organizationProfile) {
    if (!(await canViewOrganization(auth, organizationProfile))) {
      throw errors.notFound('Profile');
    }
    return {
      kind: 'organization',
      organization: await getOrganizationProfile(organizationProfile.organizationId),
    };
  }

  const userProfile = await prisma.userProfile.findUnique({
    where: { publicSlug: slug },
    include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
  });
  if (!userProfile) throw errors.notFound('Profile');

  // A person's profile is visible to their own organization, and platform-wide
  // only when they chose that.
  if (!auth.isPlatformAdmin && userProfile.visibility !== ProfileVisibility.PLATFORM) {
    const sharesOrganization = auth.organizationId
      ? (await prisma.membership.count({
          where: {
            userId: userProfile.userId,
            organizationId: auth.organizationId,
            status: 'ACTIVE',
          },
        })) > 0
      : false;
    if (!sharesOrganization && userProfile.userId !== auth.user.id) {
      throw errors.notFound('Profile');
    }
  }

  const [avatars, covers] = await Promise.all([
    primaryUrlsFor(MediaOwnerType.USER, [userProfile.userId], MediaPurpose.AVATAR),
    primaryUrlsFor(MediaOwnerType.USER, [userProfile.userId], MediaPurpose.COVER),
  ]);

  return {
    kind: 'person',
    person: {
      id: userProfile.user.id,
      name: `${userProfile.user.firstName} ${userProfile.user.lastName}`.trim(),
      headline: userProfile.headline,
      bio: userProfile.bio,
      languages: userProfile.languages,
      skills: userProfile.skills,
      city: userProfile.city,
      state: userProfile.state,
      avatarUrl: avatars.get(userProfile.userId) ?? userProfile.user.avatarUrl,
      coverUrl: covers.get(userProfile.userId) ?? null,
    },
  };
}

async function canViewOrganization(
  auth: AuthContext,
  profile: { organizationId: string; visibility: string },
): Promise<boolean> {
  if (auth.isPlatformAdmin) return true;
  if (profile.organizationId === auth.organizationId) return true;
  if (profile.visibility === ProfileVisibility.PLATFORM) return true;
  if (profile.visibility === ProfileVisibility.PARTNERS) {
    const partners = await partnerOrganizationIds(auth);
    return partners.has(profile.organizationId);
  }
  return false;
}
