import * as React from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, MapPinOff, Maximize2, Minimize2 } from 'lucide-react';
import type { TrailPoint } from '@saarthi/shared';
import { useReducedMotion } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { useT } from '@/features/i18n';
import { useElementFullscreen } from '@/hooks/use-element-fullscreen';
import { cn } from '@/lib/utils';
import { DEFAULT_STYLE_ID, resolveStyleUrl } from './map-config';
import { ensureOverlayLayers, isStyleReady, setTrailState } from './map-layers';
import { buildTruckElement, paintTruckElement, type MapTruck } from './map-markers';

/**
 * One moving point on a map, the road it has covered behind it, and nothing else.
 *
 * For public pages that follow a single live position — the "share my ride"
 * link family open from WhatsApp. `FleetMap` could draw it, but it carries
 * terrain, 3D lighting, routing, place search and turn-by-turn guidance, and
 * this is opened on a phone, often on mobile data. Same basemap, same vehicle
 * marker and the same covered-path trail, none of the rest. It opens full
 * screen on a tap, for following on a phone.
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
  /** The road covered so far, drawn in the trail's colours. */
  trail?: readonly TrailPoint[];
  className?: string;
}

/** Street level — close enough to read the road names around the vehicle. */
const FOLLOW_ZOOM = 15;
const EASE_MS = 700;

export function LiveMarkerMap({ position, label, trail, className }: LiveMarkerMapProps) {
  const t = useT();
  const reducedMotion = useReducedMotion() ?? false;
  const regionRef = React.useRef<HTMLDivElement | null>(null);
  const fullscreen = useElementFullscreen(regionRef);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // The trail as last given, for the style's first load to draw.
  const trailRef = React.useRef(trail);
  trailRef.current = trail;
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
    map.on('load', () => {
      ensureOverlayLayers(map);
      setTrailState(map, trailRef.current);
    });

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

  React.useEffect(() => {
    const map = mapRef.current;
    if (map && isStyleReady(map)) setTrailState(map, trail);
  }, [trail]);

  const recentre = (): void => {
    mapRef.current?.easeTo({
      center: [longitude, latitude],
      zoom: FOLLOW_ZOOM,
      duration: reducedMotion ? 0 : EASE_MS,
    });
    setFollowing(true);
  };

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label={label}
      className={cn(
        'relative overflow-hidden bg-muted',
        className,
        // Where the browser has no full screen for a page element (Safari on iPhone), it covers the window.
        fullscreen.mode === 'window' && 'fixed inset-0 z-[100] h-auto min-h-0 rounded-none ring-0',
      )}
    >
      {/* Sized outright, as FleetMap's is: MapLibre's own `.maplibregl-map { position: relative }`
          overrides an `absolute inset-0` here, and the map collapsed to nothing. */}
      <div ref={containerRef} className="size-full" />

      {!failed ? (
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          onClick={fullscreen.toggle}
          aria-label={fullscreen.active ? t('Exit full screen') : t('Full screen')}
          title={fullscreen.active ? t('Exit full screen') : t('Full screen')}
          className="absolute left-3 top-3 shadow-md"
        >
          {fullscreen.active ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
        </Button>
      ) : null}

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
