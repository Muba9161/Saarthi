import type { MapMarkerPoint } from '@/features/maps/fleet-map';

/**
 * The two ends of a trip or an order, as the API shows them to this viewer.
 *
 * The delivery point is null for a Seller: it is shown where its goods are
 * collected, never where they go. Everyone else always has both ends.
 */
export interface RouteEnds {
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
}

/** The first part of an address line — the place a person recognises. */
export function placeName(address: string): string {
  return address.split(',')[0] ?? address;
}

/** "Jaipur → Gurugram", or the pickup alone when the delivery point is withheld. */
export function tripRouteLabel(
  route: Pick<RouteEnds, 'originAddress' | 'destinationAddress'>,
): string {
  const from = placeName(route.originAddress);
  return route.destinationAddress ? `${from} → ${placeName(route.destinationAddress)}` : from;
}

/** Map pins for the ends of a route; the delivery pin only when it is shown. */
export function routeMarkers(route: RouteEnds): MapMarkerPoint[] {
  const markers: MapMarkerPoint[] = [
    {
      id: 'origin',
      latitude: route.originLatitude,
      longitude: route.originLongitude,
      label: route.originAddress,
      kind: 'origin',
    },
  ];
  if (
    route.destinationAddress !== null &&
    route.destinationLatitude !== null &&
    route.destinationLongitude !== null
  ) {
    markers.push({
      id: 'destination',
      latitude: route.destinationLatitude,
      longitude: route.destinationLongitude,
      label: route.destinationAddress,
      kind: 'destination',
    });
  }
  return markers;
}
