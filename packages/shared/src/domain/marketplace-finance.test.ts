import { describe, expect, it } from 'vitest';
import {
  BACKHAUL_COMMISSION_RULE,
  MARKETPLACE_COMMISSION_RULE,
  OrderFinanceStage,
  balanceDue,
  canMoveFinanceStage,
  commissionRuleFor,
  confirmationAmount,
  finalCustomerAmount,
  maskBankAccount,
  profitCommission,
} from './marketplace-finance';

describe('marketplace finance', () => {
  it('takes 2% of profit, never of the customer payment', () => {
    const commission = profitCommission({ revenue: 62500, costBasis: 50000 });
    expect(commission.profitBasis).toBe(12500);
    expect(commission.amount).toBe(250);
    expect(commission.amount).not.toBe(62500 * 0.02);
    expect(commission.rate).toBe(0.02);
    expect(commission.ruleVersion).toBe(MARKETPLACE_COMMISSION_RULE.version);
  });

  it('earns nothing on a loss', () => {
    expect(profitCommission({ revenue: 40000, costBasis: 50000 })).toMatchObject({ profitBasis: 0, amount: 0 });
  });

  it('takes 3% of profit on a job won through backhaul', () => {
    const rule = commissionRuleFor({ isReturnLoad: true });
    expect(rule).toBe(BACKHAUL_COMMISSION_RULE);
    const commission = profitCommission({ revenue: 62500, costBasis: 50000 }, rule);
    expect(commission.profitBasis).toBe(12500);
    expect(commission.amount).toBe(375);
    expect(commission.rate).toBe(0.03);
    expect(commission.ruleVersion).toBe('BACKHAUL_PROFIT_V1');
    // Still nothing on a loss.
    expect(profitCommission({ revenue: 40000, costBasis: 50000 }, rule).amount).toBe(0);
  });

  it('keeps an ordinary job on the ordinary rule', () => {
    expect(commissionRuleFor({ isReturnLoad: false })).toBe(MARKETPLACE_COMMISSION_RULE);
  });

  it('applies the same principle to travel', () => {
    expect(profitCommission({ revenue: 20000, costBasis: 12000 }).amount).toBe(160);
  });

  it('splits a freight order 30 / 70', () => {
    expect(confirmationAmount(62500)).toBe(18750);
    expect(balanceDue({ finalAmount: 62500, paidSoFar: 18750 })).toBe(43750);
  });

  it('charges a short delivery pro rata, and never more than agreed', () => {
    expect(finalCustomerAmount({ agreedAmount: 62500, orderedQuantity: 25, deliveredQuantity: 20 })).toBe(50000);
    expect(finalCustomerAmount({ agreedAmount: 62500, orderedQuantity: 25, deliveredQuantity: 30 })).toBe(62500);
    expect(balanceDue({ finalAmount: 10000, paidSoFar: 18750 })).toBe(0);
  });

  it('moves the money stages only forwards', () => {
    expect(canMoveFinanceStage(OrderFinanceStage.PAYMENT_30_REQUIRED, OrderFinanceStage.PAYMENT_30_PAID)).toBe(true);
    expect(canMoveFinanceStage(OrderFinanceStage.PAYMENT_30_REQUIRED, OrderFinanceStage.PAYMENT_70_PAID)).toBe(false);
    expect(canMoveFinanceStage(OrderFinanceStage.PROCUREMENT_PAID, OrderFinanceStage.CANCELLED)).toBe(false);
    expect(canMoveFinanceStage(OrderFinanceStage.FINALIZED, OrderFinanceStage.CANCELLED)).toBe(false);
  });

  it('masks a bank account to its last four digits', () => {
    expect(maskBankAccount('4321')).toBe('XXXX XXXX 4321');
  });
});
