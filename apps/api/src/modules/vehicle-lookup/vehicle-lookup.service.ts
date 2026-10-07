import {
  Permission,
  RcDetailAccess,
  VehicleOwnershipStatus,
  hasPermission,
  maskRcRecord,
  vehicleDraftFromRc,
  type VehicleLookupInput,
  type VehicleLookupResult,
  type VehicleRcPrefill,
  type VehicleRcRecord,
} from '@saarthi/shared';
import type { Readable } from 'node:stream';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { storageProvider } from '../../providers/storage';
import { maskRegistration, requireVehicleRcProvider } from '../../providers/vehicle-rc';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { evaluateOwnership } from '../vehicles/vehicle-ownership.service';
import { assertUnlocked, isUnlocked } from '../secure-access/secure-access.service';
import type { AuthContext } from '../../auth/context';

/**
 * Vehicle registration (RC) lookups against the upstream RTO provider.
 *
 * Kept separate from `modules/vehicles`, which manages the vehicles Saarthi
 * *owns*. This module answers questions about a registration number that may
 * belong to nobody on the platform, so it has its own trust level, its own
 * rate limit and its own retention rules.
 *
 * Three responsibilities live here and nowhere else:
 *
 *  1. **Cost control.** Every provider call is billable, so a lookup is served
 *     from Saarthi's own store while it is still fresh. `refresh: true` is the
 *     only way to force a new charge.
 *  2. **Custody of the document.** The provider's `pdf_url` is temporary. We
 *     fetch the bytes during the lookup and store them behind Saarthi's own
 *     authenticated endpoint, so the third-party link never reaches a browser.
 *  3. **Data minimisation.** An RC record carries the owner's name, address
 *     and phone number plus engine and chassis identifiers. Those are stripped
 *     for any caller without `vehicles.lookup.sensitive`, and every row has an
 *     expiry so nothing is retained indefinitely.
 */

const serviceLogger = logger.child({ module: 'vehicle-lookup' });

/** Personal and identity fields, removed for callers without the permission. */
function redactRecord(record: VehicleRcRecord): VehicleRcRecord {
  return {
    ...record,
    owner: null,
    engineNumber: null,
    chassisNumber: null,
    redacted: true,
  };
}

export function canSeeSensitiveVehicleData(auth: AuthContext): boolean {
  return (
    auth.isPlatformAdmin || hasPermission(auth.permissions, Permission.VEHICLE_LOOKUP_SENSITIVE)
  );
}

/**
 * How much of a vehicle's RC this caller may see right now.
 *
 * Three gates, each answering a different question, all automatic:
 *
 *  1. the permission — may this role read personal vehicle data at all?
 *  2. ownership — has this account shown the vehicle is its own? Anyone can
 *     type a plate; without this, adding a stranger's car would reveal them.
 *  3. the secure PIN — is the account holder the one at the keyboard?
 *
 * Platform staff are exempt, as everywhere; their access is audited.
 */
async function rcAccess(
  auth: AuthContext,
  ownershipStatus: string | null | undefined,
): Promise<RcDetailAccess> {
  if (auth.isPlatformAdmin) return RcDetailAccess.FULL;
  if (!canSeeSensitiveVehicleData(auth)) return RcDetailAccess.NOT_PERMITTED;
  if (ownershipStatus !== VehicleOwnershipStatus.VERIFIED) return RcDetailAccess.OWNERSHIP_REQUIRED;
  return (await isUnlocked(auth)) ? RcDetailAccess.FULL : RcDetailAccess.LOCKED;
}

/** The record as this level of access sees it: whole, masked, or stripped. */
function presentRecord(record: VehicleRcRecord, access: RcDetailAccess): VehicleRcRecord {
  if (access === RcDetailAccess.FULL) return { ...record, redacted: false };
  if (access === RcDetailAccess.NOT_PERMITTED) return redactRecord(record);
  return maskRcRecord(record);
}

/**
 * A lookup may only be run against a vehicle the caller's organization owns.
 *
 * Without this, the endpoint would be an open RTO search: anyone with an
 * account could pull the registered owner's name, address and phone number for
 * any plate they saw on the road. Restricting it to the caller's own fleet
 * keeps the feature to its purpose — verifying and maintaining your vehicles —
 * and keeps Saarthi from becoming a people-tracing tool.
 *
 * The vehicle must already exist in the fleet, so the normal path is: add the
 * vehicle, then pull its RC record.
 *
 * Platform admins are exempt so support can act on a tenant's behalf; that
 * access is audited like every other lookup.
 *
 * Being on the fleet is not the same as being owned: anyone can add a plate.
 * The vehicle is returned so callers can also ask `rcAccess`; `null` for
 * platform admins, who are not checked.
 */
async function assertVehicleBelongsToCaller(
  auth: AuthContext,
  registrationNumber: string,
): Promise<{ id: string; ownershipStatus: string } | null> {
  if (auth.isPlatformAdmin) return null;

  const organizationId = auth.organizationId;
  if (!organizationId) {
    throw errors.organizationRequired(
      'Your account is not linked to an organization, so it has no vehicles to look up.',
    );
  }

  const owned = await prisma.truck.findFirst({
    where: { registrationNumber, organizationId, archivedAt: null },
    select: { id: true, ownershipStatus: true },
  });

  if (!owned) {
    throw errors.forbidden(
      `${registrationNumber} is not one of your vehicles. ` +
        'Add it to your fleet first — registration lookups are limited to vehicles you own.',
    );
  }
  return owned;
}

/**
 * Tenant boundary for a stored lookup.
 *
 * `assertTenantAccess` treats a null organization as public, which is right
 * for reference data and wrong for an RC record — so lookups made outside a
 * tenant stay visible only to platform staff.
 */
function assertLookupAccess(auth: AuthContext, organizationId: string | null): void {
  if (auth.isPlatformAdmin) return;
  if (organizationId && organizationId === auth.organizationId) return;
  // Reported as "not found" so ids cannot be probed across tenants.
  throw errors.notFound('Vehicle lookup');
}

// ---------------------------------------------------------------------------
// Billable-call ceiling
// ---------------------------------------------------------------------------

/**
 * How many billable provider calls this environment has made.
 *
 * Counted from the audit trail rather than from `vehicle_lookups`, because
 * those rows are deleted once their retention window lapses — a counter that
 * resets itself is no ceiling at all. Audit entries persist, and a lookup
 * served from cache is recorded with `cached: true`, so only calls that
 * actually reached the provider are counted.
 */
async function billableCallCount(): Promise<number> {
  return prisma.auditLog.count({
    where: {
      action: AuditAction.VEHICLE_RC_LOOKUP,
      afterData: { path: ['cached'], equals: false },
    },
  });
}

/**
 * Refuse the call when the environment's allowance is spent.
 *
 * A development guard, not a billing ledger: the audit write happens after the
 * lookup returns, so two genuinely simultaneous requests could both pass this
 * check. The per-user rate limit keeps that window small, and the provider's
 * own dashboard remains the authority on what was actually charged.
 *
 * Returns how many calls remain after this one, or `null` when uncapped.
 */
async function reserveProviderCall(): Promise<number | null> {
  const budget = config.vehicleRc.callBudget;
  if (budget <= 0) return null;

  const used = await billableCallCount();
  if (used >= budget) {
    serviceLogger.warn(
      { used, budget },
      'Vehicle lookup budget exhausted — refusing to make a billable provider call. ' +
        'Raise VEHICLE_LOOKUP_BUDGET, or set it to 0 to remove the ceiling.',
    );
    throw errors.providerBudgetExhausted('vehicle-rc');
  }

  const remaining = budget - used - 1;
  if (remaining <= 2) {
    serviceLogger.warn(
      { used: used + 1, budget, remaining },
      'Vehicle lookup budget is nearly exhausted',
    );
  }
  return remaining;
}

interface StoredPdf {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * Fetch and store the RC document.
 *
 * Returns `null` on any failure: an unavailable document must not cost the
 * caller the RC data they already paid for, so this degrades rather than
 * throwing. The reason is always logged.
 */
async function storeRcDocument(
  pdfUrl: string,
  registrationNumber: string,
  organizationId: string | null,
): Promise<StoredPdf | null> {
  try {
    const provider = requireVehicleRcProvider();
    const document = await provider.downloadPdf(pdfUrl);
    const fileName = `RC-${registrationNumber}.pdf`;

    const stored = await storageProvider.upload({
      prefix: `vehicle-rc/${organizationId ?? 'platform'}`,
      fileName,
      mimeType: document.mimeType,
      content: document.content,
    });

    return {
      storageKey: stored.storageKey,
      fileName,
      mimeType: stored.mimeType,
      size: stored.size,
    };
  } catch (error) {
    serviceLogger.warn(
      { err: error, plate: maskRegistration(registrationNumber) },
      'RC document could not be stored — returning the record without a PDF',
    );
    return null;
  }
}

/**
 * The record Saarthi already holds for a vehicle, if any.
 *
 * Never contacts the provider and never spends budget: this is what the
 * vehicle's Registration tab shows the moment it opens, so a fetched record
 * survives a refresh instead of the operator paying to see it again.
 *
 * A record past its cache window is still returned — stale RC data with a
 * visible "last checked" date is far more useful than a blank panel — and the
 * caller decides whether to refresh it.
 */
export async function getStoredLookup(
  auth: AuthContext,
  registrationNumber: string,
): Promise<VehicleLookupResult | null> {
  const vehicle = await assertVehicleBelongsToCaller(auth, registrationNumber);

  const stored = await prisma.vehicleLookup.findFirst({
    where: { registrationNumber, organizationId: auth.organizationId ?? null },
    orderBy: { fetchedAt: 'desc' },
  });
  if (!stored) return null;

  const access = await rcAccess(auth, vehicle?.ownershipStatus);
  return {
    lookupId: stored.id,
    registrationNumber,
    vehicle: presentRecord(stored.responseData as unknown as VehicleRcRecord, access),
    cached: true,
    retrievedAt: stored.fetchedAt.toISOString(),
    expiresAt: stored.expiresAt.toISOString(),
    pdfAvailable: Boolean(stored.pdfStorageKey),
    access,
    providerReference: stored.providerReference,
  };
}

/** A lookup before anyone has decided what the caller may see of it. */
type RawLookupResult = Omit<VehicleLookupResult, 'access'>;

export interface VehicleLookupOutcome<Result = VehicleLookupResult> {
  result: Result;
  /** Billable calls left in this environment's allowance; `null` if uncapped. */
  budgetRemaining: number | null;
  /** Audit metadata. Never contains personal data. */
  audit: {
    lookupId: string;
    registrationNumber: string;
    cached: boolean;
    pdfStored: boolean;
    providerReference: string | null;
  };
}

export async function lookupVehicle(
  auth: AuthContext,
  input: VehicleLookupInput,
): Promise<VehicleLookupOutcome> {
  // Checked before the cache as well as the provider: a plate that left the
  // fleet must stop returning its owner's details from a warm cache entry.
  const vehicle = await assertVehicleBelongsToCaller(auth, input.registrationNumber);
  const outcome = await fetchLookup(auth, input);

  // A fresh record is the evidence ownership waits on, so settle it before
  // deciding what this answer may show.
  const status =
    vehicle?.ownershipStatus === VehicleOwnershipStatus.PENDING
      ? (await evaluateOwnership(vehicle.id)).status
      : vehicle?.ownershipStatus;
  const access = await rcAccess(auth, status);

  return {
    ...outcome,
    result: {
      ...outcome.result,
      vehicle: presentRecord(outcome.result.vehicle, access),
      access,
    },
  };
}

/**
 * Fill in the add-vehicle form from the RC — the one lookup allowed for a
 * plate that is not on the account yet.
 *
 * `assertVehicleBelongsToCaller` exists so this module is not a people-tracing
 * tool, and this keeps to that: the answer is a vehicle draft only (make,
 * model, fuel, capacity, dates), never the owner's name, address or phone or
 * the engine and chassis numbers. Those appear once the vehicle is saved,
 * through the ordinary lookup. The record is stored against the account, so
 * saving the vehicle — and verifying it — reads it back without a second
 * provider call.
 *
 * A plate already on Saarthi is refused before anything is spent:
 * registration numbers are unique across the platform.
 */
export async function prefillVehicleFromRc(
  auth: AuthContext,
  registrationNumber: string,
): Promise<{ prefill: VehicleRcPrefill; outcome: VehicleLookupOutcome<RawLookupResult> }> {
  if (!auth.organizationId) {
    throw errors.organizationRequired('Your account is not linked to an organization, so it cannot add vehicles.');
  }

  const existing = await prisma.truck.findUnique({
    where: { registrationNumber },
    select: { organizationId: true, ownershipStatus: true },
  });
  // Another account's unconfirmed hold does not stop the owner: the draft
  // carries no personal data, and saving the vehicle is where they must prove
  // the plate is theirs — see `resolveRegistrationClaim`.
  const claimable =
    existing?.organizationId !== auth.organizationId &&
    existing?.ownershipStatus !== VehicleOwnershipStatus.VERIFIED;
  if (existing && !claimable) {
    throw errors.conflict(
      existing.organizationId === auth.organizationId
        ? `${registrationNumber} is already on your account.`
        : `${registrationNumber} is already registered on Saarthi by another account. If it is yours, contact support.`,
    );
  }

  const outcome = await fetchLookup(auth, { registrationNumber, refresh: false });
  return {
    prefill: {
      lookupId: outcome.result.lookupId,
      registrationNumber,
      draft: vehicleDraftFromRc(outcome.result.vehicle),
    },
    outcome,
  };
}

/**
 * Fetch and store the RC for a plate another account holds, so a claim on it
 * can be settled.
 *
 * Run only when the claimant has a verified name to compare and no record of
 * the plate exists yet: the claim needs the RTO's owner name, and asking the
 * claimant to fetch it first is the step people miss. Audited like any other
 * lookup, so the environment's budget still counts it. Nothing is returned;
 * the stored record is what the claim reads.
 */
export async function fetchRcForOwnershipClaim(
  auth: AuthContext,
  registrationNumber: string,
): Promise<void> {
  const outcome = await fetchLookup(auth, { registrationNumber, refresh: false });

  await recordAudit({
    action: AuditAction.VEHICLE_RC_LOOKUP,
    entityType: 'VehicleLookup',
    entityId: outcome.audit.lookupId,
    actorUserId: auth.user.id,
    organizationId: auth.organizationId ?? null,
    after: {
      registrationNumber: outcome.audit.registrationNumber,
      cached: outcome.audit.cached,
      pdfStored: outcome.audit.pdfStored,
      providerReference: outcome.audit.providerReference,
      purpose: 'ownership-claim',
    },
  });
}

/**
 * The lookup itself — cache, budget, provider, stored copy — for a plate
 * already cleared to be looked up. The record comes back unredacted; each
 * caller narrows it for whoever asked.
 */
async function fetchLookup(
  auth: AuthContext,
  input: VehicleLookupInput,
): Promise<VehicleLookupOutcome<RawLookupResult>> {
  const registrationNumber = input.registrationNumber;
  const organizationId = auth.organizationId ?? null;
  const ttlSeconds = config.vehicleRc.cacheTtlSeconds;

  // --- Cache -------------------------------------------------------------
  if (!input.refresh && ttlSeconds > 0) {
    const cached = await prisma.vehicleLookup.findFirst({
      where: {
        registrationNumber,
        organizationId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { fetchedAt: 'desc' },
    });

    if (cached) {
      const record = cached.responseData as unknown as VehicleRcRecord;
      return {
        result: {
          lookupId: cached.id,
          registrationNumber,
          vehicle: record,
          cached: true,
          retrievedAt: cached.fetchedAt.toISOString(),
          expiresAt: cached.expiresAt.toISOString(),
          pdfAvailable: Boolean(cached.pdfStorageKey),
          providerReference: cached.providerReference,
        },
        // A cache hit costs nothing, so it neither consumes nor reports budget.
        budgetRemaining: null,
        audit: {
          lookupId: cached.id,
          registrationNumber,
          cached: true,
          pdfStored: Boolean(cached.pdfStorageKey),
          providerReference: cached.providerReference,
        },
      };
    }
  }

  // --- Provider ----------------------------------------------------------
  const provider = requireVehicleRcProvider();
  // Checked before the call, never after — the point is to not spend it.
  const budgetRemaining = await reserveProviderCall();
  const lookup = await provider.lookup({ registrationNumber });

  const pdf = lookup.pdfUrl
    ? await storeRcDocument(lookup.pdfUrl, registrationNumber, organizationId)
    : null;

  if (!lookup.pdfUrl) {
    serviceLogger.info(
      { plate: maskRegistration(registrationNumber) },
      'Provider produced no RC document for this vehicle',
    );
  }

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + Math.max(ttlSeconds, 0) * 1000);

  const stored = await prisma.vehicleLookup.create({
    data: {
      registrationNumber,
      organizationId,
      requestedById: auth.user.id,
      provider: provider.name,
      providerReference: lookup.providerReference,
      responseData: lookup.record as unknown as object,
      pdfStorageKey: pdf?.storageKey ?? null,
      pdfFileName: pdf?.fileName ?? null,
      pdfMimeType: pdf?.mimeType ?? null,
      pdfSize: pdf?.size ?? null,
      fetchedAt,
      expiresAt,
    },
  });

  return {
    result: {
      lookupId: stored.id,
      registrationNumber,
      vehicle: lookup.record,
      cached: false,
      retrievedAt: fetchedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      pdfAvailable: Boolean(pdf),
      providerReference: lookup.providerReference,
    },
    budgetRemaining,
    audit: {
      lookupId: stored.id,
      registrationNumber,
      cached: false,
      pdfStored: Boolean(pdf),
      providerReference: lookup.providerReference,
    },
  };
}

export interface RcDocumentDownload {
  stream: Readable;
  fileName: string;
  mimeType: string;
  size: number;
  organizationId: string | null;
  registrationNumber: string;
}

/** Stream the stored RC document for a lookup the caller is entitled to. */
export async function downloadRcDocument(
  auth: AuthContext,
  lookupId: string,
): Promise<RcDocumentDownload> {
  const lookup = await prisma.vehicleLookup.findUnique({ where: { id: lookupId } });
  if (!lookup) throw errors.notFound('Vehicle lookup');

  assertLookupAccess(auth, lookup.organizationId);

  // The certificate names the owner, so it takes full access — including for a
  // prefill made for a plate never added at all, which fails the fleet check.
  if (!auth.isPlatformAdmin) {
    const vehicle = await assertVehicleBelongsToCaller(auth, lookup.registrationNumber);
    const access = await rcAccess(auth, vehicle?.ownershipStatus);
    if (access === RcDetailAccess.LOCKED) {
      await assertUnlocked(auth, 'download the RC certificate');
    } else if (access !== RcDetailAccess.FULL) {
      throw errors.forbidden(
        'The RC certificate shows the registered owner’s personal details, so it can be downloaded only once this account has confirmed it owns the vehicle.',
      );
    }
  }

  if (!lookup.pdfStorageKey) {
    throw errors.pdfUnavailable(
      'No RC document was produced for this lookup. Run the lookup again to try once more.',
    );
  }

  const file = await storageProvider.download(lookup.pdfStorageKey);

  return {
    stream: file.stream,
    fileName: lookup.pdfFileName ?? `RC-${lookup.registrationNumber}.pdf`,
    mimeType: lookup.pdfMimeType ?? 'application/pdf',
    size: file.size,
    organizationId: lookup.organizationId,
    registrationNumber: lookup.registrationNumber,
  };
}

/**
 * Retention sweep.
 *
 * Records past VEHICLE_LOOKUP_RETENTION_DAYS are deleted outright, together
 * with the PDF bytes they point at. This is deliberately a longer window than
 * `expiresAt`: that one decides when a *fresh provider call* is worthwhile,
 * while this one is how long Saarthi may hold the personal data at all.
 */
export async function runVehicleLookupRetentionSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - config.vehicleRc.retentionDays * 86_400_000);
  const expired = await prisma.vehicleLookup.findMany({
    where: { fetchedAt: { lt: cutoff } },
    select: { id: true, pdfStorageKey: true },
    take: 1000,
  });

  if (expired.length === 0) return 0;

  for (const lookup of expired) {
    if (!lookup.pdfStorageKey) continue;
    try {
      await storageProvider.remove(lookup.pdfStorageKey);
    } catch (error) {
      serviceLogger.warn(
        { err: error, lookupId: lookup.id },
        'Stored RC document could not be removed during the retention sweep',
      );
    }
  }

  const deleted = await prisma.vehicleLookup.deleteMany({
    where: { id: { in: expired.map((lookup) => lookup.id) } },
  });

  serviceLogger.info({ deleted: deleted.count }, 'Vehicle lookup retention sweep complete');
  return deleted.count;
}
