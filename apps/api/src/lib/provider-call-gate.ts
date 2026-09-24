import { errors } from './errors';

/**
 * The single point a verification check passes through immediately before a
 * billable provider call.
 *
 * The identity and registry services call it at exactly the place money would
 * be spent — after scoping, local checksum rules and the stored-answer cache,
 * and before the provider. What the gate does depends on who is asking:
 *
 *  • a direct, unpaid request refuses (`refuseUnpaidProviderCall`), because a
 *    billable check is only ever run after the customer has paid Saarthi;
 *  • Pay & Verify first runs the check with `preflightGate`, which stops it at
 *    the gate — so every free validation has passed before a payment is opened;
 *  • after the payment is confirmed, the check runs again with a gate that lets
 *    it through and records that the provider was called.
 *
 * A check that finishes without reaching the gate (an already-verified number,
 * a locally rejected one) needed no billable call at all, and is not charged.
 */
export type ProviderCallGate = () => Promise<void>;

/** Thrown by the preflight gate: every free check passed, payment is next. */
export class PreflightPassed extends Error {
  constructor() {
    super('Verification preflight passed');
    this.name = 'PreflightPassed';
  }
}

export const preflightGate: ProviderCallGate = async () => {
  throw new PreflightPassed();
};

export const refuseUnpaidProviderCall: ProviderCallGate = async () => {
  throw errors.paymentRequired(
    'This check carries a verification fee. Use Pay & Verify to complete it.',
  );
};
