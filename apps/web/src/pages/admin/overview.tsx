import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Permission, formatNumber, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { BentoGrid, BentoPanel, BentoTile } from '@/components/common/bento';
import { toSeriesPoints } from '@/components/common/mini-chart';
import { ErrorState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCardsSkeleton } from '@/components/ui/skeleton';

export function AdminOverviewPage() {
  const { can } = useAuth();

  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get<any>('/admin/overview'),
    enabled: can(Permission.ADMIN_PLATFORM),
    refetchInterval: 60_000,
  });

  if (!can(Permission.ADMIN_PLATFORM)) return <UnauthorizedState />;

  const data = overview.data;

  /**
   * The fortnight behind each platform tile, counted from row timestamps by
   * /admin/overview. Empty arrays when the API predates the field, so the
   * tiles draw nothing rather than a stand-in for history.
   */
  const trends = data?.trends ?? {
    days: [],
    users: [],
    trucks: [],
    tripsStarted: [],
    sosTriggered: [],
  };

  const organizations = Object.entries(data?.organizations ?? {});
  const providers = Object.entries(data?.platform?.providers ?? {});

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Platform overview"
        description="Saarthi operations across every tenant."
      />

      {overview.isLoading ? (
        <StatCardsSkeleton />
      ) : overview.error ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : data ? (
        <BentoGrid>
          <BentoTile span={3} plain>
            <StatCard
              label="Users"
              value={formatNumber(data.users)}
              chart={{ kind: 'area', points: toSeriesPoints(trends.users), format: formatNumber }}
              hint="Accounts on the platform"
            />
          </BentoTile>
          <BentoTile span={3} plain>
            <StatCard
              label="Trucks"
              value={formatNumber(data.trucks)}
              chart={{ kind: 'area', points: toSeriesPoints(trends.trucks), format: formatNumber }}
              hint={`${formatNumber(data.drivers)} drivers`}
            />
          </BentoTile>
          <BentoTile span={3} plain>
            <StatCard
              label="Active trips"
              value={formatNumber(data.activeTrips)}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.tripsStarted),
                format: (value) => `${formatNumber(value)} started`,
              }}
            />
          </BentoTile>
          <BentoTile span={3} plain>
            <StatCard
              label="Active SOS"
              value={formatNumber(data.activeSos)}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.sosTriggered),
                format: (value) => `${formatNumber(value)} raised`,
              }}
              tone={data.activeSos > 0 ? 'destructive' : 'default'}
            />
          </BentoTile>

          {/*
            The review queue is the one tile on this board that is work rather
            than a reading, so it gets the figure at display size and the only
            action on the page.
          */}
          <BentoPanel
            span={4}
            title="Verification queue"
            description="Submissions waiting for review"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/verification">
                  Open
                  <ArrowRight />
                </Link>
              </Button>
            }
          >
            <p
              className={
                data.pendingVerifications > 0
                  ? 'tabular text-5xl font-semibold tracking-[-0.03em] text-warning'
                  : 'tabular text-5xl font-semibold tracking-[-0.03em]'
              }
            >
              {formatNumber(data.pendingVerifications ?? 0)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {data.pendingVerifications > 0
                ? 'Oldest submissions are reviewed first.'
                : 'Nothing is waiting.'}
            </p>
          </BentoPanel>

          <BentoPanel span={4} title="Organizations" description="Tenants by type">
            <dl className="space-y-2.5 text-sm">
              {organizations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No organizations yet.</p>
              ) : (
                organizations.map(([type, count]) => (
                  <div key={type} className="flex items-baseline justify-between gap-3">
                    <dt className="truncate text-muted-foreground">{humanizeEnum(type)}</dt>
                    <dd className="tabular font-medium">{String(count)}</dd>
                  </div>
                ))
              )}
            </dl>
          </BentoPanel>

          <BentoPanel span={4} title="Providers" description="What this environment is wired to.">
            <div className="space-y-2 text-sm">
              {providers.map(([name, value]) => (
                <div key={name} className="flex items-center justify-between gap-3">
                  <span className="truncate text-muted-foreground">{humanizeEnum(name)}</span>
                  <Badge variant={String(value) === 'production' ? 'success' : 'muted'} size="sm">
                    {String(value)}
                  </Badge>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-2.5">
                <span className="text-muted-foreground">Realtime clients</span>
                <span className="tabular font-medium">{data.platform?.realtimeClients ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Demo mode</span>
                <Badge variant={data.platform?.demoMode ? 'warning' : 'success'} size="sm">
                  {data.platform?.demoMode ? 'on' : 'off'}
                </Badge>
              </div>
            </div>
          </BentoPanel>
        </BentoGrid>
      ) : null}
    </div>
  );
}

export default AdminOverviewPage;
