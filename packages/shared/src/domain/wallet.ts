/**
 * The Saarthi wallet — Refer & Earn rewards, and cash-out to the holder's own
 * bank account. Contract types shared by the API and the client.
 *
 * Amounts are rupees. The balance is never stored: it is the sum of ledger
 * entries, so a reward, a cash-out and a failed cash-out's reversal each leave
 * a row that explains the figure.
 */

import type { BankAccountStatus } from './marketplace-finance';
import type { WalletCashoutStatus } from './enums';

export interface WalletBankAccountView {
  accountHolderName: string;
  /** Only ever the last four digits — the full number is not stored. */
  accountLast4: string;
  ifsc: string;
  bankName: string | null;
  /** The name the bank returned during penny validation. */
  nameAtBank: string | null;
  status: BankAccountStatus;
  failureReason: string | null;
  verifiedAt: string | null;
}

/** `GET /wallet`. */
export interface WalletSummary {
  /** Can be cashed out now. */
  available: number;
  /** Rewards still inside their hold period. */
  held: number;
  /** Every reward ever credited and not voided. */
  totalEarned: number;
  minCashout: number;
  holdDays: number;
  /** False where no real payout provider is configured for this deployment. */
  cashoutEnabled: boolean;
  bankAccount: WalletBankAccountView | null;
}

/** One row of `GET /wallet/cashouts`. */
export interface WalletCashoutView {
  id: string;
  amount: number;
  status: WalletCashoutStatus;
  accountLast4: string;
  failureReason: string | null;
  requestedAt: string;
  completedAt: string | null;
}
