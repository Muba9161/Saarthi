import type { BankAccountStatus, CheckoutSession, OrderFinanceStage } from '@saarthi/shared';

/** `GET /finance/payout-account` — the full account number never comes back. */
export interface PayoutAccountView {
  status: BankAccountStatus;
  accountHolderName: string | null;
  maskedAccount: string | null;
  ifsc: string | null;
  bankName: string | null;
  nameAtBank: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
  /** True once marketplace payments can be routed to it. */
  usable: boolean;
}

/** One row of `GET /finance/commissions`. */
export interface MarketplaceCommissionView {
  id: string;
  source: string;
  kind: 'FREIGHT_ORDER' | 'TRAVEL_BOOKING';
  orderId: string | null;
  bookingId: string | null;
  revenue: number;
  costBasis: number;
  profitBasis: number;
  rate: number;
  amount: number;
  ruleVersion: string;
  status: string;
  calculatedAt: string;
}

/** `GET /orders/:id/finance` — null when the order has no marketplace payment plan. */
export interface OrderFinanceSummary {
  orderId: string;
  stage: OrderFinanceStage;
  role: 'CUSTOMER' | 'FLEET' | 'SUPPLIER' | 'ADMIN';
  agreedAmount: number;
  confirmationAmount: number;
  orderedQuantity: number;
  deliveredQuantity: number | null;
  finalAmount: number | null;
  balanceDue: number;
  payments: { stage: string; amount: number; status: string; reference: string; at: string }[];
  provider: {
    procurementReference: number | null;
    procurementAmount: number | null;
    profitBasis: number;
    commissionRate: number;
    commissionAmount: number;
    netAfterCommission: number;
    final: boolean;
    ruleVersion: string;
  } | null;
  supplier: { procurementAmount: number | null } | null;
}

/** `GET /travel/bookings/:id/finance` — the provider's view of one booking. */
export interface BookingFinanceSummary {
  bookingId: string;
  customerPayment: number;
  costs: { label: string; amount: number }[] | null;
  recordedCosts: number | null;
  profitBasis: number | null;
  commissionRate: number;
  commissionAmount: number | null;
  netAfterCommission: number | null;
  final: boolean;
  settlementStatus: string | null;
}

export interface CheckoutResponse {
  checkout: CheckoutSession | null;
}
