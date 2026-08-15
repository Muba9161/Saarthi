import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { Feature, NEARBY_CATEGORIES, Permission, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { NearbyPlaceResult } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, FeatureLockedState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FleetMap, type MapMarkerPoint } from '@/features/maps/fleet-map';

/** Driver-safety POIs around a point: fuel, food, workshops, hospitals, police. */
export function NearbyPage() {
  const { can, hasFeature } = useAuth();
  const [latitude, setLatitude] = React.useState(28.4595);
  const [longitude, setLongitude] = React.useState(77.0266);
  const [category, setCategory] = React.useState<string | null>(null);
  const [radiusKm, setRadiusKm] = React.useState(25);

  const places = useQuery({
    queryKey: ['nearby', latitude, longitude, category, radiusKm],
    queryFn: () => api.get<NearbyPlaceResult[]>('/nearby/places', { latitude, longitude, radiusKm, ...(category ? { category } : {}) }),
    enabled: can(Permission.NEARBY_READ) && hasFeature(Feature.NEARBY_SERVICES),
  });

  const useMyLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (position) => { setLatitude(position.coords.latitude); setLongitude(position.coords.longitude); },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  if (!can(Permission.NEARBY_READ)) return <UnauthorizedState />;
  if (!hasFeature(Feature.NEARBY_SERVICES)) {
    return (<div className="space-y-5"><PageHeader title="Nearby services" /><FeatureLockedState feature="Nearby services" requiredPlan="Pro" /></div>);
  }

  const markers: MapMarkerPoint[] = (places.data ?? []).map((place) => ({
    id: place.id, latitude: place.latitude, longitude: place.longitude,
    label: `${place.name} · ${place.distanceKm} km`, kind: 'place',
  }));

  return (
    <div className="space-y-5">
      <PageHeader title="Nearby services" description="Fuel, food, workshops, parking and emergency help along the route." />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5"><Label>Latitude</Label><Input type="number" step="0.0001" value={latitude} onChange={(event) => setLatitude(Number(event.target.value))} className="w-36" /></div>
          <div className="space-y-1.5"><Label>Longitude</Label><Input type="number" step="0.0001" value={longitude} onChange={(event) => setLongitude(Number(event.target.value))} className="w-36" /></div>
          <div className="space-y-1.5"><Label>Radius (km)</Label><Input type="number" min={1} max={200} value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))} className="w-28" /></div>
          <Button variant="outline" onClick={useMyLocation}><MapPin className="size-4" />Use my location</Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={category === null ? 'default' : 'outline'} onClick={() => setCategory(null)}>All</Button>
        {NEARBY_CATEGORIES.map((entry) => (
          <Button key={entry} size="sm" variant={category === entry ? 'default' : 'outline'} onClick={() => setCategory(entry)}>{humanizeEnum(entry)}</Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {places.isLoading ? <LoadingState /> : (places.data ?? []).length === 0 ? (
            <EmptyState icon={MapPin} title="Nothing found nearby" description="Widen the radius or choose another category." />
          ) : (places.data ?? []).map((place) => (
            <Card key={place.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{place.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{place.address ?? humanizeEnum(place.category)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-medium">{place.distanceKm} km</p>
                  <p className="text-xs text-muted-foreground">{place.direction}</p>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Badge variant="secondary" size="sm">{humanizeEnum(place.category)}</Badge>
                {place.open24Hours ? <Badge variant="success" size="sm">Open 24h</Badge> : null}
                {place.rating ? <Badge variant="muted" size="sm">★ {place.rating}</Badge> : null}
              </div>
            </Card>
          ))}
        </div>
        <FleetMap markers={markers} height="560px" />
      </div>
    </div>
  );
}

export default NearbyPage;
