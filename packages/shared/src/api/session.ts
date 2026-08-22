/**
 * The authenticated-session contract. `GET /api/v1/auth/me` returns exactly
 * this shape, and the React auth provider stores it verbatim, so permissions,
 * entitlements and tenant context never have to be re-derived on the client.
 */

import type { Feature, PlanLimits } from '../domain/entitlements';
import type {
  MembershipStatus,
  OrganizationType,
  PlanTier,
  RoleName,
  SubscriptionStatus,
  UserStatus,
  VerificationStatus,
} from '../domain/enums';
import type { Permission } from '../domain/permissions';

export interface SessionOrganization {
  id: string;
  name: string;
  type: OrganizationType;
  verificationStatus: VerificationStatus;
  membershipRole: RoleName;
  membershipStatus: MembershipStatus;
}

export interface SessionSubscription {
  planTier: PlanTier;
  planName: string;
  status: SubscriptionStatus;
  startsAt: string;
  endsAt: string | null;
  features: Feature[];
  limits: PlanLimits;
}

export interface SessionDriverProfile {
  id: string;
  licenseNumber: string;
  licenseExpiryDate: string | null;
  verificationStatus: VerificationStatus;
  currentTruckId: string | null;
  overallScore: number | null;
}

export interface SessionUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  status: UserStatus;
  roles: RoleName[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionPayload {
  user: SessionUser;
  /** Active tenant. `null` for a platform admin operating outside a tenant. */
  organization: SessionOrganization | null;
  /** Every organization the user belongs to — powers the org switcher. */
  organizations: SessionOrganization[];
  permissions: Permission[];
  subscription: SessionSubscription | null;
  driver: SessionDriverProfile | null;
  /** Server-confirmed demo/simulation availability. */
  demoMode: boolean;
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthResult extends AuthTokens {
  session: SessionPayload;
}

/** Claims embedded in the signed access token. Kept intentionally small. */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
  org: string | null;
  roles: RoleName[];
  iat: number;
  exp: number;
}
