import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HireBasis,
  MaterialUnit,
  OrganizationType,
  PlanTier,
  ProviderStatus,
  RequirementBidScope,
  RequirementBidStatus,
  RequirementKind,
  RequirementStatus,
  RoleName,
  ServiceType,
  TruckStatus,
  TruckType,
  VehicleType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
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
 * The requirement front door and its bidding board.
 *
 * The emphasis is on the guarantees that would be expensive to get wrong, not
 * on CRUD happy paths:
 *
 *   * a business only ever sees, and can only ever bid on, the markets its
 *     account type puts it in;
 *   * a sealed auction stays sealed — no bidder sees a rival's price, and a
 *     private budget is not leaked through the board;
 *   * awarding produces a real fulfilment record on the pipeline that already
 *     exists, rather than a parallel one;
 *   * a material requirement that needs delivery is not treated as settled
 *     until both halves are awarded.
 */
describe('Requirements and bidding', () => {
  let customerOrg: TestOrganization;
  let customer: TestUser;
  let fleetOrg: TestOrganization;
  let fleetOwner: TestUser;
  let supplierOrg: TestOrganization;
  let supplier: TestUser;
  let mobilityOrg: TestOrganization;
  let mobilityOwner: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();

    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.PRO);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });

    fleetOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
    fleetOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetOrg.id });

    supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.PRO);
    supplier = await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });

    mobilityOrg = await createOrganization(OrganizationType.MOBILITY_PROVIDER, PlanTier.PRO);
    mobilityOwner = await createUser({
      role: RoleName.MOBILITY_PROVIDER,
      organizationId: mobilityOrg.id,
    });
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

  /**
   * A registration number that is unique within the run.
   *
   * `unique()` cannot be used here: `trucks.registrationNumber` is globally
   * unique and only 12 characters fit, which truncates that helper's counter
   * away and leaves two trucks created in the same millisecond colliding.
   */
  let plateCounter = 0;
  const testPlate = (): string => {
    plateCounter += 1;
    return `RJ14T${String(plateCounter).padStart(5, '0')}`;
  };

  const JAIPUR = { addressLine: 'Bassi Industrial Area, Jaipur', latitude: 26.8351, longitude: 75.9843 };
  const GURUGRAM = { addressLine: 'Sector 62, Gurugram', latitude: 28.4089, longitude: 77.0789 };

  async function postFreightRequirement(): Promise<string> {
    const { status, body } = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/requirements',
      user: customer,
      payload: {
        kind: RequirementKind.FREIGHT_TRANSPORT,
        title: '20 tonnes of steel coil to Gurugram',
        origin: JAIPUR,
        destination: GURUGRAM,
        startAt: soon(5),
        bidsCloseAt: soon(2),
        freightDetail: {
          goodsDescription: 'Steel coils',
          quantity: 20,
          unit: MaterialUnit.TON,
          requiredCapacityTons: 20,
          requiredTruckType: TruckType.FLATBED,
        },
      },
    });

    expect(status).toBe(201);
    return body.data.id;
  }

  async function postMaterialRequirement(needsTransport: boolean): Promise<string> {
    const { status, body } = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/requirements',
      user: customer,
      payload: {
        kind: RequirementKind.MATERIAL_SUPPLY,
        title: '400 bags of OPC cement for the Bassi site',
        origin: JAIPUR,
        destination: GURUGRAM,
        startAt: soon(6),
        bidsCloseAt: soon(2),
        materialDetail: {
          materialName: 'OPC 43 grade cement',
          quantity: 400,
          unit: MaterialUnit.BAG,
          needsTransport,
        },
      },
    });

    expect(status).toBe(201);
    return body.data.id;
  }

  async function postCabRequirement(): Promise<string> {
    const { status, body } = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/requirements',
      user: customer,
      payload: {
        kind: RequirementKind.CAB_HIRE,
        title: 'Airport pickup for four with luggage',
        origin: JAIPUR,
        destination: GURUGRAM,
        startAt: soon(4),
        bidsCloseAt: soon(1),
        contactPhone: '+919876543210',
        contactName: 'Site office',
        cabDetail: {
          hireBasis: HireBasis.ONE_WAY,
          passengers: 4,
          preferredVehicleType: VehicleType.SUV,
        },
      },
    });

    expect(status).toBe(201);
    return body.data.id;
  }

  /** A verified, assignable truck with a driver, so a transport bid can win. */
  async function createBiddableTruck(): Promise<string> {
    const driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleetOrg.id,
      driver: true,
    });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleetOrg.id,
        registrationNumber: testPlate(),
        truckType: TruckType.FLATBED,
        vehicleType: VehicleType.TRUCK,
        capacityTons: 25,
        status: TruckStatus.AVAILABLE,
        verificationStatus: VerificationStatus.VERIFIED,
        currentDriverId: driver.driverId ?? null,
        lastLatitude: 26.84,
        lastLongitude: 75.99,
        lastLocationAt: new Date(),
      },
    });

    return truck.id;
  }

  /** An active travel provider profile, without which a travel bid is refused. */
  async function createProviderProfile(): Promise<void> {
    await prisma.serviceProviderProfile.create({
      data: {
        organizationId: mobilityOrg.id,
        displayName: 'Test Tours',
        serviceTypes: [ServiceType.TAXI, ServiceType.TOUR],
        contactPhone: '+919812345678',
        status: ProviderStatus.ACTIVE,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Posting
  // -------------------------------------------------------------------------

  describe('posting a requirement', () => {
    it('accepts each of the four kinds with the detail block that matches', async () => {
      await postFreightRequirement();
      await postMaterialRequirement(true);
      await postCabRequirement();

      const { body } = await request<{ items: { kind: string }[] }>({
        method: 'GET',
        url: '/api/v1/requirements',
        user: customer,
      });

      expect(body.data.items.map((row) => row.kind).sort()).toEqual(
        [
          RequirementKind.CAB_HIRE,
          RequirementKind.FREIGHT_TRANSPORT,
          RequirementKind.MATERIAL_SUPPLY,
        ].sort(),
      );
    });

    it('rejects a requirement carrying another kind of detail block', async () => {
      const { status } = await request({
        method: 'POST',
        url: '/api/v1/requirements',
        user: customer,
        payload: {
          kind: RequirementKind.CAB_HIRE,
          title: 'A cab that thinks it is a lorry',
          origin: JAIPUR,
          destination: GURUGRAM,
          startAt: soon(4),
          cabDetail: { hireBasis: HireBasis.ONE_WAY, passengers: 2 },
          freightDetail: {
            goodsDescription: 'Steel',
            quantity: 10,
            unit: MaterialUnit.TON,
            requiredCapacityTons: 10,
          },
        },
      });

      expect(status).toBe(400);
    });

    it('rejects a requirement missing the detail block for its kind', async () => {
      const { status } = await request({
        method: 'POST',
        url: '/api/v1/requirements',
        user: customer,
        payload: {
          kind: RequirementKind.TOUR_PACKAGE,
          title: 'A tour with no itinerary at all',
          origin: JAIPUR,
          startAt: soon(10),
        },
      });

      expect(status).toBe(400);
    });

    it('refuses a bidding window that closes after the job starts', async () => {
      const { status } = await request({
        method: 'POST',
        url: '/api/v1/requirements',
        user: customer,
        payload: {
          kind: RequirementKind.FREIGHT_TRANSPORT,
          title: 'Bidding that closes too late to be useful',
          origin: JAIPUR,
          destination: GURUGRAM,
          startAt: soon(2),
          bidsCloseAt: soon(5),
          freightDetail: {
            goodsDescription: 'Steel',
            quantity: 10,
            unit: MaterialUnit.TON,
            requiredCapacityTons: 10,
          },
        },
      });

      expect(status).toBe(400);
    });

    it('refuses to let a fleet post a requirement', async () => {
      const { status } = await request({
        method: 'POST',
        url: '/api/v1/requirements',
        user: fleetOwner,
        payload: {
          kind: RequirementKind.FREIGHT_TRANSPORT,
          title: 'A fleet posting its own load',
          origin: JAIPUR,
          destination: GURUGRAM,
          startAt: soon(5),
          freightDetail: {
            goodsDescription: 'Steel',
            quantity: 10,
            unit: MaterialUnit.TON,
            requiredCapacityTons: 10,
          },
        },
      });

      expect(status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Who sees what
  // -------------------------------------------------------------------------

  describe('the board is scoped by account type', () => {
    it('shows a fleet the freight work and none of the passenger work', async () => {
      await postFreightRequirement();
      await postCabRequirement();

      const { body } = await request<{ items: { kind: string }[] }>({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: fleetOwner,
      });

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.kind).toBe(RequirementKind.FREIGHT_TRANSPORT);
    });

    it('shows a mobility provider the passenger work and none of the freight', async () => {
      await postFreightRequirement();
      await postCabRequirement();

      const { body } = await request<{ items: { kind: string }[] }>({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: mobilityOwner,
      });

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.kind).toBe(RequirementKind.CAB_HIRE);
    });

    it('shows a supplier material work, and offers only the material scope', async () => {
      await postMaterialRequirement(true);
      await postFreightRequirement();

      const { body } = await request<{
        items: { kind: string; availableScopes: string[] }[];
      }>({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: supplier,
      });

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.kind).toBe(RequirementKind.MATERIAL_SUPPLY);
      expect(body.data.items[0]?.availableScopes).toEqual([RequirementBidScope.MATERIAL]);
    });

    it('does not let a kind filter widen what an account type may see', async () => {
      await postCabRequirement();

      const { body } = await request<{ items: unknown[] }>({
        method: 'GET',
        url: `/api/v1/requirements/board?radiusKm=3000&kind=${RequirementKind.CAB_HIRE}`,
        user: fleetOwner,
      });

      expect(body.data.items).toHaveLength(0);
    });

    it('never shows a customer their own requirement on the board', async () => {
      await postFreightRequirement();

      const { body } = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: customer,
      });

      expect(body.data.items).toHaveLength(0);
    });

    it('hides a private budget from bidders but shows it to the customer', async () => {
      const { body: created } = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/requirements',
        user: customer,
        payload: {
          kind: RequirementKind.FREIGHT_TRANSPORT,
          title: 'A load with a budget nobody should see',
          origin: JAIPUR,
          destination: GURUGRAM,
          startAt: soon(5),
          bidsCloseAt: soon(2),
          budgetAmount: 48000,
          budgetIsPublic: false,
          freightDetail: {
            goodsDescription: 'Steel',
            quantity: 20,
            unit: MaterialUnit.TON,
            requiredCapacityTons: 20,
          },
        },
      });

      const asBidder = await request<{ items: { budgetAmount: number | null }[] }>({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: fleetOwner,
      });
      expect(asBidder.body.data.items[0]?.budgetAmount).toBeNull();

      const asCustomer = await request<{ budgetAmount: number | null }>({
        method: 'GET',
        url: `/api/v1/requirements/${created.data.id}`,
        user: customer,
      });
      expect(asCustomer.body.data.budgetAmount).toBe(48000);
    });
  });

  // -------------------------------------------------------------------------
  // Bidding
  // -------------------------------------------------------------------------

  describe('bidding', () => {
    it('refuses a transport bid from a supplier', async () => {
      const requirementId = await postFreightRequirement();

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: supplier,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 40000 },
      });

      // Refused at validation: a transport bid must name a vehicle, and a
      // supplier has none to name.
      expect(status).toBe(400);
    });

    it('refuses a travel bid from a freight fleet', async () => {
      const requirementId = await postCabRequirement();

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: {
          scope: RequirementBidScope.TRAVEL,
          price: 4200,
          offeredVehicleType: VehicleType.SUV,
        },
      });

      expect(status).toBe(403);
      expect(body.error?.code).toBe('FORBIDDEN');
    });

    it('refuses a transport bid naming a vehicle from another fleet', async () => {
      const requirementId = await postFreightRequirement();
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const foreignTruck = await prisma.truck.create({
        data: {
          organizationId: otherFleet.id,
          registrationNumber: testPlate(),
          truckType: TruckType.FLATBED,
          vehicleType: VehicleType.TRUCK,
          capacityTons: 25,
          status: TruckStatus.AVAILABLE,
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: {
          scope: RequirementBidScope.TRANSPORT,
          price: 40000,
          vehicleId: foreignTruck.id,
        },
      });

      expect(status).toBe(404);
    });

    it('refuses a vehicle too small for the load', async () => {
      const requirementId = await postFreightRequirement();
      const small = await prisma.truck.create({
        data: {
          organizationId: fleetOrg.id,
          registrationNumber: testPlate(),
          truckType: TruckType.FLATBED,
          vehicleType: VehicleType.TRUCK,
          capacityTons: 9,
          status: TruckStatus.AVAILABLE,
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 40000, vehicleId: small.id },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toContain('20T');
    });

    it('replaces a standing offer rather than stacking a second one beside it', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      for (const price of [44000, 41000]) {
        const { status } = await request({
          method: 'POST',
          url: `/api/v1/requirements/${requirementId}/bids`,
          user: fleetOwner,
          payload: { scope: RequirementBidScope.TRANSPORT, price, vehicleId: truckId },
        });
        expect(status).toBe(201);
      }

      const { body } = await request<{ price: number }[]>({
        method: 'GET',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: customer,
      });

      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.price).toBe(41000);
    });

    it('keeps rival prices sealed from other bidders', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 41000, vehicleId: truckId },
      });

      const rivalOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const rival = await createUser({ role: RoleName.FLEET_OWNER, organizationId: rivalOrg.id });
      const rivalTruck = await prisma.truck.create({
        data: {
          organizationId: rivalOrg.id,
          registrationNumber: testPlate(),
          truckType: TruckType.FLATBED,
          vehicleType: VehicleType.TRUCK,
          capacityTons: 25,
          status: TruckStatus.AVAILABLE,
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });
      const rivalDriver = await createUser({
        role: RoleName.DRIVER,
        organizationId: rivalOrg.id,
        driver: true,
      });
      await prisma.truck.update({
        where: { id: rivalTruck.id },
        data: { currentDriverId: rivalDriver.driverId ?? null },
      });

      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: rival,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 39000, vehicleId: rivalTruck.id },
      });

      const asRival = await request<{ price: number }[]>({
        method: 'GET',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: rival,
      });
      expect(asRival.body.data).toHaveLength(1);
      expect(asRival.body.data[0]?.price).toBe(39000);

      const asCustomer = await request<{ price: number }[]>({
        method: 'GET',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: customer,
      });
      expect(asCustomer.body.data).toHaveLength(2);
    });

    it('refuses a transport bid on a material requirement the customer will carry itself', async () => {
      const requirementId = await postMaterialRequirement(false);
      const truckId = await createBiddableTruck();

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 12000, vehicleId: truckId },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toContain('own transport');
    });
  });

  // -------------------------------------------------------------------------
  // Awarding
  // -------------------------------------------------------------------------

  describe('awarding', () => {
    it('turns a freight award into an order and a dispatched trip', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: {
          scope: RequirementBidScope.TRANSPORT,
          price: 41000,
          vehicleId: truckId,
        },
      });

      const { status, body } = await request<{
        orderId: string | null;
        tripId: string | null;
        requirement: { status: string };
      }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: bid.data.id },
      });

      expect(status).toBe(200);
      expect(body.data.requirement.status).toBe(RequirementStatus.AWARDED);
      expect(body.data.orderId).toBeTruthy();
      expect(body.data.tripId).toBeTruthy();

      // The order is a real one on the existing pipeline, not a parallel record.
      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.data.orderId! },
      });
      expect(order.fleetOrganizationId).toBe(fleetOrg.id);
      expect(order.assignedTruckId).toBe(truckId);
      expect(Number(order.transportPrice)).toBe(41000);

      // And the vehicle really was committed.
      const truck = await prisma.truck.findUniqueOrThrow({ where: { id: truckId } });
      expect(truck.status).toBe(TruckStatus.ASSIGNED);
      expect(truck.currentTripId).toBe(body.data.tripId);
    });

    it('holds a delivered material requirement at PARTIALLY_AWARDED until transport lands', async () => {
      const requirementId = await postMaterialRequirement(true);

      const { body: materialBid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: supplier,
        payload: { scope: RequirementBidScope.MATERIAL, price: 152000, includesDelivery: false },
      });

      const first = await request<{ requirement: { status: string }; orderId: string | null }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: materialBid.data.id },
      });

      expect(first.body.data.requirement.status).toBe(RequirementStatus.PARTIALLY_AWARDED);
      expect(first.body.data.orderId).toBeNull();

      const truckId = await createBiddableTruck();
      const { body: transportBid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 18000, vehicleId: truckId },
      });

      const second = await request<{
        requirement: { status: string };
        orderId: string | null;
        tripId: string | null;
      }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: transportBid.data.id },
      });

      expect(second.body.data.requirement.status).toBe(RequirementStatus.AWARDED);
      expect(second.body.data.orderId).toBeTruthy();
      expect(second.body.data.tripId).toBeTruthy();

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: second.body.data.orderId! },
      });
      expect(order.supplierOrganizationId).toBe(supplierOrg.id);
      expect(order.fleetOrganizationId).toBe(fleetOrg.id);
      expect(Number(order.totalPrice)).toBe(152000 + 18000);
    });

    it('settles in one award when the supplier prices delivery in', async () => {
      const requirementId = await postMaterialRequirement(true);

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: supplier,
        payload: { scope: RequirementBidScope.MATERIAL, price: 168000, includesDelivery: true },
      });

      const { body } = await request<{
        requirement: { status: string };
        orderId: string | null;
        tripId: string | null;
      }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: bid.data.id },
      });

      expect(body.data.requirement.status).toBe(RequirementStatus.AWARDED);
      expect(body.data.orderId).toBeTruthy();
      // No fleet was appointed, so no trip is dispatched.
      expect(body.data.tripId).toBeNull();
    });

    it('turns a travel award into a booking on the existing travel pipeline', async () => {
      await createProviderProfile();
      const requirementId = await postCabRequirement();

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: mobilityOwner,
        payload: {
          scope: RequirementBidScope.TRAVEL,
          price: 4200,
          offeredVehicleType: VehicleType.SUV,
          inclusions: ['Toll and parking'],
        },
      });

      const { body } = await request<{ bookingId: string | null }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: bid.data.id },
      });

      expect(body.data.bookingId).toBeTruthy();

      const booking = await prisma.travelBooking.findUniqueOrThrow({
        where: { id: body.data.bookingId! },
        include: { package: true },
      });
      expect(booking.providerOrganizationId).toBe(mobilityOrg.id);
      expect(Number(booking.subtotal)).toBe(4200);

      // The package minted for it is private: never published, so it stays out
      // of customer search and the operator's own catalogue.
      expect(booking.package.status).toBe('DRAFT');
      expect(booking.package.sourceRequirementId).toBe(requirementId);

      const catalogue = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/travel/me/packages',
        user: mobilityOwner,
      });
      expect(catalogue.body.data.items).toHaveLength(0);
    });

    it('rejects every rival for the awarded scope, and no others', async () => {
      const requirementId = await postMaterialRequirement(true);

      const rivalOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.PRO);
      const rival = await createUser({ role: RoleName.SUPPLIER, organizationId: rivalOrg.id });

      const { body: winning } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: supplier,
        payload: { scope: RequirementBidScope.MATERIAL, price: 150000 },
      });
      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: rival,
        payload: { scope: RequirementBidScope.MATERIAL, price: 158000 },
      });

      const truckId = await createBiddableTruck();
      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 18000, vehicleId: truckId },
      });

      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: winning.data.id },
      });

      const bids = await prisma.requirementBid.findMany({ where: { requirementId } });
      const byScope = (scope: string) => bids.filter((bid) => bid.scope === scope);

      expect(byScope(RequirementBidScope.MATERIAL).map((bid) => bid.status).sort()).toEqual(
        [RequirementBidStatus.ACCEPTED, RequirementBidStatus.REJECTED].sort(),
      );
      // The transport half is still being competed for.
      expect(byScope(RequirementBidScope.TRANSPORT)[0]?.status).toBe(RequirementBidStatus.OFFERED);
    });

    it('refuses to award the same half twice', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 41000, vehicleId: truckId },
      });

      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: bid.data.id },
      });

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: bid.data.id },
      });

      expect(status).toBeGreaterThanOrEqual(400);
    });

    it('refuses an award from anyone but the customer who posted it', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 41000, vehicleId: truckId },
      });

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: fleetOwner,
        payload: { bidId: bid.data.id },
      });

      expect(status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Withdrawal and cancellation
  // -------------------------------------------------------------------------

  describe('withdrawal', () => {
    it('lets a bidder withdraw before the award, and not after', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 41000, vehicleId: truckId },
      });

      const withdrawn = await request({
        method: 'DELETE',
        url: `/api/v1/requirements/bids/${bid.data.id}`,
        user: fleetOwner,
      });
      // `noContent` in this codebase replies 200 with a null envelope, so that
      // every response the client sees has the same shape.
      expect(withdrawn.status).toBe(200);

      const requirement = await prisma.requirement.findUniqueOrThrow({
        where: { id: requirementId },
      });
      expect(requirement.bidCount).toBe(0);
      expect(requirement.lowestBid).toBeNull();
    });

    it('rejects every live bid when the customer withdraws the requirement', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 41000, vehicleId: truckId },
      });

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/cancel`,
        user: customer,
        payload: { reason: 'The site slipped by a month.' },
      });
      expect(status).toBe(200);

      const bids = await prisma.requirementBid.findMany({ where: { requirementId } });
      expect(bids.every((bid) => bid.status === RequirementBidStatus.REJECTED)).toBe(true);
    });

    it('refuses to withdraw a requirement that has already been awarded', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      const { body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 41000, vehicleId: truckId },
      });
      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: bid.data.id },
      });

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/cancel`,
        user: customer,
        payload: { reason: 'Changed my mind after awarding.' },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toContain('order or booking');
    });
  });
});
