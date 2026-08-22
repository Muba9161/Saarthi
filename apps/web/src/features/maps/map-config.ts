import type {
  LightSpecification,
  RasterDEMSourceSpecification,
  SkySpecification,
} from 'maplibre-gl';

/**
 * Map configuration — MapLibre GL JS on fully open data.
 *
 * Saarthi renders a true 3D map with no API key and no payment method anywhere
 * in the basemap path:
 *
 *   - Vector tiles and styles from OpenFreeMap (no registration, no key, no
 *     request limit, commercial use permitted).
 *   - Elevation from the AWS Open Data terrain tiles.
 *   - Buildings extruded from the OpenMapTiles `building` layer.
 *   - Sky, atmosphere and sun position driven per time-of-day preset, so the
 *     scene actually changes between a dawn shift and a night run.
 *
 * Turn-by-turn routing and place search go through OpenRouteService, which does
 * need a free API key (email only, no card) — see `VITE_ORS_API_KEY`.
 *
 * Every component asks this module for a style, a camera preset or a lighting
 * preset; none of them hard-code a vendor URL or a magic pitch value.
 */

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** Required by OpenFreeMap — do not shorten or remove. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/** Shown when terrain is on, as the elevation data has its own credit. */
export const TERRAIN_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Tilezen Joerd</a>';

// ---------------------------------------------------------------------------
// Routing credentials
// ---------------------------------------------------------------------------

/**
 * OpenRouteService key. Free, email-only signup at
 * https://account.heigit.org/signup — no card. Without it the basemap still
 * works fully; only turn-by-turn routing and place search are unavailable.
 */
export const ORS_API_KEY: string = (
  (import.meta.env.VITE_ORS_API_KEY as string | undefined) || ''
).trim();

export const isRoutingConfigured: boolean = ORS_API_KEY.length > 0;

/**
 * OpenRouteService host.
 *
 * HeiGIT is migrating from `api.openrouteservice.org` to `api.heigit.org` and
 * has marked the old host deprecated, so the new one is the default. Override
 * with `VITE_ORS_BASE_URL` if a given endpoint has not moved across yet.
 */
export const ORS_BASE_URL: string = (
  (import.meta.env.VITE_ORS_BASE_URL as string | undefined) || 'https://api.heigit.org'
).replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export type MapMode = '2d' | '3d';

export type MapStyleId = 'liberty' | 'bright' | 'positron' | 'dark' | 'fiord';

export interface MapStyleDefinition {
  id: MapStyleId;
  name: string;
  /** Short label for the compact style switcher. */
  shortName: string;
  url: string;
  /** Dark basemap: pick the light-on-dark overlay palette and night sky. */
  dark: boolean;
  /** Reads well under low-light presets. */
  nightFriendly: boolean;
}

const STYLE_LIST: MapStyleDefinition[] = [
  {
    id: 'liberty',
    name: 'Liberty',
    shortName: 'Liberty',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    dark: false,
    nightFriendly: false,
  },
  {
    id: 'bright',
    name: 'Bright',
    shortName: 'Bright',
    url: 'https://tiles.openfreemap.org/styles/bright',
    dark: false,
    nightFriendly: false,
  },
  {
    id: 'positron',
    name: 'Positron (muted)',
    shortName: 'Muted',
    url: 'https://tiles.openfreemap.org/styles/positron',
    dark: false,
    nightFriendly: false,
  },
  {
    id: 'dark',
    name: 'Dark',
    shortName: 'Dark',
    url: 'https://tiles.openfreemap.org/styles/dark',
    dark: true,
    nightFriendly: true,
  },
  {
    id: 'fiord',
    name: 'Fiord',
    shortName: 'Fiord',
    url: 'https://tiles.openfreemap.org/styles/fiord',
    dark: true,
    nightFriendly: true,
  },
];

export const MAP_STYLES: Record<MapStyleId, MapStyleDefinition> = STYLE_LIST.reduce(
  (accumulator, style) => {
    accumulator[style.id] = style;
    return accumulator;
  },
  {} as Record<MapStyleId, MapStyleDefinition>,
);

export const MAP_STYLE_OPTIONS: readonly MapStyleDefinition[] = STYLE_LIST;

function readConfiguredStyleId(): MapStyleId {
  const configured = import.meta.env.VITE_MAP_STYLE_ID as string | undefined;
  if (configured && configured in MAP_STYLES) return configured as MapStyleId;
  return 'liberty';
}

export const DEFAULT_STYLE_ID: MapStyleId = readConfiguredStyleId();

/**
 * A raw style URL still wins when configured, so a customer can point Saarthi
 * at a self-hosted OpenFreeMap instance or their own style without a code change.
 */
export const CUSTOM_STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || undefined;

export function styleDefinition(styleId: MapStyleId): MapStyleDefinition {
  return MAP_STYLES[styleId] ?? MAP_STYLES.liberty;
}

export function resolveStyleUrl(styleId: MapStyleId): string {
  // Only the default slot is overridable; the explicit pickers must still work.
  if (CUSTOM_STYLE_URL && styleId === DEFAULT_STYLE_ID) return CUSTOM_STYLE_URL;
  return styleDefinition(styleId).url;
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export type LightPreset = 'dawn' | 'day' | 'dusk' | 'night';

export interface LightingDefinition {
  id: LightPreset;
  name: string;
  /** Sky, horizon and ground fog — what sells depth on a pitched camera. */
  sky: SkySpecification;
  /**
   * Sun position and colour. MapLibre applies this to extruded geometry, so it
   * is what makes buildings cast a believable light side and shade side.
   * `position` is [radial, azimuth°, polar°]; a high polar angle is a low sun.
   */
  light: LightSpecification;
  /** Basemap that suits this light, used only while lighting is on `auto`. */
  suggestedStyle: MapStyleId;
}

const LIGHTING: Record<LightPreset, LightingDefinition> = {
  dawn: {
    id: 'dawn',
    name: 'Dawn',
    sky: {
      'sky-color': '#7fa8d8',
      'sky-horizon-blend': 0.6,
      'horizon-color': '#f7cfa4',
      'horizon-fog-blend': 0.55,
      'fog-color': '#e8d3c0',
      'fog-ground-blend': 0.7,
      'atmosphere-blend': 0.85,
    },
    light: { anchor: 'map', color: '#ffd9a8', intensity: 0.45, position: [1.4, 75, 78] },
    suggestedStyle: 'liberty',
  },
  day: {
    id: 'day',
    name: 'Day',
    sky: {
      'sky-color': '#77b6ea',
      'sky-horizon-blend': 0.5,
      'horizon-color': '#dfeaf6',
      'horizon-fog-blend': 0.5,
      'fog-color': '#e6eef7',
      'fog-ground-blend': 0.85,
      'atmosphere-blend': 0.8,
    },
    light: { anchor: 'map', color: '#ffffff', intensity: 0.5, position: [1.4, 200, 28] },
    suggestedStyle: 'liberty',
  },
  dusk: {
    id: 'dusk',
    name: 'Dusk',
    sky: {
      'sky-color': '#3f5f96',
      'sky-horizon-blend': 0.7,
      'horizon-color': '#f0a886',
      'horizon-fog-blend': 0.6,
      'fog-color': '#c9a48c',
      'fog-ground-blend': 0.65,
      'atmosphere-blend': 0.9,
    },
    light: { anchor: 'map', color: '#ffb877', intensity: 0.4, position: [1.4, 285, 80] },
    suggestedStyle: 'fiord',
  },
  night: {
    id: 'night',
    name: 'Night',
    sky: {
      'sky-color': '#0a1024',
      'sky-horizon-blend': 0.4,
      'horizon-color': '#1b2740',
      'horizon-fog-blend': 0.4,
      'fog-color': '#131c2f',
      'fog-ground-blend': 0.5,
      'atmosphere-blend': 0.6,
    },
    light: { anchor: 'map', color: '#93a7d6', intensity: 0.22, position: [1.4, 20, 45] },
    suggestedStyle: 'dark',
  },
};

export const LIGHT_PRESETS: readonly { id: LightPreset; name: string }[] = (
  ['dawn', 'day', 'dusk', 'night'] as const
).map((id) => ({ id, name: LIGHTING[id].name }));

export function lightingDefinition(preset: LightPreset): LightingDefinition {
  return LIGHTING[preset] ?? LIGHTING.day;
}

/**
 * Light preset that matches the wall clock, so a night shift looks like a night
 * shift. Operators read this map for hours; matching real light makes the 3D
 * scene informative rather than decorative.
 */
export function lightPresetForTime(date: Date = new Date()): LightPreset {
  const hour = date.getHours();
  if (hour < 6 || hour >= 21) return 'night';
  if (hour < 8) return 'dawn';
  if (hour < 18) return 'day';
  return 'dusk';
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/** Camera presets. 3D tilts into the scene; 2D flattens to a plan view. */
export const MAP_CAMERA: Record<MapMode, { pitch: number; bearing: number }> = {
  '2d': { pitch: 0, bearing: 0 },
  '3d': { pitch: 58, bearing: -20 },
};

/** Driver's-eye chase camera used while navigating. */
export const NAV_CAMERA = { pitch: 68, zoom: 16.4 } as const;

/** Camera used when following a truck without turn-by-turn guidance. */
export const FOLLOW_CAMERA = { pitch: 52, zoom: 13.5 } as const;

/** Roughly centred on India, framing the demo corridors. */
export const DEFAULT_CENTER: [number, number] = [78.9629, 22.5937];
export const DEFAULT_ZOOM = 4.2;
export const MAX_PITCH = 85;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const TERRAIN_SOURCE_ID = 'saarthi-dem';

/**
 * Elevation tiles.
 *
 * Defaults to the AWS Open Data terrain tiles (Tilezen Joerd) — open licence,
 * no key, no account. Override with `VITE_TERRAIN_TILES_URL` to self-host or to
 * point at another DEM; `VITE_TERRAIN_ENCODING` switches the decode if that
 * source uses Mapbox-style RGB packing instead of Terrarium.
 *
 * If the DEM is unreachable the map still renders — terrain simply stays flat.
 */
const TERRAIN_TILES_URL =
  (import.meta.env.VITE_TERRAIN_TILES_URL as string | undefined) ||
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const TERRAIN_ENCODING = ((import.meta.env.VITE_TERRAIN_ENCODING as string | undefined) ||
  'terrarium') as 'terrarium' | 'mapbox';

export const TERRAIN_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [TERRAIN_TILES_URL],
  encoding: TERRAIN_ENCODING,
  tileSize: 256,
  maxzoom: 15,
  attribution: TERRAIN_ATTRIBUTION,
};

/** Mild exaggeration: enough to read a ghat section, not enough to distort. */
export const TERRAIN_EXAGGERATION = 1.25;

// ---------------------------------------------------------------------------
// Overlay palette
// ---------------------------------------------------------------------------

export const ROUTE_COLOURS = {
  /** The road still ahead. */
  line: '#2563eb',
  casing: '#0b2a63',
  /** The road already covered, dimmed back. */
  driven: '#7c8ba1',
  alternative: '#94a3b8',
  trail: '#4338ca',
  trailHead: '#a855f7',
} as const;

// ---------------------------------------------------------------------------
// Provider descriptor
// ---------------------------------------------------------------------------

export interface MapProviderDefinition {
  id: string;
  name: string;
  supportsTrue3D: boolean;
  attribution: string;
  /** The basemap needs no credentials, so it is always available. */
  configured: boolean;
  /** Routing and search need the free OpenRouteService key. */
  routingConfigured: boolean;
}

export const mapProvider: MapProviderDefinition = {
  id: 'openfreemap',
  name: 'MapLibre GL JS · OpenFreeMap',
  supportsTrue3D: true,
  attribution: BASEMAP_ATTRIBUTION,
  configured: true,
  routingConfigured: isRoutingConfigured,
};
