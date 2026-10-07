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
 *    there must be at least two — "KUMAR" alone matches half a state;
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
  if (!shorter.words.every((word) => longer.words.includes(word))) return false;

  const unmatchedIn = (side: NameParts, other: NameParts): string[] =>
    side.words.filter((word) => !other.words.includes(word));

  return (
    initialsFit(a.initials, unmatchedIn(b, a), b.initials) &&
    initialsFit(b.initials, unmatchedIn(a, b), a.initials)
  );
}
