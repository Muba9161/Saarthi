import { describe, expect, it } from 'vitest';
import { EmiFrequency, InstallmentStatus, InterestType, LoanStatus } from './enums';
import {
  DEFAULT_REMINDER_OFFSETS,
  LoanDisclosureLevel,
  addMonthsClamped,
  calculateEmi,
  computeLoanPosition,
  daysBetween,
  deriveInstallmentStatus,
  generateSchedule,
  installmentCount,
  loanIsServiceable,
  maskLoanNumber,
  maskMandateReference,
  reminderIsDue,
  reminderOffsets,
  round2,
  scheduleTotals,
  type LoanTerms,
} from './loans';
import {
  maskEmail,
  maskLicenceNumber,
  maskName,
  maskPhone,
  maskReferenceNumber,
  maskRegistrationNumber,
} from './masking';

const utc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const TERMS: LoanTerms = {
  principal: 1_000_000,
  annualRatePercent: 12,
  interestType: InterestType.REDUCING_BALANCE,
  tenureMonths: 12,
  frequency: EmiFrequency.MONTHLY,
  firstDueDate: utc('2026-02-10'),
};

describe('EMI calculation', () => {
  it('matches the standard annuity formula for a reducing-balance loan', () => {
    // ₹10,00,000 at 12% p.a. over 12 months is a textbook ₹88,848.79.
    expect(calculateEmi(TERMS)).toBeCloseTo(88_848.79, 1);
  });

  it('spreads flat interest evenly across the tenure', () => {
    const emi = calculateEmi({ ...TERMS, interestType: InterestType.FLAT });
    // Principal 10,00,000 + 1,20,000 interest over 12 installments.
    expect(emi).toBeCloseTo(93_333.33, 1);
  });

  it('degrades to a straight division at a zero rate rather than dividing by zero', () => {
    expect(calculateEmi({ ...TERMS, annualRatePercent: 0 })).toBeCloseTo(83_333.33, 1);
  });

  it('scales the periodic rate with the installment frequency', () => {
    const quarterly = calculateEmi({ ...TERMS, frequency: EmiFrequency.QUARTERLY });
    expect(installmentCount(12, EmiFrequency.QUARTERLY)).toBe(4);
    // Four larger installments, each roughly a quarter's worth of the loan.
    expect(quarterly).toBeGreaterThan(250_000);
    expect(quarterly).toBeLessThan(280_000);
  });
});

describe('amortisation schedule', () => {
  it('produces one row per installment', () => {
    expect(generateSchedule(TERMS)).toHaveLength(12);
  });

  it('sums the principal columns to exactly the amount borrowed', () => {
    const totals = scheduleTotals(generateSchedule(TERMS));
    expect(totals.principal).toBe(TERMS.principal);
  });

  it('closes the final installment at a zero balance', () => {
    const rows = generateSchedule(TERMS);
    expect(rows[rows.length - 1]?.closingBalance).toBe(0);
  });

  it('reduces the interest component every period on a reducing-balance loan', () => {
    const rows = generateSchedule(TERMS);
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index]!.interest).toBeLessThan(rows[index - 1]!.interest);
    }
  });

  it('keeps flat-rate interest constant except for the rounding row', () => {
    const rows = generateSchedule({ ...TERMS, interestType: InterestType.FLAT });
    const middle = rows.slice(0, -1).map((row) => row.interest);
    expect(new Set(middle).size).toBe(1);
    expect(scheduleTotals(rows).principal).toBe(TERMS.principal);
  });

  it('holds the day of month and clamps into a short February', () => {
    const rows = generateSchedule({ ...TERMS, firstDueDate: utc('2026-01-31'), tenureMonths: 3 });
    expect(rows.map((row) => row.dueDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      // February has 28 days in 2026 — the EMI must not roll into March.
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('returns nothing for a zero principal instead of a schedule of zeroes', () => {
    expect(generateSchedule({ ...TERMS, principal: 0 })).toEqual([]);
  });
});

describe('installment status', () => {
  const now = utc('2026-03-15');

  it('marks an unpaid past installment overdue', () => {
    expect(
      deriveInstallmentStatus({ dueDate: utc('2026-03-10'), totalDue: 1000, amountPaid: 0 }, now),
    ).toBe(InstallmentStatus.OVERDUE);
  });

  it('flags the configured window before the due date', () => {
    expect(
      deriveInstallmentStatus({ dueDate: utc('2026-03-18'), totalDue: 1000, amountPaid: 0 }, now, 4),
    ).toBe(InstallmentStatus.DUE_SOON);
    expect(
      deriveInstallmentStatus({ dueDate: utc('2026-03-25'), totalDue: 1000, amountPaid: 0 }, now, 4),
    ).toBe(InstallmentStatus.UPCOMING);
  });

  it('separates due-today from due-soon', () => {
    expect(
      deriveInstallmentStatus({ dueDate: utc('2026-03-15'), totalDue: 1000, amountPaid: 0 }, now),
    ).toBe(InstallmentStatus.DUE_TODAY);
  });

  it('treats a one-rupee shortfall as settled, not as partially paid', () => {
    expect(
      deriveInstallmentStatus({ dueDate: utc('2026-03-20'), totalDue: 1000, amountPaid: 999.5 }, now),
    ).toBe(InstallmentStatus.PAID);
  });

  it('reports a part payment on a future installment as partially paid', () => {
    expect(
      deriveInstallmentStatus({ dueDate: utc('2026-03-20'), totalDue: 1000, amountPaid: 400 }, now),
    ).toBe(InstallmentStatus.PARTIALLY_PAID);
  });

  it('never infers a payment state the source did not disclose', () => {
    // The critical case: a lender statement that omits the payment state must
    // not become PAID (understating debt) or OVERDUE (a false credit signal).
    expect(
      deriveInstallmentStatus(
        { dueDate: utc('2026-01-10'), totalDue: 1000, amountPaid: 0, sourceUnknown: true },
        now,
      ),
    ).toBe(InstallmentStatus.UNKNOWN);
  });

  it('keeps terminal states even when the date has passed', () => {
    expect(
      deriveInstallmentStatus(
        {
          dueDate: utc('2026-01-10'),
          totalDue: 1000,
          amountPaid: 0,
          explicitStatus: InstallmentStatus.WAIVED,
        },
        now,
      ),
    ).toBe(InstallmentStatus.WAIVED);
  });
});

describe('loan position', () => {
  const now = utc('2026-04-15');

  const row = (
    number: number,
    dueDate: string,
    status: InstallmentStatus,
    amountPaid = 0,
  ) => ({
    number,
    dueDate: utc(dueDate),
    principal: 800,
    interest: 200,
    totalDue: 1000,
    amountPaid,
    status,
  });

  it('aggregates paid, remaining and overdue counts', () => {
    const position = computeLoanPosition(
      [
        row(1, '2026-02-10', InstallmentStatus.PAID, 1000),
        row(2, '2026-03-10', InstallmentStatus.PAID, 1000),
        row(3, '2026-04-10', InstallmentStatus.OVERDUE),
        row(4, '2026-05-10', InstallmentStatus.UPCOMING),
      ],
      now,
    );

    expect(position.paidInstallments).toBe(2);
    expect(position.remainingInstallments).toBe(2);
    expect(position.overdueInstallments).toBe(1);
    expect(position.overdueAmount).toBe(1000);
    expect(position.totalOutstanding).toBe(2000);
    expect(position.completionPercent).toBe(50);
  });

  it('splits an outstanding installment between principal and interest', () => {
    const position = computeLoanPosition([row(1, '2026-05-10', InstallmentStatus.UPCOMING)], now);
    expect(position.outstandingPrincipal).toBe(800);
    expect(position.outstandingInterest).toBe(200);
  });

  it('reduces both components proportionally after a part payment', () => {
    const position = computeLoanPosition(
      [row(1, '2026-05-10', InstallmentStatus.PARTIALLY_PAID, 500)],
      now,
    );
    expect(position.outstandingPrincipal).toBe(400);
    expect(position.outstandingInterest).toBe(100);
  });

  it('excludes unknown installments from both sides and counts them separately', () => {
    const position = computeLoanPosition(
      [
        row(1, '2026-02-10', InstallmentStatus.PAID, 1000),
        row(2, '2026-03-10', InstallmentStatus.UNKNOWN),
        row(3, '2026-05-10', InstallmentStatus.UPCOMING),
      ],
      now,
    );

    expect(position.unknownInstallments).toBe(1);
    expect(position.hasUnknownState).toBe(true);
    // The unknown row contributes to neither the paid count nor the balance.
    expect(position.paidInstallments).toBe(1);
    expect(position.totalOutstanding).toBe(1000);
    expect(position.completionPercent).toBe(50);
  });

  it('treats a waived installment as settled without counting it as repaid', () => {
    const position = computeLoanPosition(
      [row(1, '2026-03-10', InstallmentStatus.WAIVED), row(2, '2026-05-10', InstallmentStatus.UPCOMING)],
      now,
    );
    expect(position.paidInstallments).toBe(1);
    expect(position.totalOutstanding).toBe(1000);
  });

  it('surfaces the earliest overdue installment as the next thing to pay', () => {
    const position = computeLoanPosition(
      [row(1, '2026-03-10', InstallmentStatus.OVERDUE), row(2, '2026-04-10', InstallmentStatus.OVERDUE)],
      now,
    );
    expect(position.nextDueDate?.toISOString().slice(0, 10)).toBe('2026-03-10');
  });

  it('reports a fully settled loan as complete', () => {
    const position = computeLoanPosition(
      [row(1, '2026-02-10', InstallmentStatus.PAID, 1000)],
      now,
    );
    expect(position.completionPercent).toBe(100);
    expect(position.totalOutstanding).toBe(0);
    expect(position.nextDueDate).toBeNull();
  });
});

describe('reminders', () => {
  it('defaults to T-4, T-1 and a T+1 overdue check', () => {
    expect(DEFAULT_REMINDER_OFFSETS.map((offset) => offset.offsetDays)).toEqual([-4, -1, 1]);
    expect(reminderOffsets(null)).toEqual(DEFAULT_REMINDER_OFFSETS);
    expect(reminderOffsets([])).toEqual(DEFAULT_REMINDER_OFFSETS);
  });

  it('accepts a configured override', () => {
    expect(reminderOffsets([-7, -2, 3]).map((offset) => offset.offsetDays)).toEqual([-7, -2, 3]);
  });

  it('fires once the reminder date is reached and not before', () => {
    const due = utc('2026-05-10');
    expect(reminderIsDue(due, -4, utc('2026-05-05'))).toBe(false);
    expect(reminderIsDue(due, -4, utc('2026-05-06'))).toBe(true);
    expect(reminderIsDue(due, 1, utc('2026-05-10'))).toBe(false);
    expect(reminderIsDue(due, 1, utc('2026-05-11'))).toBe(true);
  });
});

describe('disclosure', () => {
  it('hides the loan number entirely below operational level', () => {
    expect(maskLoanNumber('LOAN-123456789', LoanDisclosureLevel.SUMMARY).value).toBeNull();
    expect(maskLoanNumber('LOAN-123456789', LoanDisclosureLevel.NONE).value).toBeNull();
  });

  it('partially masks the loan number at operational level', () => {
    const result = maskLoanNumber('LOAN-123456789', LoanDisclosureLevel.OPERATIONAL);
    expect(result.value).toBe('LOAN-*****6789');
    expect(result.masked).toBe(true);
  });

  it('discloses the loan number in full only at owner level', () => {
    const result = maskLoanNumber('LOAN-123456789', LoanDisclosureLevel.FULL);
    expect(result.value).toBe('LOAN-123456789');
    expect(result.masked).toBe(false);
  });

  it('never partially discloses a mandate reference', () => {
    // A mandate reference can be used to dispute or trace a debit, so unlike
    // the loan number there is no half-way disclosure.
    expect(maskMandateReference('NACH00099911', LoanDisclosureLevel.OPERATIONAL).value).toBeNull();
    expect(maskMandateReference('NACH00099911', LoanDisclosureLevel.FULL).value).toBe(
      'NACH00099911',
    );
  });
});

describe('masking primitives', () => {
  it('masks a phone number to its first and last two digits', () => {
    expect(maskPhone('9876543210')).toBe('98******10');
    expect(maskPhone('+919876543210')).toBe('98******10');
  });

  it('masks a licence number keeping the prefix and the last four', () => {
    expect(maskLicenceNumber('DL-123456789012')).toBe('DL-1234****9012');
  });

  it('masks a reference keeping only the last four', () => {
    expect(maskReferenceNumber('LOAN-123456789')).toBe('LOAN-*****6789');
  });

  it('fully masks a value too short for the window to protect anything', () => {
    expect(maskPhone('12345')).toBe('*****');
    expect(maskReferenceNumber('AB-12')).toBe('AB-**');
  });

  it('leaves an email domain readable', () => {
    expect(maskEmail('ramesh@example.com')).toBe('r****h@example.com');
  });

  it('shortens a name to its first name and last initial', () => {
    expect(maskName('Ramesh Kumar')).toBe('Ramesh K.');
    expect(maskName('Ramesh')).toBe('Ramesh');
  });

  it('keeps the RTO and series of a registration number', () => {
    expect(maskRegistrationNumber('UP32 AB 1234')).toBe('UP32AB****');
  });

  it('returns null for absent values rather than a mask of nothing', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskLicenceNumber(undefined)).toBeNull();
  });
});

describe('date helpers', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween(utc('2026-03-01'), utc('2026-03-05'))).toBe(4);
    expect(daysBetween(utc('2026-03-05'), utc('2026-03-01'))).toBe(-4);
  });

  it('clamps a month-end date into a shorter month', () => {
    expect(addMonthsClamped(utc('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonthsClamped(utc('2026-01-31'), 3).toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('rounds money to paise', () => {
    expect(round2(1234.5678)).toBe(1234.57);
    expect(round2(0.005)).toBe(0.01);
  });
});

describe('loan servicing state', () => {
  it('services active and defaulted loans only', () => {
    expect(loanIsServiceable(LoanStatus.ACTIVE)).toBe(true);
    expect(loanIsServiceable(LoanStatus.DEFAULTED)).toBe(true);
    expect(loanIsServiceable(LoanStatus.CLOSED)).toBe(false);
    expect(loanIsServiceable(LoanStatus.DRAFT)).toBe(false);
  });
});
