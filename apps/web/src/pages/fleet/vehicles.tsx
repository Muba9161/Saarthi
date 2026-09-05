import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Car, Cpu, Truck } from 'lucide-react';
import {
  OrganizationType,
  Permission,
  TruckStatus,
  VehicleType,
  formatNumber,
  humanizeEnum,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { VehicleSummary, VehicleTypeOption } from '@/lib/mobility-types';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, FilterBar } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { EmptyState, UnauthorizedState } from '@/components/common/states';
import { StatusBadge } from '@/components/common/status-badge';
import { AddVehicleDialog } from '@/features/vehicles/add-vehicle-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Every vehicle, whatever its type.
 *
 * Trucks, taxis, buses and vans are the same rows the fleet screens already
 * use — `/fleet/trucks` is the goods-vehicle view of this same table, and this
 * is the whole-fleet view. Capacity is shown per capability: a taxi shows seats,
 * a truck shows tonnes, and neither shows the other as a misleading zero.
 */

const STATUS_FILTERS = [
  { value: 'ALL', label: 'Any status' },
  ...Object.values(TruckStatus).map((status) => ({ value: status, label: humanizeEnum(status) })),
];

/** Passenger types a travel operator can register. No goods vehicles. */
const PASSENGER_VEHICLE_TYPES = [
  VehicleType.CAR,
  VehicleType.TAXI,
  VehicleType.SUV,
  VehicleType.VAN,
  VehicleType.BUS,
  VehicleType.TEMPO,
  VehicleType.AUTO_RICKSHAW,
  VehicleType.OTHER,
];

export function VehiclesPage() {
  const navigate = useNavigate();
  const { can, session } = useAuth();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [capability, setCapability] = React.useState('');
  const [vehicleType, setVehicleType] = React.useState('');
  const [status, setStatus] = React.useState('');

  const types = useQuery({
    queryKey: ['vehicle-types'],
    queryFn: () => api.get<VehicleTypeOption[]>('/fleet/vehicles/types'),
    enabled: can(Permission.VEHICLES_READ),
    staleTime: 60 * 60 * 1000,
  });

  const vehicles = useQuery({
    queryKey: ['vehicles', page, search, capability, vehicleType, status],
    queryFn: () =>
      api.get<Paginated<VehicleSummary>>('/fleet/vehicles', {
        page,
        pageSize: 20,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(capability ? { capability } : {}),
        ...(vehicleType ? { vehicleType } : {}),
        ...(status ? { status } : {}),
      }),
    enabled: can(Permission.VEHICLES_READ),
  });

  if (!can(Permission.VEHICLES_READ)) return <UnauthorizedState />;

  const columns: Column<VehicleSummary>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.registrationNumber}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.typeLabel}
            {row.model ? ` · ${row.manufacturer ?? ''} ${row.model}`.trimEnd() : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'capacity',
      header: 'Capacity',
      cell: (row) => (
        <span className="text-sm">
          {row.capacityTons !== null
            ? `${row.capacityTons} t`
            : row.passengerCapacity !== null
              ? `${row.passengerCapacity} seats`
              : '—'}
        </span>
      ),
    },
    {
      key: 'driver',
      header: 'Driver',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.currentDriver?.name ?? 'Unassigned'}
        </span>
      ),
    },
    {
      key: 'device',
      header: 'Hardware',
      cell: (row) =>
        row.device ? (
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            <Badge variant={row.device.status === 'ACTIVE' ? 'success' : 'warning'} size="sm">
              {humanizeEnum(row.device.status)}
            </Badge>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      // The same three compliance columns the Trucks table carries. A taxi
      // needs its permit and insurance in date exactly as a lorry does, and
      // an operator that could only see this on the freight screen had no way
      // to see it at all.
      key: 'compliance',
      header: 'Documents',
      hideOnMobile: true,
      cell: (row) => {
        const { expired, expiringSoon, pending, total } = row.documentHealth;
        if (total === 0) return <Badge variant="muted">None uploaded</Badge>;
        if (expired > 0) {
          return (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" />
              {expired} expired
            </Badge>
          );
        }
        if (expiringSoon > 0) return <Badge variant="warning">{expiringSoon} expiring</Badge>;
        if (pending > 0) return <Badge variant="info">{pending} in review</Badge>;
        return <Badge variant="success">All valid</Badge>;
      },
    },
    {
      key: 'verification',
      header: 'Verification',
      hideOnMobile: true,
      cell: (row) => <StatusBadge status={row.verificationStatus} size="sm" />,
    },
    {
      key: 'odometer',
      header: 'Odometer',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => <span className="text-sm">{formatNumber(Math.round(row.odometerKm))} km</span>,
    },
    {
      key: 'alerts',
      header: 'Alerts',
      numeric: true,
      cell: (row) =>
        row.openTelemetryAlerts > 0 ? (
          <Badge variant="warning" size="sm">
            {row.openTelemetryAlerts}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'action',
      header: '',
      cell: (row) => (
        // The whole row opens the vehicle, so these links stop the click here —
        // otherwise Telemetry would be overridden by the row's own navigation.
        <div
          className="flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          {row.device ? (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to={`/fleet/vehicles/${row.id}/telemetry`}>
                <Activity className="h-3.5 w-3.5" />
                Telemetry
              </Link>
            </Button>
          ) : null}
          {/*
            The generalized detail route, not the truck one: a taxi opened from
            here must be presented as a taxi, not as a truck with no payload.
          */}
          <Button asChild variant="ghost" size="sm">
            <Link to={`/fleet/vehicles/${row.id}`}>Open</Link>
          </Button>
        </div>
      ),
    },
  ];

  const hasFilters = Boolean(search || capability || vehicleType || status);
  const isTravelOperator = session?.organization?.type === OrganizationType.MOBILITY_PROVIDER;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vehicles"
        description={
          isTravelOperator
            ? 'Every vehicle you run, with live status and document health.'
            : 'Trucks, taxis, buses and vans across the whole organization.'
        }
        actions={
          can(Permission.VEHICLES_CREATE) ? (
            // A travel operator has no other way in — there is no Trucks screen
            // for them — so the type list is narrowed rather than hidden.
            <AddVehicleDialog
              {...(isTravelOperator ? { allowedTypes: PASSENGER_VEHICLE_TYPES } : {})}
              defaultType={isTravelOperator ? VehicleType.CAR : VehicleType.TRUCK}
            />
          ) : undefined
        }
      />

      <FilterBar>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label htmlFor="vehicle-search">Search</Label>
          <Input
            id="vehicle-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Registration, make or model"
          />
        </div>

        <div className="w-[180px] space-y-1.5">
          <Label>Status</Label>
          <Select
            value={status || 'ALL'}
            onValueChange={(value) => {
              setStatus(value === 'ALL' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[180px] space-y-1.5">
          <Label>Used for</Label>
          <Select
            value={capability || 'ALL'}
            onValueChange={(value) => {
              setCapability(value === 'ALL' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Anything" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Anything</SelectItem>
              <SelectItem value="FREIGHT">Goods</SelectItem>
              <SelectItem value="PASSENGER">Passengers</SelectItem>
              <SelectItem value="TRAVEL">Travel packages</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-[180px] space-y-1.5">
          <Label>Type</Label>
          <Select
            value={vehicleType || 'ALL'}
            onValueChange={(value) => {
              setVehicleType(value === 'ALL' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Any type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any type</SelectItem>
              {(types.data ?? []).map((option) => (
                <SelectItem key={option.type} value={option.type}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      {vehicles.data && vehicles.data.items.length === 0 && !hasFilters ? (
        <EmptyState
          icon={Truck}
          title="No vehicles yet"
          description={
            isTravelOperator
              ? 'Add your first car, taxi or bus to start offering journeys and packages.'
              : 'Add a vehicle here, or a goods vehicle from Fleet → Trucks.'
          }
          action={
            can(Permission.VEHICLES_CREATE) ? (
              <AddVehicleDialog
                {...(isTravelOperator ? { allowedTypes: PASSENGER_VEHICLE_TYPES } : {})}
                defaultType={isTravelOperator ? VehicleType.CAR : VehicleType.TRUCK}
              />
            ) : undefined
          }
        />
      ) : vehicles.data && vehicles.data.items.length === 0 ? (
        <EmptyState
          icon={Car}
          title="No vehicles match"
          description="Try clearing a filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setCapability('');
                setVehicleType('');
                setStatus('');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <DataView
          surface="fleet.vehicles"
          columns={columns}
          rows={vehicles.data?.items}
          rowKey={(row) => row.id}
          isLoading={vehicles.isLoading}
          error={vehicles.error}
          onRowClick={(row) => navigate(`/fleet/vehicles/${row.id}`)}
          pagination={vehicles.data?.pagination}
          onPageChange={setPage}
          emptyTitle="No vehicles"
          emptyDescription="Nothing to show."
        />
      )}
    </div>
  );
}

export default VehiclesPage;
