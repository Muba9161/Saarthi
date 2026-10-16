/**
 * Vehicle ownership — is the account holding a plate the one that owns it?
 *
 * RC verification (`registry-verification.ts`) answers a different question:
 * whether the plate is a real, valid registration. It says nothing about who
 * added it, and a plate anyone can type is not proof of anything.
 *
 * Ownership is confirmed automatically, by matching the RC owner's name against
 * a government-verified name on the account: a PAN or Voter ID holder name, or
 * the business's GST legal / trade name. Aadhaar is not a source — its check
 * returns no name — and neither is a profile name, which anyone can type.
 *
 * Until it is confirmed the vehicle works as normal for fleet operations, but
 * its RC stays masked, it cannot be advertised for sale, and its QR sticker
 * shows no RC owner. Confirmed, the full RC is still behind the secure PIN
 * (`RcDetailAccess`): ownership says the account may see it, the PIN says the
 * person at the keyboard is the one it belongs to.
 */

import type { VehicleOwnershipStatus } from './enums';

export interface VehicleOwnershipView {
  status: VehicleOwnershipStatus;
  verifiedAt: string | null;
  /** Why it is still pending, in one sentence the owner can act on. */
  note: string | null;
}

/**
 * `details.reason` on a refused plate claim when the claimant has no
 * government-verified name to match against the RC, so the client can offer
 * to verify one rather than only saying so.
 */
export const CLAIM_NEEDS_VERIFIED_NAME = 'VERIFIED_NAME_REQUIRED';

// ---------------------------------------------------------------------------
// Review by the Saarthi team
// ---------------------------------------------------------------------------

/**
 * Where a request for a person to confirm ownership stands.
 *
 * The fallback when the RC owner's name cannot be matched automatically: a
 * name spelt beyond what the matcher allows, a married name, a vehicle in a
 * relative's name, or no RC to hand. An approval confirms the vehicle exactly
 * as a name match would.
 */
export const OwnershipReviewStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type OwnershipReviewStatus = (typeof OwnershipReviewStatus)[keyof typeof OwnershipReviewStatus];

/** A review as the account that asked for it sees it. */
export interface OwnershipReviewView {
  id: string;
  registrationNumber: string;
  /** The account's own vehicle, or a plate another account holds unconfirmed. */
  kind: 'OWN_VEHICLE' | 'CLAIM';
  status: OwnershipReviewStatus;
  message: string;
  hasAttachment: boolean;
  /** The reviewer's reason; always present on a rejection. */
  decisionNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/** A row in the reviewer's queue. */
export interface OwnershipReviewSummary extends OwnershipReviewView {
  organizationName: string | null;
  requestedByName: string | null;
}

/** What the reviewer sees on opening one: everything needed to decide, in one place. */
export interface OwnershipReviewDetail extends OwnershipReviewSummary {
  vehicleId: string | null;
  /** The RC owner as the RTO records them. Reviewers are platform staff. */
  rcOwnerName: string | null;
  /** The government-verified names on the requesting account. */
  verifiedNames: string[];
  /** For a claim, the account holding the plate now. */
  holder: { organizationName: string | null; ownershipStatus: VehicleOwnershipStatus } | null;
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/** Titles and legal-form words that say nothing about who someone is. */
const IGNORED_WORDS = new Set([
  'MR',
  'MRS',
  'MS',
  'MISS',
  'SHRI',
  'SRI',
  'SH',
  'SMT',
  'KUMARI',
  'KU',
  'DR',
  'LATE',
  'PVT',
  'PRIVATE',
  'LTD',
  'LIMITED',
  'CO',
  'COMPANY',
  'CORP',
  'CORPORATION',
  'LLP',
  'INC',
  'AND',
  'THE',
  'OF',
]);

/** Spellings RTO records and tax records routinely disagree on. */
const EQUIVALENT_WORDS: Record<string, string> = {
  MOHD: 'MOHAMMAD',
  MOHAMMED: 'MOHAMMAD',
  MOHAMED: 'MOHAMMAD',
  MUHAMMAD: 'MOHAMMAD',
};

/** A match must rest on at least this many whole words agreeing. */
const MIN_MATCHING_WORDS = 2;

/**
 * A name word as it sounds rather than as it was romanised.
 *
 * RTO and Income Tax records write the same Devanagari name in Latin letters
 * differently, all the time: the RC says SMT. BHAWNA PANDEY and the PAN says
 * BHAVANA PANDEY, the same व written W once and V once, with the inherent "a"
 * kept once and dropped once. Each rule here is one such habit, so two
 * spellings of one name reduce to one key; different names keep different
 * consonants and do not. Only ever compared word to word, under every other
 * rule `ownerNamesMatch` keeps.
 */
function soundKey(word: string): string {
  return (
    word
      // LAXMI / LAKSHMI
      .replace(/X/g, 'KSH')
      // BHAWNA / BHAVANA, PAWAN / PAVAN
      .replace(/W/g, 'V')
      .replace(/PH/g, 'F')
      // Aspiration written or not: AMITH / AMIT, SIDDHARTH / SIDHARTH, CHHAYA / CHAYA
      .replace(/([BCDGJKPT])H+/g, '$1')
      // श and स romanised alike: SHASHI / SASHI, LAKSHMI / LAKSMI
      .replace(/SH/g, 'S')
      // Long vowels: SUNEETA / SUNITA, SOORAJ / SURAJ, GOUTAM / GAUTAM
      .replace(/EE/g, 'I')
      .replace(/OO/g, 'U')
      .replace(/OU/g, 'AU')
      // AJAY / AJAI
      .replace(/Y$/, 'I')
      // SIDDHARTH / SIDHARTH, AMEERA / AMIRA
      .replace(/(.)\1+/g, '$1')
      // The inherent vowel between consonants: BHAVANA / BHAVNA, MAMATA / MAMTA
      .replace(/([^AEIOU])A(?=[^AEIOU])/g, '$1')
      .replace(/(.)\1+/g, '$1')
  );
}

/** One word of a name against another: spelt the same, or the same name romanised differently. */
function sameWord(a: string, b: string): boolean {
  return a === b || soundKey(a) === soundKey(b);
}

interface NameParts {
  words: string[];
  initials: string[];
}

function nameParts(name: string): NameParts {
  const tokens = name
    .toUpperCase()
    // "RAMESH KUMAR S/O SURESH KUMAR" — the father is not the owner.
    .replace(/\b[SDWC]\s*\/\s*O\b.*$/, ' ')
    // "M/S" marks a firm; left in, it would read as two initials.
    .replace(/\bM\s*\/\s*S\b/g, ' ')
    .replace(/[^A-Z]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((token) => EQUIVALENT_WORDS[token] ?? token)
    .filter((token) => !IGNORED_WORDS.has(token));

  return {
    words: [...new Set(tokens.filter((token) => token.length > 1))],
    initials: [...new Set(tokens.filter((token) => token.length === 1))],
  };
}

/** Every initial on one side stands for a word, or initial, the other side has left over. */
function initialsFit(
  initials: string[],
  otherUnmatchedWords: string[],
  otherInitials: string[],
): boolean {
  return initials.every(
    (initial) =>
      otherInitials.includes(initial) ||
      otherUnmatchedWords.some((word) => word.startsWith(initial)),
  );
}

/**
 * Do two records name the same person or business?
 *
 * Stricter than the PAN check's `looseNameMatch`, on purpose. That one backs a
 * number the user already holds; this one hands a stranger's vehicle to
 * whoever passes it, so a shared surname must never be enough:
 *
 *  * every whole word of the shorter name must appear in the longer one, and
 *    there must be at least two — "KUMAR" alone matches half a state. A word
 *    "appears" when it is spelt the same or romanised differently — BHAWNA is
 *    BHAVANA (see `soundKey`);
 *  * the longer name may carry extra words, the middle name one record omits;
 *  * an initial must stand for a word, or an initial, the other side has left
 *    over — "R KUMAR SHARMA" is not "AMIT KUMAR SHARMA".
 *
 * Titles, "M/S", "S/O …" and legal-form words are ignored, so "M/S SHARMA
 * ROADWAYS PVT LTD" matches "SHARMA ROADWAYS PRIVATE LIMITED". Anything this
 * cannot settle goes to a reviewer; it errs towards "no".
 */
export function ownerNamesMatch(first: string, second: string): boolean {
  const a = nameParts(first);
  const b = nameParts(second);
  const [shorter, longer] = a.words.length <= b.words.length ? [a, b] : [b, a];

  if (shorter.words.length < MIN_MATCHING_WORDS) return false;
  const inLonger = (word: string) => longer.words.some((other) => sameWord(word, other));
  if (!shorter.words.every(inLonger)) return false;

  const unmatchedIn = (side: NameParts, other: NameParts): string[] =>
    side.words.filter((word) => !other.words.some((candidate) => sameWord(word, candidate)));

  return (
    initialsFit(a.initials, unmatchedIn(b, a), b.initials) &&
    initialsFit(b.initials, unmatchedIn(a, b), a.initials)
  );
}
