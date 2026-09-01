import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl';
import type {
  Feature,
  FeatureCollection,
  GeoJSON as GeoJsonValue,
  Geometry,
  LineString,
  Polygon,
} from 'geojson';
import type { LatLng } from '@saarthi/shared';
import {
  ROUTE_COLOURS,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE,
  TERRAIN_SOURCE_ID,
  lightingDefinition,
  type LightPreset,
  type MapStyleDefinition,
} from './map-config';

/**
 * Everything Saarthi draws on top of the basemap.
 *
 * `map.setStyle()` discards custom sources and layers, so every addition here is
 * idempotent and re-run from a single `style.load` handler. That is the only
 * pattern that survives a style switch without leaving the map half-dressed.
 */

export const SOURCE_IDS = {
  route: 'saarthi-route',
  alternatives: 'saarthi-route-alternatives',
  trail: 'saarthi-trail',
  accuracy: 'saarthi-location-accuracy',
} as const;

export const LAYER_IDS = {
  hillshade: 'saarthi-hillshade',
  buildings: 'saarthi-3d-buildings',
  accuracyFill: 'saarthi-location-accuracy-fill',
  accuracyOutline: 'saarthi-location-accuracy-outline',
  alternatives: 'saarthi-route-alternatives-line',
  routeCasing: 'saarthi-route-casing',
  routeLine: 'saarthi-route-line',
  routeArrows: 'saarthi-route-arrows',
  trailGlow: 'saarthi-trail-glow',
  trailLine: 'saarthi-trail-line',
} as const;

const ARROW_IMAGE_ID = 'saarthi-route-arrow';

/** OpenMapTiles ships building footprints under this source layer. */
const BUILDING_SOURCE_LAYER = 'building';

const EMPTY: FeatureCollection<Geometry> = { type: 'FeatureCollection', features: [] };

function lineFeature(points: readonly LatLng[]): Feature<LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.map((point) => [point.longitude, point.latitude]),
    },
  };
}

/**
 * Overlays belong under the basemap's labels, so road and place names stay
 * readable on top of a thick route ribbon.
 */
function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((layer) => layer.type === 'symbol')?.id;
}

/**
 * Lowest sensible slot for a raster overlay: above the basemap's land and water
 * fills, below its roads. Dropping it before the first symbol layer instead
 * would bury every road under the shading.
 */
function firstLineLayerId(map: MapLibreMap): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((layer) => layer.type === 'line')?.id ?? firstSymbolLayerId(map);
}

/** The vector source a style uses for its OpenMapTiles data. */
function openMapTilesSourceId(map: MapLibreMap): string | undefined {
  const sources = map.getStyle()?.sources ?? {};
  for (const [id, source] of Object.entries(sources)) {
    if (source.type === 'vector') return id;
  }
  return undefined;
}

function hasSource(map: MapLibreMap, id: string): boolean {
  return Boolean(map.getSource(id));
}

function hasLayer(map: MapLibreMap, id: string): boolean {
  return Boolean(map.getLayer(id));
}

/**
 * Whether the style is far enough along to accept mutations.
 *
 * MapLibre throws `Style is not done loading.` from `addSource`, `addLayer`,
 * `setTerrain`, `setLight`, `setSky` and every `set*Property` call issued
 * between a `setStyle()` and the next `style.load`. That window is real — a
 * basemap swap refetches the whole style document — and a throw inside a React
 * effect takes the surrounding screen down with it, so every entry point below
 * checks first and lets the next `style.load` re-apply the work.
 *
 * `Map#isStyleLoaded()` is the wrong test: it also waits on every tile and
 * sprite, so it stays false long after mutations are legal. `getStyle()`
 * returns `undefined` for exactly the window MapLibre itself rejects.
 */
export function isStyleReady(map: MapLibreMap): boolean {
  return Boolean(map.getStyle());
}

function setGeoJson(map: MapLibreMap, sourceId: string, data: GeoJsonValue): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

// ---------------------------------------------------------------------------
// Terrain, sky and sun
// ---------------------------------------------------------------------------

export interface AtmosphereOptions {
  terrain: boolean;
  lightPreset: LightPreset;
  /** Sky and fog only read as intended once the camera is tilted. */
  threeD: boolean;
}

/**
 * Real elevation, sky and sun position.
 *
 * Terrain is what makes a ghat section or a flyover legible — without it a
 * pitched camera is just a skewed flat map. The sun position is not decoration
 * either: MapLibre shades extruded geometry from it, so it is what gives
 * buildings a light side and a shade side.
 */
export function applyAtmosphere(map: MapLibreMap, options: AtmosphereOptions): void {
  if (options.terrain) {
    if (!hasSource(map, TERRAIN_SOURCE_ID)) {
      map.addSource(TERRAIN_SOURCE_ID, TERRAIN_SOURCE);
    }
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
  } else {
    map.setTerrain(null);
  }

  // Hillshade from the same DEM. Terrain alone only shows where the camera is
  // tilted AND the ground actually rises; shading reads as relief immediately,
  // and its absence is a quick signal that the DEM is not loading at all.
  if (options.terrain && !hasLayer(map, LAYER_IDS.hillshade)) {
    map.addLayer(
      {
        id: LAYER_IDS.hillshade,
        type: 'hillshade',
        source: TERRAIN_SOURCE_ID,
        paint: {
          'hillshade-exaggeration': 0.45,
          'hillshade-shadow-color': '#20293a',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#5b6b85',
        },
      },
      firstLineLayerId(map),
    );
  } else if (!options.terrain && hasLayer(map, LAYER_IDS.hillshade)) {
    map.removeLayer(LAYER_IDS.hillshade);
  }

  const lighting = lightingDefinition(options.lightPreset);
  map.setLight(lighting.light);
  // A flat camera sees no sky, so the atmosphere is only worth paying for in 3D.
  map.setSky(options.threeD ? lighting.sky : {});
}

// ---------------------------------------------------------------------------
// 3D buildings
// ---------------------------------------------------------------------------

const BUILDING_HEIGHT: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13,
  0,
  // Grow the extrusion in as you zoom past 13 so buildings do not pop.
  15,
  ['get', 'render_height'],
];

const BUILDING_BASE: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13,
  0,
  15,
  ['get', 'render_min_height'],
];

/**
 * Extruded buildings from the OpenMapTiles `building` layer. `hide_3d` is the
 * schema's own opt-out — respecting it keeps roof structures and building parts
 * from stacking into spikes.
 */
export function applyBuildings(
  map: MapLibreMap,
  styleDefinitionValue: MapStyleDefinition,
  enabled: boolean,
): void {
  if (!enabled) {
    if (hasLayer(map, LAYER_IDS.buildings)) map.removeLayer(LAYER_IDS.buildings);
    return;
  }
  if (hasLayer(map, LAYER_IDS.buildings)) return;

  const source = openMapTilesSourceId(map);
  if (!source) return;

  map.addLayer(
    {
      id: LAYER_IDS.buildings,
      type: 'fill-extrusion',
      source,
      'source-layer': BUILDING_SOURCE_LAYER,
      minzoom: 13,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        // The style's own colour where the data carries one, so a themed
        // basemap keeps its palette instead of turning uniformly grey.
        'fill-extrusion-color': [
          'coalesce',
          ['get', 'colour'],
          styleDefinitionValue.dark ? '#2b3648' : '#d7dee9',
        ],
        'fill-extrusion-height': BUILDING_HEIGHT,
        'fill-extrusion-base': BUILDING_BASE,
        'fill-extrusion-opacity': 0.85,
      },
    },
    firstSymbolLayerId(map),
  );
}

// ---------------------------------------------------------------------------
// Direction arrows
// ---------------------------------------------------------------------------

/**
 * A chevron drawn on a canvas rather than loaded from a sprite or a font, so the
 * route arrows never depend on a glyph a given style might not ship.
 */
function ensureArrowImage(map: MapLibreMap): boolean {
  if (map.hasImage(ARROW_IMAGE_ID)) return true;

  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return false;

  context.translate(size / 2, size / 2);
  context.beginPath();
  context.moveTo(0, -7);
  context.lineTo(6, 5);
  context.lineTo(0, 2);
  context.lineTo(-6, 5);
  context.closePath();
  context.fillStyle = '#ffffff';
  context.fill();

  const image = context.getImageData(0, 0, size, size);
  map.addImage(
    ARROW_IMAGE_ID,
    { width: size, height: size, data: new Uint8Array(image.data.buffer) },
    { pixelRatio: 2 },
  );
  return true;
}

// ---------------------------------------------------------------------------
// Route + trail layers
// ---------------------------------------------------------------------------

const ROUTE_WIDTH: DataDrivenPropertyValueSpecification<number> = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  2.5,
  10,
  5,
  14,
  8,
  18,
  14,
];

/**
 * Colour ramp that dims the driven head of the route and lights the rest.
 *
 * Applied to the casing as well as the inner line. Dimming only the line left
 * the navy casing showing either side of it, so a stretch already driven still
 * read as a live blue route — which is the whole point of the split.
 */
function progressGradient(
  completedFraction: number,
  colours: { driven: string; ahead: string },
): ExpressionSpecification {
  const cut = Math.max(0.0001, Math.min(0.9999, completedFraction));
  return ['step', ['line-progress'], colours.driven, cut, colours.ahead];
}

const LINE_COLOURS = { driven: ROUTE_COLOURS.driven, ahead: ROUTE_COLOURS.line };
const CASING_COLOURS = { driven: ROUTE_COLOURS.drivenCasing, ahead: ROUTE_COLOURS.casing };

/**
 * Creates the route and trail sources and layers. Safe to call on every style
 * load: existing layers are left alone, missing ones are rebuilt.
 */
export function ensureOverlayLayers(map: MapLibreMap): void {
  const before = firstSymbolLayerId(map);

  for (const id of [SOURCE_IDS.alternatives, SOURCE_IDS.route, SOURCE_IDS.trail]) {
    if (!hasSource(map, id)) {
      // lineMetrics powers both the driven/remaining split and the trail fade.
      map.addSource(id, { type: 'geojson', data: EMPTY, lineMetrics: true });
    }
  }

  if (!hasSource(map, SOURCE_IDS.accuracy)) {
    map.addSource(SOURCE_IDS.accuracy, { type: 'geojson', data: EMPTY });
  }

  // The GPS accuracy halo sits beneath everything Saarthi draws: it is context
  // for the position marker, never a thing to read in its own right.
  if (!hasLayer(map, LAYER_IDS.accuracyFill)) {
    map.addLayer(
      {
        id: LAYER_IDS.accuracyFill,
        type: 'fill',
        source: SOURCE_IDS.accuracy,
        paint: { 'fill-color': ROUTE_COLOURS.line, 'fill-opacity': 0.12 },
      },
      before,
    );
  }

  if (!hasLayer(map, LAYER_IDS.accuracyOutline)) {
    map.addLayer(
      {
        id: LAYER_IDS.accuracyOutline,
        type: 'line',
        source: SOURCE_IDS.accuracy,
        paint: {
          'line-color': ROUTE_COLOURS.line,
          'line-width': 1,
          'line-opacity': 0.35,
        },
      },
      before,
    );
  }

  // Alternatives sit lowest so the chosen route always reads as primary.
  if (!hasLayer(map, LAYER_IDS.alternatives)) {
    map.addLayer(
      {
        id: LAYER_IDS.alternatives,
        type: 'line',
        source: SOURCE_IDS.alternatives,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOURS.alternative,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 14, 6],
          'line-opacity': 0.6,
          'line-dasharray': [2, 1.5],
        },
      },
      before,
    );
  }

  if (!hasLayer(map, LAYER_IDS.routeCasing)) {
    map.addLayer(
      {
        id: LAYER_IDS.routeCasing,
        type: 'line',
        source: SOURCE_IDS.route,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-gradient': progressGradient(0, CASING_COLOURS),
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4.5, 10, 8, 14, 12, 18, 19],
          'line-opacity': 0.9,
        },
      },
      before,
    );
  }

  if (!hasLayer(map, LAYER_IDS.routeLine)) {
    map.addLayer(
      {
        id: LAYER_IDS.routeLine,
        type: 'line',
        source: SOURCE_IDS.route,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          // A gradient rather than two layers: one step expression splits the
          // driven part from the road ahead, and moves as the truck moves.
          'line-gradient': progressGradient(0, LINE_COLOURS),
          'line-width': ROUTE_WIDTH,
          'line-opacity': 0.98,
        },
      },
      before,
    );
  }

  if (ensureArrowImage(map) && !hasLayer(map, LAYER_IDS.routeArrows)) {
    map.addLayer(
      {
        id: LAYER_IDS.routeArrows,
        type: 'symbol',
        source: SOURCE_IDS.route,
        minzoom: 9,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 90,
          'icon-image': ARROW_IMAGE_ID,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 16, 0.75],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': 0.9 },
      },
      before,
    );
  }

  // Travelled trail: a soft glow plus a gradient line so the freshest section is
  // brightest, which reads as direction of travel without any arrows.
  if (!hasLayer(map, LAYER_IDS.trailGlow)) {
    map.addLayer(
      {
        id: LAYER_IDS.trailGlow,
        type: 'line',
        source: SOURCE_IDS.trail,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_COLOURS.trailHead,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 14, 14],
          'line-opacity': 0.2,
          'line-blur': 6,
        },
      },
      before,
    );
  }

  if (!hasLayer(map, LAYER_IDS.trailLine)) {
    map.addLayer(
      {
        id: LAYER_IDS.trailLine,
        type: 'line',
        source: SOURCE_IDS.trail,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-gradient': [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0,
            ROUTE_COLOURS.trail,
            1,
            ROUTE_COLOURS.trailHead,
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 14, 6],
          'line-opacity': 0.95,
        },
      },
      before,
    );
  }
}

// ---------------------------------------------------------------------------
// Data updates
// ---------------------------------------------------------------------------

export interface RouteRenderState {
  /** The routed line being followed, or null when there is no live routing. */
  geometry: readonly LatLng[] | null;
  /** Other options returned by the router, drawn dashed and dimmed. */
  alternatives?: readonly (readonly LatLng[])[];
  /** Fraction of the route already driven, 0..1 — dims the covered portion. */
  completedFraction?: number;
}

/** Push route geometry and progress into the map without rebuilding layers. */
export function setRouteState(map: MapLibreMap, state: RouteRenderState): void {
  const { geometry, alternatives = [], completedFraction = 0 } = state;

  const primary = geometry ?? [];
  setGeoJson(map, SOURCE_IDS.route, primary.length >= 2 ? lineFeature(primary) : EMPTY);

  setGeoJson(
    map,
    SOURCE_IDS.alternatives,
    alternatives.length > 0
      ? {
          type: 'FeatureCollection',
          features: alternatives
            .filter((option) => option.length >= 2)
            .map((option) => lineFeature(option)),
        }
      : EMPTY,
  );

  // The gradient is re-pushed on every position tick, so this can land inside
  // the window between a `setStyle()` and the next `style.load` — where
  // MapLibre throws. The next `style.load` re-applies it.
  if (!isStyleReady(map)) return;

  if (hasLayer(map, LAYER_IDS.routeLine)) {
    map.setPaintProperty(
      LAYER_IDS.routeLine,
      'line-gradient',
      progressGradient(completedFraction, LINE_COLOURS),
    );
  }
  if (hasLayer(map, LAYER_IDS.routeCasing)) {
    map.setPaintProperty(
      LAYER_IDS.routeCasing,
      'line-gradient',
      progressGradient(completedFraction, CASING_COLOURS),
    );
  }
}

/** Push the travelled trail geometry. */
export function setTrailState(map: MapLibreMap, trail: readonly LatLng[] | undefined): void {
  setGeoJson(map, SOURCE_IDS.trail, trail && trail.length >= 2 ? lineFeature(trail) : EMPTY);
}

/** Vertices used to approximate the accuracy circle — smooth at any zoom. */
const ACCURACY_CIRCLE_STEPS = 48;
/** Below this the halo is smaller than the marker and only adds noise. */
const MIN_ACCURACY_METERS = 15;
/** Above this the fix is too vague to draw a meaningful circle for. */
const MAX_ACCURACY_METERS = 5_000;

/**
 * The reported GPS accuracy as a geographic circle.
 *
 * Drawn as a polygon rather than a screen-space circle so it scales with the
 * map: a 40 m halo has to stay 40 m across whether the operator is looking at a
 * street or at a state, which is the only way it can be read as a distance.
 */
function accuracyCircle(centre: LatLng, radiusMeters: number): Feature<Polygon> {
  const latitudeDegrees = radiusMeters / 111_320;
  const longitudeDegrees =
    radiusMeters / (111_320 * Math.max(0.01, Math.cos((centre.latitude * Math.PI) / 180)));

  const ring: [number, number][] = [];
  for (let step = 0; step <= ACCURACY_CIRCLE_STEPS; step += 1) {
    const angle = (step / ACCURACY_CIRCLE_STEPS) * Math.PI * 2;
    ring.push([
      centre.longitude + Math.cos(angle) * longitudeDegrees,
      centre.latitude + Math.sin(angle) * latitudeDegrees,
    ]);
  }

  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** Push (or clear) the accuracy halo around the device's own position. */
export function setLocationAccuracyState(
  map: MapLibreMap,
  centre: LatLng | null,
  radiusMeters: number | null,
): void {
  const usable =
    centre !== null &&
    radiusMeters !== null &&
    Number.isFinite(radiusMeters) &&
    radiusMeters >= MIN_ACCURACY_METERS &&
    radiusMeters <= MAX_ACCURACY_METERS;

  setGeoJson(
    map,
    SOURCE_IDS.accuracy,
    usable ? accuracyCircle(centre, radiusMeters) : EMPTY,
  );
}

/** Show or hide every route-related layer in one call. */
export function setRouteVisibility(map: MapLibreMap, visible: boolean): void {
  const layers = [
    LAYER_IDS.alternatives,
    LAYER_IDS.routeCasing,
    LAYER_IDS.routeLine,
    LAYER_IDS.routeArrows,
  ];
  for (const id of layers) {
    if (hasLayer(map, id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/**
 * Hide the basemap's point-of-interest clutter. OpenFreeMap styles name these
 * layers by convention rather than exposing a config flag, so this matches on
 * the layer id and quietly does nothing when a style is organised differently.
 */
export function applyLabelConfig(map: MapLibreMap, showLabels: boolean): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    // Keep road, place and transport names; only POI pins are noise on a
    // fleet map dense with vehicle markers.
    if (!/^poi/i.test(layer.id)) continue;
    map.setLayoutProperty(layer.id, 'visibility', showLabels ? 'visible' : 'none');
  }
}
