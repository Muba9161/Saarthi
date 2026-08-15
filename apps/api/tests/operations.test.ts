import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MaterialUnit,
  OrderStatus,
  OrganizationType,
  PlanTier,
  RoleName,
  SosStatus,
  TripStatus,
  TruckStatus,
  TruckType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { runSimulationTick } from '../src/modules/simulation/simulator.service';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * End-to-end operational flow:
 *   customer posts a requirement → fleet quotes → customer accepts →
 *   trip is created → GPS simulator drives it → tracking updates arrive →
 *   SOS is raised and answered → trip completes → driver score updates.
 */
describe('Operations end-to-end', () => {
  let fleet: TestOrganization;
  let supplierOrg: TestOrganization;
  let customerOrg: TestOrganization;
  let owner: TestUser;
  let customer: TestUser;
  let driver: TestUser;
  let helperDriver: TestUser;

  let truckId: string;
  let helperTruckId: string;
  let materialId: string;

  // Delhi → Jaipur corridor, matching the demo dataset.
  const ORIGIN = { latitude: 28.5355, longitude: 77.271 };
  const DESTINATION = { latitude: 26.9124, longitude: 75.7873 };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();

    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.PRO);
    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.PRO);

    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
    driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
    helperDriver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });

    // A verified truck positioned at the pickup point, with a driver assigned.
    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('DL01T').toUpperCase().slice(0, 12),
        truckType: TruckType.TIPPER,
        capacityTons: 25,
        verificationStatus: VerificationStatus.VERIFIED,
        status: TruckStatus.AVAILABLE,
        currentDriverId: driver.driverId!,
        lastLatitude: ORIGIN.latitude,
        lastLongitude: ORIGIN.longitude,
        lastLocationAt: new Date(),
        shareLocation: true,
      },
    });
    truckId = truck.id;
    await prisma.driver.update({
      where: { id: driver.driverId! },
      data: { currentTruckId: truckId },
    });
    await prisma.truckAssignment.create({
      data: {
        truckId,
        driverId: driver.driverId!,
        organizationId: fleet.id,
        status: 'ACTIVE',
      },
    });

    // A second truck nearby, so the SOS network has someone to call.
    const helperTruck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('DL02H').toUpperCase().slice(0, 12),
        truckType: TruckType.OPEN_BODY,
        capacityTons: 16,
        verificationStatus: VerificationStatus.VERIFIED,
        status: TruckStatus.AVAILABLE,
        currentDriverId: helperDriver.driverId!,
        lastLatitude: ORIGIN.latitude + 0.02,
        lastLongitude: ORIGIN.longitude + 0.02,
        lastLocationAt: new Date(),
        shareLocation: true,
      },
    });
    helperTruckId = helperTruck.id;
    await prisma.driver.update({
      where: { id: helperDriver.driverId! },
      data: { currentTruckId: helperTruckId },
    });

    // Supplier catalogue.
    const supplierRecord = await prisma.supplier.findUniqueOrThrow({
      where: { organizationId: supplierOrg.id },
    });
    const material = await prisma.material.create({
      data: {
        supplierId: supplierRecord.id,
        organizationId: supplierOrg.id,
        name: 'River Sand (Fine)',
        category: 'Sand',
        unit: MaterialUnit.TON,
        pricePerUnit: 1450,
        availableQuantity: 500,
        minimumOrderQty: 5,
        status: 'ACTIVE',
        pickupLatitude: ORIGIN.latitude,
        pickupLongitude: ORIGIN.longitude,
      },
    });
    materialId = material.id;
  });

  const orderPayload = () => ({
    materialId,
    quantity: 20,
    unit: MaterialUnit.TON,
    origin: { addressLine: 'Bassi Industrial Area, Jaipur', ...ORIGIN },
    destination: { addressLine: 'Sector 62, Gurugram', ...DESTINATION },
    requiredCapacityTons: 20,
    notes: 'Weighbridge slip required at delivery.',
  });

  describe('marketplace', () => {
    it('lets a customer browse the supplier catalogue', async () => {
      const { status, body } = await request<{ items: { name: string; supplierVerified: boolean }[] }>({
        method: 'GET',
        url: '/api/v1/marketplace/materials?availableOnly=true',
        user: customer,
      });

      expect(status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.name).toBe('River Sand (Fine)');
    });

    it('rejects an order below the material minimum quantity', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/orders',
        user: customer,
        payload: { ...orderPayload(), quantity: 1 },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toMatch(/minimum order quantity/i);
    });

    it('rejects an order larger than the available stock', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/orders',
        user: customer,
        payload: { ...orderPayload(), quantity: 5000 },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toMatch(/available/i);
    });

    it('creates a requirement and prices the material from the catalogue', async () => {
      const { status, body } = await request<{
        id: string;
        reference: string;
        materialPrice: number;
        status: OrderStatus;
      }>({
        method: 'POST',
        url: '/api/v1/orders',
        user: customer,
        payload: orderPayload(),
      });

      expect(status).toBe(201);
      expect(body.data.status).toBe(OrderStatus.REQUESTED);
      // 20 tonnes at ₹1,450 — computed from the catalogue, not the client.
      expect(body.data.materialPrice).toBe(29_000);
      expect(body.data.reference).toMatch(/^SO-\d{4}-\d{5}$/);
    });

    it('ranks available transport for a requirement with explainable scores', async () => {
      const { status, body } = await request<
        { registrationNumber: string; matchScore: number; reasons: string[] }[]
      >({
        method: 'POST',
        url: '/api/v1/orders/match',
        user: customer,
        payload: {
          originLatitude: ORIGIN.latitude,
          originLongitude: ORIGIN.longitude,
          destinationLatitude: DESTINATION.latitude,
          destinationLongitude: DESTINATION.longitude,
          requiredCapacityTons: 20,
        },
      });

      expect(status).toBe(200);
      expect(body.data.length).toBeGreaterThan(0);
      // Only the 25T truck can carry a 20T load; the 16T truck is excluded.
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.matchScore).toBeGreaterThan(0);
      expect(body.data[0]?.reasons.length).toBeGreaterThan(0);
    });
  });

  describe('quote and acceptance', () => {
    async function createOrder(): Promise<string> {
      const { body } = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/orders',
        user: customer,
        payload: orderPayload(),
      });
      return body.data.id;
    }

    it('shows the open requirement on the fleet marketplace', async () => {
      await createOrder();

      const { status, body } = await request<{ items: { hasQuoted: boolean }[] }>({
        method: 'GET',
        url: '/api/v1/orders/marketplace?radiusKm=500',
        user: owner,
      });

      expect(status).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.hasQuoted).toBe(false);
    });

    it('refuses a quote from a truck that is too small', async () => {
      const orderId = await createOrder();

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/quotes`,
        user: owner,
        payload: { truckId: helperTruckId, price: 15_000 },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toMatch(/capacity/i);
    });

    it('refuses a quote on the customer own requirement', async () => {
      const orderId = await createOrder();

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/quotes`,
        user: customer,
        payload: { truckId, price: 15_000 },
      });

      // The customer role does not hold orders.quote at all.
      expect(status).toBe(403);
    });

    it('accepts a quote, creates the trip and reserves the material', async () => {
      const orderId = await createOrder();

      const quote = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/quotes`,
        user: owner,
        payload: {
          truckId,
          driverId: driver.driverId,
          price: 16_500,
          message: 'Verified 25T tipper available today.',
        },
      });
      expect(quote.status).toBe(201);

      const accepted = await request<{ order: { status: OrderStatus }; tripId: string }>({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/accept-quote`,
        user: customer,
        payload: { quoteId: quote.body.data.id },
      });

      expect(accepted.status).toBe(200);
      expect(accepted.body.data.order.status).toBe(OrderStatus.ASSIGNED);
      expect(accepted.body.data.tripId).toBeTruthy();

      const trip = await prisma.trip.findUniqueOrThrow({
        where: { id: accepted.body.data.tripId },
      });
      expect(trip.status).toBe(TripStatus.ASSIGNED);
      expect(trip.truckId).toBe(truckId);
      expect(trip.driverId).toBe(driver.driverId);

      // Truck, driver and stock all move in step with the acceptance.
      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.status).toBe(TruckStatus.ASSIGNED);
      expect(truck.currentTripId).toBe(trip.id);

      const driverRecord = await prisma.driver.findUniqueOrThrow({
        where: { id: driver.driverId! },
      });
      expect(driverRecord.availability).toBe('ON_TRIP');

      const material = await prisma.material.findUniqueOrThrow({ where: { id: materialId } });
      expect(material.availableQuantity).toBe(480);
    });

    it('rejects the losing quotes when one is accepted', async () => {
      const orderId = await createOrder();
      const secondFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const secondOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: secondFleet.id,
      });
      const secondDriver = await createUser({
        role: RoleName.DRIVER,
        organizationId: secondFleet.id,
        driver: true,
      });
      const secondTruck = await prisma.truck.create({
        data: {
          organizationId: secondFleet.id,
          registrationNumber: unique('MH01X').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 28,
          verificationStatus: VerificationStatus.VERIFIED,
          status: TruckStatus.AVAILABLE,
          currentDriverId: secondDriver.driverId!,
          lastLatitude: ORIGIN.latitude,
          lastLongitude: ORIGIN.longitude,
          lastLocationAt: new Date(),
        },
      });

      const winning = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/quotes`,
        user: owner,
        payload: { truckId, driverId: driver.driverId, price: 16_500 },
      });
      await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/quotes`,
        user: secondOwner,
        payload: { truckId: secondTruck.id, driverId: secondDriver.driverId, price: 18_000 },
      });

      await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/accept-quote`,
        user: customer,
        payload: { quoteId: winning.body.data.id },
      });

      const quotes = await prisma.orderQuote.findMany({ where: { orderId } });
      expect(quotes.filter((quote) => quote.status === 'ACCEPTED')).toHaveLength(1);
      expect(quotes.filter((quote) => quote.status === 'REJECTED')).toHaveLength(1);
    });
  });

  describe('trip, tracking and simulation', () => {
    async function arrangeTrip(): Promise<{ orderId: string; tripId: string }> {
      const order = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/orders',
        user: customer,
        payload: orderPayload(),
      });
      const quote = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/orders/${order.body.data.id}/quotes`,
        user: owner,
        payload: { truckId, driverId: driver.driverId, price: 16_500 },
      });
      const accepted = await request<{ tripId: string }>({
        method: 'POST',
        url: `/api/v1/orders/${order.body.data.id}/accept-quote`,
        user: customer,
        payload: { quoteId: quote.body.data.id },
      });
      return { orderId: order.body.data.id, tripId: accepted.body.data.tripId };
    }

    it('rejects an invalid trip state transition', async () => {
      const { tripId } = await arrangeTrip();

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/complete`,
        user: owner,
      });

      // ASSIGNED → COMPLETED is not a legal move.
      expect(status).toBe(409);
      expect(body.error?.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('lets the assigned driver start their own trip', async () => {
      const { tripId } = await arrangeTrip();

      const { status, body } = await request<{ status: TripStatus }>({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/start`,
        user: driver,
      });

      expect(status).toBe(200);
      expect(body.data.status).toBe(TripStatus.STARTED);

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.status).toBe(TruckStatus.ON_TRIP);

      const order = await prisma.order.findFirstOrThrow({ where: { tripId } });
      expect(order.status).toBe(OrderStatus.IN_TRANSIT);
    });

    it('does not let another fleet driver touch the trip', async () => {
      const { tripId } = await arrangeTrip();
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const outsider = await createUser({
        role: RoleName.DRIVER,
        organizationId: otherFleet.id,
        driver: true,
      });

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/start`,
        user: outsider,
      });
      expect(status).toBe(404);
    });

    it('ingests a location, updates progress and computes an ETA', async () => {
      const { tripId } = await arrangeTrip();
      await request({ method: 'POST', url: `/api/v1/trips/${tripId}/start`, user: driver });

      const { status, body } = await request<{
        accepted: boolean;
        progressPercent: number;
        etaAt: string | null;
      }>({
        method: 'POST',
        url: '/api/v1/tracking/locations',
        user: driver,
        payload: {
          truckId,
          // Roughly a third of the way down the corridor.
          latitude: 27.8974,
          longitude: 76.6066,
          speedKph: 58,
          heading: 220,
        },
      });

      expect(status).toBe(201);
      expect(body.data.accepted).toBe(true);
      expect(body.data.progressPercent).toBeGreaterThan(0);
      expect(body.data.etaAt).toBeTruthy();

      const stored = await prisma.truckLocation.findMany({ where: { truckId } });
      expect(stored.length).toBeGreaterThan(0);

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.lastSpeedKph).toBe(58);
    });

    it('raises a speed violation and deducts from the driver safety score', async () => {
      const { tripId } = await arrangeTrip();
      await request({ method: 'POST', url: `/api/v1/trips/${tripId}/start`, user: driver });

      await request({
        method: 'POST',
        url: '/api/v1/tracking/locations',
        user: driver,
        payload: { truckId, latitude: 28.2076, longitude: 76.8548, speedKph: 105, heading: 220 },
      });

      const events = await prisma.driverScoreEvent.findMany({
        where: { driverId: driver.driverId!, eventType: 'SPEED_VIOLATION' },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.points).toBeLessThan(0);
      expect(events[0]?.reason).toMatch(/exceeded/i);
    });

    it('detects a route deviation', async () => {
      const { tripId } = await arrangeTrip();
      await request({ method: 'POST', url: `/api/v1/trips/${tripId}/start`, user: driver });

      // Far off the Delhi-Jaipur corridor.
      const { body } = await request<{ events: string[] }>({
        method: 'POST',
        url: '/api/v1/tracking/locations',
        user: driver,
        payload: { truckId, latitude: 28.9, longitude: 78.5, speedKph: 45, heading: 90 },
      });

      expect(body.data.events).toContain('ROUTE_DEVIATION');
    });

    it('drives the truck with the GPS simulator through the tracking pipeline', async () => {
      const { tripId } = await arrangeTrip();

      const started = await request<{ id: string; status: string; routeDistanceKm: number }>({
        method: 'POST',
        url: '/api/v1/simulation',
        user: owner,
        payload: { truckId, tripId, baseSpeedKph: 60, speedMultiplier: 100 },
      });

      expect(started.status).toBe(201);
      expect(started.body.data.status).toBe('RUNNING');
      expect(started.body.data.routeDistanceKm).toBeGreaterThan(0);

      // Starting the simulator also starts the trip, as a driver tap would.
      const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
      expect(trip.status).toBe(TripStatus.STARTED);

      const before = await prisma.truckLocation.count({ where: { truckId } });
      await runSimulationTick();
      await runSimulationTick();
      const after = await prisma.truckLocation.count({ where: { truckId } });

      expect(after).toBeGreaterThan(before);

      // The simulated points are flagged so they can never be mistaken for real GPS.
      const sample = await prisma.truckLocation.findFirst({
        where: { truckId },
        orderBy: { recordedAt: 'desc' },
      });
      expect(sample?.simulated).toBe(true);
      expect(sample?.source).toBe('MOCK');

      const updated = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(updated.lastLatitude).not.toBe(ORIGIN.latitude);
    });

    it('pauses and resumes a simulation', async () => {
      const { tripId } = await arrangeTrip();
      const started = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/simulation',
        user: owner,
        payload: { truckId, tripId },
      });
      const simulationId = started.body.data.id;

      const paused = await request<{ status: string }>({
        method: 'POST',
        url: `/api/v1/simulation/${simulationId}/control`,
        user: owner,
        payload: { action: 'PAUSE' },
      });
      expect(paused.body.data.status).toBe('PAUSED');

      const before = await prisma.truckLocation.count({ where: { truckId } });
      await runSimulationTick();
      expect(await prisma.truckLocation.count({ where: { truckId } })).toBe(before);

      const resumed = await request<{ status: string }>({
        method: 'POST',
        url: `/api/v1/simulation/${simulationId}/control`,
        user: owner,
        payload: { action: 'RESUME' },
      });
      expect(resumed.body.data.status).toBe('RUNNING');
    });

    it('completes the trip, closes the order and updates the driver score', async () => {
      const { orderId, tripId } = await arrangeTrip();

      await request({ method: 'POST', url: `/api/v1/trips/${tripId}/start`, user: driver });
      await request({
        method: 'POST',
        url: '/api/v1/tracking/locations',
        user: driver,
        payload: { truckId, latitude: 27.5673, longitude: 76.2401, speedKph: 55, heading: 220 },
      });
      await request({ method: 'POST', url: `/api/v1/trips/${tripId}/arrive`, user: driver });

      const completed = await request<{ status: TripStatus }>({
        method: 'POST',
        url: `/api/v1/trips/${tripId}/complete`,
        user: driver,
      });
      expect(completed.status).toBe(200);
      expect(completed.body.data.status).toBe(TripStatus.COMPLETED);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(OrderStatus.DELIVERED);

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.status).toBe(TruckStatus.AVAILABLE);
      expect(truck.currentTripId).toBeNull();

      const driverRecord = await prisma.driver.findUniqueOrThrow({
        where: { id: driver.driverId! },
      });
      expect(driverRecord.availability).toBe('AVAILABLE');
      expect(driverRecord.totalTrips).toBe(1);
      expect(driverRecord.overallScore).not.toBeNull();

      // Completing the trip recorded an explainable timeliness event.
      const scoreEvents = await prisma.driverScoreEvent.findMany({
        where: {
          driverId: driver.driverId!,
          sourceId: tripId,
          eventType: { in: ['TRIP_COMPLETED_ON_TIME', 'TRIP_COMPLETED_LATE'] },
        },
      });
      expect(scoreEvents).toHaveLength(1);
      expect(scoreEvents[0]?.reason).toContain('Trip');
      expect(scoreEvents[0]?.category).toBe('TIMELINESS');

      // And the customer can now rate it.
      const rated = await request({
        method: 'POST',
        url: `/api/v1/orders/${orderId}/rate`,
        user: customer,
        payload: { rating: 5, punctuality: 5, comment: 'Delivered on time.' },
      });
      expect(rated.status).toBe(200);
    });
  });

  describe('SOS network', () => {
    it('raises an incident, matches nearby trucks and notifies them', async () => {
      const { status, body } = await request<{
        id: string;
        status: SosStatus;
        responderCount: number;
      }>({
        method: 'POST',
        url: '/api/v1/sos',
        user: driver,
        payload: {
          type: 'TYRE',
          latitude: ORIGIN.latitude,
          longitude: ORIGIN.longitude,
          description: 'Rear left tyre blowout, parked on the shoulder.',
        },
      });

      expect(status).toBe(201);
      expect(body.data.status).toBe(SosStatus.BROADCASTING);
      // The nearby helper truck was found and notified.
      expect(body.data.responderCount).toBeGreaterThan(0);

      const responders = await prisma.sosResponder.findMany({
        where: { incidentId: body.data.id },
      });
      expect(responders.some((responder) => responder.driverId === helperDriver.driverId)).toBe(
        true,
      );
      // The truck in trouble is never asked to rescue itself.
      expect(responders.some((responder) => responder.truckId === truckId)).toBe(false);

      const notifications = await prisma.notification.findMany({
        where: { userId: helperDriver.id, type: 'SOS_RESPONDER_REQUEST' },
      });
      expect(notifications.length).toBeGreaterThan(0);

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.status).toBe(TruckStatus.EMERGENCY);
    });

    it('lets a responder acknowledge, arrive and complete assistance', async () => {
      const incident = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/sos',
        user: driver,
        payload: { type: 'BREAKDOWN', latitude: ORIGIN.latitude, longitude: ORIGIN.longitude },
      });
      const incidentId = incident.body.data.id;

      const acknowledged = await request<{ status: SosStatus }>({
        method: 'POST',
        url: `/api/v1/sos/${incidentId}/respond`,
        user: helperDriver,
        payload: { action: 'ACKNOWLEDGE', note: 'On my way, 10 minutes.' },
      });
      expect(acknowledged.status).toBe(200);
      expect(acknowledged.body.data.status).toBe(SosStatus.ACKNOWLEDGED);

      const arrived = await request<{ status: SosStatus }>({
        method: 'POST',
        url: `/api/v1/sos/${incidentId}/respond`,
        user: helperDriver,
        payload: { action: 'ARRIVED' },
      });
      expect(arrived.body.data.status).toBe(SosStatus.ASSISTANCE_ARRIVED);

      await request({
        method: 'POST',
        url: `/api/v1/sos/${incidentId}/respond`,
        user: helperDriver,
        payload: { action: 'COMPLETE' },
      });

      // Helping another driver is a positive safety signal.
      const scoreEvent = await prisma.driverScoreEvent.findFirst({
        where: { driverId: helperDriver.driverId!, eventType: 'SOS_ASSISTANCE_PROVIDED' },
      });
      expect(scoreEvent).not.toBeNull();
      expect(scoreEvent?.points).toBeGreaterThan(0);

      const resolved = await request<{ status: SosStatus }>({
        method: 'POST',
        url: `/api/v1/sos/${incidentId}/resolve`,
        user: owner,
        payload: { resolutionNote: 'Spare fitted, vehicle back in service.' },
      });
      expect(resolved.body.data.status).toBe(SosStatus.RESOLVED);

      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.status).not.toBe(TruckStatus.EMERGENCY);
    });

    it('hides an incident from an unrelated organization', async () => {
      const incident = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/sos',
        user: driver,
        payload: { type: 'MEDICAL', latitude: ORIGIN.latitude, longitude: ORIGIN.longitude },
      });

      const outsiderOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const outsider = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: outsiderOrg.id,
      });

      const { status } = await request({
        method: 'GET',
        url: `/api/v1/sos/${incident.body.data.id}`,
        user: outsider,
      });
      expect(status).toBe(404);
    });
  });

  describe('analytics', () => {
    it('reports metrics computed from real records', async () => {
      const { status, body } = await request<{
        fleet: { totalTrucks: number; utilizationPercent: number };
        drivers: { total: number };
      }>({
        method: 'GET',
        url: '/api/v1/analytics/dashboard',
        user: owner,
      });

      expect(status).toBe(200);
      expect(body.data.fleet.totalTrucks).toBe(2);
      expect(body.data.drivers.total).toBe(2);
    });

    it('builds a truck passport from stored history', async () => {
      const { status, body } = await request<{
        truck: { registrationNumber: string };
        lifetime: { completedTrips: number };
      }>({
        method: 'GET',
        url: `/api/v1/analytics/trucks/${truckId}/passport`,
        user: owner,
      });

      expect(status).toBe(200);
      expect(body.data.truck.registrationNumber).toBeTruthy();
      expect(body.data.lifetime.completedTrips).toBe(0);
    });
  });

  describe('AI copilot', () => {
    it('answers from authorised data and cites its sources', async () => {
      const { status, body } = await request<{
        answer: string;
        references: { type: string }[];
        contextSummary: { factCount: number };
      }>({
        method: 'POST',
        url: '/api/v1/ai/chat',
        user: owner,
        payload: { message: 'Which trucks are idle right now?' },
      });

      expect(status).toBe(200);
      expect(body.data.answer.length).toBeGreaterThan(0);
      expect(body.data.contextSummary.factCount).toBeGreaterThan(0);
      // The answer is grounded in the caller's own trucks.
      expect(body.data.references.some((reference) => reference.type === 'truck')).toBe(true);
    });

    it('is unavailable on a plan that does not include it', async () => {
      const basicFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
      const basicOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: basicFleet.id,
      });

      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/ai/chat',
        user: basicOwner,
        payload: { message: 'What needs my attention today?' },
      });

      expect(status).toBe(403);
      expect(body.error?.code).toBe('FEATURE_NOT_AVAILABLE');
    });
  });

  describe('nearby services', () => {
    it('finds seeded POIs ranked by distance', async () => {
      await prisma.nearbyPlace.createMany({
        data: [
          {
            category: 'FUEL',
            name: 'Indian Oil Highway Fuel Station',
            latitude: ORIGIN.latitude + 0.01,
            longitude: ORIGIN.longitude + 0.01,
            open24Hours: true,
            source: 'test',
          },
          {
            category: 'FOOD',
            name: 'Sharma Ji Da Dhaba',
            latitude: ORIGIN.latitude + 0.05,
            longitude: ORIGIN.longitude + 0.05,
            open24Hours: true,
            source: 'test',
          },
          {
            category: 'FUEL',
            name: 'Far Away Pump',
            latitude: ORIGIN.latitude + 3,
            longitude: ORIGIN.longitude + 3,
            source: 'test',
          },
        ],
      });

      const { status, body } = await request<
        { name: string; distanceKm: number; direction: string }[]
      >({
        method: 'GET',
        url: `/api/v1/nearby/places?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=25`,
        user: driver,
      });

      expect(status).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.distanceKm).toBeLessThan(body.data[1]!.distanceKm);
      expect(body.data[0]?.direction).toBeTruthy();
    });

    it('masks another fleet truck details in nearby discovery', async () => {
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const otherDriver = await createUser({
        role: RoleName.DRIVER,
        organizationId: otherFleet.id,
        driver: true,
      });
      await prisma.truck.create({
        data: {
          organizationId: otherFleet.id,
          registrationNumber: 'MH99XY1234',
          truckType: TruckType.TIPPER,
          capacityTons: 20,
          verificationStatus: VerificationStatus.VERIFIED,
          status: TruckStatus.AVAILABLE,
          currentDriverId: otherDriver.driverId!,
          lastLatitude: ORIGIN.latitude + 0.01,
          lastLongitude: ORIGIN.longitude + 0.01,
          lastLocationAt: new Date(),
          shareLocation: true,
        },
      });

      const { body } = await request<
        { registrationNumber: string; sameFleet: boolean; driverName: string | null; contactPhone: string | null }[]
      >({
        method: 'GET',
        url: `/api/v1/nearby/trucks?latitude=${ORIGIN.latitude}&longitude=${ORIGIN.longitude}&radiusKm=50`,
        user: driver,
      });

      const foreign = body.data.find((entry) => !entry.sameFleet);
      expect(foreign).toBeDefined();
      // Another fleet's plate is partially masked and its driver stays private.
      expect(foreign?.registrationNumber).toContain('••');
      expect(foreign?.driverName).toBeNull();
      expect(foreign?.contactPhone).toBeNull();

      const own = body.data.find((entry) => entry.sameFleet);
      expect(own?.driverName).toBeTruthy();
    });
  });
});
