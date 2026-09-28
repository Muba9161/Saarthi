import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import {
  PLAN_CATALOGUE,
  PLAN_TIER_ORDER,
  SubscriptionStatus,
  formatCurrency,
  planAllowedForOrganizationType,
  type OrganizationType,
  type PlanDefinition,
  type PlanTier,
} from '@saarthi/shared';
import { SectionHeader } from '@/components/common/page-header';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api-client';
import { TRIAL_DAYS } from './trial-days';

/** The part of `POST /subscriptions/plan`'s answer this screen reads. */
interface ChosenPlan {
  name: string;
  status: string;
  endsAt: string | null;
}

/** Self-serve paid plans this kind of business may take, cheapest first. */
function paidPlansFor(organizationType: OrganizationType | null | undefined): PlanDefinition[] {
  return PLAN_TIER_ORDER.flatMap((tier) => {
    const plan = PLAN_CATALOGUE.find((candidate) => candidate.tier === tier);
    return plan &&
      plan.priceMonthly !== null &&
      plan.priceMonthly > 0 &&
      planAllowedForOrganizationType(plan.tier, organizationType)
      ? [plan]
      : [];
  });
}

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A first plan, for an organization that never had one.
 *
 * Every registration takes out a plan, but an account made before that, or by
 * a route that takes none, has no subscription at all and runs on Saarthi Free
 * with no vehicle, driver or device capacity. This is the one place a plan is
 * chosen after signup: it starts the same free trial registration would have,
 * and the billing card that then appears sets up autopay. An organization that
 * already holds a plan never sees it — the plan is still chosen only once.
 */
export function PlanPicker({
  organizationType,
  canManage,
  onChosen,
}: {
  organizationType: OrganizationType | null | undefined;
  canManage: boolean;
  onChosen: () => void;
}) {
  const choose = useMutation({
    mutationFn: (tier: PlanTier) => api.post<ChosenPlan>('/subscriptions/plan', { tier }),
    onSuccess: (plan) => {
      toast.success(`You are on ${plan.name}`, {
        description:
          plan.status === SubscriptionStatus.TRIALING && plan.endsAt
            ? `Your free trial runs until ${inrDate(plan.endsAt)}. Set up autopay below so it carries on after that.`
            : 'Pay for the first month below to start using it.',
      });
      onChosen();
    },
    onError: (error) => toast.error('Could not choose that plan', { description: errorMessage(error) }),
  });

  const plans = paidPlansFor(organizationType);
  const trialLabel = TRIAL_DAYS > 0 ? `Start ${TRIAL_DAYS}-day free trial` : 'Choose this plan';

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <SectionHeader
          title="Choose a plan"
          description={
            canManage
              ? `Your organization is on Saarthi Free, which covers no vehicles, drivers or trackers. ${
                  TRIAL_DAYS > 0
                    ? `Every paid plan starts with ${TRIAL_DAYS} days free - nothing is charged today.`
                    : 'A paid plan is billed from the first month.'
                }`
              : 'Your organization is on Saarthi Free, which covers no vehicles, drivers or trackers. Your account owner can choose a paid plan here.'
          }
        />
      </CardHeader>
      {canManage ? (
        <CardContent className="pt-0">
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {plans.map((plan) => {
              const pending = choose.isPending && choose.variables === plan.tier;
              return (
                <li key={plan.tier}>
                  <article
                    aria-labelledby={`plan-${plan.tier}`}
                    className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 id={`plan-${plan.tier}`} className="text-base font-semibold tracking-tight">
                        {plan.name}
                      </h3>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatCurrency(plan.priceMonthly ?? 0)}
                        <span className="ml-1 text-2xs font-normal text-muted-foreground">/month</span>
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                    <div className="mt-auto border-t border-border pt-3">
                      <Button
                        className="w-full"
                        onClick={() => choose.mutate(plan.tier)}
                        loading={pending}
                        disabled={choose.isPending}
                      >
                        <Sparkles className="size-4" aria-hidden />
                        {trialLabel}
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
