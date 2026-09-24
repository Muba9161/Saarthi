import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { CashfreeHttpError, cashfree, type CashfreeTarget } from '../payments/cashfree-payment.provider';

/**
 * Cashfree Payouts (API v2) — money leaving Saarthi for a person's own bank
 * account, used by wallet cash-outs.
 *
 * Separate from the payment provider: payments take money in and split it to
 * marketplace vendors, while a payout sends Saarthi's own money out from a
 * pre-funded balance, with different keys.
 *
 * A beneficiary is registered once, when the holder's bank account passes
 * penny validation, so the full account number goes to Cashfree then and is
 * never kept by Saarthi. Each cash-out is a transfer to that beneficiary keyed
 * on Saarthi's own transfer id, so a status check always uses a value Saarthi
 * already holds.
 *
 * Cashfree only accepts calls from an IP whitelisted in the Payouts dashboard.
 */

const log = logger.child({ module: 'payouts', provider: 'cashfree' });

export type TransferOutcome = 'PAID' | 'PENDING' | 'FAILED';

export interface TransferResult {
  status: TransferOutcome;
  providerReference: string | null;
  failureReason: string | null;
}

/** Terminal failures. Anything that is neither this nor SUCCESS is still in flight. */
const FAILED_STATUSES = new Set(['FAILED', 'REJECTED', 'REVERSED', 'MANUALLY_REJECTED']);

interface CashfreeTransfer {
  cf_transfer_id?: string | number;
  status?: string;
  status_description?: string;
}

function target(): CashfreeTarget {
  if (!config.wallet.cashoutEnabled) {
    throw errors.providerNotConfigured(
      'cashfree',
      'Cash-out is not available yet. Your balance is safe and will be ready to withdraw soon.',
    );
  }
  return {
    baseUrl: config.cashfree.payouts.baseUrl,
    clientId: config.cashfree.payouts.clientId,
    clientSecret: config.cashfree.payouts.clientSecret,
    apiVersion: config.cashfree.payouts.apiVersion,
  };
}

function toResult(body: CashfreeTransfer): TransferResult {
  const status = (body.status ?? '').toUpperCase();
  const failed = FAILED_STATUSES.has(status);
  return {
    status: status === 'SUCCESS' ? 'PAID' : failed ? 'FAILED' : 'PENDING',
    providerReference: body.cf_transfer_id === undefined ? null : String(body.cf_transfer_id),
    failureReason: failed ? (body.status_description ?? status) : null,
  };
}

function providerError(error: unknown, action: string): Error {
  if (error instanceof CashfreeHttpError) {
    log.warn({ status: error.status, code: error.body.code, action }, 'Cashfree Payouts refused a request');
    return errors.provider('cashfree', error.body.message ?? `Cashfree could not ${action}.`, error);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Register the bank account transfers go to. Idempotent on `beneficiaryId`. */
export async function createBeneficiary(input: {
  beneficiaryId: string;
  name: string;
  accountNumber: string;
  ifsc: string;
  email: string | null;
  phone: string | null;
}): Promise<void> {
  const phone = input.phone?.replace(/\D/g, '').slice(-10);
  try {
    await cashfree(
      'POST',
      '/beneficiary',
      {
        beneficiary_id: input.beneficiaryId,
        beneficiary_name: input.name.slice(0, 100),
        beneficiary_instrument_details: {
          bank_account_number: input.accountNumber,
          bank_ifsc: input.ifsc,
        },
        beneficiary_contact_details: {
          ...(input.email ? { beneficiary_email: input.email } : {}),
          ...(phone ? { beneficiary_phone: phone } : {}),
        },
      },
      target(),
    );
  } catch (error) {
    // Already registered under this id — the same person's account, which is
    // exactly the beneficiary wanted.
    if (error instanceof CashfreeHttpError && error.status === 409) return;
    throw providerError(error, 'register the bank account for payouts');
  }
}

export async function sendTransfer(input: {
  transferId: string;
  beneficiaryId: string;
  amount: number;
  remarks: string;
}): Promise<TransferResult> {
  try {
    const body = await cashfree<CashfreeTransfer>(
      'POST',
      '/transfers',
      {
        transfer_id: input.transferId,
        transfer_amount: input.amount,
        transfer_currency: 'INR',
        transfer_mode: 'banktransfer',
        beneficiary_details: { beneficiary_id: input.beneficiaryId },
        transfer_remarks: input.remarks.slice(0, 70),
      },
      target(),
    );
    return toResult(body);
  } catch (error) {
    throw providerError(error, 'send the payout');
  }
}

/** The authoritative outcome of a transfer, asked of Cashfree. */
export async function fetchTransfer(transferId: string): Promise<TransferResult> {
  try {
    const body = await cashfree<CashfreeTransfer>(
      'GET',
      `/transfers?transfer_id=${encodeURIComponent(transferId)}`,
      undefined,
      target(),
    );
    return toResult(body);
  } catch (error) {
    // Cashfree has no record of it: the transfer request never landed.
    if (error instanceof CashfreeHttpError && error.status === 404) {
      return {
        status: 'FAILED',
        providerReference: null,
        failureReason: 'The transfer was not received by the payout partner.',
      };
    }
    throw providerError(error, 'check the payout');
  }
}
