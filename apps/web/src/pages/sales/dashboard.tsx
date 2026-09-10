import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ClipboardList,
  MonitorSmartphone,
  PackageCheck,
  PhoneCall,
  QrCode,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { Permission, formatCurrency, formatNumber } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import type { SalesDashboardResponse } from '@/features/sales/types';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * The salesman dashboard.
 *
 * Every figure here is a count or a sum over real rows. A salesperson's first
 * login shows zeros, deliberately: a dashboard that opens with twenty-four
 * invented leads is one nobody trusts the day it has twenty-four real ones.
 *
 * The two figures worth reading carefully are on the commission tile.
 * `pending`, `approved` and `paid` are sums of amounts the server computed from
 * real payments. `awaitingRule` is a **count** of sales that qualified but have
 * no amount yet, because no commission rule covered them — it is shown as a
 * separate note rather than folded into a total, since treating an unpriced
 * sale as ₹0 would show somebody less than they are owed with nothing on the
 * screen to explain it.
 */
export function SalesDashboardPage(): React.ReactElement {
  const { can } = useAuth();
  const { profile, godWebVerificationAvailable, isLoading: profileLoading } = useSalesProfile();

  const dashboard = useQuery({
    queryKey: ['/sales/dashboard'],
    queryFn: () => api.get<SalesDashboardResponse>('/sales/dashboard'),
    enabled: can(Permission.SALES_READ) && Boolean(profile),
    refetchInterval: 60_000,
  });

  if (!can(Permission.SALES_READ)) return <UnauthorizedState />;
  if (profileLoading) return <LoadingState className="min-h-[50vh]" />;

  if (!profile) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Sales"
          description="Leads, referrals, tracker handover and commission."
        />
        <Alert>
          <AlertDescription>
            Your Saarthi account is not linked to a salesman profile yet. Saarthi operations links
            your GODID to your account — until then there is nothing here to show.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const data = dashboard.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title={profile.name ?? 'My pipeline'}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>GODID</span>
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
              {profile.godId}
            </code>
            {profile.territory ? <span>· {profile.territory}</span> : null}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/sales/demo">Run a demo</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/sales/leads">My leads</Link>
            </Button>
          </>
        }
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      {dashboard.isLoading && !data ? <LoadingState /> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="My leads"
              numericValue={data.leads.total}
              format={(value) => formatNumber(value)}
              icon={ClipboardList}
              hint={
                data.leads.overdue > 0
                  ? `${formatNumber(data.leads.overdue)} follow-up${
                      data.leads.overdue === 1 ? '' : 's'
                    } overdue`
                  : `${formatNumber(data.leads.open)} open`
              }
              tone={data.leads.overdue > 0 ? 'warning' : 'default'}
            />
            <StatCard
              label="Demos"
              numericValue={data.leads.demosCompleted}
              format={(value) => formatNumber(value)}
              icon={MonitorSmartphone}
              hint="Completed with a prospect"
            />
            <StatCard
              label="Conversions"
              numericValue={data.leads.converted}
              format={(value) => formatNumber(value)}
              icon={TrendingUp}
              tone="success"
              hint={`${formatNumber(data.leads.lost)} closed without a sale`}
            />
            <StatCard
              label="Active customers"
              numericValue={data.customers.active}
              format={(value) => formatNumber(value)}
              icon={Building2}
              hint={`${formatNumber(data.customers.total)} attributed to me`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Trackers to hand over"
              numericValue={data.trackers.available}
              format={(value) => formatNumber(value)}
              icon={PackageCheck}
              hint={`${formatNumber(data.trackers.handedOver)} handed over · ${formatNumber(
                data.trackers.installed,
              )} installed`}
              onClick={undefined}
            />
            <StatCard
              label="First vehicle pending"
              numericValue={data.onboarding.awaitingFirstVehicle}
              format={(value) => formatNumber(value)}
              icon={PhoneCall}
              tone={data.onboarding.awaitingFirstVehicle > 0 ? 'info' : 'default'}
              hint={`${formatNumber(data.onboarding.completed)} demonstrated`}
            />
            <StatCard
              label="Referral signups"
              numericValue={data.referrals.converted}
              format={(value) => formatNumber(value)}
              icon={QrCode}
              hint={`${formatNumber(data.referrals.attributed)} registered · ${formatNumber(
                data.referrals.captured,
              )} link opened`}
            />
            <StatCard
              label="Commission pending"
              numericValue={data.commission.pending}
              format={(value) => formatCurrency(value, data.commission.currency)}
              icon={Wallet}
              tone="accent"
              hint={`${formatCurrency(
                data.commission.approved,
                data.commission.currency,
              )} approved · ${formatCurrency(data.commission.paid, data.commission.currency)} paid`}
            />
          </div>

          {/*
            An unpriced sale is surfaced rather than summed. It is the one thing
            on this screen a salesperson cannot act on themselves, so it says
            plainly who can.
          */}
          {data.commission.awaitingRule > 0 ? (
            <Alert>
              <Wallet className="h-4 w-4" />
              <AlertDescription>
                {formatNumber(data.commission.awaitingRule)}{' '}
                {data.commission.awaitingRule === 1 ? 'sale' : 'sales'} of yours{' '}
                {data.commission.awaitingRule === 1 ? 'has' : 'have'} qualified but{' '}
                {data.commission.awaitingRule === 1 ? 'does' : 'do'} not have a commission amount
                yet, because no commission rule covers{' '}
                {data.commission.awaitingRule === 1 ? 'it' : 'them'}. Saarthi operations sets the
                rule; the amount is then filled in automatically and nothing is lost.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="space-y-3">
            <SectionHeader
              title="What to do next"
              description="Assembled from your own pipeline — nothing here is a suggestion Saarthi invented."
            />
            <Card>
              <CardContent className="divide-y divide-border/60 p-0">
                <NextAction
                  to="/sales/leads?overdueOnly=true"
                  label="Follow-ups you owe"
                  count={data.leads.overdue}
                  emptyLabel="No follow-up is overdue."
                />
                <NextAction
                  to="/sales/trackers"
                  label="Trackers waiting to be handed over"
                  count={data.trackers.available}
                  emptyLabel="No tracker is waiting with you."
                />
                <NextAction
                  to="/sales/customers"
                  label="Customers whose first vehicle is not live yet"
                  count={data.onboarding.awaitingFirstVehicle}
                  emptyLabel="Every customer you delivered to is live."
                />
              </CardContent>
            </Card>
          </section>
        </>
      ) : null}
    </div>
  );
}

/**
 * One row of the "what to do next" list.
 *
 * A zero is stated rather than hidden. "No follow-up is overdue" is a useful
 * thing for a salesperson to read at 9am; an absent row is indistinguishable
 * from a screen that failed to load.
 */
function NextAction({
  to,
  label,
  count,
  emptyLabel,
}: {
  to: string;
  label: string;
  count: number;
  emptyLabel: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary/50"
    >
      <span className="min-w-0 text-sm">{count > 0 ? label : emptyLabel}</span>
      {count > 0 ? (
        <Badge variant="secondary">{formatNumber(count)}</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">Clear</span>
      )}
    </Link>
  );
}

export default SalesDashboardPage;
