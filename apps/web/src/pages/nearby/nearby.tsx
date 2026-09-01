import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Crosshair,
  Fuel,
  LocateFixed,
  MapPin,
  Route as RouteIcon,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  Feature,
  NEARBY_CATEGORIES,
  PETROL_FUEL_FILTERS,
  Permission,
  distanceKm,
  humanizeEnum,
  type LatLng,
  type PetrolFuelFilter,
  type PetrolStation,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { NearbyPlaceResult } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import {
  EmptyState,
  ErrorState,
  FeatureLockedState,
  LoadingState,
  UnauthorizedState,
} from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FleetMap, type MapMarkerPoint } from '@/features/maps/fleet-map';
import { isRoutingConfigured } from '@/features/maps/map-config';
import { useDeviceLocation } from '@/features/maps/use-device-location';
import { usePetrolStations } from '@/features/petrol-stations/use-petrol-stations';
import { useCityFuelRate } from '@/features/petrol-stations/use-city-fuel-rate';
import {
  PetrolStationCard,
  PetrolStationListHeader,
} from '@/features/petrol-stations/petrol-station-card';

/**
 * Driver-safety POIs around a point: fuel, food, workshops, hospitals, police.
 *
 * The screen answers "what is around me", so it takes the device's position on
 * open and then keeps tracking it — an answer about somewhere the driver is not
 * is not a partial answer, it is a wrong one. The coordinate fields stay, and
 * editing one pins the search to that point until "Use my location" releases it,
 * which is what an operator planning ahead for a truck elsewhere needs.
 *
 * Petrol stations come from the external fuel directory and are drawn as an
 * additional layer on the same map — the existing POI markers, camera and
 * controls are untouched.
 */

/** Where the map starts before the first fix — Gurugram, on NH 48. */
const FALLBACK_POINT: LatLng = { latitude: 28.4595, longitude: 77.0266 };

/**
 * How far the driver must move before the *searches* are re-run.
 *
 * The map marker and the guidance follow every fix, but a directory query per
 * GPS tick would spend the day's quota in an hour and reorder the list under the
 * driver's thumb. Half a kilometre is finer than any radius the screen offers.
 */
const SEARCH_MOVE_THRESHOLD_KM = 0.5;

/**
 * The first number from a directory phone field, ready for a `tel:` link.
 *
 * OpenStreetMap allows several numbers in one tag, separated by semicolons or
 * commas. Handing the whole string to `tel:` produces a link that dials nothing,
 * so the first number is taken and the rest dropped — one number that works
 * beats four that do not.
 */
function dialablePhone(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(/[;,]/)[0]?.trim();
  return first && /\d/.test(first) ? first : null;
}

export function NearbyPage() {
  const { can, hasFeature } = useAuth();
  const allowed = can(Permission.NEARBY_READ) && hasFeature(Feature.NEARBY_SERVICES);

  /** The point the lists are searched around. */
  const [searchPoint, setSearchPoint] = React.useState<LatLng>(FALLBACK_POINT);
  /**
   * True once the operator has typed a coordinate. Live fixes stop moving the
   * search point, but tracking itself continues — the map still shows where the
   * driver is, and guidance still measures progress from it.
   */
  const [pinned, setPinned] = React.useState(false);
  const [category, setCategory] = React.useState<string | null>(null);
  const [radiusKm, setRadiusKm] = React.useState(25);
  const [showStations, setShowStations] = React.useState(false);
  const [fuelType, setFuelType] = React.useState<PetrolFuelFilter | null>(null);
  const [selectedStationId, setSelectedStationId] = React.useState<string | null>(null);
  /**
   * The active route: the station being driven to, plus the origin the route was
   * computed from.
   *
   * The origin is frozen on purpose. Re-routing from the live position on every
   * fix would spend a routing request every few metres and rebuild the line
   * under the driver; instead the position is matched *against* this route, which
   * is what makes the distance count down and the covered stretch grey out. If
   * the driver leaves it, the navigation hook reroutes from where they actually
   * are.
   */
  const [routePlan, setRoutePlan] = React.useState<{
    origin: LatLng;
    station: PetrolStation;
  } | null>(null);

  const location = useDeviceLocation({ enabled: allowed });

  /**
   * Adopt the device position on the first fix, and again whenever the driver
   * has genuinely moved on.
   */
  React.useEffect(() => {
    const fix = location.position;
    if (!fix || pinned) return;
    setSearchPoint((current) =>
      distanceKm(current, fix) >= SEARCH_MOVE_THRESHOLD_KM || current === FALLBACK_POINT
        ? { latitude: fix.latitude, longitude: fix.longitude }
        : current,
    );
  }, [location.position, pinned]);

  const places = useQuery({
    queryKey: [
      'nearby',
      // Rounded to ~1 km, matching the server's own cache key, so a small
      // movement re-uses the cached answer instead of billing a fresh search.
      searchPoint.latitude.toFixed(2),
      searchPoint.longitude.toFixed(2),
      category,
      radiusKm,
    ],
    queryFn: () =>
      api.get<NearbyPlaceResult[]>('/nearby/places', {
        latitude: searchPoint.latitude,
        longitude: searchPoint.longitude,
        radiusKm,
        ...(category ? { category } : {}),
      }),
    enabled: allowed,
    staleTime: 5 * 60_000,
  });

  // The fuel directory searches in whole kilometres and caps at 50.
  const stationsQuery = usePetrolStations({
    latitude: searchPoint.latitude,
    longitude: searchPoint.longitude,
    radiusKm: Math.min(50, Math.max(1, Math.round(radiusKm))),
    fuelType,
    enabled: allowed && showStations,
  });

  /**
   * The city these results sit in, taken from the nearest station.
   *
   * The station directory already names the city, so the fuel rate is looked up
   * from that rather than reverse-geocoding the search point again. The nearest
   * station is used because it is the one a driver would actually reach.
   */
  const nearestCity = stationsQuery.data?.stations.find((station) => station.city)?.city ?? null;
  const nearestState = stationsQuery.data?.stations.find((station) => station.state)?.state ?? null;

  const fuelRateQuery = useCityFuelRate({
    city: nearestCity,
    state: nearestState,
    enabled: allowed && showStations,
  });

  // Leaving the station layer takes the station route with it.
  React.useEffect(() => {
    if (!showStations) setRoutePlan(null);
  }, [showStations]);

  const useMyLocation = (): void => {
    setPinned(false);
    const fix = location.position;
    if (fix) setSearchPoint({ latitude: fix.latitude, longitude: fix.longitude });
    // Restart the watch too: a permission granted after the first refusal, or a
    // stopped watch, only comes back on a fresh request.
    location.start();
  };

  /**
   * Move the search point by hand.
   *
   * A route drawn from a point the operator has since moved is misleading, so it
   * is dropped rather than left pointing at the wrong origin.
   */
  const setPointByHand = (patch: Partial<LatLng>): void => {
    setPinned(true);
    setRoutePlan(null);
    setSearchPoint((current) => ({ ...current, ...patch }));
  };

  if (!can(Permission.NEARBY_READ)) return <UnauthorizedState />;
  if (!hasFeature(Feature.NEARBY_SERVICES)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Nearby services" />
        <FeatureLockedState feature="Nearby services" requiredPlan="Pro" />
      </div>
    );
  }

  const markers: MapMarkerPoint[] = (places.data ?? []).map((place) => ({
    id: place.id,
    latitude: place.latitude,
    longitude: place.longitude,
    label: `${place.name} · ${place.distanceKm} km`,
    kind: 'place',
  }));

  const stations = showStations ? (stationsQuery.data?.stations ?? []) : [];

  // Routing happens in-page against the map already on screen. Without an ORS
  // key there is nothing to route with, so the card keeps its external link
  // rather than offering a button that cannot work.
  const canRouteInMap = isRoutingConfigured;
  const routeWaypoints = routePlan
    ? [
        routePlan.origin,
        { latitude: routePlan.station.latitude, longitude: routePlan.station.longitude },
      ]
    : undefined;

  const showLocationNotice =
    !pinned && (location.status === 'denied' || location.status === 'unsupported');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nearby services"
        description="Fuel, food, workshops, parking and emergency help along the route."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label>Latitude</Label>
            <Input
              type="number"
              step="0.0001"
              value={searchPoint.latitude}
              onChange={(event) => setPointByHand({ latitude: Number(event.target.value) })}
              className="w-36"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Longitude</Label>
            <Input
              type="number"
              step="0.0001"
              value={searchPoint.longitude}
              onChange={(event) => setPointByHand({ longitude: Number(event.target.value) })}
              className="w-36"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Radius (km)</Label>
            <Input
              type="number"
              min={1}
              max={200}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className="w-28"
            />
          </div>
          <Button
            variant={!pinned && location.tracking ? 'default' : 'outline'}
            onClick={useMyLocation}
            aria-pressed={!pinned && location.tracking}
            title="Follow this device's position"
          >
            {!pinned && location.status === 'tracking' ? (
              <LocateFixed className="size-4" />
            ) : (
              <Crosshair className="size-4" />
            )}
            {pinned
              ? 'Use my location'
              : location.status === 'locating'
                ? 'Locating…'
                : location.status === 'tracking'
                  ? 'Live'
                  : 'Use my location'}
          </Button>
          <Button
            variant={showStations ? 'default' : 'outline'}
            onClick={() => setShowStations((previous) => !previous)}
            aria-pressed={showStations}
          >
            <Fuel className="size-4" />
            Petrol stations
          </Button>

          {/* Say plainly which point the lists describe. A driver acting on a
              distance has to know what it is measured from. */}
          <p className="basis-full text-xs text-muted-foreground">
            {pinned ? (
              <>
                Searching a pinned point. Press <span className="font-medium">Use my location</span>{' '}
                to follow this device again.
              </>
            ) : location.status === 'tracking' ? (
              <>
                Following this device
                {location.position?.accuracyMeters
                  ? ` · accurate to about ${Math.round(location.position.accuracyMeters)} m`
                  : ''}
                .
              </>
            ) : location.status === 'locating' ? (
              'Waiting for a position fix from this device…'
            ) : (
              'Searching the default point until a position fix arrives.'
            )}
          </p>
        </CardContent>
      </Card>

      {showLocationNotice ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium">Showing results for the default point</p>
            <p className="text-xs text-muted-foreground">
              {location.error ??
                'This device would not share its location, so these distances are not measured from where you are.'}
            </p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={useMyLocation}>
            Try again
          </Button>
        </div>
      ) : null}

      {showStations ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Fuel:</span>
          <Button
            size="sm"
            variant={fuelType === null ? 'default' : 'outline'}
            onClick={() => setFuelType(null)}
          >
            Any
          </Button>
          {PETROL_FUEL_FILTERS.map((entry) => (
            <Button
              key={entry}
              size="sm"
              variant={fuelType === entry ? 'default' : 'outline'}
              onClick={() => setFuelType(entry)}
            >
              {entry === 'cng' ? 'CNG' : humanizeEnum(entry)}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant={category === null ? 'default' : 'outline'}
            onClick={() => setCategory(null)}
          >
            All
          </Button>
          {NEARBY_CATEGORIES.map((entry) => (
            <Button
              key={entry}
              size="sm"
              variant={category === entry ? 'default' : 'outline'}
              onClick={() => setCategory(entry)}
            >
              {humanizeEnum(entry)}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {showStations ? (
            stationsQuery.isLoading ? (
              <LoadingState label="Finding nearby petrol stations…" />
            ) : stationsQuery.error ? (
              <ErrorState
                error={stationsQuery.error}
                onRetry={() => void stationsQuery.refetch()}
              />
            ) : stations.length === 0 ? (
              <EmptyState
                icon={Fuel}
                title="No petrol stations found in this area"
                description="Widen the radius or move the search point closer to a highway."
              />
            ) : (
              <>
                <PetrolStationListHeader
                  count={stations.length}
                  stale={stationsQuery.data?.stale ?? false}
                  rate={fuelRateQuery.data ?? null}
                  rateLoading={fuelRateQuery.isLoading}
                />
                {stations.map((station) => (
                  <PetrolStationCard
                    key={station.id}
                    station={station}
                    selected={selectedStationId === station.id}
                    onSelect={setSelectedStationId}
                    onShowRoute={
                      canRouteInMap
                        ? (target) => {
                            setSelectedStationId(target.id);
                            setRoutePlan({
                              // Route from where the driver is now when that is
                              // known, so the first instruction applies to them.
                              origin: location.position && !pinned
                                ? {
                                    latitude: location.position.latitude,
                                    longitude: location.position.longitude,
                                  }
                                : searchPoint,
                              station: target,
                            });
                          }
                        : undefined
                    }
                    onClearRoute={() => setRoutePlan(null)}
                    routeActive={routePlan?.station.id === station.id}
                  />
                ))}
              </>
            )
          ) : places.isLoading ? (
            <LoadingState />
          ) : places.error ? (
            <ErrorState error={places.error} onRetry={() => void places.refetch()} />
          ) : (places.data ?? []).length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Nothing found nearby"
              description="Widen the radius or choose another category."
            />
          ) : (
            <>
              <NearbyListHeader places={places.data ?? []} />
              {(places.data ?? []).map((place) => (
                <Card key={place.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{place.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {place.address ?? humanizeEnum(place.category)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-medium">{place.distanceKm} km</p>
                      <p className="text-xs text-muted-foreground">{place.direction}</p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" size="sm">
                      {humanizeEnum(place.category)}
                    </Badge>
                    {place.open24Hours ? (
                      <Badge variant="success" size="sm">
                        Open 24h
                      </Badge>
                    ) : place.openingHours ? (
                      // OSM opening-hours strings run long ("Mo, We-Su
                      // 12:30-15:30,19:00-23:00"); the full value stays in the
                      // tooltip rather than breaking the card.
                      <Badge
                        variant="muted"
                        size="sm"
                        className="max-w-[11rem] truncate"
                        title={place.openingHours}
                      >
                        {place.openingHours}
                      </Badge>
                    ) : null}
                    {place.rating ? (
                      <Badge variant="muted" size="sm">
                        ★ {place.rating}
                      </Badge>
                    ) : null}
                    {dialablePhone(place.phone) ? (
                      <a
                        href={`tel:${dialablePhone(place.phone)}`}
                        className="text-2xs text-primary underline-offset-2 hover:underline"
                      >
                        {dialablePhone(place.phone)}
                      </a>
                    ) : null}
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>

        <div className="space-y-2">
          {routePlan ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="min-w-0 truncate text-xs">
                <RouteIcon className="mr-1.5 inline size-3.5 text-primary" />
                Route to{' '}
                <span className="font-medium">
                  {routePlan.station.name ?? 'the selected station'}
                </span>
              </p>
              <Button size="sm" variant="ghost" onClick={() => setRoutePlan(null)}>
                <X className="size-3.5" />
                Clear
              </Button>
            </div>
          ) : null}

          <FleetMap
            markers={markers}
            stations={stations}
            selectedStationId={selectedStationId}
            onSelectStation={setSelectedStationId}
            livePosition={pinned ? null : location.position}
            // A hand-typed coordinate has to move the map, or the list and the
            // map describe different places. The same applies when this device
            // will not share its location: the map must still show the point the
            // list describes. While a live fix is driving the camera, the follow
            // logic owns it instead.
            focusPoint={pinned || !location.position ? searchPoint : null}
            // The screen is about where the driver is, so the camera stays on
            // them until they pan away or ask for the overview.
            defaultCameraMode="follow"
            allow3D={hasFeature(Feature.MAPS_3D)}
            showSearch
            height="560px"
            navigation={Boolean(routeWaypoints)}
            navigationWaypoints={routeWaypoints}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Source credit for the places list.
 *
 * OpenStreetMap data is ODbL-licensed and must be credited wherever it is shown;
 * the basemap credit at the foot of the map does not cover a list rendered
 * beside it. The line also tells an operator whether they are looking at live
 * survey data or at Saarthi's own corridor dataset, which is worth knowing
 * before acting on a phone number.
 */
function NearbyListHeader({ places }: { places: NearbyPlaceResult[] }) {
  const sources = new Set(places.map((place) => place.source));
  const stale = places.some((place) => place.stale);

  return (
    <div className="space-y-1 px-1 pb-1">
      <p className="text-xs font-medium">
        {places.length} {places.length === 1 ? 'place' : 'places'} nearby
      </p>
      <p className="text-2xs text-muted-foreground">
        {sources.has('osm') ? 'Places from OpenStreetMap contributors. ' : ''}
        {sources.has('local') ? 'Includes Saarthi’s own corridor dataset. ' : ''}
        {stale ? 'The directory could not be reached, so this is the last known list.' : ''}
      </p>
    </div>
  );
}

export default NearbyPage;
