/**
 * Public surface of the map feature. Pages import from here rather than reaching
 * into individual modules, so the internals can move without a sweep.
 */

export { FleetMap, type CameraMode, type FleetMapProps, type MapMarkerPoint, type MapTruck } from './fleet-map';
export { MapSearch, type MapSearchProps } from './map-search';
export { MapSettingsControl, type MapSettings } from './map-controls';
export { NavigationPanel, type NavigationPanelProps } from './navigation-panel';
export { ManeuverIcon, maneuverIcon, maneuverLabel } from './maneuver-icon';
export { useNavigation, type NavigationState, type UseNavigationOptions } from './use-navigation';
export {
  useDeviceLocation,
  type DeviceLocation,
  type DeviceLocationState,
  type DeviceLocationStatus,
  type UseDeviceLocationOptions,
} from './use-device-location';

export {
  DirectionsError,
  clearDirectionsCache,
  fetchDirections,
  geocodeForward,
  geocodeReverse,
  isMapMatchingAvailable,
  matchToRoads,
  type DirectionsOptions,
  type DirectionsResult,
  type GeocodeFeature,
  type NavigationRoute,
  type RouteLeg,
  type RouteManeuver,
  type RouteStep,
  type RoutingProfile,
} from './directions';

export {
  ARRIVAL_THRESHOLD_METERS,
  OFF_ROUTE_THRESHOLD_METERS,
  computeRouteProgress,
  flattenSteps,
  formatEtaClock,
  formatEtaDuration,
  formatManeuverDistance,
  remainingGeometry,
  type RouteProgress,
} from './route-progress';

export {
  BASEMAP_ATTRIBUTION,
  DEFAULT_CENTER,
  DEFAULT_STYLE_ID,
  DEFAULT_ZOOM,
  LIGHT_PRESETS,
  MAP_CAMERA,
  MAP_STYLES,
  MAP_STYLE_OPTIONS,
  isRoutingConfigured,
  lightPresetForTime,
  lightingDefinition,
  mapProvider,
  resolveStyleUrl,
  styleDefinition,
  type LightPreset,
  type MapMode,
  type MapStyleDefinition,
  type MapStyleId,
} from './map-config';
