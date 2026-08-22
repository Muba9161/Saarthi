import type {
  Feature,
  OrganizationType,
  Permission,
  PlanLimits,
  PlanTier,
  RoleName,
  UserStatus,
} from '@saarthi/shared';

/**
 * Everything the API knows about the caller, resolved once per request by the
 * authentication plugin and then used by every guard, service and audit write.
 * Nothing here is taken from the client — it is all derived from the verified
 * access token plus a database lookup.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  status: UserStatus;
  roles: RoleName[];
}

export interface AuthOrganization {
  id: string;
  name: string;
  type: OrganizationType;
  membershipRole: RoleName;
}

export interface AuthSubscription {
  planTier: PlanTier;
  planName: string;
  features: Feature[];
  /** The shared catalogue shape, so a new limit cannot be forgotten here. */
  limits: PlanLimits;
  active: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  /** Active tenant for this request. `null` only for platform admins. */
  organizationId: string | null;
  organization: AuthOrganization | null;
  /** Union of role permissions plus the membership role's permissions. */
  permissions: Permission[];
  /** Resolved subscription of the active organization. */
  subscription: AuthSubscription | null;
  /** Driver profile id when the caller is a driver. */
  driverId: string | null;
  isPlatformAdmin: boolean;
}
