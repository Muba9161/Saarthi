import type {
  EmiFrequency,
  InstallmentStatus,
  InterestType,
  LoanStatus,
} from '@saarthi/shared';

/**
 * Vehicle finance provider abstraction.
 *
 * The important thing this interface encodes is what a loan number is *not*:
 * it is not a lookup key. Retrieving a repayment schedule from a financier
 * requires a provider that is actually integrated, an account the borrower can
 * prove they hold, and a consent artefact — so `supportsRetrieval` exists and
 * the internal provider returns `false` from it rather than pretending a
 * lookup failed for some transient reason.
 *
 * Every provider normalises into the shapes below. Nothing lender-specific
 * reaches a service or a component.
 */

export interface ProviderInstallment {
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  totalDue: number;
  /** Omitted when the statement did not disclose a payment state. */
  status?: InstallmentStatus;
  amountPaid?: number;
  paidAt?: string | null;
  paymentReference?: string | null;
}

export interface ProviderLoanStatement {
  loanNumber: string;
  lenderName: string | null;
  borrowerName: string | null;
  principal: number | null;
  disbursedAmount: number | null;
  annualRatePercent: number | null;
  interestType: InterestType | null;
  tenureMonths: number | null;
  frequency: EmiFrequency | null;
  emiAmount: number | null;
  startDate: string | null;
  firstDueDate: string | null;
  status: LoanStatus | null;

  outstandingPrincipal: number | null;
  outstandingInterest: number | null;
  totalOutstanding: number | null;
  nextDueDate: string | null;
  paidInstallments: number | null;

  installments: ProviderInstallment[];

  /** Provenance. Never dropped: it is what makes the figures auditable. */
  provider: string;
  providerReference: string | null;
  retrievedAt: string;
  /**
   * `true` when the figures were generated locally for development. Callers
   * must persist this so a simulated balance is never presented as a fact
   * obtained from a financier.
   */
  simulated: boolean;
}

export interface ProviderStatementRequest {
  loanNumber: string;
  lenderName: string | null;
  /** Reference to the borrower's consent to retrieve, when the flow needs one. */
  consentReference?: string | null;
  /** The loan as Saarthi currently holds it, for providers that reconcile. */
  known?: {
    principal: number;
    annualRatePercent: number;
    interestType: InterestType;
    tenureMonths: number;
    frequency: EmiFrequency;
    firstDueDate: Date;
    emiAmount: number;
  };
}

export interface LoanProvider {
  readonly name: string;
  /**
   * Whether this provider can fetch a statement at all. `false` is a normal,
   * expected answer — most deployments record loans by hand.
   */
  readonly supportsRetrieval: boolean;
  /** Human-readable reason shown when retrieval is unavailable. */
  readonly retrievalUnavailableReason: string;
  fetchStatement(request: ProviderStatementRequest): Promise<ProviderLoanStatement>;
}
