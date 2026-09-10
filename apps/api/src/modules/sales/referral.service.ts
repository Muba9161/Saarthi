import { createHash } from 'node:crypto';
import {
  ReferralSource,
  ReferralStatus,
  attributionExpiresAt,
  normalizeGodId,
  type AttributeCustomerInput,
  type ReferralListQuery,
  type RevokeAttributionInput,
} from '@saarthi/shared';
import { isUniqueViolation, prisma, type Db } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { config } from '../../config/env';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { resolveVerifiedSalesman, type SalesmanView } from './salesman.service';
import type { AuthContext } from '../../auth/context';

/**
 * Referral attribution — who brought a customer to Saarthi.
 *
 * This is the authoritative record and the backend is the only thing that
 * writes it. A client may *say* which referral it arrived through; it can
 * never say whose it was or that it counted.
 *
 * ## The two rules, and where they actually live
 *
 * **First valid attribution wins.** Not enforced by a read-then-write check in
 * this file — those lose races, and a lost race here means one sale paying two
 * commissions. It is enforced by
 * `referral_attributions_one_live_per_organization`, a partial unique index on
 * `(organizationId) WHERE status IN (CAPTURED, ATTRIBUTED, CONVERTED)`. The
 * code below attempts the insert and treats the constraint violation as the
 * expected answer, which is the only version of this that is correct under
 * concurrency.
 *
 * **Attribution persists.** A referral that produced no immediate signup keeps
 * its claim for `SALES_ATTRIBUTION_WINDOW_DAYS`, and the expiry is *stored on
 * the row at capture time* rather than recomputed. That way a later change to
 * the configured window cannot retroactively take a salesperson's credit away,
 * or hand it back to somebody whose window had already closed.
 *
 * ## Referral is not commission
 *
 * Nothing in this file creates a commission. An attribution reaching
 * `CONVERTED` is the *input* to `commission.service.ts`, which requires a
 * successful payment of its own before any money is recorded as owed.
 */

const referralLogger = logger.child({ module: 'sales:referral' });

/** Statuses that hold a claim on a customer. Mirrors the partial unique index. */
const LIVE_STATUSES = [
  ReferralStatus.CAPTURED,
  ReferralStatus.ATTRIBUTED,
  ReferralStatus.CONVERTED,
] as const;

export interface AttributionView {
  id: string;
  godId: string;
  salesmanId: string;
  salesmanName: string | null;
  salespersonExternalId: string | null;
  source: ReferralSource;
  status: ReferralStatus;
  organizationId: string | null;
  organizationName: string | null;
  capturedAt: string;
  expiresAt: string;
  attributedAt: string | null;
  convertedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  /** The window this row was captured under, in days. */
  attributionWindowDays: number;
}

type AttributionRow = {
  id: string;
  godId: string;
  salesmanId: string;
  salespersonExternalId: string | null;
  source: string;
  status: string;
  organizationId: string | null;
  capturedAt: Date;
  expiresAt: Date;
  attributedAt: Date | null;
  convertedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  salesman?: { name: string | null } | null;
  organization?: { name: string } | null;
};

function toView(row: AttributionRow): AttributionView {
  return {
    id: row.id,
    godId: row.godId,
    salesmanId: row.salesmanId,
    salesmanName: row.salesman?.name ?? null,
    salespersonExternalId: row.salespersonExternalId,
    source: row.source as ReferralSource,
    status: row.status as ReferralStatus,
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    capturedAt: row.capturedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    attributedAt: row.attributedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason,
    attributionWindowDays: Math.round(
      (row.expiresAt.getTime() - row.capturedAt.getTime()) / 86_400_000,
    ),
  };
}

/**
 * A one-way fingerprint of the capturing IP.
 *
 * Hashed with the cookie secret rather than stored raw. It exists for one
 * question — "is one device minting attributions in bulk" — which a hash
 * answers exactly as well as an address, and it keeps a public endpoint from
 * accumulating a log of who visited a referral link.
 */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256')
    .update(`${config.auth.cookieSecret}:${ip}`)
    .digest('hex')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Public resolution
// ---------------------------------------------------------------------------

export interface PublicReferralView {
  code: string;
  /** Display name, or null when GODWeb gave Saarthi none. */
  salesmanName: string | null;
  territory: string | null;
  valid: boolean;
}

/**
 * What an anonymous visitor may learn from a referral code.
 *
 * Deliberately almost nothing: whether the code belongs to a verified Saarthi
 * salesperson, what to call them, and roughly where they work. No phone, no
 * email, no pipeline, no customer list. The landing page needs "you were
 * invited by Priya from Saarthi" and nothing more, and a public endpoint that
 * returned a staff directory would be a public staff directory.
 *
 * An unknown or unverified code is reported as `valid: false` rather than 404,
 * so the page can still sign somebody up — the referral is what fails, not the
 * signup, and turning a mistyped code into a dead end would cost Saarthi the
 * customer to punish the salesperson.
 */
export async function resolvePublic(code: string): Promise<PublicReferralView> {
  const salesman = await resolveVerifiedSalesman(code);
  return {
    code: normalizeGodId(code),
    salesmanName: salesman?.name ?? null,
    territory: salesman?.territory ?? null,
    valid: salesman !== null,
  };
}

/**
 * Validate a GODID for a caller who is about to rely on it.
 *
 * Used by the registration form's "I was referred by" field and by the manual
 * GODID fallback. Returns the same thin shape as `resolvePublic` — validating
 * a code must not become a way to enumerate staff details.
 */
export async function validateCode(
  code: string,
  actorUserId: string | null,
): Promise<PublicReferralView> {
  const result = await resolvePublic(code);

  await recordAudit({
    action: AuditAction.REFERRAL_GODID_VALIDATED,
    entityType: 'SalesmanProfile',
    entityId: null,
    actorUserId,
    after: { code: result.code, valid: result.valid },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

export interface CaptureResult {
  /** Null when the code did not resolve to a salesperson who may sell. */
  attributionId: string | null;
  code: string;
  valid: boolean;
  attributionWindowDays: number;
  expiresAt: string | null;
}

/**
 * Record that somebody followed a referral link or scanned a referral QR.
 *
 * Anonymous and pre-registration: there is no customer yet, so the row carries
 * no organization and is later claimed by the registration that quotes the
 * same code. The row exists so that a salesperson can see their link is being
 * opened, and so that a signup arriving hours later can still be credited.
 *
 * A capture is cheap and unprivileged, so it is rate-limited at the route and
 * deduplicated here: the same device following the same link four times in an
 * afternoon produces one row, not four, which keeps a shared link from
 * inflating anybody's numbers.
 */
export async function capture(input: {
  code: string;
  source: ReferralSource;
  ipAddress: string | null;
}): Promise<CaptureResult> {
  const salesman = await resolveVerifiedSalesman(input.code);
  const windowDays = config.sales.attributionWindowDays;

  if (!salesman) {
    return {
      attributionId: null,
      code: normalizeGodId(input.code),
      valid: false,
      attributionWindowDays: windowDays,
      expiresAt: null,
    };
  }

  const ipHash = hashIp(input.ipAddress);
  const now = new Date();

  /*
   * One open capture per (salesperson, device) at a time.
   *
   * Not a unique index, because it is a de-duplication convenience rather than
   * a correctness rule — two people behind one office NAT genuinely are two
   * prospects, and refusing the second would cost a real sale. The correctness
   * rule is the one on `organizationId`, which applies once there is a
   * customer.
   */
  if (ipHash) {
    const existing = await prisma.referralAttribution.findFirst({
      where: {
        salesmanId: salesman.id,
        status: ReferralStatus.CAPTURED,
        organizationId: null,
        captureIpHash: ipHash,
        expiresAt: { gt: now },
      },
      orderBy: { capturedAt: 'desc' },
    });

    if (existing) {
      return {
        attributionId: existing.id,
        code: salesman.godId,
        valid: true,
        attributionWindowDays: windowDays,
        expiresAt: existing.expiresAt.toISOString(),
      };
    }
  }

  const row = await prisma.referralAttribution.create({
    data: {
      salesmanId: salesman.id,
      godId: salesman.godId,
      salespersonExternalId: salesman.externalSalespersonId,
      source: input.source,
      status: ReferralStatus.CAPTURED,
      capturedAt: now,
      expiresAt: attributionExpiresAt(now, windowDays),
      captureIpHash: ipHash,
    },
  });

  await recordAudit({
    action: AuditAction.REFERRAL_CAPTURED,
    entityType: 'ReferralAttribution',
    entityId: row.id,
    after: { godId: salesman.godId, source: input.source },
  });

  return {
    attributionId: row.id,
    code: salesman.godId,
    valid: true,
    attributionWindowDays: windowDays,
    expiresAt: row.expiresAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Attaching a customer
// ---------------------------------------------------------------------------

export interface AttributionOutcome {
  attributed: boolean;
  attributionId: string | null;
  /** Why nothing was attributed, when nothing was. */
  reason: string | null;
}

/**
 * Credit a newly registered organization to the salesperson behind `code`.
 *
 * Called from registration, inside no transaction and swallowing nothing that
 * matters: **a referral problem must never cost somebody their account.** By
 * the time this runs the user, the organization and the subscription are
 * committed, so every failure path here returns an outcome rather than
 * throwing, and the caller logs it. Losing a registration because a GODID was
 * mistyped would be a far worse outcome than an uncredited sale, which a
 * platform administrator can still fix afterwards.
 *
 * The order of the checks is the interesting part:
 *
 *   1. Resolve the code to a *verified, active* salesperson. An unverified one
 *      earns nothing, so there is nothing to attribute.
 *   2. Claim an existing unexpired `CAPTURED` row from the same salesperson if
 *      there is one — that is the click this registration came from, and
 *      reusing it keeps the capture-to-signup chain intact.
 *   3. Otherwise insert a fresh row.
 *
 * Both writes can collide with the partial unique index, and both treat the
 * collision the same way: somebody else got there first, this customer is
 * already attributed, nothing is overwritten.
 */
export async function attributeRegistration(input: {
  code: string;
  organizationId: string;
  customerUserId: string;
  source?: ReferralSource;
  db?: Db;
}): Promise<AttributionOutcome> {
  const db = input.db ?? prisma;
  const salesman = await resolveVerifiedSalesman(input.code, db);

  if (!salesman) {
    return {
      attributed: false,
      attributionId: null,
      reason: 'The referral code did not match a verified Saarthi salesperson.',
    };
  }

  const now = new Date();
  const source = input.source ?? ReferralSource.REFERRAL_LINK;

  /*
   * Guard before writing as well as relying on the index.
   *
   * The index is what makes this correct; this read is what makes the *message*
   * useful. Without it every already-attributed customer would surface as a
   * P2002, and the audit trail would say "unique violation" where it should say
   * "Salesman B tried to claim a customer already credited to Salesman A".
   */
  const live = await db.referralAttribution.findFirst({
    where: { organizationId: input.organizationId, status: { in: LIVE_STATUSES as never } },
  });

  if (live) {
    if (live.salesmanId === salesman.id) {
      return { attributed: true, attributionId: live.id, reason: null };
    }

    await recordAudit(
      {
        action: AuditAction.REFERRAL_ATTRIBUTION_REFUSED,
        entityType: 'Organization',
        entityId: input.organizationId,
        organizationId: input.organizationId,
        after: {
          attemptedGodId: salesman.godId,
          existingGodId: live.godId,
          existingStatus: live.status,
          rule: 'first_valid_attribution_wins',
        },
      },
      db,
    );

    return {
      attributed: false,
      attributionId: live.id,
      reason: 'This customer is already attributed to another salesperson.',
    };
  }

  // Claim the click this registration came from, if it is still open.
  const captured = await db.referralAttribution.findFirst({
    where: {
      salesmanId: salesman.id,
      status: ReferralStatus.CAPTURED,
      organizationId: null,
      expiresAt: { gt: now },
    },
    orderBy: { capturedAt: 'desc' },
  });

  try {
    const row = captured
      ? await db.referralAttribution.update({
          where: { id: captured.id },
          data: {
            status: ReferralStatus.ATTRIBUTED,
            organizationId: input.organizationId,
            customerUserId: input.customerUserId,
            attributedAt: now,
            source,
          },
        })
      : await db.referralAttribution.create({
          data: {
            salesmanId: salesman.id,
            godId: salesman.godId,
            salespersonExternalId: salesman.externalSalespersonId,
            source,
            status: ReferralStatus.ATTRIBUTED,
            organizationId: input.organizationId,
            customerUserId: input.customerUserId,
            capturedAt: now,
            attributedAt: now,
            expiresAt: attributionExpiresAt(now, config.sales.attributionWindowDays),
          },
        });

    await recordAudit(
      {
        action: AuditAction.REFERRAL_CUSTOMER_ATTRIBUTED,
        entityType: 'ReferralAttribution',
        entityId: row.id,
        organizationId: input.organizationId,
        after: { godId: salesman.godId, source, reusedCapture: Boolean(captured) },
      },
      db,
    );

    return { attributed: true, attributionId: row.id, reason: null };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The race the index exists for. Somebody else attributed this customer
      // between the read above and this write.
      referralLogger.info(
        { organizationId: input.organizationId, godId: salesman.godId },
        'Attribution lost a race — customer already credited elsewhere',
      );
      return {
        attributed: false,
        attributionId: null,
        reason: 'This customer was attributed to another salesperson a moment earlier.',
      };
    }
    throw error;
  }
}

/**
 * Record a physical sale: this salesperson, standing in front of this customer.
 *
 * Distinct from `attributeRegistration` because the trust model is different.
 * There is no code to resolve — the caller is an authenticated, verified
 * salesperson acting on their own profile, which is a stronger claim than a
 * string in a form. It still cannot displace a live attribution, so a
 * salesperson cannot walk into a customer another colleague signed up and
 * claim them.
 */
export async function attributePhysicalSale(input: {
  salesman: SalesmanView;
  organizationId: string;
  customerUserId?: string | null;
  source?: ReferralSource;
}): Promise<AttributionOutcome> {
  const now = new Date();

  const live = await prisma.referralAttribution.findFirst({
    where: { organizationId: input.organizationId, status: { in: LIVE_STATUSES as never } },
  });

  if (live) {
    if (live.salesmanId === input.salesman.id) {
      return { attributed: true, attributionId: live.id, reason: null };
    }
    await recordAudit({
      action: AuditAction.REFERRAL_ATTRIBUTION_REFUSED,
      entityType: 'Organization',
      entityId: input.organizationId,
      organizationId: input.organizationId,
      after: {
        attemptedGodId: input.salesman.godId,
        existingGodId: live.godId,
        rule: 'first_valid_attribution_wins',
      },
    });
    return {
      attributed: false,
      attributionId: live.id,
      reason: 'This customer is already attributed to another salesperson.',
    };
  }

  try {
    const row = await prisma.referralAttribution.create({
      data: {
        salesmanId: input.salesman.id,
        godId: input.salesman.godId,
        salespersonExternalId: input.salesman.externalSalespersonId,
        source: input.source ?? ReferralSource.PHYSICAL,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: input.organizationId,
        customerUserId: input.customerUserId ?? null,
        capturedAt: now,
        attributedAt: now,
        expiresAt: attributionExpiresAt(now, config.sales.attributionWindowDays),
      },
    });

    await recordAudit({
      action: AuditAction.REFERRAL_CUSTOMER_ATTRIBUTED,
      entityType: 'ReferralAttribution',
      entityId: row.id,
      organizationId: input.organizationId,
      after: { godId: input.salesman.godId, source: input.source ?? ReferralSource.PHYSICAL },
    });

    return { attributed: true, attributionId: row.id, reason: null };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        attributed: false,
        attributionId: null,
        reason: 'This customer was attributed to another salesperson a moment earlier.',
      };
    }
    throw error;
  }
}

/**
 * Mark an attribution converted.
 *
 * Called by the commission service once a *successful payment* has been seen,
 * never on the strength of a subscription record alone. Idempotent, because
 * payment events retry.
 */
export async function markConverted(
  attributionId: string,
  db: Db = prisma,
): Promise<void> {
  const row = await db.referralAttribution.findUnique({ where: { id: attributionId } });
  if (!row) return;
  if (row.status === ReferralStatus.CONVERTED) return;
  if (row.status === ReferralStatus.REVOKED || row.status === ReferralStatus.EXPIRED) return;

  await db.referralAttribution.update({
    where: { id: attributionId },
    data: { status: ReferralStatus.CONVERTED, convertedAt: new Date() },
  });

  await recordAudit(
    {
      action: AuditAction.REFERRAL_CONVERTED,
      entityType: 'ReferralAttribution',
      entityId: attributionId,
      organizationId: row.organizationId,
      after: { godId: row.godId },
    },
    db,
  );
}

/** The live attribution for a customer, if there is one. */
export async function liveAttributionFor(
  organizationId: string,
  db: Db = prisma,
): Promise<{
  id: string;
  salesmanId: string;
  godId: string;
  salespersonExternalId: string | null;
  status: string;
} | null> {
  return db.referralAttribution.findFirst({
    where: { organizationId, status: { in: LIVE_STATUSES as never } },
    select: {
      id: true,
      salesmanId: true,
      godId: true,
      salespersonExternalId: true,
      status: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export async function listAttributions(
  query: ReferralListQuery,
  salesmanId: string | null,
): Promise<{ items: AttributionView[]; total: number }> {
  const where = {
    ...(salesmanId ? { salesmanId } : query.salesmanId ? { salesmanId: query.salesmanId } : {}),
    ...(query.status ? { status: { in: query.status as never } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.referralAttribution.findMany({
      where,
      include: { salesman: { select: { name: true } }, organization: { select: { name: true } } },
      orderBy: { capturedAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.referralAttribution.count({ where }),
  ]);

  return { items: rows.map(toView), total };
}

/**
 * Attribute an existing customer to a salesperson after the fact.
 *
 * Platform administration only, for the genuine cases — a physical sale where
 * the salesperson forgot to record it, a customer who quoted the wrong GODID.
 * It **cannot** displace a live attribution, and that restriction applies to
 * administrators too: an administrator who could quietly move a commission
 * between two colleagues would make "first valid attribution wins" worthless.
 * Moving one takes two deliberate, separately audited steps — revoke, then
 * attribute — so the trail shows what happened and why.
 */
export async function attributeManually(
  auth: AuthContext,
  input: AttributeCustomerInput,
): Promise<AttributionView> {
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) throw errors.notFound('Organization');

  const salesman = await resolveVerifiedSalesman(input.godId);
  if (!salesman) {
    throw errors.businessRule(
      'That GODID does not belong to a verified, active Saarthi salesperson, so nothing can be ' +
        'attributed to it.',
    );
  }

  const live = await liveAttributionFor(input.organizationId);
  if (live) {
    throw errors.conflict(
      live.salesmanId === salesman.id
        ? 'This customer is already attributed to that salesperson.'
        : 'This customer is already attributed to another salesperson. Revoke that attribution ' +
          'first, with a reason, if it is genuinely wrong.',
      { existingGodId: live.godId, existingStatus: live.status },
    );
  }

  const now = new Date();
  let row;
  try {
    row = await prisma.referralAttribution.create({
      data: {
        salesmanId: salesman.id,
        godId: salesman.godId,
        salespersonExternalId: salesman.externalSalespersonId,
        source: input.source,
        status: ReferralStatus.ATTRIBUTED,
        organizationId: input.organizationId,
        capturedAt: now,
        attributedAt: now,
        expiresAt: attributionExpiresAt(now, config.sales.attributionWindowDays),
        captureNote: input.reason,
      },
      include: { salesman: { select: { name: true } }, organization: { select: { name: true } } },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict('This customer was attributed to a salesperson a moment earlier.');
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.REFERRAL_CUSTOMER_ATTRIBUTED,
    entityType: 'ReferralAttribution',
    entityId: row.id,
    actorUserId: auth.user.id,
    organizationId: input.organizationId,
    after: {
      godId: salesman.godId,
      source: input.source,
      reason: input.reason,
      manual: true,
    },
  });

  return toView(row);
}

/**
 * Withdraw an attribution.
 *
 * Note what it does *not* touch: commissions already generated from it. A
 * commission is money owed on a sale that genuinely happened; if it should not
 * be paid, an administrator reverses the commission itself, with its own reason
 * and its own audit entry. Cascading a revocation into somebody's earnings
 * would let one click both re-credit a customer and cancel a payment, with one
 * sentence covering both.
 */
export async function revokeAttribution(
  auth: AuthContext,
  id: string,
  input: RevokeAttributionInput,
): Promise<AttributionView> {
  const existing = await prisma.referralAttribution.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Referral attribution');

  if (existing.status === ReferralStatus.REVOKED) {
    throw errors.invalidTransition('This attribution has already been revoked.');
  }

  const row = await prisma.referralAttribution.update({
    where: { id },
    data: {
      status: ReferralStatus.REVOKED,
      revokedAt: new Date(),
      revokedByUserId: auth.user.id,
      revokeReason: input.reason,
    },
    include: { salesman: { select: { name: true } }, organization: { select: { name: true } } },
  });

  const pending = await prisma.commission.count({
    where: { attributionId: id, status: { in: ['PENDING', 'APPROVED', 'PAYABLE'] } },
  });

  await recordAudit({
    action: AuditAction.REFERRAL_ATTRIBUTION_REVOKED,
    entityType: 'ReferralAttribution',
    entityId: id,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    before: { status: existing.status, godId: existing.godId },
    after: {
      status: ReferralStatus.REVOKED,
      reason: input.reason,
      // Surfaced in the trail because it is the thing an administrator needs to
      // deal with next, and it is deliberately not done for them.
      unsettledCommissions: pending,
    },
  });

  if (pending > 0) {
    referralLogger.warn(
      { attributionId: id, pending },
      'Attribution revoked while commissions are still unsettled — reverse them explicitly',
    );
  }

  return toView(row);
}

/**
 * Close attributions whose window has run out.
 *
 * Only the ones that never found a customer. An `ATTRIBUTED` or `CONVERTED` row
 * is a customer who exists, and its `expiresAt` stopped meaning anything the
 * moment they registered — expiring those would silently un-credit real sales
 * ninety days after they were made.
 *
 * Run from the jobs scheduler; safe to call repeatedly.
 */
export async function expireStaleCaptures(): Promise<number> {
  const stale = await prisma.referralAttribution.findMany({
    where: {
      status: ReferralStatus.CAPTURED,
      organizationId: null,
      expiresAt: { lte: new Date() },
    },
    select: { id: true, godId: true },
    take: 500,
  });

  if (stale.length === 0) return 0;

  await prisma.referralAttribution.updateMany({
    where: { id: { in: stale.map((row) => row.id) } },
    data: { status: ReferralStatus.EXPIRED },
  });

  await recordAudit({
    action: AuditAction.REFERRAL_ATTRIBUTION_EXPIRED,
    entityType: 'ReferralAttribution',
    entityId: null,
    after: { expired: stale.length, windowDays: config.sales.attributionWindowDays },
  });

  referralLogger.info({ expired: stale.length }, 'Unused referral captures expired');
  return stale.length;
}
