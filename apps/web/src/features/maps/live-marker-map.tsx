import * as React from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, MapPinOff } from 'lucide-react';
import { useReducedMotion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';
import { DEFAULT_STYLE_ID, resolveStyleUrl } from './map-config';
import { buildTruckElement, paintTruckElement, type MapTruck } from './map-markers';

/**
 * One moving point on a map, and nothing else.
 *
 * For public pages that follow a single live position — the "share my ride"
 * link family open from WhatsApp. `FleetMap` could draw it, but it carries
 * terrain, 3D lighting, routing, place search and turn-by-turn guidance, and
 * this is opened on a phone, often on mobile data. Same basemap, same vehicle
 * marker, none of the rest.
 *
 * The camera follows the point until the viewer drags the map; from then on
 * it stays where they put it, and a re-centre button brings it back.
 */

export interface LiveMarkerPosition {
  latitude: number;
  longitude: number;
  heading: number | null;
  speedKph: number | null;
}

export interface LiveMarkerMapProps {
  position: LiveMarkerPosition;
  /** Accessible name for the map, e.g. whose position it shows. */
  label: string;
  className?: string;
}

/** Street level — close enough to read the road names around the vehicle. */
const FOLLOW_ZOOM = 15;
const EASE_MS = 700;

export function LiveMarkerMap({ position, label, className }: LiveMarkerMapProps) {
  const t = useT();
  const reducedMotion = useReducedMotion() ?? false;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markerRef = React.useRef<maplibregl.Marker | null>(null);
  const [following, setFollowing] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  const { latitude, longitude, heading, speedKph } = position;
  // The constructor needs a centre once; every later fix moves the marker.
  const initialCentre = React.useRef<[number, number]>([longitude, latitude]);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: resolveStyleUrl(DEFAULT_STYLE_ID),
        center: initialCentre.current,
        zoom: FOLLOW_ZOOM,
        attributionControl: false,
        // Flat and north-up: a turned or tilted map only confuses on a phone.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      // No WebGL — an old handset or a locked-down in-app browser.
      setFailed(true);
      return undefined;
    }

    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // The basemap's own credit, required by OpenFreeMap.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('error', (event) => {
      // Tile hiccups are transient; only a basemap that never loaded is a failure.
      const message = event.error?.message ?? '';
      if (/failed to fetch|style|NetworkError/i.test(message) && !map.isStyleLoaded()) {
        setFailed(true);
      }
    });
    // A drag is the viewer choosing where to look; stop pulling the camera back.
    map.on('dragstart', () => setFollowing(false));

    const element = buildTruckElement();
    element.style.cursor = 'default';
    // The map's own label says whose position this is; the marker adds nothing.
    element.setAttribute('aria-hidden', 'true');
    markerRef.current = new maplibregl.Marker({
      element,
      // The arrow points along the true heading however the map is turned.
      rotationAlignment: 'map',
      pitchAlignment: 'viewport',
      opacityWhenCovered: '1',
    })
      .setLngLat(initialCentre.current)
      .addTo(map);
    mapRef.current = map;

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const point: MapTruck = {
      id: 'live',
      registrationNumber: '',
      latitude,
      longitude,
      heading,
      speedKph,
      status: 'ON_TRIP',
    };
    marker.setLngLat([longitude, latitude]).setRotation(heading ?? 0);
    // No CSS glide: while following, the camera moves with each fix, and a
    // smoothed marker visibly lags a moving camera.
    paintTruckElement(marker.getElement(), point, false, false);

    if (following) {
      map.easeTo({ center: [longitude, latitude], duration: reducedMotion ? 0 : EASE_MS });
    }
  }, [latitude, longitude, heading, speedKph, following, reducedMotion]);

  const recentre = (): void => {
    mapRef.current?.easeTo({
      center: [longitude, latitude],
      zoom: FOLLOW_ZOOM,
      duration: reducedMotion ? 0 : EASE_MS,
    });
    setFollowing(true);
  };

  return (
    <div role="region" aria-label={label} className={cn('relative overflow-hidden bg-muted', className)}>
      <div ref={containerRef} className="absolute inset-0" />

      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-6 text-center">
          <MapPinOff className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {t('The map could not load on this device.')}
          </p>
        </div>
      ) : null}

      {!following && !failed ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={recentre}
          className="absolute bottom-3 left-3 shadow-md"
        >
          <LocateFixed className="size-4" aria-hidden />
          {t('Re-centre map')}
        </Button>
      ) : null}
    </div>
  );
}
