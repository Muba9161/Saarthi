import type { z } from 'zod';
import { connectBankAccountSchema } from './marketplace-finance';

/**
 * Connecting the bank account a wallet cashes out to.
 *
 * The marketplace form without the PAN: that is the payment provider's vendor
 * KYC for routing business payments, which a person cashing out a referral
 * reward is not being set up as. The bank is still penny-validated.
 */
export const connectWalletBankAccountSchema = connectBankAccountSchema.omit({ pan: true });
export type ConnectWalletBankAccountInput = z.infer<typeof connectWalletBankAccountSchema>;
