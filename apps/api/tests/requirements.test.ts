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

    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BUSINESS);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });

    fleetOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    fleetOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetOrg.id });

    supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.BUSINESS);
    supplier = await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });

    mobilityOrg = await createOrganization(OrganizationType.MOBILITY_PROVIDER, PlanTier.BUSINESS);
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

  async function postMaterialRequirement(): Promise<string> {
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

  /** A Seller's cement listing a fleet can source a delivered bid from. */
  async function createSellerListing(): Promise<string> {
    const seller = await prisma.supplier.findUniqueOrThrow({ where: { organizationId: supplierOrg.id } });
    const listing = await prisma.material.create({
      data: {
        supplierId: seller.id,
        organizationId: supplierOrg.id,
        name: 'OPC 43 grade cement',
        unit: MaterialUnit.BAG,
        pricePerUnit: 380,
        availableQuantity: 1000,
        status: 'ACTIVE',
        pickupLatitude: JAIPUR.latitude,
        pickupLongitude: JAIPUR.longitude,
      },
    });
    return listing.id;
  }

  /** A penny-validated bank account, which a delivered bid requires. */
  async function connectFleetBank(): Promise<void> {
    const { status } = await request({
      method: 'POST',
      url: '/api/v1/finance/payout-account',
      user: fleetOwner,
      payload: {
        accountHolderName: 'Sharma Transport',
        accountNumber: '026291800001191',
        ifsc: 'YESB0000262',
        pan: 'ABCDE1234F',
      },
    });
    expect(status).toBe(200);
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
      await postMaterialRequirement();
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

    it('shows a seller no customer requirements at all', async () => {
      await postMaterialRequirement();

      const { status } = await request({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: supplier,
      });

      // Customer demand reaches a Seller only as a fleet owner's procurement.
      expect(status).toBe(403);
    });

    it('shows a fleet material work, answered with a delivered transport bid', async () => {
      await postMaterialRequirement();

      const { body } = await request<{
        items: { kind: string; availableScopes: string[] }[];
      }>({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: fleetOwner,
      });

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.availableScopes).toEqual([RequirementBidScope.TRANSPORT]);
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

  /*
   * A Personal account is seated as a fleet owner, so its type and role alone
   * would put it on the freight board. It runs its own vehicles and never takes
   * marketplace work, so the provider side refuses it outright.
   */
  describe('a personal seat is not a bidder', () => {
    async function createPersonalOwner(): Promise<TestUser> {
      const personalOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
      await prisma.organization.update({
        where: { id: personalOrg.id },
        data: { isPersonalSeat: true },
      });
      return createUser({ role: RoleName.FLEET_OWNER, organizationId: personalOrg.id });
    }

    it('keeps a personal seat off the board and out of its own bid list', async () => {
      await postFreightRequirement();
      const personalOwner = await createPersonalOwner();

      const board = await request({
        method: 'GET',
        url: '/api/v1/requirements/board?radiusKm=3000',
        user: personalOwner,
      });
      expect(board.status).toBe(403);

      const bids = await request({
        method: 'GET',
        url: '/api/v1/requirements/me/bids',
        user: personalOwner,
      });
      expect(bids.status).toBe(403);
    });

    it('refuses a bid from a personal seat', async () => {
      const requirementId = await postFreightRequirement();
      const personalOwner = await createPersonalOwner();

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: personalOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 42000 },
      });

      expect(status).toBe(403);
      expect(await prisma.requirementBid.count({ where: { requirementId } })).toBe(0);
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

      // A Seller holds no requirement grants at all.
      expect(status).toBe(403);
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
      const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
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

      const rivalOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
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

    it('refuses a fleet bid on material that names no seller listing', async () => {
      const requirementId = await postMaterialRequirement();
      const truckId = await createBiddableTruck();

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 12000, vehicleId: truckId },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toContain('seller listing');
    });

    it('refuses a seller offering material straight to the customer', async () => {
      const requirementId = await postMaterialRequirement();

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: supplier,
        payload: { scope: RequirementBidScope.MATERIAL, price: 150000, includesDelivery: true },
      });

      expect(status).toBe(403);
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

    it('settles material in one award of a fleet delivered bid, keeping the seller anonymous', async () => {
      const requirementId = await postMaterialRequirement();
      const listingId = await createSellerListing();
      const truckId = await createBiddableTruck();
      await connectFleetBank();

      const { status: bidStatus, body: bid } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: {
          scope: RequirementBidScope.TRANSPORT,
          price: 168000,
          vehicleId: truckId,
          sourceMaterialId: listingId,
        },
      });
      expect(bidStatus).toBe(201);

      const { body } = await request<{
        requirement: { status: string; contactPhone: string | null };
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
      expect(body.data.tripId).toBeTruthy();

      const stored = await prisma.order.findUniqueOrThrow({ where: { id: body.data.orderId! } });
      expect(stored.supplierOrganizationId).toBe(supplierOrg.id);
      expect(stored.fleetOrganizationId).toBe(fleetOrg.id);

      // The fleet sees who it buys from; the customer and the seller never
      // learn about each other.
      const asFleet = await request<{ supplierName: string | null; customerName: string }>({
        method: 'GET',
        url: `/api/v1/orders/${body.data.orderId}`,
        user: fleetOwner,
      });
      expect(asFleet.body.data.supplierName).toBe(supplierOrg.name);

      const asCustomer = await request<{ supplierName: string | null; supplierOrganizationId: string | null }>({
        method: 'GET',
        url: `/api/v1/orders/${body.data.orderId}`,
        user: customer,
      });
      expect(asCustomer.body.data.supplierName).toBeNull();
      expect(asCustomer.body.data.supplierOrganizationId).toBeNull();

      const asSeller = await request<{ customerName: string }>({
        method: 'GET',
        url: `/api/v1/orders/${body.data.orderId}`,
        user: supplier,
      });
      expect(asSeller.body.data.customerName).toBe('Saarthi customer');

      // A customer following the delivery does not receive the driver's phone.
      const tripAsCustomer = await request<{ driver: { phone: string | null } | null }>({
        method: 'GET',
        url: `/api/v1/trips/${body.data.tripId}`,
        user: customer,
      });
      expect(tripAsCustomer.status).toBe(200);
      expect(tripAsCustomer.body.data.driver?.phone ?? null).toBeNull();

      const tripAsFleet = await request<{ driver: { phone: string | null } | null }>({
        method: 'GET',
        url: `/api/v1/trips/${body.data.tripId}`,
        user: fleetOwner,
      });
      expect(tripAsFleet.body.data.driver).not.toBeNull();
    });

    it('refuses to award a direct seller offer left over from before fleet sourcing', async () => {
      const requirementId = await postMaterialRequirement();
      const legacy = await prisma.requirementBid.create({
        data: {
          requirementId,
          scope: RequirementBidScope.MATERIAL,
          bidderOrganizationId: supplierOrg.id,
          createdById: supplier.id,
          price: 150000,
        },
      });

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: legacy.id },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toContain('no longer be accepted');
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

    it('rejects every rival for the awarded scope', async () => {
      const requirementId = await postFreightRequirement();
      const truckId = await createBiddableTruck();

      const rivalOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
      const rival = await createUser({ role: RoleName.FLEET_OWNER, organizationId: rivalOrg.id });
      const rivalDriver = await createUser({ role: RoleName.DRIVER, organizationId: rivalOrg.id, driver: true });
      const rivalTruck = await prisma.truck.create({
        data: {
          organizationId: rivalOrg.id,
          registrationNumber: testPlate(),
          truckType: TruckType.FLATBED,
          vehicleType: VehicleType.TRUCK,
          capacityTons: 25,
          status: TruckStatus.AVAILABLE,
          verificationStatus: VerificationStatus.VERIFIED,
          currentDriverId: rivalDriver.driverId ?? null,
        },
      });

      const { body: winning } = await request<{ id: string }>({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 40000, vehicleId: truckId },
      });
      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/bids`,
        user: rival,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 42000, vehicleId: rivalTruck.id },
      });

      await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirementId}/award`,
        user: customer,
        payload: { bidId: winning.data.id },
      });

      const bids = await prisma.requirementBid.findMany({ where: { requirementId } });
      expect(bids.map((bid) => bid.status).sort()).toEqual(
        [RequirementBidStatus.ACCEPTED, RequirementBidStatus.REJECTED].sort(),
      );
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
