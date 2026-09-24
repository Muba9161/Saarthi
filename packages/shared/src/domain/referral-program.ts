/**
 * Refer & Earn — the generic referral program, shared by the API and the client.
 *
 * One Saarthi user shares a code; a new person registers with it.
 *
 * ## The reward rule
 *
 * Every referral whose new account starts on a **paid plan** (and so begins its
 * trial) credits the referrer's Saarthi wallet at once — no payment by the new
 * account is needed, and no administrator approves it. The amount and the hold
 * are configuration (`REFERRAL_REWARD_AMOUNT`, `REFERRAL_REWARD_HOLD_DAYS`).
 * The reward is withdrawable once the hold has passed with the referred account
 * still on its trial or plan; a Free signup earns nothing.
 *
 * The referral also records its first successful subscription payment
 * (`QUALIFIED`), which is reporting only — the reward does not wait for it.
 *
 * **Anything to do with salespeople.** The salesman/GODID channel
 * (`domain/sales.ts`) is a separate program with its own tables, statuses and
 * commission engine. A code here is never a GODID and never resolves to one, so
 * the attribution source of any customer is always unambiguous.
 */

import { RoleName, type UserReferralStatus, type WalletEntryStatus } from './enums';
import { normalizeGodId } from './sales';

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * Every program code starts with this.
 *
 * It is what keeps the two referral channels apart at the one place they
 * meet — the registration form's single `referralCode` field — and it makes a
 * shared code legible as a Saarthi invitation rather than a random string.
 */
export const REFERRAL_PROGRAM_CODE_PREFIX = 'SAARTHI-';

/**
 * Characters a code is drawn from. No 0/O, 1/I/L: codes are read aloud and
 * retyped from a phone screen as often as they are tapped.
 */
export const REFERRAL_PROGRAM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Random characters after the prefix. */
export const REFERRAL_PROGRAM_CODE_LENGTH = 6;

const CODE_PATTERN = new RegExp(
  `^${REFERRAL_PROGRAM_CODE_PREFIX}[${REFERRAL_PROGRAM_CODE_ALPHABET}]{${REFERRAL_PROGRAM_CODE_LENGTH}}$`,
);

/**
 * Normalise a typed code. The same normalisation the registration form already
 * applies to every referral code it carries, so both channels agree on it.
 */
export function normalizeReferralProgramCode(value: string): string {
  return normalizeGodId(value);
}

/** Whether a string has the shape of a program code. Says nothing about whether it exists. */
export function isReferralProgramCode(value: string): boolean {
  return CODE_PATTERN.test(normalizeReferralProgramCode(value));
}

/**
 * The link a referrer shares.
 *
 * Straight to registration: the form already reads `?ref=`, remembers it across
 * visits and sends it with the signup, so the program needs no landing page of
 * its own. Built from a caller-supplied base for the same reason the sales
 * referral URL is — see `referralUrl`.
 */
export function referralProgramUrl(baseUrl: string, code: string): string {
  const query = new URLSearchParams({ ref: normalizeReferralProgramCode(code) });
  return `${baseUrl.replace(/\/$/, '')}/register?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Roles that do not take part in Refer & Earn.
 *
 * A salesperson already refers customers through their GODID link, which earns
 * sales commission. Offering them a second, differently-rewarded code for the
 * same act would merge the two programs in the one place the specification
 * asks for them to stay apart. This is the single place eligibility is
 * decided — plan tier is intentionally not an input.
 */
export const REFERRAL_PROGRAM_EXCLUDED_ROLES: readonly RoleName[] = Object.freeze([
  RoleName.SALESMAN,
]);

export function canJoinReferralProgram(roles: readonly string[]): boolean {
  return !roles.some((role) => REFERRAL_PROGRAM_EXCLUDED_ROLES.includes(role as RoleName));
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** `GET /referral-program/me`. */
export interface ReferralProgramSummary {
  code: string;
  url: string;
  shareText: string;
  stats: {
    /** Every account created with the code. */
    total: number;
    /** Referrals that earned a reward that has not been voided. */
    rewarded: number;
    /** Rupees credited for them, held or available. */
    earned: number;
  };
  /** The rule in force, from configuration — the screen states it, never assumes it. */
  reward: { amount: number; holdDays: number };
}

/** One row of `GET /referral-program/me/referrals`. */
export interface UserReferralView {
  id: string;
  /** The referred account's organization, as they named it. */
  organizationName: string | null;
  status: UserReferralStatus;
  signedUpAt: string;
  qualifiedAt: string | null;
  /** Null for a signup that earned nothing — a Free-plan account. */
  reward: { amount: number; status: WalletEntryStatus; availableAt: string } | null;
}
