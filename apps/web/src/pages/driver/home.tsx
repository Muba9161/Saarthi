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
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Feature,
  Permission,
  RealtimeChannel,
  RealtimeEvent,
  TripStatus,
  formatDistanceKm,
  formatSpeedKph,
  relativeTimeFrom,
  type TerminalSessionView,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { TripSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, LoadingState } from '@/components/common/states';
import { ScoreBadge, StatusBadge } from '@/components/common/status-badge';
import { BentoGrid, BentoMetric, BentoMetrics, BentoTile } from '@/components/common/bento';
import { FleetMap } from '@/features/maps/fleet-map';
import { DriverAppCard } from '@/features/driver/driver-app-card';
import { DriverSignOnCard } from '@/features/terminal/driver-signon-card';
import { JoinFleetCard } from '@/features/driver/join-fleet-card';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AnimatedNumber, LiveValue } from '@/components/motion';

/**
 * Driver home.
 *
 * Built for a phone held in one hand at a loading dock: the next action is the
 * biggest thing on screen, SOS is always reachable, and the map shows where the
 * truck actually is rather than where the driver last refreshed.
 *
 * ## The arrangement
 *
 * Below `lg` this is what it always was — one column, in order of what a driver
 * needs first. On a tablet in a cab mount it is now the same bento the rest of
 * the product uses:
 *
 *   trip (6)  ·  where you are (6)
 *   this shift in figures (12)
 *
 * The three loose stat chips and the standalone score card became four cells of
 * one band, so the screen carries three surfaces instead of eight and the trip —
 * the only thing on it a driver acts on — is the largest. The trip and the map
 * split the row evenly rather than four-and-eight: the trip card carries a
 * 56px primary button and a pair beside it, and a third of a 1024px screen is
 * 220px, which is not enough for "Trip details" to stay on one line.
 *
 * The cards above the board (join a fleet, get the app, sign on to a vehicle)
 * stay outside the grid deliberately: each renders nothing at all once it no
 * longer applies, and an empty grid cell would leave a hole in the board where
 * a card used to be.
 */
export function DriverHomePage() {
  const { session, hasFeature, can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const driverId = session?.driver?.id;
  /*
   * A driver who registered without a fleet invite code. Several things on this
   * screen otherwise address an employer that does not exist — a trip that is
   * coming, a vehicle to sign on to — so they read this rather than each
   * inventing their own guess.
   */
  const awaitingFleet = session?.driver?.awaitingFleet ?? false;

  useChannels(driverId ? [RealtimeChannel.driver(driverId)] : []);

  const trip = useQuery({
    queryKey: ['trips', 'current'],
    queryFn: () => api.get<TripSummary | null>('/trips/current'),
    refetchInterval: 30_000,
  });

  /*
   * Whether the driver is signed on to a vehicle, and where in that handshake
   * they are.
   *
   * This is the first screen after login, so it is where "you have a request
   * waiting on your arrival photo" has to appear. A driver who has to remember
   * to go and look for it is a driver standing beside a truck they cannot
   * legally move.
   */
  const signOn = useQuery({
    queryKey: ['terminal', 'my-session'],
    queryFn: () => api.get<TerminalSessionView | null>('/terminal/assignments/mine'),
    enabled: can(Permission.TERMINAL_READ),
    refetchInterval: 20_000,
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
    onError: (error) =>
      toast.error('Could not update the trip', { description: errorMessage(error) }),
  });

  const current = trip.data;

  /** The one action that matters at this point in the trip. */
  const primaryAction =
    current?.status === TripStatus.ASSIGNED
      ? { label: 'Start trip', next: TripStatus.STARTED, icon: Play, variant: 'gradient' as const }
      : current?.status === TripStatus.STARTED || current?.status === TripStatus.IN_TRANSIT
        ? {
            label: 'I have arrived',
            next: TripStatus.ARRIVED,
            icon: MapPin,
            variant: 'default' as const,
          }
        : current?.status === TripStatus.ARRIVED
          ? {
              label: 'Complete delivery',
              next: TripStatus.COMPLETED,
              icon: ShieldCheck,
              variant: 'success' as const,
            }
          : null;

  const showMap = current !== null && position !== null && hasFeature(Feature.TRACKING_LIVE);

  /**
   * The safety score's colour band, the one `ScoreBadge` draws.
   *
   * A driver is asked for the grade at a gate, not the digit, so the figure
   * keeps its band when it moves into the strip: same thresholds as the badge,
   * so the two can never disagree about where 75 sits.
   */
  const scoreTone =
    session?.driver == null || session.driver.overallScore === null
      ? 'default'
      : session.driver.overallScore >= 90
        ? 'success'
        : session.driver.overallScore >= 75
          ? 'info'
          : session.driver.overallScore >= 60
            ? 'warning'
            : 'destructive';

  /** The score on its own, for the screen that has no trip to put it beside. */
  const scoreTile = session?.driver ? (
    <BentoTile span={4}>
      <div className="flex h-full flex-col justify-center gap-3 p-5">
        <p className="section-label">Your safety score</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <ScoreBadge score={session.driver.overallScore} />
          <StatusBadge status={session.driver.verificationStatus} />
        </div>
        <Link to="/driver/score" className="text-sm font-medium text-primary hover:underline">
          See breakdown
        </Link>
      </div>
    </BentoTile>
  ) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 lg:max-w-none">
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-IN', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        title={`Hello, ${session?.user.firstName}`}
        description={
          current
            ? 'Your current trip'
            : awaitingFleet
              ? 'Join your fleet to start getting trips'
              : 'No trip assigned right now'
        }
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

      {/*
        The one thing to do first, when there is nothing else to be done: a
        driver with no fleet has no trips coming and no vehicle that would
        accept them. Renders nothing once they have an employer.
      */}
      <JoinFleetCard />

      {/*
        Get Saarthi onto the driver's phone.

        Above sign-on, and only for as long as it is useful: the card knows
        nothing about whether this driver has installed the app, so it stays put
        rather than pretending to. Everything below it is a poorer substitute
        for having the app in the cab — signing on from a browser at a truck
        works, but the app is what runs the trip.

        Renders nothing at all until a driver build is published.
      */}
      <DriverAppCard />

      {/*
        Sign-on comes before the board. A shift starts by getting authorised
        onto a vehicle; a score and a map are of no use to a driver who is not
        yet allowed to drive.
      */}
      {can(Permission.TERMINAL_DRIVE) && (signOn.data || !awaitingFleet) ? (
        signOn.data ? (
          <DriverSignOnCard registrationNumber={signOn.data.registrationNumber} />
        ) : (
          <Card variant="glass">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium">Starting a shift?</p>
                <p className="text-xs text-muted-foreground">
                  Scan the QR on the terminal or the windscreen to sign on.
                </p>
              </div>
              <Button onClick={() => navigate('/driver/scan')}>
                <ScanLine className="size-4" />
                Scan a vehicle
              </Button>
            </CardContent>
          </Card>
        )
      ) : null}

      {trip.isLoading ? (
        <LoadingState label="Checking for a trip…" />
      ) : !current ? (
        <BentoGrid>
          <BentoTile span={scoreTile ? 8 : 12} plain>
            <EmptyState
              icon={Navigation}
              title="No active trip"
              description={
                awaitingFleet
                  ? 'Trips are assigned by a fleet. Join yours above and they will appear here.'
                  : 'Your fleet will assign your next trip here. You will get a notification.'
              }
              action={
                <Button variant="outline" onClick={() => navigate('/driver/trips')}>
                  <RouteIcon className="size-4" />
                  Past trips
                </Button>
              }
            />
          </BentoTile>
          {scoreTile}
        </BentoGrid>
      ) : (
        <BentoGrid>
          {/* --------------------------------------------------- row 1 --- */}

          <BentoTile span={showMap ? 6 : 12}>
            <div className="flex flex-col gap-5 p-5">
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
            </div>
          </BentoTile>

          {/* Where the truck actually is, beside what to do about it. */}
          {showMap && position ? (
            <BentoTile span={6} className="p-0">
              <div className="relative h-full">
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
                  height="clamp(220px, 38vh, 420px)"
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
            </BentoTile>
          ) : null}

          {/* --------------------------------------------------- row 2 --- */}

          <BentoMetrics span={12} columns={4} delay={0.06}>
            <BentoMetric
              label="Planned"
              value={formatDistanceKm(current.plannedDistanceKm ?? 0)}
              icon={RouteIcon}
            />
            <BentoMetric
              label="Covered"
              value={formatDistanceKm(current.actualDistanceKm)}
              icon={Navigation}
            />
            <BentoMetric
              label="Delay"
              value={current.delayMinutes > 0 ? `${current.delayMinutes} min` : 'On time'}
              icon={Clock}
              tone={current.delayMinutes > 0 ? 'warning' : 'success'}
            />
            {session?.driver ? (
              <BentoMetric
                label="Safety score"
                value={session.driver.overallScore ?? '—'}
                icon={ShieldCheck}
                tone={scoreTone}
                hint={<StatusBadge status={session.driver.verificationStatus} size="sm" />}
                onClick={() => navigate('/driver/score')}
              />
            ) : null}
          </BentoMetrics>
        </BentoGrid>
      )}
    </div>
  );
}

export default DriverHomePage;
