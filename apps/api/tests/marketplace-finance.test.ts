import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MaterialUnit,
  OrderStatus,
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
import { settlePayment } from '../src/modules/payments/payment-settlement.service';
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
 * Marketplace money, end to end on the mock gateway: bank accounts, the
 * fleet's delivered bid, 30% / supplier / 70%, profit and Saarthi's 2% — of
 * profit, never of the customer's payment — and tour & travel's own flow.
 */

const JAIPUR = { addressLine: 'Bassi Industrial Area, Jaipur', latitude: 26.8351, longitude: 75.9843 };
const GURUGRAM = { addressLine: 'Sector 62, Gurugram', latitude: 28.4089, longitude: 77.0789 };
const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const BANK = {
  accountHolderName: 'Sharma Transport',
  accountNumber: '026291800001191',
  ifsc: 'YESB0000262',
  pan: 'ABCDE1234F',
};

describe('marketplace finance', () => {
  let customerOrg: TestOrganization;
  let customer: TestUser;
  let fleetOrg: TestOrganization;
  let fleetOwner: TestUser;
  let supplierOrg: TestOrganization;
  let supplier: TestUser;
  let materialId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.FREE);
    customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });
    fleetOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    fleetOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetOrg.id });
    supplierOrg = await createOrganization(OrganizationType.SUPPLIER, PlanTier.SUPPLIER);
    supplier = await createUser({ role: RoleName.SUPPLIER, organizationId: supplierOrg.id });

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
    materialId = material.id;
  });

  const connectBank = (user: TestUser, accountNumber = BANK.accountNumber) =>
    request<{ status: string; maskedAccount: string; usable: boolean }>({
      method: 'POST',
      url: '/api/v1/finance/payout-account',
      user,
      payload: { ...BANK, accountNumber },
    });

  async function biddableTruck(): Promise<string> {
    const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleetOrg.id, driver: true });
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
    return truck.id;
  }

  /** Customer requirement → fleet's delivered bid → award. Returns the order. */
  async function awardDeliveredBid(): Promise<{ orderId: string; tripId: string }> {
    const requirement = await request<{ id: string }>({
      method: 'POST',
      url: '/api/v1/requirements',
      user: customer,
      payload: {
        kind: RequirementKind.MATERIAL_SUPPLY,
        title: '25 tonnes of river sand',
        origin: JAIPUR,
        destination: GURUGRAM,
        startAt: soon(6),
        bidsCloseAt: soon(2),
        materialDetail: { materialName: 'River sand', quantity: 25, unit: MaterialUnit.TON, needsTransport: true },
      },
    });
    expect(requirement.status).toBe(201);

    const truckId = await biddableTruck();
    const bid = await request<{ id: string; procurementReference: number | null; deliversMaterial: boolean }>({
      method: 'POST',
      url: `/api/v1/requirements/${requirement.body.data.id}/bids`,
      user: fleetOwner,
      payload: { scope: RequirementBidScope.TRANSPORT, price: 62500, vehicleId: truckId, sourceMaterialId: materialId },
    });
    expect(bid.status).toBe(201);
    // The fleet sees its procurement reference — ₹2,000 × 25 — worked out on the server.
    expect(bid.body.data.procurementReference).toBe(50000);
    expect(bid.body.data.deliversMaterial).toBe(true);

    // The customer does not.
    const customerView = await request<{ procurementReference: number | null }[]>({
      method: 'GET',
      url: `/api/v1/requirements/${requirement.body.data.id}/bids`,
      user: customer,
    });
    expect(customerView.body.data[0]?.procurementReference).toBeNull();

    const award = await request<{ orderId: string; tripId: string }>({
      method: 'POST',
      url: `/api/v1/requirements/${requirement.body.data.id}/award`,
      user: customer,
      payload: { bidId: bid.body.data.id },
    });
    expect(award.status).toBe(200);
    return { orderId: award.body.data.orderId, tripId: award.body.data.tripId };
  }

  const trip = (tripId: string, status: string) =>
    request({ method: 'POST', url: `/api/v1/trips/${tripId}/transition`, user: fleetOwner, payload: { status } });

  async function driveToDelivery(tripId: string): Promise<void> {
    for (const status of ['LOADING', 'STARTED', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED']) {
      const response = await trip(tripId, status);
      expect(response.status).toBe(200);
    }
  }

  const summary = (orderId: string, user: TestUser) =>
    request<{
      stage: string;
      balanceDue: number;
      finalAmount: number | null;
      provider: { profitBasis: number; commissionAmount: number; netAfterCommission: number; final: boolean } | null;
    }>({ method: 'GET', url: `/api/v1/orders/${orderId}/finance`, user });

  describe('bank accounts', () => {
    it('verifies by penny validation and shows only the last four digits', async () => {
      const { status, body } = await connectBank(fleetOwner);
      expect(status).toBe(200);
      expect(body.data.status).toBe('VERIFIED');
      expect(body.data.usable).toBe(true);
      expect(body.data.maskedAccount).toBe('XXXX XXXX 1191');
      expect(JSON.stringify(body)).not.toContain(BANK.accountNumber);

      const stored = await prisma.payoutAccount.findUniqueOrThrow({ where: { organizationId: fleetOrg.id } });
      expect(JSON.stringify(stored)).not.toContain(BANK.accountNumber);
    });

    it('fails an account the bank rejects, and it cannot be used', async () => {
      const { body } = await connectBank(fleetOwner, '026291800000000');
      expect(body.data.status).toBe('FAILED');
      expect(body.data.usable).toBe(false);
    });

    it('refuses a delivered bid from a fleet without a verified bank account', async () => {
      const requirement = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/requirements',
        user: customer,
        payload: {
          kind: RequirementKind.MATERIAL_SUPPLY,
          title: '25 tonnes of river sand for the site',
          origin: JAIPUR,
          destination: GURUGRAM,
          startAt: soon(6),
          bidsCloseAt: soon(2),
          materialDetail: { materialName: 'River sand', quantity: 25, unit: MaterialUnit.TON, needsTransport: true },
        },
      });
      const truckId = await biddableTruck();
      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/requirements/${requirement.body.data.id}/bids`,
        user: fleetOwner,
        payload: { scope: RequirementBidScope.TRANSPORT, price: 62500, vehicleId: truckId, sourceMaterialId: materialId },
      });
      expect(status).toBe(422);
      expect(body.error?.message).toMatch(/bank account/i);
    });

    it('keeps the account screen from a driver', async () => {
      const driver = await createUser({ role: RoleName.DRIVER, organizationId: fleetOrg.id, driver: true });
      const { status } = await request({ method: 'GET', url: '/api/v1/finance/payout-account', user: driver });
      expect(status).toBe(403);
    });
  });

  describe('the fleet-delivered order', () => {
    beforeEach(async () => {
      await connectBank(fleetOwner);
      await connectBank(supplier);
    });

    it('runs 30% → supplier → delivery → 70%, and takes 2% of profit, not of the sale', async () => {
      const { orderId, tripId } = await awardDeliveredBid();
      expect((await summary(orderId, customer)).body.data.stage).toBe('PAYMENT_30_REQUIRED');

      // Nothing loads until the money is in.
      const early = await trip(tripId, 'LOADING');
      expect(early.status).toBe(422);

      const thirty = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/confirmation-payment`, user: customer });
      expect(thirty.status).toBe(200);
      const payment30 = await prisma.payment.findFirstOrThrow({ where: { orderId, reference: { startsWith: 'ORD30-' } } });
      expect(Number(payment30.amount)).toBe(18750);

      // Still not loaded: the supplier has to be paid first.
      expect((await trip(tripId, 'LOADING')).status).toBe(422);

      const procurement = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/procurement-payment`, user: fleetOwner, payload: {} });
      expect(procurement.status).toBe(200);

      // The supplier sees what it was paid, and nothing of the fleet's margin.
      const supplierView = await request<{ supplier: { procurementAmount: number }; provider: unknown }>({
        method: 'GET',
        url: `/api/v1/orders/${orderId}/finance`,
        user: supplier,
      });
      expect(supplierView.body.data.supplier.procurementAmount).toBe(50000);
      expect(supplierView.body.data.provider).toBeNull();

      await driveToDelivery(tripId);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(OrderStatus.DELIVERED);

      // The balance is not due until the customer confirms what arrived.
      const tooSoon = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/final-payment`, user: customer });
      expect(tooSoon.status).toBe(409);

      const delivered = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/delivery`, user: customer, payload: { deliveredQuantity: 25 } });
      expect(delivered.status).toBe(200);

      const seventy = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/final-payment`, user: customer });
      expect(seventy.status).toBe(200);
      const payment70 = await prisma.payment.findFirstOrThrow({ where: { orderId, reference: { startsWith: 'ORD70-' } } });
      expect(Number(payment70.amount)).toBe(43750);

      const commission = await prisma.marketplaceCommission.findUniqueOrThrow({ where: { orderId } });
      expect(Number(commission.profitBasis)).toBe(12500);
      expect(Number(commission.amount)).toBe(250); // not 1,250
      expect(commission.ruleVersion).toBe('MARKETPLACE_PROFIT_V1');
      expect(commission.source).toBe('MARKETPLACE_PROFIT');

      const fleetView = await summary(orderId, fleetOwner);
      expect(fleetView.body.data.stage).toBe('FINALIZED');
      expect(fleetView.body.data.provider).toMatchObject({
        profitBasis: 12500,
        commissionAmount: 250,
        netAfterCommission: 12250,
        final: true,
      });
      expect((await summary(orderId, customer)).body.data.provider).toBeNull();

      // The fleet's share of the balance was routed to it net of the commission.
      const settlements = await prisma.marketplaceSettlement.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
      expect(settlements.map((row) => Number(row.amount))).toEqual([18750, 50000, 43500]);

      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(OrderStatus.COMPLETED);

      // A repeated confirmation — a retried webhook — changes nothing.
      await settlePayment(payment70.reference);
      expect(await prisma.marketplaceCommission.count({ where: { orderId } })).toBe(1);
      expect(await prisma.marketplaceLedgerEntry.count({ where: { orderId, type: 'CUSTOMER_PAYMENT' } })).toBe(2);
    });

    it('charges for what was delivered on a short delivery', async () => {
      const { orderId, tripId } = await awardDeliveredBid();
      await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/confirmation-payment`, user: customer });
      await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/procurement-payment`, user: fleetOwner, payload: {} });
      await driveToDelivery(tripId);

      await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/delivery`, user: customer, payload: { deliveredQuantity: 20 } });
      const view = await summary(orderId, customer);
      // 20 of 25 tonnes: ₹50,000, of which ₹18,750 was paid.
      expect(view.body.data.finalAmount).toBe(50000);
      expect(view.body.data.balanceDue).toBe(31250);

      await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/final-payment`, user: customer });
      const commission = await prisma.marketplaceCommission.findUniqueOrThrow({ where: { orderId } });
      // No profit on a delivery that only covered the material.
      expect(Number(commission.profitBasis)).toBe(0);
      expect(Number(commission.amount)).toBe(0);
    });

    it('refunds the 30% when the order is cancelled before the supplier is paid', async () => {
      const { orderId } = await awardDeliveredBid();
      await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/confirmation-payment`, user: customer });

      const cancelled = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/cancel`, user: customer, payload: { reason: 'Plans changed' } });
      expect(cancelled.status).toBe(200);

      expect((await summary(orderId, customer)).body.data.stage).toBe('CANCELLED');
      expect(await prisma.marketplaceLedgerEntry.count({ where: { orderId, type: 'REFUND' } })).toBe(1);
      expect(await prisma.marketplaceCommission.count({ where: { orderId } })).toBe(0);
    });

    it('stops anybody but the customer paying, and the customer paying the supplier', async () => {
      const { orderId } = await awardDeliveredBid();
      const byFleet = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/confirmation-payment`, user: fleetOwner });
      expect(byFleet.status).toBe(403);
      await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/confirmation-payment`, user: customer });
      const byCustomer = await request({ method: 'POST', url: `/api/v1/orders/${orderId}/finance/procurement-payment`, user: customer, payload: {} });
      expect(byCustomer.status).toBe(403);
    });
  });

  describe('tour & travel', () => {
    it('takes 2% of the provider profit once the trip is completed and costed', async () => {
      const mobilityOrg = await createOrganization(OrganizationType.MOBILITY_PROVIDER, PlanTier.BUSINESS);
      const provider = await createUser({ role: RoleName.MOBILITY_PROVIDER, organizationId: mobilityOrg.id });
      await connectBank(provider);

      const profile = await prisma.serviceProviderProfile.create({
        data: { organizationId: mobilityOrg.id, displayName: 'Hill Tours', serviceTypes: ['TOUR'], contactPhone: '+919812345678', status: 'ACTIVE' },
      });
      const pkg = await prisma.travelPackage.create({
        data: {
          providerId: profile.id,
          organizationId: mobilityOrg.id,
          title: 'Shimla weekend',
          summary: 'Two days in the hills',
          serviceKind: 'MULTI_DAY_TOUR',
          startLocation: 'Delhi',
          startLatitude: 28.61,
          startLongitude: 77.21,
          endLocation: 'Shimla',
          durationDays: 2,
          vehicleType: VehicleType.SUV,
          maxPassengers: 4,
          pricingModel: 'FIXED_PACKAGE',
          basePrice: 20000,
          createdById: provider.id,
        },
      });
      const customerRecord = await prisma.customer.findUniqueOrThrow({ where: { organizationId: customerOrg.id } });
      const booking = await prisma.travelBooking.create({
        data: {
          reference: 'TB-TEST-0001',
          packageId: pkg.id,
          providerOrganizationId: mobilityOrg.id,
          customerOrganizationId: customerOrg.id,
          customerId: customerRecord.id,
          bookedByUserId: customer.id,
          status: 'COMPLETED',
          startDate: new Date(),
          endDate: new Date(),
          passengers: 2,
          pricingModel: 'FIXED_PACKAGE',
          subtotal: 20000,
          platformFee: 0,
          totalAmount: 20000,
          contactName: 'Anita',
          contactPhone: '+919876543210',
          completedAt: new Date(),
        } as never,
      });
      await prisma.payment.create({
        data: {
          reference: 'PAY-TB-TEST-0001',
          purpose: 'TRAVEL_BOOKING',
          status: 'SUCCEEDED',
          method: 'MOCK',
          organizationId: customerOrg.id,
          initiatedByUserId: customer.id,
          bookingId: booking.id,
          amount: 20000,
          provider: 'mock',
          providerReference: 'MOCK-TB0001',
        },
      });

      const { status, body } = await request<{ profitBasis: number; commissionAmount: number; netAfterCommission: number }>({
        method: 'POST',
        url: `/api/v1/travel/bookings/${booking.id}/finance/costs`,
        user: provider,
        payload: { costs: [{ label: 'Driver and fuel', amount: 9000 }, { label: 'Hotel', amount: 3000 }] },
      });
      expect(status).toBe(200);
      expect(body.data.profitBasis).toBe(8000);
      expect(body.data.commissionAmount).toBe(160); // 2% of ₹8,000 profit, not of ₹20,000
      expect(body.data.netAfterCommission).toBe(7840);

      const settlement = await prisma.marketplaceSettlement.findFirstOrThrow({ where: { bookingId: booking.id } });
      expect(Number(settlement.amount)).toBe(19840);
      expect(settlement.status).toBe('SETTLED');

      // Costs are recorded once.
      const again = await request({
        method: 'POST',
        url: `/api/v1/travel/bookings/${booking.id}/finance/costs`,
        user: provider,
        payload: { costs: [{ label: 'Nothing', amount: 0 }] },
      });
      expect(again.status).toBe(409);
    });
  });
});
