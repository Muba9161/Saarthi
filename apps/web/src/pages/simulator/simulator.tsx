import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Crosshair,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  Route as RouteIcon,
  Square,
  Timer,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Feature,
  Permission,
  RealtimeChannel,
  RealtimeEvent,
  compassDirection,
  formatDistanceKm,
  formatSpeedKph,
  type LatLng,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { Paginated, SimulationSummary, TripDetail, TripSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { EmptyState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { StatusBadge } from '@/components/common/status-badge';
import { FleetMap, type MapMarkerPoint, type MapTruck } from '@/features/maps/fleet-map';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AnimatedBar, LiveValue, Stagger, StaggerItem, motion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * GPS simulator.
 *
 * The map is the point of this screen: the truck you start here moves on it in
 * realtime, driven by the same ingestion pipeline production GPS hardware will
 * use. The controls beside it inject the conditions a demo needs — speed,
 * delays, route deviation — and you watch the consequences land on the map and
 * in the telemetry readout.
 */

const SPEED_PRESETS = ['1', '2', '5', '10', '25', '50', '100'] as const;

interface Telemetry {
  latitude: number;
  longitude: number;
  speedKph: number;
  heading: number;
  recordedAt: string;
}

export function SimulatorPage() {
  const { can, session, hasFeature } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = session?.organization?.id;

  const [tripId, setTripId] = React.useState('');
  const [multiplier, setMultiplier] = React.useState('10');
  const [followTruck, setFollowTruck] = React.useState(true);
  const [telemetry, setTelemetry] = React.useState<Record<string, Telemetry>>({});
  const [trails, setTrails] = React.useState<Record<string, LatLng[]>>({});
  const [selectedSimulationId, setSelectedSimulationId] = React.useState<string | null>(null);

  useChannels(organizationId ? [RealtimeChannel.fleet(organizationId)] : []);

  const simulations = useQuery({
    queryKey: ['simulations'],
    queryFn: () => api.get<SimulationSummary[]>('/simulation'),
    enabled: can(Permission.TRUCKS_UPDATE) && Boolean(session?.demoMode),
    refetchInterval: 2500,
  });

  const trips = useQuery({
    queryKey: ['trips', 'simulatable'],
    queryFn: () => api.get<Paginated<TripSummary>>('/trips', { activeOnly: true, pageSize: 50 }),
    enabled: can(Permission.TRIPS_READ),
  });

  const active = React.useMemo(
    () => (simulations.data ?? []).filter((entry) => entry.status !== 'STOPPED'),
    [simulations.data],
  );

  const selected = React.useMemo(
    () => active.find((entry) => entry.id === selectedSimulationId) ?? active[0] ?? null,
    [active, selectedSimulationId],
  );

  // The selected simulation's trip gives us the planned route to draw.
  const selectedTrip = useQuery({
    queryKey: ['trip', selected?.tripId],
    queryFn: () => api.get<TripDetail>(`/trips/${selected!.tripId}`),
    enabled: Boolean(selected?.tripId),
  });

  // --- Live telemetry ---------------------------------------------------
  useRealtimeEvent(RealtimeEvent.TRUCK_LOCATION, (message) => {
    const { truckId, latitude, longitude, speedKph, heading, recordedAt } = message.payload;

    setTelemetry((previous) => ({
      ...previous,
      [truckId]: { latitude, longitude, speedKph, heading, recordedAt },
    }));

    // Keep a bounded breadcrumb trail so the travelled path draws behind the truck.
    setTrails((previous) => {
      const existing = previous[truckId] ?? [];
      const next = [...existing, { latitude, longitude }];
      return { ...previous, [truckId]: next.length > 400 ? next.slice(-400) : next };
    });
  });

  const start = useMutation({
    mutationFn: () => {
      const trip = (trips.data?.items ?? []).find((entry) => entry.id === tripId);
      if (!trip?.truck) throw new Error('Choose a trip that has a truck assigned.');
      return api.post<SimulationSummary>('/simulation', {
        truckId: trip.truck.id,
        tripId,
        speedMultiplier: Number(multiplier),
        baseSpeedKph: 55,
        behaviours: { gpsNoiseMeters: 8, speedVariance: 0.22 },
      });
    },
    onSuccess: (simulation) => {
      toast.success('Simulation started', { description: 'Watch the truck move on the map.' });
      setSelectedSimulationId(simulation.id);
      // Start the trail fresh so an old run does not bleed into this one.
      setTrails((previous) => ({ ...previous, [simulation.truckId]: [] }));
      void queryClient.invalidateQueries({ queryKey: ['simulations'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (error) => toast.error('Could not start', { description: errorMessage(error) }),
  });

  const control = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      api.post(`/simulation/${id}/control`, { action }),
    onSuccess: (_result, variables) => {
      if (variables.action === 'RESET' && selected) {
        setTrails((previous) => ({ ...previous, [selected.truckId]: [] }));
      }
      void queryClient.invalidateQueries({ queryKey: ['simulations'] });
    },
    onError: (error) => toast.error('Control failed', { description: errorMessage(error) }),
  });

  const tune = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.post(`/simulation/${id}/tune`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['simulations'] }),
    onError: (error) => toast.error('Could not apply', { description: errorMessage(error) }),
  });

  if (!can(Permission.TRUCKS_UPDATE)) return <UnauthorizedState />;

  if (!session?.demoMode) {
    return (
      <div className="space-y-5">
        <PageHeader title="GPS simulator" />
        <Alert variant="warning">
          <TriangleAlert className="size-4" />
          <AlertTitle>Simulation is disabled</AlertTitle>
          <AlertDescription>
            This environment has <code>DEMO_MODE</code> turned off, so simulated GPS cannot be
            produced. That is deliberate — the API refuses to start in production with demo mode on.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // --- Map inputs --------------------------------------------------------
  const mapTrucks: MapTruck[] = active.map((simulation) => {
    const live = telemetry[simulation.truckId];
    return {
      id: simulation.truckId,
      registrationNumber: simulation.registrationNumber,
      latitude: live?.latitude ?? 0,
      longitude: live?.longitude ?? 0,
      heading: live?.heading ?? 0,
      speedKph: live?.speedKph ?? 0,
      status: simulation.status === 'RUNNING' ? 'ON_TRIP' : 'IDLE',
      tripReference: simulation.tripReference,
      simulated: true,
    };
  }).filter((truck) => truck.latitude !== 0 || truck.longitude !== 0);

  const route = selectedTrip.data?.plannedRoute ?? [];
  const trail = selected ? (trails[selected.truckId] ?? []) : [];
  const liveSelected = selected ? telemetry[selected.truckId] : undefined;

  const markers: MapMarkerPoint[] = selectedTrip.data
    ? [
        {
          id: 'origin',
          latitude: selectedTrip.data.originLatitude,
          longitude: selectedTrip.data.originLongitude,
          label: selectedTrip.data.originAddress,
          kind: 'origin',
        },
        {
          id: 'destination',
          latitude: selectedTrip.data.destinationLatitude,
          longitude: selectedTrip.data.destinationLongitude,
          label: selectedTrip.data.destinationAddress,
          kind: 'destination',
        },
      ]
    : [];

  const runnable = (trips.data?.items ?? []).filter((trip) => trip.truck);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Demo tooling"
        title="GPS simulator"
        description="Drive a trip end-to-end with realistic movement, and watch it land on the live map."
        actions={
          active.length > 0 ? (
            <Badge variant="success" className="gap-1.5">
              <span className="live-dot" />
              {active.filter((entry) => entry.status === 'RUNNING').length} running
            </Badge>
          ) : null
        }
      />

      <Alert variant="info">
        <Gauge className="size-4" />
        <AlertTitle>Simulated positions are labelled everywhere</AlertTitle>
        <AlertDescription>
          Each point is stored with source <code>MOCK</code> and flagged as simulated, so it can
          never be mistaken for a real GPS fix. Swapping in hardware later changes the source, not
          the pipeline.
        </AlertDescription>
      </Alert>

      {/* ---- The map, front and centre ---------------------------------- */}
      <Card variant="glass" className="overflow-hidden p-0">
        <div className="relative">
          <FleetMap
            trucks={mapTrucks}
            route={route}
            trail={trail}
            markers={markers}
            selectedTruckId={followTruck ? (selected?.truckId ?? null) : null}
            onSelectTruck={(truckId) => {
              const match = active.find((entry) => entry.truckId === truckId);
              if (match) setSelectedSimulationId(match.id);
            }}
            allow3D={hasFeature(Feature.MAPS_3D)}
            height="clamp(360px, 52vh, 560px)"
            className="rounded-none border-0"
            autoFit
          />

          {/* Live telemetry readout floating over the map. */}
          {selected ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass pointer-events-auto absolute bottom-3 left-3 right-3 rounded-xl p-3 sm:right-auto sm:w-[22rem]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{selected.registrationNumber}</p>
                  {selected.tripReference ? (
                    <Link
                      to={`/trips/${selected.tripId}`}
                      className="truncate text-xs text-primary hover:underline"
                    >
                      {selected.tripReference}
                    </Link>
                  ) : null}
                </div>
                <StatusBadge status={selected.status} size="sm" />
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="section-label">Speed</p>
                  <p className="tabular text-sm font-semibold">
                    <LiveValue trigger={Math.round(liveSelected?.speedKph ?? 0)}>
                      {formatSpeedKph(liveSelected?.speedKph ?? 0)}
                    </LiveValue>
                  </p>
                </div>
                <div>
                  <p className="section-label">Heading</p>
                  <p className="tabular text-sm font-semibold">
                    {compassDirection(liveSelected?.heading ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="section-label">Covered</p>
                  <p className="tabular text-sm font-semibold">
                    {formatDistanceKm(selected.progressMeters / 1000)}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 space-y-1">
                <AnimatedBar
                  value={selected.progressPercent}
                  height="h-1.5"
                  barClassName="bg-gradient-to-r from-primary to-accent"
                />
                <div className="flex justify-between text-2xs text-muted-foreground">
                  <span className="tabular">{selected.progressPercent}% of route</span>
                  <span className="tabular">
                    {formatDistanceKm(selected.routeDistanceKm)} total
                  </span>
                </div>
              </div>
            </motion.div>
          ) : null}

          {/* Follow toggle sits on the map so it is where your eye already is. */}
          <div className="absolute right-3 top-3 flex flex-col gap-1.5">
            <Button
              size="sm"
              variant={followTruck ? 'default' : 'glass'}
              onClick={() => setFollowTruck((value) => !value)}
              className="shadow-lifted"
            >
              <Crosshair className="size-4" />
              {followTruck ? 'Following' : 'Free pan'}
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- Launcher ---------------------------------------------------- */}
      <Card variant="glass">
        <CardHeader className="pb-3">
          <SectionHeader
            title="Start a simulation"
            description="Pick an active trip. Starting the simulator also starts the trip, exactly as a driver tapping Start would."
          />
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3 pt-0">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label required>Trip</Label>
            <Select value={tripId} onValueChange={setTripId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an active trip" />
              </SelectTrigger>
              <SelectContent>
                {runnable.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No active trips with a truck assigned.
                  </div>
                ) : (
                  runnable.map((trip) => (
                    <SelectItem key={trip.id} value={trip.id}>
                      {trip.reference} · {trip.truck?.registrationNumber} ·{' '}
                      {trip.originAddress.split(',')[0]} → {trip.destinationAddress.split(',')[0]}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Speed</Label>
            <div className="flex gap-1">
              {SPEED_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={multiplier === preset ? 'default' : 'outline'}
                  onClick={() => setMultiplier(preset)}
                  className="min-w-11 px-2"
                >
                  {preset}×
                </Button>
              ))}
            </div>
          </div>

          <Button
            size="lg"
            variant="gradient"
            disabled={!tripId}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            <Play className="size-4" />
            Start
          </Button>
        </CardContent>
      </Card>

      {/* ---- Running simulations ----------------------------------------- */}
      {simulations.isLoading ? (
        <LoadingState label="Loading simulations…" />
      ) : active.length === 0 ? (
        <EmptyState
          icon={RouteIcon}
          title="No simulations running"
          description="Pick an active trip above and press Start. The truck will begin moving on the map immediately."
        />
      ) : (
        <Stagger className="grid gap-3 lg:grid-cols-2">
          {active.map((simulation) => {
            const isSelected = selected?.id === simulation.id;
            const live = telemetry[simulation.truckId];

            return (
              <StaggerItem key={simulation.id}>
                <Card
                  variant="glass"
                  className={cn(
                    'cursor-pointer transition-all',
                    isSelected && 'ring-2 ring-primary/40',
                  )}
                  onClick={() => setSelectedSimulationId(simulation.id)}
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{simulation.registrationNumber}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {simulation.tripReference ?? 'No trip'} ·{' '}
                          {formatDistanceKm(simulation.routeDistanceKm)} route
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {simulation.deviationActive ? (
                          <Badge variant="destructive" size="sm">
                            Deviating
                          </Badge>
                        ) : null}
                        <StatusBadge status={simulation.status} size="sm" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <AnimatedBar
                        value={simulation.progressPercent}
                        height="h-2"
                        barClassName={cn(
                          simulation.status === 'RUNNING'
                            ? 'bg-gradient-to-r from-primary to-accent'
                            : 'bg-muted-foreground/40',
                        )}
                      />
                      <div className="flex justify-between text-2xs text-muted-foreground">
                        <span className="tabular">
                          {simulation.progressPercent}% · {simulation.speedMultiplier}× ·{' '}
                          {formatSpeedKph(live?.speedKph ?? simulation.baseSpeedKph)}
                        </span>
                        <span className="tabular">
                          {formatDistanceKm(simulation.progressMeters / 1000)}
                        </span>
                      </div>
                    </div>

                    <div
                      className="flex flex-wrap gap-1.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {simulation.status === 'RUNNING' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => control.mutate({ id: simulation.id, action: 'PAUSE' })}
                        >
                          <Pause className="size-4" />
                          Pause
                        </Button>
                      ) : simulation.status === 'PAUSED' ? (
                        <Button
                          size="sm"
                          onClick={() => control.mutate({ id: simulation.id, action: 'RESUME' })}
                        >
                          <Play className="size-4" />
                          Resume
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => control.mutate({ id: simulation.id, action: 'STOP' })}
                      >
                        <Square className="size-4" />
                        Stop
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => control.mutate({ id: simulation.id, action: 'RESET' })}
                      >
                        <RotateCcw className="size-4" />
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        variant={simulation.deviationActive ? 'destructive' : 'outline'}
                        onClick={() =>
                          tune.mutate({
                            id: simulation.id,
                            body: { deviate: !simulation.deviationActive },
                          })
                        }
                      >
                        <TriangleAlert className="size-4" />
                        {simulation.deviationActive ? 'End deviation' : 'Deviate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          tune.mutate({ id: simulation.id, body: { delayMinutes: 20 } })
                        }
                      >
                        <Timer className="size-4" />
                        +20 min delay
                      </Button>
                    </div>

                    {/* Speed adjustment while running — the most-used demo control. */}
                    <div
                      className="flex items-center gap-1.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Zap className="size-3.5 shrink-0 text-muted-foreground" />
                      {SPEED_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() =>
                            tune.mutate({
                              id: simulation.id,
                              body: { speedMultiplier: Number(preset) },
                            })
                          }
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-2xs font-medium transition-colors',
                            String(simulation.speedMultiplier) === preset
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-secondary',
                          )}
                        >
                          {preset}×
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}

export default SimulatorPage;
