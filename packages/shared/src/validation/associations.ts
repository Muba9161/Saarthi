import { z } from 'zod';
import {
  AlertSeverity,
  AssociationAlertStatus,
  AssociationResponderKind,
  AssociationResponderStatus,
  SosType,
  VerificationStatus,
} from '../domain/enums';
import { DEFAULT_COVERAGE_RADIUS_KM, MAX_COVERAGE_RADIUS_KM } from '../domain/associations';
import {
  csvEnum,
  emailSchema,
  latitudeSchema,
  longitudeSchema,
  optionalPhoneSchema,
  optionalTrimmedString,
  paginationSchema,
  phoneSchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Truck-association contracts.
 *
 * Registration creates an organization *and* an association profile in one
 * request, because an association that exists without coverage areas cannot
 * receive anything and would look broken to the person who just signed up.
 */

export const coverageAreaSchema = z.object({
  district: trimmedString(2, 120),
  state: trimmedString(2, 120),
  /** Centre of the covered area. Matching is by distance from this point. */
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  radiusKm: z.coerce
    .number()
    .min(5, 'A coverage radius under 5 km would miss most highway incidents.')
    .max(
      MAX_COVERAGE_RADIUS_KM,
      `A coverage radius over ${MAX_COVERAGE_RADIUS_KM} km is wider than a district.`,
    )
    .default(DEFAULT_COVERAGE_RADIUS_KM),
  label: optionalTrimmedString(160),
});
export type CoverageAreaInput = z.infer<typeof coverageAreaSchema>;

export const registerAssociationSchema = z.object({
  name: trimmedString(3, 200),
  registrationNumber: optionalTrimmedString(80),
  district: trimmedString(2, 120),
  state: trimmedString(2, 120),
  addressLine: trimmedString(3, 300),
  city: optionalTrimmedString(120),
  postalCode: optionalTrimmedString(20),
  /** Office coordinates — also the default coverage centre. */
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  officialEmail: emailSchema,
  officialPhone: phoneSchema,
  /** The named person Saarthi and fleets deal with. */
  representativeName: trimmedString(3, 160),
  representativeDesignation: optionalTrimmedString(120),
  representativePhone: phoneSchema,
  representativeEmail: optionalTrimmedString(254),
  /** Manned line for out-of-hours emergencies. */
  emergencyPhone: phoneSchema,
  memberTruckCount: z.coerce.number().int().min(0).max(1_000_000).optional(),
  about: optionalTrimmedString(2000),
  logoUrl: optionalTrimmedString(500),
  coverageAreas: z
    .array(coverageAreaSchema)
    .min(1, 'Add at least one district your association covers.')
    .max(25, 'An association may cover at most 25 areas.'),
});
export type RegisterAssociationInput = z.infer<typeof registerAssociationSchema>;

export const updateAssociationSchema = registerAssociationSchema
  .omit({ coverageAreas: true })
  .partial()
  .extend({
    /** Pause alerts without suspending the account, e.g. an office shutdown. */
    acceptingAlerts: z.boolean().optional(),
  });
export type UpdateAssociationInput = z.infer<typeof updateAssociationSchema>;

export const associationListQuerySchema = paginationSchema.extend({
  search: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  district: optionalTrimmedString(120),
  verificationStatus: csvEnum([
    VerificationStatus.PENDING,
    VerificationStatus.SUBMITTED,
    VerificationStatus.UNDER_REVIEW,
    VerificationStatus.VERIFIED,
    VerificationStatus.REJECTED,
    VerificationStatus.SUSPENDED,
  ]),
});
export type AssociationListQuery = z.infer<typeof associationListQuerySchema>;

// ---------------------------------------------------------------------------
// The alert queue
// ---------------------------------------------------------------------------

export const associationAlertListQuerySchema = paginationSchema.extend({
  status: csvEnum([
    AssociationAlertStatus.NOTIFIED,
    AssociationAlertStatus.ACKNOWLEDGED,
    AssociationAlertStatus.RESPONDING,
    AssociationAlertStatus.ESCALATED,
    AssociationAlertStatus.RESOLVED,
    AssociationAlertStatus.CLOSED,
  ]),
  severity: csvEnum([AlertSeverity.INFO, AlertSeverity.WARNING, AlertSeverity.CRITICAL]),
  incidentType: csvEnum([
    SosType.MEDICAL,
    SosType.ACCIDENT,
    SosType.BREAKDOWN,
    SosType.TYRE,
    SosType.FUEL,
    SosType.SECURITY,
    SosType.OTHER,
  ]),
  /** Only alerts still needing attention. */
  openOnly: z.coerce.boolean().optional(),
  district: optionalTrimmedString(120),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AssociationAlertListQuery = z.infer<typeof associationAlertListQuerySchema>;

export const acknowledgeAlertSchema = z.object({
  note: optionalTrimmedString(1000),
});
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertSchema>;

export const assignResponderSchema = z
  .object({
    kind: z.nativeEnum(AssociationResponderKind),
    /** Required when the responder is an association member. */
    userId: uuidSchema.optional(),
    /** Required for an outside service — a crane operator, a workshop. */
    name: optionalTrimmedString(160),
    phone: optionalPhoneSchema,
    organisation: optionalTrimmedString(160),
    note: optionalTrimmedString(1000),
    etaMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === AssociationResponderKind.MEMBER && !value.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'Choose which association member is responding.',
      });
    }
    if (value.kind === AssociationResponderKind.EXTERNAL) {
      if (!value.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'Name the external responder so the driver knows who to expect.',
        });
      }
      if (!value.phone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone'],
          message: 'An external responder needs a contact number.',
        });
      }
    }
  });
export type AssignResponderInput = z.infer<typeof assignResponderSchema>;

export const updateResponderSchema = z.object({
  status: z.nativeEnum(AssociationResponderStatus),
  note: optionalTrimmedString(1000),
});
export type UpdateResponderInput = z.infer<typeof updateResponderSchema>;

export const alertNoteSchema = z.object({
  note: trimmedString(2, 2000),
});
export type AlertNoteInput = z.infer<typeof alertNoteSchema>;

export const escalateAlertSchema = z.object({
  reason: trimmedString(3, 1000),
});
export type EscalateAlertInput = z.infer<typeof escalateAlertSchema>;

export const resolveAlertSchema = z.object({
  /** What was actually done — this is the association's audit record. */
  outcome: trimmedString(3, 2000),
  assistanceProvided: z.boolean().default(true),
});
export type ResolveAlertInput = z.infer<typeof resolveAlertSchema>;
