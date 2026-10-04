import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ENABLE_BACKHAUL_ACTION,
  MaterialUnit,
  NotificationType,
  OrganizationType,
  PlanTier,
  RequirementBidScope,
  RequirementKind,
  RoleName,
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
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

/**
 * Backhaul, end to end: a Business-plan fleet completes a trip, the owner is
 * told and offered "Enable backhaul", accepts the 3% commission, sees customer
 * requirements on the way home with sellers near the truck, bids, wins — and
 * the job is charged 3% of profit from the customer's final 70%.
 */

/** The truck lives in Gurugram, delivers in Jaipur, and has to get home. */
const GURUGRAM = { addressLine: 'Udyog Vihar, Gurugram', latitude: 28.4595, longitude: 77.0266 };
const JAIPUR = { addressLine: 'Sitapura, Jaipur', latitude: 26.9124, longitude: 75.7873 };
/** A seller's yard about 20 km from where the truck unloads. */
const BASSI = { latitude: 26.8351, longitude: 75.9843 };
/** A customer site on the way home. */
const MANESAR = { addressLine: 'IMT Manesar', latitude: 28.354, longitude: 76.9366 };
/** A customer site the other way entirely. */
const UDAIPUR = { addressLine: 'Madri, Udaipur', latitude: 24.5854, longitude: 73.7125 };

const inHours = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();

const BANK = {
  accountHolderName: 'Sharma Transport',
  accountNumber: '026291800001191',
  ifsc: 'YESB0000262',
  pan: 'ABCDE1234F',
};

let fleet: TestOrganization;
let owner: TestUser;
let driver: TestUser;
let customerOrg: TestOrganization;
let customer: TestUser;
let supplierOrg: TestOrganization;
let supplier: TestUser;

beforeAll(async () => {
  await getApp();
});

afterAll(async () => {
  await closeApp();
});

beforeEach(async () => {
  await resetDatabase();
  fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
  owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  driver = await createUser({ role: RoleName.DRIVER, organizationId: fleet.id, driver: true });
  customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
  customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
  supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
  supplier = await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });
});

async function createTruck(organizationId: string, driverId: string | null) {
  return prisma.truck.create({
    data: {
      organizationId,
      registrationNumber: unique('HR26BH').toUpperCase().slice(0, 14),
      truckType: TruckType.OPEN_BODY,
      vehicleType: VehicleType.TRUCK,
      capacityTons: 30,
      status: TruckStatus.ON_TRIP,
      verificationStatus: VerificationStatus.VERIFIED,
      currentDriverId: driverId,
      homeBaseAddress: GURUGRAM.addressLine,
      homeBaseLatitude: GURUGRAM.latitude,
      homeBaseLongitude: GURUGRAM.longitude,
    },
  });
}

/** A Gurugram → Jaipur run that has arrived, ready to be completed. */
async function arrivedTrip(organization: TestOrganization, by: TestUser, driverUser: TestUser) {
  const truck = await createTruck(organization.id, driverUser.driverId ?? null);
  const trip = await prisma.trip.create({
    data: {
      reference: unique('TR-T-'),
      organizationId: organization.id,
      truckId: truck.id,
      driverId: driverUser.driverId ?? null,
      originAddress: GURUGRAM.addressLine,
      originLatitude: GURUGRAM.latitude,
      originLongitude: GURUGRAM.longitude,
      destinationAddress: JAIPUR.addressLine,
      destinationLatitude: JAIPUR.latitude,
      destinationLongitude: JAIPUR.longitude,
      status: 'ARRIVED',
      actualStartAt: new Date(Date.now() - 6 * 3_600_000),
      actualArrivalAt: new Date(),
      createdById: by.id,
    },
  });
  await prisma.truck.update({ where: { id: truck.id }, data: { currentTripId: trip.id } });
  return { truck, trip };
}

const transition = (tripId: string, status: string, user: TestUser = owner) =>
  request({ method: 'POST', url: `/api/v1/trips/${tripId}/transition`, user, payload: { status } });

const offer = (tripId: string, user: TestUser = owner) =>
  request<{
    unavailableReason: string | null;
    commission: { rate: number; ruleVersion: string; ordinaryRate: number };
    request: { id: string; status: string; outboundTripId: string; originAddress: string } | null;
  }>({ method: 'GET', url: `/api/v1/return-loads/trips/${tripId}`, user });

const enable = (tripId: string, payload: Record<string, unknown>, user: TestUser = owner) =>
  request<{ request: { id: string; status: string } | null }>({
    method: 'POST',
    url: `/api/v1/return-loads/trips/${tripId}/enable`,
    user,
    payload,
  });

/** A material requirement delivered to `site`, posted by the customer. */
async function postRequirement(site: { addressLine: string; latitude: number; longitude: number }) {
  const created = await request<{ id: string }>({
    method: 'POST',
    url: '/api/v1/requirements',
    user: customer,
    payload: {
      kind: RequirementKind.MATERIAL_SUPPLY,
      title: '25 tonnes of river sand',
      origin: JAIPUR,
      destination: site,
      startAt: inHours(36),
      bidsCloseAt: inHours(24),
      materialDetail: {
        materialName: 'River sand',
        quantity: 25,
        unit: MaterialUnit.TON,
        needsTransport: true,
      },
    },
  });
  expect(created.status).toBe(201);
  return created.body.data.id;
}

/**
 * River sand at the Bassi yard, filed under the category the requirement is
 * matched on — its own, or the one the taxonomy reads from "River sand".
 */
async function sandListing(requirementId: string) {
  const requirement = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } });
  const riverSand = await prisma.commerceCategory.findFirst({ where: { slug: 'river-sand' } });
  const supplierRecord = await prisma.supplier.findUniqueOrThrow({
    where: { organizationId: supplierOrg.id },
  });
  return prisma.material.create({
    data: {
      supplierId: supplierRecord.id,
      organizationId: supplierOrg.id,
      name: 'River sand',
      category: 'Sand',
      categoryId: requirement.categoryId ?? riverSand?.id ?? null,
      unit: MaterialUnit.TON,
      pricePerUnit: 2000,
      availableQuantity: 100,
      status: 'ACTIVE',
      pickupLatitude: BASSI.latitude,
      pickupLongitude: BASSI.longitude,
    },
  });
}

describe('the trip-completed prompt', () => {
  it('notifies the owner the moment a Business-plan trip completes, with the Enable backhaul action', async () => {
    const { trip } = await arrivedTrip(fleet, owner, driver);
    expect((await transition(trip.id, 'COMPLETED')).status).toBe(200);

    const notifications = await prisma.notification.findMany({
      where: { userId: owner.id, type: NotificationType.TRIP_COMPLETED },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.priority).toBe('HIGH');
    expect(notifications[0]!.data).toMatchObject({
      action: ENABLE_BACKHAUL_ACTION,
      tripId: trip.id,
    });
    // The commission is stated up front, not discovered later.
    expect(notifications[0]!.body).toContain('3%');

    // It is the owner's decision: the driver is not asked.
    const toDriver = await prisma.notification.count({
      where: { userId: driver.id, type: NotificationType.TRIP_COMPLETED },
    });
    expect(toDriver).toBe(0);
  });

  it('is not offered on the Personal plan', async () => {
    const personal = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PERSONAL);
    const personalOwner = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: personal.id,
    });
    const personalDriver = await createUser({
      role: RoleName.DRIVER,
      organizationId: personal.id,
      driver: true,
    });
    const { trip } = await arrivedTrip(personal, personalOwner, personalDriver);
    expect((await transition(trip.id, 'COMPLETED', personalOwner)).status).toBe(200);

    expect(
      await prisma.notification.count({
        where: { userId: personalOwner.id, type: NotificationType.TRIP_COMPLETED },
      }),
    ).toBe(0);
    const { body } = await offer(trip.id, personalOwner);
    expect(body.data.unavailableReason).toMatch(/Business plan/);
    expect((await enable(trip.id, { acceptCommission: true }, personalOwner)).status).toBe(422);
  });

  it('is not offered before the trip completes', async () => {
    const { trip } = await arrivedTrip(fleet, owner, driver);
    const { body } = await offer(trip.id);
    expect(body.data.unavailableReason).toMatch(/completed/);
    expect((await enable(trip.id, { acceptCommission: true })).status).toBe(422);
  });
});

describe('enabling backhaul', () => {
  it('states the commission, and refuses to enable without the owner accepting it', async () => {
    const { trip } = await arrivedTrip(fleet, owner, driver);
    await transition(trip.id, 'COMPLETED');

    const before = await offer(trip.id);
    expect(before.body.data.unavailableReason).toBeNull();
    expect(before.body.data.commission).toMatchObject({ rate: 0.03, ordinaryRate: 0.02 });
    expect(before.body.data.request).toBeNull();

    expect((await enable(trip.id, {})).status).toBe(400);
    expect((await enable(trip.id, { acceptCommission: false })).status).toBe(400);
    expect(await prisma.returnLoadRequest.count()).toBe(0);
  });

  it('opens the way home from where the truck unloaded, recording the accepted rate', async () => {
    const { trip, truck } = await arrivedTrip(fleet, owner, driver);
    await transition(trip.id, 'COMPLETED');

    const enabled = await enable(trip.id, { acceptCommission: true, detourToleranceKm: 100 });
    expect(enabled.status).toBe(200);
    const requestId = enabled.body.data.request!.id;

    const stored = await prisma.returnLoadRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stored.outboundTripId).toBe(trip.id);
    expect(stored.truckId).toBe(truck.id);
    expect(stored.originLatitude).toBe(JAIPUR.latitude);
    expect(stored.destinationLatitude).toBe(GURUGRAM.latitude);
    expect(stored.detourToleranceKm).toBe(100);
    expect(Number(stored.commissionRate)).toBe(0.03);
    expect(stored.commissionRuleVersion).toBe('BACKHAUL_PROFIT_V1');
    expect(stored.commissionAcceptedBy).toBe(owner.id);
    expect(stored.commissionAcceptedAt).not.toBeNull();

    // Enabling again is the same decision, not a second backhaul.
    const again = await enable(trip.id, { acceptCommission: true });
    expect(again.body.data.request!.id).toBe(requestId);
    expect(await prisma.returnLoadRequest.count({ where: { truckId: truck.id } })).toBe(1);
  });

  it('keeps another fleet out', async () => {
    const { trip } = await arrivedTrip(fleet, owner, driver);
    await transition(trip.id, 'COMPLETED');
    const otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    const otherOwner = await createUser({
      role: RoleName.FLEET_OWNER,
      organizationId: otherFleet.id,
    });

    expect((await offer(trip.id, otherOwner)).status).toBe(404);
    expect((await enable(trip.id, { acceptCommission: true }, otherOwner)).status).toBe(404);
  });
});

describe('work on the way home', () => {
  async function enabledBackhaul() {
    const { trip, truck } = await arrivedTrip(fleet, owner, driver);
    await transition(trip.id, 'COMPLETED');
    const enabled = await enable(trip.id, { acceptCommission: true, detourToleranceKm: 100 });
    return { trip, truck, requestId: enabled.body.data.request!.id };
  }

  const routeRequirements = (requestId: string) =>
    request<
      Array<{
        id: string;
        availableScopes: string[];
        backhaul: {
          score: number;
          detourKm: number;
          sellerDistanceKm: number;
          sellers: Array<{ materialId: string; sellerName: string }>;
        };
      }>
    >({ method: 'GET', url: `/api/v1/return-loads/${requestId}/requirements`, user: owner });

  it('lists a customer on the way home, with the seller near the truck — and not one the other way', async () => {
    const onTheWay = await postRequirement(MANESAR);
    const otherWay = await postRequirement(UDAIPUR);
    const listing = await sandListing(onTheWay);
    const { requestId } = await enabledBackhaul();

    const { status, body } = await routeRequirements(requestId);
    expect(status).toBe(200);
    const ids = body.data.map((row) => row.id);
    expect(ids).toContain(onTheWay);
    expect(ids).not.toContain(otherWay);

    const match = body.data.find((row) => row.id === onTheWay)!;
    expect(match.availableScopes).toEqual([RequirementBidScope.TRANSPORT]);
    expect(match.backhaul.sellers[0]!.materialId).toBe(listing.id);
    expect(match.backhaul.sellerDistanceKm).toBeLessThan(40);
    expect(match.backhaul.detourKm).toBeLessThan(100);
  });

  it('is shown only once backhaul is enabled with the commission accepted', async () => {
    const { truck } = await arrivedTrip(fleet, owner, driver);
    // A return-load request opened by hand, with no commission accepted.
    const manual = await prisma.returnLoadRequest.create({
      data: {
        reference: unique('RL-T-'),
        organizationId: fleet.id,
        truckId: truck.id,
        originAddress: JAIPUR.addressLine,
        originLatitude: JAIPUR.latitude,
        originLongitude: JAIPUR.longitude,
        destinationAddress: GURUGRAM.addressLine,
        destinationLatitude: GURUGRAM.latitude,
        destinationLongitude: GURUGRAM.longitude,
        availableFrom: new Date(),
        availableUntil: new Date(Date.now() + 48 * 3_600_000),
        capacityTons: 30,
        createdById: owner.id,
      },
    });
    expect((await routeRequirements(manual.id)).status).toBe(422);
  });

  it('refuses a backhaul bid that offers a different vehicle', async () => {
    const requirementId = await postRequirement(MANESAR);
    const listing = await sandListing(requirementId);
    const { requestId } = await enabledBackhaul();
    await request({
      method: 'POST',
      url: '/api/v1/finance/payout-account',
      user: owner,
      payload: BANK,
    });

    const otherTruck = await createTruck(fleet.id, driver.driverId ?? null);
    const { status, body } = await request({
      method: 'POST',
      url: `/api/v1/requirements/${requirementId}/bids`,
      user: owner,
      payload: {
        scope: RequirementBidScope.TRANSPORT,
        price: 62500,
        vehicleId: otherTruck.id,
        sourceMaterialId: listing.id,
        returnLoadRequestId: requestId,
      },
    });
    expect(status).toBe(422);
    expect(JSON.stringify(body)).toContain('vehicle that is returning');
  });
});

describe('a backhaul won and paid', () => {
  it('books the return leg and takes 3% of profit from the final 70%', async () => {
    const requirementId = await postRequirement(MANESAR);
    const listing = await sandListing(requirementId);
    const { trip: outbound, truck } = await arrivedTrip(fleet, owner, driver);
    await transition(outbound.id, 'COMPLETED');
    const enabled = await enable(outbound.id, { acceptCommission: true, detourToleranceKm: 100 });
    const requestId = enabled.body.data.request!.id;

    await request({
      method: 'POST',
      url: '/api/v1/finance/payout-account',
      user: owner,
      payload: BANK,
    });
    await request({
      method: 'POST',
      url: '/api/v1/finance/payout-account',
      user: supplier,
      payload: BANK,
    });

    const bid = await request<{ id: string; returnLoadRequestId: string | null }>({
      method: 'POST',
      url: `/api/v1/requirements/${requirementId}/bids`,
      user: owner,
      payload: {
        scope: RequirementBidScope.TRANSPORT,
        price: 62500,
        vehicleId: truck.id,
        sourceMaterialId: listing.id,
        returnLoadRequestId: requestId,
      },
    });
    expect(bid.status).toBe(201);
    expect(bid.body.data.returnLoadRequestId).toBe(requestId);

    const award = await request<{ orderId: string; tripId: string }>({
      method: 'POST',
      url: `/api/v1/requirements/${requirementId}/award`,
      user: customer,
      payload: { bidId: bid.body.data.id },
    });
    expect(award.status).toBe(200);
    const { orderId, tripId } = award.body.data;

    // Booked: the order, the trip and the request all agree it is a return load.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.isReturnLoad).toBe(true);
    expect(order.returnLoadRequestId).toBe(requestId);
    const returnTrip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(returnTrip.legType).toBe('RETURN');
    expect(returnTrip.parentTripId).toBe(outbound.id);
    const booked = await prisma.returnLoadRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(booked.status).toBe('BOOKED');
    expect(booked.matchedOrderId).toBe(orderId);
    expect(
      await prisma.notification.count({
        where: { userId: owner.id, type: NotificationType.RETURN_LOAD_BOOKED },
      }),
    ).toBe(1);
    // A won return leg is not offered again from the same trip.
    expect((await offer(outbound.id)).body.data.unavailableReason).toMatch(/already booked/);

    // The money: 30%, the supplier, delivery, then the 70%.
    await request({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/finance/confirmation-payment`,
      user: customer,
    });
    await request({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/finance/procurement-payment`,
      user: owner,
      payload: {},
    });
    for (const status of ['LOADING', 'STARTED', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED']) {
      expect((await transition(tripId, status)).status).toBe(200);
    }
    // The return leg delivered completes its backhaul — and is not itself offered one.
    expect(
      (await prisma.returnLoadRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
    ).toBe('COMPLETED');
    expect(
      await prisma.notification.count({
        where: { userId: owner.id, type: NotificationType.TRIP_COMPLETED },
      }),
    ).toBe(1);

    await request({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/finance/delivery`,
      user: customer,
      payload: { deliveredQuantity: 25 },
    });
    const seventy = await request({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/finance/final-payment`,
      user: customer,
    });
    expect(seventy.status).toBe(200);

    // ₹62,500 sold, ₹50,000 bought: ₹12,500 profit, and 3% of that is ₹375.
    const commission = await prisma.marketplaceCommission.findUniqueOrThrow({ where: { orderId } });
    expect(Number(commission.profitBasis)).toBe(12500);
    expect(Number(commission.rate)).toBe(0.03);
    expect(Number(commission.amount)).toBe(375);
    expect(commission.ruleVersion).toBe('BACKHAUL_PROFIT_V1');

    // Held back from the fleet's share of the 70%: ₹43,750 − ₹375.
    const settlements = await prisma.marketplaceSettlement.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    expect(settlements.map((row) => Number(row.amount))).toEqual([18750, 50000, 43375]);
  });
});
