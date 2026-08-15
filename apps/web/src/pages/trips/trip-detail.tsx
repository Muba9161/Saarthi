import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Gauge, MapPin, Play, Route as RouteIcon } from 'lucide-react';
import { toast } from 'sonner';
import {
  Feature,
  RealtimeChannel,
  RealtimeEvent,
  TripStatus,
  formatCurrency,
  formatDistanceKm,
  formatDurationMinutes,
  formatSpeedKph,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { TripDetail } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { FleetMap, type MapMarkerPoint } from '@/features/maps/fleet-map';
import { TripReplay } from '@/features/trips/trip-replay';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

/** Live trip view: map, progress, stops and the full event timeline. */
export function TripDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { hasFeature } = useAuth();
  const queryClient = useQueryClient();

  useChannels(id ? [RealtimeChannel.trip(id)] : []);

  const trip = useQuery({
    queryKey: ['trip', id],
    queryFn: () => api.get<TripDetail>(`/trips/${id}`),
    enabled: Boolean(id),
    refetchInterval: 45_000,
  });

  const [livePosition, setLivePosition] = React.useState<{
    latitude: number;
    longitude: number;
    heading: number;
    speedKph: number;
  } | null>(null);
  const [liveProgress, setLiveProgress] = React.useState<{
    progressPercent: number;
    distanceCoveredKm: number;
    etaAt: string | null;
    delayMinutes: number;
  } | null>(null);

  useRealtimeEvent(RealtimeEvent.TRUCK_LOCATION, (message) => {
    if (message.payload.tripId !== id) return;
    setLivePosition({
      latitude: message.payload.latitude,
      longitude: message.payload.longitude,
      heading: message.payload.heading,
      speedKph: message.payload.speedKph,
    });
  });

  useRealtimeEvent(RealtimeEvent.TRIP_PROGRESS, (message) => {
    if (message.payload.tripId !== id) return;
    setLiveProgress({
      progressPercent: message.payload.progressPercent,
      distanceCoveredKm: message.payload.distanceCoveredKm,
      etaAt: message.payload.etaAt,
      delayMinutes: message.payload.delayMinutes,
    });
  });

  useRealtimeEvent(RealtimeEvent.TRIP_UPDATED, (message) => {
    if (message.payload.tripId !== id) return;
    void queryClient.invalidateQueries({ queryKey: ['trip', id] });
  });

  const transition = useMutation({
    mutationFn: (status: TripStatus) => api.post(`/trips/${id}/transition`, { status }),
    onSuccess: (_result, status) => {
      toast.success(`Trip ${humanizeEnum(status).toLowerCase()}`);
      void queryClient.invalidateQueries({ queryKey: ['trip', id] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (error) => toast.error('Could not update the trip', { description: errorMessage(error) }),
  });

  if (trip.isLoading) return <LoadingState label="Loading trip…" />;
  if (trip.error) return <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />;
  if (!trip.data) return <EmptyState title="Trip not found" />;

  const data = trip.data;
  const progress = liveProgress?.progressPercent ?? data.progressPercent;
  const covered = liveProgress?.distanceCoveredKm ?? data.actualDistanceKm;
  const eta = liveProgress?.etaAt ?? data.etaAt;
  const delay = liveProgress?.delayMinutes ?? data.delayMinutes;

  const currentPosition = livePosition ?? data.currentLocation;

  const markers: MapMarkerPoint[] = [
    {
      id: 'origin',
      latitude: data.originLatitude,
      longitude: data.originLongitude,
      label: data.originAddress,
      kind: 'origin',
    },
    {
      id: 'destination',
      latitude: data.destinationLatitude,
      longitude: data.destinationLongitude,
      label: data.destinationAddress,
      kind: 'destination',
    },
  ];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/trips')}>
        <ArrowLeft className="size-4" />
        All trips
      </Button>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {data.reference}
            <StatusBadge status={data.status} />
          </span>
        }
        description={`${data.originAddress} → ${data.destinationAddress}`}
        actions={
          data.allowedTransitions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {data.allowedTransitions
                .filter((status) => status !== TripStatus.CANCELLED)
                .slice(0, 3)
                .map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === TripStatus.COMPLETED ? 'success' : 'outline'}
                    loading={transition.isPending}
                    onClick={() => transition.mutate(status)}
                  >
                    <Play className="size-4" />
                    {humanizeEnum(status)}
                  </Button>
                ))}
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Progress"
          value={`${progress}%`}
          icon={RouteIcon}
          hint={`${formatDistanceKm(covered)} of ${formatDistanceKm(data.plannedDistanceKm ?? 0)}`}
        />
        <StatCard
          label="Current speed"
          value={formatSpeedKph(currentPosition?.speedKph ?? 0)}
          icon={Gauge}
          hint={currentPosition ? relativeTimeFrom(data.currentLocation?.recordedAt ?? new Date()) : 'No position yet'}
        />
        <StatCard
          label={delay > 0 ? 'Running late' : 'ETA'}
          value={delay > 0 ? `+${formatDurationMinutes(delay)}` : eta ? relativeTimeFrom(eta) : '—'}
          icon={Clock}
          tone={delay > 0 ? 'warning' : 'default'}
          hint={
            data.plannedArrivalAt
              ? `Planned ${new Date(data.plannedArrivalAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
              : undefined
          }
        />
        <StatCard
          label="Trip value"
          value={formatCurrency(data.price)}
          icon={MapPin}
          hint={data.order ? `Order ${data.order.reference}` : 'Ad-hoc trip'}
        />
      </div>

      <Progress value={progress} className="h-2" />

      <Tabs defaultValue="live">
        <TabsList>
          <TabsTrigger value="live">Live view</TabsTrigger>
          <TabsTrigger value="replay">Replay</TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="space-y-5">
      <FleetMap
        trucks={
          currentPosition && data.truck
            ? [
                {
                  id: data.truck.id,
                  registrationNumber: data.truck.registrationNumber,
                  latitude: currentPosition.latitude,
                  longitude: currentPosition.longitude,
                  heading: currentPosition.heading ?? 0,
                  speedKph: currentPosition.speedKph ?? 0,
                  status: data.status,
                  driverName: data.driver?.name ?? null,
                  tripReference: data.reference,
                },
              ]
            : []
        }
        route={data.plannedRoute}
        markers={markers}
        allow3D={hasFeature(Feature.MAPS_3D)}
        height="440px"
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader title="Timeline" description="Every recorded event on this trip." />
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="relative space-y-4 border-l border-border pl-5">
              {data.events.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-primary" />
                  <p className="text-sm font-medium">
                    {event.description ?? humanizeEnum(event.type)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {humanizeEnum(event.type)} · {relativeTimeFrom(event.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Stops" />
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {data.stops.map((stop) => (
                <div key={stop.id} className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{stop.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanizeEnum(stop.type)} ·{' '}
                      {stop.actualArrival
                        ? `Arrived ${relativeTimeFrom(stop.actualArrival)}`
                        : stop.plannedArrival
                          ? `Planned ${relativeTimeFrom(stop.plannedArrival)}`
                          : 'Pending'}
                    </p>
                  </div>
                  <StatusBadge status={stop.status} size="sm" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <SectionHeader title="Assignment" />
            </CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              {data.truck ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Truck</span>
                  <Link to={`/fleet/trucks/${data.truck.id}`} className="font-medium hover:underline">
                    {data.truck.registrationNumber}
                  </Link>
                </div>
              ) : null}
              {data.driver ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Driver</span>
                  <Link to={`/fleet/drivers/${data.driver.id}`} className="font-medium hover:underline">
                    {data.driver.name}
                  </Link>
                </div>
              ) : null}
              {data.order ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Order</span>
                  <Link to={`/orders/${data.order.id}`} className="font-medium hover:underline">
                    {data.order.reference}
                  </Link>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="replay">
          <TripReplay tripId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default TripDetailPage;
