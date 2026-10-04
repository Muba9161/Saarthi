import {
  BIDDABLE_REQUIREMENT_STATUSES,
  MaterialUnit,
  OPEN_RETURN_LOAD_STATUSES,
  RequirementBidScope,
  RequirementKind,
  boundingBox,
  emptyKilometresSaved,
  findHardBlockers,
  scoreReturnLoad,
  type BackhaulRequirementQuery,
  type LatLng,
  type ReturnLoadDemand,
  type ReturnLoadStatus,
  type TruckType,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import { loadTaxonomy } from '../commerce/taxonomy.service';
import { rankSellers, type SellerMatch } from '../commerce/matching.service';
import {
  decorateBids,
  decorateRequirements,
  requirementInclude,
  type RequirementBidSummary,
  type RequirementRecord,
  type RequirementSummary,
} from '../requirements/requirement.view';
import { loadRequest, toSupply } from './return-load.service';

/**
 * Customer requirements along a vehicle's way home.
 *
 * The backhaul question for a material requirement is not "is the pickup near
 * the truck" — the customer does not say where the goods come from. The fleet
 * buys them from a seller and delivers them, so the real route is
 *
 *   where the truck stands → a seller nearby → the customer's site → home
 *
 * and a requirement is worth showing when some seller near the truck makes that
 * route a small detour from driving home empty. The existing return-load
 * scoring is reused as is, with the seller's yard as the pickup.
 */

/** Requirements looked at per request, nearest to the way home first. */
const CANDIDATE_LIMIT = 150;
/** Sellers named against each requirement shown. */
const SELLERS_PER_REQUIREMENT = 3;

export interface BackhaulRequirement extends RequirementSummary {
  /** Board shape, so the ordinary bid dialog can be reused. */
  distanceToOriginKm: number | null;
  availableScopes: RequirementBidScope[];
  myBid: RequirementBidSummary | null;
  backhaul: {
    score: number;
    detourKm: number;
    emptyKmSaved: number;
    /** From where the truck stands to the best seller's yard. */
    sellerDistanceKm: number;
    reasons: string[];
    /** Best first; the first is the one the score was worked out with. */
    sellers: SellerMatch[];
  };
}

/** The load in tonnes, when the unit allows it; otherwise it cannot block a match. */
function tonnesOf(row: RequirementRecord): number {
  if (row.requiredCapacityTons) return row.requiredCapacityTons;
  if (row.quantity === null) return 0;
  if (row.unit === MaterialUnit.TON) return row.quantity;
  if (row.unit === MaterialUnit.KG) return row.quantity / 1000;
  return 0;
}

function demandFor(row: RequirementRecord, pickup: LatLng): ReturnLoadDemand {
  return {
    orderId: row.id,
    origin: pickup,
    destination: { latitude: row.destinationLatitude!, longitude: row.destinationLongitude! },
    requiredCapacityTons: tonnesOf(row),
    requiredTruckType: row.requiredTruckType as TruckType | null,
    pickupAt: row.startAt,
    deliverBy: row.endAt,
    // A sealed budget stays sealed: it is never used to rank, only a public one.
    price: row.budgetIsPublic && row.budgetAmount ? Number(row.budgetAmount) : null,
    customerRating: null,
  };
}

export async function requirementsOnReturnRoute(
  auth: AuthContext,
  requestId: string,
  query: BackhaulRequirementQuery,
): Promise<BackhaulRequirement[]> {
  const request = await loadRequest(auth, requestId);
  if (!request.commissionAcceptedAt) {
    throw errors.businessRule('Enable backhaul on the completed trip to see work on the way home.');
  }
  // Booked, expired or cancelled: the vehicle is no longer looking.
  if (!OPEN_RETURN_LOAD_STATUSES.includes(request.status as ReturnLoadStatus)) return [];

  const supply = toSupply(request);
  // Delivery points anywhere near the way home, padded by the detour allowed.
  const corridor = boundingBox(
    [supply.freePoint, supply.homePoint],
    supply.detourToleranceKm * 1000,
  )!;

  const rows = await prisma.requirement.findMany({
    where: {
      kind: RequirementKind.MATERIAL_SUPPLY,
      status: { in: BIDDABLE_REQUIREMENT_STATUSES as never },
      bidsCloseAt: { gt: new Date() },
      needsTransport: true,
      awardedTransportBidId: null,
      // Never offer a business its own demand.
      customerOrganizationId: { not: request.organizationId },
      destinationLatitude: { gte: corridor.south, lte: corridor.north },
      destinationLongitude: { gte: corridor.west, lte: corridor.east },
    },
    include: requirementInclude,
    orderBy: { startAt: 'asc' },
    take: CANDIDATE_LIMIT,
  });

  // The best a requirement could possibly do is a seller right where the truck
  // stands. One that fails even then is dropped before any seller is looked up.
  const plausible = rows
    .filter((row) => !findHardBlockers(supply, demandFor(row, supply.freePoint)))
    .map((row) => ({ row, bound: scoreReturnLoad(supply, demandFor(row, supply.freePoint)) }))
    .sort((a, b) => b.bound.score - a.bound.score)
    .slice(0, query.limit * 2);

  const { index } = await loadTaxonomy();
  const scored = await Promise.all(
    plausible.map(async ({ row }) => {
      const sellers = await rankSellers(row, {
        from: supply.freePoint,
        withinKm: config.returnLoads.maxPickupKm,
        limit: 10,
        index,
      });

      const routed = sellers
        .filter(
          (seller) =>
            seller.stockSufficient !== false &&
            seller.meetsMinimumOrder !== false &&
            seller.pickupLatitude !== null &&
            seller.pickupLongitude !== null,
        )
        .flatMap((seller) => {
          const demand = demandFor(row, {
            latitude: seller.pickupLatitude!,
            longitude: seller.pickupLongitude!,
          });
          if (findHardBlockers(supply, demand)) return [];
          return [{ seller, demand, score: scoreReturnLoad(supply, demand) }];
        })
        .sort((a, b) => b.score.score - a.score.score);

      const best = routed[0];
      if (!best || best.score.score < config.returnLoads.minScore) return null;
      return {
        row,
        best,
        sellers: routed.slice(0, SELLERS_PER_REQUIREMENT).map((entry) => entry.seller),
      };
    }),
  );

  const matches = scored
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.best.score.score - a.best.score.score)
    .slice(0, query.limit);
  if (matches.length === 0) return [];

  const ownBids = await prisma.requirementBid.findMany({
    where: {
      bidderOrganizationId: request.organizationId,
      scope: RequirementBidScope.TRANSPORT,
      requirementId: { in: matches.map((match) => match.row.id) },
    },
  });
  const [summaries, bids] = await Promise.all([
    decorateRequirements(
      matches.map((match) => match.row),
      auth,
    ),
    decorateBids(ownBids, request.organizationId),
  ]);
  const bidByRequirement = new Map(bids.map((bid) => [bid.requirementId, bid]));

  return summaries.map((summary, position) => {
    const { best, sellers } = matches[position]!;
    return {
      ...summary,
      distanceToOriginKm: best.seller.distanceKm,
      availableScopes: [RequirementBidScope.TRANSPORT],
      myBid: bidByRequirement.get(summary.id) ?? null,
      backhaul: {
        score: best.score.score,
        detourKm: best.score.detourKm,
        emptyKmSaved: emptyKilometresSaved(supply, best.demand),
        sellerDistanceKm: best.seller.distanceKm ?? best.score.distanceToPickupKm,
        reasons: best.score.reasons,
        sellers,
      },
    };
  });
}
