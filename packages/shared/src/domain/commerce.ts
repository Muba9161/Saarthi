import {
  CommerceAttributeScope,
  CommerceAttributeType,
  CommerceCategoryStatus,
  type MaterialUnit,
} from './enums';

/**
 * Smart commerce engine — the shared taxonomy and its rules.
 *
 * A Seller is one account type whatever it sells; *what* it sells lives here,
 * as data. Categories nest (Furniture → Tables → Dining Table), each node may
 * declare attributes, and a node inherits every attribute of its ancestors, so
 * an administrator adds a product type by adding a row, never by adding code.
 *
 * Seller products and customer requirements are classified against the same
 * tree. That shared vocabulary is what lets a fleet owner match "25 tons of
 * river sand" to a seller's river-sand listing on structured fields rather
 * than on two strangers happening to spell a word the same way.
 *
 * Everything in this file is pure so the API, the web client and the tests
 * apply exactly the same rules.
 */

/** Which record a form is being built for. */
export type CommerceRecordScope = 'PRODUCT' | 'REQUIREMENT';

export interface CommerceAttributeValidation {
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface CommerceAttributeDefinition {
  id: string;
  /** Stable machine key, e.g. `material`, `seating_capacity`. */
  key: string;
  label: string;
  type: CommerceAttributeType;
  required: boolean;
  unit: string | null;
  options: string[];
  validation: CommerceAttributeValidation | null;
  scope: CommerceAttributeScope;
  sortOrder: number;
}

export interface CommerceCategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: CommerceCategoryStatus;
  /** The generic "Other" node unclassifiable goods fall back to. */
  isFallback: boolean;
  defaultUnit: MaterialUnit | null;
  sortOrder: number;
  aliases: string[];
  attributes: CommerceAttributeDefinition[];
}

export type CommerceAttributeValue = string | number | boolean;
export type CommerceAttributeValues = Record<string, CommerceAttributeValue>;

/** A category reference as the UI shows it: the node plus its breadcrumb. */
export interface CommerceCategoryRef {
  id: string;
  name: string;
  isFallback: boolean;
  path: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Tree index
// ---------------------------------------------------------------------------

export interface CommerceTaxonomyIndex {
  nodes: CommerceCategoryNode[];
  byId: Map<string, CommerceCategoryNode>;
  childrenOf: Map<string | null, CommerceCategoryNode[]>;
  fallback: CommerceCategoryNode | null;
}

export function buildTaxonomyIndex(nodes: CommerceCategoryNode[]): CommerceTaxonomyIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string | null, CommerceCategoryNode[]>();

  for (const node of nodes) {
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(node.parentId, siblings);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  return {
    nodes,
    byId,
    childrenOf,
    fallback:
      nodes.find((node) => node.isFallback && node.status === CommerceCategoryStatus.ACTIVE) ??
      null,
  };
}

/** Root-to-node chain. Stops rather than loops if the data ever holds a cycle. */
export function categoryPath(
  index: CommerceTaxonomyIndex,
  categoryId: string,
): CommerceCategoryNode[] {
  const path: CommerceCategoryNode[] = [];
  const seen = new Set<string>();
  let current = index.byId.get(categoryId);

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return path;
}

/** A node is usable only when it and every ancestor are active. */
export function isCategoryActive(index: CommerceTaxonomyIndex, categoryId: string): boolean {
  const path = categoryPath(index, categoryId);
  return path.length > 0 && path.every((node) => node.status === CommerceCategoryStatus.ACTIVE);
}

export function categoryRef(
  index: CommerceTaxonomyIndex,
  categoryId: string,
): CommerceCategoryRef | null {
  const path = categoryPath(index, categoryId);
  const node = path[path.length - 1];
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    isFallback: node.isFallback,
    path: path.map((entry) => ({ id: entry.id, name: entry.name })),
  };
}

/** Whether `candidateId` is `ancestorId` or sits somewhere beneath it. */
export function isCategoryWithin(
  index: CommerceTaxonomyIndex,
  candidateId: string,
  ancestorId: string,
): boolean {
  return categoryPath(index, candidateId).some((node) => node.id === ancestorId);
}

/** The node and every descendant, for "anything under Sand" queries. */
export function categorySubtreeIds(index: CommerceTaxonomyIndex, categoryId: string): string[] {
  const ids: string[] = [];
  const queue = [categoryId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ids.includes(id)) continue;
    ids.push(id);
    for (const child of index.childrenOf.get(id) ?? []) queue.push(child.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function appliesTo(attribute: CommerceAttributeDefinition, scope: CommerceRecordScope): boolean {
  return attribute.scope === CommerceAttributeScope.BOTH || attribute.scope === scope;
}

/**
 * The form a category asks for: its own attributes plus everything inherited.
 * A child redefining an ancestor's key wins, so "Dining Table" can make
 * `seating_capacity` required where "Tables" left it optional.
 */
export function effectiveAttributes(
  index: CommerceTaxonomyIndex,
  categoryId: string,
  scope: CommerceRecordScope,
): CommerceAttributeDefinition[] {
  const byKey = new Map<string, CommerceAttributeDefinition>();
  for (const node of categoryPath(index, categoryId)) {
    for (const attribute of node.attributes) {
      if (appliesTo(attribute, scope)) byKey.set(attribute.key, attribute);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}

/** The unit a category is normally traded in, nearest definition first. */
export function defaultUnitFor(
  index: CommerceTaxonomyIndex,
  categoryId: string,
): MaterialUnit | null {
  const path = categoryPath(index, categoryId);
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const unit = path[i]!.defaultUnit;
    if (unit) return unit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DEFAULT_TEXT_LIMIT = 120;

export interface AttributeValidationResult {
  /** Only known keys, coerced to their declared type. */
  values: CommerceAttributeValues;
  errors: Record<string, string>;
  /** Required keys with no usable value. */
  missing: string[];
}

function coerceValue(
  definition: CommerceAttributeDefinition,
  raw: unknown,
): { value?: CommerceAttributeValue; error?: string } {
  if (raw === undefined || raw === null || raw === '') return {};

  switch (definition.type) {
    case CommerceAttributeType.NUMBER: {
      const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(value)) return { error: `${definition.label} must be a number.` };
      const { min, max } = definition.validation ?? {};
      if (min !== undefined && value < min)
        return { error: `${definition.label} must be at least ${min}.` };
      if (max !== undefined && value > max)
        return { error: `${definition.label} must be at most ${max}.` };
      return { value };
    }
    case CommerceAttributeType.BOOLEAN: {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 'yes') return { value: true };
      if (raw === 'false' || raw === 'no') return { value: false };
      return { error: `${definition.label} must be yes or no.` };
    }
    case CommerceAttributeType.SELECT: {
      const wanted = String(raw).trim().toLowerCase();
      const option = definition.options.find((candidate) => candidate.toLowerCase() === wanted);
      return option
        ? { value: option }
        : { error: `Choose one of the listed options for ${definition.label}.` };
    }
    default: {
      if (typeof raw !== 'string' && typeof raw !== 'number') {
        return { error: `${definition.label} must be text.` };
      }
      const value = String(raw).trim();
      if (!value) return {};
      const limit = definition.validation?.maxLength ?? DEFAULT_TEXT_LIMIT;
      if (value.length > limit)
        return { error: `${definition.label} is limited to ${limit} characters.` };
      return { value };
    }
  }
}

/**
 * Validate submitted attribute values against a category's schema.
 *
 * Unknown keys are dropped rather than stored: the taxonomy is the schema, so
 * neither a client nor a model can add a column by inventing a key.
 */
export function validateAttributeValues(
  definitions: CommerceAttributeDefinition[],
  submitted: Record<string, unknown> | null | undefined,
): AttributeValidationResult {
  const values: CommerceAttributeValues = {};
  const errors: Record<string, string> = {};
  const missing: string[] = [];

  for (const definition of definitions) {
    const { value, error } = coerceValue(definition, submitted?.[definition.key]);
    if (error) errors[definition.key] = error;
    else if (value !== undefined) values[definition.key] = value;
    else if (definition.required) missing.push(definition.key);
  }

  return { values, errors, missing };
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type CommerceConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/** At or above: prefill. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
/** At or above: suggest and ask the user to confirm. Below: ask directly. */
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.6;

export function confidenceBand(score: number): CommerceConfidence {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return 'HIGH';
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Interpretation contract
// ---------------------------------------------------------------------------

/** Commercial facts read from the text, outside any category schema. */
export interface CommerceCommercialFields {
  quantity: number | null;
  unit: MaterialUnit | null;
  pricePerUnit: number | null;
  stock: number | null;
  pickupCity: string | null;
  deliveryCity: string | null;
  requiredWithinDays: number | null;
}

/** Fields outside the attribute schema that each record cannot be saved without. */
export const REQUIRED_COMMERCIAL_FIELDS: Record<
  CommerceRecordScope,
  (keyof CommerceCommercialFields)[]
> = {
  PRODUCT: ['pricePerUnit', 'stock', 'unit'],
  REQUIREMENT: ['quantity', 'unit'],
};

/**
 * What the engine understood from one line of text.
 *
 * Deliberately carries a confidence *band*, not a score or a provider name:
 * the user is shown what was detected, never how.
 */
export interface CommerceInterpretation {
  scope: CommerceRecordScope;
  category: CommerceCategoryRef | null;
  confidence: CommerceConfidence;
  /** Other plausible categories, offered when the engine is unsure. */
  alternatives: CommerceCategoryRef[];
  /** The schema for the chosen category. */
  fields: CommerceAttributeDefinition[];
  attributes: CommerceAttributeValues;
  commercial: CommerceCommercialFields;
  /** Attribute keys and commercial field names still needed before saving. */
  missing: string[];
}

export function missingForInterpretation(
  scope: CommerceRecordScope,
  fields: CommerceAttributeDefinition[],
  attributes: CommerceAttributeValues,
  commercial: CommerceCommercialFields,
): string[] {
  const attributeGaps = fields
    .filter((field) => field.required && attributes[field.key] === undefined)
    .map((field) => field.key);
  const commercialGaps = REQUIRED_COMMERCIAL_FIELDS[scope].filter(
    (key) => commercial[key] === null,
  );
  return [...attributeGaps, ...commercialGaps];
}

// ---------------------------------------------------------------------------
// Matching — a customer requirement against a seller listing
// ---------------------------------------------------------------------------

export type CategoryMatchKind = 'EXACT' | 'MORE_SPECIFIC' | 'MORE_GENERAL';

export interface ListingMatchInput {
  requirement: {
    categoryId: string;
    attributes: CommerceAttributeValues;
    quantity: number | null;
    unit: MaterialUnit | null;
  };
  listing: {
    categoryId: string;
    attributes: CommerceAttributeValues;
    availableQuantity: number;
    minimumOrderQty: number;
    unit: MaterialUnit;
  };
  /** Road-agnostic distance from the listing's pickup to the delivery point. */
  distanceKm: number | null;
}

export interface ListingMatch {
  score: number;
  categoryMatch: CategoryMatchKind;
  matchedAttributes: string[];
  conflictingAttributes: string[];
  /** Null when the units differ, so the quantities cannot be compared. */
  stockSufficient: boolean | null;
  meetsMinimumOrder: boolean | null;
  reasons: string[];
}

/** Weighting of the match score; sums to 100. */
const MATCH_WEIGHTS = { category: 45, attributes: 25, stock: 15, distance: 15 } as const;
/** Distance beyond which a listing earns no proximity credit. */
const MATCH_DISTANCE_CEILING_KM = 500;

function sameValue(a: CommerceAttributeValue, b: CommerceAttributeValue): boolean {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/**
 * Score one listing against one requirement on structured data alone.
 *
 * Returns null when the two are in unrelated parts of the tree: a sand
 * requirement is never "a weak match" for a dining table.
 */
export function scoreListingMatch(
  index: CommerceTaxonomyIndex,
  input: ListingMatchInput,
): ListingMatch | null {
  const { requirement, listing } = input;
  const reasons: string[] = [];

  let categoryMatch: CategoryMatchKind;
  let categoryScore: number;
  if (listing.categoryId === requirement.categoryId) {
    categoryMatch = 'EXACT';
    categoryScore = MATCH_WEIGHTS.category;
    reasons.push('Same product type');
  } else if (isCategoryWithin(index, listing.categoryId, requirement.categoryId)) {
    categoryMatch = 'MORE_SPECIFIC';
    categoryScore = MATCH_WEIGHTS.category * 0.9;
    reasons.push('A specific type of what was asked for');
  } else if (isCategoryWithin(index, requirement.categoryId, listing.categoryId)) {
    categoryMatch = 'MORE_GENERAL';
    categoryScore = MATCH_WEIGHTS.category * 0.5;
    reasons.push('Listed more generally than the request');
  } else {
    return null;
  }

  const matchedAttributes: string[] = [];
  const conflictingAttributes: string[] = [];
  const wanted = Object.entries(requirement.attributes);
  for (const [key, value] of wanted) {
    const offered = listing.attributes[key];
    if (offered === undefined) continue;
    if (sameValue(offered, value)) matchedAttributes.push(key);
    else conflictingAttributes.push(key);
  }
  const attributeScore =
    wanted.length === 0
      ? MATCH_WEIGHTS.attributes * 0.5
      : (MATCH_WEIGHTS.attributes * matchedAttributes.length) / wanted.length;
  if (matchedAttributes.length > 0) reasons.push(`${matchedAttributes.length} detail(s) match`);
  if (conflictingAttributes.length > 0)
    reasons.push(`${conflictingAttributes.length} detail(s) differ`);

  const comparable = requirement.quantity !== null && requirement.unit === listing.unit;
  const stockSufficient = comparable ? listing.availableQuantity >= requirement.quantity! : null;
  const meetsMinimumOrder = comparable ? requirement.quantity! >= listing.minimumOrderQty : null;
  const stockScore =
    stockSufficient === true
      ? MATCH_WEIGHTS.stock
      : stockSufficient === null
        ? MATCH_WEIGHTS.stock / 3
        : 0;
  if (stockSufficient === true) reasons.push('Enough stock');
  if (stockSufficient === false) reasons.push('Not enough stock for the full quantity');
  if (!comparable && requirement.unit && requirement.unit !== listing.unit)
    reasons.push('Sold in a different unit');

  const distanceScore =
    input.distanceKm === null
      ? MATCH_WEIGHTS.distance / 2
      : MATCH_WEIGHTS.distance * Math.max(0, 1 - input.distanceKm / MATCH_DISTANCE_CEILING_KM);

  return {
    score: Math.round(categoryScore + attributeScore + stockScore + distanceScore),
    categoryMatch,
    matchedAttributes,
    conflictingAttributes,
    stockSufficient,
    meetsMinimumOrder,
    reasons,
  };
}
