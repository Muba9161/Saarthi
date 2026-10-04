/**
 * Marketplace money: what a customer pays, what a provider earns, and what
 * Saarthi takes.
 *
 * Saarthi's marketplace commission is **2% of the provider's profit** — never
 * of the gross customer payment:
 *
 *   Freight:  customer selling amount − confirmed supplier procurement = profit
 *   Travel:   customer payment − recorded trip/package costs           = profit
 *   Saarthi commission = profit × 2%
 *
 * A job won as a **backhaul** — the return leg of a completed trip, found
 * through "Enable backhaul" — is charged at 3% of profit instead. The owner
 * agrees to that rate when enabling backhaul, and it is collected the same way:
 * held back from the customer's final 70% payment.
 *
 * These rules are pure and versioned so every surface — the API, the order
 * screen, the provider's summary — computes the same figures, and a historical
 * commission can always be explained by the rule version it was calculated
 * under. The ledger stores the result; it is never recomputed.
 *
 * This is separate from SaaS subscription billing and from salesperson (GODID)
 * commission, which live in their own modules.
 */

const toPaise = (amount: number): number => Math.round(amount * 100) / 100;

/** A versioned commission rate on profit. */
export interface CommissionRule {
  version: string;
  /** Share of the provider's profit. */
  rate: number;
}

/** The rule every marketplace commission is calculated under. */
export const MARKETPLACE_COMMISSION_RULE = {
  version: 'MARKETPLACE_PROFIT_V1',
  rate: 0.02,
} as const satisfies CommissionRule;

/** The rule for a job won as a backhaul — the return leg of a completed trip. */
export const BACKHAUL_COMMISSION_RULE = {
  version: 'BACKHAUL_PROFIT_V1',
  rate: 0.03,
} as const satisfies CommissionRule;

/** The commission rule an order is charged under. */
export function commissionRuleFor(order: { isReturnLoad: boolean }): CommissionRule {
  return order.isReturnLoad ? BACKHAUL_COMMISSION_RULE : MARKETPLACE_COMMISSION_RULE;
}

/** Share of a freight order the customer pays when the order is confirmed. */
export const FREIGHT_CONFIRMATION_SHARE = 0.3;

/** Where a commission comes from — marketplace profit is not a referral or a sale. */
export const CommissionSource = {
  MARKETPLACE_PROFIT: 'MARKETPLACE_PROFIT',
  GENERIC_REFERRAL: 'GENERIC_REFERRAL',
  SALESMAN_GODID: 'SALESMAN_GODID',
} as const;
export type CommissionSource = (typeof CommissionSource)[keyof typeof CommissionSource];

/** A provider's bank account, from connection to usable. */
export const BankAccountStatus = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
} as const;
export type BankAccountStatus = (typeof BankAccountStatus)[keyof typeof BankAccountStatus];

/**
 * A fleet-sourced freight order's money stages.
 *
 *   PAYMENT_30_REQUIRED → PAYMENT_30_PAID → PROCUREMENT_PAID
 *   → PAYMENT_70_REQUIRED (after delivery is confirmed) → PAYMENT_70_PAID
 *   → FINALIZED
 *
 * The operational stages (loading, trip, delivery) stay on the order and trip
 * themselves; this tracks only the money.
 */
export const OrderFinanceStage = {
  PAYMENT_30_REQUIRED: 'PAYMENT_30_REQUIRED',
  PAYMENT_30_PAID: 'PAYMENT_30_PAID',
  PROCUREMENT_PAID: 'PROCUREMENT_PAID',
  PAYMENT_70_REQUIRED: 'PAYMENT_70_REQUIRED',
  PAYMENT_70_PAID: 'PAYMENT_70_PAID',
  FINALIZED: 'FINALIZED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderFinanceStage = (typeof OrderFinanceStage)[keyof typeof OrderFinanceStage];

/** Stages from which the next money movement is allowed. */
export const ORDER_FINANCE_TRANSITIONS: Record<OrderFinanceStage, readonly OrderFinanceStage[]> = {
  PAYMENT_30_REQUIRED: [OrderFinanceStage.PAYMENT_30_PAID, OrderFinanceStage.CANCELLED],
  PAYMENT_30_PAID: [OrderFinanceStage.PROCUREMENT_PAID, OrderFinanceStage.CANCELLED],
  PROCUREMENT_PAID: [OrderFinanceStage.PAYMENT_70_REQUIRED],
  PAYMENT_70_REQUIRED: [OrderFinanceStage.PAYMENT_70_PAID],
  PAYMENT_70_PAID: [OrderFinanceStage.FINALIZED],
  FINALIZED: [],
  CANCELLED: [],
};

export function canMoveFinanceStage(from: OrderFinanceStage, to: OrderFinanceStage): boolean {
  return ORDER_FINANCE_TRANSITIONS[from].includes(to);
}

/** The confirmation payment: 30% of the agreed selling amount, to the paisa. */
export function confirmationAmount(agreedAmount: number): number {
  return toPaise(agreedAmount * FREIGHT_CONFIRMATION_SHARE);
}

/**
 * What the customer finally owes for what was actually delivered.
 *
 * Pro rata on the delivered share of the ordered quantity, never more than
 * agreed. A full delivery is exactly the agreed amount.
 */
export function finalCustomerAmount(input: {
  agreedAmount: number;
  orderedQuantity: number;
  deliveredQuantity: number;
}): number {
  if (input.orderedQuantity <= 0) return toPaise(input.agreedAmount);
  const share = Math.min(1, Math.max(0, input.deliveredQuantity / input.orderedQuantity));
  return toPaise(input.agreedAmount * share);
}

/** The balance due after delivery: the final amount less what was already paid. */
export function balanceDue(input: { finalAmount: number; paidSoFar: number }): number {
  return toPaise(Math.max(0, input.finalAmount - input.paidSoFar));
}

export interface ProfitCommission {
  revenue: number;
  costBasis: number;
  /** Revenue less cost, never below zero — a loss earns no commission. */
  profitBasis: number;
  rate: number;
  amount: number;
  ruleVersion: string;
}

/**
 * Saarthi's commission on a provider's profit.
 *
 * `profitBasis × rate` — calculated on what the provider actually earned, so a
 * ₹62,500 order bought in at ₹50,000 pays ₹250 at 2%, not ₹1,250.
 */
export function profitCommission(
  input: { revenue: number; costBasis: number },
  rule: CommissionRule = MARKETPLACE_COMMISSION_RULE,
): ProfitCommission {
  const profitBasis = toPaise(Math.max(0, input.revenue - input.costBasis));
  return {
    revenue: toPaise(input.revenue),
    costBasis: toPaise(input.costBasis),
    profitBasis,
    rate: rule.rate,
    amount: toPaise(profitBasis * rule.rate),
    ruleVersion: rule.version,
  };
}

/** A bank account number shown as `XXXX XXXX 4321`. */
export function maskBankAccount(last4: string): string {
  return `XXXX XXXX ${last4}`;
}
