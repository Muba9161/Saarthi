import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Plus, Truck, X } from 'lucide-react';
import {
  FEATURE_CATALOGUE,
  PLAN_CATALOGUE,
  Permission,
  VEHICLE_TOPUP,
  formatCurrency,
  humanizeEnum,
  type VehicleCapacity,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { LoadingState } from '@/components/common/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Subscription and capacity.
 *
 * VorldX Saarthi is sold by fleet size, so the first thing this page answers is "how
 * many vehicles can I still add?" — not "which tier am I on". The plan grid
 * sits underneath, because it is the answer to a question the operator only
 * asks once they have run out of room.
 */

interface CapacityResponse extends VehicleCapacity {
  planName: string;
  topUpPriceMonthly: number;
}

interface TopUpRow {
  id: string;
  status: string;
  startsAt: string;
  expiresAt: string | null;
  priceMonthly: number;
  paymentReference: string | null;
  note: string | null;
}

export function SubscriptionPage(): React.ReactElement {
  const { session, can } = useAuth();
  const queryClient = useQueryClient();

  const canManage = can(Permission.SUBSCRIPTION_MANAGE);
  const hasOrganization = Boolean(session?.organization);

  const capacity = useQuery({
    queryKey: ['subscription', 'capacity'],
    queryFn: () => api.get<CapacityResponse>('/subscriptions/capacity'),
    enabled: hasOrganization,
  });

  const topUps = useQuery({
    queryKey: ['subscription', 'topups'],
    queryFn: () => api.get<TopUpRow[]>('/subscriptions/topups'),
    enabled: hasOrganization,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    void queryClient.invalidateQueries({ queryKey: ['session'] });
  };

  const buy = useMutation({
    mutationFn: () => api.post('/subscriptions/topups', {}),
    onSuccess: () => {
      toast.success('Capacity added', {
        description: 'You can add one more vehicle straight away.',
      });
      refresh();
    },
    onError: (error) => toast.error('Could not add capacity', { description: errorMessage(error) }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/topups/${id}/cancel`),
    onSuccess: () => {
      toast.success('Top-up cancelled', {
        description: 'Vehicles already on the road are unaffected.',
      });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const currentTier = session?.subscription?.planTier;
  const held = new Set(session?.subscription?.features ?? []);
  const data = capacity.data;
  const activeTopUps = (topUps.data ?? []).filter((row) => row.status === 'ACTIVE');

  const usedPercent =
    data && data.effectiveLimit !== null && data.effectiveLimit > 0
      ? Math.min(100, Math.round((data.used / data.effectiveLimit) * 100))
      : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscription"
        description="Your vehicle capacity, what the plan includes, and what the next size up unlocks."
      />

      {capacity.isLoading ? (
        <LoadingState />
      ) : data ? (
        <Card className={data.atCapacity ? 'border-warning/50' : undefined}>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Vehicle capacity"
              description={`${data.planName} — capacity is checked when you add a vehicle, never afterwards.`}
            />
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-2xl font-semibold tabular-nums">
                  {data.used}
                  <span className="text-base font-normal text-muted-foreground">
                    {' / '}
                    {data.effectiveLimit === null ? 'unlimited' : data.effectiveLimit} vehicles
                  </span>
                </p>
                {data.effectiveLimit !== null ? (
                  <p className="text-sm text-muted-foreground">
                    {data.baseLimit} on the plan
                    {data.activeTopUps > 0 ? ` + ${data.activeTopUps} top-up${data.activeTopUps === 1 ? '' : 's'}` : ''}
                  </p>
                ) : null}
              </div>
              {data.effectiveLimit !== null ? (
                <Progress
                  value={usedPercent}
                  className="h-2"
                  indicatorClassName={data.atCapacity ? 'bg-warning' : undefined}
                />
              ) : null}
            </div>

            {data.atCapacity ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                <p className="font-medium">You are at capacity.</p>
                <p className="mt-0.5 text-muted-foreground">
                  Your vehicles keep working exactly as they are — you simply cannot add another
                  until you take a top-up or move up a plan.
                </p>
              </div>
            ) : null}

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Truck className="h-4 w-4 text-muted-foreground" />
                  {VEHICLE_TOPUP.name}
                  <span className="text-muted-foreground">
                    {formatCurrency(data.topUpPriceMonthly)}/month
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {VEHICLE_TOPUP.description} Buying one truck&rsquo;s worth of capacity should
                  cost one truck&rsquo;s worth — not the next plan up.
                </p>
              </div>
              {canManage ? (
                <Button
                  onClick={() => buy.mutate()}
                  disabled={!data.canPurchaseTopUp || buy.isPending}
                  title={
                    data.canPurchaseTopUp
                      ? undefined
                      : `This plan allows up to ${data.topUpCeiling} top-ups.`
                  }
                >
                  <Plus className="mr-1 h-4 w-4" />
                  {buy.isPending ? 'Adding…' : 'Add a vehicle'}
                </Button>
              ) : null}
            </div>

            {activeTopUps.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active top-ups
                </p>
                {activeTopUps.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate">
                        +1 vehicle · {formatCurrency(row.priceMonthly)}/month
                      </p>
                      <p className="text-2xs text-muted-foreground">
                        Since {new Date(row.startsAt).toLocaleDateString('en-IN')}
                        {row.expiresAt
                          ? ` · renews ${new Date(row.expiresAt).toLocaleDateString('en-IN')}`
                          : ''}
                        {row.paymentReference ? ` · ${row.paymentReference}` : ''}
                      </p>
                    </div>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancel.mutate(row.id)}
                        disabled={cancel.isPending}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_CATALOGUE.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          return (
            <Card
              key={plan.tier}
              className={cn(isCurrent && 'border-primary ring-1 ring-primary')}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">
                    {plan.limits.maxTrucks === null
                      ? 'Unlimited'
                      : `${plan.limits.maxTrucks} vehicle${plan.limits.maxTrucks === 1 ? '' : 's'}`}
                  </CardTitle>
                  {isCurrent ? (
                    <Badge variant="default" size="sm">
                      Current
                    </Badge>
                  ) : null}
                </div>
                <p className="text-2xl font-semibold">
                  {plan.priceMonthly === null ? 'Custom' : formatCurrency(plan.priceMonthly)}
                  {plan.priceMonthly !== null ? (
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">{plan.name}</p>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0">
                {plan.features.slice(0, 8).map((feature) => {
                  const definition = FEATURE_CATALOGUE.find((entry) => entry.key === feature);
                  return (
                    <p
                      key={feature}
                      className={cn(
                        'flex items-start gap-1.5 text-xs',
                        held.has(feature) ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <Check className="mt-0.5 size-3 shrink-0" />
                      {definition?.name ?? humanizeEnum(feature)}
                    </p>
                  );
                })}
                {plan.features.length > 8 ? (
                  <p className="text-xs text-muted-foreground">
                    +{plan.features.length - 8} more
                  </p>
                ) : null}
                <div className="mt-3 space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
                  <p>
                    {plan.limits.maxTrucks === null
                      ? 'Unlimited vehicles'
                      : `${plan.limits.maxTrucks} vehicle${plan.limits.maxTrucks === 1 ? '' : 's'} included`}
                  </p>
                  <p>Up to {plan.limits.maxVehicleTopUps} +1 top-ups</p>
                  <p>{plan.limits.trackingHistoryDays} days of tracking history</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Payments run through the payment provider abstraction. Locally that is the mock gateway —
        every reference it issues is prefixed <code className="text-2xs">MOCK-</code>, so a demo
        settlement can never be mistaken for a real one.
      </p>
    </div>
  );
}

export default SubscriptionPage;
