import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgeCheck,
  Fuel,
  Gauge,
  IndianRupee,
  Route as RouteIcon,
  ShieldAlert,
  UserPlus,
  UserMinus,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Permission,
  formatCompactCurrency,
  formatCurrency,
  formatDistanceKm,
  formatNumber,
  formatRegistrationNumber,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { DriverSummary, Paginated, TruckPassport, TruckSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DemoVerifyButton } from '@/features/verification/demo-verify-button';
import { StatCard } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { DocumentPanel } from '@/features/documents/document-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Digital truck passport — the vehicle's whole life in one place, assembled
 * entirely from stored records.
 */
export function TruckDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = React.useState(false);

  const truck = useQuery({
    queryKey: ['truck', id],
    queryFn: () => api.get<TruckSummary>(`/trucks/${id}`),
    enabled: Boolean(id),
  });

  const passport = useQuery({
    queryKey: ['truck', id, 'passport'],
    queryFn: () => api.get<TruckPassport>(`/analytics/trucks/${id}/passport`),
    enabled: Boolean(id),
  });

  const unassign = useMutation({
    mutationFn: () => api.post(`/trucks/${id}/unassign-driver`),
    onSuccess: () => {
      toast.success('Driver unassigned');
      void queryClient.invalidateQueries({ queryKey: ['truck', id] });
    },
    onError: (error) => toast.error('Could not unassign', { description: errorMessage(error) }),
  });

  if (truck.isLoading) return <LoadingState label="Loading vehicle…" />;
  if (truck.error) return <ErrorState error={truck.error} onRetry={() => void truck.refetch()} />;
  if (!truck.data) return <EmptyState title="Truck not found" />;

  const vehicle = truck.data;
  const lifetime = passport.data?.lifetime;

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/fleet/trucks')}>
        <ArrowLeft className="size-4" />
        All trucks
      </Button>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {formatRegistrationNumber(vehicle.registrationNumber)}
            <StatusBadge status={vehicle.status} />
            {vehicle.verificationStatus === 'VERIFIED' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <BadgeCheck className="size-4" />
                Verified
              </span>
            ) : (
              <StatusBadge status={vehicle.verificationStatus} size="sm" />
            )}
          </span>
        }
        description={
          [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ') ||
          humanizeEnum(vehicle.truckType)
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <DemoVerifyButton
              subjectType="truck"
              subjectId={vehicle.id}
              verified={vehicle.verificationStatus === 'VERIFIED'}
              invalidateKeys={[['truck', vehicle.id], ['trucks']]}
            />
            {can(Permission.TRUCKS_ASSIGN) ? (
              vehicle.currentDriver ? (
                <Button
                  variant="outline"
                  onClick={() => unassign.mutate()}
                  loading={unassign.isPending}
                >
                  <UserMinus className="size-4" />
                  Unassign driver
                </Button>
              ) : (
                <Button onClick={() => setAssignOpen(true)}>
                  <UserPlus className="size-4" />
                  Assign driver
                </Button>
              )
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Capacity"
          value={`${vehicle.capacityTons}T`}
          icon={Gauge}
          hint={humanizeEnum(vehicle.truckType)}
        />
        <StatCard
          label="Odometer"
          value={`${formatNumber(Math.round(vehicle.odometerKm))} km`}
          icon={RouteIcon}
          hint={
            lifetime
              ? `${formatDistanceKm(lifetime.totalDistanceKm)} on Saarthi trips`
              : undefined
          }
        />
        <StatCard
          label="Lifetime revenue"
          value={lifetime ? formatCompactCurrency(lifetime.revenue) : '—'}
          icon={IndianRupee}
          tone={lifetime && lifetime.profit > 0 ? 'success' : 'default'}
          hint={lifetime ? `Profit ${formatCompactCurrency(lifetime.profit)}` : undefined}
        />
        <StatCard
          label="Running cost"
          value={lifetime?.costPerKm ? `${formatCurrency(lifetime.costPerKm)}/km` : '—'}
          icon={Fuel}
          hint={
            lifetime?.fuelEfficiencyL100Km
              ? `${lifetime.fuelEfficiencyL100Km} L/100 km`
              : 'No fuel records yet'
          }
        />
      </div>

      {vehicle.currentDriver ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current driver</p>
              <Link
                to={`/fleet/drivers/${vehicle.currentDriver.id}`}
                className="text-sm font-medium hover:underline"
              >
                {vehicle.currentDriver.name}
              </Link>
            </div>
            {vehicle.currentTripId ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/trips/${vehicle.currentTripId}`}>View active trip</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="trips">Trips</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="drivers">Driver history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {passport.isLoading ? (
            <LoadingState />
          ) : passport.data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <SectionHeader title="Lifetime record" description="Every figure from stored data." />
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 pt-0 text-sm">
                  {[
                    ['Completed trips', formatNumber(passport.data.lifetime.completedTrips)],
                    ['Orders carried', formatNumber(passport.data.lifetime.totalOrders)],
                    ['Distance', formatDistanceKm(passport.data.lifetime.totalDistanceKm)],
                    ['Services completed', formatNumber(passport.data.lifetime.servicesCompleted)],
                    ['Fuel cost', formatCompactCurrency(passport.data.lifetime.fuelCost)],
                    ['Maintenance cost', formatCompactCurrency(passport.data.lifetime.maintenanceCost)],
                    ['Incidents', formatNumber(passport.data.lifetime.incidents)],
                    ['On platform since', new Date(passport.data.truck.createdAt).toLocaleDateString('en-IN')],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="tabular font-medium">{value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <SectionHeader title="Recent activity" />
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  {passport.data.events.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No recorded events yet.
                    </p>
                  ) : (
                    passport.data.events.slice(0, 10).map((event) => (
                      <div key={event.id} className="flex gap-3 text-sm">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{event.description ?? humanizeEnum(event.type)}</p>
                          <p className="text-xs text-muted-foreground">
                            {relativeTimeFrom(event.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="documents">
          <DocumentPanel ownerType="TRUCK" ownerId={id} ownerLabel={vehicle.registrationNumber} />
        </TabsContent>

        <TabsContent value="trips">
          {(passport.data?.recentTrips ?? []).length === 0 ? (
            <EmptyState icon={RouteIcon} title="No trips recorded yet" />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip</TableHead>
                    <TableHead className="hidden md:table-cell">Route</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(passport.data?.recentTrips ?? []).map((trip) => (
                    <TableRow
                      key={trip.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/trips/${trip.id}`)}
                    >
                      <TableCell className="font-medium">{trip.reference}</TableCell>
                      <TableCell className="hidden max-w-72 truncate text-sm text-muted-foreground md:table-cell">
                        {trip.originAddress.split(',')[0]} → {trip.destinationAddress.split(',')[0]}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={trip.status} size="sm" />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatDistanceKm(trip.actualDistanceKm)}
                      </TableCell>
                      <TableCell className="tabular hidden text-right md:table-cell">
                        {formatCurrency(trip.price)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="maintenance">
          {(passport.data?.maintenance ?? []).length === 0 ? (
            <EmptyState icon={Wrench} title="No maintenance recorded" />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Provider</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(passport.data?.maintenance ?? []).map((record) => {
                    const entry = record as {
                      id: string;
                      title: string;
                      type: string;
                      status: string;
                      serviceProvider: string | null;
                      cost: number | null;
                      completedAt: string | null;
                    };
                    return (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-xs text-muted-foreground">{humanizeEnum(entry.type)}</p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} size="sm" />
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {entry.serviceProvider ?? '—'}
                        </TableCell>
                        <TableCell className="tabular text-right">
                          {formatCurrency(entry.cost)}
                        </TableCell>
                        <TableCell className="hidden text-right text-sm text-muted-foreground md:table-cell">
                          {entry.completedAt
                            ? new Date(entry.completedAt).toLocaleDateString('en-IN')
                            : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="drivers">
          {(passport.data?.driverHistory ?? []).length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No driver assignments yet" />
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">From</TableHead>
                    <TableHead className="hidden md:table-cell">Until</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(passport.data?.driverHistory ?? []).map((assignment) => (
                    <TableRow key={`${assignment.driverId}-${assignment.assignedAt}`}>
                      <TableCell>
                        <Link
                          to={`/fleet/drivers/${assignment.driverId}`}
                          className="font-medium hover:underline"
                        >
                          {assignment.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={assignment.status} size="sm" />
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {new Date(assignment.assignedAt).toLocaleDateString('en-IN')}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {assignment.unassignedAt
                          ? new Date(assignment.unassignedAt).toLocaleDateString('en-IN')
                          : 'Current'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <AssignDriverDialog truckId={id} open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  );
}

function AssignDriverDialog({
  truckId,
  open,
  onOpenChange,
}: {
  truckId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [driverId, setDriverId] = React.useState('');

  const drivers = useQuery({
    queryKey: ['drivers', 'assignable'],
    queryFn: () =>
      api.get<Paginated<DriverSummary>>('/drivers', {
        assigned: 'false',
        verificationStatus: 'VERIFIED',
        pageSize: 100,
      }),
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: () => api.post(`/trucks/${truckId}/assign-driver`, { driverId }),
    onSuccess: () => {
      toast.success('Driver assigned');
      void queryClient.invalidateQueries({ queryKey: ['truck', truckId] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      onOpenChange(false);
      setDriverId('');
    },
    onError: (error) => toast.error('Could not assign driver', { description: errorMessage(error) }),
  });

  const available = drivers.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a driver</DialogTitle>
          <DialogDescription>
            Only verified drivers who are not already on another truck can be assigned.
          </DialogDescription>
        </DialogHeader>

        {drivers.isLoading ? (
          <LoadingState label="Loading drivers…" />
        ) : available.length === 0 ? (
          <EmptyState
            title="No available verified drivers"
            description="Add a driver and complete their verification before assigning a truck."
            className="min-h-32"
          />
        ) : (
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a driver" />
            </SelectTrigger>
            <SelectContent>
              {available.map((driver) => (
                <SelectItem key={driver.id} value={driver.id}>
                  {driver.fullName}
                  {driver.overallScore !== null ? ` · score ${driver.overallScore}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!driverId}
            loading={assign.isPending}
            onClick={() => assign.mutate()}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TruckDetailPage;
