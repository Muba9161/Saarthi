import * as React from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Layers, Maximize2, Navigation } from 'lucide-react';
import { compassDirection, type LatLng } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_CAMERA, mapProvider, type MapMode } from './map-provider';

/**
 * Fleet map.
 *
 * Renders live truck positions, planned routes and travelled trails. Markers
 * are moved in place rather than recreated on every tick, so a fleet of
 * simulated trucks animates smoothly instead of flickering.
 */

export interface MapTruck {
  id: string;
  registrationNumber: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speedKph?: number | null;
  status: string;
  driverName?: string | null;
  tripReference?: string | null;
  stale?: boolean;
  simulated?: boolean;
}

export interface MapMarkerPoint {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  kind: 'origin' | 'destination' | 'place' | 'incident';
}

interface FleetMapProps {
  trucks?: MapTruck[];
  /** Planned route drawn as a dashed line. */
  route?: LatLng[];
  /** Actual travelled path drawn as a solid line. */
  trail?: LatLng[];
  markers?: MapMarkerPoint[];
  selectedTruckId?: string | null;
  onSelectTruck?: (truckId: string) => void;
  /** Show the 2D/3D switch — gated by subscription upstream. */
  allow3D?: boolean;
  className?: string;
  /** Re-frame the map whenever the content changes. */
  autoFit?: boolean;
  height?: string;
}

const STATUS_COLOURS: Record<string, string> = {
  ON_TRIP: '#1d4ed8',
  LOADING: '#0284c7',
  UNLOADING: '#0284c7',
  AVAILABLE: '#15803d',
  ASSIGNED: '#0369a1',
  IDLE: '#64748b',
  OFFLINE: '#94a3b8',
  MAINTENANCE: '#b45309',
  EMERGENCY: '#b91c1c',
  SUSPENDED: '#b91c1c',
};

function truckColour(status: string, stale?: boolean): string {
  if (stale) return '#94a3b8';
  return STATUS_COLOURS[status] ?? '#334155';
}

function buildTruckElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'saarthi-truck-marker';
  element.style.cursor = 'pointer';
  // MapLibre positions markers by writing a CSS transform. Transitioning that
  // property is what turns a sequence of discrete GPS fixes into a truck that
  // visibly glides along the road instead of teleporting between points.
  element.style.transition = 'transform 1.05s linear';
  element.style.willChange = 'transform';
  element.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;">
      <div data-halo style="position:absolute;inset:0;border-radius:9999px;opacity:.28;"></div>
      <div data-body style="position:relative;display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;border:2px solid #fff;box-shadow:0 2px 10px rgba(15,23,42,.42), 0 0 0 4px rgba(255,255,255,.28);">
        <svg data-arrow width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d="M12 2 4.5 20l7.5-4 7.5 4z" />
        </svg>
      </div>
    </div>`;
  return element;
}

function paintTruckElement(element: HTMLElement, truck: MapTruck): void {
  const colour = truckColour(truck.status, truck.stale);
  const body = element.querySelector<HTMLElement>('[data-body]');
  const halo = element.querySelector<HTMLElement>('[data-halo]');
  const arrow = element.querySelector<SVGElement>('[data-arrow]');

  if (body) body.style.background = colour;
  if (halo) {
    halo.style.background = colour;
    // Only a moving truck pulses, so the eye is drawn to live movement.
    halo.style.animation =
      (truck.speedKph ?? 0) > 3 && !truck.stale ? 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite' : 'none';
  }
  if (arrow) {
    arrow.style.transform = `rotate(${truck.heading ?? 0}deg)`;
    arrow.style.transition = 'transform .4s ease-out';
    arrow.style.opacity = (truck.speedKph ?? 0) > 3 ? '1' : '0.55';
  }
}

function popupHtml(truck: MapTruck): string {
  const escape = (value: string): string =>
    value.replace(/[<>&"]/g, (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[character] ?? character,
    );

  const rows: string[] = [];
  if (truck.driverName) rows.push(`<div>Driver: ${escape(truck.driverName)}</div>`);
  if (truck.tripReference) rows.push(`<div>Trip: ${escape(truck.tripReference)}</div>`);
  rows.push(
    `<div>${Math.round(truck.speedKph ?? 0)} km/h · ${compassDirection(truck.heading ?? 0)}</div>`,
  );
  if (truck.simulated) rows.push('<div style="color:#b45309">Simulated GPS</div>');
  if (truck.stale) rows.push('<div style="color:#b45309">Position is stale</div>');

  return `
    <div style="padding:10px 12px;font-size:12px;line-height:1.5;min-width:180px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escape(truck.registrationNumber)}</div>
      <div style="text-transform:capitalize;color:#64748b;margin-bottom:6px;">${escape(
        truck.status.replace(/_/g, ' ').toLowerCase(),
      )}</div>
      ${rows.join('')}
    </div>`;
}

export function FleetMap({
  trucks = [],
  route,
  trail,
  markers = [],
  selectedTruckId,
  onSelectTruck,
  allow3D = false,
  className,
  autoFit = true,
  height = '520px',
}: FleetMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const truckMarkers = React.useRef(new Map<string, maplibregl.Marker>());
  const pointMarkers = React.useRef(new Map<string, maplibregl.Marker>());
  const [mode, setMode] = React.useState<MapMode>('2d');
  const [ready, setReady] = React.useState(false);
  const onSelectRef = React.useRef(onSelectTruck);
  onSelectRef.current = onSelectTruck;

  // --- Initialise -------------------------------------------------------
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapProvider.buildStyle('2d'),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('load', () => setReady(true));
    mapRef.current = map;

    return () => {
      truckMarkers.current.forEach((marker) => marker.remove());
      truckMarkers.current.clear();
      pointMarkers.current.forEach((marker) => marker.remove());
      pointMarkers.current.clear();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // --- Trucks -----------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const seen = new Set<string>();

    for (const truck of trucks) {
      if (!Number.isFinite(truck.latitude) || !Number.isFinite(truck.longitude)) continue;
      seen.add(truck.id);

      const existing = truckMarkers.current.get(truck.id);
      if (existing) {
        // Move in place so the marker animates instead of blinking.
        existing.setLngLat([truck.longitude, truck.latitude]);
        paintTruckElement(existing.getElement(), truck);
        existing.getPopup()?.setHTML(popupHtml(truck));
        continue;
      }

      const element = buildTruckElement();
      paintTruckElement(element, truck);
      element.addEventListener('click', () => onSelectRef.current?.(truck.id));

      const marker = new maplibregl.Marker({ element })
        .setLngLat([truck.longitude, truck.latitude])
        .setPopup(new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(popupHtml(truck)))
        .addTo(map);

      truckMarkers.current.set(truck.id, marker);
    }

    for (const [id, marker] of truckMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        truckMarkers.current.delete(id);
      }
    }
  }, [trucks, ready]);

  // --- Static markers ----------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const colours: Record<MapMarkerPoint['kind'], string> = {
      origin: '#15803d',
      destination: '#b91c1c',
      place: '#0f2a5b',
      incident: '#dc2626',
    };

    const seen = new Set<string>();
    for (const point of markers) {
      seen.add(point.id);
      if (pointMarkers.current.has(point.id)) continue;

      const element = document.createElement('div');
      element.style.cssText = `width:14px;height:14px;border-radius:9999px;border:2.5px solid #fff;background:${colours[point.kind]};box-shadow:0 2px 5px rgba(15,23,42,.3);`;

      const marker = new maplibregl.Marker({ element })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
            `<div style="padding:8px 10px;font-size:12px;font-weight:500;">${point.label}</div>`,
          ),
        )
        .addTo(map);

      pointMarkers.current.set(point.id, marker);
    }

    for (const [id, marker] of pointMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        pointMarkers.current.delete(id);
      }
    }
  }, [markers, ready]);

  // --- Route & trail lines ----------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const upsertLine = (
      id: string,
      points: LatLng[] | undefined,
      paint: maplibregl.LineLayerSpecification['paint'],
    ): void => {
      const coordinates = (points ?? []).map(
        (point) => [point.longitude, point.latitude] as [number, number],
      );
      const data: GeoJSON.Feature<GeoJSON.LineString> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      };

      const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(data);
        return;
      }
      if (coordinates.length < 2) return;

      map.addSource(id, { type: 'geojson', data });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint,
      });
    };

    upsertLine('saarthi-route', route, {
      'line-color': '#94a3b8',
      'line-width': 3,
      'line-opacity': 0.65,
      'line-dasharray': [1.5, 2.5],
    });

    upsertLine('saarthi-trail', trail, {
      'line-color': '#4338ca',
      'line-width': 5,
      'line-opacity': 0.92,
    });
  }, [route, trail, ready]);

  // --- Camera -----------------------------------------------------------
  const fitToContent = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: [number, number][] = [
      ...trucks.map((truck) => [truck.longitude, truck.latitude] as [number, number]),
      ...(route ?? []).map((point) => [point.longitude, point.latitude] as [number, number]),
      ...(trail ?? []).map((point) => [point.longitude, point.latitude] as [number, number]),
      ...markers.map((marker) => [marker.longitude, marker.latitude] as [number, number]),
    ].filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

    if (points.length === 0) return;

    if (points.length === 1) {
      map.easeTo({ center: points[0]!, zoom: 12, duration: 700 });
      return;
    }

    const bounds = points.reduce(
      (accumulator, point) => accumulator.extend(point),
      new maplibregl.LngLatBounds(points[0]!, points[0]!),
    );
    map.fitBounds(bounds as LngLatBoundsLike, { padding: 72, maxZoom: 13, duration: 700 });
  }, [trucks, route, trail, markers]);

  // Fit once the first content arrives, not on every tick — otherwise the
  // camera would fight the user while a simulation is running.
  const hasFitted = React.useRef(false);
  React.useEffect(() => {
    if (!ready || !autoFit || hasFitted.current) return;
    const hasContent = trucks.length > 0 || (route?.length ?? 0) > 0 || markers.length > 0;
    if (!hasContent) return;
    hasFitted.current = true;
    fitToContent();
  }, [ready, autoFit, trucks.length, route?.length, markers.length, fitToContent]);

  // Follow the selected truck.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedTruckId) return;
    const truck = trucks.find((entry) => entry.id === selectedTruckId);
    if (!truck) return;
    map.easeTo({
      center: [truck.longitude, truck.latitude],
      zoom: Math.max(map.getZoom(), 11),
      duration: 900,
      easing: (t) => t * (2 - t),
    });
  }, [selectedTruckId, trucks, ready]);

  const toggleMode = (): void => {
    const map = mapRef.current;
    if (!map) return;
    const next: MapMode = mode === '2d' ? '3d' : '2d';
    setMode(next);
    map.easeTo({ ...MAP_CAMERA[next], duration: 900 });
  };

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border', className)}>
      <div ref={containerRef} style={{ height }} className="w-full" />

      <div className="absolute left-3 top-3 flex flex-col gap-1.5">
        {allow3D ? (
          <Button
            size="sm"
            variant={mode === '3d' ? 'default' : 'glass'}
            onClick={toggleMode}
            className="shadow-lifted"
          >
            {mode === '3d' ? <Box className="size-4" /> : <Layers className="size-4" />}
            {mode === '3d' ? '3D view' : '2D view'}
          </Button>
        ) : null}
        <Button size="sm" variant="glass" onClick={fitToContent} className="shadow-lifted">
          <Maximize2 className="size-4" />
          Fit
        </Button>
      </div>

      {trucks.length === 0 && !route?.length && markers.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="glass rounded-xl px-5 py-4 text-center">
            <Navigation className="mx-auto mb-1.5 size-5 text-muted-foreground" />
            <p className="text-sm font-medium">No positions to show</p>
            <p className="text-xs text-muted-foreground">
              Start a trip or the GPS simulator to see trucks move here.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
