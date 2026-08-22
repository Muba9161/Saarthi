import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Fuel,
  LifeBuoy,
  MapPin,
  Navigation,
  Play,
  Route as RouteIcon,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Feature,
  RealtimeChannel,
  RealtimeEvent,
  TripStatus,
  formatDistanceKm,
  formatSpeedKph,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { TripSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, LoadingState } from '@/components/common/states';
import { ScoreBadge, StatusBadge } from '@/components/common/status-badge';
import { MiniStat } from '@/components/common/stat-card';
import { FleetMap } from '@/features/maps/fleet-map';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AnimatedNumber, LiveValue, Stagger, StaggerItem } from '@/components/motion';

/**
 * Driver home.
 *
 * Built for a phone held in one hand at a loading dock: the next action is the
 * biggest thing on screen, SOS is always reachable, and the map shows where the
 * truck actually is rather than where the driver last refreshed.
 */
export function DriverHomePage() {
  const { session, hasFeature } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const driverId = session?.driver?.id;

  useChannels(driverId ? [RealtimeChannel.driver(driverId)] : []);

  const trip = useQuery({
    queryKey: ['trips', 'current'],
    queryFn: () => api.get<TripSummary | null>('/trips/current'),
    refetchInterval: 30_000,
  });

  const [position, setPosition] = React.useState<{
    latitude: number;
    longitude: number;
    heading: number;
    speedKph: number;
  } | null>(null);

  useRealtimeEvent(RealtimeEvent.TRUCK_LOCATION, (message) => {
    if (!trip.data || message.payload.tripId !== trip.data.id) return;
    setPosition({
      latitude: message.payload.latitude,
      longitude: message.payload.longitude,
      heading: message.payload.heading,
      speedKph: message.payload.speedKph,
    });
  });

  useRealtimeEvent(RealtimeEvent.TRIP_UPDATED, () => {
    void queryClient.invalidateQueries({ queryKey: ['trips', 'current'] });
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TripStatus }) =>
      api.post(`/trips/${id}/transition`, { status }),
    onSuccess: () => {
      toast.success('Trip updated');
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (error) => toast.error('Could not update the trip', { description: errorMessage(error) }),
  });

  const current = trip.data;

  /** The one action that matters at this point in the trip. */
  const primaryAction =
    current?.status === TripStatus.ASSIGNED
      ? { label: 'Start trip', next: TripStatus.STARTED, icon: Play, variant: 'gradient' as const }
      : current?.status === TripStatus.STARTED || current?.status === TripStatus.IN_TRANSIT
        ? { label: 'I have arrived', next: TripStatus.ARRIVED, icon: MapPin, variant: 'default' as const }
        : current?.status === TripStatus.ARRIVED
          ? {
              label: 'Complete delivery',
              next: TripStatus.COMPLETED,
              icon: ShieldCheck,
              variant: 'success' as const,
            }
          : null;

  return (
    <Stagger className="mx-auto max-w-2xl space-y-5">
      <StaggerItem>
        <PageHeader
          eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          title={`Hello, ${session?.user.firstName}`}
          description={current ? 'Your current trip' : 'No trip assigned right now'}
          actions={
            <Button
              variant="destructive"
              size="lg"
              className="shadow-glow-danger"
              onClick={() => navigate('/driver/sos')}
            >
              <LifeBuoy className="size-5" />
              SOS
            </Button>
          }
        />
      </StaggerItem>

      {session?.driver ? (
        <StaggerItem>
          <Card variant="glass">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="section-label">Your safety score</p>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <ScoreBadge score={session.driver.overallScore} />
                  <Link to="/driver/score" className="text-sm font-medium text-primary hover:underline">
                    See breakdown
                  </Link>
                </div>
              </div>
              <StatusBadge status={session.driver.verificationStatus} />
            </CardContent>
          </Card>
        </StaggerItem>
      ) : null}

      {trip.isLoading ? (
        <LoadingState label="Checking for a trip…" />
      ) : !current ? (
        <StaggerItem>
          <EmptyState
            icon={Navigation}
            title="No active trip"
            description="Your fleet will assign your next trip here. You will get a notification."
            action={
              <Button variant="outline" onClick={() => navigate('/driver/trips')}>
                <RouteIcon className="size-4" />
                Past trips
              </Button>
            }
          />
        </StaggerItem>
      ) : (
        <>
          {/* Map first — a driver checks where they are before anything else. */}
          {position && hasFeature(Feature.TRACKING_LIVE) ? (
            <StaggerItem>
              <Card variant="glass" className="overflow-hidden p-0">
                <div className="relative">
                  <FleetMap
                    trucks={[
                      {
                        id: current.id,
                        registrationNumber: current.truck?.registrationNumber ?? current.reference,
                        latitude: position.latitude,
                        longitude: position.longitude,
                        heading: position.heading,
                        speedKph: position.speedKph,
                        status: current.status,
                        tripReference: current.reference,
                      },
                    ]}
                    height="clamp(200px, 30vh, 300px)"
                    className="rounded-none border-0"
                    // Keeps the camera on the driver's own truck as it moves.
                    selectedTruckId={current.id}
                    allow3D
                    /* A driver wants the road ahead, not a plan view. */
                    defaultCameraMode="chase"
                    /* The tile is too small for the floating control cluster. */
                    showControls={false}
                  />
                  <div className="glass absolute left-3 top-3 rounded-xl px-3 py-2">
                    <p className="section-label">Speed</p>
                    <p className="tabular text-sm font-semibold">
                      <LiveValue trigger={Math.round(position.speedKph)}>
                        {formatSpeedKph(position.speedKph)}
                      </LiveValue>
                    </p>
                  </div>
                </div>
              </Card>
            </StaggerItem>
          ) : null}

          <StaggerItem>
            <Card variant="glass">
              <CardContent className="space-y-5 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold">{current.reference}</p>
                    <p className="text-sm text-muted-foreground">
                      {current.truck?.registrationNumber ?? 'No truck assigned'}
                    </p>
                  </div>
                  <StatusBadge status={current.status} />
                </div>

                {/* Pickup → delivery, connected so the order reads at a glance. */}
                <div className="relative space-y-4 pl-6">
                  <span
                    className="absolute left-[7px] top-2 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-success via-border to-destructive"
                    aria-hidden
                  />
                  <div className="relative">
                    <span className="absolute -left-6 top-1 size-3.5 rounded-full border-2 border-background bg-success" />
                    <p className="section-label">Pickup</p>
                    <p className="text-sm font-medium">{current.originAddress}</p>
                  </div>
                  <div className="relative">
                    <span className="absolute -left-6 top-1 size-3.5 rounded-full border-2 border-background bg-destructive" />
                    <p className="section-label">Delivery</p>
                    <p className="text-sm font-medium">{current.destinationAddress}</p>
                  </div>
                </div>

                <div>
                  <Progress value={current.progressPercent} className="h-2.5" />
                  <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                    <span className="tabular font-medium text-foreground">
                      <AnimatedNumber
                        value={current.progressPercent}
                        format={(value) => `${Math.round(value)}%`}
                      />
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {formatDistanceKm(current.actualDistanceKm)} covered
                      </span>
                    </span>
                    {current.etaAt ? (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        ETA {relativeTimeFrom(current.etaAt)}
                      </span>
                    ) : null}
                  </div>
                </div>

                {current.delayMinutes > 0 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                    <Clock className="size-4 shrink-0" />
                    Running {current.delayMinutes} minutes behind schedule.
                  </div>
                ) : null}

                {/* Primary action fills the width — it is the thing to tap. */}
                <div className="space-y-2">
                  {primaryAction ? (
                    <Button
                      size="lg"
                      variant={primaryAction.variant}
                      className="h-14 w-full text-base"
                      loading={transition.isPending}
                      onClick={() =>
                        transition.mutate({ id: current.id, status: primaryAction.next })
                      }
                    >
                      <primaryAction.icon className="size-5" />
                      {primaryAction.label}
                    </Button>
                  ) : null}

                  <div className="grid grid-cols-2 gap-2">
                    <Button size="lg" variant="outline" onClick={() => navigate('/driver/nearby')}>
                      <Fuel className="size-5" />
                      Nearby
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() => navigate(`/driver/trips/${current.id}`)}
                    >
                      <RouteIcon className="size-5" />
                      Trip details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </StaggerItem>

          <StaggerItem className="grid grid-cols-3 gap-3">
            <MiniStat
              className="glass rounded-xl p-3"
              label="Planned"
              value={formatDistanceKm(current.plannedDistanceKm ?? 0)}
              icon={RouteIcon}
            />
            <MiniStat
              className="glass rounded-xl p-3"
              label="Covered"
              value={formatDistanceKm(current.actualDistanceKm)}
              icon={Navigation}
            />
            <MiniStat
              className="glass rounded-xl p-3"
              label="Delay"
              value={current.delayMinutes > 0 ? `${current.delayMinutes}m` : 'On time'}
              icon={Clock}
              tone={current.delayMinutes > 0 ? 'warning' : 'success'}
            />
          </StaggerItem>
        </>
      )}
    </Stagger>
  );
}

export default DriverHomePage;
