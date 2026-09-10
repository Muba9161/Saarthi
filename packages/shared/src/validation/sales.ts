import { z } from 'zod';
import {
  CommissionStatus,
  CommissionTrigger,
  CommissionType,
  PlanTier,
  ReferralSource,
  SalesLeadSource,
  SalesLeadStatus,
  SalesmanStatus,
  TrackerHandoverStatus,
  VehicleType,
} from '../domain/enums';
import { GODID_MAX_LENGTH, isPlausibleGodId, normalizeGodId } from '../domain/sales';
import { SELF_SERVICE_REFERRAL_SOURCES } from '../domain/sales';
import {
  csvEnum,
  emailSchema,
  moneySchema,
  optionalPhoneSchema,
  optionalTrimmedString,
  paginationSchema,
  phoneSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Input contracts for the sales, referral and commission surface.
 *
 * Two things are validated here that are easy to miss.
 *
 * Nothing in this file accepts a commission *amount*. Every schema that
 * touches money takes either the terms of a rule (administrator input) or a
 * decision on an existing row; the figure itself is computed server-side from
 * a real payment, so there is no shape a client could send one in.
 *
 * Nothing here accepts a customer's password, OTP or payment credential
 * either. Assisted signup is a request to *start* a signup the customer then
 * completes themselves — see `startAssistedSignupSchema`, which takes a name
 * and a phone number and deliberately cannot carry a secret.
 */

// ---------------------------------------------------------------------------
// GODID
// ---------------------------------------------------------------------------

/**
 * A GODID as typed by a person.
 *
 * Normalised then shape-checked, and the error message says what it is rather
 * than quoting a regular expression at somebody standing in a truck yard.
 * Passing this check means the value is worth sending to GODWeb; it never
 * means the identity exists.
 */
export const godIdSchema = z
  .string()
  .transform((value) => normalizeGodId(value))
  .pipe(
    z
      .string()
      .min(3, 'A GODID is at least 3 characters.')
      .max(GODID_MAX_LENGTH, `A GODID is at most ${GODID_MAX_LENGTH} characters.`)
      .refine(isPlausibleGodId, 'That does not look like a GODID. Letters, digits and hyphens only.'),
  );

/** The referral code carried in a link, a QR or a registration form. */
export const referralCodeSchema = godIdSchema;

// ---------------------------------------------------------------------------
// Salesman profile
// ---------------------------------------------------------------------------

/**
 * Create a Saarthi salesman profile for an existing GODWeb identity.
 *
 * Platform administration only. Name, phone and email are optional because
 * GODWeb is the authority on all three: when the integration answers, its
 * values win and these are only used as a fallback for an environment where it
 * cannot be reached.
 */
export const createSalesmanSchema = z.object({
  godId: godIdSchema,
  /** The Saarthi user account this profile belongs to, if one exists already. */
  userId: uuidSchema.optional(),
  /** An identifier the sales organization uses for this person. */
  externalSalespersonId: optionalTrimmedString(64),
  name: optionalTrimmedString(120),
  phone: optionalPhoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  territory: optionalTrimmedString(120),
  note: optionalTrimmedString(500),
});
export type CreateSalesmanInput = z.infer<typeof createSalesmanSchema>;

export const updateSalesmanSchema = z.object({
  externalSalespersonId: optionalTrimmedString(64),
  name: optionalTrimmedString(120),
  phone: optionalPhoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  territory: optionalTrimmedString(120),
  note: optionalTrimmedString(500),
  /** Link or re-link the profile to a Saarthi login. */
  userId: uuidSchema.nullable().optional(),
});
export type UpdateSalesmanInput = z.infer<typeof updateSalesmanSchema>;

/**
 * Change a salesman's standing.
 *
 * `ACTIVE` is absent on purpose: a profile becomes active by being verified,
 * not by being switched on. Reinstating a suspended salesperson runs the
 * verification path again, which is the only thing that can honestly say the
 * GODID is still good.
 */
export const salesmanStandingSchema = z.object({
  status: z.enum([SalesmanStatus.SUSPENDED, SalesmanStatus.REJECTED]),
  reason: trimmedString(3, 500),
});
export type SalesmanStandingInput = z.infer<typeof salesmanStandingSchema>;

/**
 * Verify a GODID by hand, as a platform administrator.
 *
 * The fallback path for an environment where the approved GODWeb validation
 * API is not available. It requires the administrator to say what they checked
 * and against what, because the resulting profile is trusted for commission
 * and the only thing standing behind it is this sentence.
 */
export const manualVerifySalesmanSchema = z.object({
  evidence: trimmedString(10, 500),
});
export type ManualVerifySalesmanInput = z.infer<typeof manualVerifySalesmanSchema>;

export const salesmanListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    SalesmanStatus.PENDING_VERIFICATION,
    SalesmanStatus.ACTIVE,
    SalesmanStatus.SUSPENDED,
    SalesmanStatus.REJECTED,
  ] as const),
  search: optionalTrimmedString(120),
});
export type SalesmanListQuery = z.infer<typeof salesmanListQuerySchema>;

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/**
 * A prospect, as the salesperson first writes it down.
 *
 * The phone number is the only required contact detail and it is required
 * deliberately: a lead nobody can ring is a note, and the pipeline counts on
 * the dashboard would quietly fill with them. Fleet size and vehicle types are
 * optional because they are frequently a guess at first contact, and a form
 * that demands a number invites an invented one.
 */
export const createLeadSchema = z.object({
  contactName: trimmedString(2, 120),
  businessName: optionalTrimmedString(160),
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  fleetSize: z.coerce.number().int().min(0).max(100_000).optional(),
  vehicleTypes: z.array(z.nativeEnum(VehicleType)).max(12).optional(),
  interestedPlan: z.nativeEnum(PlanTier).optional(),
  source: z.nativeEnum(SalesLeadSource).default(SalesLeadSource.FIELD_VISIT),
  notes: optionalTrimmedString(2000),
  nextFollowUpAt: z.coerce.date().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial().extend({
  // Kept out of the partial so it cannot be cleared by omission — a lead with
  // no contact name is not a lead.
  contactName: trimmedString(2, 120).optional(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/**
 * Move a lead along the pipeline.
 *
 * The system-set statuses are rejected by the service rather than by this
 * schema, so the API can explain *why* — "Saarthi sets this from the
 * subscription" is a useful answer, and "invalid enum value" is not.
 */
export const advanceLeadSchema = z.object({
  status: z.nativeEnum(SalesLeadStatus),
  note: optionalTrimmedString(1000),
  nextFollowUpAt: z.coerce.date().nullable().optional(),
});
export type AdvanceLeadInput = z.infer<typeof advanceLeadSchema>;

export const leadNoteSchema = z.object({
  note: trimmedString(1, 2000),
});
export type LeadNoteInput = z.infer<typeof leadNoteSchema>;

export const leadListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    SalesLeadStatus.NEW,
    SalesLeadStatus.CONTACTED,
    SalesLeadStatus.DEMO_SCHEDULED,
    SalesLeadStatus.DEMO_COMPLETED,
    SalesLeadStatus.INTERESTED,
    SalesLeadStatus.SIGNUP_PENDING,
    SalesLeadStatus.PAYMENT_PENDING,
    SalesLeadStatus.SUBSCRIBED,
    SalesLeadStatus.TRACKER_PENDING,
    SalesLeadStatus.ONBOARDING,
    SalesLeadStatus.ACTIVATED,
    SalesLeadStatus.LOST,
    SalesLeadStatus.CANCELLED,
    SalesLeadStatus.DISQUALIFIED,
  ] as const),
  search: optionalTrimmedString(120),
  /** Leads whose follow-up date has passed, for the "call these today" view. */
  overdueOnly: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : typeof value === 'boolean' ? value : value === 'true' || value === '1',
    ),
  /** Platform administration only; a salesperson always sees their own. */
  salesmanId: uuidSchema.optional(),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

/**
 * Start a signup the customer finishes themselves.
 *
 * This is the whole assisted-signup payload, and the shape is the safeguard:
 * there is nowhere in it to put a password, an OTP, a card number or a UPI PIN.
 * The salesperson names the prospect; Saarthi messages the prospect; the
 * prospect creates their own account and authorises their own payment.
 */
export const startAssistedSignupSchema = z.object({
  leadId: uuidSchema,
  /** Where the invitation is sent. Defaults to the lead's own number. */
  phone: optionalPhoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  planTier: z.nativeEnum(PlanTier).optional(),
});
export type StartAssistedSignupInput = z.infer<typeof startAssistedSignupSchema>;

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/**
 * Resolve a referral code for display on the public landing page.
 *
 * Anonymous, so the response is deliberately thin — see the route. It answers
 * "is this a real Saarthi salesperson, and what may I call them" and nothing
 * else.
 */
export const referralCodeParamSchema = z.object({ code: referralCodeSchema });
export type ReferralCodeParam = z.infer<typeof referralCodeParamSchema>;

/**
 * Record that somebody followed a referral link or scanned a referral QR.
 *
 * `source` is restricted to the self-service values: a physical sale is
 * recorded through the lead the salesperson is working, not by posting to this
 * endpoint, and allowing PHYSICAL here would let an anonymous caller assert a
 * visit that never happened.
 */
export const captureReferralSchema = z.object({
  code: referralCodeSchema,
  source: z
    .enum([ReferralSource.REFERRAL_LINK, ReferralSource.REFERRAL_QR] as const)
    .default(ReferralSource.REFERRAL_LINK),
});
export type CaptureReferralInput = z.infer<typeof captureReferralSchema>;

/** Check a GODID before relying on it. Rate-limited; see the route. */
export const validateReferralSchema = z.object({
  code: referralCodeSchema,
});
export type ValidateReferralInput = z.infer<typeof validateReferralSchema>;

/**
 * Attribute an existing customer to a salesperson after the fact.
 *
 * Platform administration only, and it cannot overwrite a live attribution —
 * the service refuses, because "first valid attribution wins" is worth nothing
 * if an administrator can quietly move a commission between two people.
 */
export const attributeCustomerSchema = z.object({
  organizationId: uuidSchema,
  godId: godIdSchema,
  source: z.enum(SELF_SERVICE_REFERRAL_SOURCES as unknown as [ReferralSource, ...ReferralSource[]]),
  reason: trimmedString(5, 500),
});
export type AttributeCustomerInput = z.infer<typeof attributeCustomerSchema>;

export const revokeAttributionSchema = z.object({
  reason: trimmedString(5, 500),
});
export type RevokeAttributionInput = z.infer<typeof revokeAttributionSchema>;

export const referralListQuerySchema = paginationSchema.extend({
  status: csvEnum(['CAPTURED', 'ATTRIBUTED', 'CONVERTED', 'EXPIRED', 'REVOKED'] as const),
  salesmanId: uuidSchema.optional(),
});
export type ReferralListQuery = z.infer<typeof referralListQuerySchema>;

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------

/**
 * The commercial terms, entered by an administrator.
 *
 * `qualificationDays` is the cooling-off period: a subscription refunded inside
 * it reverses the commission rather than paying it. It has no default here for
 * the same reason the rate has none — it is a commercial decision, and this
 * library is not where such a decision should first appear.
 */
export const commissionRuleSchema = z
  .object({
    name: trimmedString(3, 120),
    /** Null means "any plan". */
    planTier: z.nativeEnum(PlanTier).nullable().optional(),
    trigger: z.nativeEnum(CommissionTrigger).default(CommissionTrigger.SUBSCRIPTION),
    commissionType: z.nativeEnum(CommissionType),
    /** Percentage points. Required for a PERCENTAGE rule. */
    commissionRate: z.coerce.number().min(0).max(100).optional(),
    /** Rupees. Required for a FIXED rule. */
    fixedAmount: moneySchema.optional(),
    qualificationDays: z.coerce.number().int().min(0).max(365),
    /** Applies only to sales from this date onwards. */
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
    active: z.coerce.boolean().default(true),
    note: optionalTrimmedString(500),
  })
  .superRefine((value, ctx) => {
    if (value.commissionType === CommissionType.PERCENTAGE && value.commissionRate === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commissionRate'],
        message: 'A percentage rule needs a rate.',
      });
    }
    if (value.commissionType === CommissionType.FIXED && value.fixedAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixedAmount'],
        message: 'A fixed rule needs an amount.',
      });
    }
    if (value.effectiveFrom && value.effectiveTo && value.effectiveFrom > value.effectiveTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'The end date must be after the start date.',
      });
    }
  });
export type CommissionRuleInput = z.infer<typeof commissionRuleSchema>;

// ---------------------------------------------------------------------------
// Commission decisions
// ---------------------------------------------------------------------------

/**
 * Approve, pay, reverse or reject a commission.
 *
 * Note what is not here: an amount. The decision is on the row as computed,
 * and an administrator who believes the figure is wrong corrects the rule and
 * recalculates, which leaves a trail. Typing a number over the top of a
 * computed one leaves none.
 */
export const commissionDecisionSchema = z.object({
  status: z.enum([
    CommissionStatus.APPROVED,
    CommissionStatus.PAYABLE,
    CommissionStatus.PAID,
    CommissionStatus.REVERSED,
    CommissionStatus.REJECTED,
  ] as const),
  /** Required for anything that denies or takes back money. */
  reason: optionalTrimmedString(500),
  /** The payout reference, for PAID. */
  paymentReference: optionalTrimmedString(120),
});
export type CommissionDecisionInput = z.infer<typeof commissionDecisionSchema>;

export const commissionListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    CommissionStatus.PENDING,
    CommissionStatus.APPROVED,
    CommissionStatus.PAYABLE,
    CommissionStatus.PAID,
    CommissionStatus.REVERSED,
    CommissionStatus.REJECTED,
  ] as const),
  salesmanId: uuidSchema.optional(),
});
export type CommissionListQuery = z.infer<typeof commissionListQuerySchema>;

// ---------------------------------------------------------------------------
// Tracker handover
// ---------------------------------------------------------------------------

/**
 * Allocate a paid-for tracker to a salesperson to carry.
 *
 * Takes the id of an existing `VehicleTracker` — the row the customer's money
 * created — rather than inventing a device record. There is deliberately no
 * endpoint here that creates hardware: Saarthi has one device registry and one
 * tracker purchase table, and this is a custody note against them.
 */
export const assignTrackerToSalesmanSchema = z.object({
  trackerId: uuidSchema,
  salesmanId: uuidSchema,
  /** Serial of the unit actually picked from stock, if known at this point. */
  serialNumber: optionalTrimmedString(64),
  note: optionalTrimmedString(500),
});
export type AssignTrackerToSalesmanInput = z.infer<typeof assignTrackerToSalesmanSchema>;

/**
 * Record a tracker physically changing hands.
 *
 * `acknowledgedBy` is who signed for it at the customer's end. It is required
 * because a handover with nobody's name on it is the one that gets disputed,
 * and the salesperson is standing in front of that person when they record it.
 */
export const handOverTrackerSchema = z.object({
  acknowledgedBy: trimmedString(2, 120),
  serialNumber: optionalTrimmedString(64),
  /** The vehicle it is intended for, when the customer has already said. */
  vehicleId: uuidSchema.optional(),
  note: optionalTrimmedString(500),
});
export type HandOverTrackerInput = z.infer<typeof handOverTrackerSchema>;

export const handoverStatusSchema = z.object({
  status: z.enum([
    TrackerHandoverStatus.RETURNED,
    TrackerHandoverStatus.LOST,
  ] as const),
  reason: trimmedString(3, 500),
});
export type HandoverStatusInput = z.infer<typeof handoverStatusSchema>;

export const handoverListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    TrackerHandoverStatus.ASSIGNED_TO_SALESMAN,
    TrackerHandoverStatus.HANDED_TO_CUSTOMER,
    TrackerHandoverStatus.INSTALLED,
    TrackerHandoverStatus.RETURNED,
    TrackerHandoverStatus.LOST,
  ] as const),
  salesmanId: uuidSchema.optional(),
});
export type HandoverListQuery = z.infer<typeof handoverListQuerySchema>;

// ---------------------------------------------------------------------------
// First-vehicle demonstration
// ---------------------------------------------------------------------------

/**
 * Complete the first-vehicle demonstration for a lead's customer.
 *
 * Carries no evidence of its own, and that is the point: the API re-reads the
 * device, assignment and telemetry state before accepting it, so a client
 * cannot post its way to a completed onboarding. The vehicle id is all it
 * needs to know what to go and check.
 */
export const completeOnboardingSchema = z.object({
  leadId: uuidSchema,
  vehicleId: uuidSchema,
  note: optionalTrimmedString(500),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;

export const onboardingReadinessQuerySchema = z.object({
  vehicleId: uuidSchema,
});
export type OnboardingReadinessQuery = z.infer<typeof onboardingReadinessQuerySchema>;
