import {
  type CommerceAttributeValues,
  type CommerceCategoryRef,
  type CommerceTaxonomyIndex,
  MaterialStatus,
  buildPaginationMeta,
  categoryRef,
  distanceKm,
  normalizeCommerceText,
  type CreateMaterialInput,
  type MaterialListQuery,
  type Paginated,
  type UpdateMaterialInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import type { AuthContext } from '../../auth/context';
import {
  type CategoryAssignment,
  loadTaxonomy,
  readAttributeValues,
  resolveCategoryAssignment,
} from '../commerce/taxonomy.service';

/**
 * Seller listings ("materials" internally, whatever the goods are).
 *
 * A Seller manages its own catalogue; fleet owners read an availability-
 * filtered view of every listing to source against, so the read path is
 * deliberately cross-tenant while every write is tenant-scoped. Customers do
 * not read it at all — they reach sellers only through a fleet owner.
 */

export interface MaterialSummary {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierVerified: boolean;
  supplierRating: number | null;
  organizationId: string;
  name: string;
  category: string | null;
  /** The taxonomy node, with its breadcrumb, when the listing is classified. */
  commerceCategory: CommerceCategoryRef | null;
  attributes: CommerceAttributeValues;
  description: string | null;
  unit: string;
  pricePerUnit: number;
  availableQuantity: number;
  minimumOrderQty: number;
  status: string;
  pickupAddress: string | null;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  distanceKm: number | null;
  createdAt: string;
  updatedAt: string;
}

const materialInclude = {
  supplier: {
    include: {},
  },
} satisfies Prisma.MaterialInclude;

type MaterialRecord = Prisma.MaterialGetPayload<{ include: typeof materialInclude }>;

function toSummary(
  material: MaterialRecord,
  supplierName: string,
  index: CommerceTaxonomyIndex,
  distance: number | null = null,
): MaterialSummary {
  return {
    id: material.id,
    supplierId: material.supplierId,
    supplierName,
    supplierVerified: material.supplier.verificationStatus === 'VERIFIED',
    supplierRating: material.supplier.rating,
    organizationId: material.organizationId,
    name: material.name,
    category: material.category,
    commerceCategory: material.categoryId ? categoryRef(index, material.categoryId) : null,
    attributes: readAttributeValues(material.attributes),
    description: material.description,
    unit: material.unit,
    pricePerUnit: Number(material.pricePerUnit),
    availableQuantity: material.availableQuantity,
    minimumOrderQty: material.minimumOrderQty,
    status: material.status,
    pickupAddress: material.pickupAddress,
    pickupLatitude: material.pickupLatitude,
    pickupLongitude: material.pickupLongitude,
    distanceKm: distance,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  };
}

async function supplierNames(organizationIds: string[]): Promise<Map<string, string>> {
  const organizations = await prisma.organization.findMany({
    where: { id: { in: organizationIds } },
    select: { id: true, name: true },
  });
  return new Map(organizations.map((organization) => [organization.id, organization.name]));
}

async function summaryFor(material: MaterialRecord): Promise<MaterialSummary> {
  const [organization, { index }] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: material.organizationId },
      select: { name: true },
    }),
    loadTaxonomy(),
  ]);
  return toSummary(material, organization?.name ?? 'Seller', index);
}

export async function listMaterials(
  auth: AuthContext,
  query: MaterialListQuery,
  options: { ownOnly?: boolean } = {},
): Promise<Paginated<MaterialSummary>> {
  const where: Prisma.MaterialWhereInput = {
    archivedAt: null,
    ...(options.ownOnly ? { organizationId: auth.organizationId ?? '__none__' } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.category ? { category: { equals: query.category, mode: 'insensitive' } } : {}),
    ...(query.status ? { status: { in: query.status as MaterialStatus[] } } : {}),
    ...(query.availableOnly ? { status: MaterialStatus.ACTIVE, availableQuantity: { gt: 0 } } : {}),
    ...(query.maxPrice !== undefined ? { pricePerUnit: { lte: query.maxPrice } } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { category: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const wantsDistance = query.nearLatitude !== undefined && query.nearLongitude !== undefined;

  // Distance ranking has to happen in memory, so load the filtered set once.
  if (wantsDistance) {
    const [materials, { index }] = await Promise.all([
      prisma.material.findMany({ where, include: materialInclude }),
      loadTaxonomy(),
    ]);
    const names = await supplierNames(materials.map((material) => material.organizationId));
    const origin = { latitude: query.nearLatitude!, longitude: query.nearLongitude! };

    const withDistance = materials
      .map((material) => {
        const distance =
          material.pickupLatitude !== null && material.pickupLongitude !== null
            ? distanceKm(origin, {
                latitude: material.pickupLatitude,
                longitude: material.pickupLongitude,
              })
            : null;
        return { material, distance };
      })
      .filter(
        (entry) =>
          query.radiusKm === undefined ||
          entry.distance === null ||
          entry.distance <= query.radiusKm,
      )
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    const start = (query.page - 1) * query.pageSize;
    return {
      items: withDistance
        .slice(start, start + query.pageSize)
        .map((entry) =>
          toSummary(
            entry.material,
            names.get(entry.material.organizationId) ?? 'Seller',
            index,
            entry.distance === null ? null : Number(entry.distance.toFixed(1)),
          ),
        ),
      pagination: buildPaginationMeta(query.page, query.pageSize, withDistance.length),
    };
  }

  const orderBy: Prisma.MaterialOrderByWithRelationInput =
    query.sortBy === 'name'
      ? { name: query.sortOrder }
      : query.sortBy === 'pricePerUnit'
        ? { pricePerUnit: query.sortOrder }
        : { createdAt: query.sortOrder };

  const [total, materials, { index }] = await Promise.all([
    prisma.material.count({ where }),
    prisma.material.findMany({
      where,
      include: materialInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
    loadTaxonomy(),
  ]);

  const names = await supplierNames(materials.map((material) => material.organizationId));

  return {
    items: materials.map((material) =>
      toSummary(material, names.get(material.organizationId) ?? 'Seller', index),
    ),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getMaterial(materialId: string): Promise<MaterialSummary> {
  const material = await prisma.material.findFirst({
    where: { id: materialId, archivedAt: null },
    include: materialInclude,
  });
  if (!material) throw errors.notFound('Material');

  return summaryFor(material);
}

async function requireSupplier(organizationId: string) {
  const supplier = await prisma.supplier.findUnique({ where: { organizationId } });
  if (!supplier) {
    throw errors.businessRule('This organization is not registered as a seller on Saarthi.');
  }
  return supplier;
}

/**
 * Refuse a second live listing of the same product under the same category.
 * Two identical rows would split the seller's stock across listings a fleet
 * owner cannot tell apart.
 */
async function assertNotDuplicateListing(
  organizationId: string,
  assignment: CategoryAssignment,
  name: string,
  excludeMaterialId?: string,
): Promise<void> {
  const siblings = await prisma.material.findMany({
    where: {
      organizationId,
      categoryId: assignment.categoryId,
      archivedAt: null,
      ...(excludeMaterialId ? { id: { not: excludeMaterialId } } : {}),
    },
    select: { name: true },
    take: 200,
  });
  const wanted = normalizeCommerceText(name);
  if (siblings.some((sibling) => normalizeCommerceText(sibling.name) === wanted)) {
    throw errors.conflict(
      `You already list "${name}". Update that listing's price or stock instead.`,
    );
  }
}

export async function createMaterial(
  auth: AuthContext,
  organizationId: string,
  input: CreateMaterialInput,
): Promise<MaterialSummary> {
  const supplier = await requireSupplier(organizationId);

  const assignment = input.categoryId
    ? await resolveCategoryAssignment(input.categoryId, input.attributes, 'PRODUCT')
    : null;
  if (assignment) await assertNotDuplicateListing(organizationId, assignment, input.name);

  const material = await prisma.material.create({
    data: {
      supplierId: supplier.id,
      organizationId,
      name: input.name,
      category: assignment?.categoryName ?? input.category ?? null,
      categoryId: assignment?.categoryId ?? null,
      attributes: assignment ? (assignment.attributes as Prisma.InputJsonObject) : undefined,
      description: input.description ?? null,
      unit: input.unit,
      pricePerUnit: input.pricePerUnit,
      availableQuantity: input.availableQuantity,
      minimumOrderQty: input.minimumOrderQty,
      status: input.status,
      // Default the pickup point to the supplier's yard.
      pickupAddress: input.pickupAddress ?? supplier.addressLine,
      pickupLatitude: input.pickupLatitude ?? supplier.latitude,
      pickupLongitude: input.pickupLongitude ?? supplier.longitude,
    },
    include: materialInclude,
  });

  void auth;
  return summaryFor(material);
}

export async function updateMaterial(
  auth: AuthContext,
  materialId: string,
  input: UpdateMaterialInput,
): Promise<MaterialSummary> {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw errors.notFound('Material');
  if (!auth.isPlatformAdmin && material.organizationId !== auth.organizationId) {
    throw errors.notFound('Material');
  }

  // Re-classifying, or changing the values of a classified listing, is checked
  // against the schema of whichever category the listing ends up under.
  const categoryId = input.categoryId ?? material.categoryId;
  const reclassifying = input.categoryId !== undefined || input.attributes !== undefined;
  const assignment =
    categoryId && reclassifying
      ? await resolveCategoryAssignment(
          categoryId,
          input.attributes ?? readAttributeValues(material.attributes),
          'PRODUCT',
        )
      : null;
  if (assignment && (input.categoryId !== undefined || input.name !== undefined)) {
    await assertNotDuplicateListing(
      material.organizationId,
      assignment,
      input.name ?? material.name,
      materialId,
    );
  }

  const updated = await prisma.material.update({
    where: { id: materialId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(assignment
        ? {
            category: assignment.categoryName,
            categoryId: assignment.categoryId,
            attributes: assignment.attributes as Prisma.InputJsonObject,
          }
        : input.category !== undefined
          ? { category: input.category }
          : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.pricePerUnit !== undefined ? { pricePerUnit: input.pricePerUnit } : {}),
      ...(input.availableQuantity !== undefined
        ? { availableQuantity: input.availableQuantity }
        : {}),
      ...(input.minimumOrderQty !== undefined ? { minimumOrderQty: input.minimumOrderQty } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.pickupAddress !== undefined ? { pickupAddress: input.pickupAddress } : {}),
      ...(input.pickupLatitude !== undefined ? { pickupLatitude: input.pickupLatitude } : {}),
      ...(input.pickupLongitude !== undefined ? { pickupLongitude: input.pickupLongitude } : {}),
    },
    include: materialInclude,
  });

  return summaryFor(updated);
}

export async function archiveMaterial(auth: AuthContext, materialId: string): Promise<void> {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw errors.notFound('Material');
  if (!auth.isPlatformAdmin && material.organizationId !== auth.organizationId) {
    throw errors.notFound('Material');
  }

  const activeOrders = await prisma.order.count({
    where: {
      materialId,
      status: { in: ['REQUESTED', 'QUOTED', 'CONFIRMED', 'ASSIGNED', 'PICKUP', 'IN_TRANSIT'] },
    },
  });
  if (activeOrders > 0) {
    throw errors.businessRule(
      `This material is referenced by ${activeOrders} active order(s). Mark it inactive instead of removing it.`,
    );
  }

  await prisma.material.update({
    where: { id: materialId },
    data: { archivedAt: new Date(), status: MaterialStatus.INACTIVE },
  });
}

/** Distinct categories present on the marketplace, for filter chips. */
export async function materialCategories(): Promise<string[]> {
  const rows = await prisma.material.findMany({
    where: { archivedAt: null, category: { not: null } },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((row) => row.category!).filter(Boolean);
}
