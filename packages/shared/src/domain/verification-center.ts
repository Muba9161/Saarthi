/**
 * The verification centre — which checks an account is asked for, and the
 * contracts of the paid "Pay & Verify" flow.
 *
 * Requirements follow the account's *audience* (driver, personal, business,
 * supplier, customer), never its plan: a plan is commercial, the audience is
 * operational. Two accounts on the same plan can be asked for different things,
 * and a customer is asked for nothing at all.
 */

import {
  type IdentityDocumentKind,
  VerificationChargeStatus,
  VerificationCheckType,
  VerificationOverallState,
  VerificationStepState,
  type VerificationSubjectType,
} from './enums';
import { ProfileAudience } from './profiles';
import type { CheckoutSession } from '../api/payments';

// ---------------------------------------------------------------------------
// Check types
// ---------------------------------------------------------------------------

export const VERIFICATION_CHECK_LABELS: Record<VerificationCheckType, string> = {
  [VerificationCheckType.AADHAAR]: 'Aadhaar',
  [VerificationCheckType.PAN]: 'PAN',
  [VerificationCheckType.VOTER_ID]: 'Voter ID',
  [VerificationCheckType.GST]: 'GST',
  [VerificationCheckType.DRIVING_LICENCE]: 'Driving licence',
  [VerificationCheckType.VEHICLE_RC]: 'Vehicle RC',
};

/** The billable check an identity kind is charged as. */
export function checkTypeForIdentityKind(kind: IdentityDocumentKind): VerificationCheckType {
  return kind as VerificationCheckType;
}

/** The identity kind a check type runs as, or null for a registry check. */
export function identityKindForCheckType(
  checkType: VerificationCheckType,
): IdentityDocumentKind | null {
  switch (checkType) {
    case VerificationCheckType.AADHAAR:
    case VerificationCheckType.PAN:
    case VerificationCheckType.VOTER_ID:
    case VerificationCheckType.GST:
      return checkType;
    default:
      return null;
  }
}

/** Charge states that will not move again on their own. */
export const TERMINAL_CHARGE_STATUSES: readonly VerificationChargeStatus[] = [
  VerificationChargeStatus.PAYMENT_FAILED,
  VerificationChargeStatus.VERIFIED,
  VerificationChargeStatus.FAILED,
  VerificationChargeStatus.RETRY_REQUIRED,
];

export function isTerminalChargeStatus(status: VerificationChargeStatus): boolean {
  return TERMINAL_CHARGE_STATUSES.includes(status);
}

/** The wizard step state a paid attempt puts its step in. */
export function stepStateForCharge(status: VerificationChargeStatus): VerificationStepState {
  switch (status) {
    case VerificationChargeStatus.PAYMENT_PROCESSING:
      return VerificationStepState.PAYMENT_PROCESSING;
    case VerificationChargeStatus.PAYMENT_FAILED:
      return VerificationStepState.PAYMENT_REQUIRED;
    case VerificationChargeStatus.PAID:
    case VerificationChargeStatus.VERIFYING:
      return VerificationStepState.VERIFYING;
    case VerificationChargeStatus.VERIFIED:
      return VerificationStepState.VERIFIED;
    case VerificationChargeStatus.FAILED:
      return VerificationStepState.FAILED;
    case VerificationChargeStatus.RETRY_REQUIRED:
    default:
      return VerificationStepState.RETRY_REQUIRED;
  }
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

/** Wizard grouping, in display order. */
export const VerificationStepGroup = {
  IDENTITY: 'IDENTITY',
  TAX_BUSINESS: 'TAX_BUSINESS',
  DOCUMENTS: 'DOCUMENTS',
} as const;
export type VerificationStepGroup = (typeof VerificationStepGroup)[keyof typeof VerificationStepGroup];

export const VERIFICATION_STEP_GROUP_LABELS: Record<VerificationStepGroup, string> = {
  IDENTITY: 'Identity',
  TAX_BUSINESS: 'Tax / Business',
  DOCUMENTS: 'Documents',
};

/**
 * Whose record a step checks.
 *
 * `ACCOUNT_HOLDER` is the person who holds a business account — its owner —
 * which is who "owner Aadhaar" means. It is a USER subject, recorded against
 * that person and nobody else.
 */
export type VerificationStepSubject = 'DRIVER' | 'ACCOUNT_HOLDER' | 'ORGANIZATION';

export interface VerificationRequirement {
  id: string;
  group: VerificationStepGroup;
  subject: VerificationStepSubject;
  /** The billable online check, or null for a document reviewed by a person. */
  checkType: VerificationCheckType | null;
  /** The document a manual-review step is satisfied by. */
  documentType: string | null;
  title: string;
  description: string;
}

const OWNER_AADHAAR: VerificationRequirement = {
  id: 'owner-aadhaar',
  group: VerificationStepGroup.IDENTITY,
  subject: 'ACCOUNT_HOLDER',
  checkType: VerificationCheckType.AADHAAR,
  documentType: null,
  title: 'Owner Aadhaar',
  description: 'Verify the account owner’s Aadhaar against the PAN it is linked to.',
};

const COMPANY_PAN: VerificationRequirement = {
  id: 'company-pan',
  group: VerificationStepGroup.TAX_BUSINESS,
  subject: 'ORGANIZATION',
  checkType: VerificationCheckType.PAN,
  documentType: null,
  title: 'Company PAN',
  description: 'Verify your business PAN with the Income Tax Department.',
};

const COMPANY_GST: VerificationRequirement = {
  id: 'company-gst',
  group: VerificationStepGroup.TAX_BUSINESS,
  subject: 'ORGANIZATION',
  checkType: VerificationCheckType.GST,
  documentType: null,
  title: 'GST',
  description: 'Verify your GSTIN with the GST portal.',
};

const BUSINESS_REQUIREMENTS: readonly VerificationRequirement[] = [
  OWNER_AADHAAR,
  COMPANY_PAN,
  COMPANY_GST,
];

const REQUIREMENTS: Record<ProfileAudience, readonly VerificationRequirement[]> = {
  [ProfileAudience.DRIVER]: [
    {
      id: 'driver-licence',
      group: VerificationStepGroup.IDENTITY,
      subject: 'DRIVER',
      checkType: VerificationCheckType.DRIVING_LICENCE,
      documentType: null,
      title: 'Driving licence',
      description: 'Verify the driving licence with the licensing authority.',
    },
    {
      id: 'driver-aadhaar',
      group: VerificationStepGroup.IDENTITY,
      subject: 'DRIVER',
      checkType: VerificationCheckType.AADHAAR,
      documentType: null,
      title: 'Aadhaar',
      description: 'Verify the Aadhaar against the PAN it is linked to.',
    },
    {
      id: 'driver-pan',
      group: VerificationStepGroup.TAX_BUSINESS,
      subject: 'DRIVER',
      checkType: VerificationCheckType.PAN,
      documentType: null,
      title: 'PAN',
      description: 'Verify the PAN with the Income Tax Department.',
    },
    {
      id: 'driver-voter-id',
      group: VerificationStepGroup.IDENTITY,
      subject: 'DRIVER',
      checkType: VerificationCheckType.VOTER_ID,
      documentType: null,
      title: 'Voter ID',
      description: 'Verify the Voter ID (EPIC) with the Election Commission.',
    },
  ],
  /*
   * One step. The Aadhaar check already asks for the PAN it is linked to and
   * confirms the pair with the Income Tax Department, so a separate PAN step
   * would ask for the same number twice and charge for it twice — and nothing
   * on a Personal account reads the holder's PAN on its own.
   */
  [ProfileAudience.PERSONAL]: [
    {
      id: 'personal-aadhaar',
      group: VerificationStepGroup.IDENTITY,
      subject: 'ACCOUNT_HOLDER',
      checkType: VerificationCheckType.AADHAAR,
      documentType: null,
      title: 'Aadhaar',
      description: 'Verify your Aadhaar against the PAN it is linked to.',
    },
  ],
  [ProfileAudience.FLEET]: BUSINESS_REQUIREMENTS,
  [ProfileAudience.MOBILITY]: BUSINESS_REQUIREMENTS,
  [ProfileAudience.SUPPLIER]: [
    ...BUSINESS_REQUIREMENTS,
    {
      id: 'supplier-material-licence',
      group: VerificationStepGroup.DOCUMENTS,
      subject: 'ORGANIZATION',
      checkType: null,
      documentType: 'SUPPLIER_MATERIAL_LICENCE',
      title: 'Material licence',
      description:
        'Upload the government licence or permit for the materials you supply. The Saarthi team reviews it.',
    },
  ],
  // A customer's trust comes from their requirement and order history, not
  // from documents.
  [ProfileAudience.CUSTOMER]: [],
  [ProfileAudience.ASSOCIATION]: [],
  [ProfileAudience.PLATFORM]: [],
};

/** The steps an audience is asked for, in wizard order. */
export function verificationRequirementsFor(
  audience: ProfileAudience,
): readonly VerificationRequirement[] {
  const order: VerificationStepGroup[] = ['IDENTITY', 'TAX_BUSINESS', 'DOCUMENTS'];
  return [...(REQUIREMENTS[audience] ?? [])].sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group),
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** What the customer pays for one check. Provider cost is never included. */
export interface VerificationPriceView {
  checkType: VerificationCheckType;
  /** Final amount in INR, tax included. */
  amount: number;
  currency: string;
  /** False when no active price or no configured provider exists. */
  available: boolean;
}

/** One paid attempt, as the payer sees it. */
export interface VerificationChargeView {
  id: string;
  checkType: VerificationCheckType;
  subjectType: VerificationSubjectType;
  subjectId: string;
  status: VerificationChargeStatus;
  amount: number;
  currency: string;
  paymentReference: string;
  maskedNumber: string | null;
  /** Why a non-VERIFIED outcome came out that way. */
  reason: string | null;
  /** A RETRY_REQUIRED credit: the next attempt for this check is free. */
  freeRetryAvailable: boolean;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
}

/** The reply to Pay & Verify. */
export interface StartVerificationResult {
  /**
   * `ALREADY_VERIFIED` — nothing charged. `COMPLETED_FREE` — answered without
   * a billable call (a free retry, or a locally decided outcome).
   * `CHECKOUT` — pay through the hosted checkout first. `COMPLETED` — paid and
   * run in-process.
   */
  mode: 'ALREADY_VERIFIED' | 'COMPLETED_FREE' | 'CHECKOUT' | 'COMPLETED';
  charge: VerificationChargeView | null;
  checkout: CheckoutSession | null;
  /** The step's state once this call returns — the value the UI trusts. */
  state: VerificationStepState;
  message: string | null;
  /**
   * The owning module's own answer — an identity summary or a registry result,
   * as its direct endpoint returns it, redacted for this caller. Present when
   * the check ran within this request; null when it waits on a checkout.
   */
  detail: unknown;
}

export interface VerificationStepView {
  id: string;
  group: VerificationStepGroup;
  title: string;
  description: string;
  checkType: VerificationCheckType | null;
  documentType: string | null;
  subjectType: VerificationSubjectType;
  /** Null when the subject does not exist yet (no owner found, for example). */
  subjectId: string | null;
  state: VerificationStepState;
  /** Masked number or reference of what was verified, when there is one. */
  reference: string | null;
  reason: string | null;
  verifiedAt: string | null;
  price: VerificationPriceView | null;
  /** The latest paid attempt for this step. */
  charge: VerificationChargeView | null;
  /** False when this caller may see the step but not complete it. */
  actionable: boolean;
  blockedReason: string | null;
}

export interface VerificationCenterView {
  subjectType: VerificationSubjectType;
  subjectId: string;
  audience: ProfileAudience;
  overall: VerificationOverallState;
  onlineVerificationAvailable: boolean;
  steps: VerificationStepView[];
}

/** Admin-only economics for one charge. */
export interface VerificationEconomicsRow {
  id: string;
  checkType: VerificationCheckType;
  status: VerificationChargeStatus;
  organizationId: string;
  provider: string;
  providerCost: number | null;
  providerCostCurrency: string;
  customerPrice: number;
  currency: string;
  /** Null when provider cost and price are in different currencies and no rate is configured. */
  grossSpread: number | null;
  providerBilled: boolean | null;
  pricingVersion: string;
  paymentReference: string;
  providerReference: string | null;
  createdAt: string;
}

/** Derive the overall state from the steps. */
export function overallVerificationState(
  steps: readonly { state: VerificationStepState }[],
): VerificationOverallState {
  if (steps.length === 0) return VerificationOverallState.NOT_REQUIRED;
  if (steps.every((step) => step.state === VerificationStepState.VERIFIED)) {
    return VerificationOverallState.VERIFIED;
  }
  if (steps.every((step) => step.state === VerificationStepState.NOT_STARTED)) {
    return VerificationOverallState.NOT_STARTED;
  }
  return VerificationOverallState.IN_PROGRESS;
}
