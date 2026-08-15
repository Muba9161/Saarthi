import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import {
  Feature,
  compassDirection,
  formatDistanceKm,
  formatSpeedKph,
  humanizeEnum,
  type LatLng,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { FleetMap, type MapMarkerPoint } from '@/features/maps/fleet-map';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, FeatureLockedState, LoadingState } from '@/components/common/states';
import { LiveValue, motion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Trip replay.
 *
 * Plays the stored tracking history back over the map with a scrubbable
 * timeline. Everything here comes from `truck_locations` rows that were
 * written while the trip ran — nothing is interpolated beyond drawing the line
 * between two recorded fixes.
 */

interface ReplayPoint {
  latitude: number;
  longitude: number;
  speedKph: number;
  heading: number;
  recordedAt: string;
  simulated: boolean;
}

interface ReplayEvent {
  id: string;
  type: string;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

interface ReplayPayload {
  tripId: string;
  reference: string;
  status: string;
  plannedRoute: LatLng[];
  startedAt: string | null;
  endedAt: string | null;
  plannedDistanceKm: number | null;
  actualDistanceKm: number;
  points: ReplayPoint[];
  events: ReplayEvent[];
}

const SPEEDS = [1, 2, 4, 8, 16] as const;
/** Frames per second while playing — smooth without hammering React. */
const TICK_MS = 120;

export function TripReplay({ tripId }: { tripId: string }) {
  const { hasFeature } = useAuth();

  const replay = useQuery({
    queryKey: ['trip', tripId, 'replay'],
    queryFn: () => api.get<ReplayPayload>(`/trips/${tripId}/replay`),
    enabled: Boolean(tripId) && hasFeature(Feature.TRACKING_REPLAY),
  });

  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>(4);

  const points = replay.data?.points ?? [];
  const total = points.length;

  // Advance the playhead. Higher speeds step further per tick rather than
  // ticking faster, so the render rate stays constant.
  React.useEffect(() => {
    if (!playing || total === 0) return undefined;

    const timer = window.setInterval(() => {
      setIndex((previous) => {
        const next = previous + speed;
        if (next >= total - 1) {
          setPlaying(false);
          return total - 1;
        }
        return next;
      });
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [playing, speed, total]);

  if (!hasFeature(Feature.TRACKING_REPLAY)) {
    return <FeatureLockedState feature="Trip replay" requiredPlan="Pro" />;
  }
  if (replay.isLoading) return <LoadingState label="Loading replay…" />;
  if (replay.error) return <ErrorState error={replay.error} onRetry={() => void replay.refetch()} />;
  if (!replay.data || total === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title="No tracking history for this trip"
        description="Replay becomes available once the truck has reported positions."
      />
    );
  }

  const data = replay.data;
  const current = points[Math.min(index, total - 1)]!;
  const travelled = points.slice(0, index + 1).map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
  }));

  const startedAt = data.startedAt ? new Date(data.startedAt) : new Date(points[0]!.recordedAt);
  const currentAt = new Date(current.recordedAt);
  const elapsedMinutes = Math.max(0, (currentAt.getTime() - startedAt.getTime()) / 60_000);

  // Events that have already happened at the current playhead.
  const passedEvents = data.events.filter(
    (event) => new Date(event.createdAt).getTime() <= currentAt.getTime(),
  );
  const latestEvent = passedEvents[passedEvents.length - 1];

  const markers: MapMarkerPoint[] = [
    {
      id: 'start',
      latitude: points[0]!.latitude,
      longitude: points[0]!.longitude,
      label: 'Departed',
      kind: 'origin',
    },
    {
      id: 'end',
      latitude: points[total - 1]!.latitude,
      longitude: points[total - 1]!.longitude,
      label: 'Arrived',
      kind: 'destination',
    },
    // Notable events get a pin so the timeline is legible on the map too.
    ...data.events
      .filter(
        (event) =>
          event.latitude !== null &&
          event.longitude !== null &&
          ['ROUTE_DEVIATION', 'SPEED_VIOLATION', 'HARSH_BRAKING', 'EMERGENCY'].includes(event.type),
      )
      .map((event) => ({
        id: event.id,
        latitude: event.latitude!,
        longitude: event.longitude!,
        label: event.description ?? humanizeEnum(event.type),
        kind: 'incident' as const,
      })),
  ];

  const restart = (): void => {
    setIndex(0);
    setPlaying(true);
  };

  return (
    <div className="space-y-4">
      <Card variant="glass" className="overflow-hidden p-0">
        <div className="relative">
          <FleetMap
            trucks={[
              {
                id: data.tripId,
                registrationNumber: data.reference,
                latitude: current.latitude,
                longitude: current.longitude,
                heading: current.heading,
                speedKph: playing ? current.speedKph : 0,
                status: 'ON_TRIP',
                tripReference: data.reference,
                simulated: current.simulated,
              },
            ]}
            route={data.plannedRoute}
            trail={travelled}
            markers={markers}
            allow3D={hasFeature(Feature.MAPS_3D)}
            height="clamp(340px, 48vh, 520px)"
            className="rounded-none border-0"
            autoFit
          />

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass absolute left-3 top-3 rounded-xl px-3 py-2"
          >
            <p className="section-label">Playback</p>
            <p className="tabular text-sm font-semibold">
              <LiveValue trigger={Math.round(current.speedKph)}>
                {formatSpeedKph(current.speedKph)}
              </LiveValue>
              <span className="ml-2 font-normal text-muted-foreground">
                {compassDirection(current.heading)}
              </span>
            </p>
            <p className="text-2xs text-muted-foreground">
              {currentAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </motion.div>
        </div>
      </Card>

      <Card variant="glass">
        <CardContent className="space-y-4 p-4">
          {/* --- Transport controls ---------------------------------------- */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="icon"
              variant={playing ? 'outline' : 'default'}
              onClick={() => (index >= total - 1 ? restart() : setPlaying((value) => !value))}
              aria-label={playing ? 'Pause replay' : 'Play replay'}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>

            <Button
              size="icon"
              variant="outline"
              onClick={() => setIndex((value) => Math.max(0, value - Math.ceil(total / 20)))}
              aria-label="Step back"
            >
              <SkipBack className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setIndex((value) => Math.min(total - 1, value + Math.ceil(total / 20)))}
              aria-label="Step forward"
            >
              <SkipForward className="size-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={restart} aria-label="Restart replay">
              <RotateCcw className="size-4" />
            </Button>

            <div className="ml-auto flex items-center gap-1">
              {SPEEDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSpeed(option)}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    speed === option
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {option}×
                </button>
              ))}
            </div>
          </div>

          {/* --- Timeline --------------------------------------------------- */}
          <div className="space-y-1.5">
            <div className="relative">
              <input
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={index}
                onChange={(event) => {
                  setPlaying(false);
                  setIndex(Number(event.target.value));
                }}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                aria-label="Replay position"
                style={{
                  background: `linear-gradient(to right, hsl(var(--primary)) ${(index / Math.max(1, total - 1)) * 100}%, hsl(var(--muted)) ${(index / Math.max(1, total - 1)) * 100}%)`,
                }}
              />

              {/* Event pips along the timeline. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-2">
                {data.events
                  .filter((event) =>
                    ['ROUTE_DEVIATION', 'SPEED_VIOLATION', 'DELAY_DETECTED', 'EMERGENCY'].includes(
                      event.type,
                    ),
                  )
                  .map((event) => {
                    const at = new Date(event.createdAt).getTime();
                    const first = new Date(points[0]!.recordedAt).getTime();
                    const last = new Date(points[total - 1]!.recordedAt).getTime();
                    const ratio = last > first ? (at - first) / (last - first) : 0;
                    if (ratio < 0 || ratio > 1) return null;
                    return (
                      <span
                        key={event.id}
                        className="absolute top-0 size-2 -translate-x-1/2 rounded-full bg-warning ring-2 ring-background"
                        style={{ left: `${ratio * 100}%` }}
                        title={event.description ?? humanizeEnum(event.type)}
                      />
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-between text-2xs text-muted-foreground">
              <span className="tabular">
                {Math.round(elapsedMinutes)} min elapsed · point {index + 1} of {total}
              </span>
              <span className="tabular">
                {formatDistanceKm(data.actualDistanceKm)} total
              </span>
            </div>
          </div>

          {latestEvent ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
              <Badge variant="secondary" size="sm">
                {humanizeEnum(latestEvent.type)}
              </Badge>
              <p className="truncate text-xs text-muted-foreground">
                {latestEvent.description ?? 'Recorded during this trip.'}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
