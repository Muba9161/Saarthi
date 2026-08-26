import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MaintenanceType,
  OrganizationType,
  PlanTier,
  RoleName,
  ServiceCategory,
  ServiceComponent,
  TruckType,
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
 * Service history.
 *
 * The assertions that matter most are about provenance: an imported record is
 * not a verified one, a partial history says it is partial, and an external
 * source that disagrees with the fleet's own record raises a conflict instead
 * of quietly winning.
 */
describe('Service history', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let owner: TestUser;
  let otherOwner: TestUser;
  let vehicle: { id: string; registrationNumber: string };

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    otherFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
    otherOwner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: otherFleet.id });

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: unique('UP32AB').toUpperCase().slice(0, 12),
        truckType: TruckType.TIPPER,
        capacityTons: 25,
        odometerKm: 100_000,
      },
    });
    vehicle = { id: truck.id, registrationNumber: truck.registrationNumber };
  });

  const DAY = 86_400_000;
  const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

  const servicePayload = (overrides: Record<string, unknown> = {}) => ({
    vehicleId: vehicle.id,
    type: MaintenanceType.BRAKE,
    category: ServiceCategory.BRAKES,
    title: 'Brake liner replacement — rear axle',
    serviceDate: daysAgo(10),
    odometerKm: 101_500,
    engineHours: 4_200,
    workshopName: 'Highway Motors',
    workshopAddress: 'NH-19, Kanpur',
    mechanicName: 'Suresh',
    labourCost: 3_000,
    partsCost: 11_200,
    invoiceNumber: 'INV-2026-8891',
    parts: [
      {
        name: 'Brake liner set',
        partNumber: 'BL-4421',
        component: ServiceComponent.BRAKE_LINER,
        quantity: 2,
        unitCost: 5_600,
        warrantyMonths: 6,
      },
    ],
    replacedComponents: [ServiceComponent.BRAKE_LINER],
    diagnosticCodes: ['P0571'],
    ...overrides,
  });

  interface RecordBody {
    id: string;
    title: string;
    totalCost: number | null;
    labourCost: number | null;
    partsCost: number | null;
    odometerKm: number | null;
    engineHours: number | null;
    invoiceNumber: string | null;
    parts: { name: string; component: string | null }[];
    replacedComponents: string[];
    diagnosticCodes: string[];
    source: string;
    verificationStatus: string;
    needsReview: boolean;
    warrantyActive: boolean;
    conflictNote: string | null;
    status: string;
  }

  const fileService = (overrides: Record<string, unknown> = {}, user: TestUser = owner) =>
    request<RecordBody>({
      method: 'POST',
      url: '/api/v1/service-history',
      user,
      payload: servicePayload(overrides),
    });

  // -------------------------------------------------------------------------

  describe('filing a service', () => {
    it('records the whole invoice', async () => {
      const { status, body } = await fileService();

      expect(status).toBe(201);
      expect(body.data.title).toBe('Brake liner replacement — rear axle');
      expect(body.data.invoiceNumber).toBe('INV-2026-8891');
      expect(body.data.engineHours).toBe(4_200);
      expect(body.data.parts[0]?.component).toBe(ServiceComponent.BRAKE_LINER);
      expect(body.data.diagnosticCodes).toEqual(['P0571']);
      // Filed after the fact, so it lands completed rather than scheduled.
      expect(body.data.status).toBe('COMPLETED');
    });

    it('totals the invoice split when no total is given', async () => {
      const { body } = await fileService({ taxAmount: 800 });
      expect(body.data.totalCost).toBe(3_000 + 11_200 + 800);
    });

    it('keeps the caller total when the invoice does not add up', async () => {
      // Discounts, rounding and part-payments are normal; the invoice wins.
      const { body } = await fileService({ totalCost: 13_500 });
      expect(body.data.totalCost).toBe(13_500);
    });

    it('advances the vehicle odometer, and never rewinds it', async () => {
      await fileService({ odometerKm: 105_000 });
      const forward = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(forward.odometerKm).toBe(105_000);

      // A service filed late, with an older reading, must not move it back.
      await fileService({ odometerKm: 99_000, serviceDate: daysAgo(200) });
      const unchanged = await prisma.truck.findUniqueOrThrow({ where: { id: vehicle.id } });
      expect(unchanged.odometerKm).toBe(105_000);
    });

    it('treats a record the fleet typed itself as its own statement', async () => {
      const { body } = await fileService();
      expect(body.data.source).toBe('MANUAL');
      // Unverified, but not flagged for review: it is first-hand, and there is
      // nobody better placed to confirm it than the person who filed it.
      expect(body.data.verificationStatus).toBe('UNVERIFIED');
      expect(body.data.needsReview).toBe(false);
    });

    it('reports an active warranty', async () => {
      const { body } = await fileService({
        warrantyUntil: new Date(Date.now() + 90 * DAY).toISOString(),
      });
      expect(body.data.warrantyActive).toBe(true);
    });

    it('refuses a record against another tenant vehicle', async () => {
      const response = await fileService({}, otherOwner);
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------

  describe('timeline', () => {
    interface TimelineBody {
      registrationNumber: string;
      records: RecordBody[];
      health: { health: string; reasons: string[]; basis: string };
      spend: { total: number; labour: number; parts: number; recordCount: number; costPerKm: number | null };
      costTrend: { direction: string; changePercent: number | null };
      repeated: { component: string; occurrences: number; label: string }[];
      lastServiceAt: string | null;
      coverageNote: string;
    }

    const timeline = (user: TestUser = owner) =>
      request<TimelineBody>({
        method: 'GET',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/service-history`,
        user,
      });

    it('says plainly that no service is on record', async () => {
      const { status, body } = await timeline();
      expect(status).toBe(200);
      // Not "Healthy". An absence of records is not evidence of maintenance.
      expect(body.data.health.health).toBe('No service recorded');
      expect(body.data.records).toHaveLength(0);
    });

    it('summarises spend across the history', async () => {
      await fileService();
      await fileService({
        title: 'Engine oil and filters',
        type: MaintenanceType.OIL_CHANGE,
        category: ServiceCategory.ROUTINE,
        serviceDate: daysAgo(120),
        odometerKm: 95_000,
        labourCost: 900,
        partsCost: 7_500,
        replacedComponents: [ServiceComponent.ENGINE_OIL, ServiceComponent.OIL_FILTER],
        parts: [],
      });

      const { body } = await timeline();
      expect(body.data.records).toHaveLength(2);
      expect(body.data.spend.recordCount).toBe(2);
      expect(body.data.spend.total).toBe(14_200 + 8_400);
      expect(body.data.spend.labour).toBe(3_900);
      // Cost per km uses the distance the records actually span, not lifetime.
      expect(body.data.spend.costPerKm).toBeGreaterThan(0);
    });

    it('flags a component replaced twice, and ignores routine consumables', async () => {
      await fileService({ serviceDate: daysAgo(300), odometerKm: 90_000 });
      await fileService({ serviceDate: daysAgo(40), odometerKm: 101_000 });
      // Oil is replaced at every service by design — flagging it would bury
      // the signal under routine work.
      await fileService({
        title: 'Oil change',
        serviceDate: daysAgo(20),
        replacedComponents: [ServiceComponent.ENGINE_OIL],
        parts: [],
      });
      await fileService({
        title: 'Oil change',
        serviceDate: daysAgo(10),
        replacedComponents: [ServiceComponent.ENGINE_OIL],
        parts: [],
      });

      const { body } = await timeline();
      const components = body.data.repeated.map((entry) => entry.component);
      expect(components).toContain(ServiceComponent.BRAKE_LINER);
      expect(components).not.toContain(ServiceComponent.ENGINE_OIL);
      expect(body.data.repeated[0]?.occurrences).toBe(2);
    });

    it('reports an unknown cost trend rather than a fake increase', async () => {
      await fileService({ serviceDate: daysAgo(5) });
      const { body } = await timeline();
      // Nothing in the previous window: a first service is not a 100% rise.
      expect(body.data.costTrend.direction).toBe('UNKNOWN');
      expect(body.data.costTrend.changePercent).toBeNull();
    });

    it('says what the history does not cover', async () => {
      const { body } = await timeline();
      expect(body.data.coverageNote.length).toBeGreaterThan(20);
      expect(body.data.coverageNote).toContain('not connected');
    });

    it('marks a vehicle overdue when a scheduled job has passed', async () => {
      await prisma.maintenanceRecord.create({
        data: {
          truckId: vehicle.id,
          organizationId: fleet.id,
          type: MaintenanceType.PREVENTIVE,
          title: 'Scheduled service',
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() - 5 * DAY),
        },
      });

      const { body } = await timeline();
      expect(body.data.health.health).toBe('Service overdue');
      expect(body.data.health.reasons[0]).toContain('past the due date');
    });

    it('does not expose a timeline across tenants', async () => {
      await fileService();
      const response = await timeline(otherOwner);
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------

  describe('verification', () => {
    it('is the only path to a verified record', async () => {
      const filed = await fileService();
      expect(filed.body.data.verificationStatus).toBe('UNVERIFIED');

      const verified = await request<RecordBody>({
        method: 'POST',
        url: `/api/v1/service-history/${filed.body.data.id}/verify`,
        user: owner,
        payload: { verificationStatus: 'VERIFIED' },
      });

      expect(verified.status).toBe(200);
      expect(verified.body.data.verificationStatus).toBe('VERIFIED');
      expect(verified.body.data.needsReview).toBe(false);
    });

    it('surfaces records still waiting on a person', async () => {
      const filed = await fileService();
      await prisma.maintenanceRecord.update({
        where: { id: filed.body.data.id },
        data: { verificationStatus: 'PENDING_REVIEW', source: 'DOCUMENT_EXTRACTION' },
      });

      const { body } = await request<{ items: RecordBody[] }>({
        method: 'GET',
        url: '/api/v1/service-history?needsReview=true',
        user: owner,
      });

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.needsReview).toBe(true);
    });

    it('can reject a record that turned out to be wrong', async () => {
      const filed = await fileService();
      const rejected = await request<RecordBody>({
        method: 'POST',
        url: `/api/v1/service-history/${filed.body.data.id}/verify`,
        user: owner,
        payload: { verificationStatus: 'REJECTED', note: 'Invoice belongs to another vehicle.' },
      });

      expect(rejected.body.data.verificationStatus).toBe('REJECTED');
      expect(rejected.body.data.conflictNote).toContain('another vehicle');
    });
  });

  // -------------------------------------------------------------------------

  describe('external retrieval', () => {
    it('explains that Saarthi is not connected rather than reporting no history', async () => {
      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/vehicles/${vehicle.id}/service-history/sync`,
        user: owner,
        payload: {},
      });

      // "No records found" would read as *this truck has never been serviced*.
      expect(response.status).toBe(503);
      expect(response.body.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(response.body.error?.message).toContain('not connected');
    });
  });

  // -------------------------------------------------------------------------

  describe('filtering', () => {
    it('filters by category', async () => {
      await fileService();
      await fileService({
        title: 'Oil change',
        type: MaintenanceType.OIL_CHANGE,
        category: ServiceCategory.ROUTINE,
        parts: [],
        replacedComponents: [ServiceComponent.ENGINE_OIL],
      });

      const { body } = await request<{ items: RecordBody[] }>({
        method: 'GET',
        url: `/api/v1/service-history?category=${ServiceCategory.BRAKES}`,
        user: owner,
      });

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0]?.title).toContain('Brake');
    });

    it('searches the workshop and the invoice number', async () => {
      await fileService();

      const byWorkshop = await request<{ items: RecordBody[] }>({
        method: 'GET',
        url: '/api/v1/service-history?search=Highway',
        user: owner,
      });
      expect(byWorkshop.body.data.items).toHaveLength(1);

      const byInvoice = await request<{ items: RecordBody[] }>({
        method: 'GET',
        url: '/api/v1/service-history?search=8891',
        user: owner,
      });
      expect(byInvoice.body.data.items).toHaveLength(1);
    });

    it('keeps one fleet history out of another', async () => {
      await fileService();
      const { body } = await request<{ items: RecordBody[] }>({
        method: 'GET',
        url: '/api/v1/service-history',
        user: otherOwner,
      });
      expect(body.data.items).toHaveLength(0);
    });
  });
});
