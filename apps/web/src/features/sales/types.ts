import type {
  OnboardingReadiness,
  PlanTier,
  ReferralSource,
  ReferralStatus,
  SalesLeadSource,
  SalesLeadStatus,
  SalesmanStatus,
  SalesmanVerificationMethod,
  TrackerHandoverStatus,
  VehicleType,
  WalletEntryStatus,
} from '@saarthi/shared';

/**
 * Response shapes for the Sales API.
 *
 * Mirrors the view types the API's sales services return, so the screens are
 * typed against the contract rather than against `any`. Kept here rather than
 * in `lib/api-types.ts` because the sales surface is self-contained and this
 * keeps the shared types file from growing another eleven interfaces.
 *
 * The enums come from `@saarthi/shared`, so a status added to the API cannot
 * silently become an unhandled string on a screen.
 */

export interface SalesmanProfileView {
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
  /** True when this profile may share a referral link and earn rewards. */
  canSell: boolean;
  /** Why it cannot, in the salesperson's own language. Always populated. */
  standing: string;
  note: string | null;
  createdAt: string;
}

export interface SalesMeResponse {
  /** Null for a platform administrator with no salesman profile of their own. */
  profile: SalesmanProfileView | null;
  /** False when this environment cannot ask GODWeb about a GODID at all. */
  godWebVerificationAvailable: boolean;
  attributionWindowDays: number;
}

export interface HandoverSummary {
  available: number;
  handedOver: number;
  installed: number;
  returned: number;
  lost: number;
}

export interface SalesDashboardResponse {
  salesmanId: string;
  godId: string;
  leads: {
    total: number;
    open: number;
    overdue: number;
    demosCompleted: number;
    converted: number;
    lost: number;
  };
  referrals: { captured: number; attributed: number; converted: number };
  customers: { total: number; active: number };
  trackers: HandoverSummary;
  /** The salesperson's wallet. Every reward in it is a successful referral. */
  earnings: { totalEarned: number; available: number; held: number };
  onboarding: { awaitingFirstVehicle: number; completed: number };
}

export interface LeadView {
  id: string;
  salesmanId: string;
  salesmanName: string | null;
  contactName: string;
  businessName: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  fleetSize: number | null;
  vehicleTypes: VehicleType[];
  interestedPlan: PlanTier | null;
  source: SalesLeadSource;
  status: SalesLeadStatus;
  notes: string | null;
  nextFollowUpAt: string | null;
  followUpOverdue: boolean;
  organizationId: string | null;
  organizationName: string | null;
  attributionId: string | null;
  demoCompletedAt: string | null;
  onboardingCompletedAt: string | null;
  firstVehicleId: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /**
   * The stages this lead may be moved to, right now.
   *
   * Sent by the API rather than derived on the client, so the dropdown and the
   * server's guard cannot disagree — and so the system-set stages never appear
   * as options a salesperson can pick and be refused.
   */
  availableStatuses: SalesLeadStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface LeadEventView {
  id: string;
  type: string;
  fromStatus: SalesLeadStatus | null;
  toStatus: SalesLeadStatus | null;
  note: string | null;
  createdAt: string;
}

export interface ReferralShareResponse {
  godId: string;
  code: string;
  url: string;
  /** SVG data URI from the API's QR service. Null if it could not be drawn. */
  qrDataUri: string | null;
  attributionWindowDays: number;
  shareText: string;
}

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
  attributionWindowDays: number;
  /** The salesperson's reward for this customer. Null when none was earned. */
  reward: { amount: number; status: WalletEntryStatus; availableAt: string } | null;
}

export interface SalesCustomerView {
  organizationId: string;
  name: string;
  city: string | null;
  source: string;
  attributedAt: string | null;
  subscription: { planTier: PlanTier | null; status: string | null };
  vehicles: number;
  trackers: number;
  live: number;
  leadId: string | null;
  leadStatus: SalesLeadStatus | null;
  onboardingCompletedAt: string | null;
}

export interface CustomerVehiclesResponse {
  organizationId: string;
  organizationName: string;
  vehicles: {
    id: string;
    registrationNumber: string;
    vehicleType: string;
    hasTracker: boolean;
    live: boolean;
  }[];
}

export interface HandoverView {
  id: string;
  trackerId: string;
  salesmanId: string;
  salesmanName: string | null;
  leadId: string | null;
  organizationId: string | null;
  organizationName: string | null;
  status: TrackerHandoverStatus;
  serialNumber: string | null;
  assignedAt: string;
  handedOverAt: string | null;
  acknowledgedBy: string | null;
  installedAt: string | null;
  vehicleId: string | null;
  vehicleRegistration: string | null;
  returnedAt: string | null;
  closeReason: string | null;
  note: string | null;
}

export interface DemoScriptResponse {
  demoModeEnabled: boolean;
  capabilities: {
    key: string;
    label: string;
    route: string;
    talkingPoint: string;
    needsSimulator: boolean;
  }[];
  prohibitions: string[];
  pricing: {
    /** GST included. */
    plans: { tier: string; name: string; priceMonthly: number | null }[];
    /** Base prices, before GST. */
    trackers: { name: string; priceOneTime: number; price: number }[];
    /** GST included. */
    vehicleTopUpMonthly: number;
    example: {
      vehicles: number;
      trackers: number;
      tier: string;
      monthlyTotal: number;
      oneOffTotal: number;
    };
  };
  notice: string;
}

export interface AssistedSignupResponse {
  leadId: string;
  signupUrl: string;
  sentTo: string;
  notice: string;
}

export interface PublicReferralView {
  code: string;
  salesmanName: string | null;
  territory: string | null;
  valid: boolean;
}

export interface AttributionOutcome {
  attributed: boolean;
  attributionId: string | null;
  reason: string | null;
}

export interface OnboardingCompleteResponse {
  completed: boolean;
  reason: string | null;
  readiness: OnboardingReadiness | null;
}

export type { OnboardingReadiness };
