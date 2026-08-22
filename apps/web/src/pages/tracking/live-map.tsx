import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Radio, Search, Truck } from 'lucide-react';
import {
  Feature,
  RealtimeChannel,
  RealtimeEvent,
  compassDirection,
  formatSpeedKph,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { LiveTruckPosition } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { useChannels, useRealtime, useRealtimeEvent } from '@/hooks/use-realtime';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge, StatusDot } from '@/components/common/status-badge';
import { EmptyState, ErrorState, FeatureLockedState, LoadingState } from '@/components/common/states';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FleetMap, type MapTruck } from '@/features/maps/fleet-map';
import { cn } from '@/lib/utils';

/**
 * Live fleet map. Positions are seeded by a REST read, then kept current by
 * `truck.location` pushes so markers move continuously without polling.
 */
export function LiveMapPage() {
  const { session, hasFeature } = useAuth();
  const navigate = useNavigate();
  const { connected } = useRealtime();
  const organizationId = session?.organization?.id;
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);

  useChannels(organizationId ? [RealtimeChannel.fleet(organizationId)] : []);

  const positions = useQuery({
    queryKey: ['tracking', 'fleet', organizationId],
    queryFn: () => api.get<LiveTruckPosition[]>('/tracking/fleet'),
    enabled: Boolean(organizationId),
    refetchInterval: 60_000,
  });

  const [live, setLive] = React.useState<Map<string, LiveTruckPosition>>(new Map());

  React.useEffect(() => {
    if (!positions.data) return;
    setLive(new Map(positions.data.map((entry) => [entry.truckId, entry])));
  }, [positions.data]);

  useRealtimeEvent(RealtimeEvent.TRUCK_LOCATION, (message) => {
    setLive((previous) => {
      const existing = previous.get(message.payload.truckId);
      if (!existing) return previous;
      const next = new Map(previous);
      next.set(message.payload.truckId, {
        ...existing,
        latitude: message.payload.latitude,
        longitude: message.payload.longitude,
        speedKph: message.payload.speedKph,
        heading: message.payload.heading,
        recordedAt: message.payload.recordedAt,
        stale: false,
      });
      return next;
    });
  });

  useRealtimeEvent(RealtimeEvent.TRUCK_STATUS, (message) => {
    setLive((previous) => {
      const existing = previous.get(message.payload.truckId);
      if (!existing) return previous;
      const next = new Map(previous);
      next.set(message.payload.truckId, { ...existing, status: message.payload.status });
      return next;
    });
  });

  if (!hasFeature(Feature.TRACKING_LIVE)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Live map" />
        <FeatureLockedState feature="Live tracking" requiredPlan="Basic" />
      </div>
    );
  }

  const all = [...live.values()];
  const filtered = search
    ? all.filter(
        (position) =>
          position.registrationNumber.toLowerCase().includes(search.toLowerCase()) ||
          position.driver?.name.toLowerCase().includes(search.toLowerCase()),
      )
    : all;

  const mapTrucks: MapTruck[] = filtered.map((position) => ({
    id: position.truckId,
    registrationNumber: position.registrationNumber,
    latitude: position.latitude,
    longitude: position.longitude,
    heading: position.heading,
    speedKph: position.speedKph,
    status: position.status,
    driverName: position.driver?.name ?? null,
    tripReference: position.trip?.reference ?? null,
    stale: position.stale,
    simulated: session?.demoMode ?? false,
  }));

  const moving = all.filter((position) => (position.speedKph ?? 0) > 3).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations"
        title="Live map"
        description={`${all.length} truck${all.length === 1 ? '' : 's'} reporting · ${moving} moving now`}
        actions={
          <Badge variant={connected ? 'success' : 'muted'} className="gap-1.5">
            {connected ? <span className="live-dot" aria-hidden /> : <Radio className="size-3" />}
            {connected ? 'Live' : 'Reconnecting…'}
          </Badge>
        }
      />

      {session?.demoMode ? (
        <p className="glass rounded-lg px-3 py-2 text-xs text-muted-foreground">
          Demo mode: positions on this map are produced by the Saarthi GPS simulator, not by
          hardware trackers.
        </p>
      ) : null}

      {positions.isLoading ? (
        <LoadingState label="Loading fleet positions…" />
      ) : positions.error ? (
        <ErrorState error={positions.error} onRetry={() => void positions.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="order-2 space-y-3 lg:order-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search truck or driver…"
                className="pl-9"
                aria-label="Search trucks"
              />
            </div>

            <div className="max-h-[clamp(320px,60vh,660px)] space-y-2 overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={Truck}
                  title={all.length === 0 ? 'No positions yet' : 'No matching trucks'}
                  description={
                    all.length === 0
                      ? 'Start a trip or run the GPS simulator to see live movement.'
                      : 'Try a different registration number or driver name.'
                  }
                  className="min-h-40"
                />
              ) : (
                filtered.map((position) => (
                  <Card
                    key={position.truckId}
                    variant="glass"
                    className={cn(
                      'cursor-pointer p-3 transition-all hover:-translate-y-0.5 hover:shadow-lifted',
                      selected === position.truckId && 'ring-2 ring-primary/50 shadow-glow',
                    )}
                    onClick={() => setSelected(position.truckId)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusDot status={position.status} />
                          <span className="truncate text-sm font-medium">
                            {position.registrationNumber}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {position.driver?.name ?? 'No driver assigned'}
                        </p>
                      </div>
                      <StatusBadge status={position.status} size="sm" />
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="tabular">
                        {formatSpeedKph(position.speedKph ?? 0)} ·{' '}
                        {compassDirection(position.heading ?? 0)}
                      </span>
                      <span className={cn(position.stale && 'text-warning')}>
                        {relativeTimeFrom(position.recordedAt)}
                      </span>
                    </div>

                    {position.trip ? (
                      <button
                        type="button"
                        className="mt-2 w-full rounded-md bg-muted/60 px-2 py-1.5 text-left text-xs hover:bg-muted"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/trips/${position.trip!.id}`);
                        }}
                      >
                        <span className="font-medium">{position.trip.reference}</span>
                        <span className="tabular float-right">
                          {position.trip.progressPercent}%
                        </span>
                      </button>
                    ) : null}
                  </Card>
                ))
              )}
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <FleetMap
              trucks={mapTrucks}
              selectedTruckId={selected}
              onSelectTruck={setSelected}
              allow3D={hasFeature(Feature.MAPS_3D)}
              height="clamp(380px, 68vh, 720px)"
              showSearch
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default LiveMapPage;
