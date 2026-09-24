import {
  BankAccountStatus,
  maskBankAccount,
  type ConnectBankAccountInput,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { paymentProvider } from '../../providers/payments';
import { AuditAction, recordAudit } from '../audit/audit.service';
import type { AuthContext } from '../../auth/context';

/**
 * The bank account a provider or supplier is paid into.
 *
 *   Not connected → details submitted → penny validation → verified → usable
 *
 * Verified only on the bank's own answer (penny validation through the payment
 * provider), never because details were typed in. Once verified it is
 * registered as the provider's vendor, which is what payments are routed to.
 *
 * The full account number is used for those two calls and then dropped:
 * Saarthi stores its last four digits and nothing else.
 */

const payoutLogger = logger.child({ module: 'marketplace:payout-account' });

export interface PayoutAccountView {
  status: BankAccountStatus;
  accountHolderName: string | null;
  /** `XXXX XXXX 4321` — never the full number. */
  maskedAccount: string | null;
  ifsc: string | null;
  bankName: string | null;
  nameAtBank: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
  /** True once payments can be routed here. */
  usable: boolean;
}

const NOT_CONNECTED: PayoutAccountView = {
  status: BankAccountStatus.NOT_CONNECTED,
  accountHolderName: null,
  maskedAccount: null,
  ifsc: null,
  bankName: null,
  nameAtBank: null,
  verifiedAt: null,
  failureReason: null,
  usable: false,
};

function toView(row: {
  status: string;
  accountHolderName: string;
  accountLast4: string;
  ifsc: string;
  bankName: string | null;
  nameAtBank: string | null;
  verifiedAt: Date | null;
  failureReason: string | null;
  vendorId: string | null;
  vendorStatus: string | null;
}): PayoutAccountView {
  const status = row.status as BankAccountStatus;
  return {
    status,
    accountHolderName: row.accountHolderName,
    maskedAccount: maskBankAccount(row.accountLast4),
    ifsc: row.ifsc,
    bankName: row.bankName,
    nameAtBank: row.nameAtBank,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    usable: status === BankAccountStatus.VERIFIED && row.vendorStatus === 'ACTIVE' && Boolean(row.vendorId),
  };
}

export async function getPayoutAccount(organizationId: string): Promise<PayoutAccountView> {
  const row = await prisma.payoutAccount.findUnique({ where: { organizationId } });
  return row ? toView(row) : NOT_CONNECTED;
}

/** The vendor id Cashfree knows this organization by: letters, digits and `_`. */
function vendorIdFor(organizationId: string): string {
  return `saarthi_${organizationId.replace(/-/g, '')}`;
}

/**
 * Connect a bank account: penny-validate it, then register it for payouts.
 *
 * Connecting again replaces the previous account — the new one must pass
 * validation before anything is routed to it.
 */
export async function connectPayoutAccount(
  auth: AuthContext,
  organizationId: string,
  input: ConnectBankAccountInput,
): Promise<PayoutAccountView> {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, email: true, phone: true },
  });

  const base = {
    accountHolderName: input.accountHolderName,
    accountLast4: input.accountNumber.slice(-4),
    ifsc: input.ifsc,
    connectedById: auth.user.id,
  };
  await prisma.payoutAccount.upsert({
    where: { organizationId },
    create: { organizationId, ...base, status: BankAccountStatus.PENDING_VERIFICATION },
    update: {
      ...base,
      status: BankAccountStatus.PENDING_VERIFICATION,
      bankName: null,
      nameAtBank: null,
      verificationReference: null,
      failureReason: null,
      verifiedAt: null,
      vendorId: null,
      vendorStatus: null,
    },
  });

  const verification = await paymentProvider.verifyBankAccount({
    accountNumber: input.accountNumber,
    ifsc: input.ifsc,
    name: input.accountHolderName,
    phone: organization.phone ?? auth.user.phone,
  });

  if (verification.status !== 'VALID') {
    await prisma.payoutAccount.update({
      where: { organizationId },
      data: {
        status:
          verification.status === 'INVALID'
            ? BankAccountStatus.FAILED
            : BankAccountStatus.PENDING_VERIFICATION,
        verificationReference: verification.reference,
        failureReason: verification.reason,
      },
    });
    await audit(auth, organizationId, verification.status);
    return getPayoutAccount(organizationId);
  }

  // Validated by the bank — register it as the vendor payments are routed to.
  const vendor = await paymentProvider.createVendor({
    vendorId: vendorIdFor(organizationId),
    name: organization.name,
    email: organization.email ?? auth.user.email,
    phone: organization.phone ?? auth.user.phone ?? '',
    accountNumber: input.accountNumber,
    accountHolder: verification.nameAtBank ?? input.accountHolderName,
    ifsc: input.ifsc,
    pan: input.pan,
  });

  await prisma.payoutAccount.update({
    where: { organizationId },
    data: {
      status: BankAccountStatus.VERIFIED,
      verifiedAt: new Date(),
      bankName: verification.bankName,
      nameAtBank: verification.nameAtBank,
      verificationReference: verification.reference,
      vendorId: vendor.vendorId,
      vendorStatus: vendor.providerStatus,
    },
  });
  await audit(auth, organizationId, 'VALID');
  payoutLogger.info({ organizationId, vendorStatus: vendor.providerStatus }, 'Payout account verified');
  return getPayoutAccount(organizationId);
}

/** Re-read the vendor's standing — a new vendor takes a while to become ACTIVE. */
export async function refreshPayoutAccount(organizationId: string): Promise<PayoutAccountView> {
  const row = await prisma.payoutAccount.findUnique({ where: { organizationId } });
  if (row?.vendorId && row.status === BankAccountStatus.VERIFIED && row.vendorStatus !== 'ACTIVE') {
    const vendor = await paymentProvider.fetchVendor(row.vendorId);
    await prisma.payoutAccount.update({
      where: { organizationId },
      data: { vendorStatus: vendor.providerStatus },
    });
  }
  return getPayoutAccount(organizationId);
}

async function audit(auth: AuthContext, organizationId: string, result: string): Promise<void> {
  await recordAudit({
    action: AuditAction.PAYOUT_ACCOUNT_CONNECTED,
    entityType: 'PayoutAccount',
    entityId: organizationId,
    actorUserId: auth.user.id,
    organizationId,
    // The result only — never the account details.
    after: { result },
  });
}

/**
 * The vendor to route this organization's money to, or a refusal naming who
 * has to finish connecting their bank account.
 *
 * The gate for every restricted financial action: nothing is routed to an
 * account that is pending, failed or blocked.
 */
export async function requireUsablePayoutAccount(
  organizationId: string,
  whose: string,
): Promise<string> {
  const row = await prisma.payoutAccount.findUnique({ where: { organizationId } });
  if (!row || row.status !== BankAccountStatus.VERIFIED || !row.vendorId) {
    throw errors.businessRule(
      `${whose} must connect and verify a bank account before this payment can be made.`,
      { payoutAccountStatus: row?.status ?? BankAccountStatus.NOT_CONNECTED },
    );
  }
  if (row.vendorStatus !== 'ACTIVE') {
    throw errors.businessRule(
      `${whose} bank account is verified and still being activated for payouts. Try again shortly.`,
    );
  }
  return row.vendorId;
}

/** The vendor, when there is a usable one — for settlements that can wait. */
export async function usableVendorId(organizationId: string): Promise<string | null> {
  const row = await prisma.payoutAccount.findUnique({ where: { organizationId } });
  return row && row.status === BankAccountStatus.VERIFIED && row.vendorStatus === 'ACTIVE'
    ? row.vendorId
    : null;
}
