import {
  Briefcase,
  Bus,
  Car,
  Compass,
  HandshakeIcon,
  IdCard,
  MapPin,
  Package,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import {
  PLAN_ACCOUNT_TYPES,
  PLAN_CATALOGUE,
  PLAN_TIERS,
  PLAN_TIER_ORDER,
  PlanTier,
  RoleName,
  type RegistrableRole,
} from '@saarthi/shared';

/**
 * The two questions at the start of registration: which plan, then which kind
 * of account inside it.
 *
 * They used to be one list of five answers that mixed the two — four plans and
 * a driver, each with its own paragraph — and people had to read all of it to
 * find themselves. Asking the plan first, in the same words as the pricing
 * page, and the type second, only where a plan has more than one, keeps each
 * screen down to a single decision.
 *
 * Only Free and Business have a second question. Personal is one person's own
 * vehicle and Seller is one kind of business, so choosing either already says
 * which account to create.
 */

export interface PlanOption {
  tier: PlanTier;
  icon: LucideIcon;
  /** Who the plan is for, short enough to read at a glance. */
  audience: string;
}

const PLAN_ICON: Record<PlanTier, LucideIcon> = {
  [PlanTier.FREE]: Compass,
  [PlanTier.PERSONAL]: Car,
  [PlanTier.SUPPLIER]: Package,
  [PlanTier.BUSINESS]: Briefcase,
};

const PLAN_AUDIENCE: Record<PlanTier, string> = {
  [PlanTier.FREE]: 'Order and track, or drive for a fleet',
  [PlanTier.PERSONAL]: 'Your own vehicle - not trucks',
  [PlanTier.SUPPLIER]: 'You sell goods - no vehicle needed',
  [PlanTier.BUSINESS]: 'Trucks, travel or an association',
};

/** In the pricing page's order, cheapest first, so the two read alike. */
export const REGISTRATION_PLANS: readonly PlanOption[] = PLAN_TIER_ORDER.map((tier) => ({
  tier,
  icon: PLAN_ICON[tier],
  audience: PLAN_AUDIENCE[tier],
}));

export interface AccountTypeOption {
  role: RegistrableRole;
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface AccountTypeChoice {
  question: string;
  /** Said under the question only where the answer has consequences. */
  hint?: string;
  /** The step's line on the progress rail. */
  summary: string;
  options: readonly AccountTypeOption[];
}

/**
 * The second question, for the plans that ask one.
 *
 * Free holds the driver as well as the customer: neither pays, and a driver's
 * employer already covers them. A driver still registers without a plan of
 * their own — see `valuesForAccountType`.
 */
const ACCOUNT_TYPE_CHOICES: Partial<Record<PlanTier, AccountTypeChoice>> = {
  [PlanTier.FREE]: {
    question: 'How will you use Saarthi?',
    summary: 'How you will use it.',
    options: [
      {
        role: RoleName.CUSTOMER,
        icon: MapPin,
        title: 'I am not running a vehicle',
        description: 'Find what is nearby, order it and track it to your door.',
      },
      {
        role: RoleName.DRIVER,
        icon: IdCard,
        title: 'I drive for a fleet',
        description: 'Your employer covers you. Nothing to pay.',
      },
    ],
  },
  [PlanTier.BUSINESS]: {
    question: 'What kind of business do you run?',
    // The organization type is enforced by the API, so a wrong answer here
    // cannot be corrected from the UI afterwards.
    hint: 'This decides what Saarthi sets up for you. It cannot be changed later from here.',
    summary: 'Your kind of business.',
    options: [
      {
        role: RoleName.FLEET_OWNER,
        icon: Truck,
        title: 'Fleet owner',
        description: 'You run trucks, win loads and manage drivers.',
      },
      {
        role: RoleName.MOBILITY_PROVIDER,
        icon: Bus,
        title: 'Travel & tour operator',
        description: 'You run taxis, buses or tour packages.',
      },
      {
        role: RoleName.ASSOCIATION_ADMIN,
        icon: HandshakeIcon,
        title: 'Truck association',
        description: 'You coordinate roadside help for a district.',
      },
    ],
  },
};

/** The second question for this plan, or `null` when the plan answers it. */
export function accountTypeChoiceFor(tier: PlanTier | null): AccountTypeChoice | null {
  return (tier && ACCOUNT_TYPE_CHOICES[tier]) || null;
}

/** The plan the pricing page sent, from `?plan=`, or `null` for none or an unknown one. */
export function planFromQuery(raw: string | null | undefined): PlanTier | null {
  const requested = raw?.trim().toUpperCase();
  return PLAN_TIERS.find((tier) => tier === requested) ?? null;
}

/** The two registration fields these questions write. */
export interface RegistrationChoice {
  planTier: PlanTier | undefined;
  role: RegistrableRole | undefined;
}

/**
 * What choosing a plan writes into the form.
 *
 * A plan with a second question leaves the role unset for it: pre-filling one
 * would quietly answer a question nobody was asked.
 */
export function valuesForPlan(tier: PlanTier): RegistrationChoice {
  return {
    planTier: tier,
    role: ACCOUNT_TYPE_CHOICES[tier] ? undefined : PLAN_ACCOUNT_TYPES[tier][0],
  };
}

/**
 * What choosing an account type writes into the form.
 *
 * A driver takes out no subscription — their employer's covers them — so the
 * plan is cleared rather than recorded as Free.
 */
export function valuesForAccountType(tier: PlanTier, role: RegistrableRole): RegistrationChoice {
  return { planTier: role === RoleName.DRIVER ? undefined : tier, role };
}

/**
 * The plan the form currently stands on, as the registrant sees it.
 *
 * A driver's registration carries no plan, but they chose it under Free, so
 * that is the plan shown as theirs.
 */
export function chosenPlan(values: {
  planTier?: PlanTier | undefined;
  role?: RegistrableRole | undefined;
}): PlanTier | null {
  if (values.planTier) return values.planTier;
  return values.role === RoleName.DRIVER ? PlanTier.FREE : null;
}

/** A plan's monthly price, GST included. Zero for Free. */
export function planMonthlyPrice(tier: PlanTier): number {
  return PLAN_CATALOGUE.find((plan) => plan.tier === tier)?.priceMonthly ?? 0;
}

/** Whether a plan includes a vehicle — Personal and Business do, Free and Seller do not. */
export function planIncludesVehicles(tier: PlanTier): boolean {
  const limits = PLAN_CATALOGUE.find((plan) => plan.tier === tier)?.limits;
  // The pricing cards' test for a vehicleless plan; `null` trucks is unlimited.
  return Boolean(limits) && !(limits?.maxTrucks === 0 && limits.maxVehicleTopUps === 0);
}
