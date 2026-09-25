import {
  BIDDER_TYPES_BY_SCOPE,
  BID_SCOPES_BY_KIND,
  REQUIREMENT_KIND_LABELS,
  type RequirementBidScope,
  type RequirementKind,
  type RequirementStatus,
  isRequirementBiddable,
  requirementKindsVisibleTo,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import type { AuthContext } from '../../auth/context';
import type { RequirementRecord } from './requirement.view';

/**
 * Who may see, manage and bid on a requirement.
 *
 * Kept apart from the service so every surface that reads a requirement — the
 * board, bidding, the commerce engine's seller matching — asks the same
 * questions in the same way.
 */

/**
 * A requirement is visible to the customer who raised it, to any business that
 * has bid on it, and to any business that *could* bid on it while it is still
 * open. The third case is what makes the board work at all.
 */
export async function assertRequirementAccess(
  auth: AuthContext,
  requirement: RequirementRecord,
): Promise<void> {
  if (auth.isPlatformAdmin) return;
  if (auth.organizationId === requirement.customerOrganizationId) return;

  if (auth.organizationId) {
    const bid = await prisma.requirementBid.findFirst({
      where: { requirementId: requirement.id, bidderOrganizationId: auth.organizationId },
      select: { id: true },
    });
    if (bid) return;

    const type = auth.organization?.type;
    if (
      type &&
      isRequirementBiddable(requirement.status as RequirementStatus) &&
      requirementKindsVisibleTo(type).includes(requirement.kind as RequirementKind)
    ) {
      return;
    }
  }

  throw errors.notFound('Requirement');
}

/** The customer who raised it, and nobody else. */
export function assertOwner(auth: AuthContext, requirement: RequirementRecord): void {
  if (auth.isPlatformAdmin) return;
  if (requirement.customerOrganizationId !== auth.organizationId) {
    throw errors.forbidden('Only the customer who posted this requirement can do that.');
  }
}

/**
 * Whether this organization may answer this requirement with this scope.
 *
 * Deliberately one function rather than a guard on each route: the same three
 * questions — is the scope valid for the kind, is my business type allowed to
 * offer it, is the requirement still open — have to be asked identically when
 * placing a bid, revising one and reading the board, and answering them in
 * three places is how they drift apart.
 */
export function assertCanBid(
  auth: AuthContext,
  requirement: RequirementRecord,
  scope: RequirementBidScope,
): void {
  const kind = requirement.kind as RequirementKind;

  if (!BID_SCOPES_BY_KIND[kind].includes(scope)) {
    throw errors.businessRule(
      `A ${REQUIREMENT_KIND_LABELS[kind].toLowerCase()} requirement does not take a ${scope.toLowerCase()} offer.`,
    );
  }

  if (!isRequirementBiddable(requirement.status as RequirementStatus)) {
    throw errors.businessRule('This requirement is no longer taking bids.');
  }

  if (requirement.bidsCloseAt.getTime() < Date.now()) {
    throw errors.businessRule('Bidding on this requirement has closed.');
  }

  if (auth.isPlatformAdmin && !auth.organizationId) {
    throw errors.organizationRequired('Select the organization you are bidding on behalf of.');
  }

  const type = auth.organization?.type;
  if (!type) throw errors.organizationRequired();

  if (!BIDDER_TYPES_BY_SCOPE[scope].includes(type)) {
    throw errors.forbidden(
      'This kind of offer is made by a different type of Saarthi account. ' +
        'Register the appropriate account type to bid on it.',
    );
  }

  // A customer bidding on their own requirement would be able to close it at
  // any price and pollute every provider's win rate.
  if (requirement.customerOrganizationId === auth.organizationId) {
    throw errors.businessRule('You cannot bid on your own requirement.');
  }
}
