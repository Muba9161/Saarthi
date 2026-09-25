import { RequirementKind, isCategoryWithin } from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { requireUsablePayoutAccount } from '../marketplace-finance/payout-account.service';
import { loadTaxonomy } from '../commerce/taxonomy.service';
import type { RequirementRecord } from './requirement.view';

/**
 * A fleet owner's delivered bid: it buys the goods from a Seller listing and
 * delivers them, and its bid price is its selling price to the customer.
 *
 * The procurement reference — the listing price for the quantity asked for —
 * is worked out here from the listing, never taken from the request, and the
 * listing must actually be the goods asked for and have the stock.
 */

/** Whether a listing is the goods the requirement asks for. */
async function isSameGoods(
  requirement: Pick<RequirementRecord, 'categoryId' | 'materialCategory'>,
  listing: { categoryId: string | null; category: string | null },
): Promise<boolean> {
  // Both classified: related anywhere along one branch of the tree. A listing
  // for "River Sand" answers a request for "Sand", and vice versa.
  if (requirement.categoryId && listing.categoryId) {
    const { index } = await loadTaxonomy();
    return (
      isCategoryWithin(index, listing.categoryId, requirement.categoryId) ||
      isCategoryWithin(index, requirement.categoryId, listing.categoryId)
    );
  }
  // Legacy free text on either side: the category labels must agree.
  if (!requirement.materialCategory) return true;
  return listing.category?.toLowerCase() === requirement.materialCategory.toLowerCase();
}

export async function resolveSourcedListing(
  requirement: RequirementRecord,
  sourceMaterialId: string,
  bidderOrganizationId: string,
): Promise<{ procurementReference: number }> {
  if (requirement.kind !== RequirementKind.MATERIAL_SUPPLY) {
    throw errors.businessRule('Only a material requirement can be bid on with sourced material.');
  }

  const listing = await prisma.material.findFirst({
    where: { id: sourceMaterialId, archivedAt: null },
    select: {
      name: true,
      category: true,
      categoryId: true,
      status: true,
      pricePerUnit: true,
      availableQuantity: true,
      minimumOrderQty: true,
      unit: true,
    },
  });
  if (!listing || listing.status !== 'ACTIVE') {
    throw errors.notFound('Material', 'That seller listing is not available.');
  }
  if (!(await isSameGoods(requirement, listing))) {
    throw errors.businessRule(
      `That listing is ${listing.name}, not the material this requirement asks for.`,
    );
  }

  const quantity = requirement.quantity ?? 1;
  if (listing.availableQuantity < quantity) {
    throw errors.businessRule(
      `The seller has ${listing.availableQuantity} ${listing.unit.toLowerCase()} available; this requirement needs ${quantity}.`,
    );
  }
  if (listing.minimumOrderQty && quantity < listing.minimumOrderQty) {
    throw errors.businessRule(
      `The seller's minimum order is ${listing.minimumOrderQty} ${listing.unit.toLowerCase()}.`,
    );
  }

  // The customer's 30% is routed straight to this fleet, so it must be able to
  // receive it before it can offer the job.
  await requireUsablePayoutAccount(bidderOrganizationId, 'Your business');

  return { procurementReference: Math.round(Number(listing.pricePerUnit) * quantity * 100) / 100 };
}
