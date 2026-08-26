import { errors } from '../../lib/errors';
import type {
  FastagProvider,
  ProviderTagDetails,
  ProviderTollHistory,
  TagLookupRequest,
} from './fastag.provider';

/**
 * The default: Saarthi holds the tags and crossings its users recorded.
 *
 * Refuses to look anything up rather than returning an empty result, for the
 * same reason the loan and service-history providers do. "No FASTag found"
 * reads as *this vehicle has no tag* — a statement that would send someone to
 * a plaza expecting to pay cash — when the truth is only that Saarthi is not
 * connected to a NETC provider here.
 */
export class InternalFastagProvider implements FastagProvider {
  readonly name = 'internal';
  readonly supportsLookup = false;
  readonly supportsBalance = false;
  readonly supportsRecharge = false;
  readonly supportsTransactions = false;
  readonly unavailableReason =
    'Saarthi is not connected to a FASTag provider on this environment. ' +
    'Tags, balances and toll crossings are whatever you or your team recorded, ' +
    'or imported from a bank statement.';

  async fetchTagDetails(_request: TagLookupRequest): Promise<ProviderTagDetails> {
    throw errors.providerNotConfigured('fastag', this.unavailableReason);
  }

  async fetchTollHistory(_request: TagLookupRequest): Promise<ProviderTollHistory> {
    throw errors.providerNotConfigured('fastag', this.unavailableReason);
  }
}
