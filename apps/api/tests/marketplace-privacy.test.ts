import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MaterialUnit,
  NotificationType,
  OrderStatus,
  OrganizationType,
  PlanTier,
  ProfileVisibility,
  RealtimeChannel,
  RealtimeEvent,
  RequirementBidScope,
  RequirementKind,
  RoleName,
  TruckStatus,
  TruckType,
  VehicleType,
  VerificationStatus,
  type ChannelMessage,
  type OrderUpdatePayload,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { buildAuthContext } from '../src/auth/session.service';
import { pubsub } from '../src/infra/event-bus';
import { canSubscribe } from '../src/realtime/channel-authorization';
import { orderUpdateFor } from '../src/realtime/realtime.service';
import { tripReplay } from '../src/modules/tracking/tracking.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Customer ↔ Seller privacy on the material marketplace.
 *
 * The customer deals with the fleet owner and the fleet owner deals with the
 * Seller; nothing passes between the two ends in either direction. The Seller
 * learns what it needs to load the truck and nothing of the delivery, the
 * customer or the fleet's selling price — and the fleet and the customer see
 * exactly what they saw before.
 */

const JAIPUR = {
  addressLine: 'Bassi Industrial Area, Jaipur',
  latitude: 26.8351,
  longitude: 75.9843,
};
const GURUGRAM = { addressLine: 'Sector 62, Gurugram', latitude: 28.4089, longitude: 77.0789 };
const CUSTOMER_NOTE = 'Unload at gate 4 and ask for Ramesh';
const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const BANK = {
  accountHolderName: 'Sharma Transport',
  accountNumber: '026291800001191',
  ifsc: 'YESB0000262',
  pan: 'ABCDE1234F',
};

interface OrderView {
  customerOrganizationId: string | null;
  customerName: string;
  supplierOrganizationId: string | null;
  fleetOrganizationId: string | null;
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  distanceKm: number | null;
  notes: string | null;
  budget: number | null;
  totalPrice: number | null;
  transportPrice: number | null;
  deliverBy: string | null;
  cancellationReason: string | null;
  originAddress: string;
  quantity: number;
  status: OrderStatus;
  assignedTruck: { registrationNumber: string } | null;
  assignedDriver: { name: string } | null;
  events: { type: string; description: string; metadata: unknown }[];
}

interface TripView {
  destinationAddress: string | null;
  destinationLatitude: number | null;
  destinationLongitude: number | null;
  plannedDistanceKm: number | null;
  price: number | null;
  currentLocation: unknown;
  plannedRoute: unknown[];
  stops: { type: string }[];
  events: unknown[];
  allowedTransitions: string[];
  truck: { registrationNumber: string } | null;
  driver: { name: string } | null;
  order: { customerName: string } | null;
}

describe('customer and seller privacy', () => {
  let customerOrg: TestOrganization;
  let customer: TestUser;
  let fleetOrg: TestOrganization;
  let fleetOwner: TestUser;
  let supplierOrg: TestOrganization;
  let supplier: TestUser;
  let orderId: string;
  let tripId: string;
  let truckId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  /** Customer requirement → the fleet's delivered bid on a Seller listing → award. */
  beforeEach(async () => {
    await resetDatabase();
    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
    fleetOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    fleetOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetOrg.id });
    supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
    supplier = await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });

    for (const user of [fleetOwner, supplier]) {
      await request({ method: 'POST', url: '/api/v1/finance/payout-account', user, payload: BANK });
    }

    const supplierRecord = await prisma.supplier.findUniqueOrThrow({
      where: { organizationId: supplierOrg.id },
    });
    const material = await prisma.material.create({
      data: {
        supplierId: supplierRecord.id,
        organizationId: supplierOrg.id,
        name: 'River sand',
        category: 'Sand',
        unit: MaterialUnit.TON,
        pricePerUnit: 2000,
        availableQuantity: 100,
        status: 'ACTIVE',
        pickupLatitude: JAIPUR.latitude,
        pickupLongitude: JAIPUR.longitude,
      },
    });

    const driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleetOrg.id,
      driver: true,
    });
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleetOrg.id,
        registrationNumber: `RJ14MF${Math.floor(Math.random() * 90000 + 10000)}`,
        truckType: TruckType.OPEN_BODY,
        vehicleType: VehicleType.TRUCK,
        capacityTons: 30,
        status: TruckStatus.AVAILABLE,
        verificationStatus: VerificationStatus.VERIFIED,
        currentDriverId: driver.driverId ?? null,
      },
    });
    truckId = truck.id;

    const requirement = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/requirements',
      user: customer,
      payload: {
        kind: RequirementKind.MATERIAL_SUPPLY,
        title: '25 tonnes of river sand',
        description: CUSTOMER_NOTE,
        origin: JAIPUR,
        destination: GURUGRAM,
        startAt: soon(6),
        endAt: soon(8),
        budgetAmount: 70000,
        bidsCloseAt: soon(2),
        materialDetail: {
          materialName: 'River sand',
          quantity: 25,
          unit: MaterialUnit.TON,
          needsTransport: true,
        },
      },
    });
    expect(requirement.status).toBe(201);

    const bid = await request<{ id: string }>({
      method: 'POST',
      url: `/api/v1/requirements/${requirement.body.data.id}/bids`,
      user: fleetOwner,
      payload: {
        scope: RequirementBidScope.TRANSPORT,
        price: 62500,
        vehicleId: truck.id,
        sourceMaterialId: material.id,
      },
    });
    expect(bid.status).toBe(201);

    const award = await request<{ orderId: string; tripId: string }>({
      method: 'POST',
      url: `/api/v1/requirements/${requirement.body.data.id}/award`,
      user: customer,
      payload: { bidId: bid.body.data.id },
    });
    expect(award.status).toBe(200);
    orderId = award.body.data.orderId;
    tripId = award.body.data.tripId;
  });

  const getOrder = (user: TestUser) =>
    request<OrderView>({ method: 'GET', url: `/api/v1/orders/${orderId}`, user });

  const getTrip = (user: TestUser) =>
    request<TripView>({ method: 'GET', url: `/api/v1/trips/${tripId}`, user });

  /** Order notifications land asynchronously; wait for the one with this title. */
  async function orderNotification(user: TestUser, title: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const found = await prisma.notification.findFirst({
        where: { userId: user.id, type: NotificationType.ORDER_UPDATED, title },
      });
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`No "${title}" notification reached ${user.email}`);
  }

  describe('the order', () => {
    it('shows the seller what it needs to load the truck, and nothing of the delivery or the customer', async () => {
      const { status, body } = await getOrder(supplier);
      expect(status).toBe(200);
      const order = body.data;

      expect(order.customerOrganizationId).toBeNull();
      expect(order.customerName).toBe('Saarthi customer');
      expect(order.destinationAddress).toBeNull();
      expect(order.destinationLatitude).toBeNull();
      expect(order.destinationLongitude).toBeNull();
      expect(order.distanceKm).toBeNull();
      expect(order.notes).toBeNull();
      expect(order.deliverBy).toBeNull();
      // The fleet's selling price and the customer's budget are not the Seller's to see.
      expect(order.budget).toBeNull();
      expect(order.totalPrice).toBeNull();
      expect(order.transportPrice).toBeNull();
      // Bidding events — and the prices their metadata carries — are withheld.
      expect(order.events.some((event) => event.type.startsWith('QUOTE_'))).toBe(false);
      expect(order.events.every((event) => event.metadata === null)).toBe(true);

      // What it does need: what to load, where, and who is coming for it.
      expect(order.supplierOrganizationId).toBe(supplierOrg.id);
      expect(order.originAddress).toBe(JAIPUR.addressLine);
      expect(order.quantity).toBe(25);
      expect(order.assignedTruck).not.toBeNull();
      expect(order.assignedDriver?.name).toBeTruthy();

      const raw = JSON.stringify(body);
      expect(raw).not.toContain(GURUGRAM.addressLine);
      expect(raw).not.toContain(CUSTOMER_NOTE);
      expect(raw).not.toContain(customerOrg.id);
      expect(raw).not.toContain(customerOrg.name);
    });

    it('shows the customer and the fleet the order exactly as before', async () => {
      const asCustomer = (await getOrder(customer)).body.data;
      expect(asCustomer.customerOrganizationId).toBe(customerOrg.id);
      expect(asCustomer.destinationAddress).toBe(GURUGRAM.addressLine);
      expect(asCustomer.notes).toBe(CUSTOMER_NOTE);
      expect(asCustomer.transportPrice).toBe(62500);
      expect(asCustomer.totalPrice).toBe(62500);
      expect(asCustomer.budget).toBe(70000);
      expect(asCustomer.deliverBy).not.toBeNull();
      // …and still never the Seller.
      expect(asCustomer.supplierOrganizationId).toBeNull();
      expect(JSON.stringify(asCustomer)).not.toContain(supplierOrg.id);

      const asFleet = (await getOrder(fleetOwner)).body.data;
      expect(asFleet.customerOrganizationId).toBe(customerOrg.id);
      expect(asFleet.customerName).toBe(customerOrg.name);
      expect(asFleet.supplierOrganizationId).toBe(supplierOrg.id);
      expect(asFleet.destinationAddress).toBe(GURUGRAM.addressLine);
      expect(asFleet.notes).toBe(CUSTOMER_NOTE);
      expect(asFleet.totalPrice).toBe(62500);
      expect(asFleet.events.some((event) => event.type === 'QUOTE_ACCEPTED')).toBe(true);
    });

    it('keeps the delivery out of what the seller can search, filter or sort on', async () => {
      const list = (user: TestUser, query: string) =>
        request<{ items: OrderView[] }>({ method: 'GET', url: `/api/v1/orders?${query}`, user });

      // The delivery address confirms nothing to the Seller…
      expect((await list(supplier, 'search=Gurugram')).body.data.items).toHaveLength(0);
      // …while the pickup, and the fleet's own search, still work.
      expect((await list(supplier, 'search=Bassi')).body.data.items).toHaveLength(1);
      expect((await list(fleetOwner, 'search=Gurugram')).body.data.items).toHaveLength(1);

      // Filtering by a customer cannot confirm which customer it is.
      const byCustomer = await list(supplier, `customerOrganizationId=${customerOrg.id}`);
      const byStranger = await list(supplier, `customerOrganizationId=${fleetOrg.id}`);
      expect(byCustomer.body.data.items).toHaveLength(byStranger.body.data.items.length);

      const listed = (await list(supplier, 'pageSize=20')).body.data.items[0]!;
      expect(listed.destinationAddress).toBeNull();
      expect(listed.customerOrganizationId).toBeNull();
    });

    it('leaves the seller read-only: it can neither move nor cancel the order', async () => {
      const cancel = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/cancel`,
        user: supplier,
        payload: { reason: 'Out of stock, sorry' },
      });
      expect(cancel.status).toBe(403);

      const move = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/status`,
        user: supplier,
        payload: { status: OrderStatus.PICKUP },
      });
      expect(move.status).toBe(403);

      // Refused by the service too, not only by the role: a member of the
      // Seller holding a grant that reaches the route is still turned away.
      const manager = await createUser({
        role: RoleName.FLEET_MANAGER,
        organizationId: supplierOrg.id,
      });
      const byManager = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/cancel`,
        user: manager,
        payload: { reason: 'Out of stock, sorry' },
      });
      expect(byManager.status).toBe(403);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(OrderStatus.ASSIGNED);
      expect(order.cancellationReason).toBeNull();
    });

    it("keeps the customer's cancellation reason from the seller, and gives it to the fleet", async () => {
      const reason = 'Site flooded, we no longer need it';
      const cancelled = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/cancel`,
        user: customer,
        payload: { reason },
      });
      expect(cancelled.status).toBe(200);

      const toFleet = await orderNotification(fleetOwner, 'Order cancelled');
      expect(toFleet.body).toContain(reason);
      const toSeller = await orderNotification(supplier, 'Order cancelled');
      expect(toSeller.body).not.toContain(reason);
      expect(toSeller.body).toMatch(/was cancelled\.$/);

      const asSeller = (await getOrder(supplier)).body.data;
      expect(asSeller.status).toBe(OrderStatus.CANCELLED);
      expect(asSeller.cancellationReason).toBeNull();
      expect(asSeller.events.find((event) => event.type === 'CANCELLED')?.description).toBe(
        'Order cancelled.',
      );
      expect(JSON.stringify(asSeller)).not.toContain(reason);

      const asFleet = (await getOrder(fleetOwner)).body.data;
      expect(asFleet.cancellationReason).toBe(reason);
      expect(asFleet.events.find((event) => event.type === 'CANCELLED')?.description).toContain(
        reason,
      );
    });

    it("keeps a seller's words from the customer, and passes the fleet's on", async () => {
      // A reason a Seller wrote before it was made read-only.
      await prisma.orderEvent.create({
        data: {
          orderId,
          type: 'STATUS_CHANGED',
          description: 'Short of stock, the customer will have to wait',
          actorUserId: supplier.id,
          metadata: { from: OrderStatus.ASSIGNED, to: OrderStatus.CONFIRMED },
        },
      });

      const fleetReason = 'Truck has reached the loading point';
      const moved = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/status`,
        user: fleetOwner,
        payload: { status: OrderStatus.PICKUP, reason: fleetReason },
      });
      expect(moved.status).toBe(200);

      const asCustomer = (await getOrder(customer)).body.data;
      const descriptions = asCustomer.events.map((event) => event.description);
      expect(descriptions).not.toContain('Short of stock, the customer will have to wait');
      expect(descriptions).toContain(
        `Order moved from ${OrderStatus.ASSIGNED} to ${OrderStatus.CONFIRMED}.`,
      );
      expect(descriptions).toContain(fleetReason);
      expect((await orderNotification(customer, 'Order pickup')).body).toContain(fleetReason);

      // The fleet reads every word, and the Seller reads the fleet's.
      const fleetDescriptions = (await getOrder(fleetOwner)).body.data.events.map(
        (event) => event.description,
      );
      expect(fleetDescriptions).toContain('Short of stock, the customer will have to wait');
      const sellerDescriptions = (await getOrder(supplier)).body.data.events.map(
        (event) => event.description,
      );
      expect(sellerDescriptions).toContain(fleetReason);
    });

    it('withholds the fleet selling price from the seller on the payment plan', async () => {
      const finance = (user: TestUser) =>
        request<{
          agreedAmount: number | null;
          confirmationAmount: number | null;
          balanceDue: number | null;
        }>({
          method: 'GET',
          url: `/api/v1/orders/${orderId}/finance`,
          user,
        });

      const asSeller = (await finance(supplier)).body.data;
      expect(asSeller.agreedAmount).toBeNull();
      expect(asSeller.confirmationAmount).toBeNull();
      expect(asSeller.balanceDue).toBeNull();

      const asCustomer = (await finance(customer)).body.data;
      expect(asCustomer.agreedAmount).toBe(62500);
      expect(asCustomer.confirmationAmount).toBe(18750);
    });
  });

  describe('the trip', () => {
    it('shows the seller who is coming to load, and nothing past its yard', async () => {
      const { status, body } = await getTrip(supplier);
      expect(status).toBe(200);
      const trip = body.data;

      expect(trip.destinationAddress).toBeNull();
      expect(trip.destinationLatitude).toBeNull();
      expect(trip.destinationLongitude).toBeNull();
      expect(trip.plannedDistanceKm).toBeNull();
      expect(trip.price).toBeNull();
      expect(trip.currentLocation).toBeNull();
      expect(trip.plannedRoute).toEqual([]);
      expect(trip.events).toEqual([]);
      expect(trip.allowedTransitions).toEqual([]);
      expect(trip.stops.map((stop) => stop.type)).toEqual(['ORIGIN']);
      expect(trip.order?.customerName).toBe('Saarthi customer');
      expect(trip.truck).not.toBeNull();
      expect(trip.driver?.name).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain(GURUGRAM.addressLine);

      const search = (user: TestUser) =>
        request<{ items: TripView[] }>({
          method: 'GET',
          url: '/api/v1/trips?search=Gurugram',
          user,
        });
      expect((await search(supplier)).body.data.items).toHaveLength(0);
      expect((await search(fleetOwner)).body.data.items).toHaveLength(1);

      // The customer and the fleet follow the whole run, as before.
      const asCustomer = (await getTrip(customer)).body.data;
      expect(asCustomer.destinationAddress).toBe(GURUGRAM.addressLine);
      expect(asCustomer.plannedRoute.length).toBeGreaterThan(0);
      const asFleet = (await getTrip(fleetOwner)).body.data;
      expect(asFleet.destinationAddress).toBe(GURUGRAM.addressLine);
      expect(asFleet.stops.map((stop) => stop.type)).toEqual(['ORIGIN', 'DESTINATION']);
    });

    it('denies the seller live tracking, replay and the live streams', async () => {
      const history = await request({
        method: 'GET',
        url: `/api/v1/tracking/trucks/${truckId}/history?tripId=${tripId}`,
        user: supplier,
      });
      expect(history.status).toBe(403);

      const seller = await buildAuthContext(supplier.id, 'test-session', supplierOrg.id);
      const buyer = await buildAuthContext(customer.id, 'test-session', customerOrg.id);
      const fleet = await buildAuthContext(fleetOwner.id, 'test-session', fleetOrg.id);

      // Refused on the route, and by the service whatever the plan allows.
      const replay = await request({
        method: 'GET',
        url: `/api/v1/trips/${tripId}/replay`,
        user: supplier,
      });
      expect(replay.status).not.toBe(200);
      await expect(tripReplay(seller, tripId)).rejects.toMatchObject({ statusCode: 404 });
      expect((await tripReplay(buyer, tripId)).tripId).toBe(tripId);
      expect(
        (await request({ method: 'GET', url: `/api/v1/trips/${tripId}/replay`, user: fleetOwner }))
          .status,
      ).toBe(200);
      for (const channel of [
        RealtimeChannel.trip(tripId),
        RealtimeChannel.truck(truckId),
        RealtimeChannel.order(orderId),
      ]) {
        expect(await canSubscribe(seller, channel)).toBe(false);
        expect(await canSubscribe(buyer, channel)).toBe(true);
        expect(await canSubscribe(fleet, channel)).toBe(true);
      }
    });
  });

  describe('realtime', () => {
    it('masks an order update for each party it is addressed to', () => {
      const payload: OrderUpdatePayload = {
        orderId: 'order',
        status: OrderStatus.ASSIGNED,
        tripId: null,
        customerOrganizationId: 'customer',
        supplierOrganizationId: 'seller',
        fleetOrganizationId: 'fleet',
        updatedAt: new Date().toISOString(),
      };

      expect(orderUpdateFor('SELLER', payload)).toMatchObject({
        customerOrganizationId: null,
        supplierOrganizationId: 'seller',
        fleetOrganizationId: 'fleet',
      });
      expect(orderUpdateFor('CUSTOMER', payload)).toMatchObject({
        customerOrganizationId: 'customer',
        supplierOrganizationId: null,
        fleetOrganizationId: 'fleet',
      });
      expect(orderUpdateFor('FLEET_OWNER', payload)).toEqual(payload);
    });

    it('sends each party its own view of an order update', async () => {
      const channels = {
        seller: RealtimeChannel.fleet(supplierOrg.id),
        customer: RealtimeChannel.fleet(customerOrg.id),
        fleet: RealtimeChannel.fleet(fleetOrg.id),
        order: RealtimeChannel.order(orderId),
      };
      const received = new Map<string, OrderUpdatePayload[]>();
      const stops = Object.values(channels).map((channel) => {
        received.set(channel, []);
        return pubsub.subscribe(channel, (message) => {
          const event = message as ChannelMessage;
          if (event.type === RealtimeEvent.ORDER_UPDATED)
            received.get(channel)!.push(event.payload);
        });
      });

      try {
        const moved = await request({
          method: 'POST',
          url: `/api/v1/orders/${orderId}/status`,
          user: fleetOwner,
          payload: { status: OrderStatus.PICKUP },
        });
        expect(moved.status).toBe(200);
      } finally {
        for (const stop of stops) stop();
      }

      const last = (channel: string) => received.get(channel)!.at(-1)!;
      expect(last(channels.seller)).toMatchObject({
        customerOrganizationId: null,
        supplierOrganizationId: supplierOrg.id,
      });
      expect(last(channels.customer)).toMatchObject({
        customerOrganizationId: customerOrg.id,
        supplierOrganizationId: null,
      });
      expect(last(channels.fleet)).toMatchObject({
        customerOrganizationId: customerOrg.id,
        supplierOrganizationId: supplierOrg.id,
      });
      // The shared order stream admits the customer, so it never names the Seller.
      expect(last(channels.order).supplierOrganizationId).toBeNull();
    });
  });

  describe('the directory', () => {
    const search = (user: TestUser, term: string) =>
      request<{ items: { id: string }[] }>({
        method: 'GET',
        url: `/api/v1/profile/directory?search=${encodeURIComponent(term)}`,
        user,
      });

    it('never lists a seller to a customer or a customer to a seller', async () => {
      const ids = async (user: TestUser, term: string) =>
        (await search(user, term)).body.data.items.map((entry) => entry.id);

      expect(await ids(customer, supplierOrg.name)).not.toContain(supplierOrg.id);
      expect(await ids(supplier, customerOrg.name)).not.toContain(customerOrg.id);
      // The fleet between them finds both, and each still finds the fleet.
      expect(await ids(fleetOwner, supplierOrg.name)).toContain(supplierOrg.id);
      expect(await ids(fleetOwner, customerOrg.name)).toContain(customerOrg.id);
      expect(await ids(customer, fleetOrg.name)).toContain(fleetOrg.id);
      expect(await ids(supplier, fleetOrg.name)).toContain(fleetOrg.id);
    });

    it('does not open a seller profile to a customer, whatever its visibility', async () => {
      await prisma.organizationProfile.create({
        data: {
          organizationId: supplierOrg.id,
          publicSlug: 'river-sand-co',
          visibility: ProfileVisibility.PLATFORM,
        },
      });

      expect(
        (await request({ method: 'GET', url: '/api/v1/profile/river-sand-co', user: customer }))
          .status,
      ).toBe(404);
      expect(
        (await request({ method: 'GET', url: '/api/v1/profile/river-sand-co', user: fleetOwner }))
          .status,
      ).toBe(200);
    });

    it('does not count a shared order as a customer–seller partnership', async () => {
      await prisma.organizationProfile.create({
        data: { organizationId: fleetOrg.id, visibility: ProfileVisibility.PARTNERS },
      });
      await prisma.organizationProfile.create({
        data: { organizationId: customerOrg.id, visibility: ProfileVisibility.PARTNERS },
      });

      // The fleet carried for the customer, so each may see the other's
      // partner-only profile; the Seller on the same order is no partner of
      // the customer's.
      expect(
        (await search(customer, fleetOrg.name)).body.data.items.map((entry) => entry.id),
      ).toContain(fleetOrg.id);
      expect((await search(supplier, customerOrg.name)).body.data.items).toHaveLength(0);
    });

    it('keeps a private profile private when a search term is used', async () => {
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
      await prisma.organizationProfile.create({
        data: { organizationId: otherFleet.id, visibility: ProfileVisibility.PRIVATE },
      });

      expect((await search(fleetOwner, otherFleet.name)).body.data.items).toHaveLength(0);
    });
  });
});
