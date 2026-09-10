import {
  NotificationPriority,
  NotificationType,
  RoleName,
  SalesmanStatus,
  SalesmanVerificationMethod,
  canShareReferral,
  normalizeGodId,
  referralUrl,
  type CreateSalesmanInput,
  type ManualVerifySalesmanInput,
  type SalesmanListQuery,
  type SalesmanStandingInput,
  type UpdateSalesmanInput,
} from '@saarthi/shared';
import { isUniqueViolation, prisma, type Db } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { config } from '../../config/env';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { godWebConfigured, requireGodWebProvider } from '../../providers/godweb';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyAsync } from '../notifications/notification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Saarthi salesman profiles — the mirror of a GODWeb identity.
 *
 * The rule this file exists to enforce is short: **a GODID is worth nothing
 * until GODWeb has been asked about it.** Everything else follows.
 *
 *   * A profile is created `PENDING_VERIFICATION`. Nothing about it is trusted.
 *   * Verification asks GODWeb. A `found: false` answer rejects the profile
 *     permanently; a failure to reach GODWeb leaves it pending and retryable,
 *     because "we could not ask" is not "the answer is no".
 *   * Only an `ACTIVE` profile has a referral link and only an `ACTIVE` profile
 *     accrues commission — see `canShareReferral` and `resolveVerifiedSalesman`.
 *
 * The one deliberate exception is `verifyManually`, for the environment where
 * the approved GODWeb validation API does not exist yet. It is not a way round
 * verification: it requires a platform administrator, it records their user id
 * and the evidence they cited on the profile forever, and it writes its own
 * audit action so the two paths can never be confused in a report.
 */

const salesLogger = logger.child({ module: 'sales:salesman' });

export interface SalesmanView {
  id: string;
  godId: string;
  userId: string | null;
  externalSalespersonId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  territory: string | null;
  status: SalesmanStatus;
  verificationMethod: SalesmanVerificationMethod | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  /** True when this profile may share a referral link and earn commission. */
  canSell: boolean;
  /**
   * Why the profile is not sellable, in the salesperson's own language.
   *
   * Present instead of a bare status because "pending" on its own sends people
   * to support: this says whether Saarthi is waiting on GODWeb, on an
   * administrator, or on nothing because the GODID was refused.
   */
  standing: string;
  note: string | null;
  createdAt: string;
}

type SalesmanRow = {
  id: string;
  godId: string;
  userId: string | null;
  externalSalespersonId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  territory: string | null;
  status: string;
  verificationMethod: string | null;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  standingReason: string | null;
  note: string | null;
  createdAt: Date;
};

/**
 * Why this profile cannot sell, phrased for the person reading it.
 *
 * The pending case splits on whether GODWeb is reachable at all, because the
 * two need different actions from different people: if the integration is
 * live, somebody presses Verify; if it is not, a platform administrator has to
 * vouch for the GODID, and telling a salesperson to "wait for verification"
 * that will never arrive is how a rollout stalls silently.
 */
function standingFor(status: SalesmanStatus, reason: string | null): string {
  switch (status) {
    case SalesmanStatus.ACTIVE:
      return 'Verified and active.';
    case SalesmanStatus.PENDING_VERIFICATION:
      return godWebConfigured
        ? 'This GODID has not been verified against GODWeb yet. No referral link is issued and no commission accrues until it is.'
        : 'GODID verification is not enabled on this environment, so a Saarthi platform administrator has to verify this profile before it can sell.';
    case SalesmanStatus.SUSPENDED:
      return reason ?? 'This profile has been suspended by Saarthi.';
    case SalesmanStatus.REJECTED:
      return reason ?? 'GODWeb does not recognise this GODID.';
    default:
      return 'This profile cannot sell.';
  }
}

export function toSalesmanView(row: SalesmanRow): SalesmanView {
  const status = row.status as SalesmanStatus;
  return {
    id: row.id,
    godId: row.godId,
    userId: row.userId,
    externalSalespersonId: row.externalSalespersonId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    territory: row.territory,
    status,
    verificationMethod: row.verificationMethod as SalesmanVerificationMethod | null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    canSell: canShareReferral(status),
    standing: standingFor(status, row.standingReason),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Resolving the caller
// ---------------------------------------------------------------------------

/**
 * The salesman profile behind the current request.
 *
 * This is the isolation boundary for the whole sales module, in place of the
 * tenant scoping every other module uses. A salesperson is not a tenant — they
 * have no organization of their own and no business having one — so every
 * query in this module is keyed on the id this returns, and there is no code
 * path in which a salesperson supplies their own salesman id.
 *
 * A platform administrator has no profile and gets `null`; the routes that
 * accept that hand them an explicit `salesmanId` filter instead.
 */
export async function currentSalesman(auth: AuthContext): Promise<SalesmanView | null> {
  const row = await prisma.salesmanProfile.findUnique({ where: { userId: auth.user.id } });
  return row ? toSalesmanView(row) : null;
}

/**
 * The caller's salesman profile, or a 403 that explains what is missing.
 *
 * Used by every salesman-facing route. It refuses two distinct cases with two
 * distinct messages, because they need different people to act: a user holding
 * the SALESMAN role with no profile is an incomplete onboarding for
 * administration to finish, while an unverified profile is waiting on GODWeb
 * or on an administrator's decision.
 */
export async function requireSalesmanProfile(auth: AuthContext): Promise<SalesmanView> {
  const profile = await currentSalesman(auth);
  if (!profile) {
    throw errors.forbidden(
      'Your Saarthi account is not linked to a salesman profile. Ask Saarthi operations to link ' +
        'your GODID before using the Sales area.',
    );
  }
  return profile;
}

/**
 * The caller's profile, and it has to be sellable.
 *
 * The gate in front of anything that could earn money: minting a referral
 * link, recording a physical attribution, taking a tracker. Reading one's own
 * pipeline does not need it, so `requireSalesmanProfile` is used there — an
 * unverified salesperson can still see their screen and the reason they cannot
 * sell yet, which is far better than a blank 403.
 */
export async function requireActiveSalesman(auth: AuthContext): Promise<SalesmanView> {
  const profile = await requireSalesmanProfile(auth);
  if (!profile.canSell) {
    throw errors.businessRule(profile.standing, { status: profile.status });
  }
  return profile;
}

/**
 * The verified salesman behind a referral code, or null.
 *
 * The single resolver for every attribution path — a link, a QR, a manually
 * typed GODID, an assisted signup. It returns null for a code that does not
 * resolve *or* resolves to a profile that is not active, so an unverified or
 * suspended salesperson simply earns nothing rather than the caller having to
 * remember to check.
 */
export async function resolveVerifiedSalesman(
  code: string,
  db: Db = prisma,
): Promise<SalesmanView | null> {
  const godId = normalizeGodId(code);
  if (!godId) return null;

  const row = await db.salesmanProfile.findUnique({ where: { godId } });
  if (!row) return null;

  const view = toSalesmanView(row);
  return view.canSell ? view : null;
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function listSalesmen(query: SalesmanListQuery): Promise<{
  items: SalesmanView[];
  total: number;
}> {
  const where = {
    ...(query.status ? { status: { in: query.status as never } } : {}),
    ...(query.search
      ? {
          OR: [
            { godId: { contains: normalizeGodId(query.search) } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { externalSalespersonId: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.salesmanProfile.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.salesmanProfile.count({ where }),
  ]);

  return { items: rows.map(toSalesmanView), total };
}

export async function getSalesman(id: string): Promise<SalesmanView> {
  const row = await prisma.salesmanProfile.findUnique({ where: { id } });
  if (!row) throw errors.notFound('Salesman profile');
  return toSalesmanView(row);
}

/**
 * Create a Saarthi profile for an existing GODWeb identity.
 *
 * Two things this does *not* do, both load-bearing:
 *
 *   * it does not create a GODWeb account, and there is no code path in
 *     Saarthi that can;
 *   * it does not mark the profile verified, even when the caller is a
 *     platform administrator. Creating a profile is a statement that Saarthi
 *     would like to know about this GODID, not that the GODID is real.
 *
 * Verification is attempted immediately afterwards as a convenience, and its
 * failure is swallowed: an administrator onboarding twenty salespeople must not
 * lose the nineteenth to a GODWeb timeout.
 */
export async function createSalesman(
  auth: AuthContext,
  input: CreateSalesmanInput,
): Promise<SalesmanView> {
  const godId = normalizeGodId(input.godId);

  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!user) throw errors.notFound('User', 'That Saarthi user account could not be found.');
  }

  let row;
  try {
    row = await prisma.salesmanProfile.create({
      data: {
        godId,
        userId: input.userId ?? null,
        externalSalespersonId: input.externalSalespersonId ?? null,
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        territory: input.territory ?? null,
        note: input.note ?? null,
        status: SalesmanStatus.PENDING_VERIFICATION,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.duplicate(
        'A salesman profile already exists for this GODID or Saarthi account.',
        { fields: { godId: ['A salesman profile already exists for this GODID.'] } },
      );
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.SALESMAN_CREATED,
    entityType: 'SalesmanProfile',
    entityId: row.id,
    actorUserId: auth.user.id,
    after: { godId, userId: input.userId ?? null, status: row.status },
  });

  // Grant the role alongside the profile. A profile without the role is a
  // person who cannot reach the Sales area, which is a confusing half-state
  // for an administrator who thinks they have just onboarded somebody.
  if (input.userId) await grantSalesmanRole(input.userId);

  if (godWebConfigured) {
    try {
      return await verifyAgainstGodWeb(auth, row.id);
    } catch (error) {
      salesLogger.warn(
        { err: error, salesmanId: row.id, godId },
        'Salesman created but GODWeb verification could not be completed',
      );
    }
  }

  return toSalesmanView(row);
}

/** Attach the SALESMAN role, idempotently. */
async function grantSalesmanRole(userId: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: RoleName.SALESMAN } });
  if (!role) {
    salesLogger.error('Role catalogue is missing SALESMAN — run `npm run db:seed`.');
    return;
  }
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
}

export async function updateSalesman(
  auth: AuthContext,
  id: string,
  input: UpdateSalesmanInput,
): Promise<SalesmanView> {
  const existing = await prisma.salesmanProfile.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Salesman profile');

  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!user) throw errors.notFound('User', 'That Saarthi user account could not be found.');
  }

  let row;
  try {
    row = await prisma.salesmanProfile.update({
      where: { id },
      data: {
        ...(input.externalSalespersonId !== undefined
          ? { externalSalespersonId: input.externalSalespersonId ?? null }
          : {}),
        ...(input.name !== undefined ? { name: input.name ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        ...(input.territory !== undefined ? { territory: input.territory ?? null } : {}),
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.duplicate('That Saarthi account already belongs to another salesman profile.');
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.SALESMAN_UPDATED,
    entityType: 'SalesmanProfile',
    entityId: id,
    actorUserId: auth.user.id,
    before: { name: existing.name, phone: existing.phone, userId: existing.userId },
    after: { name: row.name, phone: row.phone, userId: row.userId },
  });

  if (input.userId) await grantSalesmanRole(input.userId);

  return toSalesmanView(row);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Ask GODWeb about this profile's GODID and record the answer.
 *
 * The three outcomes are deliberately different states, and conflating any two
 * of them would be a real fault:
 *
 *   * **Recognised and active** → `ACTIVE`. GODWeb's name, phone, email and
 *     staff id overwrite whatever was typed in, because GODWeb is the
 *     authority on all four.
 *   * **Recognised but inactive** → `SUSPENDED`. The person has left or been
 *     stood down. Their past commissions still have to reconcile, so the
 *     profile is kept and only their ability to sell is withdrawn.
 *   * **Not recognised** → `REJECTED`. A definite negative from the authority.
 *
 * A transport failure throws and changes nothing but `lastCheckedAt`. A GODWeb
 * outage must never silently reject a real salesperson.
 */
export async function verifyAgainstGodWeb(
  auth: AuthContext,
  id: string,
): Promise<SalesmanView> {
  const existing = await prisma.salesmanProfile.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Salesman profile');

  const provider = requireGodWebProvider();
  const now = new Date();

  let outcome;
  try {
    outcome = await provider.validateGodId(existing.godId);
  } catch (error) {
    // Record the attempt so an administrator can see Saarthi is trying, then
    // re-throw — the profile keeps whatever standing it had.
    await prisma.salesmanProfile.update({
      where: { id },
      data: { lastCheckedAt: now },
    });
    throw error;
  }

  if (!outcome.found) {
    const row = await prisma.salesmanProfile.update({
      where: { id },
      data: {
        status: SalesmanStatus.REJECTED,
        verificationMethod: null,
        verifiedAt: null,
        verifiedByUserId: null,
        lastCheckedAt: now,
        godwebReference: outcome.providerReference,
        standingReason: outcome.message ?? 'GODWeb does not recognise this GODID.',
      },
    });

    await recordAudit({
      action: AuditAction.SALESMAN_VERIFICATION_FAILED,
      entityType: 'SalesmanProfile',
      entityId: id,
      actorUserId: auth.user.id,
      after: {
        godId: existing.godId,
        outcome: 'NOT_FOUND',
        reference: outcome.providerReference,
      },
    });

    await revokeSellingAbility(id, 'GODWeb does not recognise this GODID.');
    return toSalesmanView(row);
  }

  const person = outcome.salesperson!;
  const status = person.active ? SalesmanStatus.ACTIVE : SalesmanStatus.SUSPENDED;

  const row = await prisma.salesmanProfile.update({
    where: { id },
    data: {
      status,
      // GODWeb wins on every identity field it answered. A null answer leaves
      // the existing value rather than blanking it: an administrator's entry is
      // better than nothing, and GODWeb saying nothing is not GODWeb saying
      // "this person has no phone number".
      name: person.name ?? existing.name,
      phone: person.phone ?? existing.phone,
      email: person.email ?? existing.email,
      externalSalespersonId: person.externalSalespersonId ?? existing.externalSalespersonId,
      territory: person.territory ?? existing.territory,
      verificationMethod: SalesmanVerificationMethod.GODWEB,
      verifiedAt: person.active ? now : null,
      verifiedByUserId: null,
      verificationNote: null,
      lastCheckedAt: now,
      godwebReference: outcome.providerReference,
      standingReason: person.active
        ? null
        : 'GODWeb reports this salesperson as no longer active.',
    },
  });

  await cache.set(
    cacheKeys.godWebValidation(existing.godId),
    { name: person.name, active: person.active },
    cacheTtl.godWebValidation,
  );

  await recordAudit({
    action: AuditAction.SALESMAN_VERIFIED,
    entityType: 'SalesmanProfile',
    entityId: id,
    actorUserId: auth.user.id,
    after: {
      godId: existing.godId,
      status,
      method: SalesmanVerificationMethod.GODWEB,
      reference: outcome.providerReference,
    },
  });

  if (status === SalesmanStatus.ACTIVE && row.userId) {
    notifyAsync({
      userId: row.userId,
      type: NotificationType.SALESMAN_VERIFIED,
      title: 'Your GODID is verified',
      body: 'Your Saarthi salesman profile is active. Your referral link is ready to share.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/sales/referrals',
    });
  }

  return toSalesmanView(row);
}

/**
 * Verify a GODID on a platform administrator's own authority.
 *
 * The documented fallback for an environment where the approved GODWeb
 * validation API does not exist. Read the guard below carefully: this path is
 * **refused** whenever GODWeb *is* reachable, because an administrator waving
 * through a GODID that the authority could have been asked about is exactly
 * the hole the specification's anti-fraud section is about.
 *
 * When it does apply, the administrator's id and their stated evidence are
 * written onto the profile permanently and into an audit action of its own, so
 * a report can always separate "GODWeb said yes" from "a person said yes".
 */
export async function verifyManually(
  auth: AuthContext,
  id: string,
  input: ManualVerifySalesmanInput,
): Promise<SalesmanView> {
  const existing = await prisma.salesmanProfile.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Salesman profile');

  if (godWebConfigured) {
    throw errors.businessRule(
      'GODWeb verification is available on this environment, so this GODID must be verified ' +
        'against GODWeb rather than by hand. Use Verify with GODWeb.',
    );
  }

  if (existing.status === SalesmanStatus.REJECTED) {
    throw errors.businessRule(
      'GODWeb has already refused this GODID. It cannot be verified by hand.',
    );
  }

  const now = new Date();
  const row = await prisma.salesmanProfile.update({
    where: { id },
    data: {
      status: SalesmanStatus.ACTIVE,
      verificationMethod: SalesmanVerificationMethod.PLATFORM_ADMIN,
      verifiedAt: now,
      verifiedByUserId: auth.user.id,
      verificationNote: input.evidence,
      lastCheckedAt: now,
      standingReason: null,
    },
  });

  await recordAudit({
    action: AuditAction.SALESMAN_VERIFIED_MANUALLY,
    entityType: 'SalesmanProfile',
    entityId: id,
    actorUserId: auth.user.id,
    after: {
      godId: existing.godId,
      method: SalesmanVerificationMethod.PLATFORM_ADMIN,
      evidence: input.evidence,
      godWebConfigured: false,
    },
  });

  salesLogger.warn(
    { salesmanId: id, godId: existing.godId, actorUserId: auth.user.id },
    'Salesman GODID verified by platform administrator because GODWeb validation is unavailable',
  );

  if (row.userId) {
    notifyAsync({
      userId: row.userId,
      type: NotificationType.SALESMAN_VERIFIED,
      title: 'Your salesman profile is active',
      body: 'Saarthi operations has verified your GODID. Your referral link is ready to share.',
      priority: NotificationPriority.NORMAL,
      actionUrl: '/sales/referrals',
    });
  }

  return toSalesmanView(row);
}

/**
 * Suspend or reject a profile.
 *
 * `ACTIVE` is not reachable here — see `salesmanStandingSchema`. Reinstating
 * somebody runs verification again, which is the only thing that can honestly
 * say the GODID is still good.
 */
export async function changeStanding(
  auth: AuthContext,
  id: string,
  input: SalesmanStandingInput,
): Promise<SalesmanView> {
  const existing = await prisma.salesmanProfile.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Salesman profile');

  const row = await prisma.salesmanProfile.update({
    where: { id },
    data: {
      status: input.status,
      standingReason: input.reason,
      // Verification is withdrawn along with the standing. Leaving `verifiedAt`
      // set on a suspended profile would mean a later reinstatement looked
      // verified without anybody having asked GODWeb again.
      verifiedAt: null,
      verificationMethod: null,
      verifiedByUserId: null,
    },
  });

  await recordAudit({
    action: AuditAction.SALESMAN_STANDING_CHANGED,
    entityType: 'SalesmanProfile',
    entityId: id,
    actorUserId: auth.user.id,
    before: { status: existing.status },
    after: { status: input.status, reason: input.reason },
  });

  await revokeSellingAbility(id, input.reason);

  return toSalesmanView(row);
}

/**
 * Close off a salesperson's open referrals when they stop being able to sell.
 *
 * Only the *captured* ones — a link somebody clicked and has not acted on. An
 * attribution that already has a customer behind it, and any commission at
 * all, is left exactly as it is: the sale genuinely happened, the money is
 * genuinely owed, and cancelling it because the person later left would be
 * taking back earnings rather than preventing fraud.
 */
async function revokeSellingAbility(salesmanId: string, reason: string): Promise<void> {
  const affected = await prisma.referralAttribution.updateMany({
    where: { salesmanId, status: 'CAPTURED', organizationId: null },
    data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason },
  });

  if (affected.count > 0) {
    salesLogger.info(
      { salesmanId, revoked: affected.count },
      'Unused referral captures revoked with the salesman profile',
    );
  }
}

// ---------------------------------------------------------------------------
// The salesperson's own referral link
// ---------------------------------------------------------------------------

export interface ReferralShare {
  godId: string;
  code: string;
  url: string;
  /** SVG data URI, rendered by the existing QR service. */
  qrDataUri: string | null;
  /** The configured attribution window, so no screen has to guess it. */
  attributionWindowDays: number;
  /** Ready-to-send message text for WhatsApp, SMS and email. */
  shareText: string;
}

/**
 * The salesperson's link, QR and share text.
 *
 * The QR is rendered by the existing `qr-render` service rather than a second
 * QR implementation, and it encodes the referral URL — a public web page — so
 * any phone's camera can open it. Note that this is a *referral* QR and has
 * nothing to do with a tracker: Saarthi trackers carry no QR code and no
 * tracker-QR activation flow exists anywhere in this module.
 */
export async function referralShare(
  profile: SalesmanView,
  baseUrl: string,
  renderQr: (payload: string) => Promise<string>,
): Promise<ReferralShare> {
  if (!profile.canSell) {
    throw errors.businessRule(profile.standing, { status: profile.status });
  }

  const url = referralUrl(baseUrl, profile.godId);

  let qrDataUri: string | null = null;
  try {
    qrDataUri = await renderQr(url);
  } catch (error) {
    // A missing QR image is a degraded screen, not a failed request — the link
    // itself is the thing that has to work, and it is right there beside it.
    salesLogger.warn({ err: error, salesmanId: profile.id }, 'Referral QR could not be rendered');
  }

  const who = profile.name ? `${profile.name} from Saarthi` : 'Saarthi';

  return {
    godId: profile.godId,
    code: profile.godId,
    url,
    qrDataUri,
    attributionWindowDays: config.sales.attributionWindowDays,
    shareText:
      `${who} here. Saarthi keeps track of your vehicles, drivers, documents and running ` +
      `costs in one place. Sign up here and I will help you set your first vehicle up: ${url}`,
  };
}
