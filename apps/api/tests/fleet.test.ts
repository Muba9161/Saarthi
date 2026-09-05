import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MediaOwnerType,
  MediaPurpose,
  OrganizationType,
  PLAN_LIMITS,
  PlanTier,
  RoleName,
  TruckStatus,
  TruckType,
  VerificationStatus,
} from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import {
  closeApp,
  createOrganization,
  createUser,
  getApp,
  multipart,
  request,
  resetDatabase,
  sampleJpeg,
  unique,
  type TestOrganization,
  type TestUser,
} from './helpers';

describe('Fleet management', () => {
  let fleetA: TestOrganization;
  let fleetB: TestOrganization;
  let ownerA: TestUser;
  let managerA: TestUser;
  let ownerB: TestUser;
  let driverUser: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleetA = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    fleetB = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    ownerA = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetA.id });
    managerA = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleetA.id });
    ownerB = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetB.id });
    driverUser = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleetA.id,
      driver: true,
    });
    admin = await createUser({ role: RoleName.PLATFORM_ADMIN, organizationId: null });
  });

  const truckPayload = (overrides: Record<string, unknown> = {}) => ({
    registrationNumber: unique('DL01AB').toUpperCase().slice(0, 12),
    truckType: TruckType.TIPPER,
    manufacturer: 'Tata Motors',
    model: 'Signa 4825.TK',
    year: 2022,
    capacityTons: 25,
    ...overrides,
  });

  describe('truck CRUD', () => {
    it('creates a truck scoped to the caller organization', async () => {
      const { status, body } = await request<{ id: string; registrationNumber: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload({ registrationNumber: 'UP 16 AB 1234' }),
      });

      expect(status).toBe(201);
      // Registration numbers are normalised on the way in.
      expect(body.data.registrationNumber).toBe('UP16AB1234');

      const stored = await prisma.truck.findUnique({ where: { id: body.data.id } });
      expect(stored?.organizationId).toBe(fleetA.id);
      expect(stored?.status).toBe(TruckStatus.AVAILABLE);
      expect(stored?.verificationStatus).toBe(VerificationStatus.PENDING);
    });

    it('accepts a photo onto a vehicle the moment it has been created', async () => {
      // The add-vehicle form holds the photograph while the registration is
      // saved, because media is addressed to an owner id that does not exist
      // until then. This is the second call it makes.
      const vehicle = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload({ registrationNumber: 'UP16PH0101' }),
      });
      expect(vehicle.status).toBe(201);

      const body = multipart(
        {
          ownerType: MediaOwnerType.VEHICLE,
          ownerId: vehicle.body.data.id,
          purpose: MediaPurpose.VEHICLE_EXTERIOR,
        },
        {
          fieldName: 'file',
          fileName: 'lorry.jpg',
          contentType: 'image/jpeg',
          content: sampleJpeg(2_048),
        },
      );

      const upload = await request<{ ownerId: string }>({
        method: 'POST',
        url: '/api/v1/media',
        user: ownerA,
        payload: body.payload,
        headers: body.headers,
      });

      expect(upload.status).toBe(201);
      expect(upload.body.data.ownerId).toBe(vehicle.body.data.id);
    });

    it('rejects a duplicate registration number', async () => {
      const payload = truckPayload({ registrationNumber: 'HR26CD9999' });
      await request({ method: 'POST', url: '/api/v1/trucks', user: ownerA, payload });
      const second = await request({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerB,
        payload,
      });

      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe('DUPLICATE_RESOURCE');
    });

    it('validates capacity and registration format', async () => {
      const badCapacity = await request({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload({ capacityTons: 0 }),
      });
      expect(badCapacity.status).toBe(400);

      const badPlate = await request({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload({ registrationNumber: 'A!' }),
      });
      expect(badPlate.status).toBe(400);
    });

    it('lists, filters and paginates trucks', async () => {
      for (let index = 0; index < 3; index += 1) {
        await request({
          method: 'POST',
          url: '/api/v1/trucks',
          user: ownerA,
          payload: truckPayload({ registrationNumber: `DL01ZZ100${index}` }),
        });
      }

      const listed = await request<{ items: unknown[]; pagination: { total: number } }>({
        method: 'GET',
        url: '/api/v1/trucks?pageSize=2',
        user: ownerA,
      });

      expect(listed.status).toBe(200);
      expect(listed.body.data.items).toHaveLength(2);
      expect(listed.body.data.pagination.total).toBe(3);

      const filtered = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/trucks?status=MAINTENANCE',
        user: ownerA,
      });
      expect(filtered.body.data.items).toHaveLength(0);
    });

    it('archives a truck instead of deleting the record', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });

      const archived = await request({
        method: 'DELETE',
        url: `/api/v1/trucks/${createdTruck.body.data.id}`,
        user: ownerA,
      });
      expect(archived.status).toBe(200);

      const stored = await prisma.truck.findUnique({ where: { id: createdTruck.body.data.id } });
      expect(stored).not.toBeNull();
      expect(stored?.archivedAt).not.toBeNull();

      const listed = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/trucks',
        user: ownerA,
      });
      expect(listed.body.data.items).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('does not list another organization trucks', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });

      const otherFleet = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/trucks',
        user: ownerB,
      });

      expect(otherFleet.body.data.items).toHaveLength(0);
    });

    it('returns 404 (not 403) when reading another organization truck', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });

      const foreign = await request({
        method: 'GET',
        url: `/api/v1/trucks/${createdTruck.body.data.id}`,
        user: ownerB,
      });

      // 404 rather than 403 so ids cannot be enumerated across tenants.
      expect(foreign.status).toBe(404);
    });

    it('refuses to update another organization truck', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });

      const foreign = await request({
        method: 'PATCH',
        url: `/api/v1/trucks/${createdTruck.body.data.id}`,
        user: ownerB,
        payload: { capacityTons: 40 },
      });

      expect(foreign.status).toBe(404);
      const unchanged = await prisma.truck.findUnique({ where: { id: createdTruck.body.data.id } });
      expect(unchanged?.capacityTons).toBe(25);
    });

    it('lets a platform admin read across tenants', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });

      const asAdmin = await request({
        method: 'GET',
        url: `/api/v1/trucks/${createdTruck.body.data.id}`,
        user: admin,
      });
      expect(asAdmin.status).toBe(200);
    });
  });

  describe('role-based access control', () => {
    it('allows a fleet manager to create but not delete a truck', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: managerA,
        payload: truckPayload(),
      });
      expect(createdTruck.status).toBe(201);

      const deleted = await request({
        method: 'DELETE',
        url: `/api/v1/trucks/${createdTruck.body.data.id}`,
        user: managerA,
      });
      expect(deleted.status).toBe(403);
      expect(deleted.body.error?.code).toBe('FORBIDDEN');
    });

    it('blocks a driver from creating trucks', async () => {
      const { status, body } = await request({
        method: 'POST',
        url: '/api/v1/trucks',
        user: driverUser,
        payload: truckPayload(),
      });

      expect(status).toBe(403);
      expect(body.error?.code).toBe('FORBIDDEN');
    });
  });

  describe('subscription limits', () => {
    it('stops a Basic plan fleet at its vehicle capacity', async () => {
      const smallFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
      const smallOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: smallFleet.id,
      });

      // Derived from the catalogue rather than hard-coded: the plan lineup is
      // sold by fleet size and those numbers move, but the rule does not.
      const capacity = PLAN_LIMITS[PlanTier.BASIC].maxTrucks ?? 0;

      for (let index = 0; index < capacity; index += 1) {
        const response = await request({
          method: 'POST',
          url: '/api/v1/trucks',
          user: smallOwner,
          payload: truckPayload({ registrationNumber: `MH12AA10${index}0` }),
        });
        expect(response.status).toBe(201);
      }

      const overCapacity = await request({
        method: 'POST',
        url: '/api/v1/trucks',
        user: smallOwner,
        payload: truckPayload({ registrationNumber: 'MH12AA9999' }),
      });

      expect(overCapacity.status).toBe(403);
      expect(overCapacity.body.error?.code).toBe('PLAN_LIMIT_REACHED');
    });

    it('gates driver scoring behind the subscription plan', async () => {
      const basicFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
      const basicOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: basicFleet.id,
      });
      const basicDriver = await createUser({
        role: RoleName.DRIVER,
        organizationId: basicFleet.id,
        driver: true,
      });

      const denied = await request({
        method: 'GET',
        url: `/api/v1/drivers/${basicDriver.driverId}/score`,
        user: basicOwner,
      });
      expect(denied.status).toBe(403);
      expect(denied.body.error?.code).toBe('FEATURE_NOT_AVAILABLE');

      // The same call succeeds on a plan that includes scoring.
      const allowed = await request({
        method: 'GET',
        url: `/api/v1/drivers/${driverUser.driverId}/score`,
        user: ownerA,
      });
      expect(allowed.status).toBe(200);
    });
  });

  describe('driver management and assignment', () => {
    it('creates a driver account with a one-time set-password link', async () => {
      const { status, body } = await request<{
        driver: { id: string; email: string };
        setupToken?: string;
      }>({
        method: 'POST',
        url: '/api/v1/drivers',
        user: ownerA,
        payload: {
          firstName: 'Ramesh',
          lastName: 'Kumar',
          email: `${unique('newdriver')}@test.local`,
          phone: `+9198${String(Date.now()).slice(-8)}`,
          licenseNumber: unique('DL-'),
          experienceYears: 6,
        },
      });

      expect(status).toBe(201);
      expect(body.data.setupToken).toBeTruthy();

      const driver = await prisma.driver.findUnique({ where: { id: body.data.driver.id } });
      expect(driver?.organizationId).toBe(fleetA.id);
      expect(driver?.verificationStatus).toBe(VerificationStatus.PENDING);
    });

    it('accepts a photo onto a driver the moment the account has been created', async () => {
      const created = await request<{ driver: { id: string } }>({
        method: 'POST',
        url: '/api/v1/drivers',
        user: ownerA,
        payload: {
          firstName: 'Sunil',
          lastName: 'Yadav',
          email: `${unique('photodriver')}@test.local`,
          phone: `+9197${String(Date.now()).slice(-8)}`,
          licenseNumber: unique('DL-'),
          experienceYears: 3,
        },
      });
      expect(created.status).toBe(201);

      const body = multipart(
        {
          ownerType: MediaOwnerType.DRIVER,
          ownerId: created.body.data.driver.id,
          purpose: MediaPurpose.AVATAR,
        },
        {
          fieldName: 'file',
          fileName: 'sunil.jpg',
          contentType: 'image/jpeg',
          content: sampleJpeg(2_048),
        },
      );

      const upload = await request<{ ownerId: string }>({
        method: 'POST',
        url: '/api/v1/media',
        user: ownerA,
        payload: body.payload,
        headers: body.headers,
      });

      expect(upload.status).toBe(201);
      expect(upload.body.data.ownerId).toBe(created.body.data.driver.id);
    });

    it('refuses to assign an unverified driver', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });

      await prisma.driver.update({
        where: { id: driverUser.driverId! },
        data: { verificationStatus: VerificationStatus.PENDING },
      });

      const { status, body } = await request({
        method: 'POST',
        url: `/api/v1/trucks/${createdTruck.body.data.id}/assign-driver`,
        user: ownerA,
        payload: { driverId: driverUser.driverId },
      });

      expect(status).toBe(422);
      expect(body.error?.message).toMatch(/verification/i);
    });

    it('assigns a verified driver and records the assignment history', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerA,
        payload: truckPayload(),
      });
      const truckId = createdTruck.body.data.id;

      const assigned = await request<{ currentDriver: { id: string } | null; status: string }>({
        method: 'POST',
        url: `/api/v1/trucks/${truckId}/assign-driver`,
        user: ownerA,
        payload: { driverId: driverUser.driverId, note: 'Primary assignment' },
      });

      expect(assigned.status).toBe(200);
      expect(assigned.body.data.currentDriver?.id).toBe(driverUser.driverId);
      expect(assigned.body.data.status).toBe(TruckStatus.ASSIGNED);

      const history = await request<{ length: number }[]>({
        method: 'GET',
        url: `/api/v1/trucks/${truckId}/assignments`,
        user: ownerA,
      });
      expect(Array.isArray(history.body.data)).toBe(true);
      expect((history.body.data as unknown[]).length).toBe(1);

      const unassigned = await request<{ currentDriver: unknown; status: string }>({
        method: 'POST',
        url: `/api/v1/trucks/${truckId}/unassign-driver`,
        user: ownerA,
      });
      expect(unassigned.body.data.currentDriver).toBeNull();
      expect(unassigned.body.data.status).toBe(TruckStatus.AVAILABLE);

      const closed = await prisma.truckAssignment.findMany({ where: { truckId } });
      expect(closed).toHaveLength(1);
      expect(closed[0]?.status).toBe('ENDED');
      expect(closed[0]?.unassignedAt).not.toBeNull();
    });

    it('refuses to assign a driver from another organization', async () => {
      const createdTruck = await request<{ id: string }>({
        method: 'POST',
        url: '/api/v1/trucks',
        user: ownerB,
        payload: truckPayload(),
      });

      const { status } = await request({
        method: 'POST',
        url: `/api/v1/trucks/${createdTruck.body.data.id}/assign-driver`,
        user: ownerB,
        payload: { driverId: driverUser.driverId },
      });

      expect(status).toBe(404);
    });
  });

  describe('driver scoring', () => {
    it('produces an explainable score with every change attributed', async () => {
      const adjusted = await request<{ overall: number; recentEvents: { reason: string }[] }>({
        method: 'POST',
        url: `/api/v1/drivers/${driverUser.driverId}/score/adjust`,
        user: ownerA,
        payload: {
          category: 'SAFETY',
          points: -5,
          reason: 'Speeding recorded on the Delhi-Jaipur corridor.',
        },
      });

      expect(adjusted.status).toBe(200);
      expect(adjusted.body.data.recentEvents[0]?.reason).toBe(
        'Speeding recorded on the Delhi-Jaipur corridor.',
      );

      const score = await request<{ overall: number; categories: { SAFETY: number } }>({
        method: 'GET',
        url: `/api/v1/drivers/${driverUser.driverId}/score`,
        user: ownerA,
      });

      // Baseline 75 minus the 5-point safety deduction.
      expect(score.body.data.categories.SAFETY).toBe(70);
      expect(score.body.data.overall).toBeGreaterThan(0);
    });

    it('rejects an adjustment without a reason', async () => {
      const { status } = await request({
        method: 'POST',
        url: `/api/v1/drivers/${driverUser.driverId}/score/adjust`,
        user: ownerA,
        payload: { category: 'SAFETY', points: -5, reason: 'bad' },
      });
      expect(status).toBe(400);
    });
  });
});
