import {
  ACTIVE_ORDER_STATUSES,
  ASSIGNABLE_TRUCK_STATUSES,
  NotificationPriority,
  NotificationType,
  OrderStatus,
  QuoteStatus,
  TruckStatus,
  VerificationStatus,
  type MaterialUnit,
  type TruckType,
  buildPaginationMeta,
  distanceKm,
  orderStateMachine,
  type CancelOrderInput,
  type CreateOrderInput,
  type CreateQuoteInput,
  type MarketplaceQuery,
  type MatchTransportInput,
  type OrderListQuery,
  type Paginated,
  type RateOrderInput,
  type UpdateOrderInput,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { skipTake } from '../../lib/http';
import { notifyAsync, notifyOrganization } from '../notifications/notification.service';
import { broadcastOrderUpdate } from '../../realtime/realtime.service';
import {
  markRequirementCancelled,
  markRequirementFulfilled,
} from '../requirements/fulfilment.service';
import type { AuthContext } from '../../auth/context';

/**
 * Orders — the customer marketplace.
 *
 * Flow: a customer posts a requirement → fleets quote it → the customer
 * accepts one → a trip is created and the truck starts moving. Every status
 * change is validated against the shared state machine, recorded as an event
 * and broadcast to exactly the parties involved.
 */

export interface OrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  customerOrganizationId: string;
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
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;
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

const orderInclude = {
  _count: { select: { quotes: true } },
} satisfies Prisma.OrderInclude;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

async function decorate(orders: OrderRecord[]): Promise<OrderSummary[]> {
  const organizationIds = new Set<string>();
  const truckIds = new Set<string>();
  const driverIds = new Set<string>();

  for (const order of orders) {
    organizationIds.add(order.customerOrganizationId);
    if (order.supplierOrganizationId) organizationIds.add(order.supplierOrganizationId);
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

  return orders.map((order) => {
    const truck = order.assignedTruckId ? truckMap.get(order.assignedTruckId) : undefined;
    const driver = order.assignedDriverId ? driverMap.get(order.assignedDriverId) : undefined;

    return {
      id: order.id,
      reference: order.reference,
      status: order.status,
      customerOrganizationId: order.customerOrganizationId,
      customerName: orgMap.get(order.customerOrganizationId) ?? 'Customer',
      supplierOrganizationId: order.supplierOrganizationId,
      supplierName: order.supplierOrganizationId
        ? (orgMap.get(order.supplierOrganizationId) ?? null)
        : null,
      fleetOrganizationId: order.fleetOrganizationId,
      fleetName: order.fleetOrganizationId
        ? (orgMap.get(order.fleetOrganizationId) ?? null)
        : null,
      materialId: order.materialId,
      materialName: order.materialName,
      quantity: order.quantity,
      unit: order.unit,
      materialPrice: order.materialPrice ? Number(order.materialPrice) : null,
      transportPrice: order.transportPrice ? Number(order.transportPrice) : null,
      totalPrice: order.totalPrice ? Number(order.totalPrice) : null,
      budget: order.budget ? Number(order.budget) : null,
      originAddress: order.originAddress,
      originLatitude: order.originLatitude,
      originLongitude: order.originLongitude,
      destinationAddress: order.destinationAddress,
      destinationLatitude: order.destinationLatitude,
      destinationLongitude: order.destinationLongitude,
      distanceKm: order.distanceKm,
      requiredCapacityTons: order.requiredCapacityTons,
      requiredTruckType: order.requiredTruckType,
      pickupAt: order.pickupAt?.toISOString() ?? null,
      deliverBy: order.deliverBy?.toISOString() ?? null,
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
      notes: order.notes,
      cancellationReason: order.cancellationReason,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  });
}

/** Every organization entitled to see this order. */
function partiesOf(order: {
  customerOrganizationId: string;
  supplierOrganizationId: string | null;
  fleetOrganizationId: string | null;
}): (string | null)[] {
  return [order.customerOrganizationId, order.supplierOrganizationId, order.fleetOrganizationId];
}

/**
 * An order is visible to the customer who raised it, the supplier fulfilling
 * it, the fleet carrying it — and to any fleet that has quoted on it, so a
 * bidder can follow the requirement it competed for.
 */
async function assertOrderAccess(auth: AuthContext, order: OrderRecord): Promise<void> {
  if (auth.isPlatformAdmin) return;
  if (auth.organizationId && partiesOf(order).includes(auth.organizationId)) return;

  if (auth.organizationId) {
    const quote = await prisma.orderQuote.findFirst({
      where: { orderId: order.id, fleetOrganizationId: auth.organizationId },
      select: { id: true },
    });
    if (quote) return;
  }

  throw errors.notFound('Order');
}

async function nextReference(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.order.count();
  return `SO-${year}-${String(count + 1).padStart(5, '0')}`;
}

async function recordEvent(
  orderId: string,
  type: Parameters<typeof prisma.orderEvent.create>[0]['data']['type'],
  description: string,
  actorUserId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.orderEvent.create({
    data: {
      orderId,
      type,
      description,
      actorUserId,
      metadata: (metadata ?? undefined) as never,
    },
  });
}

async function publishUpdate(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  await broadcastOrderUpdate({
    orderId: order.id,
    status: order.status,
    tripId: order.tripId,
    customerOrganizationId: order.customerOrganizationId,
    supplierOrganizationId: order.supplierOrganizationId,
    fleetOrganizationId: order.fleetOrganizationId,
    updatedAt: order.updatedAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------

export async function createOrder(
  auth: AuthContext,
  organizationId: string,
  input: CreateOrderInput,
): Promise<OrderSummary> {
  const customer = await prisma.customer.findUnique({ where: { organizationId } });
  if (!customer) {
    throw errors.businessRule(
      'Only a customer organization can post a transport requirement.',
    );
  }

  let materialName = input.materialName ?? '';
  let materialPrice: number | null = null;
  let supplierOrganizationId: string | null = null;

  if (input.materialId) {
    const material = await prisma.material.findFirst({
      where: { id: input.materialId, archivedAt: null },
    });
    if (!material) throw errors.notFound('Material');
    if (material.status !== 'ACTIVE') {
      throw errors.businessRule('This material is not currently available to order.');
    }
    if (input.quantity < material.minimumOrderQty) {
      throw errors.businessRule(
        `The minimum order quantity for ${material.name} is ${material.minimumOrderQty} ${material.unit.toLowerCase()}.`,
      );
    }
    if (input.quantity > material.availableQuantity) {
      throw errors.businessRule(
        `Only ${material.availableQuantity} ${material.unit.toLowerCase()} of ${material.name} is available.`,
      );
    }
    materialName = material.name;
    materialPrice = Number(material.pricePerUnit) * input.quantity;
    supplierOrganizationId = material.organizationId;
  }

  const distance = distanceKm(
    { latitude: input.origin.latitude, longitude: input.origin.longitude },
    { latitude: input.destination.latitude, longitude: input.destination.longitude },
  );

  const order = await prisma.order.create({
    data: {
      reference: await nextReference(),
      customerId: customer.id,
      customerOrganizationId: organizationId,
      materialId: input.materialId ?? null,
      supplierOrganizationId,
      materialName,
      quantity: input.quantity,
      unit: input.unit,
      materialPrice,
      budget: input.budget ?? null,
      originAddress: input.origin.addressLine,
      originLatitude: input.origin.latitude,
      originLongitude: input.origin.longitude,
      destinationAddress: input.destination.addressLine,
      destinationLatitude: input.destination.latitude,
      destinationLongitude: input.destination.longitude,
      // Straight-line distance until a routing provider refines it.
      distanceKm: Number(distance.toFixed(1)),
      requiredCapacityTons: input.requiredCapacityTons,
      requiredTruckType: input.requiredTruckType ?? null,
      pickupAt: input.pickupAt ?? null,
      deliverBy: input.deliverBy ?? null,
      status: OrderStatus.REQUESTED,
      notes: input.notes ?? null,
      createdById: auth.user.id,
    },
    include: orderInclude,
  });

  await recordEvent(order.id, 'CREATED', 'Requirement posted by the customer.', auth.user.id);
  await prisma.customer.update({
    where: { id: customer.id },
    data: { totalOrders: { increment: 1 } },
  });

  if (supplierOrganizationId) {
    void notifyOrganization(supplierOrganizationId, {
      type: NotificationType.ORDER_CREATED,
      title: 'New material order',
      body: `${order.reference}: ${order.quantity} ${order.unit.toLowerCase()} of ${order.materialName}.`,
      priority: NotificationPriority.NORMAL,
      actionUrl: `/orders/${order.id}`,
    });
  }

  await publishUpdate(order.id);
  return (await decorate([order]))[0]!;
}

export async function listOrders(
  auth: AuthContext,
  query: OrderListQuery,
): Promise<Paginated<OrderSummary>> {
  const organizationId = auth.organizationId;

  const scope: Prisma.OrderWhereInput =
    auth.isPlatformAdmin && !organizationId
      ? {}
      : {
          OR: [
            { customerOrganizationId: organizationId ?? '__none__' },
            { supplierOrganizationId: organizationId ?? '__none__' },
            { fleetOrganizationId: organizationId ?? '__none__' },
          ],
        };

  const where: Prisma.OrderWhereInput = {
    AND: [
      scope,
      {
        ...(query.status ? { status: { in: query.status as OrderStatus[] } } : {}),
        ...(query.activeOnly ? { status: { in: ACTIVE_ORDER_STATUSES } } : {}),
        ...(query.customerOrganizationId
          ? { customerOrganizationId: query.customerOrganizationId }
          : {}),
        ...(query.fleetOrganizationId ? { fleetOrganizationId: query.fleetOrganizationId } : {}),
        ...(query.truckId ? { assignedTruckId: query.truckId } : {}),
        ...(query.driverId ? { assignedDriverId: query.driverId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { reference: { contains: query.search, mode: 'insensitive' } },
                { materialName: { contains: query.search, mode: 'insensitive' } },
                { originAddress: { contains: query.search, mode: 'insensitive' } },
                { destinationAddress: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    ],
  };

  const orderBy: Prisma.OrderOrderByWithRelationInput =
    query.sortBy === 'deliverBy'
      ? { deliverBy: query.sortOrder }
      : query.sortBy === 'totalPrice'
        ? { totalPrice: query.sortOrder }
        : query.sortBy === 'status'
          ? { status: query.sortOrder }
          : { createdAt: query.sortOrder };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy,
      ...skipTake(query.page, query.pageSize),
    }),
  ]);

  return {
    items: await decorate(orders),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

export async function getOrder(auth: AuthContext, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw errors.notFound('Order');
  await assertOrderAccess(auth, order);

  const [summary] = await decorate([order]);

  const [events, quotes, rating] = await Promise.all([
    prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } }),
    listQuotes(auth, orderId),
    prisma.orderRating.findUnique({ where: { orderId } }),
  ]);

  return {
    ...summary!,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      description: event.description,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
    quotes,
    rating: rating
      ? {
          rating: rating.rating,
          punctuality: rating.punctuality,
          communication: rating.communication,
          cargoCondition: rating.cargoCondition,
          comment: rating.comment,
          createdAt: rating.createdAt.toISOString(),
        }
      : null,
  };
}

export async function updateOrder(
  auth: AuthContext,
  orderId: string,
  input: UpdateOrderInput,
): Promise<OrderSummary> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw errors.notFound('Order');
  await assertOrderAccess(auth, order);

  if (order.customerOrganizationId !== auth.organizationId && !auth.isPlatformAdmin) {
    throw errors.forbidden('Only the customer who posted this requirement can change it.');
  }
  if (!([OrderStatus.DRAFT, OrderStatus.REQUESTED, OrderStatus.QUOTED] as OrderStatus[]).includes(order.status)) {
    throw errors.businessRule(
      'This requirement can no longer be changed because transport has already been arranged.',
    );
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.pickupAt !== undefined ? { pickupAt: input.pickupAt } : {}),
      ...(input.deliverBy !== undefined ? { deliverBy: input.deliverBy } : {}),
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.requiredCapacityTons !== undefined
        ? { requiredCapacityTons: input.requiredCapacityTons }
        : {}),
      ...(input.requiredTruckType !== undefined
        ? { requiredTruckType: input.requiredTruckType }
        : {}),
    },
    include: orderInclude,
  });

  await recordEvent(orderId, 'NOTE', 'Requirement details updated by the customer.', auth.user.id);
  await publishUpdate(orderId);
  return (await decorate([updated]))[0]!;
}

// ---------------------------------------------------------------------------
// Marketplace: open requirements and quotes
// ---------------------------------------------------------------------------

export async function listOpenRequirements(
  auth: AuthContext,
  query: MarketplaceQuery,
): Promise<Paginated<OrderSummary & { distanceToPickupKm: number | null; hasQuoted: boolean }>> {
  const organizationId = auth.organizationId;

  const where: Prisma.OrderWhereInput = {
    status: { in: [OrderStatus.REQUESTED, OrderStatus.QUOTED] },
    fleetOrganizationId: null,
    ...(query.minCapacityTons !== undefined
      ? { requiredCapacityTons: { gte: query.minCapacityTons } }
      : {}),
    ...(query.maxCapacityTons !== undefined
      ? { requiredCapacityTons: { lte: query.maxCapacityTons } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { materialName: { contains: query.search, mode: 'insensitive' } },
            { originAddress: { contains: query.search, mode: 'insensitive' } },
            { destinationAddress: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const myQuotes = organizationId
    ? await prisma.orderQuote.findMany({
        where: {
          fleetOrganizationId: organizationId,
          orderId: { in: orders.map((order) => order.id) },
          status: { in: [QuoteStatus.OFFERED, QuoteStatus.ACCEPTED] },
        },
        select: { orderId: true },
      })
    : [];
  const quotedOrderIds = new Set(myQuotes.map((quote) => quote.orderId));

  // Rank by how far the fleet's nearest available truck is from the pickup.
  let referencePoint: { latitude: number; longitude: number } | null =
    query.nearLatitude !== undefined && query.nearLongitude !== undefined
      ? { latitude: query.nearLatitude, longitude: query.nearLongitude }
      : null;

  if (!referencePoint && organizationId) {
    const truck = await prisma.truck.findFirst({
      where: {
        organizationId,
        archivedAt: null,
        lastLatitude: { not: null },
        lastLongitude: { not: null },
      },
      orderBy: { lastLocationAt: 'desc' },
      select: { lastLatitude: true, lastLongitude: true },
    });
    if (truck?.lastLatitude !== null && truck?.lastLongitude !== null && truck) {
      referencePoint = { latitude: truck.lastLatitude!, longitude: truck.lastLongitude! };
    }
  }

  const decorated = await decorate(orders);
  const enriched = decorated
    .map((order) => {
      const distance = referencePoint
        ? Number(
            distanceKm(referencePoint, {
              latitude: order.originLatitude,
              longitude: order.originLongitude,
            }).toFixed(1),
          )
        : null;
      return { ...order, distanceToPickupKm: distance, hasQuoted: quotedOrderIds.has(order.id) };
    })
    .filter((order) => {
      if (query.excludeQuoted && order.hasQuoted) return false;
      if (order.distanceToPickupKm === null) return true;
      return order.distanceToPickupKm <= query.radiusKm;
    })
    .sort((a, b) => (a.distanceToPickupKm ?? Infinity) - (b.distanceToPickupKm ?? Infinity));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: enriched.slice(start, start + query.pageSize),
    pagination: buildPaginationMeta(query.page, query.pageSize, enriched.length),
  };
}

export interface QuoteSummary {
  id: string;
  orderId: string;
  fleetOrganizationId: string;
  fleetName: string;
  price: number;
  estimatedPickupAt: string | null;
  estimatedArrivalAt: string | null;
  distanceToPickupKm: number | null;
  message: string | null;
  status: QuoteStatus;
  expiresAt: string | null;
  truck: {
    id: string;
    registrationNumber: string;
    truckType: string;
    capacityTons: number;
    verificationStatus: string;
  } | null;
  driver: { id: string; name: string; overallScore: number | null } | null;
  createdAt: string;
}

export async function listQuotes(auth: AuthContext, orderId: string): Promise<QuoteSummary[]> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw errors.notFound('Order');
  await assertOrderAccess(auth, order);

  const isCustomer = order.customerOrganizationId === auth.organizationId;
  const quotes = await prisma.orderQuote.findMany({
    where: {
      orderId,
      // A fleet only ever sees its own quote; the customer sees them all.
      ...(isCustomer || auth.isPlatformAdmin
        ? {}
        : { fleetOrganizationId: auth.organizationId ?? '__none__' }),
    },
    orderBy: [{ status: 'asc' }, { price: 'asc' }],
  });

  const [organizations, trucks, drivers] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: quotes.map((quote) => quote.fleetOrganizationId) } },
      select: { id: true, name: true },
    }),
    prisma.truck.findMany({
      where: {
        id: { in: quotes.map((quote) => quote.truckId).filter((id): id is string => Boolean(id)) },
      },
    }),
    prisma.driver.findMany({
      where: {
        id: { in: quotes.map((quote) => quote.driverId).filter((id): id is string => Boolean(id)) },
      },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const orgMap = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const truckMap = new Map(trucks.map((truck) => [truck.id, truck]));
  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));

  return quotes.map((quote) => {
    const truck = quote.truckId ? truckMap.get(quote.truckId) : undefined;
    const driver = quote.driverId ? driverMap.get(quote.driverId) : undefined;
    return {
      id: quote.id,
      orderId: quote.orderId,
      fleetOrganizationId: quote.fleetOrganizationId,
      fleetName: orgMap.get(quote.fleetOrganizationId) ?? 'Fleet',
      price: Number(quote.price),
      estimatedPickupAt: quote.estimatedPickupAt?.toISOString() ?? null,
      estimatedArrivalAt: quote.estimatedArrivalAt?.toISOString() ?? null,
      distanceToPickupKm: quote.distanceToPickupKm,
      message: quote.message,
      status: quote.status,
      expiresAt: quote.expiresAt?.toISOString() ?? null,
      truck: truck
        ? {
            id: truck.id,
            registrationNumber: truck.registrationNumber,
            truckType: truck.truckType,
            capacityTons: truck.capacityTons,
            verificationStatus: truck.verificationStatus,
          }
        : null,
      driver: driver
        ? {
            id: driver.id,
            name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
            overallScore: driver.overallScore,
          }
        : null,
      createdAt: quote.createdAt.toISOString(),
    };
  });
}

export async function createQuote(
  auth: AuthContext,
  organizationId: string,
  orderId: string,
  input: CreateQuoteInput,
): Promise<QuoteSummary> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw errors.notFound('Order');

  if (order.customerOrganizationId === organizationId) {
    throw errors.businessRule('You cannot quote on your own requirement.');
  }
  if (!([OrderStatus.REQUESTED, OrderStatus.QUOTED] as OrderStatus[]).includes(order.status)) {
    throw errors.businessRule('This requirement is no longer accepting quotes.');
  }

  let distanceToPickup: number | null = null;

  if (input.truckId) {
    const truck = await prisma.truck.findUnique({ where: { id: input.truckId } });
    if (!truck || truck.organizationId !== organizationId) throw errors.notFound('Truck');
    if (truck.archivedAt) throw errors.businessRule('This truck is archived.');
    if (truck.verificationStatus !== VerificationStatus.VERIFIED) {
      throw errors.businessRule(
        'Only verified trucks can be offered on the marketplace. Complete verification first.',
      );
    }
    if (truck.capacityTons < order.requiredCapacityTons) {
      throw errors.businessRule(
        `This requirement needs ${order.requiredCapacityTons}T capacity; ${truck.registrationNumber} carries ${truck.capacityTons}T.`,
      );
    }
    if (!ASSIGNABLE_TRUCK_STATUSES.includes(truck.status as TruckStatus)) {
      throw errors.businessRule(
        `${truck.registrationNumber} is ${truck.status.toLowerCase().replace(/_/g, ' ')} and cannot be offered.`,
      );
    }
    if (truck.lastLatitude !== null && truck.lastLongitude !== null) {
      distanceToPickup = Number(
        distanceKm(
          { latitude: truck.lastLatitude, longitude: truck.lastLongitude },
          { latitude: order.originLatitude, longitude: order.originLongitude },
        ).toFixed(1),
      );
    }
  }

  if (input.driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: input.driverId } });
    if (!driver || driver.organizationId !== organizationId) throw errors.notFound('Driver');
    if (driver.verificationStatus !== VerificationStatus.VERIFIED) {
      throw errors.businessRule('Only verified drivers can be offered on the marketplace.');
    }
  }

  // Re-quoting the same truck replaces the previous offer rather than stacking
  // duplicates. (A composite unique with a nullable truckId cannot drive an
  // upsert, so the existing row is looked up explicitly.)
  const previous = await prisma.orderQuote.findFirst({
    where: {
      orderId,
      fleetOrganizationId: organizationId,
      truckId: input.truckId ?? null,
      status: { in: [QuoteStatus.OFFERED, QuoteStatus.REJECTED, QuoteStatus.WITHDRAWN] },
    },
  });

  const quoteData = {
    driverId: input.driverId ?? null,
    price: input.price,
    estimatedPickupAt: input.estimatedPickupAt ?? null,
    estimatedArrivalAt: input.estimatedArrivalAt ?? null,
    distanceToPickupKm: distanceToPickup,
    message: input.message ?? null,
    expiresAt: input.expiresAt ?? null,
    status: QuoteStatus.OFFERED,
  };

  const quote = previous
    ? await prisma.orderQuote.update({ where: { id: previous.id }, data: quoteData })
    : await prisma.orderQuote.create({
        data: {
          orderId,
          fleetOrganizationId: organizationId,
          truckId: input.truckId ?? null,
          createdById: auth.user.id,
          ...quoteData,
        },
      });

  if (order.status === OrderStatus.REQUESTED) {
    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.QUOTED } });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  await recordEvent(
    orderId,
    'QUOTE_ADDED',
    `${organization?.name ?? 'A fleet'} quoted this requirement.`,
    auth.user.id,
    { quoteId: quote.id, price: input.price },
  );

  void notifyOrganization(order.customerOrganizationId, {
    type: NotificationType.ORDER_QUOTED,
    title: 'New transport quote',
    body: `${organization?.name ?? 'A fleet'} quoted ₹${input.price.toLocaleString('en-IN')} for ${order.reference}.`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/orders/${orderId}`,
  });

  await publishUpdate(orderId);

  const quotes = await listQuotes(auth, orderId);
  return quotes.find((entry) => entry.id === quote.id)!;
}

export async function withdrawQuote(
  auth: AuthContext,
  organizationId: string,
  quoteId: string,
): Promise<void> {
  const quote = await prisma.orderQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.fleetOrganizationId !== organizationId) throw errors.notFound('Quote');
  if (quote.status !== QuoteStatus.OFFERED) {
    throw errors.businessRule('Only an open quote can be withdrawn.');
  }

  await prisma.orderQuote.update({
    where: { id: quoteId },
    data: { status: QuoteStatus.WITHDRAWN },
  });
  await recordEvent(quote.orderId, 'QUOTE_WITHDRAWN', 'A fleet withdrew its quote.', auth.user.id);
}

// ---------------------------------------------------------------------------
// Accepting a quote
// ---------------------------------------------------------------------------

export interface AcceptQuoteResult {
  order: OrderSummary;
  tripId: string;
}

export async function acceptQuote(
  auth: AuthContext,
  orderId: string,
  quoteId: string,
): Promise<AcceptQuoteResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw errors.notFound('Order');
  if (!auth.isPlatformAdmin && order.customerOrganizationId !== auth.organizationId) {
    throw errors.forbidden('Only the customer who posted this requirement can accept a quote.');
  }
  if (!([OrderStatus.REQUESTED, OrderStatus.QUOTED] as OrderStatus[]).includes(order.status)) {
    throw errors.invalidTransition('Transport has already been arranged for this requirement.');
  }

  const quote = await prisma.orderQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.orderId !== orderId) throw errors.notFound('Quote');
  if (quote.status !== QuoteStatus.OFFERED) {
    throw errors.businessRule('This quote is no longer available.');
  }
  if (quote.expiresAt && quote.expiresAt.getTime() < Date.now()) {
    throw errors.businessRule('This quote has expired. Ask the fleet to re-quote.');
  }
  if (!quote.truckId) {
    throw errors.businessRule('This quote does not name a truck and cannot be accepted.');
  }

  const truck = await prisma.truck.findUnique({ where: { id: quote.truckId } });
  if (!truck) throw errors.notFound('Truck');
  if (!ASSIGNABLE_TRUCK_STATUSES.includes(truck.status as TruckStatus)) {
    throw errors.businessRule(
      `${truck.registrationNumber} is no longer available. Ask the fleet to quote another vehicle.`,
    );
  }

  const driverId = quote.driverId ?? truck.currentDriverId;
  if (!driverId) {
    throw errors.businessRule(
      'The quoted truck has no driver assigned. Ask the fleet to assign one before you accept.',
    );
  }

  const transportPrice = Number(quote.price);
  const materialPrice = order.materialPrice ? Number(order.materialPrice) : 0;

  const tripId = await prisma.$transaction(async (tx) => {
    const tripCount = await tx.trip.count();
    const trip = await tx.trip.create({
      data: {
        reference: `TR-${new Date().getFullYear()}-${String(tripCount + 1).padStart(5, '0')}`,
        organizationId: quote.fleetOrganizationId,
        truckId: quote.truckId!,
        driverId,
        originAddress: order.originAddress,
        originLatitude: order.originLatitude,
        originLongitude: order.originLongitude,
        destinationAddress: order.destinationAddress,
        destinationLatitude: order.destinationLatitude,
        destinationLongitude: order.destinationLongitude,
        plannedRoute: [
          { latitude: order.originLatitude, longitude: order.originLongitude },
          { latitude: order.destinationLatitude, longitude: order.destinationLongitude },
        ] as never,
        plannedDistanceKm: order.distanceKm,
        plannedDurationMin: order.distanceKm ? Math.round((order.distanceKm / 45) * 60) : null,
        plannedStartAt: quote.estimatedPickupAt ?? order.pickupAt,
        plannedArrivalAt: quote.estimatedArrivalAt ?? order.deliverBy,
        status: 'ASSIGNED',
        price: transportPrice,
        createdById: auth.user.id,
        stops: {
          create: [
            {
              type: 'ORIGIN',
              name: order.originAddress,
              latitude: order.originLatitude,
              longitude: order.originLongitude,
              sequence: 0,
              plannedArrival: quote.estimatedPickupAt ?? order.pickupAt,
              status: 'PENDING',
            },
            {
              type: 'DESTINATION',
              name: order.destinationAddress,
              latitude: order.destinationLatitude,
              longitude: order.destinationLongitude,
              sequence: 1,
              plannedArrival: quote.estimatedArrivalAt ?? order.deliverBy,
              status: 'PENDING',
            },
          ],
        },
        events: {
          create: [
            { type: 'CREATED', description: `Trip created from order ${order.reference}.` },
            { type: 'ASSIGNED', description: 'Truck and driver assigned.' },
          ],
        },
      },
    });

    await tx.orderQuote.update({ where: { id: quoteId }, data: { status: QuoteStatus.ACCEPTED } });
    await tx.orderQuote.updateMany({
      where: { orderId, id: { not: quoteId }, status: QuoteStatus.OFFERED },
      data: { status: QuoteStatus.REJECTED },
    });

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.ASSIGNED,
        fleetOrganizationId: quote.fleetOrganizationId,
        assignedTruckId: quote.truckId,
        assignedDriverId: driverId,
        tripId: trip.id,
        transportPrice,
        totalPrice: materialPrice + transportPrice,
        confirmedAt: new Date(),
      },
    });

    await tx.truck.update({
      where: { id: quote.truckId! },
      data: { status: TruckStatus.ASSIGNED, currentTripId: trip.id },
    });
    await tx.driver.update({ where: { id: driverId }, data: { availability: 'ON_TRIP' } });

    // Reserve the material so it cannot be double-sold.
    if (order.materialId) {
      await tx.material.update({
        where: { id: order.materialId },
        data: { availableQuantity: { decrement: order.quantity } },
      });
    }

    return trip.id;
  });

  await recordEvent(orderId, 'QUOTE_ACCEPTED', 'Customer accepted the transport quote.', auth.user.id, {
    quoteId,
    price: transportPrice,
  });
  await recordEvent(orderId, 'TRIP_CREATED', 'Trip created and assigned.', auth.user.id, { tripId });

  void notifyOrganization(quote.fleetOrganizationId, {
    type: NotificationType.ORDER_UPDATED,
    title: 'Quote accepted',
    body: `Your quote for ${order.reference} was accepted. A trip has been created.`,
    priority: NotificationPriority.HIGH,
    actionUrl: `/trips/${tripId}`,
  });

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { userId: true },
  });
  if (driver) {
    notifyAsync({
      userId: driver.userId,
      organizationId: quote.fleetOrganizationId,
      type: NotificationType.TRIP_ASSIGNED,
      title: 'New trip assigned',
      body: `${order.originAddress} → ${order.destinationAddress}`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/driver/trips/${tripId}`,
    });
  }

  await publishUpdate(orderId);

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderInclude,
  });
  return { order: (await decorate([updated]))[0]!, tripId };
}

// ---------------------------------------------------------------------------
// Orders raised by awarding a requirement
// ---------------------------------------------------------------------------

export interface RequirementOrderInput {
  requirementId: string;
  customerId: string;
  customerOrganizationId: string;

  materialId: string | null;
  supplierOrganizationId: string | null;
  materialName: string;
  quantity: number;
  unit: MaterialUnit;
  /** Agreed price for the goods, from the winning material bid. */
  materialPrice: number | null;

  originAddress: string;
  originLatitude: number;
  originLongitude: number;
  destinationAddress: string;
  destinationLatitude: number;
  destinationLongitude: number;

  requiredCapacityTons: number;
  requiredTruckType: TruckType | null;
  pickupAt: Date | null;
  deliverBy: Date | null;
  budget: number | null;
  notes: string | null;

  /**
   * The winning transport bid, when the customer awarded one. Absent when the
   * customer is arranging their own transport or the supplier priced delivery
   * into the goods, in which case the order is confirmed without a trip.
   */
  transport: {
    fleetOrganizationId: string;
    truckId: string;
    driverId: string | null;
    price: number;
    estimatedPickupAt: Date | null;
    estimatedArrivalAt: Date | null;
    message: string | null;
  } | null;
}

/**
 * Turn an awarded requirement into an order.
 *
 * Lives here rather than in the requirements module because everything it
 * touches — the reference series, the order event log, the customer's order
 * count, the material reservation — belongs to orders, and a second module
 * writing those would be a second definition of what an order is.
 *
 * When a transport bid was awarded the order is created as a normal REQUESTED
 * requirement carrying a single OFFERED quote, and then `acceptQuote` runs
 * against it. That is deliberate: accepting a quote is what creates the trip,
 * reserves the vehicle, moves the driver to ON_TRIP and reserves the stock, and
 * reimplementing any of that here would be a second, divergent copy of the most
 * consequential transaction in the system.
 */
export async function createOrderFromRequirement(
  auth: AuthContext,
  input: RequirementOrderInput,
): Promise<{ order: OrderSummary; tripId: string | null }> {
  const distance = distanceKm(
    { latitude: input.originLatitude, longitude: input.originLongitude },
    { latitude: input.destinationLatitude, longitude: input.destinationLongitude },
  );

  const created = await prisma.order.create({
    data: {
      reference: await nextReference(),
      customerId: input.customerId,
      customerOrganizationId: input.customerOrganizationId,
      materialId: input.materialId,
      supplierOrganizationId: input.supplierOrganizationId,
      materialName: input.materialName,
      quantity: input.quantity,
      unit: input.unit,
      materialPrice: input.materialPrice,
      budget: input.budget,
      originAddress: input.originAddress,
      originLatitude: input.originLatitude,
      originLongitude: input.originLongitude,
      destinationAddress: input.destinationAddress,
      destinationLatitude: input.destinationLatitude,
      destinationLongitude: input.destinationLongitude,
      distanceKm: Number(distance.toFixed(1)),
      requiredCapacityTons: input.requiredCapacityTons,
      requiredTruckType: input.requiredTruckType,
      pickupAt: input.pickupAt,
      deliverBy: input.deliverBy,
      status: OrderStatus.REQUESTED,
      notes: input.notes,
      createdById: auth.user.id,
    },
    include: orderInclude,
  });

  await recordEvent(
    created.id,
    'CREATED',
    `Order raised from awarded requirement ${input.requirementId}.`,
    auth.user.id,
    { requirementId: input.requirementId },
  );
  await prisma.customer.update({
    where: { id: input.customerId },
    data: { totalOrders: { increment: 1 } },
  });

  if (!input.transport) {
    // Nothing to dispatch: the goods are collected by the customer, or the
    // supplier priced delivery in. The order is agreed, so it is confirmed.
    const confirmed = await prisma.order.update({
      where: { id: created.id },
      data: {
        status: OrderStatus.CONFIRMED,
        totalPrice: input.materialPrice,
        confirmedAt: new Date(),
      },
      include: orderInclude,
    });
    await recordEvent(created.id, 'CONFIRMED', 'Supplier appointed by the customer.', auth.user.id);

    if (input.supplierOrganizationId) {
      void notifyOrganization(input.supplierOrganizationId, {
        type: NotificationType.ORDER_CREATED,
        title: 'Order confirmed',
        body: `${confirmed.reference}: ${confirmed.quantity} ${confirmed.unit.toLowerCase()} of ${confirmed.materialName}.`,
        priority: NotificationPriority.HIGH,
        actionUrl: `/orders/${confirmed.id}`,
      });
    }

    await publishUpdate(confirmed.id);
    return { order: (await decorate([confirmed]))[0]!, tripId: null };
  }

  const quote = await prisma.orderQuote.create({
    data: {
      orderId: created.id,
      fleetOrganizationId: input.transport.fleetOrganizationId,
      truckId: input.transport.truckId,
      driverId: input.transport.driverId,
      price: input.transport.price,
      estimatedPickupAt: input.transport.estimatedPickupAt,
      estimatedArrivalAt: input.transport.estimatedArrivalAt,
      message: input.transport.message,
      status: QuoteStatus.OFFERED,
      createdById: auth.user.id,
    },
  });

  const result = await acceptQuote(auth, created.id, quote.id);
  return { order: result.order, tripId: result.tripId };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function transitionOrder(
  auth: AuthContext,
  orderId: string,
  status: OrderStatus,
  reason?: string,
): Promise<OrderSummary> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw errors.notFound('Order');
  await assertOrderAccess(auth, order);

  const check = orderStateMachine.assertTransition(order.status, status);
  if (!check.allowed) throw errors.invalidTransition(check.reason!);

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      status,
      ...(status === OrderStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
      ...(status === OrderStatus.COMPLETED ? { completedAt: new Date() } : {}),
      ...(status === OrderStatus.CANCELLED
        ? { cancelledAt: new Date(), cancellationReason: reason ?? null }
        : {}),
    },
    include: orderInclude,
  });

  await recordEvent(
    orderId,
    'STATUS_CHANGED',
    reason ?? `Order moved from ${order.status} to ${status}.`,
    auth.user.id,
    { from: order.status, to: status },
  );

  void notifyOrganization(order.customerOrganizationId, {
    type: NotificationType.ORDER_UPDATED,
    title: `Order ${status.toLowerCase().replace(/_/g, ' ')}`,
    body: `${order.reference}: ${reason ?? `status is now ${status.toLowerCase().replace(/_/g, ' ')}.`}`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/orders/${orderId}`,
  });

  // An order raised from a requirement carries that requirement's outcome with
  // it, so the customer's requirement list agrees with what was actually
  // delivered rather than showing finished work as still in flight.
  if (status === OrderStatus.COMPLETED) {
    void markRequirementFulfilled({ orderId }, `Order ${order.reference} completed.`);
  } else if (status === OrderStatus.CANCELLED) {
    void markRequirementCancelled(
      { orderId },
      reason ?? `Order ${order.reference} was cancelled.`,
    );
  }

  await publishUpdate(orderId);
  return (await decorate([updated]))[0]!;
}

export async function cancelOrder(
  auth: AuthContext,
  orderId: string,
  input: CancelOrderInput,
): Promise<OrderSummary> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw errors.notFound('Order');
  await assertOrderAccess(auth, order);

  const check = orderStateMachine.assertTransition(order.status, OrderStatus.CANCELLED);
  if (!check.allowed) {
    throw errors.invalidTransition(
      `This order cannot be cancelled once it is ${order.status.toLowerCase().replace(/_/g, ' ')}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: input.reason,
      },
    });

    // Release the truck, driver and any reserved stock.
    if (order.tripId) {
      await tx.trip.update({
        where: { id: order.tripId },
        data: { status: 'CANCELLED', cancellationReason: input.reason },
      });
    }
    if (order.assignedTruckId) {
      await tx.truck.update({
        where: { id: order.assignedTruckId },
        data: { status: TruckStatus.AVAILABLE, currentTripId: null },
      });
    }
    if (order.assignedDriverId) {
      await tx.driver.update({
        where: { id: order.assignedDriverId },
        data: { availability: 'AVAILABLE' },
      });
    }
    if (order.materialId && order.fleetOrganizationId) {
      await tx.material.update({
        where: { id: order.materialId },
        data: { availableQuantity: { increment: order.quantity } },
      });
    }
    await tx.orderQuote.updateMany({
      where: { orderId, status: { in: [QuoteStatus.OFFERED, QuoteStatus.ACCEPTED] } },
      data: { status: QuoteStatus.REJECTED },
    });
  });

  await recordEvent(orderId, 'CANCELLED', `Order cancelled: ${input.reason}`, auth.user.id);

  for (const organizationId of partiesOf(order)) {
    if (!organizationId || organizationId === auth.organizationId) continue;
    void notifyOrganization(organizationId, {
      type: NotificationType.ORDER_UPDATED,
      title: 'Order cancelled',
      body: `${order.reference} was cancelled: ${input.reason}`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/orders/${orderId}`,
    });
  }

  await publishUpdate(orderId);

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderInclude,
  });
  return (await decorate([updated]))[0]!;
}

export async function rateOrder(
  auth: AuthContext,
  orderId: string,
  input: RateOrderInput,
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw errors.notFound('Order');
  if (!auth.isPlatformAdmin && order.customerOrganizationId !== auth.organizationId) {
    throw errors.forbidden('Only the customer on this order can rate it.');
  }
  if (!([OrderStatus.DELIVERED, OrderStatus.COMPLETED] as OrderStatus[]).includes(order.status)) {
    throw errors.businessRule('You can rate an order once it has been delivered.');
  }

  const existing = await prisma.orderRating.findUnique({ where: { orderId } });
  if (existing) throw errors.conflict('This order has already been rated.');

  await prisma.orderRating.create({
    data: {
      orderId,
      driverId: order.assignedDriverId,
      fleetOrganizationId: order.fleetOrganizationId,
      supplierOrganizationId: order.supplierOrganizationId,
      rating: input.rating,
      punctuality: input.punctuality ?? null,
      communication: input.communication ?? null,
      cargoCondition: input.cargoCondition ?? null,
      comment: input.comment ?? null,
      ratedByUserId: auth.user.id,
    },
  });

  // A rating is a real scoring signal, not just a display value.
  if (order.assignedDriverId) {
    const positive = input.rating >= 4;
    await prisma.driverScoreEvent.create({
      data: {
        driverId: order.assignedDriverId,
        eventType: positive ? 'CUSTOMER_POSITIVE_RATING' : 'CUSTOMER_NEGATIVE_RATING',
        category: 'RELIABILITY',
        points: positive ? 4 : -6,
        reason: positive
          ? `Customer rated order ${order.reference} ${input.rating}/5.`
          : `Customer rated order ${order.reference} ${input.rating}/5.`,
        sourceType: 'ORDER',
        sourceId: orderId,
      },
    });
    const { recalculateDriverScore, evaluateAndAwardAchievements } = await import(
      '../drivers/driver.service'
    );
    await recalculateDriverScore(order.assignedDriverId);
    await evaluateAndAwardAchievements(order.assignedDriverId);
  }

  await recordEvent(orderId, 'RATED', `Customer rated this delivery ${input.rating}/5.`, auth.user.id);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface TransportMatch {
  truckId: string;
  registrationNumber: string;
  truckType: string;
  capacityTons: number;
  verificationStatus: string;
  organizationId: string;
  fleetName: string;
  driver: { id: string; name: string; overallScore: number | null } | null;
  distanceToPickupKm: number;
  estimatedPickupMinutes: number;
  estimatedTripMinutes: number;
  estimatedPrice: number;
  /** 0–100, explaining why this option is ranked where it is. */
  matchScore: number;
  reasons: string[];
}

const RATE_PER_KM = 58;
const AVERAGE_SPEED_KPH = 45;

/**
 * Rank available trucks for a requirement. Deterministic and explainable —
 * the same inputs always produce the same ordering, and every option carries
 * the reasons behind its score.
 */
export async function matchTransport(
  auth: AuthContext,
  input: MatchTransportInput,
): Promise<TransportMatch[]> {
  const tripDistance = distanceKm(
    { latitude: input.originLatitude, longitude: input.originLongitude },
    { latitude: input.destinationLatitude, longitude: input.destinationLongitude },
  );

  const trucks = await prisma.truck.findMany({
    where: {
      archivedAt: null,
      shareLocation: true,
      verificationStatus: VerificationStatus.VERIFIED,
      status: { in: ASSIGNABLE_TRUCK_STATUSES },
      capacityTons: { gte: input.requiredCapacityTons },
      ...(input.requiredTruckType ? { truckType: input.requiredTruckType } : {}),
      lastLatitude: { not: null },
      lastLongitude: { not: null },
      currentDriverId: { not: null },
    },
    include: { assignments: { where: { status: 'ACTIVE' }, take: 1 } },
    take: 500,
  });

  const driverIds = trucks
    .map((truck) => truck.currentDriverId)
    .filter((id): id is string => Boolean(id));

  const [drivers, organizations] = await Promise.all([
    prisma.driver.findMany({
      where: { id: { in: driverIds }, verificationStatus: VerificationStatus.VERIFIED },
      include: { user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.organization.findMany({
      where: { id: { in: [...new Set(trucks.map((truck) => truck.organizationId))] } },
      select: { id: true, name: true },
    }),
  ]);

  const driverMap = new Map(drivers.map((driver) => [driver.id, driver]));
  const orgMap = new Map(organizations.map((organization) => [organization.id, organization.name]));

  const matches: TransportMatch[] = [];

  for (const truck of trucks) {
    const driver = truck.currentDriverId ? driverMap.get(truck.currentDriverId) : undefined;
    if (!driver) continue;

    const toPickup = distanceKm(
      { latitude: truck.lastLatitude!, longitude: truck.lastLongitude! },
      { latitude: input.originLatitude, longitude: input.originLongitude },
    );
    if (toPickup > input.radiusKm) continue;

    const reasons: string[] = [];

    // Proximity dominates: a nearby truck reaches the customer sooner.
    const proximityScore = Math.max(0, 1 - toPickup / input.radiusKm) * 45;
    if (toPickup <= 25) reasons.push(`Only ${toPickup.toFixed(0)} km from the pickup point.`);

    // Right-sized capacity: big enough, but not wastefully oversized.
    const capacityRatio = input.requiredCapacityTons / truck.capacityTons;
    const capacityScore = Math.max(0, Math.min(1, capacityRatio)) * 20;
    if (capacityRatio >= 0.8) {
      reasons.push(`${truck.capacityTons}T capacity closely matches the ${input.requiredCapacityTons}T load.`);
    }

    const score = driver.overallScore ?? 70;
    const driverScoreContribution = (score / 100) * 25;
    if (score >= 85) reasons.push(`Driver score ${score}/100.`);

    const availabilityScore = truck.status === TruckStatus.AVAILABLE ? 10 : 4;
    if (truck.status === TruckStatus.AVAILABLE) reasons.push('Truck is available right now.');

    const matchScore = Math.round(
      proximityScore + capacityScore + driverScoreContribution + availabilityScore,
    );

    matches.push({
      truckId: truck.id,
      registrationNumber: truck.registrationNumber,
      truckType: truck.truckType,
      capacityTons: truck.capacityTons,
      verificationStatus: truck.verificationStatus,
      organizationId: truck.organizationId,
      fleetName: orgMap.get(truck.organizationId) ?? 'Fleet',
      driver: {
        id: driver.id,
        name: `${driver.user.firstName} ${driver.user.lastName}`.trim(),
        overallScore: driver.overallScore,
      },
      distanceToPickupKm: Number(toPickup.toFixed(1)),
      estimatedPickupMinutes: Math.round((toPickup / AVERAGE_SPEED_KPH) * 60),
      estimatedTripMinutes: Math.round((tripDistance / AVERAGE_SPEED_KPH) * 60),
      estimatedPrice: Math.round((tripDistance + toPickup * 0.5) * RATE_PER_KM),
      matchScore,
      reasons,
    });
  }

  void auth;
  return matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, input.limit);
}
