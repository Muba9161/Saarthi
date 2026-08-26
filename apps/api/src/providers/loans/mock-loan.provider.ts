import {
  InstallmentStatus,
  LoanStatus,
  calculateEmi,
  computeLoanPosition,
  deriveInstallmentStatus,
  generateSchedule,
  round2,
  type EmiFrequency,
  type InterestType,
} from '@saarthi/shared';
import { errors } from '../../lib/errors';
import type {
  LoanProvider,
  ProviderInstallment,
  ProviderLoanStatement,
  ProviderStatementRequest,
} from './loan.provider';

/**
 * Local development stand-in for a financier's statement API.
 *
 * It produces a schedule from the terms Saarthi already holds and then makes it
 * *slightly* disagree with our own computation — a rounded EMI, one installment
 * whose payment state the lender did not disclose. That disagreement is the
 * point: the reconciliation and conflict-review paths are the parts that break
 * in production, so local development has to exercise them rather than always
 * receiving a statement that matches perfectly.
 *
 * Every statement it returns is flagged `simulated: true`, and that flag is
 * persisted, so a demo balance can never be mistaken for a real one.
 */
export class MockLoanProvider implements LoanProvider {
  readonly name = 'mock';
  readonly supportsRetrieval = true;
  readonly retrievalUnavailableReason = '';

  async fetchStatement(request: ProviderStatementRequest): Promise<ProviderLoanStatement> {
    const known = request.known;
    if (!known) {
      // Without terms there is nothing to amortise. Inventing a principal would
      // be fabricating a debt, so this fails loudly instead.
      throw errors.provider(
        this.name,
        'The simulated finance provider needs the loan terms before it can produce a statement.',
      );
    }

    const schedule = generateSchedule({
      principal: known.principal,
      annualRatePercent: known.annualRatePercent,
      interestType: known.interestType as InterestType,
      tenureMonths: known.tenureMonths,
      frequency: known.frequency as EmiFrequency,
      firstDueDate: known.firstDueDate,
    });

    const now = new Date();
    // Lenders round the EMI to the rupee; Saarthi computes to the paisa.
    const lenderEmi = Math.ceil(
      calculateEmi({
        principal: known.principal,
        annualRatePercent: known.annualRatePercent,
        interestType: known.interestType as InterestType,
        tenureMonths: known.tenureMonths,
        frequency: known.frequency as EmiFrequency,
        firstDueDate: known.firstDueDate,
      }),
    );

    const installments: ProviderInstallment[] = schedule.map((row, index) => {
      const elapsed = row.dueDate.getTime() < now.getTime();
      // The most recent past installment is reported without a payment state,
      // which is exactly how a real statement behaves near the cut-off date.
      const lastElapsedIndex = schedule.filter((r) => r.dueDate.getTime() < now.getTime()).length - 1;
      const undisclosed = elapsed && index === lastElapsedIndex;

      if (undisclosed) {
        return {
          number: row.number,
          dueDate: row.dueDate.toISOString(),
          principal: row.principal,
          interest: row.interest,
          totalDue: row.totalDue,
          // No status and no amountPaid: the caller must resolve this to
          // UNKNOWN rather than assuming either outcome.
        };
      }

      return {
        number: row.number,
        dueDate: row.dueDate.toISOString(),
        principal: row.principal,
        interest: row.interest,
        totalDue: row.totalDue,
        status: elapsed ? InstallmentStatus.PAID : InstallmentStatus.UPCOMING,
        amountPaid: elapsed ? row.totalDue : 0,
        paidAt: elapsed ? row.dueDate.toISOString() : null,
        paymentReference: elapsed ? `SIM-${row.number.toString().padStart(4, '0')}` : null,
      };
    });

    const position = computeLoanPosition(
      installments.map((row) => ({
        number: row.number,
        dueDate: new Date(row.dueDate),
        principal: row.principal,
        interest: row.interest,
        totalDue: row.totalDue,
        amountPaid: row.amountPaid ?? 0,
        status:
          row.status ??
          deriveInstallmentStatus(
            {
              dueDate: new Date(row.dueDate),
              totalDue: row.totalDue,
              amountPaid: row.amountPaid ?? 0,
              sourceUnknown: true,
            },
            now,
          ),
      })),
      now,
    );

    return {
      loanNumber: request.loanNumber,
      lenderName: request.lenderName,
      borrowerName: null,
      principal: known.principal,
      disbursedAmount: round2(known.principal),
      annualRatePercent: known.annualRatePercent,
      interestType: known.interestType as InterestType,
      tenureMonths: known.tenureMonths,
      frequency: known.frequency as EmiFrequency,
      emiAmount: lenderEmi,
      startDate: null,
      firstDueDate: known.firstDueDate.toISOString(),
      status: LoanStatus.ACTIVE,
      outstandingPrincipal: position.outstandingPrincipal,
      outstandingInterest: position.outstandingInterest,
      totalOutstanding: position.totalOutstanding,
      nextDueDate: position.nextDueDate?.toISOString() ?? null,
      paidInstallments: position.paidInstallments,
      installments,
      provider: this.name,
      providerReference: `SIM-${request.loanNumber}`,
      retrievedAt: now.toISOString(),
      simulated: true,
    };
  }
}
