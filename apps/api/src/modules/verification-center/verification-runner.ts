import {
  IdentityVerificationOutcome,
  VerificationCheckType,
  VerificationSubjectType,
  identityKindForCheckType,
  maskIdentityNumber,
  normalizeIdentityNumber,
  type StartVerificationInput,
  type VerifyIdentityInput,
} from '@saarthi/shared';
import { hashIdentityNumber } from '../../lib/identity-crypto';
import type { ProviderCallGate } from '../../lib/provider-call-gate';
import { AuditAction, recordAudit } from '../audit/audit.service';
import {
  canSeeIdentityHolderData,
  verifyIdentity,
} from '../identity-verification/identity-verification.service';
import { verifyAgainstRegistry } from '../verification/registry-verification.service';
import type { AuthContext } from '../../auth/context';

/**
 * Runs one check through the module that owns it.
 *
 * Nothing about verification is reimplemented here. An identity kind goes to
 * the identity service and a licence or RC to the registry service — each with
 * its own scoping, checksum rules, cache, redaction and persistence — and the
 * only thing added is the gate that decides whether the billable call may
 * happen. The answer comes back in one shape, so the charge that paid for it
 * does not need to know which module answered.
 */

export interface CheckRunOutcome {
  verified: boolean;
  /** Answered from a stored VERIFIED record — no billable call was needed. */
  alreadyVerified: boolean;
  /** Awaiting a human reviewer (an Aadhaar with no PAN to link-check). */
  underReview: boolean;
  /** The provider answered a fresh call — and so charged Saarthi for it. */
  providerBilled: boolean;
  reason: string | null;
  maskedNumber: string | null;
  providerReference: string | null;
  /** The identity check or verification case written. */
  resultId: string | null;
  /** The owning module's own reply, redacted for this caller. */
  detail: unknown;
}

/** The masked form and hash of the number being checked, when there is one. */
export function describeNumber(
  input: StartVerificationInput,
): { maskedNumber: string | null; numberHash: string | null } {
  const kind = identityKindForCheckType(input.kind);
  if (!kind || !('number' in input)) return { maskedNumber: null, numberHash: null };
  const normalized = normalizeIdentityNumber(input.number);
  return {
    maskedNumber: maskIdentityNumber(kind, normalized),
    numberHash: hashIdentityNumber(kind, normalized),
  };
}

export async function runVerificationCheck(
  auth: AuthContext,
  input: StartVerificationInput,
  gate: ProviderCallGate,
): Promise<CheckRunOutcome> {
  if (identityKindForCheckType(input.kind)) {
    const { summary, audit } = await verifyIdentity(auth, input as VerifyIdentityInput, { gate });

    // Written here as the route writes it, so the environment's billable-call
    // ceiling — which counts these rows — sees paid checks too.
    await recordAudit({
      action: AuditAction.IDENTITY_VERIFICATION_CHECKED,
      entityType: 'IdentityVerification',
      entityId: audit.verificationId,
      actorUserId: auth.user.id,
      organizationId: auth.organizationId,
      after: {
        kind: audit.kind,
        subjectType: audit.subjectType,
        subjectId: audit.subjectId,
        documentId: audit.documentId,
        outcome: audit.outcome,
        cached: audit.cached,
        provider: audit.provider,
        providerReference: audit.providerReference,
        sensitiveFieldsIncluded: canSeeIdentityHolderData(auth),
        paid: true,
      },
    });

    const verified = summary.outcome === IdentityVerificationOutcome.VERIFIED;
    return {
      verified,
      alreadyVerified: verified && summary.cached,
      underReview: summary.outcome === IdentityVerificationOutcome.UNCONFIRMED && !summary.provider,
      providerBilled: !summary.cached && summary.provider !== null,
      reason: summary.reason,
      maskedNumber: summary.maskedNumber,
      providerReference: summary.providerReference,
      resultId: summary.id,
      detail: summary,
    };
  }

  const subjectType =
    input.kind === VerificationCheckType.VEHICLE_RC
      ? VerificationSubjectType.TRUCK
      : VerificationSubjectType.DRIVER;
  const { result, audit } = await verifyAgainstRegistry(
    auth,
    subjectType,
    input.subjectId,
    {
      refresh: input.refresh,
      ...('dateOfBirth' in input && input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
      ...('licenceNumber' in input && input.licenceNumber
        ? { licenceNumber: input.licenceNumber }
        : {}),
    },
    { gate },
  );

  await recordAudit({
    action: audit.verified ? AuditAction.VERIFICATION_APPROVED : AuditAction.VERIFICATION_REJECTED,
    entityType: 'VerificationCase',
    entityId: audit.caseId,
    actorUserId: auth.user.id,
    organizationId: result.case.organizationId,
    after: {
      decision: audit.verified ? 'VERIFIED' : 'REJECTED',
      registryCheck: true,
      source: audit.source,
      subjectType: audit.subjectType,
      subjectId: audit.subjectId,
      outcome: audit.outcome,
      providerCalled: audit.checked && !audit.cached,
      cached: audit.cached,
      lookupId: audit.lookupId,
      providerReference: audit.providerReference,
      findings: audit.findingCodes,
      paid: true,
    },
  });

  return {
    verified: result.verified,
    alreadyVerified: false,
    underReview: false,
    providerBilled: result.registry.checked && !result.registry.cached,
    reason: result.verified ? null : result.summary,
    maskedNumber: result.reference,
    providerReference: result.registry.providerReference,
    resultId: result.case.id,
    detail: result,
  };
}
