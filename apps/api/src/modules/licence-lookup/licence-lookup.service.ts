import {
  Permission,
  hasPermission,
  type DrivingLicenceRecord,
  type LicenceLookupInput,
  type LicenceLookupResult,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { maskLicence, requireDrivingLicenceProvider } from '../../providers/driving-licence';
import { AuditAction } from '../audit/audit.service';
import type { AuthContext } from '../../auth/context';

/**
 * Driving licence (RTO) lookups.
 *
 * The same three concerns as the RC module, for the same reasons: each provider
 * call is billable so a stored record is reused, the holder's personal details
 * are stripped for callers who may not see them, and nothing is retained past
 * the configured window.
 *
 * The scope rule is stricter than the vehicle one. A licence number identifies
 * a *person*, so a lookup is only permitted for a driver on the caller's own
 * roster — or by that driver about themselves. Without it this endpoint would
 * be a way to turn a photocopied licence into somebody's home address.
 */

const serviceLogger = logger.child({ module: 'licence-lookup' });

/** Personal details, removed for callers without the sensitive permission. */
function redactRecord(record: DrivingLicenceRecord): DrivingLicenceRecord {
  return { ...record, holder: null, redacted: true };
}

export function canSeeSensitiveLicenceData(auth: AuthContext): boolean {
  return (
    auth.isPlatformAdmin ||
    hasPermission(auth.permissions, Permission.DRIVER_LICENCE_LOOKUP_SENSITIVE)
  );
}

function recordForCaller(auth: AuthContext, record: DrivingLicenceRecord): DrivingLicenceRecord {
  return canSeeSensitiveLicenceData(auth) ? { ...record, redacted: false } : redactRecord(record);
}

export interface LicenceOwner {
  driverId: string | null;
  organizationId: string | null;
}

/**
 * A licence may only be looked up for a driver the caller is responsible for.
 *
 * Platform admins are exempt so support can act for a tenant; a driver may
 * always look up their own licence, which is how they complete their own
 * onboarding.
 */
async function resolveLicenceOwner(
  auth: AuthContext,
  licenceNumber: string,
): Promise<LicenceOwner> {
  // A driver checking their own licence: the number must be the one on their
  // profile, so this cannot be used to look up a colleague.
  if (auth.driverId) {
    const own = await prisma.driver.findFirst({
      where: { id: auth.driverId, licenseNumber: licenceNumber },
      select: { id: true, organizationId: true },
    });
    if (own) return { driverId: own.id, organizationId: own.organizationId };
  }

  if (auth.isPlatformAdmin) {
    const anyDriver = await prisma.driver.findFirst({
      where: { licenseNumber: licenceNumber },
      select: { id: true, organizationId: true },
    });
    return {
      driverId: anyDriver?.id ?? null,
      organizationId: anyDriver?.organizationId ?? auth.organizationId ?? null,
    };
  }

  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw errors.organizationRequired(
      'Your account is not linked to an organization, so it has no drivers to look up.',
    );
  }

  const driver = await prisma.driver.findFirst({
    where: { licenseNumber: licenceNumber, organizationId, archivedAt: null },
    select: { id: true, organizationId: true },
  });

  if (!driver) {
    throw errors.forbidden(
      'That licence does not belong to one of your drivers. ' +
        'Add the driver first — licence lookups are limited to your own roster.',
    );
  }

  return { driverId: driver.id, organizationId: driver.organizationId };
}

// ---------------------------------------------------------------------------
// Billable-call ceiling
// ---------------------------------------------------------------------------

async function billableCallCount(): Promise<number> {
  return prisma.auditLog.count({
    where: {
      action: AuditAction.DRIVER_LICENCE_LOOKUP,
      afterData: { path: ['cached'], equals: false },
    },
  });
}

/** Refuse the call when this environment's allowance is spent. */
async function reserveProviderCall(): Promise<number | null> {
  const budget = config.drivingLicence.callBudget;
  if (budget <= 0) return null;

  const used = await billableCallCount();
  if (used >= budget) {
    serviceLogger.warn(
      { used, budget },
      'Licence lookup budget exhausted — refusing to make a billable provider call. ' +
        'Raise LICENCE_LOOKUP_BUDGET, or set it to 0 to remove the ceiling.',
    );
    throw errors.providerBudgetExhausted('driving-licence');
  }

  const remaining = budget - used - 1;
  if (remaining <= 2) {
    serviceLogger.warn(
      { used: used + 1, budget, remaining },
      'Licence lookup budget is nearly exhausted',
    );
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The record Saarthi already holds for a licence, if any.
 *
 * Free and idempotent — no provider call, no charge — so a driver's Licence tab
 * shows what was fetched last month the moment it opens.
 */
export async function getStoredLicence(
  auth: AuthContext,
  licenceNumber: string,
): Promise<LicenceLookupResult | null> {
  const owner = await resolveLicenceOwner(auth, licenceNumber);

  const stored = await prisma.licenceLookup.findFirst({
    where: { licenceNumber, organizationId: owner.organizationId },
    orderBy: { fetchedAt: 'desc' },
  });
  if (!stored) return null;

  return {
    lookupId: stored.id,
    licenceNumber,
    licence: recordForCaller(auth, stored.responseData as unknown as DrivingLicenceRecord),
    cached: true,
    retrievedAt: stored.fetchedAt.toISOString(),
    expiresAt: stored.expiresAt.toISOString(),
    providerReference: stored.providerReference,
  };
}

export interface LicenceLookupOutcome {
  result: LicenceLookupResult;
  budgetRemaining: number | null;
  /** Audit metadata. Never contains personal data. */
  audit: {
    lookupId: string;
    licenceNumber: string;
    driverId: string | null;
    cached: boolean;
    providerReference: string | null;
  };
}

export async function lookupLicence(
  auth: AuthContext,
  input: LicenceLookupInput,
): Promise<LicenceLookupOutcome> {
  const licenceNumber = input.licenceNumber;
  const owner = await resolveLicenceOwner(auth, licenceNumber);
  const ttlSeconds = config.drivingLicence.cacheTtlSeconds;

  // --- Cache -------------------------------------------------------------
  if (!input.refresh && ttlSeconds > 0) {
    const cached = await prisma.licenceLookup.findFirst({
      where: {
        licenceNumber,
        organizationId: owner.organizationId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { fetchedAt: 'desc' },
    });

    if (cached) {
      return {
        result: {
          lookupId: cached.id,
          licenceNumber,
          licence: recordForCaller(auth, cached.responseData as unknown as DrivingLicenceRecord),
          cached: true,
          retrievedAt: cached.fetchedAt.toISOString(),
          expiresAt: cached.expiresAt.toISOString(),
          providerReference: cached.providerReference,
        },
        budgetRemaining: null,
        audit: {
          lookupId: cached.id,
          licenceNumber,
          driverId: owner.driverId,
          cached: true,
          providerReference: cached.providerReference,
        },
      };
    }
  }

  // --- Provider ----------------------------------------------------------
  const provider = requireDrivingLicenceProvider();
  const budgetRemaining = await reserveProviderCall();
  const lookup = await provider.lookup({
    licenceNumber,
    dateOfBirth: input.dateOfBirth,
  });

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + Math.max(ttlSeconds, 0) * 1000);

  const stored = await prisma.licenceLookup.create({
    data: {
      licenceNumber,
      driverId: owner.driverId,
      organizationId: owner.organizationId,
      requestedById: auth.user.id,
      provider: provider.name,
      providerReference: lookup.providerReference,
      responseData: lookup.record as unknown as object,
      fetchedAt,
      expiresAt,
    },
  });

  serviceLogger.info(
    { licence: maskLicence(licenceNumber), driverId: owner.driverId },
    'Driving licence record retrieved',
  );

  return {
    result: {
      lookupId: stored.id,
      licenceNumber,
      licence: recordForCaller(auth, lookup.record),
      cached: false,
      retrievedAt: fetchedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      providerReference: lookup.providerReference,
    },
    budgetRemaining,
    audit: {
      lookupId: stored.id,
      licenceNumber,
      driverId: owner.driverId,
      cached: false,
      providerReference: lookup.providerReference,
    },
  };
}

/**
 * Retention sweep.
 *
 * Records past LICENCE_LOOKUP_RETENTION_DAYS are deleted. As with RC records
 * this window is deliberately longer than the cache TTL: that one decides when
 * a fresh provider call is worthwhile, this one is how long Saarthi may hold
 * the personal data at all.
 */
export async function runLicenceLookupRetentionSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - config.drivingLicence.retentionDays * 86_400_000);
  const deleted = await prisma.licenceLookup.deleteMany({
    where: { fetchedAt: { lt: cutoff } },
  });

  if (deleted.count > 0) {
    serviceLogger.info({ deleted: deleted.count }, 'Licence lookup retention sweep complete');
  }
  return deleted.count;
}
