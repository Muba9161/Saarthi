import { describe, expect, it } from 'vitest';
import {
  PLAN_ACCOUNT_TYPES,
  PLAN_TIERS,
  PLAN_TIER_ORDER,
  PlanTier,
  RoleName,
  registerSchema,
} from '@saarthi/shared';
import {
  REGISTRATION_PLANS,
  accountTypeChoiceFor,
  chosenPlan,
  planFromQuery,
  planIncludesVehicles,
  valuesForAccountType,
  valuesForPlan,
  type RegistrationChoice,
} from './plan-options';

/**
 * The plan and type questions write the two fields the registration schema
 * cares most about. These tests hold every answer the screens can give to what
 * the schema — and so the API — will accept.
 */

describe('planFromQuery', () => {
  it('reads the plan the pricing page sends, in any case', () => {
    expect(planFromQuery('personal')).toBe(PlanTier.PERSONAL);
    expect(planFromQuery('SUPPLIER')).toBe(PlanTier.SUPPLIER);
    expect(planFromQuery(' business ')).toBe(PlanTier.BUSINESS);
    expect(planFromQuery('free')).toBe(PlanTier.FREE);
  });

  it('ignores a missing, empty or unknown plan', () => {
    expect(planFromQuery(null)).toBeNull();
    expect(planFromQuery(undefined)).toBeNull();
    expect(planFromQuery('')).toBeNull();
    expect(planFromQuery('gold')).toBeNull();
  });
});

describe('plan list', () => {
  it('offers every plan, in the pricing page order', () => {
    expect(REGISTRATION_PLANS.map((option) => option.tier)).toEqual(PLAN_TIER_ORDER);
    expect(new Set(REGISTRATION_PLANS.map((option) => option.tier))).toEqual(new Set(PLAN_TIERS));
  });

  it('knows which plans include a vehicle', () => {
    expect(planIncludesVehicles(PlanTier.PERSONAL)).toBe(true);
    expect(planIncludesVehicles(PlanTier.BUSINESS)).toBe(true);
    expect(planIncludesVehicles(PlanTier.FREE)).toBe(false);
    expect(planIncludesVehicles(PlanTier.SUPPLIER)).toBe(false);
  });
});

describe('account type question', () => {
  it('is asked only for Free and Business', () => {
    expect(accountTypeChoiceFor(PlanTier.FREE)).not.toBeNull();
    expect(accountTypeChoiceFor(PlanTier.BUSINESS)).not.toBeNull();
    expect(accountTypeChoiceFor(PlanTier.PERSONAL)).toBeNull();
    expect(accountTypeChoiceFor(PlanTier.SUPPLIER)).toBeNull();
    expect(accountTypeChoiceFor(null)).toBeNull();
  });

  it('puts the customer and the driver under Free', () => {
    const roles = accountTypeChoiceFor(PlanTier.FREE)?.options.map((option) => option.role);
    expect(roles).toEqual([RoleName.CUSTOMER, RoleName.DRIVER]);
  });

  it('offers exactly the account types the Business plan is sold to', () => {
    const roles = accountTypeChoiceFor(PlanTier.BUSINESS)?.options.map((option) => option.role);
    expect(roles).toEqual([...PLAN_ACCOUNT_TYPES[PlanTier.BUSINESS]]);
  });
});

describe('form values', () => {
  it('sets the implied role for a plan without a second question', () => {
    expect(valuesForPlan(PlanTier.PERSONAL)).toEqual({
      planTier: PlanTier.PERSONAL,
      role: RoleName.FLEET_OWNER,
    });
    expect(valuesForPlan(PlanTier.SUPPLIER)).toEqual({
      planTier: PlanTier.SUPPLIER,
      role: RoleName.SUPPLIER,
    });
  });

  it('leaves the role open for a plan that asks it', () => {
    expect(valuesForPlan(PlanTier.FREE).role).toBeUndefined();
    expect(valuesForPlan(PlanTier.BUSINESS).role).toBeUndefined();
  });

  it('registers a driver without a plan, yet shows them under Free', () => {
    const driver = valuesForAccountType(PlanTier.FREE, RoleName.DRIVER);
    expect(driver).toEqual({ planTier: undefined, role: RoleName.DRIVER });
    expect(chosenPlan(driver)).toBe(PlanTier.FREE);
  });

  it('keeps the plan for every other account type', () => {
    expect(valuesForAccountType(PlanTier.FREE, RoleName.CUSTOMER)).toEqual({
      planTier: PlanTier.FREE,
      role: RoleName.CUSTOMER,
    });
    expect(chosenPlan({ planTier: PlanTier.BUSINESS, role: undefined })).toBe(PlanTier.BUSINESS);
    expect(chosenPlan({ planTier: undefined, role: undefined })).toBeNull();
  });
});

describe('every answer the screens can give', () => {
  const base = {
    firstName: 'Asha',
    lastName: 'Verma',
    email: 'asha@example.com',
    emailCode: '123456',
    phone: '9876543210',
    password: 'Saarthi#2026route',
    organizationName: 'Verma Logistics',
    acceptedTerms: true,
  };

  const answers: RegistrationChoice[] = REGISTRATION_PLANS.flatMap(({ tier }) => {
    const choice = accountTypeChoiceFor(tier);
    return choice
      ? choice.options.map((option) => valuesForAccountType(tier, option.role))
      : [valuesForPlan(tier)];
  });

  it.each(answers)('is accepted for plan $planTier as $role', (answer) => {
    const result = registerSchema.safeParse({ ...base, ...answer });
    const planIssues = result.success
      ? []
      : result.error.issues.filter((issue) => ['planTier', 'role'].includes(String(issue.path[0])));
    expect(planIssues).toEqual([]);
  });

  it('still requires Business to say what kind of business it is', () => {
    const result = registerSchema.safeParse({ ...base, ...valuesForPlan(PlanTier.BUSINESS) });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === 'role')).toBe(true);
  });
});
