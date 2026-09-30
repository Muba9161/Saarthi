/**
 * Reading an identity number off a photographed card.
 *
 * The photo is read on the person's own device (see the web app's
 * `scan-card`); this is the part that turns the recognised text into one
 * number. OCR on a phone photo is noisy — an `O` where a `0` should be, a `5`
 * for an `S`, spaces in odd places — so every candidate is repaired for the
 * character classes its position demands, and then **proved** against the
 * number's own rules: Aadhaar's Verhoeff checksum, PAN's structure, GSTIN's
 * check character. A number that cannot be proved is not offered at all; a
 * blank field the person fills in is better than a confident wrong one.
 *
 * Filling the field is all this does. Verification still goes to the issuing
 * authority, so a doctored photo gains nothing.
 */

import { IdentityDocumentKind } from './enums';
import { isPlausibleIndianLicence, normalizeLicenceNumber } from './driving-licence';
import { isValidAadhaar, isValidGstin, isValidPan, isValidVoterId } from './identity-verification';

/** What a card can be scanned for: the identity kinds, and the driving licence. */
export type ScannableNumberKind = IdentityDocumentKind | 'DRIVING_LICENCE';

/** Characters OCR confuses with a digit, and the digit they meant. */
const AS_DIGIT: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  '|': '1',
  Z: '2',
  S: '5',
  G: '6',
  B: '8',
};

/** Digits OCR produces where a letter was printed, and the letter meant. */
const AS_LETTER: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '2': 'Z',
  '5': 'S',
  '6': 'G',
  '8': 'B',
};

const toDigit = (char: string): string => AS_DIGIT[char] ?? char;
const toLetter = (char: string): string => AS_LETTER[char] ?? char;

/**
 * Repair a candidate against a shape: `A` a letter, `9` a digit, `*` either.
 * Returns null when a position still holds the wrong class afterwards.
 */
function repair(candidate: string, shape: string): string | null {
  if (candidate.length !== shape.length) return null;
  let out = '';
  for (let index = 0; index < shape.length; index += 1) {
    const want = shape[index];
    const raw = candidate[index]!;
    const char = want === '9' ? toDigit(raw) : want === 'A' ? toLetter(raw) : raw;
    if (want === '9' && !/\d/.test(char)) return null;
    if (want === 'A' && !/[A-Z]/.test(char)) return null;
    out += char;
  }
  return out;
}

/** Uppercase, with anything that is not a letter, digit or space turned into a space. */
function clean(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9| ]+/g, ' ');
}

/** Every run of `length` letters/digits, reading across the spaces OCR inserts. */
function windows(text: string, length: number): string[] {
  const found = new Set<string>();
  for (const line of text.split(/\n/)) {
    const cleaned = clean(line);
    // Whole words first — the likeliest match — then the same line with its
    // spaces removed, for a number the photo split in two.
    for (const word of cleaned.split(/\s+/)) if (word.length === length) found.add(word);
    const joined = cleaned.replace(/\s+/g, '');
    for (let start = 0; start + length <= joined.length; start += 1) {
      found.add(joined.slice(start, start + length));
    }
  }
  return [...found];
}

function scanAadhaar(text: string): string | null {
  // Printed as three groups of four. Read the groups as written, so a longer
  // Virtual ID (sixteen digits) on the same card is not cut into an Aadhaar.
  const groups =
    /(?<![0-9OQDILZSGB|][ -]?)([0-9OQDILZSGB|]{4})[ -]?([0-9OQDILZSGB|]{4})[ -]?([0-9OQDILZSGB|]{4})(?![ -]?[0-9OQDILZSGB|])/g;
  for (const line of text.toUpperCase().split(/\n/)) {
    if (/\bVID\b/.test(line)) continue;
    for (const match of line.matchAll(groups)) {
      const digits = [...(match[1]! + match[2]! + match[3]!)].map(toDigit).join('');
      if (isValidAadhaar(digits)) return digits;
    }
  }
  return null;
}

function firstValid(
  candidates: string[],
  shapes: string[],
  valid: (value: string) => boolean,
): string | null {
  for (const candidate of candidates) {
    for (const shape of shapes) {
      const repaired = repair(candidate, shape);
      if (repaired && valid(repaired)) return repaired;
    }
  }
  return null;
}

function scanLicence(text: string): string | null {
  // State (2 letters), RTO (2 digits), year (4 digits), serial (7 digits),
  // however the card spaces or hyphenates it.
  const pattern = /\b([A-Z0-9]{2})[ -]?([0-9OIZSB]{2})[ -]?([0-9OIZSB]{4})[ -]?([0-9OIZSB]{7})\b/g;
  for (const match of clean(text).matchAll(pattern)) {
    const state = repair(match[1]!, 'AA');
    if (!state) continue;
    const digits = [match[2], match[3], match[4]].join('');
    const numeric = [...digits].map(toDigit).join('');
    if (!/^\d{13}$/.test(numeric)) continue;
    const licence = normalizeLicenceNumber(`${state}${numeric}`);
    if (isPlausibleIndianLicence(licence)) return licence;
  }
  return null;
}

/**
 * The number of this kind on the card, or null when none can be proved.
 *
 * `text` is the raw recognised text, line breaks included.
 */
export function extractCardNumber(kind: ScannableNumberKind, text: string): string | null {
  switch (kind) {
    case IdentityDocumentKind.AADHAAR:
      return scanAadhaar(text);
    case IdentityDocumentKind.PAN:
      // Five letters, four digits, a letter.
      return firstValid(windows(text, 10), ['AAAAA9999A'], isValidPan);
    case IdentityDocumentKind.VOTER_ID:
      // The current EPIC shape: three letters, seven digits.
      return firstValid(windows(text, 10), ['AAA9999999'], isValidVoterId);
    case IdentityDocumentKind.GST:
      // State code, the holder's PAN, entity number, Z, check character —
      // the checksum settles any doubt the shape leaves.
      return firstValid(windows(text, 15), ['99AAAAA9999A*A*'], isValidGstin);
    case 'DRIVING_LICENCE':
      return scanLicence(text);
    default:
      return null;
  }
}
