import { ENABLE_BACKHAUL_ACTION } from '@saarthi/shared';

/** The search parameter that opens the "Enable backhaul" dialog on a trip. */
export const ENABLE_BACKHAUL_PARAM = 'backhaul';

/** Where the "Enable backhaul" button takes the owner. */
export function enableBackhaulPath(tripId: string): string {
  return `/trips/${tripId}?${ENABLE_BACKHAUL_PARAM}=enable`;
}

/** The trip a notification offers backhaul on, when it carries that action. */
export function backhaulTripOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { action, tripId } = data as { action?: unknown; tripId?: unknown };
  return action === ENABLE_BACKHAUL_ACTION && typeof tripId === 'string' ? tripId : null;
}
