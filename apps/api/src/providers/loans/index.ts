import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { InternalLoanProvider } from './internal-loan.provider';
import { MockLoanProvider } from './mock-loan.provider';
import type { LoanProvider } from './loan.provider';

/**
 * Finance provider factory.
 *
 * Unlike the AI provider, this one does **not** fall back silently. If an
 * environment is configured to talk to a financier and cannot, the honest
 * answer is that retrieval is unavailable — quietly substituting simulated
 * figures for a real balance would be the single worst bug this module could
 * ship.
 */
function createLoanProvider(): LoanProvider {
  switch (config.finance.provider) {
    case 'mock':
      if (config.isProduction) {
        throw new Error(
          'LOAN_PROVIDER=mock is not permitted in production — simulated balances would be shown as real.',
        );
      }
      return new MockLoanProvider();
    case 'internal':
    default:
      return new InternalLoanProvider();
  }
}

export const loanProvider: LoanProvider = createLoanProvider();

logger.info(
  { provider: loanProvider.name, retrieval: loanProvider.supportsRetrieval },
  'Loan provider ready',
);

export * from './loan.provider';
