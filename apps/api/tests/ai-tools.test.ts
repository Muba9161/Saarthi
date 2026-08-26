import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName, TruckType } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { authorizedTools, executeTool } from '../src/modules/ai/tools/registry';
import { buildDailyBrief } from '../src/modules/ai/daily-brief.service';
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
import { buildAuthContext } from '../src/auth/session.service';
import type { AuthContext } from '../src/auth/context';

/**
 * AI tool registry.
 *
 * The registry is the boundary between a language model and a tenant's data, so
 * these tests are almost entirely about refusal: tools the caller cannot use are
 * never offered, arguments the model invented never reach a query, and one
 * tenant's cached answer never reaches another.
 */
describe('AI tool registry', () => {
  let fleet: TestOrganization;
  let otherFleet: TestOrganization;
  let owner: TestUser;
  let manager: TestUser;
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
    manager = await createUser({ role: RoleName.FLEET_MANAGER, organizationId: fleet.id });
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

  /**
   * The real auth context, resolved the way a request resolves it.
   *
   * Built through `buildAuthContext` rather than hand-assembled, so the
   * permissions and entitlements under test are exactly the ones a live
   * request would carry — including anything a future role change alters.
   */
  async function contextFor(user: TestUser): Promise<AuthContext> {
    return buildAuthContext(user.id, 'test-session', user.organizationId ?? null);
  }

  // -------------------------------------------------------------------------

  describe('what a caller is offered', () => {
    it('offers the owner the finance tools', async () => {
      const auth = await contextFor(owner);
      const names = authorizedTools(auth).map((tool) => tool.name);

      expect(names).toContain('get_fleet_loan_summary');
      expect(names).toContain('get_vehicle_loan_summary');
    });

    it('never offers a manager the finance tools', async () => {
      const auth = await contextFor(manager);
      const names = authorizedTools(auth).map((tool) => tool.name);

      // Not merely refused when called — absent from the list, so the assistant
      // cannot offer to check something the person may not see.
      expect(names).not.toContain('get_fleet_loan_summary');
      expect(names).not.toContain('get_vehicle_loan_summary');
      expect(names).toContain('get_fleet_health');
    });
  });

  // -------------------------------------------------------------------------

  describe('execution', () => {
    it('runs a tool and labels where the answer came from', async () => {
      const auth = await contextFor(owner);
      const execution = await executeTool(auth, fleet.id, 'get_fleet_health', {});

      expect(execution.record.error).toBeNull();
      expect(execution.result?.basis).toBe('RULE_RESULT');
      expect(execution.result?.recordCount).toBe(1);
    });

    it('refuses a tool the caller may not use', async () => {
      const auth = await contextFor(manager);
      const execution = await executeTool(auth, fleet.id, 'get_fleet_loan_summary', {});

      expect(execution.result).toBeNull();
      // Phrased so the model can relay it: a true, useful sentence.
      expect(execution.record.error).toContain('permission');
    });

    it('refuses a tool that does not exist', async () => {
      const auth = await contextFor(owner);
      const execution = await executeTool(auth, fleet.id, 'get_everything', {});

      expect(execution.result).toBeNull();
      expect(execution.record.error).toContain('No such tool');
    });

    it('rejects arguments the model invented', async () => {
      const auth = await contextFor(owner);
      const execution = await executeTool(auth, fleet.id, 'get_vehicle_summary', {
        vehicleId: 'the-blue-truck',
      });

      // Validation fails before anything reaches a query.
      expect(execution.result).toBeNull();
      expect(execution.record.error).toContain('Invalid arguments');
    });

    it('refuses a vehicle from another tenant', async () => {
      const auth = await contextFor(otherOwner);
      const execution = await executeTool(auth, otherFleet.id, 'get_vehicle_summary', {
        vehicleId: vehicle.id,
      });

      expect(execution.result).toBeNull();
      expect(execution.record.error).toContain('No vehicle with that id in your fleet');
    });

    it('answers for a vehicle in the caller own fleet', async () => {
      const auth = await contextFor(owner);
      const execution = await executeTool(auth, fleet.id, 'get_vehicle_summary', {
        vehicleId: vehicle.id,
      });

      const data = execution.result?.data as { registrationNumber: string };
      expect(data.registrationNumber).toBe(vehicle.registrationNumber);
      expect(execution.record.references[0]?.id).toBe(vehicle.id);
    });

    it('does not serve one tenant a cached answer built for another', async () => {
      const ownerAuth = await contextFor(owner);
      const otherAuth = await contextFor(otherOwner);

      const first = await executeTool(ownerAuth, fleet.id, 'get_fleet_health', {});
      const second = await executeTool(otherAuth, otherFleet.id, 'get_fleet_health', {});

      const firstData = first.result?.data as { totalVehicles: number };
      const secondData = second.result?.data as { totalVehicles: number };

      expect(firstData.totalVehicles).toBe(1);
      // The other fleet has no vehicles. A cache key that ignored the tenant
      // would return 1 here, which is the worst bug this module could have.
      expect(secondData.totalVehicles).toBe(0);
      expect(second.record.cached).toBe(false);
    });

    it('reports real toll spend, and calls an unpriced crossing a floor rather than a total', async () => {
      const tag = await prisma.fastagAccount.create({
        data: {
          organizationId: fleet.id,
          vehicleId: vehicle.id,
          tagId: unique('34161FA820').toUpperCase().replace(/[^0-9A-F]/g, 'A').slice(0, 20),
          issuerBank: 'ICICI Bank',
          status: 'ACTIVE',
          source: 'MANUAL',
        },
      });

      // One priced crossing and one the network reported without a fare — the
      // case the tool has to describe honestly rather than round away.
      await prisma.tollTransaction.createMany({
        data: [
          {
            organizationId: fleet.id,
            vehicleId: vehicle.id,
            fastagId: tag.id,
            plazaName: 'Barabanki Toll Plaza',
            paymentMode: 'FASTAG',
            amount: 430,
            crossedAt: new Date(),
            source: 'IMPORT',
            verificationStatus: 'PROVIDER_REPORTED',
            externalReference: unique('NETC-'),
          },
          {
            organizationId: fleet.id,
            vehicleId: vehicle.id,
            fastagId: tag.id,
            plazaName: 'Kannauj Toll Plaza',
            paymentMode: 'FASTAG',
            amount: 0,
            crossedAt: new Date(),
            source: 'IMPORT',
            verificationStatus: 'PENDING_REVIEW',
            externalReference: unique('NETC-'),
          },
        ],
      });

      const auth = await contextFor(owner);
      const execution = await executeTool(auth, fleet.id, 'get_toll_summary', {});

      const data = execution.result?.data as {
        total: number;
        crossings: number;
        unpricedCrossings: number;
      };
      expect(data.crossings).toBe(2);
      expect(data.total).toBe(430);
      expect(data.unpricedCrossings).toBe(1);
      // The figure is real, so the caveat must say what it is missing rather
      // than letting 430 read as the whole bill.
      expect(execution.result?.caveats.join(' ')).toContain('floor');
    });

    it('carries the unknown-installment gap into the finance answer', async () => {
      await prisma.vehicleLoan.create({
        data: {
          organizationId: fleet.id,
          vehicleId: vehicle.id,
          loanNumber: unique('LOAN-').toUpperCase().slice(0, 16),
          lenderName: 'Shriram Finance',
          principal: 500_000,
          annualRatePercent: 12,
          tenureMonths: 12,
          startDate: new Date(),
          firstDueDate: new Date(),
          emiAmount: 44_424,
          installments: {
            create: [
              {
                organizationId: fleet.id,
                number: 1,
                dueDate: new Date(),
                principal: 40_000,
                interest: 4_424,
                totalDue: 44_424,
                status: 'UNKNOWN',
              },
            ],
          },
        },
      });

      const auth = await contextFor(owner);
      const execution = await executeTool(auth, fleet.id, 'get_fleet_loan_summary', {});

      expect(execution.result?.caveats.join(' ')).toContain('no confirmed payment state');
    });
  });

  // -------------------------------------------------------------------------

  describe('the copilot endpoint', () => {
    it('answers from tools and reports which ones ran', async () => {
      const response = await request<{
        answer: string;
        toolCalls: { tool: string; error: string | null }[];
        provenance: string;
        iterations: number;
      }>({
        method: 'POST',
        url: '/api/v1/ai/ask',
        user: owner,
        payload: { message: 'How healthy is my fleet today?' },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.answer.length).toBeGreaterThan(10);
      expect(response.body.data.toolCalls.length).toBeGreaterThan(0);
      expect(response.body.data.provenance.length).toBeGreaterThan(0);
      expect(response.body.data.iterations).toBeLessThanOrEqual(4);
    });

    it('records the usage so cost can be accounted for', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/ai/ask',
        user: owner,
        payload: { message: 'Which vehicles need service?' },
      });

      const usage = await prisma.aiUsage.findMany({ where: { organizationId: fleet.id } });
      expect(usage.length).toBeGreaterThan(0);
      expect(usage[0]?.operation).toBe('copilot.tools');
    });

    it('lists only the tools this caller may use', async () => {
      const ownerTools = await request<{ name: string }[]>({
        method: 'GET',
        url: '/api/v1/ai/tools',
        user: owner,
      });
      const managerTools = await request<{ name: string }[]>({
        method: 'GET',
        url: '/api/v1/ai/tools',
        user: manager,
      });

      const ownerNames = ownerTools.body.data.map((tool) => tool.name);
      const managerNames = managerTools.body.data.map((tool) => tool.name);

      expect(ownerNames).toContain('get_fleet_loan_summary');
      expect(managerNames).not.toContain('get_fleet_loan_summary');
    });
  });

  // -------------------------------------------------------------------------

  describe('daily brief', () => {
    it('says all clear when nothing needs attention', async () => {
      const brief = await buildDailyBrief(fleet.id);

      expect(brief.allClear).toBe(true);
      expect(brief.items).toEqual([]);
      expect(brief.basis).toBe('calculated');
      expect(brief.activeVehicles).toBe(1);
    });

    it('puts an open incident above a service reminder', async () => {
      await prisma.maintenanceRecord.create({
        data: {
          truckId: vehicle.id,
          organizationId: fleet.id,
          type: 'PREVENTIVE',
          title: 'Scheduled service',
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() - 5 * 86_400_000),
        },
      });
      await prisma.sosIncident.create({
        data: {
          reference: unique('SOS-').toUpperCase().slice(0, 14),
          organizationId: fleet.id,
          triggeredByUserId: owner.id,
          type: 'BREAKDOWN',
          status: 'TRIGGERED',
          latitude: 26.8467,
          longitude: 80.9462,
        },
      });

      const brief = await buildDailyBrief(fleet.id);

      expect(brief.allClear).toBe(false);
      // Ordered by what is already costing money or safety, not by category.
      expect(brief.items[0]?.kind).toBe('INCIDENT_OPEN');
      expect(brief.items[0]?.severity).toBe('CRITICAL');
      expect(brief.priorities[0]?.actionUrl).toBe('/sos');
    });

    it('is reachable without an AI plan, because rules produced it', async () => {
      const basicFleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BASIC);
      const basicOwner = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: basicFleet.id,
      });

      const response = await request<{ allClear: boolean }>({
        method: 'GET',
        url: '/api/v1/ai/daily-brief',
        user: basicOwner,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.allClear).toBe(true);
    });
  });
});
