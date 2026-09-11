import {
  type AuthResult,
  type ChangePasswordInput,
  isPersonalRegistration,
  type LoginInput,
  MembershipStatus,
  OrganizationType,
  PlanTier,
  type RegisterInput,
  registrationRole,
  ROLE_TO_ORGANIZATION_TYPE,
  RoleName,
  type SessionPayload,
  type UpdateProfileInput,
  UserStatus,
  VerificationStatus,
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
import { provisionSignupOrder } from '../modules/subscriptions/signup-order.service';
import { provisionDriverCodeOnRegistration } from '../modules/qr/qr.service';
import { resolveJoinableFleet } from '../modules/organizations/fleet-invite.service';
import {
  attributeRegistration,
  liveAttributionFor,
} from '../modules/sales/referral.service';
import { linkLeadToOrganization } from '../modules/sales/lead.service';
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

  /*
   * The account type this registration creates.
   *
   * A Personal registrant is never asked, because they are not a business —
   * they own vehicles. `registrationRole` is the one place that rule lives, so
   * the form, the schema and this function cannot disagree about it.
   */
  const registrantRole = registrationRole(input);

  /*
   * Whether this is a person rather than a business.
   *
   * A Personal registrant is still seated as the owner of an organization
   * carrying their own name, because every membership, vehicle, document and
   * driver row hangs off one. It is a seat, not a company — and until this was
   * recorded, nothing downstream could tell the difference: the only question
   * anything could ask was "is there an organization?", and the answer is
   * always yes. That is why somebody who signed up for their own two cars was
   * offered the business documents screen and asked for a registration
   * certificate, a GSTIN and a bank mandate they will never have.
   */
  const personalRegistration = isPersonalRegistration(input);

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

    const role = await tx.role.findUnique({ where: { name: registrantRole } });
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
    /*
     * Carried out of the transaction for the payment descriptor: a customer
     * reading their bank statement should see the name they registered, not an
     * organization id.
     */
    const personalOrganizationName = `${input.firstName} ${input.lastName}`.trim();
    let organizationName = personalOrganizationName;
    // Set by the driver branch below, or by the Personal "I drive too" toggle.
    // Carried out of the transaction so the QR badge is issued once the rows
    // are actually committed.
    let driverId: string | null = null;

    if (registrantRole === RoleName.DRIVER) {
      const code = (input.fleetInviteCode ?? '').trim().toUpperCase();

      if (code) {
        // A driver who has their employer's code joins that fleet directly.
        const fleet = await resolveJoinableFleet(code, tx);
        organizationId = fleet.id;
      } else {
        /*
         * No code: the driver is signing up before an employer has one for
         * them, which is the commonest way a driver arrives.
         *
         * They still need an organization — every membership, driver row,
         * document and QR badge hangs off one — so they get a single-member
         * organization carrying their own name, exactly as an individual
         * customer does below. It is a seat, not a business: no Pro trial is
         * started on it, and `joinFleet` re-parents the driver out of it and
         * archives it the moment a real fleet's code is entered.
         */
        const personal = await tx.organization.create({
          data: {
            name: personalOrganizationName,
            type: OrganizationType.FLEET_OWNER,
            email: input.email,
            phone: input.phone,
            inviteCode: await uniqueInviteCode(tx),
            // Recorded, not just described above. Without this the only
            // question anything downstream could ask was "is there an
            // organization?", and the answer is always yes — which is how a
            // driver ended up being asked for a GST number and a business
            // registration certificate on the business documents screen.
            isPersonalSeat: true,
            verificationStatus: VerificationStatus.PENDING,
          },
        });
        organizationId = personal.id;
      }

      const duplicateLicence = await tx.driver.findFirst({
        where: { organizationId, licenseNumber: input.licenseNumber! },
      });
      if (duplicateLicence) {
        throw errors.duplicate('This licence number is already registered with the fleet.', {
          fields: { licenseNumber: ['This licence number is already registered with the fleet.'] },
        });
      }

      const driver = await tx.driver.create({
        data: {
          userId: user.id,
          organizationId,
          licenseNumber: input.licenseNumber!,
          licenseExpiryDate: input.licenseExpiryDate ?? null,
          verificationStatus: VerificationStatus.PENDING,
        },
      });
      driverId = driver.id;
    } else {
      const organizationType = ROLE_TO_ORGANIZATION_TYPE[registrantRole] ?? OrganizationType.CUSTOMER;
      const organization = await tx.organization.create({
        data: {
          // A customer may register as an individual — see
          // `ORGANIZATION_NAME_REQUIRED_ROLES`. The organization is still
          // created, because every membership, order and booking hangs off
          // one; it just carries the person's own name.
          name: input.organizationName?.trim() || `${input.firstName} ${input.lastName}`.trim(),
          type: organizationType,
          registrationNumber: input.registrationNumber ?? null,
          email: input.email,
          phone: input.phone,
          inviteCode: await uniqueInviteCode(tx),
          // A Personal account is one person's seat, exactly as an unattached
          // driver's is — see `personalRegistration` above. Business-only
          // destinations read this flag, so setting it here is what keeps
          // GST, the registration certificate and the bank mandate out of an
          // account that was never asked to be a business.
          isPersonalSeat: personalRegistration,
          verificationStatus: VerificationStatus.PENDING,
        },
      });
      organizationId = organization.id;
      createdOrganization = true;
      organizationName = organization.name;

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
        role: registrantRole,
        status: MembershipStatus.ACTIVE,
        isPrimary: true,
      },
    });

    /*
     * A Personal customer who drives one of their own vehicles.
     *
     * The case: somebody buys Personal for three cars, two driven by the
     * drivers he employs and one by himself. Without a driver profile of his
     * own he is not assignable to a vehicle, and the only way round it was to
     * invent a second account for himself — which then owns his trips, his
     * duty hours and his score under a different identity.
     *
     * So the profile is created against his own user, inside his own
     * organization, and he is assignable exactly like anybody else he employs.
     * His membership role stays FLEET_OWNER: he owns the vehicles and can also
     * drive them, which is the ordinary arrangement rather than a special case.
     */
    if (input.driveMyself && input.licenseNumber) {
      const self = await tx.driver.create({
        data: {
          userId: user.id,
          organizationId,
          licenseNumber: input.licenseNumber,
          licenseExpiryDate: input.licenseExpiryDate ?? null,
          verificationStatus: VerificationStatus.PENDING,
        },
      });
      driverId = self.id;
    }

    // The language chosen on the first step of registration. Written here
    // rather than left for the profile screen, so the very first authenticated
    // render is already in it — the account is created and read back in one
    // round trip, and a locale applied a screen later would mean the dashboard
    // arrives in English for somebody who just said they do not read it.
    await tx.userProfile.create({
      data: { userId: user.id, preferences: { locale: input.preferredLanguage } },
    });

    return { user, organizationId, createdOrganization, driverId, organizationName };
  });

  /*
   * The subscription the registrant chose.
   *
   * Only for an organization this registration created. A driver joining an
   * employer's fleet with an invite code must not be given a subscription of
   * their own — they are covered by their employer's — and a driver seated in a
   * placeholder organization has nothing to bill.
   *
   * The trial length is configuration rather than a constant, so a launch
   * promotion is an env change and not a deploy.
   */
  if (result.createdOrganization) {
    const tier = input.planTier ?? PlanTier.BUSINESS;

    await createDefaultSubscription(result.organizationId, tier, {
      billing: input.planBilling,
    });

    /*
     * The salesperson who brought this customer, if there was one.
     *
     * **Before `provisionSignupOrder` below**, and that ordering is
     * load-bearing rather than tidy. That call charges for the trackers and
     * vehicle top-ups priced on the signup card and, on success, calls
     * `qualifyPayment` — which credits whoever holds a live attribution *at
     * that moment*. Run afterwards it found nobody, so every digital referral
     * signup silently earned its salesperson nothing on the add-ons they had
     * just sold.
     *
     * After `createDefaultSubscription` for the opposite reason: linking the
     * salesperson's lead recomputes its stage from the customer's
     * subscription, so the subscription has to exist first. The trackers do
     * not need to — `qualifyPayment` recomputes every lead for the
     * organization once the charge lands, from the tracker state as it is by
     * then (see `advanceSalesRecords`).
     *
     * Still outside the registration transaction, so **a referral problem can
     * never cost somebody their account**: the user, the organization and the
     * membership are committed by here, and `captureRegistrationReferral`
     * swallows its own failures for the same reason
     * `provisionDriverCodeOnRegistration` does. A mistyped GODID, an
     * unverified salesperson or a customer another colleague already signed up
     * are all outcomes an operator can correct afterwards, and none of them is
     * worth losing a registration over.
     *
     * Only reached for an organization this registration created, so a driver
     * joining an employer's fleet is never credited as a new customer.
     */
    if (input.referralCode) {
      await captureRegistrationReferral({
        code: input.referralCode,
        organizationId: result.organizationId,
        userId: result.user.id,
        phone: input.phone,
        email: input.email,
      });
    }

    /*
     * The fleet size and trackers the registrant priced on the pricing card.
     *
     * After the subscription rather than inside it, because the top-ups hang
     * off a subscription that has to exist first. Deliberately not awaited
     * inside the registration transaction either: this talks to a payment
     * gateway, and a gateway timeout must not roll back somebody's account.
     *
     * It never throws — a declined charge leaves the tenant on the base plan
     * with a notification and a row to point at. See `provisionSignupOrder`.
     */
    if (input.planVehicles > 1 || input.planTrackers > 0) {
      await provisionSignupOrder({
        organizationId: result.organizationId,
        userId: result.user.id,
        organizationName: result.organizationName,
        customer: {
          name: `${input.firstName} ${input.lastName}`.trim(),
          email: input.email,
          phone: input.phone,
        },
        tier,
        order: {
          vehicles: input.planVehicles,
          trackers: input.planTrackers,
          billing: input.planBilling,
        },
      });
    }
  }

  /*
   * A driver's badge is issued with the account, not on request.
   *
   * Reached by both driver registrations and a Personal owner who ticked
   * "I drive too": either way there is now a driver profile, and a profile
   * without a badge is a driver who cannot be identified at a gate.
   *
   * After the transaction on purpose: the subscription lookup and the QR row
   * are not part of what makes a registration valid, and a driver must never
   * fail to get an account because their badge could not be written. The
   * helper swallows its own failures for that reason, and the badge screen
   * mints one on first open if this did not manage it.
   */
  if (result.driverId) {
    await provisionDriverCodeOnRegistration(
      result.driverId,
      result.organizationId,
      result.user.id,
    );
  }

  const issued = await issueSession(
    result.user.id,
    result.organizationId,
    [registrantRole],
    meta,
  );

  await recordAudit({
    action: AuditAction.USER_REGISTERED,
    entityType: 'User',
    entityId: result.user.id,
    actorUserId: result.user.id,
    organizationId: result.organizationId,
    after: { email: input.email, role: registrantRole, plan: input.planTier ?? null },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId ?? null,
  });

  return toAuthResult(issued, result.user.id, result.organizationId);
}

/**
 * Credit a new registration to the salesperson whose referral it arrived
 * through.
 *
 * Never throws. Every failure is logged and swallowed, because by the time this
 * runs the user, the organization and the subscription are committed and the
 * customer is signing in — see the call site.
 *
 * It does two things, in this order:
 *
 *   1. Attribute the customer, which refuses if a colleague already has a live
 *      attribution on them. "First valid attribution wins" is enforced by a
 *      partial unique index, not by this code, so a simultaneous registration
 *      cannot slip past it.
 *   2. Link the salesperson's own lead to the new organization, matched on the
 *      phone number or email they captured, so their pipeline connects to the
 *      real customer rather than sitting at SIGNUP_PENDING forever.
 *
 * Note what it does *not* do: create a commission. That waits for a successful
 * payment — see `qualifyCommissionForPayment`.
 */
async function captureRegistrationReferral(input: {
  code: string;
  organizationId: string;
  userId: string;
  phone: string;
  email: string;
}): Promise<void> {
  try {
    const outcome = await attributeRegistration({
      code: input.code,
      organizationId: input.organizationId,
      customerUserId: input.userId,
    });

    if (!outcome.attributed) {
      logger.info(
        { organizationId: input.organizationId, reason: outcome.reason },
        'Registration referral was not credited',
      );
      return;
    }

    const attribution = await liveAttributionFor(input.organizationId);
    if (attribution) {
      await linkLeadToOrganization({
        salesmanId: attribution.salesmanId,
        organizationId: input.organizationId,
        attributionId: attribution.id,
        phone: input.phone,
        email: input.email,
      });
    }
  } catch (error) {
    logger.error(
      { err: error, organizationId: input.organizationId },
      'Registration referral could not be recorded',
    );
  }
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
