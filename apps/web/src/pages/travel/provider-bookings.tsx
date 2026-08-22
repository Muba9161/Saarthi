import { TravelBookingsPage } from './bookings';

/**
 * Provider-side booking list.
 *
 * The same screen as the customer view with the side flipped: the API scopes by
 * the caller's organization either way, so this is a presentation choice rather
 * than an access one.
 */
export function ProviderBookingsPage() {
  return <TravelBookingsPage side="provider" />;
}

export default ProviderBookingsPage;
