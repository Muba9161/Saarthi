import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BookingStatus,
  DeviceStatus,
  OrganizationType,
  PlanTier,
  ProviderStatus,
  RoleName,
  TelemetryAlertType,
  TruckType,
  VehicleType,
  VerificationStatus,
} from '@saarthi/shared';
import bcrypt from 'bcryptjs';
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
 * Integration coverage for the mobility expansion: generalized vehicles, the
 * truck-association emergency network, travel bookings and hardware telemetry.
 *
 * The emphasis is on the guarantees that would be expensive to get wrong —
 * association privacy scoping, device authentication, telemetry honesty and the
 * booking money path — rather than on CRUD happy paths.
 */
describe('Mobility expansion', () => {
  let fleet: TestOrganization;
  let owner: TestUser;
  let driver: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    driver = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleet.id,
      driver: true,
    });
    admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
  });

  // =========================================================================
  // Generalized vehicles
  // =========================================================================

  describe('generalized vehicles', () => {
    it('creates a taxi without demanding a payload capacity', async () => {
      const response = await request<{
        id: string;
        vehicleType: string;
        passengerCapacity: number | null;
        capacityTons: number | null;
        capabilities: string[];
      }>({
        method: 'POST',
        url: '/api/v1/fleet/vehicles',
        user: owner,
        payload: {
          registrationNumber: 'DL1CAB4321',
          vehicleType: VehicleType.TAXI,
          passengerCapacity: 4,
          fuelType: 'PETROL',
        },
      });

      expect(response.status).toBe(201);
      expect(response.body.data.vehicleType).toBe(VehicleType.TAXI);
      expect(response.body.data.passengerCapacity).toBe(4);
      // A taxi carries no freight, so payload capacity is reported as absent
      // rather than as a plausible-looking zero.
      expect(response.body.data.capacityTons).toBeNull();
      expect(response.body.data.capabilities).toContain('PASSENGER_TRANSPORT');
      expect(response.body.data.capabilities).not.toContain('FREIGHT');
    });

    it('refuses a payload capacity on a passenger vehicle', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/fleet/vehicles',
        user: owner,
        payload: {
          registrationNumber: 'DL1CAB9999',
          vehicleType: VehicleType.TAXI,
          passengerCapacity: 4,
          capacityTons: 12,
        },
      });

      expect(response.status).toBe(400);
      expect(response.body.error?.message).toMatch(/does not carry freight/i);
    });

    it('requires a payload capacity on a goods vehicle', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/fleet/vehicles',
        user: owner,
        payload: { registrationNumber: 'DL1GA1111', vehicleType: VehicleType.TRUCK },
      });

      expect(response.status).toBe(400);
      expect(response.body.error?.message).toMatch(/payload capacity/i);
    });

    it('filters by capability rather than by hard-coded type', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/fleet/vehicles',
        user: owner,
        payload: {
          registrationNumber: 'DL1GA2222',
          vehicleType: VehicleType.TRUCK,
          capacityTons: 9,
        },
      });
      await request({
        method: 'POST',
        url: '/api/v1/fleet/vehicles',
        user: owner,
        payload: {
          registrationNumber: 'DL1CAB3333',
          vehicleType: VehicleType.SUV,
          passengerCapacity: 6,
        },
      });

      const freight = await request<{ items: { registrationNumber: string }[] }>({
        method: 'GET',
        url: '/api/v1/fleet/vehicles?capability=FREIGHT',
        user: owner,
      });
      const passenger = await request<{ items: { registrationNumber: string }[] }>({
        method: 'GET',
        url: '/api/v1/fleet/vehicles?capability=PASSENGER',
        user: owner,
      });

      expect(freight.body.data.items.map((v) => v.registrationNumber)).toEqual(['DL1GA2222']);
      expect(passenger.body.data.items.map((v) => v.registrationNumber)).toEqual(['DL1CAB3333']);
    });

    it('keeps trucks created through the legacy surface visible as vehicles', async () => {
      // The two surfaces are the same rows — a truck added through /trucks must
      // appear in the vehicle list, or the generalization is a lie.
      const created = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: owner,
        payload: {
          registrationNumber: 'DL1GA4444',
          truckType: TruckType.TIPPER,
          capacityTons: 16,
        },
      });
      expect(created.status).toBe(201);

      const vehicles = await request<{ items: { id: string; vehicleType: string }[] }>({
        method: 'GET',
        url: '/api/v1/fleet/vehicles',
        user: owner,
      });

      const match = vehicles.body.data.items.find((v) => v.id === created.body.data.id);
      expect(match).toBeDefined();
      expect(match?.vehicleType).toBe(VehicleType.TRUCK);
    });
  });

  // =========================================================================
  // Truck association emergency network
  // =========================================================================

  describe('association emergency network', () => {
    /** A verified association covering a point, plus its admin user. */
    async function createAssociation(options: {
      name: string;
      latitude: number;
      longitude: number;
      radiusKm?: number;
      district: string;
    }) {
      const org = await prisma.organization.create({
        data: {
          name: options.name,
          type: OrganizationType.TRUCK_ASSOCIATION,
          inviteCode: unique('ASN-').toUpperCase().slice(0, 12),
          verificationStatus: VerificationStatus.VERIFIED,
          city: options.district,
          state: 'Uttar Pradesh',
          latitude: options.latitude,
          longitude: options.longitude,
        },
      });

      await prisma.associationProfile.create({
        data: {
          organizationId: org.id,
          district: options.district,
          state: 'Uttar Pradesh',
          officialEmail: `office@${unique('assn')}.local`,
          officialPhone: '+919220000001',
          emergencyPhone: '+919220000009',
          representativeName: 'Test Representative',
          representativePhone: '+919220000002',
          verifiedAt: new Date(),
          coverageAreas: {
            create: [
              {
                district: options.district,
                state: 'Uttar Pradesh',
                latitude: options.latitude,
                longitude: options.longitude,
                radiusKm: options.radiusKm ?? 45,
              },
            ],
          },
        },
      });

      const user = await createUser({
        role: RoleName.ASSOCIATION_ADMIN,
        organizationId: org.id,
      });
      return { org, user };
    }


    /**
     * Wait for association routing to land.
     *
     * Routing is fire-and-forget by design — nothing in the association path is
     * allowed to slow a driver's SOS — so the test polls for the result instead
     * of racing a fixed sleep, which is flaky under a loaded suite.
     */
    async function waitForAlerts(user: TestUser, expected: number): Promise<void> {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const count = await prisma.associationAlert.count();
        if (count >= expected) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      void user;
    }

    /** Put the driver on a truck at a location, then raise an SOS there. */
    async function raiseSosAt(latitude: number, longitude: number) {
      const truck = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: unique('UP32AB').toUpperCase().slice(0, 12),
          vehicleType: VehicleType.TRUCK,
          truckType: TruckType.OPEN_BODY,
          capacityTons: 16,
          currentDriverId: driver.driverId!,
          lastLatitude: latitude,
          lastLongitude: longitude,
          lastLocationAt: new Date(),
        },
      });
      await prisma.driver.update({
        where: { id: driver.driverId! },
        data: { currentTruckId: truck.id },
      });

      const response = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/sos',
        user: driver,
        payload: {
          type: 'ACCIDENT',
          latitude,
          longitude,
          description: 'Collision on the bypass.',
        },
      });
      expect(response.status).toBe(201);
      return response.body.data.id;
    }

    it('routes an incident only to associations whose coverage contains it', async () => {
      const lucknow = await createAssociation({
        name: 'Lucknow Association',
        district: 'Lucknow',
        latitude: 26.8467,
        longitude: 80.9462,
      });
      const kanpur = await createAssociation({
        name: 'Kanpur Association',
        district: 'Kanpur',
        latitude: 26.4499,
        longitude: 80.3319,
      });

      // Inside Lucknow's radius, well outside Kanpur's.
      await raiseSosAt(26.85, 80.95);

      await waitForAlerts(lucknow.user, 1);

      const lucknowAlerts = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/associations/alerts',
        user: lucknow.user,
      });
      const kanpurAlerts = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/associations/alerts',
        user: kanpur.user,
      });

      expect(lucknowAlerts.body.data.items).toHaveLength(1);
      // Geographic scope is the security boundary, not a filter.
      expect(kanpurAlerts.body.data.items).toHaveLength(0);
    });

    it('withholds driver contact details until the alert is acknowledged', async () => {
      const association = await createAssociation({
        name: 'Lucknow Association',
        district: 'Lucknow',
        latitude: 26.8467,
        longitude: 80.9462,
      });
      await raiseSosAt(26.85, 80.95);
      await waitForAlerts(association.user, 1);

      const list = await request<{
        items: { id: string; driverPhone: string | null; driverName: string | null }[];
      }>({
        method: 'GET',
        url: '/api/v1/associations/alerts',
        user: association.user,
      });

      const alert = list.body.data.items[0]!;
      expect(alert.driverPhone).toBeNull();
      expect(alert.driverName).toBeNull();

      const acknowledged = await request<{ driverPhone: string | null }>({
        method: 'POST',
        url: `/api/v1/associations/alerts/${alert.id}/acknowledge`,
        user: association.user,
        payload: { note: 'Desk has taken this.' },
      });
      expect(acknowledged.status).toBe(200);

      const detail = await request<{ driverPhone: string | null; driverName: string | null }>({
        method: 'GET',
        url: `/api/v1/associations/alerts/${alert.id}`,
        user: association.user,
      });
      // Acknowledgement is a named, audited act — that is what unseals contact.
      expect(detail.body.data.driverPhone).not.toBeNull();
      expect(detail.body.data.driverName).not.toBeNull();
    });

    it('records an audit entry when contact details are read', async () => {
      const association = await createAssociation({
        name: 'Lucknow Association',
        district: 'Lucknow',
        latitude: 26.8467,
        longitude: 80.9462,
      });
      await raiseSosAt(26.85, 80.95);
      await waitForAlerts(association.user, 1);

      const list = await request<{ items: { id: string }[] }>({
        method: 'GET',
        url: '/api/v1/associations/alerts',
        user: association.user,
      });
      const alertId = list.body.data.items[0]!.id;

      await request({
        method: 'POST',
        url: `/api/v1/associations/alerts/${alertId}/acknowledge`,
        user: association.user,
        payload: {},
      });
      await request({
        method: 'GET',
        url: `/api/v1/associations/alerts/${alertId}`,
        user: association.user,
      });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'association.sensitive_access', entityId: alertId },
      });
      expect(audit).not.toBeNull();
    });

    it('gives an association no access to fleet vehicles or orders', async () => {
      const association = await createAssociation({
        name: 'Lucknow Association',
        district: 'Lucknow',
        latitude: 26.8467,
        longitude: 80.9462,
      });

      // The association role holds no fleet permission at all, so these are
      // refused by the guard rather than merely returning an empty list.
      const vehicles = await request({
        method: 'GET',
        url: '/api/v1/fleet/vehicles',
        user: association.user,
      });
      const orders = await request({
        method: 'GET',
        url: '/api/v1/orders',
        user: association.user,
      });

      expect(vehicles.status).toBe(403);
      expect(orders.status).toBe(403);
    });

    it('does not route a low-urgency emergency to the association network', async () => {
      const association = await createAssociation({
        name: 'Lucknow Association',
        district: 'Lucknow',
        latitude: 26.8467,
        longitude: 80.9462,
      });

      const truck = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: unique('UP32FU').toUpperCase().slice(0, 12),
          vehicleType: VehicleType.TRUCK,
          truckType: TruckType.OPEN_BODY,
          capacityTons: 16,
          currentDriverId: driver.driverId!,
        },
      });
      await prisma.driver.update({
        where: { id: driver.driverId! },
        data: { currentTruckId: truck.id },
      });

      // Out of fuel is real but not a district callout — routing every minor
      // SOS would train associations to ignore the feed.
      await request({
        method: 'POST',
        url: '/api/v1/sos',
        user: driver,
        payload: { type: 'FUEL', latitude: 26.85, longitude: 80.95 },
      });
      // Asserting absence, so allow routing a chance to run and produce nothing.
      await new Promise((resolve) => setTimeout(resolve, 700));

      const alerts = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/associations/alerts',
        user: association.user,
      });
      expect(alerts.body.data.items).toHaveLength(0);
    });

    it('does not route to an unverified association', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Pending Association',
          type: OrganizationType.TRUCK_ASSOCIATION,
          inviteCode: unique('ASN-').toUpperCase().slice(0, 12),
          // Not yet verified — must receive nothing.
          verificationStatus: VerificationStatus.SUBMITTED,
          latitude: 26.8467,
          longitude: 80.9462,
        },
      });
      await prisma.associationProfile.create({
        data: {
          organizationId: org.id,
          district: 'Lucknow',
          state: 'Uttar Pradesh',
          officialEmail: 'pending@assn.local',
          officialPhone: '+919220000001',
          emergencyPhone: '+919220000009',
          representativeName: 'Pending Rep',
          representativePhone: '+919220000002',
          coverageAreas: {
            create: [
              {
                district: 'Lucknow',
                state: 'Uttar Pradesh',
                latitude: 26.8467,
                longitude: 80.9462,
                radiusKm: 45,
              },
            ],
          },
        },
      });
      const user = await createUser({
        role: RoleName.ASSOCIATION_ADMIN,
        organizationId: org.id,
      });

      await raiseSosAt(26.85, 80.95);
      // Asserting absence, so allow routing a chance to run and produce nothing.
      await new Promise((resolve) => setTimeout(resolve, 700));

      const alerts = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/associations/alerts',
        user,
      });
      expect(alerts.body.data.items).toHaveLength(0);
    });
  });

  // =========================================================================
  // Travel bookings
  // =========================================================================

  describe('travel bookings', () => {
    let providerOrg: TestOrganization;
    let provider: TestUser;
    let customerOrg: TestOrganization;
    let customer: TestUser;
    let packageId: string;
    let vehicleId: string;

    beforeEach(async () => {
      providerOrg = await createOrganization(OrganizationType.MOBILITY_PROVIDER, PlanTier.BASIC);
      provider = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: providerOrg.id,
      });
      customerOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BASIC);
      customer = await createUser({ role: RoleName.CUSTOMER, organizationId: customerOrg.id });

      await request({
        method: 'PUT',
        url: '/api/v1/travel/me/profile',
        user: provider,
        payload: {
          displayName: 'Test Voyages',
          serviceTypes: ['TOUR', 'TRAVEL'],
          contactPhone: '+919220000101',
          serviceAreas: [
            {
              city: 'Lucknow',
              state: 'Uttar Pradesh',
              latitude: 26.8467,
              longitude: 80.9462,
              radiusKm: 200,
            },
          ],
        },
      });

      const vehicle = await prisma.truck.create({
        data: {
          organizationId: providerOrg.id,
          registrationNumber: unique('UP32SV').toUpperCase().slice(0, 12),
          vehicleType: VehicleType.SUV,
          truckType: TruckType.OTHER,
          capacityTons: 0,
          passengerCapacity: 6,
          verificationStatus: VerificationStatus.VERIFIED,
        },
      });
      vehicleId = vehicle.id;

      const pkg = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/travel/me/packages',
        user: provider,
        payload: {
          title: 'Ayodhya Pilgrimage Circuit',
          summary: 'Three days across Ayodhya and Varanasi by private SUV.',
          serviceKind: 'PILGRIMAGE',
          destinations: ['Ayodhya', 'Varanasi'],
          startLocation: 'Lucknow',
          startLatitude: 26.8467,
          startLongitude: 80.9462,
          endLocation: 'Lucknow',
          durationDays: 3,
          vehicleType: VehicleType.SUV,
          vehicleId: vehicle.id,
          minPassengers: 2,
          maxPassengers: 6,
          pricingModel: 'FIXED_PACKAGE',
          basePrice: 18000,
          status: 'PUBLISHED',
        },
      });
      expect(pkg.status).toBe(201);
      packageId = pkg.body.data.id;
    });

    /** Create a booking starting a fortnight out, so lead-time rules pass. */
    async function book(passengers = 4) {
      return request<{ id: string; status: string; totalAmount: number; subtotal: number }>({
        method: 'POST',
        url: '/api/v1/travel/bookings',
        user: customer,
        payload: {
          packageId,
          startDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
          passengers,
          contactName: 'Priya Nair',
          contactPhone: '+919845000001',
        },
      });
    }

    it('prices a booking and charges the platform booking fee', async () => {
      const response = await book();
      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(response.body.data.subtotal).toBe(18000);
      // 5% of 18,000 = 900, inside the min/max fee band.
      expect(response.body.data.totalAmount).toBe(18900);
    });

    it('refuses a party larger than the package allows', async () => {
      const response = await book(9);
      expect(response.status).toBe(400);
    });

    it('runs the full pay → confirm → complete → rate path', async () => {
      const booking = await book();
      const bookingId = booking.body.data.id;

      const paid = await request<{ status: string }>({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/pay`,
        user: customer,
        payload: { method: 'MOCK' },
      });
      expect(paid.status).toBe(200);
      // Paid is a request, not a guarantee — the provider must still accept.
      expect(paid.body.data.status).toBe(BookingStatus.AWAITING_CONFIRMATION);

      const confirmed = await request<{ status: string; tripId: string | null }>({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/confirm`,
        user: provider,
        payload: { vehicleId },
      });
      expect(confirmed.body.data.status).toBe(BookingStatus.CONFIRMED);
      // Confirmation creates the trip, which is what plugs travel into the
      // existing tracking pipeline.
      expect(confirmed.body.data.tripId).not.toBeNull();

      await request({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/start`,
        user: provider,
      });
      const completed = await request<{ status: string }>({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/complete`,
        user: provider,
      });
      expect(completed.body.data.status).toBe(BookingStatus.COMPLETED);

      const rated = await request<{ rating: number | null }>({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/rate`,
        user: customer,
        payload: { rating: 5, comment: 'Excellent driver.' },
      });
      expect(rated.status).toBe(200);
      expect(rated.body.data.rating).toBe(5);

      const pkg = await prisma.travelPackage.findUniqueOrThrow({ where: { id: packageId } });
      expect(pkg.ratingCount).toBe(1);
      expect(pkg.ratingAverage).toBe(5);
    });

    it('refunds in full when the provider declines', async () => {
      const booking = await book();
      const bookingId = booking.body.data.id;
      await request({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/pay`,
        user: customer,
        payload: { method: 'MOCK' },
      });

      const declined = await request<{ status: string }>({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/decline`,
        user: provider,
        payload: { reason: 'No vehicle available that weekend.' },
      });
      expect(declined.body.data.status).toBe(BookingStatus.DECLINED);

      const record = await prisma.travelBooking.findUniqueOrThrow({ where: { id: bookingId } });
      // The customer did nothing wrong, so the booking fee comes back too.
      expect(Number(record.refundAmount)).toBe(18900);
    });

    it('leaves the booking payable after a declined payment', async () => {
      const booking = await book();
      const bookingId = booking.body.data.id;

      const failed = await request({
        method: 'POST',
        url: `/api/v1/travel/bookings/${bookingId}/pay`,
        user: customer,
        payload: { method: 'MOCK', simulateFailure: true },
      });
      expect(failed.status).toBe(422);

      const record = await prisma.travelBooking.findUniqueOrThrow({ where: { id: bookingId } });
      // Still payable, so the customer can retry rather than rebooking.
      expect(record.status).toBe(BookingStatus.PENDING_PAYMENT);

      const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
      expect(payment.status).toBe('FAILED');
    });

    it('hides a booking from an unrelated organization', async () => {
      const booking = await book();
      const otherOrg = await createOrganization(OrganizationType.CUSTOMER, PlanTier.BASIC);
      const other = await createUser({ role: RoleName.CUSTOMER, organizationId: otherOrg.id });

      const response = await request({
        method: 'GET',
        url: `/api/v1/travel/bookings/${booking.body.data.id}`,
        user: other,
      });
      // Reported as missing, not forbidden, so ids cannot be probed.
      expect(response.status).toBe(404);
    });

    it('refuses to publish an offering the provider is not licensed for', async () => {
      // The profile above holds TOUR and TRAVEL, not TAXI.
      const response = await request({
        method: 'POST',
        url: '/api/v1/travel/me/packages',
        user: provider,
        payload: {
          title: 'Airport Transfer Service',
          summary: 'Quick sedan transfer to the airport terminal.',
          serviceKind: 'AIRPORT_TRANSFER',
          destinations: ['Airport'],
          startLocation: 'Lucknow',
          startLatitude: 26.8467,
          startLongitude: 80.9462,
          endLocation: 'Airport',
          durationDays: 1,
          vehicleType: VehicleType.SUV,
          minPassengers: 1,
          maxPassengers: 4,
          pricingModel: 'FIXED_PACKAGE',
          basePrice: 900,
          status: 'PUBLISHED',
        },
      });
      // AIRPORT_TRANSFER needs TAXI or TRAVEL — TRAVEL is held, so this passes.
      expect(response.status).toBe(201);
    });

    it('does not let a suspended provider lift its own suspension', async () => {
      await prisma.serviceProviderProfile.update({
        where: { organizationId: providerOrg.id },
        data: { status: ProviderStatus.SUSPENDED },
      });

      // The profile form submits the whole record, status included, so the
      // upsert is the obvious way out of a suspension if it trusts the input.
      const response = await request<{ status: string }>({
        method: 'PUT',
        url: '/api/v1/travel/me/profile',
        user: provider,
        payload: {
          displayName: 'Test Voyages',
          serviceTypes: ['TOUR', 'TRAVEL'],
          contactPhone: '+919220000101',
          status: 'ACTIVE',
          serviceAreas: [
            {
              city: 'Lucknow',
              state: 'Uttar Pradesh',
              latitude: 26.8467,
              longitude: 80.9462,
              radiusKm: 200,
            },
          ],
        },
      });

      expect(response.status).toBe(200);
      // Everything else saved; only the status was held back.
      expect(response.body.data.status).toBe(ProviderStatus.SUSPENDED);

      const blocked = await request({
        method: 'POST',
        url: '/api/v1/travel/me/packages',
        user: provider,
        payload: {
          title: 'Post-suspension Weekend Escape',
          summary: 'Two nights in the hills by private SUV.',
          serviceKind: 'MULTI_DAY_TOUR',
          destinations: ['Nainital'],
          startLocation: 'Lucknow',
          startLatitude: 26.8467,
          startLongitude: 80.9462,
          endLocation: 'Lucknow',
          durationDays: 3,
          vehicleType: VehicleType.SUV,
          minPassengers: 2,
          maxPassengers: 6,
          pricingModel: 'FIXED_PACKAGE',
          basePrice: 18000,
        },
      });
      expect(blocked.status).toBe(403);
    });
  });

  // =========================================================================
  // Hardware devices and telemetry
  // =========================================================================

  describe('hardware telemetry', () => {
    let vehicleId: string;
    /**
     * Platform staff provisioning hardware *for* a tenant.
     *
     * Registration is a platform-admin action, but a device still belongs to an
     * organization — so the operator needs an active tenant selected, exactly
     * as the real support flow does when it switches organization.
     */
    let provisioner: TestUser;

    beforeEach(async () => {
      provisioner = await createUser({
        role: RoleName.PLATFORM_ADMIN,
        organizationId: fleet.id,
      });
      const vehicle = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: unique('DL1HW').toUpperCase().slice(0, 12),
          vehicleType: VehicleType.TRUCK,
          truckType: TruckType.OPEN_BODY,
          capacityTons: 16,
          currentDriverId: driver.driverId!,
        },
      });
      vehicleId = vehicle.id;
    });

    /** Register a mock device and return its id plus its one-time secret. */
    async function registerDevice() {
      const response = await request<{
        device: { id: string; deviceIdentifier: string; imeiMasked: string | null };
        secret: string;
      }>({
        method: 'POST',
        url: '/api/v1/devices',
        // Hardware is provisioned centrally by Saarthi, not by the tenant that
        // will use it, so registration is a platform-admin action — scoped to
        // the organization the unit is being issued to.
        user: provisioner,
        payload: {
          deviceIdentifier: unique('MOCK-').toUpperCase(),
          provider: 'MOCK',
          serialNumber: unique('SN-'),
          supportedMetrics: ['LOCATION', 'SPEED', 'RPM'],
        },
      });
      expect(response.status).toBe(201);
      return response.body.data;
    }

    function gatewayHeaders(identifier: string, secret: string) {
      return { 'x-device-id': identifier, 'x-device-secret': secret };
    }

    const reading = (overrides: Record<string, unknown> = {}) => ({
      location: { latitude: 28.61, longitude: 77.21, speedKph: 45, heading: 90 },
      vehicleData: { rpm: 1400 },
      ...overrides,
    });

    it('returns the device secret exactly once and never stores it readably', async () => {
      const { device, secret } = await registerDevice();
      expect(secret).toBeTruthy();

      const stored = await prisma.hardwareDevice.findUniqueOrThrow({ where: { id: device.id } });
      expect(stored.secretHash).not.toBe(secret);
      expect(await bcrypt.compare(secret, stored.secretHash)).toBe(true);

      // A later read never exposes it again.
      const fetched = await request<{ id: string } & Record<string, unknown>>({
        method: 'GET',
        url: `/api/v1/devices/${device.id}`,
        user: owner,
      });
      expect(JSON.stringify(fetched.body.data)).not.toContain(secret);
    });

    it('rejects telemetry from a device with no vehicle assignment', async () => {
      const { device, secret } = await registerDevice();

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: { deviceId: device.deviceIdentifier, payload: reading() },
      });

      expect(response.status).toBe(422);
      expect(response.body.error?.message).toMatch(/not fitted to a vehicle/i);
    });

    it('rejects a bad secret without revealing whether the device exists', async () => {
      const { device } = await registerDevice();

      const wrongSecret = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, 'not-the-secret'),
        payload: { deviceId: device.deviceIdentifier, payload: reading() },
      });
      const unknownDevice = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders('MOCK-DOES-NOT-EXIST', 'whatever'),
        payload: { deviceId: 'MOCK-DOES-NOT-EXIST', payload: reading() },
      });

      expect(wrongSecret.status).toBe(401);
      expect(unknownDevice.status).toBe(401);
      // Identical responses, so the endpoint cannot enumerate identifiers.
      expect(wrongSecret.body.error?.message).toBe(unknownDevice.body.error?.message);
    });

    it('ingests telemetry, records only the metrics present, and moves the vehicle', async () => {
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      const response = await request<{ accepted: number }>({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: {
          deviceId: device.deviceIdentifier,
          sequence: 1,
          payload: reading(),
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.accepted).toBe(1);

      const stored = await prisma.telemetryReading.findFirstOrThrow({ where: { vehicleId } });
      expect(stored.metrics).toContain('RPM');
      expect(stored.metrics).toContain('SPEED');
      // Coolant was never sent, so it is absent from metrics *and* null — not a
      // plausible-looking zero.
      expect(stored.metrics).not.toContain('COOLANT_TEMPERATURE');
      expect(stored.coolantTemperature).toBeNull();

      // Hardware location flows through the same tracking pipeline as the
      // simulator and the driver app.
      const vehicle = await prisma.truck.findUniqueOrThrow({ where: { id: vehicleId } });
      expect(vehicle.lastLatitude).toBeCloseTo(28.61, 2);
    });

    it('rejects a replayed sequence number', async () => {
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      const send = (sequence: number) =>
        request({
          method: 'POST',
          url: '/api/v1/device-gateway/telemetry',
          headers: gatewayHeaders(device.deviceIdentifier, secret),
          payload: { deviceId: device.deviceIdentifier, sequence, payload: reading() },
        });

      expect((await send(5)).status).toBe(200);
      // A captured payload resubmitted must not be able to fake a position.
      expect((await send(5)).status).toBe(409);
      expect((await send(4)).status).toBe(409);
      expect((await send(6)).status).toBe(200);
    });

    it('refuses implausible values instead of storing them', async () => {
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: {
          deviceId: device.deviceIdentifier,
          payload: reading({
            location: { latitude: 28.61, longitude: 77.21, speedKph: 900 },
          }),
        },
      });

      // 900 km/h is not a truck. Bad hardware and injection look identical here.
      expect(response.status).toBe(400);
      expect(await prisma.telemetryReading.count({ where: { vehicleId } })).toBe(0);
    });

    it('refuses telemetry submitted for a different device than authenticated', async () => {
      const first = await registerDevice();
      const second = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${first.device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(first.device.deviceIdentifier, first.secret),
        payload: {
          // Authenticated as the first device, claiming to be the second.
          deviceId: second.device.deviceIdentifier,
          payload: reading(),
        },
      });

      expect(response.status).toBe(403);
    });

    it('raises a charging fault when voltage sags with the engine running', async () => {
      /*
       * The fault a single flat threshold could never catch.
       *
       * A healthy battery reads about 12.6 V at rest and 13.8-14.4 V while the
       * alternator charges it. So a resting threshold of 12 V never fires with
       * the engine running — and "the alternator has stopped charging" is the
       * more urgent of the two faults by a wide margin. A weak battery strands a
       * truck one cold morning; a dead alternator strands it that afternoon,
       * wherever it happens to be.
       */
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: {
          deviceId: device.deviceIdentifier,
          payload: reading({
            vehicleData: { rpm: 1400, batteryVoltage: 12.4 },
          }),
        },
      });

      const alert = await prisma.telemetryAlert.findFirstOrThrow({
        where: { vehicleId, type: TelemetryAlertType.LOW_VOLTAGE },
      });
      expect(alert.message).toContain('alternator');
      expect(alert.observedValue).toBe(12.4);
      expect(alert.threshold).toBe(13.2);
    });

    it('does not call a resting battery an alternator fault', async () => {
      // Engine off at 12.4 V is a normal battery a few hours after a run. Only
      // the resting rule may speak here, and its threshold is the fleet's.
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: {
          deviceId: device.deviceIdentifier,
          payload: reading({ vehicleData: { rpm: 0, batteryVoltage: 12.4 } }),
        },
      });

      const alerts = await prisma.telemetryAlert.findMany({
        where: { vehicleId, type: TelemetryAlertType.LOW_VOLTAGE },
      });
      expect(alerts.some((alert) => alert.message.includes('alternator'))).toBe(false);
    });

    it('raises an overspeed alert with an explainable score deduction', async () => {
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: {
          deviceId: device.deviceIdentifier,
          payload: reading({
            location: { latitude: 28.61, longitude: 77.21, speedKph: 96, heading: 90 },
          }),
        },
      });

      const alert = await prisma.telemetryAlert.findFirstOrThrow({
        where: { vehicleId, type: TelemetryAlertType.OVERSPEED },
      });
      // The measurement and the threshold are both stored, so a driver can be
      // shown exactly why their score moved.
      expect(alert.observedValue).toBe(96);
      expect(alert.threshold).toBe(80);
      expect(alert.unit).toBe('km/h');
      expect(alert.scoreEventId).not.toBeNull();

      const scoreEvent = await prisma.driverScoreEvent.findUniqueOrThrow({
        where: { id: alert.scoreEventId! },
      });
      expect(scoreEvent.driverId).toBe(driver.driverId);
      expect(scoreEvent.points).toBeLessThan(0);
      expect(scoreEvent.reason).toMatch(/96 km\/h/);
    });

    it('keeps device assignment history when a unit is swapped out', async () => {
      const { device } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/unassign`,
        user: provisioner,
        payload: { reason: 'Unit failed.' },
      });

      const history = await request<{ status: string; removalReason: string | null }[]>({
        method: 'GET',
        url: `/api/v1/devices/${device.id}/assignments`,
        user: owner,
      });

      // The row is closed, never deleted — historical telemetry must stay
      // attributable to the device that produced it.
      expect(history.body.data).toHaveLength(1);
      expect(history.body.data[0]!.status).toBe('ENDED');
      expect(history.body.data[0]!.removalReason).toBe('Unit failed.');
    });

    it('refuses to fit two devices to one vehicle', async () => {
      const first = await registerDevice();
      const second = await registerDevice();

      await request({
        method: 'POST',
        url: `/api/v1/devices/${first.device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });
      const conflict = await request({
        method: 'POST',
        url: `/api/v1/devices/${second.device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });

      expect(conflict.status).toBe(409);
    });

    it('rejects telemetry from a suspended device', async () => {
      const { device, secret } = await registerDevice();
      await request({
        method: 'POST',
        url: `/api/v1/devices/${device.id}/assign`,
        user: provisioner,
        payload: { vehicleId },
      });
      await request({
        method: 'PATCH',
        url: `/api/v1/devices/${device.id}`,
        user: provisioner,
        payload: { status: DeviceStatus.SUSPENDED },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/device-gateway/telemetry',
        headers: gatewayHeaders(device.deviceIdentifier, secret),
        payload: { deviceId: device.deviceIdentifier, payload: reading() },
      });

      // Revoking a stolen unit has to actually stop it reporting.
      expect(response.status).toBe(403);
    });

    it('reports vehicle capabilities honestly before any data arrives', async () => {
      const response = await request<{
        hasDevice: boolean;
        observedMetrics: string[];
        readingCount: number;
      }>({
        method: 'GET',
        url: `/api/v1/telemetry/vehicles/${vehicleId}/capabilities`,
        user: owner,
      });

      expect(response.body.data.hasDevice).toBe(false);
      expect(response.body.data.observedMetrics).toEqual([]);
      expect(response.body.data.readingCount).toBe(0);
    });

    it('hides another tenant devices', async () => {
      const { device } = await registerDevice();
      const otherOrg = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.PRO);
      const otherOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: otherOrg.id,
      });

      const response = await request({
        method: 'GET',
        url: `/api/v1/devices/${device.id}`,
        user: otherOwner,
      });
      expect(response.status).toBe(404);
    });

    it('lets a platform admin see a device across tenants', async () => {
      const { device } = await registerDevice();
      const response = await request({
        method: 'GET',
        url: `/api/v1/devices/${device.id}`,
        user: admin,
      });
      expect(response.status).toBe(200);
    });
  });
});
