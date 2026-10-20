import { PlanTier } from '@saarthi/shared';

/**
 * What each plan is called wherever a customer chooses one.
 *
 * Shared by the pricing cards and the registration form so a plan cannot be
 * sold under one name and signed up for under another. The Supplier plan is
 * offered as "Seller": the tier keeps its stored name, the customer sees the
 * one they recognise.
 */
export const PLAN_LABEL: Record<PlanTier, string> = {
  [PlanTier.FREE]: 'Free',
  [PlanTier.PERSONAL]: 'Personal',
  [PlanTier.SUPPLIER]: 'Seller',
  [PlanTier.BUSINESS]: 'Business',
};
