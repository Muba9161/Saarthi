import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CircleCheck,
  Clock,
  FileText,
  Info,
  Repeat,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { ServiceRecordView, ServiceTimeline } from '@/lib/api-types';
import { SectionHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A vehicle's service history.
 *
 * Presented as a timeline rather than a table because that is how the question
 * is actually asked — "what has been done to this truck, most recent first" —
 * and because the patterns worth seeing (the same component twice, a cost curve
 * bending upward) only read as patterns in date order.
 *
 * Every record shows where it came from. A row Saarthi received from a workshop
 * network looks different from one the fleet typed, and a row still waiting on
 * a person to confirm it says so.
 */

interface ServiceTimelinePanelProps {
  vehicleId: string;
}

export function ServiceTimelinePanel({
  vehicleId,
}: ServiceTimelinePanelProps): React.ReactElement {
  const timeline = useQuery({
    queryKey: ['service-history', vehicleId],
    queryFn: () => api.get<ServiceTimeline>(`/fleet/vehicles/${vehicleId}/service-history`),
  });

  if (timeline.isLoading) return <LoadingState label="Loading service history…" />;
  if (timeline.isError) {
    return <ErrorState error={timeline.error} onRetry={() => void timeline.refetch()} />;
  }

  const data = timeline.data!;

  return (
    <div className="space-y-4">
      <HealthCard timeline={data} />

      {data.repeated.length > 0 ? <RepeatedComponentsCard timeline={data} /> : null}

      {data.records.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Wrench}
              title="Nothing on record yet"
              description="File a service with its invoice and this becomes the vehicle's history — what a buyer, an insurer or the next workshop will ask you for."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <SectionHeader
              title="Timeline"
              description={`${data.records.length} record${data.records.length === 1 ? '' : 's'}, most recent first.`}
            />
          </CardHeader>
          <CardContent className="pt-2">
            <ol className="relative space-y-4 border-l border-border pl-5">
              {data.records.map((record) => (
                <ServiceEntry key={record.id} record={record} />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {data.coverageNote}
      </p>
    </div>
  );
}

function HealthCard({ timeline }: { timeline: ServiceTimeline }): React.ReactElement {
  const { health, spend, costTrend } = timeline;

  const tone =
    health.health === 'Healthy'
      ? { variant: 'success' as const, icon: CircleCheck }
      : health.health === 'Service overdue'
        ? { variant: 'destructive' as const, icon: AlertTriangle }
        : health.health === 'Service due'
          ? { variant: 'warning' as const, icon: Clock }
          : { variant: 'muted' as const, icon: Info };

  const Icon = tone.icon;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Icon className="h-4 w-4" />
              {health.health}
              <Badge variant={tone.variant} size="sm">
                Rule-based
              </Badge>
            </p>
            {health.reasons.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {health.reasons.map((reason) => (
                  <li key={reason} className="text-xs text-muted-foreground">
                    {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Within both the distance and the time interval since the last service.
              </p>
            )}
          </div>

          {timeline.lastServiceAt ? (
            <div className="text-right">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                Last service
              </p>
              <p className="text-sm font-medium">
                {new Date(timeline.lastServiceAt).toLocaleDateString('en-IN')}
              </p>
            </div>
          ) : null}
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Total spend" value={formatCurrency(spend.total)} hint={`${spend.recordCount} records`} />
          <Figure label="Parts" value={formatCurrency(spend.parts)} />
          <Figure label="Labour" value={formatCurrency(spend.labour)} />
          <Figure
            label="Cost per km"
            value={spend.costPerKm !== null ? formatCurrency(spend.costPerKm) : '—'}
            hint={spend.costPerKm === null ? 'Needs two odometer readings' : 'Across recorded history'}
          />
        </div>

        {costTrend.direction !== 'UNKNOWN' ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {costTrend.direction === 'UP' ? (
              <TrendingUp className="h-3.5 w-3.5 text-warning" />
            ) : costTrend.direction === 'DOWN' ? (
              <TrendingDown className="h-3.5 w-3.5 text-success" />
            ) : null}
            {formatCurrency(costTrend.recentCost)} in the last {costTrend.windowDays} days versus{' '}
            {formatCurrency(costTrend.previousCost)} in the {costTrend.windowDays} before
            {costTrend.changePercent !== null
              ? ` — ${costTrend.changePercent > 0 ? '+' : ''}${costTrend.changePercent}%`
              : ''}
            .
          </p>
        ) : null}

        {spend.unverifiedRecords > 0 ? (
          <p className="text-xs text-muted-foreground">
            {spend.unverifiedRecords} record{spend.unverifiedRecords === 1 ? '' : 's'} still
            unconfirmed, so these figures may change once they are checked.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RepeatedComponentsCard({ timeline }: { timeline: ServiceTimeline }): React.ReactElement {
  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-2">
        <SectionHeader
          title="Replaced more than once"
          description="Consumables such as oil and filters are excluded — these are components that came back."
        />
      </CardHeader>
      <CardContent className="space-y-2 pt-2">
        {timeline.repeated.map((entry) => (
          <div
            key={entry.component}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Repeat className="h-3.5 w-3.5 text-warning" />
                {entry.label}
                <Badge variant="warning" size="sm">
                  {entry.occurrences}×
                </Badge>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.daysBetween} days between the first and the latest
                {entry.kmBetween !== null
                  ? ` · ${entry.kmBetween.toLocaleString('en-IN')} km apart`
                  : ''}
              </p>
            </div>
            <p className="text-sm font-medium tabular-nums">{formatCurrency(entry.totalCost)}</p>
          </div>
        ))}
        <p className="text-2xs text-muted-foreground">
          A count, not a diagnosis. Whether this is wear, a road, a driver or a bad part is a
          question for the workshop.
        </p>
      </CardContent>
    </Card>
  );
}

function ServiceEntry({ record }: { record: ServiceRecordView }): React.ReactElement {
  const date = record.serviceDate ?? record.scheduledAt;

  return (
    <li className="relative">
      <span
        className="absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full bg-border ring-4 ring-background"
        aria-hidden
      />
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {record.title}
              {record.category ? (
                <Badge variant="muted" size="sm">
                  {humanizeEnum(record.category)}
                </Badge>
              ) : null}
              <ProvenanceBadge record={record} />
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {date ? new Date(date).toLocaleDateString('en-IN') : 'Not dated'}
              {record.odometerKm !== null
                ? ` · ${Math.round(record.odometerKm).toLocaleString('en-IN')} km`
                : ''}
              {record.workshopName ? ` · ${record.workshopName}` : ''}
              {record.invoiceNumber ? ` · ${record.invoiceNumber}` : ''}
            </p>
          </div>
          <p className="text-sm font-semibold tabular-nums">
            {record.totalCost !== null ? formatCurrency(record.totalCost) : '—'}
          </p>
        </div>

        {record.conflictNote ? (
          <p className="mt-2 rounded border border-warning/40 bg-warning/5 p-2 text-xs text-muted-foreground">
            {record.conflictNote}
          </p>
        ) : null}

        {record.parts.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {record.parts.map((part, index) => (
              <li key={`${part.name}-${index}`} className="text-xs text-muted-foreground">
                {part.quantity > 1 ? `${part.quantity} × ` : ''}
                {part.name}
                {part.partNumber ? ` (${part.partNumber})` : ''}
                {part.unitCost !== null ? ` — ${formatCurrency(part.unitCost)}` : ''}
                {part.warrantyMonths ? ` · ${part.warrantyMonths}-month warranty` : ''}
              </li>
            ))}
          </ul>
        ) : null}

        {record.diagnosticCodes.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {record.diagnosticCodes.map((code) => (
              <Badge key={code} variant="outline" size="sm">
                {code}
              </Badge>
            ))}
          </div>
        ) : null}

        {record.warrantyActive ? (
          <Badge variant="success" size="sm" className="mt-2">
            Under warranty until{' '}
            {record.warrantyUntil
              ? new Date(record.warrantyUntil).toLocaleDateString('en-IN')
              : ''}
          </Badge>
        ) : null}

        {record.mediaUrl ? (
          <a
            href={record.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <FileText className="h-3 w-3" />
            Invoice
          </a>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Where the record came from, and whether anyone has checked it.
 *
 * A record the fleet typed carries no badge — it is the norm, and badging it
 * would make the exceptions harder to spot.
 */
function ProvenanceBadge({ record }: { record: ServiceRecordView }): React.ReactElement | null {
  if (record.source === 'SIMULATED') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" size="sm" className="cursor-help">
            Simulated
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Generated locally for development. Not a record of real work.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (record.verificationStatus === 'CONFLICT') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" size="sm" className="cursor-help">
            Disputed
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          An external record disagrees with this one. Both have been kept — check the invoice and
          confirm which is right.
        </TooltipContent>
      </Tooltip>
    );
  }

  if (record.verificationStatus === 'PENDING_REVIEW') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" size="sm" className="cursor-help">
            Needs review
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {record.source === 'DOCUMENT_EXTRACTION'
            ? 'Read from an invoice automatically. Check it against the original before relying on it.'
            : 'Imported, and not yet confirmed by a person.'}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (record.verificationStatus === 'VERIFIED') {
    return (
      <Badge variant="success" size="sm">
        Verified
      </Badge>
    );
  }

  if (record.source === 'PROVIDER_SYNC') {
    return (
      <Badge variant="secondary" size="sm">
        {record.providerName ?? 'From network'}
      </Badge>
    );
  }

  return null;
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      {hint ? <p className="truncate text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
