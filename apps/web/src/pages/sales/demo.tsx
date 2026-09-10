import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ShieldOff, Sparkles } from 'lucide-react';
import { Permission, formatCurrency } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import type { DemoScriptResponse } from '@/features/sales/types';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

/**
 * Demo Mode.
 *
 * A labelled tour of the *real* Saarthi screens, not a second implementation of
 * them. Each row links to the screen it describes, so a screen improved next
 * month improves the demo too, and there is no shadow copy to drift.
 *
 * Movement comes from the existing GPS simulator, which is already gated behind
 * `DEMO_MODE` and which the API refuses to enable in production. When the
 * server says demo mode is off, that is stated plainly here rather than leaving
 * a salesperson to wonder why nothing on the map moves.
 *
 * The pricing block is computed by the API from the same catalogue the pricing
 * card and signup use, so a figure quoted in a yard is the figure the customer
 * will be charged.
 */
export function SalesDemoPage(): React.ReactElement {
  const { can } = useAuth();

  const demo = useQuery({
    queryKey: ['/sales/demo'],
    queryFn: () => api.get<DemoScriptResponse>('/sales/demo'),
    enabled: can(Permission.DEMO_USE),
    staleTime: 10 * 60_000,
  });

  if (!can(Permission.DEMO_USE)) return <UnauthorizedState />;
  if (demo.isLoading) return <LoadingState className="min-h-[50vh]" />;
  if (!demo.data) return <LoadingState />;

  const script = demo.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            Demo mode
            <Badge variant="warning" className="uppercase tracking-wide">
              Demo
            </Badge>
          </span>
        }
        description="Show a prospect what Saarthi does. Nothing here belongs to a real customer."
      />

      <Alert>
        <ShieldOff className="h-4 w-4" />
        <AlertTitle>{script.notice}</AlertTitle>
        <AlertDescription>
          <ul className="mt-1 space-y-0.5 text-xs">
            {script.prohibitions.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      {!script.demoModeEnabled ? (
        <Alert variant="destructive">
          <AlertTitle>Simulation is off on this environment</AlertTitle>
          <AlertDescription>
            The screens below still work, but no vehicle will move — the GPS simulator is
            disabled. Show the demo on a device pointed at a demo environment, or use a customer’s
            own vehicle once it is fitted.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Start the simulator from{' '}
            <Link to="/simulator" className="underline">
              Simulator controls
            </Link>{' '}
            before you walk through the live map and trips, so there is something moving on the
            screen.
          </AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <SectionHeader
          title="The walkthrough"
          description="In the order that makes sense to a fleet owner: what they already worry about first."
        />
        <div className="grid gap-3 md:grid-cols-2">
          {script.capabilities.map((capability, index) => (
            <Card key={capability.key}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="section-label">Step {index + 1}</p>
                    <h3 className="truncate font-semibold">{capability.label}</h3>
                  </div>
                  {capability.needsSimulator ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Needs simulator
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">{capability.talkingPoint}</p>
                <Button asChild size="sm" variant="outline">
                  <Link to={capability.route}>
                    Open
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader
          title="What it costs"
          description="The real catalogue price. Quote from here rather than from memory."
        />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {script.pricing.plans.map((plan) => (
                <div key={plan.tier} className="space-y-1 rounded-lg border border-border p-3">
                  <p className="font-medium">{plan.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {plan.priceMonthly === null
                      ? 'Custom pricing'
                      : `${formatCurrency(plan.priceMonthly)} per month`}
                    {plan.priceYearly !== null
                      ? ` · ${formatCurrency(plan.priceYearly)} per year`
                      : ''}
                  </p>
                </div>
              ))}
            </div>

            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-0.5">
                <p className="section-label">Saarthi tracker</p>
                <p className="text-sm">
                  {formatCurrency(script.pricing.trackerOneTime)} once, per vehicle
                </p>
                <p className="text-xs text-muted-foreground">
                  Saarthi provides the tracker. A customer cannot fit their own.
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="section-label">Extra vehicle</p>
                <p className="text-sm">
                  {formatCurrency(script.pricing.vehicleTopUpMonthly)} per month, each
                </p>
                <p className="text-xs text-muted-foreground">
                  Beyond the one the plan includes.
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-1 rounded-lg bg-secondary/50 p-3">
              <p className="section-label">Worked example — read this one out</p>
              <p className="text-sm">
                {script.pricing.example.vehicles} vehicles with{' '}
                {script.pricing.example.trackers} trackers:{' '}
                <strong>{formatCurrency(script.pricing.example.monthlyTotal)} a month</strong>, plus{' '}
                <strong>{formatCurrency(script.pricing.example.oneOffTotal)} once</strong> for the
                hardware. GST included.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default SalesDemoPage;
