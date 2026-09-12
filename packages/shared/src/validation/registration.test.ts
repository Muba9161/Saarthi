import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '../domain/languages';
import { OrganizationType, PlanTier, RoleName } from '../domain/enums';
import {
  FREE_PLAN_ROLE,
  PERSONAL_PLAN_ROLE,
  isIndividualSeatRegistration,
  planAsksAccountType,
  registerSchema,
  registrationOrganizationType,
  registrationRole,
  registrationRunsVehicles,
} from './auth';

/**
 * Registration, as the rules rather than as the form.
 *
 * `registerSchema` is the boundary: the wizard is a convenience on top of it,
 * and anything the schema accepts can arrive over HTTP whether or not a screen
 * would have offered it. So the workflow rules that matter — which plans ask
 * what, and who may be sold a vehicle or a tracker — are asserted here against
 * the schema itself, not against the React form.
 */

/** A complete, valid registration, which each test then varies one field of. */
function registration(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Ravi',
    lastName: 'Kumar',
    email: `ravi.${Math.random().toString(36).slice(2, 10)}@example.com`,
    phone: '9876543210',
    password: 'Monsoon2026road',
    preferredLanguage: DEFAULT_LOCALE,
    acceptedTerms: true as const,
    ...overrides,
  };
}

/** The paths of every issue a failed parse produced. */
function issuePaths(result: ReturnType<typeof registerSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('registration plans', () => {
  it('resolves the role each plan registers as', () => {
    // Personal and Free never pick an account type, so theirs is implied.
    expect(registrationRole({ planTier: PlanTier.PERSONAL })).toBe(PERSONAL_PLAN_ROLE);
    expect(registrationRole({ planTier: PlanTier.FREE })).toBe(FREE_PLAN_ROLE);
    // Business picks, and what it picked wins.
    expect(registrationRole({ planTier: PlanTier.BUSINESS, role: RoleName.SUPPLIER })).toBe(
      RoleName.SUPPLIER,
    );
  });

  it('asks only Business what kind of business it is', () => {
    expect(planAsksAccountType(PlanTier.BUSINESS)).toBe(true);
    expect(planAsksAccountType(PlanTier.PERSONAL)).toBe(false);
    expect(planAsksAccountType(PlanTier.FREE)).toBe(false);
  });

  it('resolves the organization each registration creates', () => {
    expect(registrationOrganizationType({ planTier: PlanTier.FREE })).toBe(
      OrganizationType.CUSTOMER,
    );
    expect(registrationOrganizationType({ planTier: PlanTier.PERSONAL })).toBe(
      OrganizationType.FLEET_OWNER,
    );
    expect(
      registrationOrganizationType({ planTier: PlanTier.BUSINESS, role: RoleName.SUPPLIER }),
    ).toBe(OrganizationType.SUPPLIER);

    // Business before the account type is chosen has no answer yet, and must
    // not be guessed at — guessing FLEET_OWNER is what priced suppliers for
    // trucks.
    expect(registrationOrganizationType({ planTier: PlanTier.BUSINESS })).toBeNull();
  });

  it('marks Personal and an individual Free account as one person’s seat', () => {
    expect(isIndividualSeatRegistration({ planTier: PlanTier.PERSONAL })).toBe(true);
    expect(isIndividualSeatRegistration({ planTier: PlanTier.FREE })).toBe(true);

    // A purchasing office that named its company is a business, and files a
    // business's documents.
    expect(
      isIndividualSeatRegistration({
        planTier: PlanTier.FREE,
        organizationName: 'Kumar Constructions',
      }),
    ).toBe(false);
    expect(isIndividualSeatRegistration({ planTier: PlanTier.BUSINESS })).toBe(false);
  });

  it('creates a Free account without asking it anything about vehicles', () => {
    const result = registerSchema.safeParse(registration({ planTier: PlanTier.FREE }));

    expect(result.success).toBe(true);
    if (result.success) {
      // No account type was demanded, and the role was implied.
      expect(registrationRole(result.data)).toBe(RoleName.CUSTOMER);
      expect(registrationRunsVehicles(result.data)).toBe(false);
      // The defaults are what "nothing ordered" looks like on the wire.
      expect(result.data.planVehicles).toBe(1);
      expect(result.data.planTrackers).toBe(0);
    }
  });

  it('refuses to sell vehicles or trackers to a Free account', () => {
    // Bug 1 and bug 2, at the boundary rather than in the form: a hand-built
    // request must not be able to buy what the plan cannot hold.
    const vehicles = registerSchema.safeParse(
      registration({ planTier: PlanTier.FREE, planVehicles: 9 }),
    );
    expect(vehicles.success).toBe(false);
    expect(issuePaths(vehicles)).toContain('planVehicles');

    const trackers = registerSchema.safeParse(
      registration({ planTier: PlanTier.FREE, planTrackers: 3, planVehicles: 3 }),
    );
    expect(trackers.success).toBe(false);
    expect(issuePaths(trackers)).toContain('planTrackers');
  });

  it('refuses to sell a supplier a tracker', () => {
    // Bug 2. A supplier is a paid Business account that owns no vehicle, so
    // the plan cannot be what decides this.
    const result = registerSchema.safeParse(
      registration({
        planTier: PlanTier.BUSINESS,
        role: RoleName.SUPPLIER,
        organizationName: 'Kumar Building Materials',
        planVehicles: 4,
        planTrackers: 4,
      }),
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('planTrackers');
    expect(issuePaths(result)).toContain('planVehicles');
  });

  it('sells vehicles and trackers to the business types that run them', () => {
    for (const role of [RoleName.FLEET_OWNER, RoleName.MOBILITY_PROVIDER]) {
      const result = registerSchema.safeParse(
        registration({
          planTier: PlanTier.BUSINESS,
          role,
          organizationName: 'Sharma Transport Company',
          planVehicles: 9,
          planTrackers: 3,
        }),
      );
      expect(result.success).toBe(true);
      if (result.success) expect(registrationRunsVehicles(result.data)).toBe(true);
    }
  });

  it('still makes a Business registration say what kind of business it is', () => {
    const result = registerSchema.safeParse(registration({ planTier: PlanTier.BUSINESS }));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('role');
  });

  it('lets a Personal owner also be a driver, and nobody else', () => {
    // Bug 9. Three cars, two driven by the people he employs and one by him.
    const owner = registerSchema.safeParse(
      registration({
        planTier: PlanTier.PERSONAL,
        driveMyself: true,
        licenseNumber: 'DL-1420-20100000000',
      }),
    );
    expect(owner.success).toBe(true);

    // On a Business account the owner adds themselves from the drivers screen,
    // where the rest of a driver's record is captured too.
    const business = registerSchema.safeParse(
      registration({
        planTier: PlanTier.BUSINESS,
        role: RoleName.FLEET_OWNER,
        organizationName: 'Sharma Transport Company',
        driveMyself: true,
        licenseNumber: 'DL-1420-20100000000',
      }),
    );
    expect(business.success).toBe(false);
    expect(issuePaths(business)).toContain('driveMyself');
  });

  it('never asks a driver to buy a plan', () => {
    // Bug 8. A driver with an invite code is covered by their employer's
    // subscription, and one without sits in a seat of their own until they are.
    const result = registerSchema.safeParse(
      registration({ role: RoleName.DRIVER, licenseNumber: 'DL-1420-20100000000' }),
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.planTier).toBeUndefined();
  });
});
