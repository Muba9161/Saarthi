import type { StyleSpecification } from 'maplibre-gl';

/**
 * Map provider abstraction.
 *
 * Saarthi never hard-codes a vendor into a component. A provider supplies a
 * style, an attribution and whether it can do true 3D; components ask for
 * "2D" or "3D" and get whatever the configured provider supports.
 *
 * Locally the default provider uses open raster tiles, so the map works with
 * no API key at all. Configure VITE_MAP_STYLE_URL (e.g. a MapTiler vector
 * style) to unlock terrain and extruded buildings without touching any component.
 */

export type MapMode = '2d' | '3d';

export interface MapProviderDefinition {
  id: string;
  name: string;
  /** True when the style contains vector data that can be extruded/tilted meaningfully. */
  supportsTrue3D: boolean;
  attribution: string;
  buildStyle: (mode: MapMode) => string | StyleSpecification;
}

const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Raster style built from OpenStreetMap tiles. No key required, which is what
 * makes the local demo work offline of any paid service.
 */
function rasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: OSM_ATTRIBUTION,
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#eef2f7' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 1 } },
    ],
  };
}

const configuredStyleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
const configuredApiKey = import.meta.env.VITE_MAP_API_KEY as string | undefined;

const maplibreProvider: MapProviderDefinition = {
  id: 'maplibre',
  name: configuredStyleUrl ? 'MapLibre (vector)' : 'MapLibre (OpenStreetMap raster)',
  supportsTrue3D: Boolean(configuredStyleUrl),
  attribution: OSM_ATTRIBUTION,
  buildStyle: () => {
    if (configuredStyleUrl) {
      return configuredApiKey
        ? `${configuredStyleUrl}${configuredStyleUrl.includes('?') ? '&' : '?'}key=${configuredApiKey}`
        : configuredStyleUrl;
    }
    return rasterStyle();
  },
};

export const mapProvider: MapProviderDefinition = maplibreProvider;

/** Camera presets. 3D tilts and rotates; raster tiles still read well pitched. */
export const MAP_CAMERA: Record<MapMode, { pitch: number; bearing: number }> = {
  '2d': { pitch: 0, bearing: 0 },
  '3d': { pitch: 55, bearing: -20 },
};

/** Roughly centred on India, framing the demo corridors. */
export const DEFAULT_CENTER: [number, number] = [78.9629, 22.5937];
export const DEFAULT_ZOOM = 4.2;
