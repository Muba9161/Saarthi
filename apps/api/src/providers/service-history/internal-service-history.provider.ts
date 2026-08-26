import { errors } from '../../lib/errors';
import type {
  ProviderHistoryRequest,
  ProviderServiceHistory,
  ServiceHistoryProvider,
} from './service-history.provider';

/**
 * The default: Saarthi holds the service history its users recorded.
 *
 * Refuses rather than returning an empty history, for the same reason the
 * internal loan provider does. "No records found" reads as *this vehicle has
 * never been serviced*, which is a damaging thing to say about a truck when the
 * truth is that Saarthi is not connected to the workshop that serviced it.
 */
export class InternalServiceHistoryProvider implements ServiceHistoryProvider {
  readonly name = 'internal';
  readonly supportsRetrieval = false;
  readonly retrievalUnavailableReason =
    'Saarthi is not connected to an external service network on this environment. ' +
    'The history shown is what you and your team recorded, plus anything imported from an invoice.';

  async fetchHistory(_request: ProviderHistoryRequest): Promise<ProviderServiceHistory> {
    throw errors.providerNotConfigured('service-history', this.retrievalUnavailableReason);
  }
}
