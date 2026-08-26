import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import {
  OrderStatus,
  Permission,
  formatCurrency,
  formatNumber,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { OrderSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function OrdersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['orders', { page, status, search: debounced }],
    queryFn: () =>
      api.get<Paginated<OrderSummary>>('/orders', {
        page,
        pageSize: 20,
        ...(status === 'active' ? { activeOnly: true } : status === 'all' ? {} : { status }),
        ...(debounced ? { search: debounced } : {}),
      }),
    enabled: can(Permission.ORDERS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.ORDERS_READ)) return <UnauthorizedState />;

  const columns: Column<OrderSummary>[] = [
    {
      key: 'reference',
      header: 'Order',
      cell: (order) => (
        <div className="min-w-0">
          <p className="font-medium">{order.reference}</p>
          <p className="truncate text-xs text-muted-foreground">
            {relativeTimeFrom(order.createdAt)}
          </p>
        </div>
      ),
    },
    {
      key: 'material',
      header: 'Load',
      cell: (order) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{order.materialName}</p>
          <p className="tabular text-xs text-muted-foreground">
            {formatNumber(order.quantity)} {humanizeEnum(order.unit).toLowerCase()} ·{' '}
            {order.requiredCapacityTons}T truck
          </p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      hideOnMobile: true,
      cell: (order) => (
        <div className="min-w-0 max-w-64">
          <p className="truncate text-sm">{order.originAddress.split(',')[0]}</p>
          <p className="truncate text-xs text-muted-foreground">
            → {order.destinationAddress.split(',')[0]}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (order) => <StatusBadge status={order.status} /> },
    {
      key: 'parties',
      header: 'Counterparty',
      hideOnMobile: true,
      cell: (order) => (
        <div className="min-w-0 text-sm">
          <p className="truncate">{order.customerName}</p>
          {order.fleetName ? (
            <p className="truncate text-xs text-muted-foreground">{order.fleetName}</p>
          ) : order.quoteCount > 0 ? (
            <Badge variant="accent" size="sm">
              {order.quoteCount} quote{order.quoteCount > 1 ? 's' : ''}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      numeric: true,
      cell: (order) => (
        <span className="text-sm font-medium">
          {formatCurrency(order.totalPrice ?? order.materialPrice)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Requirements, quotes and deliveries."
        actions={
          can(Permission.ORDERS_CREATE) ? (
            <Button onClick={() => navigate('/orders/new')}>
              <Plus className="size-4" />
              New requirement
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by reference, material or location…"
            className="pl-9"
            aria-label="Search orders"
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
            <SelectItem value="all">All orders</SelectItem>
            <SelectItem value="active">In progress</SelectItem>
            {Object.values(OrderStatus).map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataView
        surface="operations.orders"
        columns={columns}
        rows={query.data?.items}
        rowKey={(order) => order.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(order) => navigate(`/orders/${order.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No orders yet"
        emptyDescription={
          can(Permission.ORDERS_CREATE)
            ? 'Post a transport requirement and fleets will quote for it.'
            : 'Requirements posted by customers will appear here.'
        }
        emptyAction={
          can(Permission.ORDERS_CREATE) ? (
            <Button onClick={() => navigate('/orders/new')}>
              <Plus className="size-4" />
              Post a requirement
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export default OrdersPage;
