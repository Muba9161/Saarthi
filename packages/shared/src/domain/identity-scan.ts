/**
 * Reading an identity number, and the details around it, off a photographed card.
 *
 * The photo is read on the person's own device (see the web app's
 * `scan-card`); this is the part that turns the recognised text into the
 * number, and then the name and dates a form asks for. OCR on a phone photo is noisy — an `O` where a `0` should be, a `5`
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

// ---------------------------------------------------------------------------
// The rest of the card
// ---------------------------------------------------------------------------

/**
 * Stands in, in recognised text, for a word OCR could not read with confidence.
 *
 * The number is read from the confident words alone, and its own rules prove
 * it. A name has no such proof, and one with a word silently missing is simply
 * wrong: sent with a PAN check, it fails a check that would have passed. So a
 * line holding one of these is never read as a name.
 */
export const UNREAD_WORD = '⁇';

/**
 * Everything a scan read off a card. Beyond the number, a field is present only
 * when the card prints it in a place, or under a label, that says what it is.
 */
export interface ScannedCard {
  number: string;
  /** The name printed on a PAN card, which is what a PAN check matches against. */
  holderName?: string | undefined;
  /** yyyy-mm-dd: a date the card labels as its date of issue. */
  issueDate?: string | undefined;
  /** yyyy-mm-dd: a date the card labels as valid till, or as its expiry. */
  expiryDate?: string | undefined;
}

/** The text as if the unread words had been dropped, which is what the number is read from. */
function withoutUnreadWords(text: string): string {
  return text
    .split('\n')
    .map((line) => line.split(' ').filter((word) => word && word !== UNREAD_WORD).join(' '))
    .filter(Boolean)
    .join('\n');
}

/** Words that label a field on a card rather than fill one. */
const LABEL_WORDS = /\b(?:NAME|FATHER|MOTHER|BIRTH|DOB|DATE|SIGNATURE)\b/;

/** What a PAN card's headings are made of: a line of nothing else is not a name. */
const PAN_HEADING_WORDS = new Set([
  'INCOME',
  'TAX',
  'DEPARTMENT',
  'GOVT',
  'GOVERNMENT',
  'OF',
  'INDIA',
  'PERMANENT',
  'ACCOUNT',
  'NUMBER',
  'CARD',
]);

/** A line read whole, in the capitals a card prints names in, that can only be a name. */
function printedName(line: string): string | null {
  if (line.includes(UNREAD_WORD)) return null;
  // OCR fringes a line with stray marks; a name itself starts with a letter.
  const name = line
    .replace(/^[^A-Z]+|[^A-Z.)]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!/^[A-Z][A-Z .&'()/-]*$/.test(name) || LABEL_WORDS.test(name)) return null;
  const words = name
    .split(' ')
    .map((word) => word.replace(/[^A-Z]/g, ''))
    .filter(Boolean);
  if (words.join('').length < 2 || words.every((word) => PAN_HEADING_WORDS.has(word))) return null;
  return name;
}

function panHolderName(lines: readonly string[]): string | null {
  // The current card labels it: "Name", then the name on the line below, with
  // "Father's Name" further down, which is not it.
  const labelled = lines.findIndex((line) => /\bNAME\b/i.test(line) && !/FATHER|MOTHER/i.test(line));
  if (labelled !== -1) {
    const label = lines[labelled]!;
    const afterLabel = label.slice(label.search(/\bNAME\b/i) + 'NAME'.length);
    return printedName(afterLabel) ?? printedName(lines[labelled + 1] ?? '');
  }

  // The older card has no labels: the name is the first line under the
  // department's heading, above the father's name and the number's caption.
  const heading = lines.findIndex((line) => /INCOME\s*TAX|GOVT/i.test(line));
  if (heading === -1) return null;
  for (const line of lines.slice(heading + 1)) {
    if (/PERMANENT|ACCOUNT\s*NUMBER/i.test(line)) break;
    const name = printedName(line);
    // Two words at least: a lone word here is as likely a misread mark beside
    // the photograph as a name.
    if (name && name.includes(' ')) return name;
  }
  return null;
}

type DateField = 'issueDate' | 'expiryDate';

/**
 * The labels a card prints before a date, longest first so "ISSUE DATE" is read
 * whole rather than as "ISSUE". Birth and first-issue dates are matched only so
 * that a date after them is not taken for the issue or expiry date.
 */
const DATE_LABEL =
  /\b(?:DATE OF BIRTH|BIRTH|DOB|DATE OF FIRST ISSUE|FIRST ISSUE|ORIGINAL|VALID FROM|DATE OF ISSUE|ISSUE DATE|ISSUED ON|ISSUED|ISSUE|DOI|DATE OF EXPIRY|EXPIRY DATE|EXPIRY|EXPIRES|VALID TILL|VALID UPTO|VALID UP TO|VALID TO|VALIDITY)\b/g;

const DATE_PATTERN =
  /(?<![0-9])([0-9OQDILZSGB|]{2})[/.-]([0-9OQDILZSGB|]{2})[/.-]([0-9OQDILZSGB|]{4})(?![0-9])/g;

function fieldForLabel(label: string): DateField | null {
  if (/BIRTH|DOB|FIRST|ORIGINAL|FROM/.test(label)) return null;
  return /ISSUE|DOI/.test(label) ? 'issueDate' : 'expiryDate';
}

/** A printed dd/mm/yyyy as yyyy-mm-dd, or null when it is not a real date. */
function isoDate(day: string, month: string, year: string): string | null {
  const [d, m, y] = [day, month, year].map((part) => Number([...part].map(toDigit).join('')));
  if (!d || !m || !y || y < 1900 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * The issue and expiry dates, taken only where a label says which is which.
 *
 * A date belongs to the label before it on its line, or — for a row of dates
 * printed under a row of labels — to the label in the same place on the line
 * above. A licence can carry two validities (non-transport and transport); the
 * earlier is the one the document lapses on.
 */
function labelledDates(lines: readonly string[]): Pick<ScannedCard, DateField> {
  const found: Record<DateField, string[]> = { issueDate: [], expiryDate: [] };
  let labelsAbove: (DateField | null)[] = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    const labels = [...upper.matchAll(DATE_LABEL)].map((match) => ({
      at: match.index ?? 0,
      field: fieldForLabel(match[0]),
    }));
    const dates = [...upper.matchAll(DATE_PATTERN)];

    dates.forEach((match, order) => {
      const iso = isoDate(match[1]!, match[2]!, match[3]!);
      if (!iso) return;
      const before = labels.filter((label) => label.at < (match.index ?? 0)).pop();
      const field = before ? before.field : labels.length === 0 ? (labelsAbove[order] ?? null) : null;
      if (field) found[field].push(iso);
    });

    labelsAbove = dates.length === 0 ? labels.map((label) => label.field) : [];
  }

  return { issueDate: found.issueDate[0], expiryDate: found.expiryDate.sort()[0] };
}

/**
 * The number on the card and whatever else it shows clearly, or null when the
 * number itself cannot be proved — nothing is offered from a card whose number
 * could not be read.
 *
 * `text` is the recognised text, line breaks included, with each word read
 * without confidence standing as {@link UNREAD_WORD}.
 */
export function extractCardDetails(kind: ScannableNumberKind, text: string): ScannedCard | null {
  const number = extractCardNumber(kind, withoutUnreadWords(text));
  if (!number) return null;
  const lines = text.split('\n');
  return {
    number,
    holderName: kind === IdentityDocumentKind.PAN ? (panHolderName(lines) ?? undefined) : undefined,
    ...labelledDates(lines),
  };
}
