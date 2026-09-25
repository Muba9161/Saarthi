import {
  type CommerceAttributeDefinition,
  type CommerceAttributeValues,
  type CommerceCommercialFields,
  type CommerceInterpretation,
  type CommerceRecordScope,
  type CommerceTaxonomyIndex,
  categoryPath,
  categoryRef,
  confidenceBand,
  defaultUnitFor,
  effectiveAttributes,
  isCategoryActive,
  missingForInterpretation,
  validateAttributeValues,
} from './commerce';
import { CommerceAttributeType, MaterialUnit } from './enums';

/**
 * Deterministic reading of a product or requirement line.
 *
 * This is the first — and most of the time the only — pass. A seller typing
 * "river sand 40 ton ₹2000/ton" should never wait on, or pay for, a model call
 * to learn that river sand is river sand. The AI layer in the API is consulted
 * only when this pass is not confident, and anything it suggests is validated
 * against the same schema these functions use.
 */

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Lower-case, strip punctuation that never carries meaning, collapse space. */
export function normalizeCommerceText(text: string): string {
  return (
    text
      .toLowerCase()
      // Thousands separators belong to the number: "25,000" is one amount.
      .replace(/(\d),(?=\d)/g, '$1')
      .replace(/[“”"'`]/g, '')
      .replace(/[^\p{L}\p{N}₹.\-/\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Crude English singular, enough to make "tables" meet "table". */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (/(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokens(text: string): string[] {
  return normalizeCommerceText(text)
    .split(/[\s/]+/)
    .map((token) => token.replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean)
    .map(stem);
}

/**
 * Where `phrase` last appears, in order and adjacent, in `haystack` — the
 * index just past its final token — or -1.
 */
function phraseEnd(haystack: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > haystack.length) return -1;
  outer: for (let start = haystack.length - phrase.length; start >= 0; start -= 1) {
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (haystack[start + offset] !== phrase[offset]) continue outer;
    }
    return start + phrase.length;
  }
  return -1;
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  return phraseEnd(haystack, phrase) !== -1;
}

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

export interface CategoryClassification {
  categoryId: string;
  /** 0–1. */
  score: number;
  /** Other nodes that matched as strongly in a different branch. */
  alternativeIds: string[];
}

interface Candidate {
  id: string;
  /** Tokens of the longest matching term — longer phrases are more specific. */
  term: string[];
  /** Where that term ends in the text. */
  end: number;
  depth: number;
  hasChildren: boolean;
}

/** Every SELECT option the node offers, including inherited ones, tokenised. */
function optionPhrases(index: CommerceTaxonomyIndex, categoryId: string): string[][] {
  return categoryPath(index, categoryId).flatMap((node) =>
    node.attributes
      .filter((attribute) => attribute.type === CommerceAttributeType.SELECT)
      .flatMap((attribute) => attribute.options.map(tokens)),
  );
}

/**
 * Match text against category names and aliases.
 *
 * The most specific match wins — "teak dining table" matches Furniture, Tables
 * and Dining Table, and Dining Table is the answer — and between unrelated
 * matches the phrase nearest the end wins, because in "teak wood dining table"
 * the product is the last noun and everything before it describes it. A rival
 * that is really an attribute value of the winner (teak is a furniture
 * material) is not ambiguity; any other rival is reported rather than hidden.
 */
export function classifyCategory(
  index: CommerceTaxonomyIndex,
  text: string,
): CategoryClassification | null {
  const haystack = tokens(text);
  if (haystack.length === 0) return null;

  const candidates: Candidate[] = [];
  for (const node of index.nodes) {
    if (node.isFallback || !isCategoryActive(index, node.id)) continue;

    let best: { term: string[]; end: number } | null = null;
    for (const term of [node.name, ...node.aliases]) {
      const phrase = tokens(term);
      const end = phraseEnd(haystack, phrase);
      if (end !== -1 && (!best || phrase.length > best.term.length)) best = { term: phrase, end };
    }
    if (!best) continue;

    candidates.push({
      id: node.id,
      ...best,
      depth: categoryPath(index, node.id).length,
      hasChildren: (index.childrenOf.get(node.id) ?? []).length > 0,
    });
  }
  if (candidates.length === 0) return null;

  // A match that is an ancestor of another match adds nothing: the deeper node
  // already implies it.
  const specific = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.id !== candidate.id &&
          categoryPath(index, other.id).some((node) => node.id === candidate.id),
      ),
  );

  specific.sort((a, b) => b.end - a.end || b.term.length - a.term.length || b.depth - a.depth);
  const best = specific[0]!;
  const options = optionPhrases(index, best.id);
  const rivals = specific.filter(
    (candidate) =>
      candidate.id !== best.id && !options.some((option) => containsPhrase(candidate.term, option)),
  );

  // A leaf reached by name is a confident answer. A parent with children is a
  // real answer too — "sand" is sand — but which sand is still open.
  let score = best.hasChildren ? 0.75 : 0.95;
  if (rivals.length > 0) score = 0.65;

  return { categoryId: best.id, score, alternativeIds: rivals.map((rival) => rival.id) };
}

// ---------------------------------------------------------------------------
// Attribute extraction
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read schema attributes out of the text. Only attributes whose value can be
 * recognised without guessing are filled: a SELECT option named outright, or a
 * NUMBER written next to its declared unit ("6 seater", "12 mm").
 */
export function extractAttributes(
  text: string,
  definitions: CommerceAttributeDefinition[],
): CommerceAttributeValues {
  const normalized = normalizeCommerceText(text);
  const haystack = tokens(text);
  const values: CommerceAttributeValues = {};

  for (const definition of definitions) {
    if (definition.type === CommerceAttributeType.SELECT) {
      const ordered = [...definition.options].sort((a, b) => b.length - a.length);
      const option =
        ordered.find((candidate) => containsPhrase(haystack, tokens(candidate))) ??
        // "wooden" names the option "Wood". Single words only, and not short
        // ones, so "metallic" finds Metal but "fe" finds nothing.
        ordered.find((candidate) => {
          const [word, ...more] = tokens(candidate);
          return (
            !!word &&
            more.length === 0 &&
            word.length >= 4 &&
            haystack.some((token) => token.startsWith(word))
          );
        });
      if (option) values[definition.key] = option;
      continue;
    }

    if (definition.type === CommerceAttributeType.NUMBER && definition.unit) {
      const unit = escapeRegExp(definition.unit.toLowerCase());
      const match = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*-?\\s*${unit}s?\\b`).exec(normalized);
      if (match) values[definition.key] = Number(match[1]);
    }
  }

  return values;
}

// ---------------------------------------------------------------------------
// Commercial extraction — quantity, price, stock, places, timing
// ---------------------------------------------------------------------------

const UNIT_WORDS: [RegExp, MaterialUnit][] = [
  [/^(tons?|tonnes?|mt|t)$/, MaterialUnit.TON],
  [/^(kgs?|kilos?|kilograms?)$/, MaterialUnit.KG],
  [/^(cum|m3|cbm|cubic)$/, MaterialUnit.CUBIC_METER],
  [/^(litres?|liters?|ltrs?|l)$/, MaterialUnit.LITRE],
  [/^(pieces?|pcs|nos|units?|pc)$/, MaterialUnit.PIECE],
  [/^(bags?|sacks?)$/, MaterialUnit.BAG],
  [/^(trips?|loads?|trucks?)$/, MaterialUnit.TRIP],
];

function unitFromWord(word: string): MaterialUnit | null {
  return UNIT_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? null;
}

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  lakh: 100_000,
  lac: 100_000,
};

function parseAmount(digits: string, multiplier?: string): number {
  return Number(digits.replace(/,/g, '')) * (multiplier ? (MULTIPLIERS[multiplier] ?? 1) : 1);
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

/** Words that end a place name in "from X to Y within 3 days". */
const PLACE_TERMINATOR = '(?=\\s+(?:within|by|in|before|on|at|for|and|urgent|asap)\\b|[,.;]|$)';

/**
 * The commercial half of a line: how much, at what price, how much stock,
 * from where to where and by when. Anything not stated stays null — a missing
 * price is asked for, never assumed.
 */
export function extractCommercialFields(text: string): CommerceCommercialFields {
  let rest = ` ${normalizeCommerceText(text)} `;
  const fields: CommerceCommercialFields = {
    quantity: null,
    unit: null,
    pricePerUnit: null,
    stock: null,
    pickupCity: null,
    deliveryCity: null,
    requiredWithinDays: null,
  };

  // Price first, so its digits are not read back as a quantity.
  const price =
    /(?:₹|\brs\.?|\binr)\s*(\d+(?:\.\d+)?)(?:\s*(k|thousand|lakh|lac)\b)?(?:\s*(?:\/|per)\s*([a-z]+))?/.exec(
      rest,
    ) ??
    /(\d+(?:\.\d+)?)(?:\s*(k|thousand|lakh|lac)\b)?\s*(?:rupees|rs\b|\/-)(?:\s*(?:\/|per)\s*([a-z]+))?/.exec(
      rest,
    );
  if (price) {
    fields.pricePerUnit = parseAmount(price[1]!, price[2]);
    const perUnit = price[3] ? unitFromWord(price[3]) : null;
    if (perUnit) fields.unit = perUnit;
    rest = rest.replace(price[0], ' ');
  }

  const stock =
    /(\d[\d,]*(?:\.\d+)?)\s*([a-z]+)?\s*(?:available|in stock|ready)\b/.exec(rest) ??
    /\b(?:stock|available)\s*(?:of|is|:)?\s*(\d[\d,]*(?:\.\d+)?)\s*([a-z]+)?/.exec(rest);
  if (stock) {
    fields.stock = parseAmount(stock[1]!);
    const unit = stock[2] ? unitFromWord(stock[2]) : null;
    if (unit) fields.unit ??= unit;
    rest = rest.replace(stock[0], ' ');
  }

  for (const match of rest.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([a-z0-9]+)/g)) {
    const unit = unitFromWord(match[2]!);
    if (!unit) continue;
    fields.quantity = parseAmount(match[1]!);
    fields.unit ??= unit;
    rest = rest.replace(match[0], ' ');
    break;
  }

  const route = new RegExp(
    `\\bfrom\\s+([\\p{L} ]+?)\\s+to\\s+([\\p{L} ]+?)${PLACE_TERMINATOR}`,
    'u',
  ).exec(rest);
  if (route) {
    fields.pickupCity = titleCase(route[1]!.trim());
    fields.deliveryCity = titleCase(route[2]!.trim());
  } else {
    const delivery = new RegExp(
      `\\b(?:deliver(?:ed|y)?\\s+(?:to|at)|delivery\\s+(?:to|at|in))\\s+([\\p{L} ]+?)${PLACE_TERMINATOR}`,
      'u',
    ).exec(rest);
    if (delivery) fields.deliveryCity = titleCase(delivery[1]!.trim());
  }

  const within = /\b(?:within|in|next)\s+(\d{1,3})\s*days?\b/.exec(rest);
  if (within) fields.requiredWithinDays = Number(within[1]);
  else if (/\btomorrow\b/.test(rest)) fields.requiredWithinDays = 1;
  else if (/\b(?:within|in)\s+a\s+week\b/.test(rest)) fields.requiredWithinDays = 7;

  return fields;
}

// ---------------------------------------------------------------------------
// The whole pass
// ---------------------------------------------------------------------------

/** Values the user has already confirmed. The engine never overrides them. */
export interface CommerceLockedValues {
  categoryId?: string;
  attributes?: CommerceAttributeValues;
}

export interface InterpretOptions {
  locked?: CommerceLockedValues;
  /**
   * A classification from outside this pass — the AI layer — already
   * validated against the taxonomy by the caller.
   */
  suggested?: { categoryId: string; score: number; attributes: CommerceAttributeValues } | null;
}

/**
 * Text in, structured interpretation out.
 *
 * Precedence, highest first: what the user locked, what the text states
 * outright, what a suggestion proposes. A later suggestion can therefore fill
 * a gap but never overwrite a correction.
 */
export function interpretCommerceText(
  index: CommerceTaxonomyIndex,
  text: string,
  scope: CommerceRecordScope,
  options: InterpretOptions = {},
): CommerceInterpretation {
  const { locked, suggested } = options;

  let categoryId: string | null = null;
  let score = 0;
  let alternativeIds: string[] = [];

  if (locked?.categoryId && isCategoryActive(index, locked.categoryId)) {
    categoryId = locked.categoryId;
    score = 1;
  } else {
    const classified = classifyCategory(index, text);
    if (suggested && (!classified || suggested.score > classified.score)) {
      categoryId = suggested.categoryId;
      score = suggested.score;
      alternativeIds =
        classified && classified.categoryId !== suggested.categoryId ? [classified.categoryId] : [];
    } else if (classified) {
      categoryId = classified.categoryId;
      score = classified.score;
      alternativeIds = classified.alternativeIds;
    }
  }

  // Nothing recognisable: the generic fallback collects the basics, and an
  // administrator can promote repeated "Other" demand into a real category.
  if (!categoryId && index.fallback) {
    categoryId = index.fallback.id;
    score = 0;
  }

  const fields = categoryId ? effectiveAttributes(index, categoryId, scope) : [];
  const stated = extractAttributes(text, fields);
  const merged = validateAttributeValues(fields, {
    ...(suggested && suggested.categoryId === categoryId ? suggested.attributes : {}),
    ...stated,
    ...locked?.attributes,
  });

  const commercial = extractCommercialFields(text);
  if (categoryId) {
    const node = index.byId.get(categoryId);
    if (commercial.quantity === null && node && !node.isFallback) {
      commercial.quantity = extractLeadingCount(text, [node.name, ...node.aliases]);
    }
    commercial.unit ??= defaultUnitFor(index, categoryId);
  }
  // A seller's "5 available" is their stock; a buyer's bare count is demand.
  if (scope === 'PRODUCT' && commercial.stock === null && commercial.quantity !== null) {
    commercial.stock = commercial.quantity;
  }

  return {
    scope,
    category: categoryId ? categoryRef(index, categoryId) : null,
    confidence: confidenceBand(score),
    alternatives: alternativeIds
      .map((id) => categoryRef(index, id))
      .filter((ref): ref is NonNullable<typeof ref> => ref !== null),
    fields,
    attributes: merged.values,
    commercial,
    missing: missingForInterpretation(scope, fields, merged.values, commercial),
  };
}

/**
 * A count written straight before the product noun — "20 teak dining tables" —
 * which carries no unit word, so it is only read once the product is known.
 */
export function extractLeadingCount(text: string, productTerms: string[]): number | null {
  const normalized = normalizeCommerceText(text);
  for (const term of productTerms) {
    const phrase = tokens(term).map(escapeRegExp).join('s?\\s+');
    if (!phrase) continue;
    const match = new RegExp(`(\\d[\\d,]*)\\s+(?:[\\p{L}-]+\\s+){0,3}?${phrase}`, 'u').exec(
      normalized,
    );
    if (match) return parseAmount(match[1]!);
  }
  return null;
}
