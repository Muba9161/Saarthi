import * as React from 'react';
import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Crosshair, Layers, Maximize2, Navigation, Route, TriangleAlert } from 'lucide-react';
import {
  compassDirection,
  fuelOfferingLabel,
  type LatLng,
  type PetrolStation,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NavigationRoute, RoutingProfile } from './directions';
import {
  applyAtmosphere,
  applyBuildings,
  applyLabelConfig,
  ensureOverlayLayers,
  setRouteState,
  setTrailState,
} from './map-layers';
import { MapSettingsControl, type MapSettings } from './map-controls';
import { MapSearch } from './map-search';
import { NavigationPanel } from './navigation-panel';
import { useNavigation } from './use-navigation';
import {
  DEFAULT_CENTER,
  DEFAULT_STYLE_ID,
  DEFAULT_ZOOM,
  FOLLOW_CAMERA,
  MAP_CAMERA,
  MAX_PITCH,
  NAV_CAMERA,
  lightPresetForTime,
  lightingDefinition,
  resolveStyleUrl,
  styleDefinition,
  type LightPreset,
  type MapMode,
  type MapStyleId,
} from './map-config';

/**
 * Fleet map — MapLibre GL JS on open data.
 *
 * Renders live truck positions, planned and routed lines, travelled trails and
 * turn-by-turn guidance on a true 3D map: extruded buildings, real elevation and
 * a sun position that changes with the time of day.
 *
 * Two things drive the design. First, markers are moved in place rather than
 * recreated on every tick, so a fleet of trucks glides instead of flickering.
 * Second, `setStyle` wipes custom layers, so every overlay is (re)built from one
 * `style.load` handler — that is what lets the basemap be swapped at runtime
 * without losing the routes drawn on top of it.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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
  kind: 'origin' | 'destination' | 'place' | 'incident' | 'stop' | 'waypoint';
}

/** How the camera treats the focused truck. */
export type CameraMode = 'free' | 'follow' | 'chase';

export interface FleetMapProps {
  trucks?: MapTruck[];
  /** Planned route drawn as the primary line when routing is off. */
  route?: LatLng[];
  /** Actual travelled path, drawn as a gradient trail. */
  trail?: LatLng[];
  markers?: MapMarkerPoint[];
  /** Petrol stations from the fuel directory, drawn as their own marker layer. */
  stations?: PetrolStation[];
  selectedStationId?: string | null;
  onSelectStation?: (stationId: string | null) => void;
  selectedTruckId?: string | null;
  onSelectTruck?: (truckId: string) => void;
  /** Show the 2D/3D switch and default to the tilted camera — gated upstream. */
  allow3D?: boolean;
  className?: string;
  /** Re-frame the map when the first content arrives. */
  autoFit?: boolean;
  height?: string;

  // --- Navigation -------------------------------------------------------
  /** Compute a road route with turn-by-turn guidance. */
  navigation?: boolean;
  /**
   * Explicit routing waypoints. When omitted, origin/destination markers — or
   * the ends of `route` — are used. Deliberately static: the live position is
   * matched against the route rather than re-routed from, so a moving truck
   * does not spend a routing request every tick.
   */
  navigationWaypoints?: LatLng[];
  /** Defaults to the heavy-goods-vehicle profile. */
  routingProfile?: RoutingProfile;
  /** Road classes to avoid, e.g. tolls for a cost-sensitive load. */
  routingExclude?: ('toll' | 'motorway' | 'ferry' | 'unpaved')[];
  onRouteChange?: (route: NavigationRoute | null) => void;

  // --- Presentation -----------------------------------------------------
  defaultStyleId?: MapStyleId;
  defaultCameraMode?: CameraMode;
  /** `auto` follows the wall clock. */
  defaultLightPreset?: LightPreset | 'auto';
  defaultTerrain?: boolean;
  /** Show the floating control cluster. Off for thumbnail-sized maps. */
  showControls?: boolean;
  /** Show the place-search box. */
  showSearch?: boolean;
  /** Disable pan/zoom entirely — for decorative or preview tiles. */
  interactive?: boolean;
}

// ---------------------------------------------------------------------------
// Truck markers
// ---------------------------------------------------------------------------

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

function paintTruckElement(
  element: HTMLElement,
  truck: MapTruck,
  selected: boolean,
  /** MapLibre writes marker position into `transform`; smoothing it turns
   *  discrete fixes into gliding motion, but the same smoothing makes the
   *  marker lag the map while the camera itself is animating. */
  smoothMotion: boolean,
): void {
  const colour = truckColour(truck.status, truck.stale);
  const body = element.querySelector<HTMLElement>('[data-body]');
  const halo = element.querySelector<HTMLElement>('[data-halo]');
  const arrow = element.querySelector<SVGElement>('[data-arrow]');

  element.style.transition = smoothMotion ? 'transform 1.05s linear' : 'none';

  if (body) {
    body.style.background = colour;
    // The selected truck gets a heavier ring so it stays findable in a cluster.
    body.style.boxShadow = selected
      ? '0 2px 12px rgba(15,23,42,.5), 0 0 0 5px rgba(37,99,235,.45)'
      : '0 2px 10px rgba(15,23,42,.42), 0 0 0 4px rgba(255,255,255,.28)';
  }
  if (halo) {
    halo.style.background = colour;
    // Only a moving truck pulses, so the eye is drawn to live movement.
    halo.style.animation =
      (truck.speedKph ?? 0) > 3 && !truck.stale
        ? 'pulse-ring 2s cubic-bezier(.4,0,.6,1) infinite'
        : 'none';
  }
  if (arrow) {
    arrow.style.opacity = (truck.speedKph ?? 0) > 3 ? '1' : '0.55';
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[<>&"]/g,
    (character) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[character] ?? character,
  );
}

function popupHtml(truck: MapTruck): string {
  const rows: string[] = [];
  if (truck.driverName) rows.push(`<div>Driver: ${escapeHtml(truck.driverName)}</div>`);
  if (truck.tripReference) rows.push(`<div>Trip: ${escapeHtml(truck.tripReference)}</div>`);
  rows.push(
    `<div>${Math.round(truck.speedKph ?? 0)} km/h · ${compassDirection(truck.heading ?? 0)}</div>`,
  );
  if (truck.simulated) rows.push('<div style="color:#b45309">Simulated GPS</div>');
  if (truck.stale) rows.push('<div style="color:#b45309">Position is stale</div>');

  return `
    <div style="padding:10px 12px;font-size:12px;line-height:1.5;min-width:180px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${escapeHtml(
        truck.registrationNumber,
      )}</div>
      <div style="text-transform:capitalize;color:#64748b;margin-bottom:6px;">${escapeHtml(
        truck.status.replace(/_/g, ' ').toLowerCase(),
      )}</div>
      ${rows.join('')}
    </div>`;
}

const POINT_COLOURS: Record<MapMarkerPoint['kind'], string> = {
  origin: '#15803d',
  destination: '#b91c1c',
  place: '#0f2a5b',
  incident: '#dc2626',
  stop: '#0284c7',
  waypoint: '#7c3aed',
};

// ---------------------------------------------------------------------------
// Petrol stations
// ---------------------------------------------------------------------------

function buildStationElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cursor = 'pointer';
  element.innerHTML = `
    <div data-body style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;border:2px solid #fff;background:#d97706;box-shadow:0 2px 6px rgba(15,23,42,.35);transition:transform .18s ease-out;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="22" x2="15" y2="22" />
        <line x1="4" y1="9" x2="14" y2="9" />
        <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" />
        <path d="M18 22V11a3 3 0 0 0-3-3" />
      </svg>
    </div>`;
  return element;
}

function paintStationElement(element: HTMLElement, selected: boolean): void {
  const body = element.querySelector<HTMLElement>('[data-body]');
  if (!body) return;
  body.style.transform = selected ? 'scale(1.28)' : 'scale(1)';
  body.style.boxShadow = selected
    ? '0 3px 10px rgba(15,23,42,.45), 0 0 0 4px rgba(217,119,6,.35)'
    : '0 2px 6px rgba(15,23,42,.35)';
}

/**
 * Station popup.
 *
 * Mirrors the honesty rule the domain model documents: the directory says which
 * fuels a station *sells* and publishes an area rate — it reports no tank level
 * or dispenser state, so nothing here may read as live availability.
 */
function stationPopupHtml(station: PetrolStation): string {
  const price = (value: number | null): string => (value === null ? '—' : `₹${value.toFixed(2)}`);
  const row = (label: string, offered: boolean | null, value: number | null): string =>
    `<div style="display:flex;justify-content:space-between;gap:10px;">
       <span style="color:#64748b;">${label}</span>
       <span><strong>${price(value)}</strong> <span style="color:#94a3b8;">${escapeHtml(
         fuelOfferingLabel(offered),
       )}</span></span>
     </div>`;

  const place = [station.city, station.state].filter(Boolean).join(', ');

  return `
    <div style="padding:10px 12px;font-size:12px;line-height:1.55;min-width:210px;">
      ${
        station.company
          ? `<div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#b45309;">${escapeHtml(
              station.company,
            )}</div>`
          : ''
      }
      <div style="font-weight:600;font-size:13px;">${escapeHtml(station.name ?? 'Petrol station')}</div>
      <div style="color:#64748b;margin-bottom:6px;">${escapeHtml(station.address ?? place)}</div>
      ${row('Petrol', station.hasPetrol, station.petrolPrice)}
      ${row('Diesel', station.hasDiesel, station.dieselPrice)}
      ${row('CNG', station.hasCng, station.cngPrice)}
      ${
        station.timings
          ? `<div style="margin-top:6px;color:#64748b;">${escapeHtml(station.timings)}</div>`
          : ''
      }
      <div style="margin-top:6px;font-size:10px;color:#94a3b8;">Published directory rates — not a live pump reading.</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FleetMap({
  trucks = [],
  route,
  trail,
  markers = [],
  stations = [],
  selectedStationId,
  onSelectStation,
  selectedTruckId,
  onSelectTruck,
  allow3D = false,
  className,
  autoFit = true,
  height = '520px',
  navigation = false,
  navigationWaypoints,
  routingProfile = 'driving-hgv',
  routingExclude,
  onRouteChange,
  defaultStyleId = DEFAULT_STYLE_ID,
  defaultCameraMode = 'free',
  defaultLightPreset = 'auto',
  defaultTerrain = true,
  showControls = true,
  showSearch = false,
  interactive = true,
}: FleetMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<MapLibreMap | null>(null);
  const truckMarkers = React.useRef(new Map<string, maplibregl.Marker>());
  const pointMarkers = React.useRef(new Map<string, maplibregl.Marker>());
  const stationMarkers = React.useRef(new Map<string, maplibregl.Marker>());
  const searchMarker = React.useRef<maplibregl.Marker | null>(null);

  const [mode, setMode] = React.useState<MapMode>(allow3D ? '3d' : '2d');
  const [cameraMode, setCameraMode] = React.useState<CameraMode>(defaultCameraMode);
  const [settings, setSettings] = React.useState<MapSettings>({
    styleId: defaultStyleId,
    lightPreset: defaultLightPreset,
    terrain: defaultTerrain,
    buildings: true,
    labels: true,
  });
  /** Bumped on every `style.load`; data effects re-run against the new style. */
  const [styleEpoch, setStyleEpoch] = React.useState(0);
  const [initError, setInitError] = React.useState<string | null>(null);

  const ready = styleEpoch > 0;
  const activeStyle = styleDefinition(settings.styleId);

  /** The preset actually in force once `auto` is resolved against the clock. */
  const resolvedLightPreset: LightPreset =
    settings.lightPreset === 'auto' ? lightPresetForTime() : settings.lightPreset;

  // Refs so the once-registered `style.load` handler always sees current values.
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const lightRef = React.useRef(resolvedLightPreset);
  lightRef.current = resolvedLightPreset;
  const onSelectRef = React.useRef(onSelectTruck);
  onSelectRef.current = onSelectTruck;
  const onSelectStationRef = React.useRef(onSelectStation);
  onSelectStationRef.current = onSelectStation;

  // --- Navigation -------------------------------------------------------
  const focusTruck = React.useMemo(() => {
    if (selectedTruckId) return trucks.find((truck) => truck.id === selectedTruckId) ?? null;
    return trucks.length === 1 ? (trucks[0] ?? null) : null;
  }, [trucks, selectedTruckId]);

  const currentPosition = React.useMemo<LatLng | null>(
    () => (focusTruck ? { latitude: focusTruck.latitude, longitude: focusTruck.longitude } : null),
    [focusTruck],
  );

  const derivedWaypoints = React.useMemo<LatLng[] | undefined>(() => {
    if (navigationWaypoints && navigationWaypoints.length >= 2) return navigationWaypoints;
    if (!navigation) return undefined;

    const origin = markers.find((marker) => marker.kind === 'origin');
    const destination = markers.find((marker) => marker.kind === 'destination');
    const first = origin ? { latitude: origin.latitude, longitude: origin.longitude } : route?.[0];
    const last = destination
      ? { latitude: destination.latitude, longitude: destination.longitude }
      : route?.[route.length - 1];

    return first && last ? [first, last] : undefined;
  }, [navigation, navigationWaypoints, markers, route]);

  const navigationState = useNavigation({
    waypoints: derivedWaypoints,
    enabled: navigation,
    profile: routingProfile,
    ...(routingExclude ? { exclude: routingExclude } : {}),
    currentPosition,
  });

  const routedRoute = navigationState.route;
  const routeChangeRef = React.useRef(onRouteChange);
  routeChangeRef.current = onRouteChange;
  React.useEffect(() => {
    routeChangeRef.current?.(routedRoute);
  }, [routedRoute]);

  // --- Style feature application ----------------------------------------
  /**
   * Re-applies everything Saarthi adds on top of the basemap. Called from
   * `style.load`, which fires both on first load and after every `setStyle`.
   */
  const applyStyleFeatures = React.useCallback((map: MapLibreMap) => {
    const current = settingsRef.current;
    ensureOverlayLayers(map);
    applyAtmosphere(map, {
      terrain: current.terrain,
      lightPreset: lightRef.current,
      threeD: modeRef.current === '3d',
    });
    applyBuildings(map, styleDefinition(current.styleId), current.buildings);
    applyLabelConfig(map, current.labels);
  }, []);

  // --- Initialise --------------------------------------------------------
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: resolveStyleUrl(settingsRef.current.styleId),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: MAP_CAMERA[modeRef.current].pitch,
        bearing: MAP_CAMERA[modeRef.current].bearing,
        maxPitch: MAX_PITCH,
        attributionControl: false,
        interactive,
        // Antialiasing is what keeps extruded-building edges from crawling.
        canvasContextAttributes: { antialias: true },
      });
    } catch (error) {
      setInitError(
        error instanceof Error ? error.message : 'This browser could not start a WebGL map.',
      );
      return undefined;
    }

    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserLocation: true,
        }),
        'top-right',
      );
      map.addControl(new maplibregl.FullscreenControl(), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
    }
    // The OpenFreeMap style already declares its own attribution; adding ours
    // as well printed the same credit twice along the bottom of the map.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // `style.load` fires again after every setStyle — the only safe place to
    // (re)build custom sources and layers.
    map.on('style.load', () => {
      applyStyleFeatures(map);
      setStyleEpoch((epoch) => epoch + 1);
    });

    map.on('error', (event) => {
      // Tile hiccups are transient; only surface a hard style failure.
      const message = event.error?.message ?? '';
      if (/failed to fetch|style|NetworkError/i.test(message) && !mapRef.current?.isStyleLoaded()) {
        setInitError('Could not load the basemap. Check your network connection.');
      }
    });

    // A deliberate gesture releases the camera, so auto-follow never fights the
    // operator. Listening on the canvas rather than on camera events is what
    // distinguishes real input from our own programmatic `easeTo` calls.
    const canvas = map.getCanvasContainer();
    const release = (): void => setCameraMode('free');
    canvas.addEventListener('mousedown', release);
    canvas.addEventListener('touchstart', release, { passive: true });
    canvas.addEventListener('wheel', release, { passive: true });

    mapRef.current = map;

    return () => {
      canvas.removeEventListener('mousedown', release);
      canvas.removeEventListener('touchstart', release);
      canvas.removeEventListener('wheel', release);
      truckMarkers.current.forEach((marker) => marker.remove());
      truckMarkers.current.clear();
      pointMarkers.current.forEach((marker) => marker.remove());
      pointMarkers.current.clear();
      stationMarkers.current.forEach((marker) => marker.remove());
      stationMarkers.current.clear();
      searchMarker.current?.remove();
      searchMarker.current = null;
      map.remove();
      mapRef.current = null;
      setStyleEpoch(0);
    };
  }, [applyStyleFeatures, interactive]);

  // --- Basemap switch ----------------------------------------------------
  // Tracked explicitly so a re-run for any other reason cannot trigger a
  // needless style reload, which would flush and rebuild every overlay.
  const appliedStyleId = React.useRef(settings.styleId);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyleId.current === settings.styleId) return;
    appliedStyleId.current = settings.styleId;
    map.setStyle(resolveStyleUrl(settings.styleId));
  }, [settings.styleId, ready]);

  /**
   * While lighting is on `auto`, follow the clock into a matching basemap too —
   * a night sky over a bright daytime basemap reads as a bug. An explicit style
   * choice is never overridden, because that sets `appliedStyleId` itself.
   */
  React.useEffect(() => {
    if (settings.lightPreset !== 'auto') return;
    const suggested = lightingDefinition(resolvedLightPreset).suggestedStyle;
    setSettings((current) =>
      current.lightPreset === 'auto' && current.styleId !== suggested
        ? { ...current, styleId: suggested }
        : current,
    );
  }, [settings.lightPreset, resolvedLightPreset]);

  // --- Settings that do not need a style reload --------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyAtmosphere(map, {
      terrain: settings.terrain,
      lightPreset: resolvedLightPreset,
      threeD: mode === '3d',
    });
  }, [settings.terrain, resolvedLightPreset, mode, ready]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyBuildings(map, activeStyle, settings.buildings);
  }, [settings.buildings, activeStyle, ready]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyLabelConfig(map, settings.labels);
  }, [settings.labels, ready]);

  // --- Camera mode -------------------------------------------------------
  const firstModeRun = React.useRef(true);
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (firstModeRun.current) {
      // The constructor already applied the initial pitch.
      firstModeRun.current = false;
      return;
    }
    map.easeTo({ ...MAP_CAMERA[mode], duration: 900 });
  }, [mode, ready]);

  // --- Trucks ------------------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const seen = new Set<string>();
    const smoothMotion = cameraMode === 'free';

    for (const truck of trucks) {
      if (!Number.isFinite(truck.latitude) || !Number.isFinite(truck.longitude)) continue;
      seen.add(truck.id);
      const isSelected = truck.id === selectedTruckId;

      const existing = truckMarkers.current.get(truck.id);
      if (existing) {
        // Move in place so the marker animates instead of blinking.
        existing.setLngLat([truck.longitude, truck.latitude]);
        existing.setRotation(truck.heading ?? 0);
        paintTruckElement(existing.getElement(), truck, isSelected, smoothMotion);
        existing.getPopup()?.setHTML(popupHtml(truck));
        continue;
      }

      const element = buildTruckElement();
      paintTruckElement(element, truck, isSelected, smoothMotion);
      element.addEventListener('click', () => onSelectRef.current?.(truck.id));

      const marker = new maplibregl.Marker({
        element,
        // Rotation follows the map plane so the arrow points at the true
        // compass heading however the map is turned, while the badge itself
        // stays facing the camera and therefore readable at any pitch.
        rotationAlignment: 'map',
        pitchAlignment: 'viewport',
        // MapLibre dims a marker it believes terrain is hiding — at low zoom its
        // occlusion test fires constantly, which washed live trucks out to grey
        // blobs. A fleet operator must always see the vehicle, so never dim it.
        opacityWhenCovered: '1',
      })
        .setLngLat([truck.longitude, truck.latitude])
        .setRotation(truck.heading ?? 0)
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
  }, [trucks, selectedTruckId, cameraMode, ready]);

  // --- Static markers ----------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const seen = new Set<string>();
    for (const point of markers) {
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
      seen.add(point.id);
      if (pointMarkers.current.has(point.id)) continue;

      const element = document.createElement('div');
      element.style.cssText = `width:14px;height:14px;border-radius:9999px;border:2.5px solid #fff;background:${POINT_COLOURS[point.kind]};box-shadow:0 2px 5px rgba(15,23,42,.3);`;

      const marker = new maplibregl.Marker({ element, opacityWhenCovered: '1' })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
            `<div style="padding:8px 10px;font-size:12px;font-weight:500;">${escapeHtml(
              point.label,
            )}</div>`,
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

  // --- Petrol stations ---------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const seen = new Set<string>();
    for (const station of stations) {
      if (!Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
      seen.add(station.id);

      const existing = stationMarkers.current.get(station.id);
      if (existing) {
        paintStationElement(existing.getElement(), station.id === selectedStationId);
        continue;
      }

      const element = buildStationElement();
      paintStationElement(element, station.id === selectedStationId);
      element.addEventListener('click', () => onSelectStationRef.current?.(station.id));

      const marker = new maplibregl.Marker({ element, opacityWhenCovered: '1' })
        .setLngLat([station.longitude, station.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            stationPopupHtml(station),
          ),
        )
        .addTo(map);

      stationMarkers.current.set(station.id, marker);
    }

    for (const [id, marker] of stationMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        stationMarkers.current.delete(id);
      }
    }
  }, [stations, selectedStationId, ready]);

  // --- Route & trail -----------------------------------------------------
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    setRouteState(map, {
      geometry: routedRoute?.geometry ?? route ?? null,
      alternatives: navigationState.routes
        .filter((option) => option !== routedRoute)
        .map((option) => option.geometry),
      completedFraction: navigationState.progress?.completedFraction ?? 0,
    });
  }, [
    routedRoute,
    route,
    navigationState.routes,
    navigationState.progress?.completedFraction,
    ready,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setTrailState(map, trail);
  }, [trail, ready]);

  // --- Fit ---------------------------------------------------------------
  const fitToContent = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const points: [number, number][] = [
      ...trucks.map((truck) => [truck.longitude, truck.latitude] as [number, number]),
      ...(routedRoute?.geometry ?? route ?? []).map(
        (point) => [point.longitude, point.latitude] as [number, number],
      ),
      ...(trail ?? []).map((point) => [point.longitude, point.latitude] as [number, number]),
      ...markers.map((marker) => [marker.longitude, marker.latitude] as [number, number]),
      ...stations.map((station) => [station.longitude, station.latitude] as [number, number]),
    ].filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));

    if (points.length === 0) return;
    setCameraMode('free');

    // Framing must not silently flatten the camera. `fitBounds` derives its own
    // camera and drops pitch/bearing to zero, which left the map looking 2D
    // while the 3D toggle was still lit — so resolve the camera first, then
    // ease to it with the current mode's tilt applied explicitly.
    const camera = MAP_CAMERA[modeRef.current];

    if (points.length === 1) {
      map.easeTo({ center: points[0]!, zoom: 12, ...camera, duration: 700 });
      return;
    }

    const bounds = points.reduce(
      (accumulator, point) => accumulator.extend(point),
      new maplibregl.LngLatBounds(points[0]!, points[0]!),
    );

    const fitted = map.cameraForBounds(bounds as LngLatBoundsLike, {
      padding: 72,
      maxZoom: 13,
      bearing: camera.bearing,
    });
    if (!fitted) return;

    map.easeTo({
      center: fitted.center ?? points[0]!,
      zoom: fitted.zoom ?? map.getZoom(),
      ...camera,
      duration: 700,
    });
  }, [trucks, route, routedRoute, trail, markers, stations]);

  // Fit once the first content arrives, not on every tick — otherwise the
  // camera would fight the user while a simulation is running.
  const hasFitted = React.useRef(false);
  React.useEffect(() => {
    if (!ready || !autoFit || hasFitted.current) return;
    const hasContent =
      trucks.length > 0 || (route?.length ?? 0) > 0 || markers.length > 0 || stations.length > 0;
    if (!hasContent) return;
    hasFitted.current = true;
    fitToContent();
  }, [ready, autoFit, trucks.length, route?.length, markers.length, stations.length, fitToContent]);

  // --- Follow / chase camera ---------------------------------------------
  const progress = navigationState.progress;
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || cameraMode === 'free' || !focusTruck) return;

    if (cameraMode === 'chase') {
      const centre = progress?.snapped ?? {
        latitude: focusTruck.latitude,
        longitude: focusTruck.longitude,
      };
      map.easeTo({
        center: [centre.longitude, centre.latitude],
        bearing: progress?.routeBearing ?? focusTruck.heading ?? map.getBearing(),
        pitch: NAV_CAMERA.pitch,
        zoom: Math.max(map.getZoom(), NAV_CAMERA.zoom),
        // Linear and just under the GPS tick, so the pan reads as continuous.
        duration: 950,
        easing: (t) => t,
      });
      return;
    }

    map.easeTo({
      center: [focusTruck.longitude, focusTruck.latitude],
      zoom: Math.max(map.getZoom(), FOLLOW_CAMERA.zoom),
      duration: 900,
      easing: (t) => t * (2 - t),
    });
  }, [cameraMode, focusTruck, progress, ready]);

  // Entering chase view implies the 3D camera.
  React.useEffect(() => {
    if (cameraMode === 'chase' && allow3D) setMode('3d');
  }, [cameraMode, allow3D]);

  // Selecting a truck starts following it — the behaviour callers have always
  // relied on. Any deliberate gesture afterwards releases the camera again.
  const previousSelection = React.useRef<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (previousSelection.current === selectedTruckId) return;
    previousSelection.current = selectedTruckId;
    if (selectedTruckId) {
      setCameraMode((current) => (current === 'chase' ? current : 'follow'));
    }
  }, [selectedTruckId]);

  // --- Search ------------------------------------------------------------
  const flyToSearchResult = React.useCallback((position: LatLng, label: string) => {
    const map = mapRef.current;
    if (!map) return;
    setCameraMode('free');

    searchMarker.current?.remove();
    const element = document.createElement('div');
    element.style.cssText =
      'width:16px;height:16px;border-radius:9999px;border:3px solid #fff;background:#7c3aed;box-shadow:0 2px 8px rgba(15,23,42,.4);';
    searchMarker.current = new maplibregl.Marker({ element })
      .setLngLat([position.longitude, position.latitude])
      .setPopup(
        new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
          `<div style="padding:8px 10px;font-size:12px;font-weight:500;">${escapeHtml(label)}</div>`,
        ),
      )
      .addTo(map);

    map.flyTo({
      center: [position.longitude, position.latitude],
      zoom: 14,
      pitch: MAP_CAMERA[modeRef.current].pitch,
      duration: 1400,
      essential: true,
    });
  }, []);

  const mapCentre = React.useMemo<LatLng | null>(() => {
    const truck = focusTruck ?? trucks[0];
    return truck ? { latitude: truck.latitude, longitude: truck.longitude } : null;
  }, [focusTruck, trucks]);

  const updateSettings = React.useCallback((patch: Partial<MapSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  // --- Failed state ------------------------------------------------------
  if (initError) {
    return (
      <div
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40',
          className,
        )}
        style={{ height }}
      >
        <div className="max-w-md px-6 py-8 text-center">
          <TriangleAlert className="mx-auto mb-2 size-6 text-warning" />
          <p className="text-sm font-medium">{initError}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The basemap is served by OpenFreeMap and needs no API key — this is usually a network
            or WebGL problem rather than a configuration one.
          </p>
        </div>
      </div>
    );
  }

  const showNavigationPanel =
    navigation && (navigationState.route || navigationState.isLoading || navigationState.error);
  const empty =
    trucks.length === 0 &&
    !route?.length &&
    markers.length === 0 &&
    stations.length === 0 &&
    !routedRoute;

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border', className)}>
      <div ref={containerRef} style={{ height }} className="w-full" />

      {showControls ? (
        <>
          <div className="pointer-events-auto absolute left-3 top-3 flex flex-col items-start gap-1.5">
            {allow3D ? (
              <Button
                size="sm"
                variant={mode === '3d' ? 'default' : 'glass'}
                onClick={() => setMode(mode === '2d' ? '3d' : '2d')}
                className="shadow-lifted"
                title="Toggle the tilted 3D camera"
              >
                {mode === '3d' ? <Box className="size-4" /> : <Layers className="size-4" />}
                {mode === '3d' ? '3D view' : '2D view'}
              </Button>
            ) : null}

            <Button size="sm" variant="glass" onClick={fitToContent} className="shadow-lifted">
              <Maximize2 className="size-4" />
              Fit
            </Button>

            {focusTruck ? (
              <div className="glass flex overflow-hidden rounded-md shadow-lifted">
                <button
                  type="button"
                  onClick={() => setCameraMode(cameraMode === 'follow' ? 'free' : 'follow')}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors',
                    cameraMode === 'follow'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-secondary',
                  )}
                  title="Keep the selected truck centred"
                >
                  <Crosshair className="size-3.5" />
                  Follow
                </button>
                <button
                  type="button"
                  onClick={() => setCameraMode(cameraMode === 'chase' ? 'free' : 'chase')}
                  className={cn(
                    'flex items-center gap-1.5 border-l border-border/70 px-2.5 py-1.5 text-xs font-medium transition-colors',
                    cameraMode === 'chase'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-secondary',
                  )}
                  title="Driver's-eye chase camera"
                >
                  <Navigation className="size-3.5" />
                  Drive
                </button>
              </div>
            ) : null}

            <MapSettingsControl
              settings={settings}
              onChange={updateSettings}
              activeStyle={activeStyle}
            />
          </div>

          {showSearch ? (
            <div className="absolute left-1/2 top-3 w-[min(22rem,calc(100%-8rem))] -translate-x-1/2">
              <MapSearch
                proximity={mapCentre}
                onSelect={(feature) => flyToSearchResult(feature.position, feature.name)}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {showNavigationPanel ? (
        <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:w-[22rem]">
          <NavigationPanel state={navigationState} compact={!showControls} />
        </div>
      ) : null}

      {empty ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="glass rounded-xl px-5 py-4 text-center">
            <Route className="mx-auto mb-1.5 size-5 text-muted-foreground" />
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
