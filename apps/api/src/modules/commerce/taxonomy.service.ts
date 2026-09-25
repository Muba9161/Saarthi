import { createHash } from 'node:crypto';
import {
  type CommerceAttributeDefinition,
  type CommerceAttributeScope,
  type CommerceAttributeType,
  type CommerceAttributeValidation,
  type CommerceAttributeValues,
  type CommerceCategoryNode,
  type CommerceCategoryStatus,
  type CommerceRecordScope,
  type CommerceTaxonomyIndex,
  type MaterialUnit,
  buildTaxonomyIndex,
  effectiveAttributes,
  isCategoryActive,
  validateAttributeValues,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { cache } from '../../infra/cache';
import { cacheKeys, cacheTtl } from '../../infra/cache-keys';
import { errors } from '../../lib/errors';

/**
 * The commerce taxonomy as the rest of the API sees it.
 *
 * PostgreSQL is the source of truth; this module assembles the tree once,
 * caches it, and is the only place that decides whether a listing or a
 * requirement may be filed under a category with a given set of values.
 */

const categoryInclude = {
  attributes: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
  aliases: { orderBy: { alias: 'asc' } },
} satisfies Prisma.CommerceCategoryInclude;

export type CategoryRecord = Prisma.CommerceCategoryGetPayload<{ include: typeof categoryInclude }>;

function toValidation(value: Prisma.JsonValue | null): CommerceAttributeValidation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rules: CommerceAttributeValidation = {};
  for (const key of ['min', 'max', 'maxLength'] as const) {
    const rule = (value as Record<string, unknown>)[key];
    if (typeof rule === 'number' && Number.isFinite(rule)) rules[key] = rule;
  }
  return Object.keys(rules).length > 0 ? rules : null;
}

export function toCategoryNode(record: CategoryRecord): CommerceCategoryNode {
  return {
    id: record.id,
    parentId: record.parentId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    status: record.status as CommerceCategoryStatus,
    isFallback: record.isFallback,
    defaultUnit: record.defaultUnit as MaterialUnit | null,
    sortOrder: record.sortOrder,
    aliases: record.aliases.map((alias) => alias.alias),
    attributes: record.attributes.map((attribute): CommerceAttributeDefinition => ({
      id: attribute.id,
      key: attribute.key,
      label: attribute.label,
      type: attribute.type as CommerceAttributeType,
      required: attribute.required,
      unit: attribute.unit,
      options: attribute.options,
      validation: toValidation(attribute.validation),
      scope: attribute.scope as CommerceAttributeScope,
      sortOrder: attribute.sortOrder,
    })),
  };
}

interface CachedTaxonomy {
  nodes: CommerceCategoryNode[];
  version: string;
}

export interface LoadedTaxonomy {
  index: CommerceTaxonomyIndex;
  /** Changes whenever any node, attribute or alias changes. */
  version: string;
}

/** Every node, active or not — the index knows how to ignore inactive ones. */
export async function loadTaxonomy(): Promise<LoadedTaxonomy> {
  const key = cacheKeys.commerceTaxonomy();
  let cached = await cache.get<CachedTaxonomy>(key);

  if (!cached) {
    const records = await prisma.commerceCategory.findMany({
      include: categoryInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const nodes = records.map(toCategoryNode);
    const version = createHash('sha256').update(JSON.stringify(nodes)).digest('hex').slice(0, 12);
    cached = { nodes, version };
    await cache.set(key, cached, cacheTtl.commerceTaxonomy);
  }

  return { index: buildTaxonomyIndex(cached.nodes), version: cached.version };
}

export async function invalidateTaxonomy(): Promise<void> {
  await cache.delete(cacheKeys.commerceTaxonomy());
}

/** The tree a seller or customer can choose from: active nodes only. */
export async function activeCategories(): Promise<CommerceCategoryNode[]> {
  const { index } = await loadTaxonomy();
  return (
    index.nodes
      .filter((node) => isCategoryActive(index, node.id))
      // Aliases are classifier vocabulary, not something a form needs.
      .map((node) => ({ ...node, aliases: [] }))
  );
}

export interface CategoryAssignment {
  categoryId: string;
  /** The node's name, kept on the record as its human-readable category. */
  categoryName: string;
  attributes: CommerceAttributeValues;
}

/**
 * Validate a category and its attribute values for a listing or requirement.
 *
 * Unknown keys are dropped, values are coerced to their declared type, and a
 * missing required value or an out-of-range one is a 400 naming the field —
 * the same rule whether the values were typed, prefilled or suggested by AI.
 */
export async function resolveCategoryAssignment(
  categoryId: string,
  submitted: Record<string, unknown> | undefined,
  scope: CommerceRecordScope,
): Promise<CategoryAssignment> {
  const { index } = await loadTaxonomy();
  const node = index.byId.get(categoryId);
  if (!node || !isCategoryActive(index, categoryId)) {
    throw errors.validation('That category is not available. Choose another.', {
      fields: { categoryId: 'That category is not available.' },
    });
  }

  const definitions = effectiveAttributes(index, categoryId, scope);
  const result = validateAttributeValues(definitions, submitted);
  const fields: Record<string, string> = { ...result.errors };
  const labels = new Map(definitions.map((field) => [field.key, field.label]));
  for (const key of result.missing) fields[key] = `${labels.get(key) ?? key} is required.`;

  if (Object.keys(fields).length > 0) {
    throw errors.validation(Object.values(fields)[0]!, {
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, message]) => [`attributes.${key}`, message]),
      ),
    });
  }

  return { categoryId, categoryName: node.name, attributes: result.values };
}

/** Stored JSON back to typed values, ignoring anything that is not a scalar. */
export function readAttributeValues(value: Prisma.JsonValue | null): CommerceAttributeValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const values: CommerceAttributeValues = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean')
      values[key] = entry;
  }
  return values;
}
