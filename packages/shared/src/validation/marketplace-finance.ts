import { z } from 'zod';
import { trimmedString } from './common';

/**
 * Connecting a bank account.
 *
 * The full account number is accepted once, passed to the bank-verification
 * provider and to the payment provider's vendor record, and never stored or
 * returned — Saarthi keeps only the last four digits.
 */
export const connectBankAccountSchema = z.object({
  accountHolderName: trimmedString(3, 100),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, 'Enter the account number — 9 to 18 digits.'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. HDFC0001234.'),
  /** The account holder's PAN — the payment provider's KYC for paying out to them. */
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN, e.g. ABCDE1234F.'),
});
export type ConnectBankAccountInput = z.infer<typeof connectBankAccountSchema>;

/** The fleet paying its supplier for the order's material, through Saarthi. */
export const procurementPaymentSchema = z.object({
  /** What the fleet agreed to pay the supplier. Defaults to the listing reference. */
  amount: z.coerce.number().positive().max(100_000_000).optional(),
});
export type ProcurementPaymentInput = z.infer<typeof procurementPaymentSchema>;

/** The customer confirming what actually arrived. */
export const confirmDeliverySchema = z.object({
  deliveredQuantity: z.coerce.number().min(0).max(1_000_000),
  note: z.string().trim().max(500).optional(),
});
export type ConfirmDeliveryInput = z.infer<typeof confirmDeliverySchema>;

/** A travel provider's costs for a completed booking. */
export const bookingCostsSchema = z.object({
  costs: z
    .array(
      z.object({
        label: trimmedString(2, 80),
        amount: z.coerce.number().min(0).max(10_000_000),
      }),
    )
    .max(20),
});
export type BookingCostsInput = z.infer<typeof bookingCostsSchema>;
