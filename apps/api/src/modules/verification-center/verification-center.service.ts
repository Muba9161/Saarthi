import {
  DocumentOwnerType,
  IdentityVerificationOutcome,
  ProfileAudience,
  VerificationChargeStatus,
  VerificationCheckType,
  VerificationStepState,
  VerificationSubjectType,
  identityKindForCheckType,
  overallVerificationState,
  resolveProfileAudience,
  stepStateForCharge,
  verificationRequirementsFor,
  type VerificationCenterView,
  type VerificationEconomicsRow,
  type VerificationRequirement,
  type VerificationStepView,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { identityProviderConfigured } from '../../providers/identity';
import { accountHolderUserId } from '../identity-verification/personal-onboarding.guard';
import { latestChargesFor, toChargeView } from './verification-charge.service';
import { listPriceViews } from './verification-pricing.service';
import type { AuthContext } from '../../auth/context';

/**
 * The verification centre: which steps this account is asked for, and where
 * each one stands.
 *
 * Every state is derived here from persisted records — the verified-at facts on
 * the subject rows, the paid attempts, the reviewed documents. The wizard only
 * renders it, which is what makes its success animation trustworthy: it can
 * only ever celebrate a VERIFIED that the database already holds.
 */

interface ResolvedSubjects {
  audience: ProfileAudience;
  driverId: string | null;
  holderUserId: string | null;
  organizationId: string | null;
}

async function resolveSubjects(
  auth: AuthContext,
  driverId: string | undefined,
): Promise<ResolvedSubjects> {
  // A fleet looking at one of its drivers: the driver's steps, nobody else's.
  if (driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: { organizationId: true },
    });
    const allowed =
      driver &&
      (auth.isPlatformAdmin ||
        auth.driverId === driverId ||
        driver.organizationId === auth.organizationId);
    if (!allowed) throw errors.notFound('Driver');
    return {
      audience: ProfileAudience.DRIVER,
      driverId,
      holderUserId: null,
      organizationId: driver.organizationId,
    };
  }

  const audience = resolveProfileAudience({
    roles: auth.user.roles,
    membershipRole: auth.organization?.membershipRole ?? null,
    organizationType: auth.organization?.type ?? null,
    isPersonalSeat: auth.organization?.isPersonalSeat ?? null,
  });

  return {
    audience,
    driverId: auth.driverId,
    holderUserId:
      audience === ProfileAudience.PERSONAL
        ? auth.user.id
        : auth.organizationId
          ? await accountHolderUserId(auth.organizationId)
          : null,
    organizationId: auth.organizationId,
  };
}

function subjectFor(
  requirement: VerificationRequirement,
  subjects: ResolvedSubjects,
): { subjectType: VerificationSubjectType; subjectId: string | null } {
  switch (requirement.subject) {
    case 'DRIVER':
      return { subjectType: VerificationSubjectType.DRIVER, subjectId: subjects.driverId };
    case 'ACCOUNT_HOLDER':
      return { subjectType: VerificationSubjectType.USER, subjectId: subjects.holderUserId };
    case 'ORGANIZATION':
    default:
      return { subjectType: VerificationSubjectType.ORGANIZATION, subjectId: subjects.organizationId };
  }
}

/** The verified-at fact on the subject row — survives the retention sweep. */
async function verifiedFacts(subjects: ResolvedSubjects): Promise<Map<string, Date | null>> {
  const facts = new Map<string, Date | null>();
  const key = (subjectType: VerificationSubjectType, checkType: VerificationCheckType) =>
    `${subjectType}:${checkType}`;

  const [driver, holder, organization] = await Promise.all([
    subjects.driverId
      ? prisma.driver.findUnique({
          where: { id: subjects.driverId },
          select: {
            licenceVerifiedAt: true,
            aadhaarVerifiedAt: true,
            panVerifiedAt: true,
            voterIdVerifiedAt: true,
          },
        })
      : null,
    subjects.holderUserId
      ? prisma.user.findUnique({
          where: { id: subjects.holderUserId },
          select: { aadhaarVerifiedAt: true, panVerifiedAt: true },
        })
      : null,
    subjects.organizationId
      ? prisma.organization.findUnique({
          where: { id: subjects.organizationId },
          select: { panVerifiedAt: true, gstVerifiedAt: true },
        })
      : null,
  ]);

  const D = VerificationSubjectType.DRIVER;
  const U = VerificationSubjectType.USER;
  const O = VerificationSubjectType.ORGANIZATION;
  facts.set(key(D, VerificationCheckType.DRIVING_LICENCE), driver?.licenceVerifiedAt ?? null);
  facts.set(key(D, VerificationCheckType.AADHAAR), driver?.aadhaarVerifiedAt ?? null);
  facts.set(key(D, VerificationCheckType.PAN), driver?.panVerifiedAt ?? null);
  facts.set(key(D, VerificationCheckType.VOTER_ID), driver?.voterIdVerifiedAt ?? null);
  facts.set(key(U, VerificationCheckType.AADHAAR), holder?.aadhaarVerifiedAt ?? null);
  facts.set(key(U, VerificationCheckType.PAN), holder?.panVerifiedAt ?? null);
  facts.set(key(O, VerificationCheckType.PAN), organization?.panVerifiedAt ?? null);
  facts.set(key(O, VerificationCheckType.GST), organization?.gstVerifiedAt ?? null);
  return facts;
}

function identityOutcomeState(outcome: IdentityVerificationOutcome, provider: string | null): VerificationStepState {
  switch (outcome) {
    case IdentityVerificationOutcome.VERIFIED:
      return VerificationStepState.VERIFIED;
    case IdentityVerificationOutcome.UNCONFIRMED:
      // No provider was asked: an Aadhaar with no PAN waiting on a reviewer.
      return provider ? VerificationStepState.FAILED : VerificationStepState.UNDER_REVIEW;
    default:
      return VerificationStepState.FAILED;
  }
}

export async function getVerificationCenter(
  auth: AuthContext,
  query: { driverId?: string | undefined },
): Promise<VerificationCenterView> {
  const subjects = await resolveSubjects(auth, query.driverId);
  const requirements = verificationRequirementsFor(subjects.audience);

  const placed = requirements.map((requirement) => ({
    requirement,
    ...subjectFor(requirement, subjects),
  }));
  const present = placed.filter(
    (entry): entry is typeof entry & { subjectId: string } => entry.subjectId !== null,
  );

  const [facts, prices, charges, identityRows, documents] = await Promise.all([
    verifiedFacts(subjects),
    listPriceViews(),
    latestChargesFor(subjects.organizationId, present),
    present.length
      ? prisma.identityVerification.findMany({
          where: {
            OR: present.map((entry) => ({ subjectType: entry.subjectType, subjectId: entry.subjectId })),
          },
        })
      : [],
    subjects.organizationId && requirements.some((r) => r.documentType)
      ? prisma.document.findMany({
          where: {
            ownerType: DocumentOwnerType.ORGANIZATION,
            ownerId: subjects.organizationId,
            documentType: { in: requirements.flatMap((r) => (r.documentType ? [r.documentType] : [])) },
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [],
  ]);

  const steps = placed.map(({ requirement, subjectType, subjectId }): VerificationStepView => {
    const base = {
      id: requirement.id,
      group: requirement.group,
      title: requirement.title,
      description: requirement.description,
      checkType: requirement.checkType,
      documentType: requirement.documentType,
      subjectType,
      subjectId,
      price: null,
      charge: null,
      reference: null,
      reason: null,
      verifiedAt: null,
    };

    if (!subjectId) {
      return {
        ...base,
        state: VerificationStepState.NOT_STARTED,
        actionable: false,
        blockedReason:
          requirement.subject === 'DRIVER'
            ? 'No driver profile is linked to this account.'
            : 'This account has no owner on record.',
      };
    }

    // A person's own identity is theirs to verify — nobody else on the account.
    const actionable =
      requirement.subject !== 'ACCOUNT_HOLDER' || subjectId === auth.user.id || auth.isPlatformAdmin;
    const blockedReason = actionable ? null : 'Only the account owner can verify their own identity.';

    // --- A document reviewed by a person ---------------------------------
    if (!requirement.checkType) {
      const document = documents.find((entry) => entry.documentType === requirement.documentType);
      const state = !document
        ? VerificationStepState.NOT_STARTED
        : document.verificationStatus === 'VERIFIED'
          ? VerificationStepState.VERIFIED
          : document.verificationStatus === 'REJECTED'
            ? VerificationStepState.FAILED
            : VerificationStepState.UNDER_REVIEW;
      return {
        ...base,
        state,
        reference: document?.fileName ?? null,
        reason: document?.rejectionReason ?? null,
        verifiedAt: document?.verifiedAt?.toISOString() ?? null,
        actionable,
        blockedReason,
      };
    }

    // --- A billable online check -----------------------------------------
    const checkType = requirement.checkType;
    const price = prices.find((entry) => entry.checkType === checkType) ?? null;
    const charge =
      charges.find(
        (entry) =>
          entry.checkType === checkType &&
          entry.subjectType === subjectType &&
          entry.subjectId === subjectId,
      ) ?? null;
    const identityKind = identityKindForCheckType(checkType);
    const identityRow = identityKind
      ? (identityRows.find(
          (row) => row.kind === identityKind && row.subjectType === subjectType && row.subjectId === subjectId,
        ) ?? null)
      : null;
    const verifiedAt = facts.get(`${subjectType}:${checkType}`) ?? null;

    let state: VerificationStepState;
    if (verifiedAt) state = VerificationStepState.VERIFIED;
    else if (charge && charge.status !== VerificationChargeStatus.VERIFIED)
      state = stepStateForCharge(charge.status as VerificationChargeStatus);
    else if (identityRow) state = identityOutcomeState(identityRow.outcome, identityRow.provider);
    else state = VerificationStepState.NOT_STARTED;

    return {
      ...base,
      state,
      reference: identityRow?.maskedNumber ?? charge?.maskedNumber ?? null,
      reason: state === VerificationStepState.VERIFIED ? null : (charge?.reason ?? identityRow?.reason ?? null),
      verifiedAt: verifiedAt?.toISOString() ?? null,
      price,
      charge: charge ? toChargeView(charge) : null,
      actionable,
      blockedReason,
    };
  });

  return {
    subjectType: query.driverId ? VerificationSubjectType.DRIVER : VerificationSubjectType.USER,
    subjectId: query.driverId ?? auth.user.id,
    audience: subjects.audience,
    overall: overallVerificationState(steps),
    onlineVerificationAvailable: identityProviderConfigured,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Internal economics
// ---------------------------------------------------------------------------

/**
 * Provider cost against customer price, per charge — platform admins only.
 *
 * "Gross spread", not profit: payment processing, tax, support and refunds
 * are not in it. It is computed only where both figures share a currency or a
 * USD→INR rate has been configured; otherwise it is left null rather than
 * guessed.
 */
export async function listVerificationEconomics(limit = 200): Promise<VerificationEconomicsRow[]> {
  const rows = await prisma.verificationCharge.findMany({
    where: { status: { notIn: [VerificationChargeStatus.PAYMENT_PROCESSING, VerificationChargeStatus.PAYMENT_FAILED] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const rate = config.verificationFees.usdInrRate;

  return rows.map((row) => {
    const price = Number(row.customerPrice);
    const cost = row.providerCost === null ? null : Number(row.providerCost);
    const costInPriceCurrency =
      cost === null
        ? null
        : row.providerCostCurrency === row.currency
          ? cost
          : row.providerCostCurrency === 'USD' && row.currency === 'INR' && rate
            ? cost * rate
            : null;
    // An attempt the provider did not bill for cost Saarthi nothing.
    const incurred = row.providerBilled === false ? 0 : costInPriceCurrency;
    return {
      id: row.id,
      checkType: row.checkType as VerificationCheckType,
      status: row.status as VerificationChargeStatus,
      organizationId: row.organizationId,
      provider: row.provider,
      providerCost: cost,
      providerCostCurrency: row.providerCostCurrency,
      customerPrice: price,
      currency: row.currency,
      grossSpread: incurred === null ? null : Math.round((price - incurred) * 100) / 100,
      providerBilled: row.providerBilled,
      pricingVersion: row.pricingVersion,
      paymentReference: row.paymentReference,
      providerReference: row.providerReference,
      createdAt: row.createdAt.toISOString(),
    };
  });
}
