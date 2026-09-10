import { z } from 'zod';
import { OrganizationType, PlanTier, RoleName } from '../domain/enums';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '../domain/languages';
import {
  emailSchema,
  optionalTrimmedString,
  passwordSchema,
  phoneSchema,
  trimmedString,
} from './common';

/**
 * Registration is role-driven: the account type decides which organization is
 * created alongside the user. A driver may name their employer's fleet with an
 * invite code, but is not required to: somebody downloading Saarthi before an
 * owner has a code for them still gets an account, and joins a fleet later
 * from their own home screen (`joinFleetSchema`).
 */
export const registrableRoleSchema = z.enum([
  RoleName.FLEET_OWNER,
  RoleName.SUPPLIER,
  RoleName.CUSTOMER,
  RoleName.DRIVER,
  RoleName.MOBILITY_PROVIDER,
  RoleName.ASSOCIATION_ADMIN,
]);
export type RegistrableRole = z.infer<typeof registrableRoleSchema>;

/**
 * Account types that must name a business.
 *
 * A customer need not be one. Somebody booking a cab, or ordering a load of
 * sand for a house they are building, is an individual — demanding a company
 * name turns the field into something they invent an answer for, and every
 * order then carries that invention. They still get an organization, because
 * memberships, orders and bookings all hang off one; it is simply named after
 * them (see `registerUser`).
 *
 * Drivers are absent for a different reason: they are asked for a licence
 * rather than a business. A driver who names a fleet by invite code joins that
 * organization; one who does not is seated in a single-member organization
 * carrying their own name, exactly as an individual customer is.
 */
export const ORGANIZATION_NAME_REQUIRED_ROLES: readonly RegistrableRole[] = [
  RoleName.FLEET_OWNER,
  RoleName.SUPPLIER,
  RoleName.MOBILITY_PROVIDER,
  RoleName.ASSOCIATION_ADMIN,
];

export const ROLE_TO_ORGANIZATION_TYPE: Record<RegistrableRole, OrganizationType | null> = {
  [RoleName.FLEET_OWNER]: OrganizationType.FLEET_OWNER,
  [RoleName.SUPPLIER]: OrganizationType.SUPPLIER,
  [RoleName.CUSTOMER]: OrganizationType.CUSTOMER,
  [RoleName.DRIVER]: null,
  [RoleName.MOBILITY_PROVIDER]: OrganizationType.MOBILITY_PROVIDER,
  [RoleName.ASSOCIATION_ADMIN]: OrganizationType.TRUCK_ASSOCIATION,
};

/**
 * Organization types a driver may join with an invite code.
 *
 * A driver signs on to a business that runs vehicles and employs people to
 * drive them. That is as true of a taxi or tour operator as it is of a freight
 * fleet — the same licence, the same documents, the same terminal approval at
 * the start of a shift — so a mobility provider's invite code is accepted
 * here. Before this list existed the check named FLEET_OWNER and ENTERPRISE
 * directly, and a travel operator's own drivers were told their employer's
 * code 'does not belong to a fleet'.
 */
export const DRIVER_JOINABLE_ORGANIZATION_TYPES: readonly OrganizationType[] = [
  OrganizationType.FLEET_OWNER,
  OrganizationType.ENTERPRISE,
  OrganizationType.MOBILITY_PROVIDER,
];

/**
 * The role a Personal subscription registers as.
 *
 * A Personal customer is never asked what kind of business they are, because
 * they are not one — they own vehicles. They still need a role and an
 * organization, since every membership, vehicle, document and driver row hangs
 * off one, so they are seated as the owner of an organization carrying their
 * own name. It is a household, not a company.
 */
export const PERSONAL_PLAN_ROLE = RoleName.FLEET_OWNER;

/** Whether this plan asks the registrant what kind of business they are. */
export function planAsksAccountType(tier: PlanTier | undefined): boolean {
  return tier === PlanTier.BUSINESS;
}

export const registerSchema = z
  .object({
    firstName: trimmedString(2, 60),
    lastName: trimmedString(1, 60),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    /**
     * The account type.
     *
     * Optional because a Personal registration is never asked it — see
     * `registrationRole`, which resolves the effective role and is what the API
     * uses. Still required for a Business registration, where it decides which
     * organization is created and cannot be guessed.
     */
    role: registrableRoleSchema.optional(),
    /**
     * The subscription being taken out.
     *
     * Absent for a driver, who does not buy one: a driver with an invite code
     * joins their employer's subscription, and one without sits in a seat of
     * their own until they do.
     */
    planTier: z.nativeEnum(PlanTier).optional(),
    /** Monthly unless the registrant took the yearly discount. */
    planBilling: z.enum(['monthly', 'yearly']).default('monthly'),
    /**
     * Vehicles the registrant said they run, from the pricing card.
     *
     * The plan covers one, so anything above that is provisioned as `+1`
     * top-ups. Carried through registration rather than left for the settings
     * screen because the price on the card was for this many vehicles — a
     * customer who priced nine and got capacity for one has been sold
     * something else.
     */
    planVehicles: z.coerce.number().int().min(1).max(500).default(1),
    /**
     * Trackers ordered at signup.
     *
     * Capped at the vehicle count, since a tracker is fitted to a vehicle. They
     * arrive unassigned — there are no vehicles on the account yet — and are
     * fitted from the subscription screen once the fleet is added.
     */
    planTrackers: z.coerce.number().int().min(0).max(500).default(0),
    /**
     * The registrant drives one of their own vehicles.
     *
     * The case this exists for: somebody buys Personal for three cars, two of
     * which his drivers use and one he drives himself. Without this he would
     * have to invent a second account for himself to be assignable to a
     * vehicle — which then owns his trips, his duty hours and his score under a
     * different identity. So the toggle creates a driver profile against his
     * own user, inside his own organization, and he becomes assignable exactly
     * like anybody he employs.
     */
    driveMyself: z.coerce.boolean().default(false),
    /**
     * The language Saarthi speaks to this person in, stored on their profile
     * as `preferences.locale`. Asked first at registration rather than left to
     * a settings screen, because somebody who cannot read the form is not
     * going to find the setting that fixes it.
     */
    preferredLanguage: z
      .enum(SUPPORTED_LOCALES as [string, ...string[]])
      .default(DEFAULT_LOCALE),
    /** Required for the roles in `ORGANIZATION_NAME_REQUIRED_ROLES`. */
    organizationName: optionalTrimmedString(160),
    /** Optional business registration number for the new organization. */
    registrationNumber: optionalTrimmedString(60),
    /**
     * The employer's invite code, for a driver who already has one.
     *
     * Optional on purpose. Requiring it made registration impossible for the
     * driver who finds Saarthi first and the owner second — the commonest way
     * a driver arrives — and there was nothing useful to tell them but "go and
     * ask". Left blank, the account is created unattached and the same code is
     * accepted later from the driver's home screen; see `joinFleetSchema`.
     */
    fleetInviteCode: optionalTrimmedString(32),
    /** Required for DRIVER — the commercial driving licence number. */
    licenseNumber: optionalTrimmedString(40),
    licenseExpiryDate: z.coerce.date().optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to create an account.' }),
    }),
  })
  .superRefine((value, ctx) => {
    const personal = value.planTier === PlanTier.PERSONAL;
    const role = registrationRole(value);

    // A Business registration must say what kind of business it is: the choice
    // decides which organization is created, and several surfaces belong to
    // exactly one kind. A Personal registration is never asked.
    if (!personal && !value.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['role'],
        message: 'Choose the kind of account you need.',
      });
    }

    /*
     * A Personal registrant is not asked for a business name — they were never
     * asked to be a business. Their organization is named after them, exactly
     * as an individual customer's is.
     */
    if (!personal && role && ORGANIZATION_NAME_REQUIRED_ROLES.includes(role) && !value.organizationName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationName'],
        message: 'A business or organization name is required for this account type.',
      });
    }

    // Every account that takes out a subscription must say which one. A driver
    // does not, so the field stays absent for them.
    if (role !== RoleName.DRIVER && !value.planTier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planTier'],
        message: 'Choose a subscription to continue.',
      });
    }

    // A tracker is fitted to a vehicle, so ordering more than the fleet size
    // would charge for hardware with nothing to fit it to.
    if (value.planTrackers > value.planVehicles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planTrackers'],
        message: 'You cannot order more trackers than vehicles — one tracker covers one vehicle.',
      });
    }

    // Only a Personal account holder drives their own vehicle. On a Business
    // account the owner adds themselves from the drivers screen, where the rest
    // of a driver's record is captured too.
    if (value.driveMyself && !personal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['driveMyself'],
        message: 'Add yourself as a driver from the drivers screen on a Business account.',
      });
    }

    if (role === RoleName.DRIVER) {
      // No check on `fleetInviteCode`: it is optional, and a code that is
      // given but wrong is rejected by the API, which is the only side that
      // can tell a real fleet from a typo.
      if (!value.licenseNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['licenseNumber'],
          message: 'Your driving licence number is required.',
        });
      }
    } else if (value.driveMyself && !value.licenseNumber) {
      // A driver profile without a licence number cannot exist, and would fail
      // its first document check even if it could.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['licenseNumber'],
        message: 'Your driving licence number is required to add yourself as a driver.',
      });
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * The role a registration actually creates.
 *
 * A Personal registrant never picks an account type, so their role is implied:
 * they own vehicles, which is what `PERSONAL_PLAN_ROLE` means. Resolved through
 * one exported function rather than defaulted inside the schema, so the rule is
 * a named thing the API, the form and the tests all read the same way — and so
 * `registerSchema.shape` stays introspectable, which the registration guide's
 * own test depends on.
 */
export function registrationRole(input: {
  role?: RegistrableRole | undefined;
  planTier?: PlanTier | undefined;
}): RegistrableRole {
  if (input.role) return input.role;
  if (input.planTier === PlanTier.PERSONAL) return PERSONAL_PLAN_ROLE;
  // Unreachable through the schema, which requires a role for every other
  // plan. Business is the safe fallback for a caller that bypassed validation:
  // it creates a commercial organization, which is the conservative answer.
  return RoleName.FLEET_OWNER;
}

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
  rememberMe: z.boolean().optional().default(true),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20, 'This password reset link is not valid.'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'The new password must be different from the current password.',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: trimmedString(2, 60).optional(),
  lastName: trimmedString(1, 60).optional(),
  phone: phoneSchema.optional(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});
export type SwitchOrganizationInput = z.infer<typeof switchOrganizationSchema>;
