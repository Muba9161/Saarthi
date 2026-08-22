import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, Plane } from 'lucide-react';
import { Permission, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { BookingSummary } from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Booking list, used by both sides of a booking.
 *
 * `side` decides whose view this is. The API scopes by the caller's
 * organization either way, so a provider cannot pass `customer` and see
 * somebody else's trips.
 */

export function bookingStatusTone(status: BookingSummary['status']) {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'CONFIRMED':
    case 'IN_PROGRESS':
      return 'info';
    case 'PENDING_PAYMENT':
    case 'AWAITING_CONFIRMATION':
      return 'warning';
    case 'CANCELLED':
    case 'DECLINED':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function TravelBookingsPage({ side = 'customer' }: { side?: 'customer' | 'provider' }) {
  const { can } = useAuth();
  const [filter, setFilter] = React.useState<'active' | 'all'>('active');
  const [page, setPage] = React.useState(1);

  const url = side === 'provider' ? '/travel/me/bookings' : '/travel/bookings';

  const bookings = useQuery({
    queryKey: ['travel', 'bookings', side, filter, page],
    queryFn: () =>
      api.get<Paginated<BookingSummary>>(url, {
        page,
        pageSize: 20,
        ...(filter === 'active' ? { activeOnly: true } : {}),
      }),
    enabled: can(Permission.BOOKINGS_READ),
  });

  if (!can(Permission.BOOKINGS_READ)) return <UnauthorizedState />;

  const columns: Column<BookingSummary>[] = [
    {
      key: 'trip',
      header: 'Trip',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.packageTitle}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.reference} · {row.passengers} passenger{row.passengers === 1 ? '' : 's'}
            {side === 'provider' ? ` · ${row.contactName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'when',
      header: 'Departure',
      cell: (row) => (
        <div>
          <p className="text-sm">{new Date(row.startDate).toLocaleDateString('en-IN')}</p>
          <p className="text-xs text-muted-foreground">
            {row.durationDays} day{row.durationDays === 1 ? '' : 's'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={bookingStatusTone(row.status)} size="sm">
          {humanizeEnum(row.status)}
        </Badge>
      ),
    },
    {
      key: 'vehicle',
      header: side === 'provider' ? 'Assigned' : 'Vehicle',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.vehicle ? row.vehicle.registrationNumber : 'Not yet assigned'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (row) => formatCurrency(row.totalAmount),
    },
    {
      key: 'action',
      header: '',
      cell: (row) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/travel/bookings/${row.id}`}>Open</Link>
        </Button>
      ),
    },
  ];

  const empty = bookings.data && bookings.data.items.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Travel"
        title={side === 'provider' ? 'Bookings received' : 'My travel'}
        description={
          side === 'provider'
            ? 'Confirm a vehicle and driver, then run the trip.'
            : 'Trips you have booked, past and upcoming.'
        }
        actions={
          side === 'customer' ? (
            <Button asChild>
              <Link to="/travel">Find a trip</Link>
            </Button>
          ) : null
        }
      />

      <div className="flex justify-end">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value as 'active' | 'all');
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {empty && filter === 'active' ? (
        <EmptyState
          icon={side === 'provider' ? CalendarDays : Plane}
          title={side === 'provider' ? 'No bookings to action' : 'No upcoming trips'}
          description={
            side === 'provider'
              ? 'Paid bookings appear here for you to confirm a vehicle and driver.'
              : 'Search Saarthi Travel to book a taxi, a transfer or a multi-day tour.'
          }
          action={
            side === 'customer' ? (
              <Button asChild>
                <Link to="/travel">Browse trips</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={bookings.data?.items}
          rowKey={(row) => row.id}
          isLoading={bookings.isLoading}
          error={bookings.error}
          pagination={bookings.data?.pagination}
          onPageChange={setPage}
          emptyTitle="No bookings"
          emptyDescription="Nothing to show for this filter."
        />
      )}
    </div>
  );
}

export default TravelBookingsPage;
