/**
 * Compatibility shim.
 *
 * Map configuration lives in `map-config.ts`. This module re-exports it so any
 * existing import of `@/features/maps/map-provider` keeps resolving.
 *
 * New code should import from `./map-config` — or from the feature barrel,
 * `@/features/maps` — instead.
 */

export * from './map-config';
