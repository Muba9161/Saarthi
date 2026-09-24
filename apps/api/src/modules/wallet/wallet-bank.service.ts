import {
  BankAccountStatus,
  type ConnectWalletBankAccountInput,
  type WalletBankAccountView,
} from '@saarthi/shared';
import { isUniqueViolation, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { hashIdentityNumber } from '../../lib/identity-crypto';
import { paymentProvider } from '../../providers/payments';
import { createBeneficiary } from '../../providers/payouts/cashfree-payouts';
import { AuditAction, recordAudit } from '../audit/audit.service';
import type { AuthContext } from '../../auth/context';

/**
 * The bank account a wallet cashes out to.
 *
 * Two checks stand between a referral reward and a bank transfer, both
 * automatic:
 *
 *   * **Penny validation** — the bank confirms the account exists and returns
 *     the holder's name, through the same verification the marketplace payout
 *     account uses.
 *   * **One account, one person** — a keyed fingerprint of the account number
 *     is unique across Saarthi, so a ring of fake referrers cannot all cash out
 *     to the same place.
 *
 * The full account number is used for those two calls and for registering the
 * payout beneficiary, and is never stored.
 */

type BankRow = {
  accountHolderName: string;
  accountLast4: string;
  ifsc: string;
  bankName: string | null;
  nameAtBank: string | null;
  status: string;
  failureReason: string | null;
  verifiedAt: Date | null;
};

export function toBankView(row: BankRow): WalletBankAccountView {
  return {
    accountHolderName: row.accountHolderName,
    accountLast4: row.accountLast4,
    ifsc: row.ifsc,
    bankName: row.bankName,
    nameAtBank: row.nameAtBank,
    status: row.status as BankAccountStatus,
    failureReason: row.failureReason,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

const alreadyLinked = () =>
  errors.conflict('This bank account is already linked to another Saarthi account.');

export async function connectBankAccount(
  auth: AuthContext,
  input: ConnectWalletBankAccountInput,
): Promise<WalletBankAccountView> {
  // Checked before the penny drop, which costs money per call.
  if (!config.wallet.cashoutEnabled) {
    throw errors.providerNotConfigured(
      'cashfree',
      'Cash-out is not available yet, so there is no bank account to connect. Your rewards are safe.',
    );
  }

  const userId = auth.user.id;
  const fingerprint = hashIdentityNumber('WALLET_BANK', `${input.ifsc}:${input.accountNumber}`);

  const owner = await prisma.walletBankAccount.findUnique({
    where: { accountFingerprint: fingerprint },
    select: { userId: true },
  });
  if (owner && owner.userId !== userId) throw alreadyLinked();

  const base = {
    accountHolderName: input.accountHolderName,
    accountLast4: input.accountNumber.slice(-4),
    ifsc: input.ifsc,
    accountFingerprint: fingerprint,
    status: BankAccountStatus.PENDING_VERIFICATION,
    bankName: null,
    nameAtBank: null,
    verificationReference: null,
    failureReason: null,
    verifiedAt: null,
    beneficiaryId: null,
  };
  try {
    await prisma.walletBankAccount.upsert({
      where: { userId },
      create: { userId, ...base },
      update: base,
    });
  } catch (error) {
    // The same account claimed by someone else between the read and the write.
    if (isUniqueViolation(error)) throw alreadyLinked();
    throw error;
  }

  const verification = await paymentProvider.verifyBankAccount({
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    name: input.accountHolderName,
    phone: auth.user.phone,
  });

  if (verification.status !== 'VALID') {
    const row = await prisma.walletBankAccount.update({
      where: { userId },
      data: {
        status:
          verification.status === 'INVALID'
            ? BankAccountStatus.FAILED
            : BankAccountStatus.PENDING_VERIFICATION,
        verificationReference: verification.reference,
        failureReason: verification.reason,
      },
    });
    await audit(userId, verification.status);
    return toBankView(row);
  }

  // Keyed on the account itself, so reconnecting the same account reuses its
  // beneficiary and a different account never inherits another's.
  const beneficiaryId = `SW${fingerprint.slice(0, 40)}`;
  await createBeneficiary({
    beneficiaryId,
    name: verification.nameAtBank ?? input.accountHolderName,
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    email: auth.user.email,
    phone: auth.user.phone,
  });

  const row = await prisma.walletBankAccount.update({
    where: { userId },
    data: {
      status: BankAccountStatus.VERIFIED,
      verifiedAt: new Date(),
      bankName: verification.bankName,
      nameAtBank: verification.nameAtBank,
      verificationReference: verification.reference,
      beneficiaryId,
    },
  });
  await audit(userId, 'VALID');
  return toBankView(row);
}

async function audit(userId: string, result: string): Promise<void> {
  await recordAudit({
    action: AuditAction.WALLET_BANK_CONNECTED,
    entityType: 'WalletBankAccount',
    entityId: userId,
    actorUserId: userId,
    // The outcome only — never the account details.
    after: { result },
  });
}
