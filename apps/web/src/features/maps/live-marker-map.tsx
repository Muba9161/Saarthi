import * as React from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, MapPinOff, Maximize2, Minimize2 } from 'lucide-react';
import { TrackRouteState, type TrailPoint } from '@saarthi/shared';
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
  position?: LiveMarkerPosition | null;
  /** Accessible name for the map, e.g. whose position it shows. */
  label: string;
  /** The road covered so far, drawn in the trail's colours. */
  trail?: readonly TrailPoint[];
  className?: string;
  /** When 'ended', displays the static completed route with start/finish pins fitted to view */
  mode?: 'live' | 'ended';
  startPoint?: { latitude: number; longitude: number } | null;
  endPoint?: { latitude: number; longitude: number } | null;
}

/** Street level — close enough to read the road names around the vehicle. */
const FOLLOW_ZOOM = 15;
const EASE_MS = 700;

function buildStartPinElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'saarthi-start-pin';
  el.style.cursor = 'pointer';
  el.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:28px;height:28px;">
      <div style="position:absolute;inset:0;border-radius:9999px;background:#16a34a;opacity:.28;"></div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:#16a34a;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.45);">
        <div style="width:6px;height:6px;border-radius:9999px;background:#fff;"></div>
      </div>
    </div>`;
  return el;
}

function buildEndPinElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'saarthi-end-pin';
  el.style.cursor = 'pointer';
  el.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:30px;height:30px;">
      <div style="position:relative;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:8px;background:#dc2626;border:2.5px solid #fff;box-shadow:0 3px 10px rgba(15,23,42,.45);">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      </div>
    </div>`;
  return el;
}

export function LiveMarkerMap({
  position,
  label,
  trail,
  className,
  mode = 'live',
  startPoint,
  endPoint,
}: LiveMarkerMapProps) {
  const t = useT();
  const isEnded = mode === 'ended';
  const reducedMotion = useReducedMotion() ?? false;
  const regionRef = React.useRef<HTMLDivElement | null>(null);
  const fullscreen = useElementFullscreen(regionRef);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const latitude = position?.latitude ?? startPoint?.latitude ?? trail?.[0]?.latitude ?? 26.4499;
  const longitude = position?.longitude ?? startPoint?.longitude ?? trail?.[0]?.longitude ?? 80.3319;
  const heading = position?.heading ?? null;
  const speedKph = position?.speedKph ?? null;

  // Seamlessly connects the road trail to the vehicle's live position
  const continuousTrail = React.useMemo<readonly TrailPoint[]>(() => {
    if (isEnded) {
      return trail ?? [];
    }
    if (!trail || trail.length === 0) {
      return [{ latitude, longitude, routeState: TrackRouteState.NO_TRIP }];
    }
    const last = trail[trail.length - 1]!;
    const dLat = (latitude - last.latitude) * 111_132;
    const dLng = (longitude - last.longitude) * 111_132 * Math.cos((latitude * Math.PI) / 180);
    const distMeters = Math.hypot(dLat, dLng);

    // Only append if the live position has moved forward noticeably along the road (> 15m and < 1000m)
    if (distMeters >= 15 && distMeters < 1_000) {
      return [
        ...trail,
        {
          latitude,
          longitude,
          routeState: last.routeState ?? TrackRouteState.NO_TRIP,
        },
      ];
    }
    return trail;
  }, [trail, latitude, longitude, isEnded]);

  // The trail as last given, for the style's first load to draw.
  const trailRef = React.useRef(continuousTrail);
  trailRef.current = continuousTrail;
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const markerRef = React.useRef<maplibregl.Marker | null>(null);
  const startMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const endMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const [following, setFollowing] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  // The constructor needs a centre once; every later fix moves the marker.
  const initialCentre = React.useRef<[number, number]>([longitude, latitude]);

  // Tracks current animated position and rotation for butter-smooth gliding
  const animPosRef = React.useRef<{ lng: number; lat: number; heading: number }>({
    lng: longitude,
    lat: latitude,
    heading: heading ?? 0,
  });
  const animFrameRef = React.useRef<number | null>(null);

  const fitBoundsToRoute = React.useCallback(
    (map: MapLibreMap) => {
      const activeTrail = trailRef.current;
      const bounds = new maplibregl.LngLatBounds();
      if (startPoint) bounds.extend([startPoint.longitude, startPoint.latitude]);
      if (endPoint) bounds.extend([endPoint.longitude, endPoint.latitude]);
      for (const pt of activeTrail) {
        bounds.extend([pt.longitude, pt.latitude]);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 16, duration: reducedMotion ? 0 : 600 });
      }
    },
    [startPoint, endPoint, reducedMotion],
  );

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
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      setFailed(true);
      return undefined;
    }

    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('error', (event) => {
      const message = event.error?.message ?? '';
      if (/failed to fetch|style|NetworkError/i.test(message) && !map.isStyleLoaded()) {
        setFailed(true);
      }
    });
    map.on('dragstart', () => setFollowing(false));
    map.on('load', () => {
      ensureOverlayLayers(map);
      setTrailState(map, trailRef.current);
      if (isEnded) {
        fitBoundsToRoute(map);
      }
    });

    if (!isEnded) {
      const element = buildTruckElement();
      element.style.cursor = 'default';
      element.setAttribute('aria-hidden', 'true');
      markerRef.current = new maplibregl.Marker({
        element,
        rotationAlignment: 'map',
        pitchAlignment: 'viewport',
        opacityWhenCovered: '1',
      })
        .setLngLat(initialCentre.current)
        .addTo(map);
    } else {
      // In ended mode: add start and finish markers
      const firstCoord = startPoint ?? (continuousTrail[0] ? { latitude: continuousTrail[0].latitude, longitude: continuousTrail[0].longitude } : null);
      const lastCoord = endPoint ?? (continuousTrail.length > 0 ? { latitude: continuousTrail[continuousTrail.length - 1]!.latitude, longitude: continuousTrail[continuousTrail.length - 1]!.longitude } : null);

      if (firstCoord) {
        startMarkerRef.current = new maplibregl.Marker({
          element: buildStartPinElement(),
          anchor: 'center',
        })
          .setLngLat([firstCoord.longitude, firstCoord.latitude])
          .addTo(map);
      }
      if (lastCoord && (lastCoord.latitude !== firstCoord?.latitude || lastCoord.longitude !== firstCoord?.longitude)) {
        endMarkerRef.current = new maplibregl.Marker({
          element: buildEndPinElement(),
          anchor: 'center',
        })
          .setLngLat([lastCoord.longitude, lastCoord.latitude])
          .addTo(map);
      }
    }

    mapRef.current = map;

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      markerRef.current?.remove();
      markerRef.current = null;
      startMarkerRef.current?.remove();
      startMarkerRef.current = null;
      endMarkerRef.current?.remove();
      endMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [isEnded, startPoint, endPoint, fitBoundsToRoute]);

  React.useEffect(() => {
    if (isEnded) return undefined;
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
    paintTruckElement(marker.getElement(), point, false, false);

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const startLng = animPosRef.current.lng;
    const startLat = animPosRef.current.lat;
    const startHeading = animPosRef.current.heading;

    const targetLng = longitude;
    const targetLat = latitude;
    const targetHeading = heading ?? startHeading;

    const dLat = (targetLat - startLat) * 111_132;
    const dLng = (targetLng - startLng) * 111_132 * Math.cos((targetLat * Math.PI) / 180);
    const distMeters = Math.hypot(dLat, dLng);

    // Calculate shortest angular turn
    const angleDiff = ((((targetHeading - startHeading) % 360) + 540) % 360) - 180;

    // Snap immediately for reduced motion, initial setup, or teleport jumps (> 1km)
    if (reducedMotion || distMeters > 1_000 || distMeters < 0.5) {
      animPosRef.current = { lng: targetLng, lat: targetLat, heading: targetHeading };
      marker.setLngLat([targetLng, targetLat]).setRotation(targetHeading);
      if (following) {
        map.easeTo({ center: [targetLng, targetLat], duration: reducedMotion ? 0 : EASE_MS });
      }
      return;
    }

    // Smooth gliding animation over 1,400 ms (matching the 1.5s real-time streaming cycle)
    const GLIDE_DURATION_MS = 1_400;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / GLIDE_DURATION_MS);
      // Ease out cubic for a natural gliding deceleration feel
      const ease = 1 - Math.pow(1 - progress, 3);

      const curLng = startLng + (targetLng - startLng) * ease;
      const curLat = startLat + (targetLat - startLat) * ease;
      const curHeading = startHeading + angleDiff * ease;

      const m = markerRef.current;
      const mp = mapRef.current;
      if (!m || !mp) return;

      animPosRef.current = { lng: curLng, lat: curLat, heading: curHeading };
      m.setLngLat([curLng, curLat]).setRotation(curHeading);

      if (following) {
        mp.setCenter([curLng, curLat]);
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
      }
    }

    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [latitude, longitude, heading, speedKph, following, reducedMotion]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (map && isStyleReady(map)) setTrailState(map, continuousTrail);
  }, [continuousTrail]);

  const recentre = (): void => {
    const map = mapRef.current;
    if (!map) return;
    if (isEnded) {
      fitBoundsToRoute(map);
      setFollowing(true);
      return;
    }
    const cur = animPosRef.current;
    map.easeTo({
      center: [cur.lng, cur.lat],
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

      {(!following || isEnded) && !failed ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={recentre}
          className="absolute bottom-3 left-3 shadow-md"
        >
          <LocateFixed className="size-4" aria-hidden />
          {isEnded ? t('Fit route to view') : t('Re-centre map')}
        </Button>
      ) : null}
    </div>
  );
}
