import { z } from 'zod';
import { OrganizationType, RoleName } from '../domain/enums';
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
 * created alongside the user. Drivers join an existing fleet by invite code
 * rather than creating an organization of their own.
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
 * Drivers are absent for a different reason: they join an existing fleet by
 * invite code and create no organization at all.
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

export const registerSchema = z
  .object({
    firstName: trimmedString(2, 60),
    lastName: trimmedString(1, 60),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    role: registrableRoleSchema,
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
    /** Drivers join an existing fleet using the owner's invite code. */
    fleetInviteCode: optionalTrimmedString(32),
    /** Required for DRIVER — the commercial driving licence number. */
    licenseNumber: optionalTrimmedString(40),
    licenseExpiryDate: z.coerce.date().optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to create an account.' }),
    }),
  })
  .superRefine((value, ctx) => {
    if (ORGANIZATION_NAME_REQUIRED_ROLES.includes(value.role) && !value.organizationName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['organizationName'],
        message: 'A business or organization name is required for this account type.',
      });
    }
    if (value.role === RoleName.DRIVER) {
      if (!value.fleetInviteCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fleetInviteCode'],
          message: 'Enter the fleet invite code provided by your truck owner.',
        });
      }
      if (!value.licenseNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['licenseNumber'],
          message: 'Your driving licence number is required.',
        });
      }
    }
  });
export type RegisterInput = z.infer<typeof registerSchema>;

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
