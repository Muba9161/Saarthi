import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { OrsRoutingProvider } from './ors-routing.provider';
import type { RoutingProvider } from './routing.provider';

/**
 * Routing provider factory.
 *
 * Returns `null` when no OpenRouteService key is configured, and that is a
 * supported state rather than a broken one: OpenRouteService needs a free
 * account, a Saarthi instance may not have one, and a fleet running air-gapped
 * never will.
 *
 * What matters is what callers do with the null. Every one of them falls back
 * to straight-line distance **and says so** — `RoadDistanceView.basis` is
 * `STRAIGHT_LINE` rather than `ROAD`, and the terminal renders "3.2 km direct"
 * instead of "3.2 km". A driver told a fuel station is 3.2 km away when the road
 * is 11 km around a river runs out of fuel, and is right to stop trusting
 * Saarthi afterwards. Silence is not an option here; degrading honestly is.
 */
function createRoutingProvider(): RoutingProvider | null {
  const apiKey = config.maps.routingApiKey;
  if (!apiKey) return null;
  return new OrsRoutingProvider(apiKey);
}

export const routingProvider: RoutingProvider | null = createRoutingProvider();

export const isRoutingConfigured = routingProvider !== null;

logger.info(
  { provider: routingProvider?.name ?? 'none' },
  isRoutingConfigured
    ? 'Routing provider ready'
    : 'No routing provider configured — distances will be straight-line and labelled as such',
);

export * from './routing.provider';
