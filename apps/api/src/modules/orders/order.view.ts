import {
  type OrderStatus,
  canCommunicate,
  communicationPartyForViewer,
  mayKnowCounterparty,
  type CommunicationParty,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import type { AuthContext } from '../../auth/context';

/**
 * How an order is shown: the summary shape and the per-viewer projection.
 *
 * Kept apart from the lifecycle in `order.service.ts`, as trips keep theirs in
 * `trip.view.ts`, so the rules for what each party may learn about the others
 * live in one place whichever operation produced the rows.
 *
 *     CUSTOMER  ↔  FLEET OWNER  ↔  SELLER
 *
 * The fleet sees the whole order. The customer is never told which Seller the
 * fleet buys from. The Seller learns what it needs to load the truck — the
 * material, the quantity, its own price, the pickup, the vehicle and driver
 * coming for it — and nothing about the far end: who the customer is, where and
 * when the goods are delivered, what the customer wrote, or what the fleet is
 * charging for the delivered load (see `communication.ts`).
 */

export interface OrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  /** Null for a Seller: it is never told who the customer is. */
  customerOrganizationId: string | null;
  customerName: string;
  supplierOrganizationId: string | null;
  supplierName: string | null;
  fleetOrganizationId: string | null;
  fleetName: string | null;
  materialId: string | null;
  materialName: string;
  quantity: number;
  unit: string;
  materialPrice: number | null;
  transportPrice: number | null;
  totalPrice: number | null;
  budget: number | null;
  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  /** The delivery point. Null for a Seller. */
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  distanceKm: number | null;
  requiredCapacityTons: number;
  requiredTruckType: string | null;
  pickupAt: string | null;
  deliverBy: string | null;
  assignedTruck: { id: string; registrationNumber: string } | null;
  assignedDriver: { id: string; name: string; overallScore: number | null } | null;
  tripId: string | null;
  quoteCount: number;
  notes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const orderInclude = {
  _count: { select: { quotes: true } },
} satisfies Prisma.OrderInclude;

export type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** The three organizations an order can name. */
export interface OrderParties {
  customerOrganizationId: string;
  supplierOrganizationId: string | null;
  fleetOrganizationId: string | null;
}

/** The party a signed-in caller reads an order as. */
export function orderViewerParty(auth: AuthContext): CommunicationParty {
  return communicationPartyForViewer({
    isPlatformAdmin: auth.isPlatformAdmin,
    organizationType: auth.organization?.type,
  });
}

/**
 * The party an organization plays on this order, by where it sits on it.
 *
 * The fleet is checked first: it is the one party that may know both ends, so
 * an organization that somehow sits in two places is never narrowed by it.
 */
export function partyOnOrder(
  order: OrderParties,
  organizationId: string | null,
): CommunicationParty | null {
  if (!organizationId) return null;
  if (organizationId === order.fleetOrganizationId) return 'FLEET_OWNER';
  if (organizationId === order.customerOrganizationId) return 'CUSTOMER';
  if (organizationId === order.supplierOrganizationId) return 'SELLER';
  return null;
}

/** The party the caller acts as when it changes this order. */
export function actingParty(auth: AuthContext, order: OrderParties): CommunicationParty {
  if (auth.isPlatformAdmin) return 'PLATFORM';
  return partyOnOrder(order, auth.organizationId) ?? orderViewerParty(auth);
}

/**
 * A reason as `recipient` may hear it: only from a party it may hear from (see
 * `canCommunicate`). Undefined when there was none to pass on or it may not be.
 */
export function reasonFor(
  author: CommunicationParty,
  recipient: CommunicationParty | null,
  reason: string | undefined,
): string | undefined {
  return recipient !== null && canCommunicate(author, recipient) ? reason : undefined;
}

/** What an order status change reads as when nobody gave a reason. */
export function statusChangeText(from: string, to: string): string {
  return `Order moved from ${from} to ${to}.`;
}

/**
 * Shape order rows for one viewer.
 *
 * Every party to an order sees it, but not every party may see every other:
 * a customer is never shown which Seller the fleet bought from, and a Seller is
 * never shown the customer or the delivery (see the module comment).
 */
export async function decorate(
  orders: OrderRecord[],
  viewer: AuthContext,
): Promise<OrderSummary[]> {
  const viewerParty = orderViewerParty(viewer);
  const mayKnowSeller = mayKnowCounterparty(viewerParty, 'SELLER');
  const mayKnowCustomer = mayKnowCounterparty(viewerParty, 'CUSTOMER');

  const organizationIds = new Set<string>();
  const truckIds = new Set<string>();
  const driverIds = new Set<string>();

  for (const order of orders) {
    if (mayKnowCustomer) organizationIds.add(order.customerOrganizationId);
    if (mayKnowSeller && order.supplierOrganizationId)
      organizationIds.add(order.supplierOrganizationId);
    if (order.fleetOrganizationId) organizationIds.add(order.fleetOrganizationId);
    if (order.assignedTruckId) truckIds.add(order.assignedTruckId);
    if (order.assignedDriverId) driverIds.add(order.assignedDriverId);
  }

  const [organizations, trucks, drivers] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: [...organizationIds] } },
      select: { id: true, name: true },
    }),
    truckIds.size > 0
      ? prisma.truck.findMany({
          where: { id: { in: [...truckIds] } },
          select: { id: true, registrationNumber: true },
        })
      : Promise.resolve([]),
    driverIds.size > 0
      ? prisma.driver.findMany({
          where: { id: { in: [...driverIds] } },
          include: { user: { select: { firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
  ]);

  const orgMap = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const truckMap = new Map(trucks.map((truck) => [truck.id, truck]));
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));

  // What only the customer's side of the deal may read: the delivery, the
  // customer's own words and the fleet's selling price.
  const customerSide = <T>(value: T): T | null => (mayKnowCustomer ? value : null);

  return orders.map((order) => {
    const truck = order.assignedTruckId ? truckMap.get(order.assignedTruckId) : undefined;
    const driver = order.assignedDriverId ? driverMap.get(order.assignedDriverId) : undefined;

    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      customerOrganizationId: customerSide(order.customerOrganizationId),
      customerName: mayKnowCustomer
        ? (orgMap.get(order.customerOrganizationId) ?? 'Customer')
        : 'Saarthi customer',
      supplierOrganizationId: mayKnowSeller ? order.supplierOrganizationId : null,
      supplierName:
        mayKnowSeller && order.supplierOrganizationId
          ? (orgMap.get(order.supplierOrganizationId) ?? null)
          : null,
      fleetOrganizationId: order.fleetOrganizationId,
      fleetName: order.fleetOrganizationId ? (orgMap.get(order.fleetOrganizationId) ?? null) : null,
      materialId: order.materialId,
      materialName: order.materialName,
      quantity: order.quantity,
      unit: order.unit,
      materialPrice: order.materialPrice ? Number(order.materialPrice) : null,
      transportPrice: customerSide(order.transportPrice ? Number(order.transportPrice) : null),
      totalPrice: customerSide(order.totalPrice ? Number(order.totalPrice) : null),
      budget: customerSide(order.budget ? Number(order.budget) : null),
      originAddress: order.originAddress,
      originLatitude: order.originLatitude,
      originLongitude: order.originLongitude,
      destinationAddress: customerSide(order.destinationAddress),
      destinationLatitude: customerSide(order.destinationLatitude),
      destinationLongitude: customerSide(order.destinationLongitude),
      // Pickup to delivery: with the pickup known it would place the delivery
      // on a circle.
      distanceKm: customerSide(order.distanceKm),
      requiredCapacityTons: order.requiredCapacityTons,
      requiredTruckType: order.requiredTruckType,
      pickupAt: order.pickupAt?.toISOString() ?? null,
      deliverBy: customerSide(order.deliverBy?.toISOString() ?? null),
      assignedTruck: truck ? { id: truck.id, registrationNumber: truck.registrationNumber } : null,
      assignedDriver: driver
        ? {
            id: driver.id,
            name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
            overallScore: driver.overallScore,
          }
        : null,
      tripId: order.tripId,
      quoteCount: order._count.quotes,
      notes: customerSide(order.notes),
      cancellationReason: customerSide(order.cancellationReason),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// The order's history
// ---------------------------------------------------------------------------

type OrderEventRecord = Prisma.OrderEventGetPayload<Record<string, never>>;

export interface OrderEventView {
  id: string;
  type: string;
  description: string;
  metadata: Prisma.JsonValue | null;
  createdAt: string;
}

/** Events that describe the bidding itself — who quoted what, and at what price. */
const BIDDING_EVENTS: ReadonlySet<string> = new Set([
  'QUOTE_ADDED',
  'QUOTE_WITHDRAWN',
  'QUOTE_ACCEPTED',
]);

/** Events whose description may be the actor's own words — a reason they typed. */
const FREE_TEXT_EVENTS: ReadonlySet<string> = new Set(['STATUS_CHANGED', 'CANCELLED']);

/** The same event with its author's words taken out. */
function withoutReason(event: OrderEventRecord): string {
  if (event.type === 'CANCELLED') return 'Order cancelled.';
  const metadata = event.metadata as { from?: unknown; to?: unknown } | null;
  return typeof metadata?.from === 'string' && typeof metadata.to === 'string'
    ? statusChangeText(metadata.from, metadata.to)
    : 'Order status changed.';
}

/**
 * Which party wrote each free-text event, from the author's membership of the
 * order's organizations. An author in none of them is Saarthi itself — a
 * platform admin or the system — whose words anyone may read.
 */
async function authorParties(
  order: OrderParties,
  events: OrderEventRecord[],
): Promise<Map<string, CommunicationParty>> {
  const authorIds = [
    ...new Set(
      events
        .filter((event) => FREE_TEXT_EVENTS.has(event.type))
        .map((event) => event.actorUserId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (authorIds.length === 0) return new Map();
  const organizationIds = [
    order.customerOrganizationId,
    order.supplierOrganizationId,
    order.fleetOrganizationId,
  ].filter((id): id is string => id !== null);

  const memberships = await prisma.membership.findMany({
    where: { userId: { in: authorIds }, organizationId: { in: organizationIds } },
    select: { userId: true, organizationId: true },
  });

  const parties = new Map<string, CommunicationParty>();
  for (const membership of memberships) {
    const party = partyOnOrder(order, membership.organizationId);
    // Someone in two of the order's organizations counts as the wider one.
    if (party && parties.get(membership.userId) !== 'FLEET_OWNER') {
      parties.set(membership.userId, party);
    }
  }
  return parties;
}

/**
 * The order's history as this viewer may read it.
 *
 * The bidding — rival fleets and their prices — belongs to the customer and the
 * fleet that won it: a bidder following the order and the Seller see only how
 * the order moves. A reason someone typed is shown only to a party allowed to
 * hear from its author; anyone else reads the plain status change instead, so
 * a customer's words never reach the Seller and a Seller's never reach the
 * customer.
 */
export async function eventsFor(
  viewer: AuthContext,
  order: OrderParties,
  events: OrderEventRecord[],
  isOrderParty: boolean,
): Promise<OrderEventView[]> {
  const viewerParty = orderViewerParty(viewer);
  const seesBidding = isOrderParty && mayKnowCounterparty(viewerParty, 'CUSTOMER');
  const visible = seesBidding ? events : events.filter((event) => !BIDDING_EVENTS.has(event.type));

  const orderParties: CommunicationParty[] = ['CUSTOMER', 'SELLER', 'FLEET_OWNER'];
  const hearsEveryone = orderParties.every((party) => canCommunicate(viewerParty, party));
  const authors = hearsEveryone
    ? new Map<string, CommunicationParty>()
    : await authorParties(order, visible);

  return visible.map((event) => {
    const author = event.actorUserId ? (authors.get(event.actorUserId) ?? 'PLATFORM') : 'PLATFORM';
    const mayReadWords = !FREE_TEXT_EVENTS.has(event.type) || canCommunicate(viewerParty, author);
    return {
      id: event.id,
      type: event.type,
      description: mayReadWords ? event.description : withoutReason(event),
      metadata: seesBidding ? event.metadata : null,
      createdAt: event.createdAt.toISOString(),
    };
  });
}

type OrderRatingRecord = Prisma.OrderRatingGetPayload<Record<string, never>>;

/** The customer's rating of the delivery. Its comment is the customer's own words. */
export function ratingFor(viewer: AuthContext, rating: OrderRatingRecord | null) {
  if (!rating) return null;
  return {
    rating: rating.rating,
    punctuality: rating.punctuality,
    communication: rating.communication,
    cargoCondition: rating.cargoCondition,
    comment: mayKnowCounterparty(orderViewerParty(viewer), 'CUSTOMER') ? rating.comment : null,
    createdAt: rating.createdAt.toISOString(),
  };
}

/**
 * The search fields a viewer may match orders on. A Seller cannot search by
 * the delivery address: a match would confirm an address it is never shown.
 */
export function searchableOrderFields(
  viewer: AuthContext,
  search: string,
): Prisma.OrderWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [
    { reference: contains },
    { materialName: contains },
    { originAddress: contains },
    ...(mayKnowCounterparty(orderViewerParty(viewer), 'CUSTOMER')
      ? [{ destinationAddress: contains }]
      : []),
  ];
}
