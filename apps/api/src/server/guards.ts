import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import {
  type OrganizationType,
  type RoleName,
  VEHICLE_TRACKER,
  hasAnyPermission,
  hasPermission,
  isTrackerFeature,
  minimumTierFor,
  type Feature,
  type Permission,
} from '@saarthi/shared';
import { errors } from '../lib/errors';
import { config } from '../config/env';
import type { AuthContext } from '../auth/context';

/**
 * Authorization guards.
 *
 * Composed as Fastify preHandlers so each route declares its requirements
 * declaratively. All of them assume `authenticate` has already run; they throw
 * rather than return, so the central error handler produces the response.
 */

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw errors.unauthenticated();
  return request.auth;
}

/** The active tenant, or a 403 explaining that one must be selected. */
export function requireOrganizationId(request: FastifyRequest): string {
  const auth = requireAuth(request);
  if (!auth.organizationId) {
    throw errors.organizationRequired(
      auth.isPlatformAdmin
        ? 'This endpoint operates on a specific organization. Select one first.'
        : 'Your account is not linked to an organization yet.',
    );
  }
  return auth.organizationId;
}

export function requirePermission(...permissions: Permission[]): preHandlerHookHandler {
  return async function permissionGuard(request: FastifyRequest, _reply: FastifyReply) {
    const auth = requireAuth(request);
    if (!hasAnyPermission(auth.permissions, permissions)) {
      throw errors.forbidden(
        'You do not have permission to perform this action. Contact your fleet administrator if you need access.',
      );
    }
  };
}

export function requireAllPermissions(...permissions: Permission[]): preHandlerHookHandler {
  return async function permissionGuard(request: FastifyRequest, _reply: FastifyReply) {
    const auth = requireAuth(request);
    const missing = permissions.filter((permission) => !hasPermission(auth.permissions, permission));
    if (missing.length > 0) {
      throw errors.forbidden('You do not have permission to perform this action.');
    }
  };
}

export function requireRole(...roles: RoleName[]): preHandlerHookHandler {
  return async function roleGuard(request: FastifyRequest, _reply: FastifyReply) {
    const auth = requireAuth(request);
    const held = new Set<RoleName>([
      ...auth.user.roles,
      ...(auth.organization ? [auth.organization.membershipRole] : []),
    ]);
    if (!roles.some((role) => held.has(role))) {
      throw errors.forbidden('This area is restricted to a different account type.');
    }
  };
}

/**
 * Restrict a route to particular kinds of business.
 *
 * Some surfaces belong to one account type and no other: only a travel
 * operator sells tour packages, only an association runs an emergency queue.
 * A permission answers "may this person do it"; this answers "is this the
 * kind of organization that does it at all", and both must hold.
 *
 * Platform admins are exempt so support can always act on a tenant's behalf.
 */
export function requireOrganizationType(
  ...types: OrganizationType[]
): preHandlerHookHandler {
  return async function organizationTypeGuard(request: FastifyRequest, _reply: FastifyReply) {
    const auth = requireAuth(request);
    if (auth.isPlatformAdmin) return;

    const organization = auth.organization;
    if (!organization) throw errors.organizationRequired();

    if (!types.includes(organization.type)) {
      throw errors.forbidden(
        'This area is only available to a different type of Saarthi account. ' +
          'Register the appropriate account type to use it.',
      );
    }
  };
}

export function requirePlatformAdmin(): preHandlerHookHandler {
  return async function adminGuard(request: FastifyRequest, _reply: FastifyReply) {
    const auth = requireAuth(request);
    if (!auth.isPlatformAdmin) {
      throw errors.forbidden('This area is restricted to Saarthi platform administrators.');
    }
  };
}

/** Requires an active tenant on the request. */
export function requireOrganization(): preHandlerHookHandler {
  return async function organizationGuard(request: FastifyRequest, _reply: FastifyReply) {
    requireOrganizationId(request);
  };
}

/**
 * Why a caller cannot reach a gated capability.
 *
 * Split out because the two answers lead somewhere different. "Upgrade your
 * plan" is a billing screen; "fit a tracker" is a hardware purchase, and
 * telling a Business customer already on the top plan to upgrade would be
 * advice they cannot act on — the telemetry capabilities are not for sale on
 * any plan (see `TRACKER_ONLY_FEATURES` in the shared catalogue).
 */
function featureDenialMessage(feature: Feature): string {
  if (isTrackerFeature(feature)) {
    return (
      'This reads the vehicle itself, so it needs a Saarthi tracker fitted. ' +
      `A tracker is a one-time ${VEHICLE_TRACKER.priceOneTime} rupees per vehicle — until one is fitted, ` +
      'the driver app is the only source and its figures are estimates.'
    );
  }

  const tier = minimumTierFor(feature);
  if (!tier) return 'Your current subscription does not include this capability.';

  const label = `${tier.charAt(0)}${tier.slice(1).toLowerCase()}`;
  return `This is part of Saarthi ${label}. Change plan to unlock it.`;
}

/**
 * Subscription entitlement gate.
 *
 * Platform admins bypass it so support can always inspect a tenant. So does
 * every caller when `SUBSCRIPTION_ENFORCEMENT` is off, which is development
 * only — the config refuses to start a production server without it.
 */
export function requireFeature(feature: Feature): preHandlerHookHandler {
  return async function featureGuard(request: FastifyRequest, _reply: FastifyReply) {
    const auth = requireAuth(request);
    if (auth.isPlatformAdmin) return;
    if (!config.subscription.enforced) return;

    if (!auth.subscription || !auth.subscription.features.includes(feature)) {
      throw errors.featureNotAvailable(feature, featureDenialMessage(feature));
    }
  };
}

export function hasFeature(auth: AuthContext, feature: Feature): boolean {
  if (auth.isPlatformAdmin) return true;
  if (!config.subscription.enforced) return true;
  return auth.subscription?.features.includes(feature) ?? false;
}

/** Blocks demo/simulation endpoints unless DEMO_MODE is explicitly enabled. */
export function requireDemoMode(): preHandlerHookHandler {
  return async function demoGuard(_request: FastifyRequest, _reply: FastifyReply) {
    if (!config.demo.enabled) throw errors.demoDisabled();
  };
}

/**
 * Tenant isolation helper. Every service that loads an organization-owned
 * record passes it through here before returning it to the caller.
 */
export function assertTenantAccess(
  auth: AuthContext,
  recordOrganizationId: string | null | undefined,
  resource = 'record',
): void {
  if (auth.isPlatformAdmin) return;
  if (!recordOrganizationId) return;
  if (auth.organizationId !== recordOrganizationId) {
    // Deliberately reported as "not found" so an attacker cannot use the
    // difference between 403 and 404 to enumerate other tenants' ids.
    throw errors.notFound(resource);
  }
}

/**
 * Scope filter for list queries. A platform admin sees everything unless they
 * have selected a tenant; everyone else is pinned to their own organization.
 */
export function tenantScope(auth: AuthContext): { organizationId?: string } {
  if (auth.isPlatformAdmin && !auth.organizationId) return {};
  return { organizationId: auth.organizationId ?? '__none__' };
}
