import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Info, MapPin, Receipt, Wallet } from 'lucide-react';
import {
  Feature,
  Permission,
  formatCurrency,
  humanizeEnum,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type {
  FastagCapabilities,
  FastagListTotals,
  FastagView,
  Paginated,
  TollSummaryResult,
  TollTransactionView,
} from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { FastagCard } from '@/features/toll/fastag-panel';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { StatCard } from '@/components/common/stat-card';
import { FeatureLockedState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Toll & FASTag.
 *
 * Ordered by what an operator can act on. Tags that will stop a truck at a
 * barrier come first, because that is the one thing on this screen with a
 * deadline. Spend comes second: it is money already gone, and the value is in
 * seeing where it went — which plazas, and how much of it was paid in cash at
 * the booth rather than at the FASTag rate.
 */
export function TollPage(): React.ReactElement {
  const { can, hasFeature } = useAuth();
  const [page, setPage] = React.useState(1);
  const [days, setDays] = React.useState(30);

  const enabled = can(Permission.TOLL_READ) && hasFeature(Feature.TOLL_FASTAG);
  const canManage = can(Permission.TOLL_MANAGE);

  const capabilities = useQuery({
    queryKey: ['fastag-capabilities'],
    queryFn: () => api.get<FastagCapabilities>('/fleet/toll/fastag/capabilities'),
    enabled,
    staleTime: 30 * 60_000,
  });

  const tags = useQuery({
    queryKey: ['fastag', 'list'],
    queryFn: () =>
      api.get<{ items: FastagView[]; pagination: Paginated<FastagView>['pagination'] }>(
        '/fleet/toll/fastag',
        { page: 1, pageSize: 50 },
      ),
    enabled,
  });

  const summary = useQuery({
    queryKey: ['toll', 'summary', days],
    queryFn: () => api.get<TollSummaryResult>('/fleet/toll/summary', { days }),
    enabled,
  });

  const crossings = useQuery({
    queryKey: ['toll', 'transactions', page],
    queryFn: () =>
      api.get<{
        items: TollTransactionView[];
        pagination: Paginated<TollTransactionView>['pagination'];
      }>('/fleet/toll/transactions', { page, pageSize: 20 }),
    enabled,
  });

  if (!can(Permission.TOLL_READ)) return <UnauthorizedState />;

  if (!hasFeature(Feature.TOLL_FASTAG)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Toll & FASTag" />
        <FeatureLockedState feature="FASTag & toll tracking" requiredPlan="Basic" />
      </div>
    );
  }

  const tagList = tags.data?.items ?? [];
  const tagTotals = (tags.data as unknown as { totals?: FastagListTotals })?.totals;
  const needsAttention = tagList.filter((tag) => tag.health.health !== 'OK');
  const spend = summary.data;

  const columns: Column<TollTransactionView>[] = [
    {
      key: 'plaza',
      header: 'Plaza',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.plazaName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.registrationNumber}
            {row.highway ? ` · ${row.highway}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'crossedAt',
      header: 'Crossed',
      cell: (row) => (
        <span className="text-sm">{new Date(row.crossedAt).toLocaleString('en-IN')}</span>
      ),
    },
    {
      key: 'mode',
      header: 'Paid by',
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant={row.paymentMode === 'CASH' ? 'warning' : 'muted'} size="sm">
          {humanizeEnum(row.paymentMode)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Source',
      hideOnMobile: true,
      cell: (row) =>
        row.verificationStatus === 'CONFLICT' ? (
          <Badge variant="destructive" size="sm">
            Disputed
          </Badge>
        ) : row.amount === 0 ? (
          <Badge variant="warning" size="sm">
            No fare
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{humanizeEnum(row.source)}</span>
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (row) => (
        <span className="tabular-nums">
          {row.amount > 0 ? formatCurrency(row.amount) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Toll & FASTag"
        description="What your tags can pay, and what the fleet actually spends at the barrier."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Toll spend · ${days}d`}
          value={formatCurrency(spend?.total ?? 0)}
          icon={Receipt}
          hint={`${spend?.crossings ?? 0} crossing${(spend?.crossings ?? 0) === 1 ? '' : 's'}`}
        />
        <StatCard
          label="Average per crossing"
          value={spend?.averagePerCrossing !== null && spend?.averagePerCrossing !== undefined
            ? formatCurrency(spend.averagePerCrossing)
            : '—'}
          icon={Banknote}
        />
        <StatCard
          label="Tags needing attention"
          value={String(tagTotals?.needsAttention ?? needsAttention.length)}
          icon={AlertTriangle}
          tone={(tagTotals?.blocked ?? 0) > 0 ? 'destructive' : needsAttention.length > 0 ? 'warning' : 'default'}
          hint={`${tagTotals?.blocked ?? 0} blocked · ${tagTotals?.lowBalance ?? 0} low`}
        />
        <StatCard
          label="Recorded balance"
          value={formatCurrency(tagTotals?.knownBalanceTotal ?? 0)}
          icon={Wallet}
          hint={
            (tagTotals?.unknownBalance ?? 0) > 0
              ? `${tagTotals?.unknownBalance} tag(s) unknown`
              : 'across all tags'
          }
        />
      </div>

      {/*
        The honest caveat, shown once and prominently rather than buried: what a
        NETC provider serves is status, not the rupee balance.
      */}
      {capabilities.data && !capabilities.data.supportsBalance ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {capabilities.data.supportsLookup
            ? 'Your FASTag provider serves tag status and recent crossings. The rupee balance sits with the issuing bank, so balances here are the ones your team recorded.'
            : capabilities.data.unavailableReason}
        </p>
      ) : null}

      {(tagTotals?.unknownBalance ?? 0) > 0 ? (
        <Card className="border-warning/40">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {tagTotals?.unknownBalance} tag
                {tagTotals?.unknownBalance === 1 ? ' has' : 's have'} no balance on record
              </span>{' '}
              and {tagTotals?.unknownBalance === 1 ? 'is' : 'are'} left out of the total above. A
              balance nobody has reported is unknown, not zero.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="tags">
        <TabsList>
          <TabsTrigger value="tags">FASTags</TabsTrigger>
          <TabsTrigger value="crossings">Crossings</TabsTrigger>
          <TabsTrigger value="plazas">Where it goes</TabsTrigger>
        </TabsList>

        <TabsContent value="tags" className="space-y-3">
          {tags.isLoading ? (
            <LoadingState label="Loading tags…" />
          ) : tagList.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Wallet className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">No FASTags recorded</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Add a tag from a vehicle&rsquo;s FASTag tab to track its balance and be warned
                  before a truck is stopped at a barrier.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Anything that will stop a truck comes first, always. */}
              {needsAttention.map((tag) => (
                <FastagCard
                  key={tag.id}
                  tag={tag}
                  capabilities={capabilities.data}
                  canManage={canManage}
                  onChanged={() => void tags.refetch()}
                />
              ))}
              {needsAttention.length > 0 && needsAttention.length < tagList.length ? (
                <SectionHeader title="Healthy tags" />
              ) : null}
              {tagList
                .filter((tag) => tag.health.health === 'OK')
                .map((tag) => (
                  <FastagCard
                    key={tag.id}
                    tag={tag}
                    capabilities={capabilities.data}
                    canManage={canManage}
                    onChanged={() => void tags.refetch()}
                  />
                ))}
            </>
          )}
        </TabsContent>

        <TabsContent value="crossings">
          <DataView
            surface="fleet.toll"
            columns={columns}
            rows={crossings.data?.items}
            rowKey={(row) => row.id}
            isLoading={crossings.isLoading}
            error={crossings.error}
            onRetry={() => void crossings.refetch()}
            pagination={crossings.data?.pagination}
            onPageChange={setPage}
            emptyTitle="No crossings recorded"
            emptyDescription="Import a bank statement, or record a crossing by hand, and the spend below fills in."
          />
        </TabsContent>

        <TabsContent value="plazas">
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                title="Where the money goes"
                description={`The plazas this fleet pays most at over the last ${days} days.`}
              />
            </CardHeader>
            <CardContent className="space-y-2 pt-2">
              {(spend?.topPlazas ?? []).length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing recorded in this window.
                </p>
              ) : (
                (spend?.topPlazas ?? []).map((plaza) => (
                  <div
                    key={plaza.plazaName}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{plaza.plazaName}</p>
                        <p className="text-xs text-muted-foreground">
                          {plaza.crossings} crossing{plaza.crossings === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatCurrency(plaza.total)}
                    </p>
                  </div>
                ))
              )}

              {(spend?.byMode.CASH ?? 0) > 0 ? (
                <p className="pt-1 text-xs text-warning">
                  {formatCurrency(spend?.byMode.CASH ?? 0)} of this was paid in cash at the booth.
                  Cash usually costs more than the FASTag rate and is worth asking about.
                </p>
              ) : null}

              {(spend?.unpricedCrossings ?? 0) > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {spend?.unpricedCrossings} crossing
                  {spend?.unpricedCrossings === 1 ? '' : 's'} came through without a fare attached,
                  so this total is a floor. A network feed reports the passage, not the amount.
                </p>
              ) : null}

              <div className="flex gap-1.5 pt-2">
                {[7, 30, 90].map((window) => (
                  <button
                    key={window}
                    type="button"
                    onClick={() => setDays(window)}
                    className={`rounded-md px-2 py-1 text-xs transition-colors ${
                      days === window
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {window} days
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default TollPage;
