import {
  DEFAULT_COVERAGE_RADIUS_KM,
  MembershipStatus,
  OrganizationType,
  RoleName,
  VerificationStatus,
  buildPaginationMeta,
  type AssociationListQuery,
  type CoverageAreaInput,
  type Paginated,
  type RegisterAssociationInput,
  type UpdateAssociationInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import type { AuthContext } from '../../auth/context';

/**
 * Truck association accounts.
 *
 * An association is an organization of type `TRUCK_ASSOCIATION` plus this
 * profile — not a separate account system. It signs in through the same login,
 * carries the same membership and RBAC machinery, and appears in the same
 * organization switcher as a fleet. What differs is its *grant*: the two
 * association roles hold no order, customer, financial, document or telemetry
 * permission at all, so the account can only ever see its own alert queue.
 *
 * Coverage matching is geographic. A highway incident has coordinates but no
 * reliable district label without a geocoder, so an association registers one
 * or more coverage points with a radius and Saarthi matches on distance. The
 * district and state strings are carried for display and filtering, never as
 * the authorisation boundary.
 */

export interface AssociationCoverageSummary {
  id: string;
  district: string;
  state: string;
  label: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export interface AssociationSummary {
  id: string;
  organizationId: string;
  name: string;
  district: string;
  state: string;
  addressLine: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  officialEmail: string;
  officialPhone: string;
  emergencyPhone: string;
  representativeName: string;
  representativeDesignation: string | null;
  representativePhone: string;
  representativeEmail: string | null;
  memberTruckCount: number | null;
  about: string | null;
  logoUrl: string | null;
  verificationStatus: VerificationStatus;
  acceptingAlerts: boolean;
  coverageAreas: AssociationCoverageSummary[];
  stats: {
    alertsReceived: number;
    alertsAcknowledged: number;
    alertsResolved: number;
    avgResponseMinutes: number | null;
  };
  verifiedAt: string | null;
  createdAt: string;
}

const associationInclude = {
  organization: true,
  coverageAreas: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.AssociationProfileInclude;

type AssociationRecord = Prisma.AssociationProfileGetPayload<{
  include: typeof associationInclude;
}>;

function toSummary(record: AssociationRecord): AssociationSummary {
  return {
    id: record.id,
    organizationId: record.organizationId,
    name: record.organization.name,
    district: record.district,
    state: record.state,
    addressLine: record.organization.addressLine,
    city: record.organization.city,
    latitude: record.organization.latitude,
    longitude: record.organization.longitude,
    officialEmail: record.officialEmail,
    officialPhone: record.officialPhone,
    emergencyPhone: record.emergencyPhone,
    representativeName: record.representativeName,
    representativeDesignation: record.representativeDesignation,
    representativePhone: record.representativePhone,
    representativeEmail: record.representativeEmail,
    memberTruckCount: record.memberTruckCount,
    about: record.about,
    logoUrl: record.organization.logoUrl,
    verificationStatus: record.organization.verificationStatus as VerificationStatus,
    acceptingAlerts: record.acceptingAlerts,
    coverageAreas: record.coverageAreas.map((area) => ({
      id: area.id,
      district: area.district,
      state: area.state,
      label: area.label,
      latitude: area.latitude,
      longitude: area.longitude,
      radiusKm: area.radiusKm,
    })),
    stats: {
      alertsReceived: record.alertsReceived,
      alertsAcknowledged: record.alertsAcknowledged,
      alertsResolved: record.alertsResolved,
      avgResponseMinutes: record.avgResponseMinutes,
    },
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Short human-friendly join code, matching the fleet convention. */
function inviteCode(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
    .padEnd(3, 'X');
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `ASN-${slug}-${suffix}`;
}

/**
 * Register an association for an existing signed-in user.
 *
 * The organization, the profile, the coverage areas and the caller's
 * membership are written in one transaction: an association with no
 * representative, or a representative with no association, is not a state worth
 * being able to reach.
 *
 * The account starts `PENDING`. Nothing is routed to it until a platform
 * reviewer verifies it — an unverified body receiving driver locations and
 * phone numbers would be exactly the leak section 9 of the spec forbids.
 */
export async function registerAssociation(
  auth: AuthContext,
  input: RegisterAssociationInput,
): Promise<AssociationSummary> {
  const existingMembership = await prisma.membership.findFirst({
    where: {
      userId: auth.user.id,
      status: MembershipStatus.ACTIVE,
      organization: { type: OrganizationType.TRUCK_ASSOCIATION },
    },
    include: { organization: { select: { name: true } } },
  });
  if (existingMembership) {
    throw errors.conflict(
      `You already represent ${existingMembership.organization.name}. Ask its administrator to add you to another association instead.`,
    );
  }

  const record = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.name,
        type: OrganizationType.TRUCK_ASSOCIATION,
        registrationNumber: input.registrationNumber ?? null,
        email: input.officialEmail,
        phone: input.officialPhone,
        addressLine: input.addressLine,
        city: input.city ?? null,
        state: input.state,
        postalCode: input.postalCode ?? null,
        latitude: input.latitude,
        longitude: input.longitude,
        inviteCode: inviteCode(input.name),
        verificationStatus: VerificationStatus.PENDING,
        logoUrl: input.logoUrl ?? null,
        description: input.about ?? null,
      },
    });

    await tx.membership.create({
      data: {
        userId: auth.user.id,
        organizationId: organization.id,
        role: RoleName.ASSOCIATION_ADMIN,
        status: MembershipStatus.ACTIVE,
        // Primary only when this is the user's first organization, so a fleet
        // owner who also represents an association keeps their fleet default.
        isPrimary: (await tx.membership.count({ where: { userId: auth.user.id } })) === 0,
      },
    });

    return tx.associationProfile.create({
      data: {
        organizationId: organization.id,
        district: input.district,
        state: input.state,
        officialEmail: input.officialEmail,
        officialPhone: input.officialPhone,
        emergencyPhone: input.emergencyPhone,
        representativeName: input.representativeName,
        representativeDesignation: input.representativeDesignation ?? null,
        representativePhone: input.representativePhone,
        representativeEmail: input.representativeEmail ?? null,
        memberTruckCount: input.memberTruckCount ?? null,
        about: input.about ?? null,
        coverageAreas: {
          create: input.coverageAreas.map((area) => ({
            district: area.district,
            state: area.state,
            label: area.label ?? null,
            latitude: area.latitude,
            longitude: area.longitude,
            radiusKm: area.radiusKm ?? DEFAULT_COVERAGE_RADIUS_KM,
          })),
        },
      },
      include: associationInclude,
    });
  });

  return toSummary(record);
}

/** The association the caller represents. */
export async function getOwnAssociation(auth: AuthContext): Promise<AssociationSummary> {
  if (!auth.organizationId) {
    throw errors.organizationRequired('Select your association first.');
  }
  const record = await prisma.associationProfile.findUnique({
    where: { organizationId: auth.organizationId },
    include: associationInclude,
  });
  if (!record) throw errors.notFound('Association');
  return toSummary(record);
}

export async function getAssociation(
  auth: AuthContext,
  associationId: string,
): Promise<AssociationSummary> {
  const record = await prisma.associationProfile.findUnique({
    where: { id: associationId },
    include: associationInclude,
  });
  if (!record) throw errors.notFound('Association');

  // An association may read only itself; the platform may read any.
  if (!auth.isPlatformAdmin && record.organizationId !== auth.organizationId) {
    throw errors.notFound('Association');
  }
  return toSummary(record);
}

export async function updateAssociation(
  auth: AuthContext,
  input: UpdateAssociationInput,
): Promise<AssociationSummary> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired('Select your association first.');

  const existing = await prisma.associationProfile.findUnique({ where: { organizationId } });
  if (!existing) throw errors.notFound('Association');

  await prisma.$transaction(async (tx) => {
    if (
      input.name ||
      input.addressLine ||
      input.city !== undefined ||
      input.state ||
      input.postalCode !== undefined ||
      input.latitude !== undefined ||
      input.longitude !== undefined ||
      input.logoUrl !== undefined ||
      input.about !== undefined ||
      input.registrationNumber !== undefined
    ) {
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.registrationNumber !== undefined
            ? { registrationNumber: input.registrationNumber ?? null }
            : {}),
          ...(input.addressLine ? { addressLine: input.addressLine } : {}),
          ...(input.city !== undefined ? { city: input.city ?? null } : {}),
          ...(input.state ? { state: input.state } : {}),
          ...(input.postalCode !== undefined ? { postalCode: input.postalCode ?? null } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl ?? null } : {}),
          ...(input.about !== undefined ? { description: input.about ?? null } : {}),
          ...(input.officialEmail ? { email: input.officialEmail } : {}),
          ...(input.officialPhone ? { phone: input.officialPhone } : {}),
        },
      });
    }

    await tx.associationProfile.update({
      where: { organizationId },
      data: {
        ...(input.district ? { district: input.district } : {}),
        ...(input.state ? { state: input.state } : {}),
        ...(input.officialEmail ? { officialEmail: input.officialEmail } : {}),
        ...(input.officialPhone ? { officialPhone: input.officialPhone } : {}),
        ...(input.emergencyPhone ? { emergencyPhone: input.emergencyPhone } : {}),
        ...(input.representativeName ? { representativeName: input.representativeName } : {}),
        ...(input.representativeDesignation !== undefined
          ? { representativeDesignation: input.representativeDesignation ?? null }
          : {}),
        ...(input.representativePhone ? { representativePhone: input.representativePhone } : {}),
        ...(input.representativeEmail !== undefined
          ? { representativeEmail: input.representativeEmail ?? null }
          : {}),
        ...(input.memberTruckCount !== undefined
          ? { memberTruckCount: input.memberTruckCount ?? null }
          : {}),
        ...(input.about !== undefined ? { about: input.about ?? null } : {}),
        ...(input.acceptingAlerts !== undefined ? { acceptingAlerts: input.acceptingAlerts } : {}),
      },
    });
  });

  return getOwnAssociation(auth);
}

/**
 * Replace the coverage areas.
 *
 * A full replace rather than a patch: coverage is the routing rule, and an
 * association editing its districts needs to see exactly what it will now
 * receive, not reason about a merge.
 */
export async function replaceCoverageAreas(
  auth: AuthContext,
  areas: CoverageAreaInput[],
): Promise<AssociationSummary> {
  const organizationId = auth.organizationId;
  if (!organizationId) throw errors.organizationRequired('Select your association first.');

  const profile = await prisma.associationProfile.findUnique({ where: { organizationId } });
  if (!profile) throw errors.notFound('Association');
  if (areas.length === 0) {
    throw errors.validation('An association must cover at least one area to receive alerts.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.associationCoverageArea.deleteMany({ where: { associationId: profile.id } });
    await tx.associationCoverageArea.createMany({
      data: areas.map((area) => ({
        associationId: profile.id,
        district: area.district,
        state: area.state,
        label: area.label ?? null,
        latitude: area.latitude,
        longitude: area.longitude,
        radiusKm: area.radiusKm ?? DEFAULT_COVERAGE_RADIUS_KM,
      })),
    });
  });

  return getOwnAssociation(auth);
}

/**
 * Platform-side association directory.
 *
 * Restricted to platform staff: one association must not be able to enumerate
 * the others, their representatives or their coverage.
 */
export async function listAssociations(
  auth: AuthContext,
  query: AssociationListQuery,
): Promise<Paginated<AssociationSummary>> {
  if (!auth.isPlatformAdmin) {
    throw errors.forbidden('The association directory is restricted to Saarthi platform staff.');
  }

  const where: Prisma.AssociationProfileWhereInput = {
    archivedAt: null,
    ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
    ...(query.district ? { district: { contains: query.district, mode: 'insensitive' } } : {}),
    ...(query.verificationStatus
      ? {
          organization: {
            verificationStatus: { in: query.verificationStatus as VerificationStatus[] },
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { organization: { name: { contains: query.search, mode: 'insensitive' } } },
            { representativeName: { contains: query.search, mode: 'insensitive' } },
            { district: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, records] = await Promise.all([
    prisma.associationProfile.count({ where }),
    prisma.associationProfile.findMany({
      where,
      include: associationInclude,
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
 * Platform verification decision.
 *
 * Verification is what switches routing on, so it is a platform-only action and
 * always audited by the caller. Suspending an association stops new alerts
 * immediately without deleting its history.
 */
export async function setAssociationVerification(
  auth: AuthContext,
  associationId: string,
  status: VerificationStatus,
): Promise<AssociationSummary> {
  if (!auth.isPlatformAdmin) {
    throw errors.forbidden('Only Saarthi platform staff can verify an association.');
  }

  const profile = await prisma.associationProfile.findUnique({ where: { id: associationId } });
  if (!profile) throw errors.notFound('Association');

  await prisma.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: profile.organizationId },
      data: { verificationStatus: status },
    });
    await tx.associationProfile.update({
      where: { id: associationId },
      data: {
        verifiedAt: status === VerificationStatus.VERIFIED ? new Date() : null,
        verifiedById: status === VerificationStatus.VERIFIED ? auth.user.id : null,
        // A suspended association stops receiving, but keeps its records.
        ...(status === VerificationStatus.SUSPENDED ? { acceptingAlerts: false } : {}),
      },
    });
  });

  const record = await prisma.associationProfile.findUniqueOrThrow({
    where: { id: associationId },
    include: associationInclude,
  });
  return toSummary(record);
}
