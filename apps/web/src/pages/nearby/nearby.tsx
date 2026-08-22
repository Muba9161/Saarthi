import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fuel, MapPin } from 'lucide-react';
import {
  Feature,
  NEARBY_CATEGORIES,
  PETROL_FUEL_FILTERS,
  Permission,
  humanizeEnum,
  type PetrolFuelFilter,
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
import { usePetrolStations } from '@/features/petrol-stations/use-petrol-stations';
import {
  PetrolStationCard,
  PetrolStationListHeader,
} from '@/features/petrol-stations/petrol-station-card';

/**
 * Driver-safety POIs around a point: fuel, food, workshops, hospitals, police.
 *
 * Petrol stations come from the external fuel directory and are drawn as an
 * additional layer on the same map — the existing POI markers, camera and
 * controls are untouched.
 */
export function NearbyPage() {
  const { can, hasFeature } = useAuth();
  const [latitude, setLatitude] = React.useState(28.4595);
  const [longitude, setLongitude] = React.useState(77.0266);
  const [category, setCategory] = React.useState<string | null>(null);
  const [radiusKm, setRadiusKm] = React.useState(25);
  const [showStations, setShowStations] = React.useState(false);
  const [fuelType, setFuelType] = React.useState<PetrolFuelFilter | null>(null);
  const [selectedStationId, setSelectedStationId] = React.useState<string | null>(null);

  const allowed = can(Permission.NEARBY_READ) && hasFeature(Feature.NEARBY_SERVICES);

  const places = useQuery({
    queryKey: ['nearby', latitude, longitude, category, radiusKm],
    queryFn: () =>
      api.get<NearbyPlaceResult[]>('/nearby/places', {
        latitude,
        longitude,
        radiusKm,
        ...(category ? { category } : {}),
      }),
    enabled: allowed,
  });

  // The fuel directory searches in whole kilometres and caps at 50.
  const stationsQuery = usePetrolStations({
    latitude,
    longitude,
    radiusKm: Math.min(50, Math.max(1, Math.round(radiusKm))),
    fuelType,
    enabled: allowed && showStations,
  });

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    );
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
              value={latitude}
              onChange={(event) => setLatitude(Number(event.target.value))}
              className="w-36"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Longitude</Label>
            <Input
              type="number"
              step="0.0001"
              value={longitude}
              onChange={(event) => setLongitude(Number(event.target.value))}
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
          <Button variant="outline" onClick={useMyLocation}>
            <MapPin className="size-4" />
            Use my location
          </Button>
          <Button
            variant={showStations ? 'default' : 'outline'}
            onClick={() => setShowStations((previous) => !previous)}
            aria-pressed={showStations}
          >
            <Fuel className="size-4" />
            Petrol stations
          </Button>
        </CardContent>
      </Card>

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
                />
                {stations.map((station) => (
                  <PetrolStationCard
                    key={station.id}
                    station={station}
                    selected={selectedStationId === station.id}
                    onSelect={setSelectedStationId}
                  />
                ))}
              </>
            )
          ) : places.isLoading ? (
            <LoadingState />
          ) : (places.data ?? []).length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Nothing found nearby"
              description="Widen the radius or choose another category."
            />
          ) : (
            (places.data ?? []).map((place) => (
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
                  ) : null}
                  {place.rating ? (
                    <Badge variant="muted" size="sm">
                      ★ {place.rating}
                    </Badge>
                  ) : null}
                </div>
              </Card>
            ))
          )}
        </div>

        <FleetMap
          markers={markers}
          stations={stations}
          selectedStationId={selectedStationId}
          onSelectStation={setSelectedStationId}
          allow3D={hasFeature(Feature.MAPS_3D)}
          showSearch
          height="560px"
        />
      </div>
    </div>
  );
}

export default NearbyPage;
