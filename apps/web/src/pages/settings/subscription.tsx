import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { FEATURE_CATALOGUE, PLAN_CATALOGUE, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function SubscriptionPage() {
  const { session } = useAuth();

  const subscription = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get<any>('/organizations/current/subscription'),
    enabled: Boolean(session?.organization),
  });

  const currentTier = session?.subscription?.planTier;
  const held = new Set(session?.subscription?.features ?? []);

  return (
    <div className="space-y-5">
      <PageHeader title="Subscription" description="What your plan includes, and what the next tier unlocks." />

      {subscription.isLoading ? <LoadingState /> : (
        <div className="grid gap-4 lg:grid-cols-4">
          {PLAN_CATALOGUE.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            return (
              <Card key={plan.tier} className={cn(isCurrent && 'border-primary ring-1 ring-primary')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {isCurrent ? <Badge variant="default" size="sm">Current</Badge> : null}
                  </div>
                  <p className="text-2xl font-semibold">
                    {plan.priceMonthly === null ? 'Custom' : formatCurrency(plan.priceMonthly)}
                    {plan.priceMonthly !== null ? <span className="text-sm font-normal text-muted-foreground">/month</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{plan.description}</p>
                </CardHeader>
                <CardContent className="space-y-1.5 pt-0">
                  {plan.features.slice(0, 10).map((feature) => {
                    const definition = FEATURE_CATALOGUE.find((entry) => entry.key === feature);
                    return (
                      <p key={feature} className={cn('flex items-start gap-1.5 text-xs', held.has(feature) ? 'text-foreground' : 'text-muted-foreground')}>
                        <Check className="mt-0.5 size-3 shrink-0" />
                        {definition?.name ?? humanizeEnum(feature)}
                      </p>
                    );
                  })}
                  {plan.features.length > 10 ? <p className="text-xs text-muted-foreground">+{plan.features.length - 10} more</p> : null}
                  <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                    <p>{plan.limits.maxTrucks === null ? 'Unlimited trucks' : `Up to ${plan.limits.maxTrucks} trucks`}</p>
                    <p>{plan.limits.trackingHistoryDays} days of tracking history</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Plan changes run through the payment provider abstraction. Locally this uses the mock provider, so no real
        payment is taken.
      </p>
    </div>
  );
}

export default SubscriptionPage;
