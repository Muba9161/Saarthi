import {
  MembershipStatus,
  RoleName,
  SubscriptionStatus,
  permissionsForRoles,
  resolveLocale,
  type OrganizationType,
  type Permission,
  type SessionOrganization,
  type SessionPayload,
  type UserStatus,
  type VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../database/prisma';
import { errors } from '../lib/errors';
import { config } from '../config/env';
import { resolveSubscription } from '../modules/subscriptions/entitlements.service';
import { hasEmployer } from '../modules/organizations/fleet-invite.service';
import type { AuthContext } from './context';

/**
 * Session assembly.
 *
 * A single query graph resolves who the caller is, which tenant they are
 * operating in, what they may do there and which plan features are unlocked.
 * Both the HTTP `me` endpoint and the per-request `AuthContext` are derived
 * from the same source, so the client can never see a permission the API
 * would not honour.
 */

const userInclude = {
  roles: { include: { role: true } },
  memberships: {
    where: { status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] } },
    include: { organization: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
  driverProfile: true,
  profile: { select: { preferences: true } },
} as const;

type LoadedUser = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

export async function loadUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: userInclude as never,
  }) as Promise<
    | (Awaited<ReturnType<typeof prisma.user.findUnique>> & {
        roles: { role: { name: RoleName } }[];
        memberships: {
          id: string;
          organizationId: string;
          role: RoleName;
          status: MembershipStatus;
          isPrimary: boolean;
          organization: {
            id: string;
            name: string;
            type: OrganizationType;
            verificationStatus: VerificationStatus;
            isPersonalSeat: boolean;
            billingArchivedAt: Date | null;
            dataPurgeAt: Date | null;
          };
        }[];
        driverProfile: {
          id: string;
          organizationId: string;
          licenseNumber: string | null;
          licenseExpiryDate: Date | null;
          verificationStatus: VerificationStatus;
          currentTruckId: string | null;
          overallScore: number | null;
          archivedAt: Date | null;
        } | null;
        profile: { preferences: unknown } | null;
      })
    | null
  >;
}

/**
 * The language this account reads Saarthi in.
 *
 * Stored inside the profile preferences blob, so it is read defensively: an
 * unrecognised or hand-edited value resolves to English rather than reaching
 * the client and being applied to every screen.
 */
function localeOf(user: LoadedUser): string {
  const preferences = user.profile?.preferences;
  const stored =
    preferences && typeof preferences === 'object' && !Array.isArray(preferences)
      ? (preferences as Record<string, unknown>).locale
      : null;

  return resolveLocale(typeof stored === 'string' ? stored : null);
}

function globalRoles(user: LoadedUser): RoleName[] {
  return user.roles.map((entry) => entry.role.name);
}

function toSessionOrganization(membership: LoadedUser['memberships'][number]): SessionOrganization {
  return {
    id: membership.organization.id,
    name: membership.organization.name,
    type: membership.organization.type,
    verificationStatus: membership.organization.verificationStatus,
    membershipRole: membership.role,
    membershipStatus: membership.status,
    isPersonalSeat: membership.organization.isPersonalSeat,
    billingArchivedAt: membership.organization.billingArchivedAt?.toISOString() ?? null,
    dataPurgeAt: membership.organization.dataPurgeAt?.toISOString() ?? null,
  };
}

/**
 * Pick the tenant for this request: the explicitly requested one when the user
 * is a member of it, otherwise their primary membership.
 */
export function resolveActiveMembership(
  user: LoadedUser,
  requestedOrganizationId: string | null,
): LoadedUser['memberships'][number] | null {
  const active = user.memberships.filter(
    (membership) => membership.status === MembershipStatus.ACTIVE,
  );
  if (active.length === 0) return null;

  if (requestedOrganizationId) {
    const match = active.find(
      (membership) => membership.organizationId === requestedOrganizationId,
    );
    if (match) return match;
    // A platform admin may operate outside their own tenant.
    if (globalRoles(user).includes(RoleName.PLATFORM_ADMIN)) return null;
    throw errors.tenantMismatch('You are not a member of the requested organization.');
  }

  return active.find((membership) => membership.isPrimary) ?? active[0] ?? null;
}

/**
 * Whether this person drives for the organization they are working in.
 *
 * True for an employed driver, and for an owner or manager who added themselves
 * to their own driver list to drive one of the account's vehicles. A driver
 * profile held in some other organization does not count here.
 */
function drivesFor(
  user: LoadedUser,
  membership: LoadedUser['memberships'][number] | null,
): boolean {
  const profile = user.driverProfile;
  return Boolean(
    membership && profile && !profile.archivedAt && profile.organizationId === membership.organizationId,
  );
}

export function resolvePermissions(
  user: LoadedUser,
  membership: LoadedUser['memberships'][number] | null,
): Permission[] {
  const roles = new Set<RoleName>(globalRoles(user));
  if (membership) roles.add(membership.role);
  /*
   * An account holder who drives also gets what a driver can do.
   *
   * An owner who assigns himself a vehicle keeps his owner role, which on its
   * own cannot raise an SOS, sign on to a vehicle or run the driver app. Those
   * are the driver's permissions, so they come with the driver profile. The
   * services limit each one to the caller's own driver record, exactly as they
   * do for an employed driver, so this reveals nothing about anybody else.
   */
  if (drivesFor(user, membership)) roles.add(RoleName.DRIVER);
  return permissionsForRoles([...roles]);
}

export async function buildAuthContext(
  userId: string,
  sessionId: string,
  requestedOrganizationId: string | null,
): Promise<AuthContext> {
  const user = await loadUser(userId);
  if (!user) throw errors.unauthenticated('Your account could not be found.');

  if (user.status !== 'ACTIVE') {
    throw errors.forbidden(
      user.status === 'SUSPENDED'
        ? 'Your account has been suspended. Contact Saarthi support.'
        : 'Your account is not active.',
    );
  }

  const membership = resolveActiveMembership(user, requestedOrganizationId);
  const roles = globalRoles(user);
  const isPlatformAdmin = roles.includes(RoleName.PLATFORM_ADMIN);
  const organizationId = membership?.organizationId ?? null;

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      status: user.status as UserStatus,
      roles,
    },
    sessionId,
    organizationId,
    organization: membership
      ? {
          id: membership.organization.id,
          name: membership.organization.name,
          type: membership.organization.type,
          membershipRole: membership.role,
          isPersonalSeat: membership.organization.isPersonalSeat,
          billingArchivedAt: membership.organization.billingArchivedAt,
          dataPurgeAt: membership.organization.dataPurgeAt,
        }
      : null,
    permissions: resolvePermissions(user, membership),
    subscription: organizationId ? await resolveSubscription(organizationId) : null,
    driverId: user.driverProfile?.id ?? null,
    isPlatformAdmin,
  };
}

/** Full session payload returned to the client by `GET /auth/me`. */
export async function buildSessionPayload(
  userId: string,
  requestedOrganizationId: string | null,
): Promise<SessionPayload> {
  const user = await loadUser(userId);
  if (!user) throw errors.unauthenticated('Your account could not be found.');

  const membership = resolveActiveMembership(user, requestedOrganizationId);
  const organizationId = membership?.organizationId ?? null;
  const subscription = organizationId ? await resolveSubscription(organizationId) : null;

  /*
   * Read against the driver's own organization rather than the active tenant,
   * so the answer does not change when a driver who also belongs elsewhere
   * switches organizations.
   */
  const awaitingFleet = user.driverProfile
    ? !(await hasEmployer(user.driverProfile.organizationId))
    : false;

  return {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      avatarUrl: user.avatarUrl,
      status: user.status as UserStatus,
      roles: globalRoles(user),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    organization: membership ? toSessionOrganization(membership) : null,
    organizations: user.memberships.map(toSessionOrganization),
    permissions: resolvePermissions(user, membership),
    subscription: subscription
      ? {
          planTier: subscription.planTier,
          planName: subscription.planName,
          status: subscription.active ? SubscriptionStatus.ACTIVE : SubscriptionStatus.EXPIRED,
          startsAt: new Date().toISOString(),
          endsAt: null,
          features: subscription.features,
          limits: subscription.limits,
        }
      : null,
    driver: user.driverProfile
      ? {
          id: user.driverProfile.id,
          licenseNumber: user.driverProfile.licenseNumber,
          licenseExpiryDate: user.driverProfile.licenseExpiryDate?.toISOString() ?? null,
          verificationStatus: user.driverProfile.verificationStatus,
          currentTruckId: user.driverProfile.currentTruckId,
          overallScore: user.driverProfile.overallScore,
          awaitingFleet,
        }
      : null,
    demoMode: config.demo.enabled,
    locale: localeOf(user),
  };
}
