import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import {
  Permission,
  RealtimeChannel,
  RealtimeEvent,
  TripStatus,
  formatDistanceKm,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import type { Paginated, TripSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader } from '@/components/common/page-header';
import { CreateTripDialog } from '@/features/trips/create-trip-dialog';
import { DataView, type Column } from '@/components/common/data-view';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function TripsPage() {
  const { can, session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState('active');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  const organizationId = session?.organization?.id;
  useChannels(organizationId ? [RealtimeChannel.fleet(organizationId)] : []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Live trip updates keep the board honest without a manual refresh.
  useRealtimeEvent(RealtimeEvent.TRIP_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  });

  const query = useQuery({
    queryKey: ['trips', { page, status, search: debounced }],
    queryFn: () =>
      api.get<Paginated<TripSummary>>('/trips', {
        page,
        pageSize: 20,
        ...(status === 'active' ? { activeOnly: true } : status === 'all' ? {} : { status }),
        ...(debounced ? { search: debounced } : {}),
      }),
    enabled: can(Permission.TRIPS_READ),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  if (!can(Permission.TRIPS_READ)) return <UnauthorizedState />;

  const columns: Column<TripSummary>[] = [
    {
      key: 'reference',
      header: 'Trip',
      cell: (trip) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {trip.reference}
            {/*
              A run the vehicle made on its own account — to a pump, a workshop,
              a weighbridge — opened by the terminal because the driver navigated
              there with nothing dispatched against the vehicle. Marked, because
              a fleet reading this list as delivered work would otherwise count
              a diesel run as a job.
            */}
            {trip.adHoc ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                Service run
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {trip.truck?.registrationNumber ?? '—'}
            {trip.driver ? ` · ${trip.driver.name}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      hideOnMobile: true,
      cell: (trip) => (
        <div className="min-w-0 max-w-72">
          <p className="truncate text-sm">{trip.originAddress.split(',')[0]}</p>
          <p className="truncate text-xs text-muted-foreground">
            → {trip.destinationAddress.split(',')[0]}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (trip) => <StatusBadge status={trip.status} /> },
    {
      key: 'progress',
      header: 'Progress',
      cell: (trip) => (
        <div className="w-28 space-y-1">
          <Progress value={trip.progressPercent} className="h-1.5" />
          <p className="tabular text-xs text-muted-foreground">
            {trip.progressPercent}% · {formatDistanceKm(trip.actualDistanceKm)}
          </p>
        </div>
      ),
    },
    {
      key: 'eta',
      header: 'ETA',
      hideOnMobile: true,
      cell: (trip) =>
        trip.status === TripStatus.COMPLETED ? (
          <span className="text-sm text-muted-foreground">
            {trip.actualArrivalAt ? relativeTimeFrom(trip.actualArrivalAt) : '—'}
          </span>
        ) : trip.delayMinutes > 0 ? (
          <span className="text-sm text-warning">+{trip.delayMinutes} min late</span>
        ) : trip.etaAt ? (
          <span className="text-sm">{relativeTimeFrom(trip.etaAt)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'customer',
      header: 'Order',
      hideOnMobile: true,
      cell: (trip) =>
        trip.order ? (
          <div className="min-w-0">
            <p className="truncate text-sm">{trip.order.materialName}</p>
            <p className="truncate text-xs text-muted-foreground">{trip.order.customerName}</p>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Ad-hoc trip</span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trips"
        description="Every movement, planned and in progress."
        actions={can(Permission.TRIPS_MANAGE) ? <CreateTripDialog /> : undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by reference or location…"
            className="pl-9"
            aria-label="Search trips"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">In progress</SelectItem>
            <SelectItem value="all">All trips</SelectItem>
            {Object.values(TripStatus).map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataView
        surface="operations.trips"
        columns={columns}
        rows={query.data?.items}
        rowKey={(trip) => trip.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(trip) => navigate(`/trips/${trip.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle={status === 'active' ? 'No trips in progress' : 'No trips found'}
        emptyDescription="Trips are created when a customer accepts a transport quote, or directly from the fleet console."
      />
    </div>
  );
}

export default TripsPage;
