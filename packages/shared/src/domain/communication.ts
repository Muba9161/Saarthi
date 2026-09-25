import { OrganizationType } from './enums';

/**
 * Who may reach whom on the freight and material marketplace.
 *
 *     CUSTOMER  ↔  FLEET OWNER  ↔  SELLER
 *
 * The fleet owner is the commercial and operational bridge. A customer deals
 * with the fleet that won its requirement; the fleet deals with the seller it
 * buys from. A customer never reaches a seller or a driver directly, and a
 * seller or driver never reaches the customer.
 *
 * This decides *contact* — phone numbers, support e-mail, the counterparty's
 * identity — and nothing else. Matching a requirement to a seller's listing is
 * a separate question answered by the commerce engine, and a good match is
 * never a licence to put the two ends in touch.
 */

export type CommunicationParty =
  'CUSTOMER' | 'FLEET_OWNER' | 'SELLER' | 'DRIVER' | 'MOBILITY_PROVIDER' | 'PLATFORM' | 'OTHER';

/** Pairs that may not exchange contact details, in either direction. */
const BLOCKED_PAIRS: ReadonlyArray<readonly [CommunicationParty, CommunicationParty]> = [
  ['CUSTOMER', 'SELLER'],
  ['CUSTOMER', 'DRIVER'],
];

export function communicationPartyForOrganizationType(
  type: OrganizationType | null | undefined,
): CommunicationParty {
  switch (type) {
    case OrganizationType.CUSTOMER:
      return 'CUSTOMER';
    case OrganizationType.SUPPLIER:
      return 'SELLER';
    case OrganizationType.FLEET_OWNER:
    case OrganizationType.ENTERPRISE:
      return 'FLEET_OWNER';
    case OrganizationType.MOBILITY_PROVIDER:
      return 'MOBILITY_PROVIDER';
    case OrganizationType.PLATFORM:
      return 'PLATFORM';
    default:
      return 'OTHER';
  }
}

function isBlocked(
  pairs: ReadonlyArray<readonly [CommunicationParty, CommunicationParty]>,
  from: CommunicationParty,
  to: CommunicationParty,
): boolean {
  if (from === 'PLATFORM' || to === 'PLATFORM') return false;
  return pairs.some(([a, b]) => (a === from && b === to) || (a === to && b === from));
}

/** Whether `from` may be given a contact channel — phone, e-mail, website — for `to`. */
export function canCommunicate(from: CommunicationParty, to: CommunicationParty): boolean {
  return !isBlocked(BLOCKED_PAIRS, from, to);
}

/**
 * Whether `from` may even be told who `to` is.
 *
 * Narrower than contact: a driver still needs the consignee's name at the
 * gate. But which Seller a fleet buys from is the fleet's own commercial
 * relationship, so the customer and the Seller stay anonymous to each other —
 * otherwise a name and a search box would route around the fleet anyway.
 */
export function mayKnowCounterparty(from: CommunicationParty, to: CommunicationParty): boolean {
  return !isBlocked([['CUSTOMER', 'SELLER']], from, to);
}

/** The party a signed-in caller acts as. */
export function communicationPartyForViewer(viewer: {
  isPlatformAdmin: boolean;
  organizationType?: OrganizationType | null;
}): CommunicationParty {
  return viewer.isPlatformAdmin
    ? 'PLATFORM'
    : communicationPartyForOrganizationType(viewer.organizationType);
}
