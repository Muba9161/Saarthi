import {
  MembershipStatus,
  OrganizationType,
  PlanTier,
  ROLE_TO_ORGANIZATION_TYPE,
  RoleName,
  UserStatus,
  VerificationStatus,
  type AuthResult,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type SessionPayload,
  type UpdateProfileInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../database/prisma';
import { errors } from '../lib/errors';
import { config } from '../config/env';
import { logger } from '../lib/logger';
import { passwordHasher, verifyWithTimingGuard } from './password';
import {
  generateInviteCode,
  generateOpaqueToken,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
} from './tokens';
import { buildSessionPayload, loadUser, resolveActiveMembership } from './session.service';
import { createDefaultSubscription } from '../modules/subscriptions/entitlements.service';
import { AuditAction, recordAudit } from '../modules/audit/audit.service';

/**
 * Authentication use-cases.
 *
 * Everything that mutates identity state runs inside a transaction so a
 * half-created account can never exist, and every outcome — including failures
 * — produces an audit record.
 */

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
}

async function issueSession(
  userId: string,
  organizationId: string | null,
  roles: RoleName[],
  meta: RequestMeta,
): Promise<IssuedSession> {
  const refresh = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();

  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: refresh.hash,
      organizationId,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      ipAddress: meta.ipAddress,
      expiresAt,
    },
  });

  const access = signAccessToken({
    userId,
    sessionId: session.id,
    organizationId,
    roles,
  });

  return {
    accessToken: access.token,
    expiresIn: access.expiresIn,
    refreshToken: refresh.token,
    refreshExpiresAt: expiresAt,
    sessionId: session.id,
  };
}

async function toAuthResult(
  issued: IssuedSession,
  userId: string,
  organizationId: string | null,
): Promise<AuthResult & { refreshToken: string; refreshExpiresAt: Date }> {
  const session: SessionPayload = await buildSessionPayload(userId, organizationId);
  return {
    accessToken: issued.accessToken,
    expiresIn: issued.expiresIn,
    tokenType: 'Bearer',
    session,
    refreshToken: issued.refreshToken,
    refreshExpiresAt: issued.refreshExpiresAt,
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function uniqueInviteCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateInviteCode();
    const existing = await tx.organization.findUnique({ where: { inviteCode: code } });
    if (!existing) return code;
  }
  throw errors.internal('Could not allocate an organization invite code.');
}

export async function register(input: RegisterInput, meta: RequestMeta) {
  const passwordHash = await passwordHasher.hash(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const existingEmail = await tx.user.findUnique({ where: { email: input.email } });
    if (existingEmail) {
      throw errors.duplicate('An account already exists for this email address.', {
        fields: { email: ['An account already exists for this email address.'] },
      });
    }
    const existingPhone = await tx.user.findUnique({ where: { phone: input.phone } });
    if (existingPhone) {
      throw errors.duplicate('An account already exists for this mobile number.', {
        fields: { phone: ['An account already exists for this mobile number.'] },
      });
    }

    const role = await tx.role.findUnique({ where: { name: input.role } });
    if (!role) throw errors.internal('Role catalogue is not seeded. Run `npm run db:seed`.');

    const user = await tx.user.create({
      data: {
        email: input.email,
        phone: input.phone,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        status: UserStatus.ACTIVE,
        roles: { create: { roleId: role.id } },
      },
    });

    let organizationId: string;
    let createdOrganization = false;

    if (input.role === RoleName.DRIVER) {
      // A driver joins an existing fleet using its invite code.
      const code = (input.fleetInviteCode ?? '').trim().toUpperCase();
      const fleet = await tx.organization.findUnique({ where: { inviteCode: code } });
      if (!fleet || fleet.archivedAt) {
        throw errors.validation('That fleet invite code is not valid.', {
          fields: { fleetInviteCode: ['That fleet invite code is not valid.'] },
        });
      }
      if (fleet.type !== OrganizationType.FLEET_OWNER && fleet.type !== OrganizationType.ENTERPRISE) {
        throw errors.validation('That invite code does not belong to a fleet.', {
          fields: { fleetInviteCode: ['That invite code does not belong to a fleet.'] },
        });
      }
      organizationId = fleet.id;

      const duplicateLicence = await tx.driver.findFirst({
        where: { organizationId, licenseNumber: input.licenseNumber! },
      });
      if (duplicateLicence) {
        throw errors.duplicate('This licence number is already registered with the fleet.', {
          fields: { licenseNumber: ['This licence number is already registered with the fleet.'] },
        });
      }

      await tx.driver.create({
        data: {
          userId: user.id,
          organizationId,
          licenseNumber: input.licenseNumber!,
          licenseExpiryDate: input.licenseExpiryDate ?? null,
          verificationStatus: VerificationStatus.PENDING,
        },
      });
    } else {
      const organizationType = ROLE_TO_ORGANIZATION_TYPE[input.role] ?? OrganizationType.CUSTOMER;
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName!,
          type: organizationType,
          registrationNumber: input.registrationNumber ?? null,
          email: input.email,
          phone: input.phone,
          inviteCode: await uniqueInviteCode(tx),
          verificationStatus: VerificationStatus.PENDING,
        },
      });
      organizationId = organization.id;
      createdOrganization = true;

      // Marketplace participants get their domain profile immediately so the
      // supplier/customer dashboards have something to hang data off.
      if (organizationType === OrganizationType.SUPPLIER) {
        await tx.supplier.create({ data: { organizationId } });
      } else if (organizationType === OrganizationType.CUSTOMER) {
        await tx.customer.create({ data: { organizationId, primaryUserId: user.id } });
      }
    }

    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId,
        role: input.role,
        status: MembershipStatus.ACTIVE,
        isPrimary: true,
      },
    });

    return { user, organizationId, createdOrganization };
  });

  // Fleets, suppliers and customers start on a Pro trial so every feature can
  // be demonstrated; downgrades are handled by the subscription module.
  if (result.createdOrganization) {
    await createDefaultSubscription(result.organizationId, PlanTier.PRO);
  }

  const issued = await issueSession(
    result.user.id,
    result.organizationId,
    [input.role],
    meta,
  );

  await recordAudit({
    action: AuditAction.USER_REGISTERED,
    entityType: 'User',
    entityId: result.user.id,
    actorUserId: result.user.id,
    organizationId: result.organizationId,
    after: { email: input.email, role: input.role },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId ?? null,
  });

  return toAuthResult(issued, result.user.id, result.organizationId);
}

// ---------------------------------------------------------------------------
// Login / refresh / logout
// ---------------------------------------------------------------------------

export async function login(input: LoginInput, meta: RequestMeta) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { roles: { include: { role: true } } },
  });

  const passwordMatches = await verifyWithTimingGuard(input.password, user?.passwordHash);

  if (!user || !passwordMatches) {
    await recordAudit({
      action: AuditAction.USER_LOGIN_FAILED,
      entityType: 'User',
      entityId: user?.id ?? null,
      after: { email: input.email, reason: user ? 'bad_password' : 'unknown_email' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId ?? null,
    });
    throw errors.invalidCredentials();
  }

  if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DISABLED) {
    throw errors.forbidden(
      'This account is not active. Please contact Saarthi support for assistance.',
    );
  }

  // Opportunistically upgrade the stored hash if the cost factor has changed.
  if (passwordHasher.needsRehash(user.passwordHash)) {
    const rehashed = await passwordHasher.hash(input.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: rehashed } });
  }

  const loaded = await loadUser(user.id);
  const membership = loaded ? resolveActiveMembership(loaded, null) : null;
  const organizationId = membership?.organizationId ?? null;
  const roles = user.roles.map((entry) => entry.role.name as RoleName);

  const issued = await issueSession(user.id, organizationId, roles, meta);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    action: AuditAction.USER_LOGGED_IN,
    entityType: 'User',
    entityId: user.id,
    actorUserId: user.id,
    organizationId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId ?? null,
  });

  return toAuthResult(issued, user.id, organizationId);
}

export async function refresh(refreshToken: string, meta: RequestMeta) {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw errors.tokenInvalid('Your session has expired. Please sign in again.');
  }
  if (session.user.status !== UserStatus.ACTIVE) {
    throw errors.forbidden('This account is not active.');
  }

  // Rotate the refresh token on every use so a stolen token is single-use.
  const rotated = generateRefreshToken();
  const expiresAt = refreshTokenExpiry();

  await prisma.session.update({
    where: { id: session.id },
    data: {
      refreshTokenHash: rotated.hash,
      expiresAt,
      lastUsedAt: new Date(),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent?.slice(0, 400) ?? session.userAgent,
    },
  });

  const roles = session.user.roles.map((entry) => entry.role.name as RoleName);
  const access = signAccessToken({
    userId: session.userId,
    sessionId: session.id,
    organizationId: session.organizationId,
    roles,
  });

  return {
    accessToken: access.token,
    expiresIn: access.expiresIn,
    tokenType: 'Bearer' as const,
    session: await buildSessionPayload(session.userId, session.organizationId),
    refreshToken: rotated.token,
    refreshExpiresAt: expiresAt,
  };
}

export async function logout(refreshToken: string | undefined, sessionId?: string): Promise<void> {
  if (sessionId) {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return;
  }
  if (!refreshToken) return;
  await prisma.session.updateMany({
    where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Point an existing session at a different organization the user belongs to. */
export async function switchOrganization(
  userId: string,
  sessionId: string,
  organizationId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership || membership.status !== MembershipStatus.ACTIVE) {
    throw errors.forbidden('You are not an active member of that organization.');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!user) throw errors.unauthenticated();

  await prisma.session.update({ where: { id: sessionId }, data: { organizationId } });

  const access = signAccessToken({
    userId,
    sessionId,
    organizationId,
    roles: user.roles.map((entry) => entry.role.name as RoleName),
  });

  return {
    accessToken: access.token,
    expiresIn: access.expiresIn,
    tokenType: 'Bearer' as const,
    session: await buildSessionPayload(userId, organizationId),
  };
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  sessionId: string,
  input: ChangePasswordInput,
  meta: RequestMeta,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw errors.unauthenticated();

  const matches = await passwordHasher.verify(input.currentPassword, user.passwordHash);
  if (!matches) {
    throw errors.validation('Your current password is incorrect.', {
      fields: { currentPassword: ['Your current password is incorrect.'] },
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await passwordHasher.hash(input.newPassword) },
  });

  // Changing a password invalidates every other device.
  await revokeAllSessions(userId, sessionId);

  await recordAudit({
    action: AuditAction.USER_PASSWORD_CHANGED,
    entityType: 'User',
    entityId: userId,
    actorUserId: userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId ?? null,
  });
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Always resolves successfully so the endpoint cannot be used to discover
 * which email addresses have accounts. The token is returned only in
 * development, where there is no email provider configured.
 */
export async function requestPasswordReset(
  email: string,
  meta: RequestMeta,
): Promise<{ devToken?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return {};

  const { token, hash } = generateOpaqueToken(32);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  await recordAudit({
    action: AuditAction.USER_PASSWORD_RESET_REQUESTED,
    entityType: 'User',
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId ?? null,
  });

  const resetUrl = `${config.server.frontendUrl}/reset-password?token=${token}`;
  logger.info({ email, resetUrl }, 'Password reset link generated (local notification provider)');

  return config.isProduction ? {} : { devToken: token };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw errors.validation('This password reset link is invalid or has expired.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await passwordHasher.hash(newPassword) },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAudit({
    action: AuditAction.USER_PASSWORD_RESET_COMPLETED,
    entityType: 'User',
    entityId: record.userId,
    actorUserId: record.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId ?? null,
  });
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  organizationId: string | null,
): Promise<SessionPayload> {
  const before = await prisma.user.findUnique({ where: { id: userId } });
  if (!before) throw errors.notFound('User');

  if (input.phone && input.phone !== before.phone) {
    const taken = await prisma.user.findUnique({ where: { phone: input.phone } });
    if (taken && taken.id !== userId) {
      throw errors.duplicate('That mobile number is already in use.', {
        fields: { phone: ['That mobile number is already in use.'] },
      });
    }
  }

  const after = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
  });

  await recordAudit({
    action: AuditAction.USER_PROFILE_UPDATED,
    entityType: 'User',
    entityId: userId,
    actorUserId: userId,
    organizationId,
    before: { firstName: before.firstName, lastName: before.lastName, phone: before.phone },
    after: { firstName: after.firstName, lastName: after.lastName, phone: after.phone },
  });

  return buildSessionPayload(userId, organizationId);
}

export async function listSessions(userId: string) {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  return sessions;
}
