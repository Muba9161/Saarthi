import { errors } from '../../lib/errors';
import type {
  LoanProvider,
  ProviderLoanStatement,
  ProviderStatementRequest,
} from './loan.provider';

/**
 * The default: Saarthi holds what the operator entered, and nothing more.
 *
 * This provider deliberately refuses rather than returning an empty statement.
 * An empty result would read as "the lender has no record of this loan", which
 * is a very different — and potentially alarming — statement from "Saarthi is
 * not connected to that lender".
 */
export class InternalLoanProvider implements LoanProvider {
  readonly name = 'internal';
  readonly supportsRetrieval = false;
  readonly retrievalUnavailableReason =
    'Saarthi is not connected to a finance provider on this environment. ' +
    'Loan details are whatever you or your team recorded, and can be updated by hand or imported from a statement.';

  async fetchStatement(_request: ProviderStatementRequest): Promise<ProviderLoanStatement> {
    throw errors.providerNotConfigured('internal', this.retrievalUnavailableReason);
  }
}
