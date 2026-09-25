import {
  type CommerceCategoryNode,
  CommerceCategoryStatus,
  type CommerceOtherUsageQuery,
  type CreateCommerceAliasInput,
  type CreateCommerceAttributeInput,
  type CreateCommerceCategoryInput,
  type Paginated,
  type UpdateCommerceAttributeInput,
  type UpdateCommerceCategoryInput,
  buildPaginationMeta,
  categoryPath,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { invalidateTaxonomy, loadTaxonomy } from './taxonomy.service';

/**
 * Administrator management of the commerce taxonomy.
 *
 * Only platform administrators reach this (see the routes). The taxonomy is
 * the schema every listing and requirement is validated against, so a seller
 * or customer never edits it, and neither does a model: AI may *read* the
 * tree to suggest a node, but new nodes arrive only through here.
 *
 * Every write invalidates the cached tree, which also rotates the taxonomy
 * version that AI classifications are cached under.
 */

export interface AdminCategoryNode extends CommerceCategoryNode {
  /** Aliases with ids, so each can be removed individually. */
  aliasEntries: { id: string; alias: string }[];
  listingCount: number;
  requirementCount: number;
}

export async function listAllCategories(): Promise<AdminCategoryNode[]> {
  const [{ index }, aliases, listingCounts, requirementCounts] = await Promise.all([
    loadTaxonomy(),
    prisma.commerceCategoryAlias.findMany({ select: { id: true, alias: true, categoryId: true } }),
    prisma.material.groupBy({
      by: ['categoryId'],
      where: { archivedAt: null, categoryId: { not: null } },
      _count: { _all: true },
    }),
    prisma.requirement.groupBy({
      by: ['categoryId'],
      where: { categoryId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const listings = new Map(listingCounts.map((row) => [row.categoryId, row._count._all]));
  const requirements = new Map(requirementCounts.map((row) => [row.categoryId, row._count._all]));

  return index.nodes.map((node) => ({
    ...node,
    aliasEntries: aliases
      .filter((alias) => alias.categoryId === node.id)
      .map((alias) => ({ id: alias.id, alias: alias.alias })),
    listingCount: listings.get(node.id) ?? 0,
    requirementCount: requirements.get(node.id) ?? 0,
  }));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'category';
  let candidate = root;
  for (
    let suffix = 2;
    await prisma.commerceCategory.findUnique({ where: { slug: candidate }, select: { id: true } });
    suffix += 1
  ) {
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}

async function requireCategory(categoryId: string) {
  const category = await prisma.commerceCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw errors.notFound('Category');
  return category;
}

export async function createCategory(input: CreateCommerceCategoryInput): Promise<{ id: string }> {
  if (input.parentId) {
    const parent = await requireCategory(input.parentId);
    if (parent.isFallback) {
      throw errors.businessRule(
        '"Other" is the fallback for unclassified goods and cannot have children.',
      );
    }
  }

  const slug = input.slug ?? (await uniqueSlug(slugify(input.name)));

  const category = await prisma.commerceCategory.create({
    data: {
      parentId: input.parentId ?? null,
      name: input.name,
      slug,
      description: input.description ?? null,
      defaultUnit: input.defaultUnit ?? null,
      sortOrder: input.sortOrder,
      aliases: {
        createMany: {
          data: [...new Set(input.aliases.map((alias) => alias.toLowerCase()))].map((alias) => ({
            alias,
          })),
        },
      },
    },
    select: { id: true },
  });

  await invalidateTaxonomy();
  return category;
}

export async function updateCategory(
  categoryId: string,
  input: UpdateCommerceCategoryInput,
): Promise<void> {
  const category = await requireCategory(categoryId);

  if (input.status === CommerceCategoryStatus.INACTIVE && category.isFallback) {
    throw errors.businessRule(
      '"Other" cannot be disabled: unclassifiable goods would have nowhere to go.',
    );
  }

  await prisma.commerceCategory.update({
    where: { id: categoryId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.defaultUnit !== undefined ? { defaultUnit: input.defaultUnit } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await invalidateTaxonomy();
}

export async function createAttribute(
  categoryId: string,
  input: CreateCommerceAttributeInput,
): Promise<{ id: string }> {
  await requireCategory(categoryId);

  const attribute = await prisma.commerceCategoryAttribute.create({
    data: {
      categoryId,
      key: input.key,
      label: input.label,
      type: input.type,
      required: input.required,
      unit: input.unit ?? null,
      options: input.options,
      validation: input.validation ?? undefined,
      scope: input.scope,
      sortOrder: input.sortOrder,
    },
    select: { id: true },
  });

  await invalidateTaxonomy();
  return attribute;
}

export async function updateAttribute(
  attributeId: string,
  input: UpdateCommerceAttributeInput,
): Promise<void> {
  const attribute = await prisma.commerceCategoryAttribute.findUnique({
    where: { id: attributeId },
  });
  if (!attribute) throw errors.notFound('Attribute');

  const options = input.options ?? attribute.options;
  if (attribute.type === 'SELECT' && options.length === 0) {
    throw errors.validation('A choice attribute needs at least one option.', {
      fields: { options: 'Add at least one option.' },
    });
  }

  await prisma.commerceCategoryAttribute.update({
    where: { id: attributeId },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.unit !== undefined ? { unit: input.unit ?? null } : {}),
      ...(input.options !== undefined ? { options: input.options } : {}),
      ...(input.validation !== undefined
        ? { validation: (input.validation ?? undefined) as Prisma.InputJsonObject | undefined }
        : {}),
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });

  await invalidateTaxonomy();
}

/**
 * Remove an attribute from the schema. Values already stored under its key
 * are left in place and simply stop being shown or validated — deleting a
 * form field must not rewrite anybody's listing.
 */
export async function deleteAttribute(attributeId: string): Promise<void> {
  const attribute = await prisma.commerceCategoryAttribute.findUnique({
    where: { id: attributeId },
  });
  if (!attribute) throw errors.notFound('Attribute');
  await prisma.commerceCategoryAttribute.delete({ where: { id: attributeId } });
  await invalidateTaxonomy();
}

export async function addAlias(
  categoryId: string,
  input: CreateCommerceAliasInput,
): Promise<{ id: string }> {
  await requireCategory(categoryId);
  const alias = await prisma.commerceCategoryAlias.create({
    data: { categoryId, alias: input.alias.toLowerCase() },
    select: { id: true },
  });
  await invalidateTaxonomy();
  return alias;
}

export async function deleteAlias(aliasId: string): Promise<void> {
  const alias = await prisma.commerceCategoryAlias.findUnique({ where: { id: aliasId } });
  if (!alias) throw errors.notFound('Alias');
  await prisma.commerceCategoryAlias.delete({ where: { id: aliasId } });
  await invalidateTaxonomy();
}

export interface OtherUsageEntry {
  kind: 'PRODUCT' | 'REQUIREMENT';
  id: string;
  /** What the seller or customer called it — the evidence for a new category. */
  name: string;
  details: string | null;
  createdAt: string;
}

/**
 * Listings and requirements filed under the fallback, newest first.
 *
 * Only the product wording is returned: this screen exists to decide which
 * category to add next, and that needs to know what people are selling, not
 * who they are.
 */
export async function otherUsage(
  query: CommerceOtherUsageQuery,
): Promise<Paginated<OtherUsageEntry>> {
  const { index } = await loadTaxonomy();
  const fallbackIds = index.nodes
    .filter((node) => categoryPath(index, node.id).some((ancestor) => ancestor.isFallback))
    .map((node) => node.id);
  if (fallbackIds.length === 0)
    return { items: [], pagination: buildPaginationMeta(query.page, query.pageSize, 0) };

  const window = query.page * query.pageSize;
  const [listings, requirements, listingTotal, requirementTotal] = await Promise.all([
    prisma.material.findMany({
      where: { categoryId: { in: fallbackIds }, archivedAt: null },
      select: { id: true, name: true, description: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: window,
    }),
    prisma.requirement.findMany({
      where: { categoryId: { in: fallbackIds } },
      select: { id: true, materialName: true, specification: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: window,
    }),
    prisma.material.count({ where: { categoryId: { in: fallbackIds }, archivedAt: null } }),
    prisma.requirement.count({ where: { categoryId: { in: fallbackIds } } }),
  ]);

  const merged: OtherUsageEntry[] = [
    ...listings.map((row) => ({
      kind: 'PRODUCT' as const,
      id: row.id,
      name: row.name,
      details: row.description,
      createdAt: row.createdAt.toISOString(),
    })),
    ...requirements.map((row) => ({
      kind: 'REQUIREMENT' as const,
      id: row.id,
      name: row.materialName ?? 'Unnamed requirement',
      details: row.specification,
      createdAt: row.createdAt.toISOString(),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: merged.slice(start, start + query.pageSize),
    pagination: buildPaginationMeta(query.page, query.pageSize, listingTotal + requirementTotal),
  };
}
