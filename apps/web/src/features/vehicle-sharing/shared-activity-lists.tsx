import { Fuel, Route, Wrench } from 'lucide-react';
import {
  formatCurrency,
  formatDate,
  formatDistanceKm,
  formatNumber,
  humanizeEnum,
} from '@saarthi/shared';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { useSharedActivity } from './sharing-api';

/**
 * The shared vehicle's trips, fill-ups and servicing — newest first, most
 * recent fifty, everyone's entries together: the owner's and the shared
 * people's are the same history.
 */

function ListShell({
  query,
  empty,
  children,
}: {
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty: { icon: typeof Route; title: string } | null;
  children: React.ReactNode;
}) {
  if (query.isLoading) return <LoadingState className="min-h-32" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (empty) return <EmptyState icon={empty.icon} title={empty.title} className="min-h-40" />;
  return <ul className="divide-y divide-border rounded-xl ring-1 ring-border">{children}</ul>;
}

export function SharedTripList({ shareId }: { shareId: string }) {
  const trips = useSharedActivity(shareId, 'trips');
  const items = trips.data ?? [];
  return (
    <ListShell
      query={trips}
      empty={items.length === 0 ? { icon: Route, title: 'No trips yet' } : null}
    >
      {items.map((trip) => (
        <li key={trip.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {trip.origin} → {trip.destination}
            </p>
            <p className="text-2xs text-muted-foreground">
              {trip.reference} ·{' '}
              {formatDate(trip.startedAt ?? trip.plannedStartAt ?? trip.createdAt)}
              {trip.actualDistanceKm ? ` · ${formatDistanceKm(trip.actualDistanceKm)}` : ''}
            </p>
          </div>
          <StatusBadge status={trip.status} />
        </li>
      ))}
    </ListShell>
  );
}

export function SharedFuelList({ shareId }: { shareId: string }) {
  const fuel = useSharedActivity(shareId, 'fuel');
  const items = fuel.data ?? [];
  return (
    <ListShell
      query={fuel}
      empty={items.length === 0 ? { icon: Fuel, title: 'No fill-ups yet' } : null}
    >
      {items.map((record) => (
        <li key={record.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {formatNumber(record.quantityLitres)} L at {formatCurrency(record.pricePerUnit)}/L
            </p>
            <p className="truncate text-2xs text-muted-foreground">
              {formatDate(record.recordedAt)}
              {record.stationName ? ` · ${record.stationName}` : ''}
              {record.odometerKm ? ` · ${formatNumber(record.odometerKm)} km` : ''}
            </p>
          </div>
          <p className="text-sm font-semibold tabular-nums">{formatCurrency(record.totalCost)}</p>
        </li>
      ))}
    </ListShell>
  );
}

export function SharedMaintenanceList({ shareId }: { shareId: string }) {
  const maintenance = useSharedActivity(shareId, 'maintenance');
  const items = maintenance.data ?? [];
  return (
    <ListShell
      query={maintenance}
      empty={items.length === 0 ? { icon: Wrench, title: 'No maintenance yet' } : null}
    >
      {items.map((record) => (
        <li key={record.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{record.title}</p>
            <p className="truncate text-2xs text-muted-foreground">
              {humanizeEnum(record.type)} ·{' '}
              {formatDate(record.completedAt ?? record.scheduledAt ?? record.createdAt)}
              {record.serviceProvider ? ` · ${record.serviceProvider}` : ''}
            </p>
          </div>
          {record.cost !== null ? (
            <p className="text-sm tabular-nums">{formatCurrency(record.cost)}</p>
          ) : null}
          <StatusBadge status={record.status} />
        </li>
      ))}
    </ListShell>
  );
}
