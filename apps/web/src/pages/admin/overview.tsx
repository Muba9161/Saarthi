import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, Building2, ScrollText, ShieldCheck, UserRound } from 'lucide-react';
import { Permission, formatNumber, humanizeEnum } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import {
  BentoGrid,
  BentoHero,
  BentoMetric,
  BentoMetrics,
  BentoPanel,
  BentoRow,
  BentoTile,
} from '@/components/common/bento';
import { toSeriesPoints } from '@/components/common/mini-chart';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Platform overview — Saarthi's own desk.
 *
 * ## The arrangement
 *
 * Five tiles rather than seven. The four headline figures share one
 * hairline-divided band across the full width — a metric cell carries a label,
 * a figure and an 84px sparkline, so it wants around 240px and does not get it
 * in a third of the board. The tenant counts get a band of their own for the
 * same reason: six numbers down the side of a panel is a list nobody reads.
 * The review queue keeps a tile to itself, because it is the only thing here
 * that is work rather than a reading.
 *
 *   account lookup (4)  ·  verification (4)  ·  environment (4)
 *   the figures (12)
 *   organizations (12)
 */

/** One account the hero's field found. Shaped by /admin/users. */
interface AccountHit {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  organizations: { id: string; name: string }[];
}

export function AdminOverviewPage() {
  const { can } = useAuth();

  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get<any>('/admin/overview'),
    enabled: can(Permission.ADMIN_PLATFORM),
    refetchInterval: 60_000,
  });

  /*
   * The account lookup.
   *
   * Results are rendered where they are asked for rather than linked away to:
   * /admin/users has no per-account screen, so a row that navigated would
   * dump the operator back into an unfiltered list of every account on the
   * platform. The row itself carries the answer — who they are, what state the
   * account is in, which tenants they belong to.
   */
  const [lookupValue, setLookupValue] = React.useState('');
  const [lookupTerm, setLookupTerm] = React.useState('');
  const [lookupHits, setLookupHits] = React.useState<AccountHit[] | null>(null);

  const lookup = useMutation({
    mutationFn: (term: string) =>
      api
        .get<{ items: AccountHit[] }>('/admin/users', { search: term, pageSize: 5 })
        .then((page) => page.items ?? []),
    onSuccess: (hits) => setLookupHits(hits),
    onError: (error) =>
      toast.error('Could not search accounts', { description: errorMessage(error) }),
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
  const pendingVerifications: number = data?.pendingVerifications ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Platform overview"
        description="Saarthi operations across every tenant."
      />

      <BentoGrid>
        {/* ---------------------------------------------------- row 1 --- */}

        <BentoHero
          span={4}
          eyebrow="Support desk"
          title="Find an account"
          description="Name, email or phone, across every tenant on the platform."
          {...(can(Permission.ADMIN_USERS)
            ? {
                lookup: {
                  label: 'Search accounts by name, email or phone',
                  placeholder: 'name@company.in',
                  value: lookupValue,
                  onChange: (value: string) => {
                    setLookupValue(value);
                    if (lookupHits !== null) setLookupHits(null);
                  },
                  onSubmit: () => {
                    const term = lookupValue.trim();
                    if (term.length === 0) return;
                    setLookupTerm(term);
                    lookup.mutate(term);
                  },
                  pending: lookup.isPending,
                  results:
                    lookupHits === null ? null : lookupHits.length === 0 ? (
                      <p className="px-1 text-xs text-muted-foreground">
                        No account matches “{lookupTerm}”.
                      </p>
                    ) : (
                      <div className="space-y-0.5 rounded-xl bg-card/70 p-1 ring-1 ring-border/70">
                        {lookupHits.map((hit) => (
                          <BentoRow
                            key={hit.id}
                            icon={UserRound}
                            tone="info"
                            title={`${hit.firstName} ${hit.lastName}`.trim() || hit.email}
                            subtitle={`${hit.email}${
                              hit.organizations.length > 0
                                ? ` · ${hit.organizations.map((entry) => entry.name).join(', ')}`
                                : ''
                            }`}
                            trailing={<StatusBadge status={hit.status} size="sm" />}
                          />
                        ))}
                      </div>
                    ),
                },
              }
            : {})}
          action={
            <>
              {can(Permission.ADMIN_ORGANIZATIONS) ? (
                <Button variant="outline" asChild>
                  <Link to="/admin/organizations">
                    <Building2 className="size-4" />
                    Organizations
                  </Link>
                </Button>
              ) : null}
              {can(Permission.ADMIN_AUDIT) ? (
                <Button variant="outline" asChild>
                  <Link to="/admin/audit">
                    <ScrollText className="size-4" />
                    Audit log
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />

        {data ? (
          <>
            {/*
              The review queue is the one tile on this board that is work
              rather than a reading, so it gets the figure at display size and
              the only primary action on the page.
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
              bodyClassName="flex flex-col justify-center"
            >
              <p
                className={
                  pendingVerifications > 0
                    ? 'tabular text-5xl font-semibold tracking-[-0.03em] text-warning'
                    : 'tabular text-5xl font-semibold tracking-[-0.03em]'
                }
              >
                {formatNumber(pendingVerifications)}
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                {pendingVerifications > 0 ? (
                  'Oldest submissions are reviewed first.'
                ) : (
                  <>
                    <ShieldCheck className="size-3.5 text-success" />
                    Nothing is waiting.
                  </>
                )}
              </p>
            </BentoPanel>

            {/*
              What this deployment is plugged into. Narrow on purpose: it is a list
              of name-and-state pairs, which is the one shape that reads better in a
              column than across a band.
            */}
            <BentoPanel
              span={4}
              title="Environment"
              description="What this deployment is wired to."
              bodyClassName="space-y-2 text-sm"
            >
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
            </BentoPanel>
          </>
        ) : null}

        {/* ---------------------------------------------------- row 2 --- */}

        {overview.isLoading ? (
          <BentoTile span={12}>
            <div
              className="-mb-px -mr-px grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
              role="status"
              aria-label="Loading"
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-3 border-b border-r border-border/60 p-5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </BentoTile>
        ) : overview.error ? (
          <BentoTile span={12}>
            <div className="p-5">
              <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
            </div>
          </BentoTile>
        ) : data ? (
          <BentoMetrics span={12} columns={4}>
            <BentoMetric
              label="Users"
              value={formatNumber(data.users)}
              chart={{ kind: 'area', points: toSeriesPoints(trends.users), format: formatNumber }}
              hint="Accounts on the platform"
            />
            <BentoMetric
              label="Trucks"
              value={formatNumber(data.trucks)}
              chart={{ kind: 'area', points: toSeriesPoints(trends.trucks), format: formatNumber }}
              hint={`${formatNumber(data.drivers)} drivers`}
            />
            <BentoMetric
              label="Active trips"
              value={formatNumber(data.activeTrips)}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.tripsStarted),
                format: (value) => `${formatNumber(value)} started`,
              }}
            />
            <BentoMetric
              label="Active SOS"
              value={formatNumber(data.activeSos)}
              chart={{
                kind: 'bars',
                points: toSeriesPoints(trends.sosTriggered),
                format: (value) => `${formatNumber(value)} raised`,
              }}
              tone={data.activeSos > 0 ? 'destructive' : 'default'}
            />
          </BentoMetrics>
        ) : null}

        {/* ---------------------------------------------------- row 3 --- */}

        {/*
          Who is on the platform. A band rather than a column: six counts down
          the side of a panel is a list nobody reads, and across the full width
          they read as what they are — the shape of the tenancy.
        */}
        {data ? (
          <BentoPanel
            span={12}
            title="Organizations"
            description="Tenants by type."
            bodyClassName="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6"
          >
            {organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organizations yet.</p>
            ) : (
              organizations.map(([type, count]) => (
                <div key={type} className="min-w-0">
                  <p className="section-label truncate">{humanizeEnum(type)}</p>
                  <p className="tabular mt-0.5 text-xl font-semibold">{String(count)}</p>
                </div>
              ))
            )}
          </BentoPanel>
        ) : null}
      </BentoGrid>
    </div>
  );
}

export default AdminOverviewPage;
