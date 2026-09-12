import {
  AADHAAR_ONLINE_LIMITATION,
  DocumentVerificationStatus,
  IdentityDocumentKind,
  IdentityVerificationOutcome,
  NotificationPriority,
  NotificationType,
  Permission,
  VerificationSubjectType,
  hasPermission,
  identityKindDefinition,
  identityLastFour,
  isValidIdentityNumber,
  maskIdentityNumber,
  normalizeIdentityNumber,
  panFromGstin,
  type AadhaarRecord,
  type GstRecord,
  type IdentityRecord,
  type DriverVerificationChecklist,
  type IdentityVerificationSummary,
  type PanRecord,
  type VerifyIdentityInput,
  type VoterIdRecord,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  canRetainIdentityNumbers,
  decryptIdentityNumber,
  encryptIdentityNumber,
  hashIdentityNumber,
} from '../../lib/identity-crypto';
import {
  identityProviderConfigured,
  requireIdentityProvider,
} from '../../providers/identity';
import { AuditAction } from '../audit/audit.service';
import { notifyAsync } from '../notifications/notification.service';
import { syncDriverVerificationStatus } from '../verification/verification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Identity verification — Aadhaar, PAN, Voter ID and GSTIN.
 *
 * The three concerns are the same as the RC and licence modules, for the same
 * reasons: each provider call is billable so a stored answer is reused, the
 * holder's personal details are stripped for callers who may not see them, and
 * nothing is retained past the configured window.
 *
 * What is new here is the *local* gate. Every one of these numbers carries a
 * self-check, so a number that cannot possibly be real is refused before a call
 * is paid for — and reported as "check the number" rather than the misleading
 * "no record found" a provider would return for a typo.
 *
 * The scope rule is the strict one, borrowed from the licence module: these
 * numbers identify a *person* or a *business*, so a check is only permitted for
 * a driver on the caller's own roster (or by that driver about themselves) and
 * for the caller's own organization. Without it this endpoint would be a way to
 * turn a photographed Aadhaar card into a name and a voter-roll address.
 */

const serviceLogger = logger.child({ module: 'identity-verification' });

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export function canSeeIdentityHolderData(auth: AuthContext): boolean {
  return (
    auth.isPlatformAdmin || hasPermission(auth.permissions, Permission.IDENTITY_VERIFY_SENSITIVE)
  );
}

/**
 * Strip the holder block from a record.
 *
 * Which fields count as "holder" differs per kind, so this is explicit rather
 * than a generic key filter — a new field added to a record type should not
 * silently become disclosable because nobody remembered to list it.
 */
function redactRecord(kind: IdentityDocumentKind, record: IdentityRecord): IdentityRecord {
  switch (kind) {
    case IdentityDocumentKind.PAN: {
      const pan = record as PanRecord;
      return { ...pan, holderName: null, redacted: true };
    }
    case IdentityDocumentKind.VOTER_ID: {
      const voter = record as VoterIdRecord;
      return {
        ...voter,
        holderName: null,
        relativeName: null,
        relationType: null,
        gender: null,
        age: null,
        pollingStation: null,
        partNumber: null,
        redacted: true,
      };
    }
    case IdentityDocumentKind.GST: {
      const gst = record as GstRecord;
      // The legal and trade name of a registered business are public on the GST
      // portal, so they stay. The principal place of business does not.
      return { ...gst, principalAddress: null, redacted: true };
    }
    case IdentityDocumentKind.AADHAAR:
    default: {
      const aadhaar = record as AadhaarRecord;
      return { ...aadhaar, linkedPanMasked: null, redacted: true };
    }
  }
}

function recordForCaller(
  auth: AuthContext,
  kind: IdentityDocumentKind,
  record: IdentityRecord | null,
): IdentityRecord | null {
  if (!record) return null;
  if (canSeeIdentityHolderData(auth)) return { ...record, redacted: false };
  return redactRecord(kind, record);
}

// ---------------------------------------------------------------------------
// Subject scoping
// ---------------------------------------------------------------------------

interface IdentitySubject {
  organizationId: string | null;
  label: string;
}

/**
 * A subject may only be checked by someone responsible for it.
 *
 * Platform admins are exempt so support can act for a tenant; a driver may
 * always check their own documents, which is how they complete their own
 * onboarding.
 */
async function resolveSubject(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
): Promise<IdentitySubject> {
  switch (subjectType) {
    case VerificationSubjectType.DRIVER: {
      const driver = await prisma.driver.findUnique({
        where: { id: subjectId },
        include: { user: { select: { firstName: true, lastName: true } } },
      });
      if (!driver) throw errors.notFound('Driver');

      const isOwnProfile = auth.driverId === driver.id;
      if (!isOwnProfile && !auth.isPlatformAdmin && driver.organizationId !== auth.organizationId) {
        // 404 rather than 403 — a driver on another roster must not be
        // distinguishable from one that does not exist.
        throw errors.notFound('Driver');
      }

      return {
        organizationId: driver.organizationId,
        label: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
      };
    }

    case VerificationSubjectType.ORGANIZATION: {
      const organization = await prisma.organization.findUnique({ where: { id: subjectId } });
      if (!organization) throw errors.notFound('Organization');
      if (!auth.isPlatformAdmin && organization.id !== auth.organizationId) {
        throw errors.notFound('Organization');
      }
      return { organizationId: organization.id, label: organization.name };
    }

    /*
     * A person verifying themselves.
     *
     * Their own record and nobody else's — not a colleague's, not an employee's,
     * and not another member of the same organization's. A fleet may verify the
     * drivers it employs because it answers for who is driving its vehicles; an
     * account holder's own Aadhaar is theirs, and the tenant check that makes
     * the driver case legitimate does not transfer to it.
     *
     * Platform admins are exempt, as they are on the other two branches, so
     * support can act on an account's behalf.
     */
    case VerificationSubjectType.USER: {
      if (!auth.isPlatformAdmin && subjectId !== auth.user.id) {
        // 404 rather than 403, as above: another person's account must not be
        // distinguishable from one that does not exist.
        throw errors.notFound('User');
      }

      const user = await prisma.user.findUnique({
        where: { id: subjectId },
        select: { firstName: true, lastName: true },
      });
      if (!user) throw errors.notFound('User');

      return {
        organizationId: auth.organizationId,
        label: `${user.firstName} ${user.lastName}`.trim(),
      };
    }

    default:
      throw errors.validation(
        'Identity verification applies to a person, a driver or an organization only.',
      );
  }
}

// ---------------------------------------------------------------------------
// Billable-call ceiling
// ---------------------------------------------------------------------------

async function billableCallCount(): Promise<number> {
  return prisma.auditLog.count({
    where: {
      action: AuditAction.IDENTITY_VERIFICATION_CHECKED,
      afterData: { path: ['cached'], equals: false },
    },
  });
}

/** Refuse the call when this environment's allowance is spent. */
async function reserveProviderCall(): Promise<number | null> {
  const budget = config.identity.callBudget;
  if (budget <= 0) return null;

  const used = await billableCallCount();
  if (used >= budget) {
    serviceLogger.warn(
      { used, budget },
      'Identity verification budget exhausted — refusing to make a billable provider call. ' +
        'Raise IDENTITY_VERIFY_BUDGET, or set it to 0 to remove the ceiling.',
    );
    throw errors.providerBudgetExhausted(
      'identity',
      'The identity verification allowance for this environment has been used up.',
    );
  }

  const remaining = budget - used - 1;
  if (remaining <= 2) {
    serviceLogger.warn(
      { used: used + 1, budget, remaining },
      'Identity verification budget is nearly exhausted',
    );
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Persistence mapping
// ---------------------------------------------------------------------------

type IdentityRecordRow = Prisma.IdentityVerificationGetPayload<Record<string, never>>;

function toSummary(
  auth: AuthContext,
  row: IdentityRecordRow,
  { cached }: { cached: boolean },
): IdentityVerificationSummary {
  const record = recordForCaller(
    auth,
    row.kind,
    (row.responseData as unknown as IdentityRecord | null) ?? null,
  );

  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    documentId: row.documentId,
    outcome: row.outcome,
    maskedNumber: row.maskedNumber,
    holderName: canSeeIdentityHolderData(auth) ? row.holderName : null,
    reason: row.reason,
    record,
    cached,
    provider: row.provider,
    providerReference: row.providerReference,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    checkedAt: row.checkedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Mirror a verified number onto the subject record.
 *
 * Only ever called for a VERIFIED outcome, and it writes the *masked* form for
 * Aadhaar — the last four digits, which is the disclosure UIDAI itself permits.
 * PAN and GSTIN are kept in full because both are routinely printed on
 * invoices; treating them as secrets would cost the fast compliance query for
 * no real protection.
 *
 * A failed check deliberately does not clear a previously verified number. The
 * provider being down is not evidence that a driver's PAN stopped being theirs.
 */
async function applyToSubject(
  kind: IdentityDocumentKind,
  subjectType: VerificationSubjectType,
  subjectId: string,
  normalizedNumber: string,
  record: IdentityRecord | null,
  verifiedAt: Date,
): Promise<void> {
  switch (kind) {
    case IdentityDocumentKind.AADHAAR:
      /*
       * Aadhaar is the one kind with two possible subjects, so it is the one
       * that has to ask whose it is.
       *
       * Getting this wrong would not have been a mis-filed row: `subjectId` is
       * a user id on the USER branch, and updating `drivers` by it would throw
       * after the provider had already been called and charged, leaving a
       * written check with nothing recorded against the person.
       *
       * The two are separate facts and are kept separately. A driver clearing
       * Aadhaar is one of the four checks that decide whether they may be
       * assigned a vehicle; an account holder clearing it is proving who holds
       * the account. Somebody who owns vehicles and drives one of them has both
       * rows, and satisfies each on its own terms.
       */
      if (subjectType === VerificationSubjectType.USER) {
        await prisma.user.update({
          where: { id: subjectId },
          data: {
            aadhaarLast4: identityLastFour(normalizedNumber) || null,
            aadhaarVerifiedAt: verifiedAt,
          },
        });
        break;
      }

      await prisma.driver.update({
        where: { id: subjectId },
        data: {
          aadhaarLast4: identityLastFour(normalizedNumber) || null,
          aadhaarVerifiedAt: verifiedAt,
        },
      });
      break;

    case IdentityDocumentKind.PAN:
      await prisma.driver.update({
        where: { id: subjectId },
        data: { panNumber: normalizedNumber, panVerifiedAt: verifiedAt },
      });
      break;

    case IdentityDocumentKind.VOTER_ID:
      await prisma.driver.update({
        where: { id: subjectId },
        data: { voterIdNumber: normalizedNumber, voterIdVerifiedAt: verifiedAt },
      });
      break;

    case IdentityDocumentKind.GST: {
      const gst = record as GstRecord | null;
      await prisma.organization.update({
        where: { id: subjectId },
        data: {
          gstin: normalizedNumber,
          gstLegalName: gst?.legalName ?? null,
          gstTradeName: gst?.tradeName ?? null,
          gstStatus: gst?.status ?? null,
          gstVerifiedAt: verifiedAt,
        },
      });
      break;
    }

    default:
      break;
  }
}

/**
 * Keep the uploaded document in step with the check.
 *
 * This is what removes the confusion of two competing "verified" states on one
 * row. A number confirmed by the government source marks the document verified;
 * a number the source contradicts marks it rejected *with the reason*, so the
 * uploader is told what to fix rather than left waiting on a reviewer who would
 * have reached the same conclusion.
 *
 * An unconfirmed outcome touches nothing: the document stays where it was, in
 * the reviewer's queue, which is exactly where an unverifiable Aadhaar belongs.
 */
async function applyToDocument(
  documentId: string,
  outcome: IdentityVerificationOutcome,
  reason: string | null,
  actorUserId: string,
): Promise<void> {
  if (outcome === IdentityVerificationOutcome.VERIFIED) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        verificationStatus: DocumentVerificationStatus.VERIFIED,
        rejectionReason: null,
        verifiedById: actorUserId,
        verifiedAt: new Date(),
      },
    });
    return;
  }

  if (
    outcome === IdentityVerificationOutcome.NOT_FOUND ||
    outcome === IdentityVerificationOutcome.MISMATCH
  ) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        verificationStatus: DocumentVerificationStatus.REJECTED,
        rejectionReason:
          reason ?? 'The number on this document could not be confirmed with the issuing authority.',
        verifiedById: null,
        verifiedAt: null,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface IdentitySubjectView {
  subjectType: VerificationSubjectType;
  subjectId: string;
  /** Whether this environment can reach a government source at all. */
  onlineVerificationAvailable: boolean;
  /** One entry per applicable kind, whether or not it has been checked. */
  checks: {
    kind: IdentityDocumentKind;
    label: string;
    documentType: string;
    /** Null when this kind has never been checked for this subject. */
    verification: IdentityVerificationSummary | null;
  }[];
}

/**
 * Every identity check held for one subject.
 *
 * Free and idempotent — no provider call, no charge — so a driver's documents
 * screen knows which rows need a Verify button the moment it opens.
 */
export async function getSubjectIdentityChecks(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
): Promise<IdentitySubjectView> {
  await resolveSubject(auth, subjectType, subjectId);

  const rows = await prisma.identityVerification.findMany({
    where: { subjectType, subjectId },
  });

  /*
   * Which checks this subject is asked for.
   *
   * Resolved against the subject rather than the kind alone. Aadhaar belongs to
   * two subjects — a driver's and an account holder's own — so asking for it by
   * kind returns whichever entry is listed first, and a USER subject would have
   * been told it has no applicable checks at all.
   */
  const applicable = [
    IdentityDocumentKind.AADHAAR,
    IdentityDocumentKind.PAN,
    IdentityDocumentKind.VOTER_ID,
    IdentityDocumentKind.GST,
  ].filter((kind) => identityKindDefinition(kind, subjectType) !== undefined);

  return {
    subjectType,
    subjectId,
    onlineVerificationAvailable: identityProviderConfigured,
    checks: applicable.map((kind) => {
      const row = rows.find((entry) => entry.kind === kind) ?? null;
      const definition = identityKindDefinition(kind, subjectType);
      return {
        kind,
        label: definition?.label ?? kind,
        documentType: definition?.documentType ?? '',
        verification: row ? toSummary(auth, row, { cached: true }) : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

interface CheckResult {
  outcome: IdentityVerificationOutcome;
  record: IdentityRecord | null;
  reason: string | null;
  holderName: string | null;
  provider: string | null;
  providerReference: string | null;
}

/**
 * Aadhaar.
 *
 * There is no public standalone Aadhaar verification, so this does the two
 * things that *can* honestly be done: the UIDAI Verhoeff check, and — when a
 * PAN is supplied — the Income Tax Department's link check. With no PAN the
 * outcome is UNCONFIRMED and says so, rather than showing a green tick the
 * check has not earned. See `AADHAAR_ONLINE_LIMITATION`.
 */
async function checkAadhaar(
  normalizedNumber: string,
  linkedPan: string | undefined,
): Promise<CheckResult> {
  const record: AadhaarRecord = {
    maskedNumber: maskIdentityNumber(IdentityDocumentKind.AADHAAR, normalizedNumber),
    checksumValid: true,
    linkedToPan: null,
    linkedPanMasked: null,
    linkCheckSource: null,
    redacted: false,
  };

  if (!linkedPan) {
    return {
      outcome: IdentityVerificationOutcome.UNCONFIRMED,
      record,
      reason:
        'The number is valid but could not be confirmed online. ' +
        'Add the PAN linked to this Aadhaar to verify it, or leave it for a reviewer. ' +
        AADHAAR_ONLINE_LIMITATION,
      holderName: null,
      provider: null,
      providerReference: null,
    };
  }

  const provider = requireIdentityProvider();
  await reserveProviderCall();

  const linkOutcome = await provider.checkAadhaarPanLink({
    aadhaarNumber: normalizedNumber,
    panNumber: linkedPan,
  });

  record.linkedToPan = linkOutcome.linked;
  record.linkedPanMasked = maskIdentityNumber(IdentityDocumentKind.PAN, linkedPan);
  record.linkCheckSource = 'Income Tax Department (Aadhaar–PAN link)';

  if (linkOutcome.linked === true) {
    return {
      outcome: IdentityVerificationOutcome.VERIFIED,
      record,
      reason: null,
      holderName: null,
      provider: provider.name,
      providerReference: linkOutcome.providerReference,
    };
  }

  if (linkOutcome.linked === false) {
    return {
      outcome: IdentityVerificationOutcome.MISMATCH,
      record,
      reason:
        linkOutcome.message ??
        'This Aadhaar is not linked to the PAN supplied. Check both numbers against the cards.',
      holderName: null,
      provider: provider.name,
      providerReference: linkOutcome.providerReference,
    };
  }

  return {
    outcome: IdentityVerificationOutcome.UNCONFIRMED,
    record,
    reason:
      linkOutcome.message ??
      'The records service would not confirm the Aadhaar–PAN link. Left for a reviewer.',
    holderName: null,
    provider: provider.name,
    providerReference: linkOutcome.providerReference,
  };
}

async function checkPan(
  normalizedNumber: string,
  holderName: string | undefined,
): Promise<CheckResult> {
  const provider = requireIdentityProvider();
  await reserveProviderCall();

  const outcome = await provider.verifyPan({ panNumber: normalizedNumber, holderName });

  if (!outcome.found || !outcome.record) {
    return {
      outcome: IdentityVerificationOutcome.NOT_FOUND,
      record: null,
      reason:
        outcome.message ??
        'The Income Tax Department has no record of this PAN. Check it against the card.',
      holderName: null,
      provider: provider.name,
      providerReference: outcome.providerReference,
    };
  }

  const record = outcome.record;

  // A name that does not match is a *worse* answer than no record: the number
  // is real and belongs to somebody else, which is the case a fleet most needs
  // to be stopped on.
  if (record.nameMatch === false) {
    return {
      outcome: IdentityVerificationOutcome.MISMATCH,
      record,
      reason:
        'This PAN is registered to a different name. Check that the card belongs to this driver.',
      holderName: record.holderName,
      provider: provider.name,
      providerReference: outcome.providerReference,
    };
  }

  if (record.panStatus && !/^(valid|active|existing|e)$/i.test(record.panStatus)) {
    return {
      outcome: IdentityVerificationOutcome.MISMATCH,
      record,
      reason: `The Income Tax Department reports this PAN as "${record.panStatus}".`,
      holderName: record.holderName,
      provider: provider.name,
      providerReference: outcome.providerReference,
    };
  }

  return {
    outcome: IdentityVerificationOutcome.VERIFIED,
    record,
    reason: null,
    holderName: record.holderName,
    provider: provider.name,
    providerReference: outcome.providerReference,
  };
}

async function checkVoterId(normalizedNumber: string): Promise<CheckResult> {
  const provider = requireIdentityProvider();
  await reserveProviderCall();

  const outcome = await provider.verifyVoterId({ epicNumber: normalizedNumber });

  if (!outcome.found || !outcome.record) {
    return {
      outcome: IdentityVerificationOutcome.NOT_FOUND,
      record: null,
      reason:
        outcome.message ??
        'The Election Commission has no record of this EPIC number. Check it against the card.',
      holderName: null,
      provider: provider.name,
      providerReference: outcome.providerReference,
    };
  }

  return {
    outcome: IdentityVerificationOutcome.VERIFIED,
    record: outcome.record,
    reason: null,
    holderName: outcome.record.holderName,
    provider: provider.name,
    providerReference: outcome.providerReference,
  };
}

async function checkGstin(normalizedNumber: string): Promise<CheckResult> {
  const provider = requireIdentityProvider();
  await reserveProviderCall();

  const outcome = await provider.verifyGstin({ gstin: normalizedNumber });

  if (!outcome.found || !outcome.record) {
    return {
      outcome: IdentityVerificationOutcome.NOT_FOUND,
      record: null,
      reason:
        outcome.message ??
        'The GST portal has no record of this GSTIN. Check it against the registration certificate.',
      holderName: null,
      provider: provider.name,
      providerReference: outcome.providerReference,
    };
  }

  const record = outcome.record;

  // A cancelled registration is the answer a customer checking a supplier
  // actually needs, and it is not the same as "not found".
  if (record.status && /cancel|suspend|inactive/i.test(record.status)) {
    return {
      outcome: IdentityVerificationOutcome.MISMATCH,
      record,
      reason: `The GST portal reports this registration as "${record.status}".`,
      holderName: record.legalName,
      provider: provider.name,
      providerReference: outcome.providerReference,
    };
  }

  return {
    outcome: IdentityVerificationOutcome.VERIFIED,
    record,
    reason: null,
    holderName: record.legalName,
    provider: provider.name,
    providerReference: outcome.providerReference,
  };
}

export interface IdentityVerifyOutcome {
  summary: IdentityVerificationSummary;
  /**
   * For a driver: where they now stand against all four checks.
   *
   * A verified PAN is one of four, so the reply says what is still outstanding
   * rather than letting a green tick on one number read as a verified driver.
   */
  driverChecklist: DriverVerificationChecklist | null;
  /** Audit metadata. Never contains the number or the holder's details. */
  audit: {
    verificationId: string;
    kind: IdentityDocumentKind;
    subjectType: VerificationSubjectType;
    subjectId: string;
    documentId: string | null;
    outcome: IdentityVerificationOutcome;
    cached: boolean;
    provider: string | null;
    providerReference: string | null;
  };
}

/**
 * Verify one identity number for one subject.
 *
 * Order matters and is deliberate: scope, then local checksum, then cache, then
 * — last, and only if all three allow it — the billable provider call.
 */
export async function verifyIdentity(
  auth: AuthContext,
  input: VerifyIdentityInput,
): Promise<IdentityVerifyOutcome> {
  const subject = await resolveSubject(auth, input.subjectType, input.subjectId);
  const definition = identityKindDefinition(input.kind);
  if (!definition) throw errors.validation('That identity document type is not supported.');

  const normalizedNumber = normalizeIdentityNumber(input.number);

  // The schema has already refused a malformed number, so reaching this branch
  // means a caller bypassed it. Recorded rather than thrown so the subject's
  // history is truthful about what was attempted.
  if (!isValidIdentityNumber(input.kind, normalizedNumber)) {
    throw errors.validation(
      `That ${definition.label} number is not valid. Nothing was sent to the records service.`,
    );
  }

  // A GSTIN embeds the holder's PAN. Checking that the two agree costs nothing
  // and catches a certificate pasted from another business.
  if (input.kind === IdentityDocumentKind.GST && panFromGstin(normalizedNumber) === null) {
    throw errors.validation('That GSTIN does not contain a valid PAN. Check it against the certificate.');
  }

  const numberHash = hashIdentityNumber(input.kind, normalizedNumber);
  const documentId = await resolveLinkedDocument(input, subject.organizationId);

  const existing = await prisma.identityVerification.findUnique({
    where: {
      subjectType_subjectId_kind: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
      },
    },
  });

  // --- Cache -------------------------------------------------------------
  //
  // Reused only for the *same* number and only while it has not expired. A
  // different number for the same subject is a new fact, not a cache miss to be
  // served stale, so the hash is part of the condition.
  if (
    !input.refresh &&
    existing &&
    existing.numberHash === numberHash &&
    existing.outcome === IdentityVerificationOutcome.VERIFIED &&
    existing.expiresAt !== null &&
    existing.expiresAt > new Date()
  ) {
    // A cache hit still (re)links the document, so verifying from one row and
    // then uploading a fresh scan does not leave the new row without a badge.
    const relinked =
      documentId && documentId !== existing.documentId
        ? await prisma.identityVerification.update({
            where: { id: existing.id },
            data: { documentId },
          })
        : existing;

    if (documentId) {
      await applyToDocument(documentId, relinked.outcome, relinked.reason, auth.user.id);
    }

    return {
      summary: toSummary(auth, relinked, { cached: true }),
      // Still reported on a cache hit: the *driver's* other checks may have
      // moved since this number was confirmed, and the caller is entitled to
      // the current picture either way.
      driverChecklist:
        input.subjectType === VerificationSubjectType.DRIVER
          ? await syncDriverVerificationStatus(input.subjectId, auth.user.id)
          : null,
      audit: {
        verificationId: relinked.id,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        documentId: relinked.documentId,
        outcome: relinked.outcome,
        cached: true,
        provider: relinked.provider,
        providerReference: relinked.providerReference,
      },
    };
  }

  // --- Provider ----------------------------------------------------------
  const result = await runCheck(input, normalizedNumber);

  const now = new Date();
  const ttlSeconds = config.identity.cacheTtlSeconds;
  const verified = result.outcome === IdentityVerificationOutcome.VERIFIED;

  const row = await prisma.identityVerification.upsert({
    where: {
      subjectType_subjectId_kind: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
      },
    },
    create: {
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      organizationId: subject.organizationId,
      documentId,
      numberHash,
      maskedNumber: maskIdentityNumber(input.kind, normalizedNumber),
      encryptedNumber: encryptIdentityNumber(normalizedNumber),
      outcome: result.outcome,
      reason: result.reason,
      holderName: result.holderName,
      provider: result.provider,
      providerReference: result.providerReference,
      responseData: (result.record as unknown as Prisma.InputJsonValue) ?? undefined,
      requestedById: auth.user.id,
      verifiedAt: verified ? now : null,
      checkedAt: now,
      expiresAt: verified && ttlSeconds > 0 ? new Date(now.getTime() + ttlSeconds * 1000) : null,
    },
    update: {
      organizationId: subject.organizationId,
      documentId,
      numberHash,
      maskedNumber: maskIdentityNumber(input.kind, normalizedNumber),
      encryptedNumber: encryptIdentityNumber(normalizedNumber),
      outcome: result.outcome,
      reason: result.reason,
      holderName: result.holderName,
      provider: result.provider,
      providerReference: result.providerReference,
      responseData: (result.record as unknown as Prisma.InputJsonValue) ?? undefined,
      requestedById: auth.user.id,
      verifiedAt: verified ? now : null,
      checkedAt: now,
      expiresAt: verified && ttlSeconds > 0 ? new Date(now.getTime() + ttlSeconds * 1000) : null,
    },
  });

  if (verified) {
    await applyToSubject(
      input.kind,
      input.subjectType,
      input.subjectId,
      normalizedNumber,
      result.record,
      now,
    );
  }

  if (documentId) {
    await applyToDocument(documentId, result.outcome, result.reason, auth.user.id);
  }

  serviceLogger.info(
    {
      kind: input.kind,
      subjectType: input.subjectType,
      masked: row.maskedNumber,
      outcome: result.outcome,
      numberRetained: canRetainIdentityNumbers,
    },
    'Identity verification completed',
  );

  notifyIdentityOutcome(auth, input, subject, result);

  /**
   * Re-evaluate the driver against all four checks.
   *
   * This is what makes the fourth confirmation complete the set on its own: a
   * driver whose licence, Aadhaar and PAN are already confirmed becomes
   * verified the moment their Voter ID lands here, with no separate button to
   * find. It runs on every outcome, not only a verified one, because a check
   * that has stopped passing has to take the status down with it.
   */
  const driverChecklist =
    input.subjectType === VerificationSubjectType.DRIVER
      ? await syncDriverVerificationStatus(input.subjectId, auth.user.id)
      : null;

  return {
    summary: toSummary(auth, row, { cached: false }),
    driverChecklist,
    audit: {
      verificationId: row.id,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      documentId: row.documentId,
      outcome: result.outcome,
      cached: false,
      provider: result.provider,
      providerReference: result.providerReference,
    },
  };
}

function runCheck(
  input: VerifyIdentityInput,
  normalizedNumber: string,
): Promise<CheckResult> {
  switch (input.kind) {
    case IdentityDocumentKind.AADHAAR:
      return checkAadhaar(normalizedNumber, input.linkedPan);
    case IdentityDocumentKind.PAN:
      return checkPan(normalizedNumber, input.holderName);
    case IdentityDocumentKind.VOTER_ID:
      return checkVoterId(normalizedNumber);
    case IdentityDocumentKind.GST:
      return checkGstin(normalizedNumber);
    default:
      throw errors.validation('That identity document type is not supported.');
  }
}

/**
 * Validate the document the check is being attached to.
 *
 * The id arrives from the client, so it is verified to exist, to belong to this
 * subject, and to be of the document type this kind actually verifies —
 * otherwise a caller could mark an unrelated document verified by pointing a
 * PAN check at it.
 */
async function resolveLinkedDocument(
  input: VerifyIdentityInput,
  organizationId: string | null,
): Promise<string | null> {
  if (!input.documentId) return null;

  // Per subject, because the document code differs: a driver's Aadhaar scan is
  // DRIVER_AADHAAR and an account holder's is USER_AADHAAR. Matching on the
  // kind alone would have refused the right document with the wrong reason.
  const definition = identityKindDefinition(input.kind, input.subjectType);
  const document = await prisma.document.findFirst({
    where: { id: input.documentId, ownerId: input.subjectId, deletedAt: null },
    select: { id: true, documentType: true, organizationId: true },
  });

  if (!document) throw errors.notFound('Document');
  if (organizationId !== null && document.organizationId !== organizationId) {
    throw errors.notFound('Document');
  }
  if (definition && document.documentType !== definition.documentType) {
    throw errors.validation(
      `That document is not a ${definition.label}, so a ${definition.label} check cannot be attached to it.`,
    );
  }

  return document.id;
}

/**
 * Tell somebody when a check fails.
 *
 * A green tick needs no notification — the person is looking at the screen. A
 * rejection does, because it is usually acted on by somebody other than whoever
 * pressed the button, and an unread failure is an onboarding that quietly
 * stalls.
 */
function notifyIdentityOutcome(
  auth: AuthContext,
  input: VerifyIdentityInput,
  subject: IdentitySubject,
  result: CheckResult,
): void {
  if (result.outcome === IdentityVerificationOutcome.VERIFIED) return;

  const definition = identityKindDefinition(input.kind);
  const label = definition?.label ?? input.kind;

  notifyAsync({
    userId: auth.user.id,
    organizationId: subject.organizationId,
    type:
      result.outcome === IdentityVerificationOutcome.UNCONFIRMED
        ? NotificationType.VERIFICATION_RESULT
        : NotificationType.DOCUMENT_REJECTED,
    title:
      result.outcome === IdentityVerificationOutcome.UNCONFIRMED
        ? `${label} awaiting review`
        : `${label} could not be verified`,
    body: `${subject.label}: ${result.reason ?? 'The records service did not confirm this number.'}`,
    priority:
      result.outcome === IdentityVerificationOutcome.UNCONFIRMED
        ? NotificationPriority.NORMAL
        : NotificationPriority.HIGH,
    actionUrl:
      input.subjectType === VerificationSubjectType.DRIVER
        ? `/fleet/drivers/${input.subjectId}`
        : input.subjectType === VerificationSubjectType.USER
          ? // Their own account, not their organization's — the person reading
            // this is the subject of the check.
            '/settings/profile'
          : '/settings/organization',
  });
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Retention sweep.
 *
 * Checks last touched more than IDENTITY_RETENTION_DAYS ago are deleted. As
 * with the RC and licence caches this window is deliberately longer than the
 * cache TTL: that one decides when a fresh provider call is worthwhile, this
 * one is how long Saarthi may hold the data at all.
 *
 * The verified *outcome* on the driver or organization row survives the sweep —
 * what is deleted is the check, its provider payload and the encrypted number,
 * not the fact that verification once succeeded.
 */
export async function runIdentityVerificationRetentionSweep(): Promise<number> {
  const cutoff = new Date(Date.now() - config.identity.retentionDays * 86_400_000);
  const deleted = await prisma.identityVerification.deleteMany({
    where: { checkedAt: { lt: cutoff } },
  });

  if (deleted.count > 0) {
    serviceLogger.info(
      { deleted: deleted.count },
      'Identity verification retention sweep complete',
    );
  }
  return deleted.count;
}

/**
 * The stored number for a subject's check, decrypted.
 *
 * Exists so a re-check does not have to ask an operator to type an Aadhaar
 * number again. Returns `null` when no key is configured, which is the
 * documented behaviour rather than a failure — see `identity-crypto.ts`.
 */
export async function getStoredIdentityNumber(
  auth: AuthContext,
  subjectType: VerificationSubjectType,
  subjectId: string,
  kind: IdentityDocumentKind,
): Promise<string | null> {
  await resolveSubject(auth, subjectType, subjectId);
  if (!canSeeIdentityHolderData(auth)) return null;

  const row = await prisma.identityVerification.findUnique({
    where: { subjectType_subjectId_kind: { subjectType, subjectId, kind } },
    select: { encryptedNumber: true },
  });

  return decryptIdentityNumber(row?.encryptedNumber);
}
