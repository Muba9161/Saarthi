import {
  type CategoryMatchKind,
  type CommerceAttributeValues,
  type CommerceCategoryRef,
  type CommerceMatchQuery,
  type CommerceTaxonomyIndex,
  type MaterialUnit,
  MaterialStatus,
  RequirementKind,
  categoryPath,
  categoryRef,
  categorySubtreeIds,
  distanceKm,
  interpretCommerceText,
  scoreListingMatch,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import { assertRequirementAccess } from '../requirements/requirement.access';
import { requirementInclude, type RequirementRecord } from '../requirements/requirement.view';
import { loadTaxonomy, readAttributeValues } from './taxonomy.service';

/**
 * Seller discovery for a fleet owner answering a customer's material need.
 *
 * Structured first: the requirement's category, details, quantity and unit
 * are scored against every listing in the same branch of the taxonomy. Only a
 * requirement that was never classified falls back to a text search.
 *
 * This is the fleet owner's procurement view — it names the Seller, because
 * the fleet deals with the Seller. It is never served to the customer, and a
 * match authorises nothing: the customer still deals only with the fleet.
 */

/** Listings loaded per request before scoring; bounded so a busy branch stays cheap. */
const CANDIDATE_LIMIT = 200;

export interface SellerMatch {
  materialId: string;
  name: string;
  sellerOrganizationId: string;
  sellerName: string;
  sellerVerified: boolean;
  category: CommerceCategoryRef | null;
  attributes: CommerceAttributeValues;
  unit: MaterialUnit;
  pricePerUnit: number;
  availableQuantity: number;
  minimumOrderQty: number;
  pickupAddress: string | null;
  distanceKm: number | null;
  /** Listing price × requested quantity: what the fleet would pay the Seller. */
  procurementReference: number | null;
  score: number;
  /** `TEXT` when the requirement was never classified and this was found by name. */
  categoryMatch: CategoryMatchKind | 'TEXT';
  stockSufficient: boolean | null;
  meetsMinimumOrder: boolean | null;
  matchedAttributes: string[];
  conflictingAttributes: string[];
  reasons: string[];
}

const listingSelect = {
  id: true,
  name: true,
  organizationId: true,
  categoryId: true,
  category: true,
  attributes: true,
  unit: true,
  pricePerUnit: true,
  availableQuantity: true,
  minimumOrderQty: true,
  pickupAddress: true,
  pickupLatitude: true,
  pickupLongitude: true,
  supplier: { select: { verificationStatus: true } },
} satisfies Prisma.MaterialSelect;

type Listing = Prisma.MaterialGetPayload<{ select: typeof listingSelect }>;

/**
 * The category to match on: the one the customer confirmed, or — for a
 * requirement posted before the taxonomy existed — what the taxonomy reads
 * from its title and material name, if it reads anything with confidence.
 */
function requirementCategory(
  index: CommerceTaxonomyIndex,
  requirement: RequirementRecord,
): string | null {
  if (requirement.categoryId) return requirement.categoryId;
  const text = [requirement.materialName, requirement.materialCategory].filter(Boolean).join(' ');
  if (!text) return null;
  const inferred = interpretCommerceText(index, text, 'REQUIREMENT');
  return inferred.category && !inferred.category.isFallback && inferred.confidence !== 'LOW'
    ? inferred.category.id
    : null;
}

function deliveryPoint(requirement: RequirementRecord): { latitude: number; longitude: number } {
  return requirement.destinationLatitude !== null && requirement.destinationLongitude !== null
    ? { latitude: requirement.destinationLatitude, longitude: requirement.destinationLongitude }
    : { latitude: requirement.originLatitude, longitude: requirement.originLongitude };
}

export async function matchSellers(
  auth: AuthContext,
  requirementId: string,
  query: CommerceMatchQuery,
): Promise<SellerMatch[]> {
  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: requirementInclude,
  });
  if (!requirement) throw errors.notFound('Requirement');
  await assertRequirementAccess(auth, requirement);
  if (requirement.kind !== RequirementKind.MATERIAL_SUPPLY) {
    throw errors.businessRule('Only a material requirement is sourced from sellers.');
  }

  const { index } = await loadTaxonomy();
  const categoryId = requirementCategory(index, requirement);
  if (!categoryId && !requirement.materialCategory && !requirement.materialName) return [];

  const available: Prisma.MaterialWhereInput = {
    archivedAt: null,
    status: MaterialStatus.ACTIVE,
    availableQuantity: { gt: 0 },
  };

  const where: Prisma.MaterialWhereInput = categoryId
    ? {
        ...available,
        // The branch below the requested node, plus the nodes above it: a
        // "Sand" listing can still answer a "River Sand" need.
        categoryId: {
          in: [
            ...categorySubtreeIds(index, categoryId),
            ...categoryPath(index, categoryId).map((node) => node.id),
          ],
        },
      }
    : {
        ...available,
        OR: [
          ...(requirement.materialCategory
            ? [{ category: { equals: requirement.materialCategory, mode: 'insensitive' as const } }]
            : []),
          ...(requirement.materialName
            ? [{ name: { contains: requirement.materialName, mode: 'insensitive' as const } }]
            : []),
        ],
      };

  const listings = await prisma.material.findMany({
    where,
    select: listingSelect,
    orderBy: { updatedAt: 'desc' },
    take: CANDIDATE_LIMIT,
  });

  const sellers = await prisma.organization.findMany({
    where: { id: { in: [...new Set(listings.map((listing) => listing.organizationId))] } },
    select: { id: true, name: true },
  });
  const sellerName = new Map(sellers.map((seller) => [seller.id, seller.name]));

  const delivery = deliveryPoint(requirement);
  const wanted = readAttributeValues(requirement.attributes);
  const quantity = requirement.quantity;

  const matches = listings.flatMap((listing: Listing): SellerMatch[] => {
    const distance =
      listing.pickupLatitude !== null && listing.pickupLongitude !== null
        ? Number(
            distanceKm(delivery, {
              latitude: listing.pickupLatitude,
              longitude: listing.pickupLongitude,
            }).toFixed(1),
          )
        : null;
    const offered = readAttributeValues(listing.attributes);

    const scored =
      categoryId && listing.categoryId
        ? scoreListingMatch(index, {
            requirement: {
              categoryId,
              attributes: wanted,
              quantity,
              unit: requirement.unit as MaterialUnit | null,
            },
            listing: {
              categoryId: listing.categoryId,
              attributes: offered,
              availableQuantity: listing.availableQuantity,
              minimumOrderQty: listing.minimumOrderQty,
              unit: listing.unit as MaterialUnit,
            },
            distanceKm: distance,
          })
        : null;
    if (categoryId && !scored) return [];

    const comparable = quantity !== null && requirement.unit === listing.unit;
    return [
      {
        materialId: listing.id,
        name: listing.name,
        sellerOrganizationId: listing.organizationId,
        sellerName: sellerName.get(listing.organizationId) ?? 'Seller',
        sellerVerified: listing.supplier.verificationStatus === 'VERIFIED',
        category: listing.categoryId ? categoryRef(index, listing.categoryId) : null,
        attributes: offered,
        unit: listing.unit as MaterialUnit,
        pricePerUnit: Number(listing.pricePerUnit),
        availableQuantity: listing.availableQuantity,
        minimumOrderQty: listing.minimumOrderQty,
        pickupAddress: listing.pickupAddress,
        distanceKm: distance,
        procurementReference:
          quantity !== null
            ? Math.round(Number(listing.pricePerUnit) * quantity * 100) / 100
            : null,
        score: scored?.score ?? (comparable && listing.availableQuantity >= quantity! ? 50 : 30),
        categoryMatch: scored?.categoryMatch ?? 'TEXT',
        stockSufficient: scored
          ? scored.stockSufficient
          : comparable
            ? listing.availableQuantity >= quantity!
            : null,
        meetsMinimumOrder: scored
          ? scored.meetsMinimumOrder
          : comparable
            ? quantity! >= listing.minimumOrderQty
            : null,
        matchedAttributes: scored?.matchedAttributes ?? [],
        conflictingAttributes: scored?.conflictingAttributes ?? [],
        reasons: scored?.reasons ?? ['Matched by name'],
      },
    ];
  });

  return matches
    .sort((a, b) => b.score - a.score || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    .slice(0, query.limit);
}
