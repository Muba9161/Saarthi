import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationType, PlanTier, RoleName, TruckType } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { errors } from '../src/lib/errors';
import { fastagProvider } from '../src/providers/fastag';
import { MockFastagProvider } from '../src/providers/fastag/mock-fastag.provider';
import { runFastagBalanceSweep } from '../src/modules/toll/fastag.service';
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

/**
 * FASTag and toll.
 *
 * The assertions worth reading twice are the ones about what Saarthi refuses to
 * claim: it will not present a balance nobody reported as zero, it will not
 * treat a week-old reading as current, it will not price a crossing the NETC
 * feed reported without a fare, and it will not tell an operator it topped up
 * their tag when all it did was write the top-up down.
 */
describe('FASTag and toll', () => {
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
      },
    });
    vehicle = { id: truck.id, registrationNumber: truck.registrationNumber };
  });

  const DAY = 86_400_000;

  interface FastagBody {
    id: string;
    registrationNumber: string;
    tagId: string | null;
    tagIdMasked: boolean;
    issuerBank: string;
    status: string;
    balance: number | null;
    balanceUpdatedAt: string | null;
    lowBalanceThreshold: number;
    linkedAccountRef: string | null;
    health: { health: string; reasons: string[]; balanceAgeDays: number | null };
  }

  const tagPayload = (overrides: Record<string, unknown> = {}) => ({
    vehicleId: vehicle.id,
    tagId: unique('34161FA820').toUpperCase().replace(/[^0-9A-F]/g, '0').slice(0, 24).padEnd(24, '0'),
    issuerBank: 'ICICI Bank',
    vehicleClass: 'VC11',
    status: 'ACTIVE',
    linkedAccountRef: 'XXXXXX4471',
    ...overrides,
  });

  const registerTag = (overrides: Record<string, unknown> = {}, user: TestUser = owner) =>
    request<FastagBody>({
      method: 'POST',
      url: '/api/v1/fleet/toll/fastag',
      user,
      payload: tagPayload(overrides),
    });

  // -------------------------------------------------------------------------

  describe('registering a tag', () => {
    it('records the tag against the vehicle', async () => {
      const { status, body } = await registerTag({ balance: 2_400 });

      expect(status).toBe(201);
      expect(body.data.issuerBank).toBe('ICICI Bank');
      expect(body.data.registrationNumber).toBe(vehicle.registrationNumber);
      expect(body.data.balance).toBe(2_400);
      // A balance is only meaningful with the moment it was true.
      expect(body.data.balanceUpdatedAt).not.toBeNull();
      expect(body.data.health.health).toBe('OK');
    });

    it('leaves the balance unknown when none was given, rather than zero', async () => {
      const { body } = await registerTag();

      expect(body.data.balance).toBeNull();
      expect(body.data.balanceUpdatedAt).toBeNull();
      // Not "OK" and not "LOW" — nobody has told Saarthi anything.
      expect(body.data.health.health).toBe('UNKNOWN');
      expect(body.data.health.reasons[0]).toContain('No balance');
    });

    it('rejects a tag id that is not a NETC tag id', async () => {
      const response = await registerTag({ tagId: 'NOT-A-TAG' });
      expect(response.status).toBe(400);
    });

    it('closes the previous tag when a replacement is fitted', async () => {
      const first = await registerTag();
      const second = await registerTag();

      expect(second.status).toBe(201);

      const previous = await prisma.fastagAccount.findUniqueOrThrow({
        where: { id: first.body.data.id },
      });
      // Closed, not deleted: a crossing from last year still resolves to the
      // tag that actually paid for it.
      expect(previous.closedAt).not.toBeNull();
      expect(previous.status).toBe('CLOSED');
    });

    it('refuses a duplicate tag id within one fleet', async () => {
      const tagId = '34161FA820328972487BE420';
      await registerTag({ tagId });
      const second = await registerTag({ tagId });
      expect(second.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------

  describe('who sees the tag id', () => {
    it('shows the owner the full tag id and the linked account', async () => {
      const { body } = await registerTag();
      expect(body.data.tagIdMasked).toBe(false);
      expect(body.data.linkedAccountRef).toBe('XXXXXX4471');
    });

    it('masks the tag id for a manager', async () => {
      const created = await registerTag();

      const { body } = await request<FastagBody>({
        method: 'GET',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}`,
        user: manager,
      });

      // A tag id is a payment instrument identifier: enough to query or dispute
      // an account. A dispatcher works with toll spend, not with that.
      expect(body.data.tagIdMasked).toBe(true);
      expect(body.data.tagId).toMatch(/^\*+/);
      expect(body.data.linkedAccountRef).toBeNull();
      // They still see everything they need to do their job.
      expect(body.data.issuerBank).toBe('ICICI Bank');
    });

    it('does not leak a tag across tenants', async () => {
      const created = await registerTag();
      const response = await request({
        method: 'GET',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}`,
        user: otherOwner,
      });
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------

  describe('balance', () => {
    it('warns when the balance will not cover another plaza', async () => {
      const created = await registerTag({ balance: 180 });
      expect(created.body.data.health.health).toBe('LOW_BALANCE');
      expect(created.body.data.health.reasons[0]).toContain('one more national plaza');
    });

    it('treats a week-old reading as unknown rather than current', async () => {
      const created = await registerTag({ balance: 5_000 });

      await prisma.fastagAccount.update({
        where: { id: created.body.data.id },
        data: { balanceUpdatedAt: new Date(Date.now() - 10 * DAY) },
      });

      const { body } = await request<FastagBody>({
        method: 'GET',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}`,
        user: owner,
      });

      // The tag has been paying tolls for ten days. ₹5,000 describes an account
      // that no longer exists in that state.
      expect(body.data.health.health).toBe('UNKNOWN');
      expect(body.data.health.reasons[0]).toContain('days old');
      expect(body.data.health.balanceAgeDays).toBeGreaterThanOrEqual(10);
    });

    it('records a reading with the moment it was actually true', async () => {
      const created = await registerTag();
      const observedAt = new Date(Date.now() - 2 * DAY).toISOString();

      const { body } = await request<FastagBody>({
        method: 'POST',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}/balance`,
        user: owner,
        payload: { balance: 3_200, observedAt },
      });

      expect(body.data.balance).toBe(3_200);
      // Not stamped "now" — the reading was two days old when it was entered.
      expect(new Date(body.data.balanceUpdatedAt!).getTime()).toBeLessThan(Date.now() - DAY);
    });

    it('does not let money in the account clear a blacklist', async () => {
      const created = await registerTag({ status: 'BLACKLISTED', balance: 50 });

      await request({
        method: 'POST',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}/balance`,
        user: owner,
        payload: { balance: 9_000 },
      });

      const { body } = await request<FastagBody>({
        method: 'GET',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}`,
        user: owner,
      });

      // Topping up does not lift a blacklist — only the issuer does.
      expect(body.data.status).toBe('BLACKLISTED');
      expect(body.data.health.health).toBe('BLOCKED');
    });
  });

  // -------------------------------------------------------------------------

  describe('recharge', () => {
    it('says plainly that it recorded a top-up rather than performing one', async () => {
      const created = await registerTag({ balance: 200 });

      const { status, body } = await request<{
        recordedOnly: boolean;
        message: string;
        fastag: FastagBody;
      }>({
        method: 'POST',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}/recharge`,
        user: owner,
        payload: { amount: 3_000, reference: 'UPI-88213' },
      });

      expect(status).toBe(201);
      // Saarthi is not a payment rail for tags, and the response does not
      // pretend otherwise.
      expect(body.data.recordedOnly).toBe(true);
      expect(body.data.message).toContain('does not top up');
      expect(body.data.fastag.balance).toBe(3_200);
      expect(body.data.fastag.health.health).toBe('OK');
    });

    it('leaves the balance unknown when there was nothing to add to', async () => {
      const created = await registerTag();

      const { body } = await request<{ fastag: FastagBody }>({
        method: 'POST',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}/recharge`,
        user: owner,
        payload: { amount: 2_000 },
      });

      // ₹2,000 was added to an unknown balance. The result is still unknown —
      // not ₹2,000.
      expect(body.data.fastag.balance).toBeNull();
    });

    it('uses the balance the issuer showed when one is given', async () => {
      const created = await registerTag({ balance: 200 });

      const { body } = await request<{ fastag: FastagBody }>({
        method: 'POST',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}/recharge`,
        user: owner,
        payload: { amount: 3_000, balanceAfter: 3_150 },
      });

      // The issuer's figure wins over arithmetic: there may have been a
      // crossing between the reading and the top-up.
      expect(body.data.fastag.balance).toBe(3_150);
    });
  });

  // -------------------------------------------------------------------------

  describe('NETC lookup', () => {
    it('explains that Saarthi is not connected rather than reporting no tag', async () => {
      const created = await registerTag();

      const response = await request({
        method: 'POST',
        url: `/api/v1/fleet/toll/fastag/${created.body.data.id}/sync`,
        user: owner,
        payload: {},
      });

      // "No FASTag found" would send someone to a plaza expecting to pay cash.
      expect(response.status).toBe(503);
      expect(response.body.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(response.body.error?.message).toContain('not connected');
    });

    it('reports what the configured provider can actually do', async () => {
      const { status, body } = await request<{
        provider: string;
        supportsLookup: boolean;
        supportsBalance: boolean;
        supportsRecharge: boolean;
        defaultLowBalanceThreshold: number;
      }>({ method: 'GET', url: '/api/v1/fleet/toll/fastag/capabilities', user: owner });

      expect(status).toBe(200);
      expect(body.data.provider).toBe('internal');
      expect(body.data.supportsLookup).toBe(false);
      // The UI reads these and hides what cannot work, rather than offering a
      // button that fails when somebody urgently needs it.
      expect(body.data.supportsRecharge).toBe(false);
      expect(body.data.defaultLowBalanceThreshold).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------

  /**
   * Discovery — finding the tag from the registration number alone.
   *
   * The assertions that matter here are the negative ones. NETC answering
   * "this vehicle has no tag" is a fact about the vehicle rather than a failed
   * request, and must not reach the operator as an error. A provider that
   * serves no balance must not produce a tag reading zero. And a tag already
   * recorded against another vehicle must stop the write rather than quietly
   * move between them.
   */
  describe('finding a tag from the registration number', () => {
    const NETC_TAG_ID = '34161FA820328C7A94E11B44';

    /** The internal provider's own values, restored after every test below. */
    const originalSupportsLookup = fastagProvider.supportsLookup;
    const originalSupportsTransactions = fastagProvider.supportsTransactions;

    interface DiscoveryBody {
      provider: string;
      found: boolean;
      reason: string | null;
      applied: boolean;
      alreadyKnown: boolean;
      replacedPreviousTag: boolean;
      issuerNamed: boolean;
      balanceServed: boolean;
      fastag:
        | {
            id: string;
            tagId: string | null;
            issuerBank: string;
            vehicleClass: string | null;
            status: string;
            balance: number | null;
            source: string;
          }
        | null;
    }

    /**
     * Stand in for a deployment connected to NETC.
     *
     * `supportsLookup` is a plain instance field rather than a getter, so it is
     * redefined rather than spied on. Both it and the method stub are undone
     * afterwards — leaving lookup enabled would make every later test in this
     * file believe the deployment is connected.
     */
    const connectProvider = (fetchTagDetails: () => Promise<unknown>): void => {
      Object.defineProperty(fastagProvider, 'supportsLookup', {
        value: true,
        configurable: true,
        writable: true,
      });
      vi.spyOn(fastagProvider, 'fetchTagDetails').mockImplementation(fetchTagDetails as never);
    };

    /** What the real adapter returns: status and class, a bank code, no money. */
    const netcTag = (overrides: Record<string, unknown> = {}) => ({
      tagId: NETC_TAG_ID,
      registrationNumber: vehicle.registrationNumber,
      vehicleClass: 'VC11',
      status: 'ACTIVE',
      rawStatus: 'A',
      exceptionCode: '00',
      issuerBank: null,
      issuerCode: '607469',
      issuedAt: '2023-04-11',
      commercialVehicle: true,
      balance: null,
      provider: 'mastersindia',
      retrievedAt: new Date().toISOString(),
      simulated: false,
      ...overrides,
    });

    const discover = (user: TestUser = owner, payload: Record<string, unknown> = {}) =>
      request<DiscoveryBody>({
        method: 'POST',
        url: '/api/v1/fleet/toll/fastag/discover',
        user,
        payload: { vehicleId: vehicle.id, ...payload },
      });

    afterEach(() => {
      vi.restoreAllMocks();
      Object.defineProperty(fastagProvider, 'supportsLookup', {
        value: originalSupportsLookup,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(fastagProvider, 'supportsTransactions', {
        value: originalSupportsTransactions,
        configurable: true,
        writable: true,
      });
    });

    it('explains that Saarthi is not connected rather than reporting no tag', async () => {
      const { status, body } = await discover();

      expect(status).toBe(503);
      expect(body.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(body.error?.message).toContain('not connected');
    });

    it('records the tag NETC reports against the vehicle', async () => {
      connectProvider(async () => netcTag());

      const { status, body } = await discover();

      expect(status).toBe(200);
      expect(body.data.found).toBe(true);
      expect(body.data.applied).toBe(true);
      expect(body.data.alreadyKnown).toBe(false);
      expect(body.data.fastag?.tagId).toBe(NETC_TAG_ID);
      expect(body.data.fastag?.vehicleClass).toBe('VC11');
      expect(body.data.fastag?.status).toBe('ACTIVE');
      // Recorded as the provider's, not as something somebody typed.
      expect(body.data.fastag?.source).toBe('PROVIDER_SYNC');
    });

    it('leaves the balance unknown when the provider serves none, rather than zero', async () => {
      connectProvider(async () => netcTag());

      const { body } = await discover();

      expect(body.data.balanceServed).toBe(false);
      expect(body.data.fastag?.balance).toBeNull();
    });

    it('carries the issuer code through rather than guessing a bank name', async () => {
      connectProvider(async () => netcTag());

      const { body } = await discover();

      expect(body.data.issuerNamed).toBe(false);
      // A tag labelled with the wrong bank sends an operator to the wrong app
      // to top it up, so the code is shown as a code.
      expect(body.data.fastag?.issuerBank).toContain('607469');
    });

    it('reports a vehicle with no tag as an answer rather than a failure', async () => {
      connectProvider(async () => {
        throw errors.notFound(
          'FASTag',
          'No FASTag is registered against this vehicle in the NETC system.',
        );
      });

      const { status, body } = await discover();

      expect(status).toBe(200);
      expect(body.data.found).toBe(false);
      expect(body.data.fastag).toBeNull();
      expect(body.data.reason).toContain('no FASTag');
    });

    it('refreshes a tag it already holds rather than recording it twice', async () => {
      const created = await registerTag({ tagId: NETC_TAG_ID, status: 'UNKNOWN' });
      connectProvider(async () => netcTag({ status: 'BLACKLISTED', rawStatus: 'B' }));

      const { status, body } = await discover();

      expect(status).toBe(200);
      expect(body.data.alreadyKnown).toBe(true);
      expect(body.data.replacedPreviousTag).toBe(false);
      expect(body.data.fastag?.id).toBe(created.body.data.id);
      expect(body.data.fastag?.status).toBe('BLACKLISTED');

      const rows = await prisma.fastagAccount.count({ where: { vehicleId: vehicle.id } });
      expect(rows).toBe(1);
    });

    it('closes the tag it held when NETC reports a different one fitted', async () => {
      const created = await registerTag();
      connectProvider(async () => netcTag());

      const { body } = await discover();

      expect(body.data.replacedPreviousTag).toBe(true);
      expect(body.data.fastag?.id).not.toBe(created.body.data.id);

      // Closed rather than deleted, so a disputed crossing from last year still
      // resolves to the tag that paid for it.
      const previous = await prisma.fastagAccount.findUniqueOrThrow({
        where: { id: created.body.data.id },
      });
      expect(previous.closedAt).not.toBeNull();
      expect(previous.status).toBe('CLOSED');
    });

    it('refuses to record a tag another vehicle in the fleet already holds', async () => {
      const sibling = await prisma.truck.create({
        data: {
          organizationId: fleet.id,
          registrationNumber: unique('UP32ZZ').toUpperCase().slice(0, 12),
          truckType: TruckType.TIPPER,
          capacityTons: 25,
        },
      });
      await prisma.fastagAccount.create({
        data: {
          organizationId: fleet.id,
          vehicleId: sibling.id,
          tagId: NETC_TAG_ID,
          issuerBank: 'ICICI Bank',
        },
      });
      connectProvider(async () => netcTag());

      const { status, body } = await discover();

      expect(status).toBe(409);
      expect(body.error?.code).toBe('DUPLICATE_RESOURCE');
    });

    it('writes nothing on a dry run', async () => {
      connectProvider(async () => netcTag());

      const { body } = await discover(owner, { apply: false });

      expect(body.data.found).toBe(true);
      expect(body.data.applied).toBe(false);

      const rows = await prisma.fastagAccount.count({ where: { vehicleId: vehicle.id } });
      expect(rows).toBe(0);
    });

    it('does not look up a vehicle belonging to another fleet', async () => {
      connectProvider(async () => netcTag());

      const { status } = await discover(otherOwner);

      expect(status).toBe(404);
    });

    /**
     * The simulator, driven through the same route an operator uses.
     *
     * Worth its own tests because it is the only configuration that serves a
     * balance — a real NETC lookup cannot — so it is the only way the discovery
     * path can be exercised end to end without a paid provider account. The
     * assertion that matters is the last one: everything it produces is stored
     * as SIMULATED and can never be mistaken for a real reading.
     */
    describe('against the local simulator', () => {
      const simulator = new MockFastagProvider();

      it('records the tag the simulator serves, balance and all', async () => {
        connectProvider(() =>
          simulator.fetchTagDetails({ registrationNumber: vehicle.registrationNumber }),
        );

        const { status, body } = await discover();

        expect(status).toBe(200);
        expect(body.data.found).toBe(true);
        expect(body.data.balanceServed).toBe(true);
        expect(typeof body.data.fastag?.balance).toBe('number');
        expect(body.data.fastag?.tagId).toMatch(/^[0-9A-F]{24}$/);
        // Stored as simulated, so a demo figure can never pass for a real one.
        expect(body.data.fastag?.source).toBe('SIMULATED');
      });

      it('imports the simulated crossings when they are asked for', async () => {
        connectProvider(() =>
          simulator.fetchTagDetails({ registrationNumber: vehicle.registrationNumber }),
        );
        Object.defineProperty(fastagProvider, 'supportsTransactions', {
          value: true,
          configurable: true,
          writable: true,
        });
        vi.spyOn(fastagProvider, 'fetchTollHistory').mockImplementation((request) =>
          simulator.fetchTollHistory(request),
        );

        const { body } = await discover(owner, { includeTransactions: true });

        expect(body.data.crossingsImported).toBeGreaterThan(0);
        // The note says how little of the history this actually is.
        expect(body.data.coverageNote).toContain('72 hours');
      });
    });
  });

  // -------------------------------------------------------------------------

  describe('toll crossings', () => {
    const crossing = (overrides: Record<string, unknown> = {}) => ({
      vehicleId: vehicle.id,
      plazaName: 'Barabanki Toll Plaza',
      plazaCode: 'BRB02',
      amount: 430,
      crossedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      paymentMode: 'FASTAG',
      ...overrides,
    });

    it('records a crossing', async () => {
      const { status, body } = await request<{
        plazaName: string;
        amount: number;
        registrationNumber: string;
      }>({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: crossing(),
      });

      expect(status).toBe(201);
      expect(body.data.plazaName).toBe('Barabanki Toll Plaza');
      expect(body.data.amount).toBe(430);
    });

    it('updates the tag balance from the reading after a deduction', async () => {
      const tag = await registerTag({ balance: 2_000 });

      await request({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: crossing({ balanceAfter: 1_570 }),
      });

      const { body } = await request<FastagBody>({
        method: 'GET',
        url: `/api/v1/fleet/toll/fastag/${tag.body.data.id}`,
        user: owner,
      });

      // The most reliable balance a fleet gets without asking the bank.
      expect(body.data.balance).toBe(1_570);
    });

    it('summarises spend by plaza and payment mode', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: crossing(),
      });
      await request({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: crossing({ plazaName: 'Sikandra Toll Plaza', amount: 510, paymentMode: 'CASH' }),
      });

      const { body } = await request<{
        total: number;
        crossings: number;
        byMode: Record<string, number>;
        topPlazas: { plazaName: string; total: number }[];
        basis: string;
      }>({ method: 'GET', url: '/api/v1/fleet/toll/summary?days=30', user: owner });

      expect(body.data.total).toBe(940);
      expect(body.data.crossings).toBe(2);
      // Cash at a plaza is a leak worth seeing separately.
      expect(body.data.byMode.CASH).toBe(510);
      expect(body.data.byMode.FASTAG).toBe(430);
      expect(body.data.topPlazas[0]?.plazaName).toBe('Sikandra Toll Plaza');
      expect(body.data.basis).toBe('calculated');
    });

    it('is idempotent on a repeated statement import', async () => {
      const payload = {
        vehicleId: vehicle.id,
        source: 'IMPORT',
        crossings: [
          {
            plazaName: 'Kannauj Toll Plaza',
            amount: 375,
            crossedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
            externalReference: 'NETC-9931',
          },
        ],
      };

      const first = await request<{ imported: number; duplicates: number }>({
        method: 'POST',
        url: '/api/v1/fleet/toll/import',
        user: owner,
        payload,
      });
      const second = await request<{ imported: number; duplicates: number }>({
        method: 'POST',
        url: '/api/v1/fleet/toll/import',
        user: owner,
        payload,
      });

      expect(first.body.data.imported).toBe(1);
      // Re-importing the same month must not double a fleet's toll spend.
      expect(second.body.data.imported).toBe(0);
      expect(second.body.data.duplicates).toBe(1);
    });

    it('raises a conflict when a statement disagrees on the fare', async () => {
      const crossedAt = new Date(Date.now() - 6 * 3_600_000).toISOString();

      await request({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: crossing({ plazaName: 'Kannauj Toll Plaza', amount: 375, crossedAt }),
      });

      const imported = await request<{ conflicts: number }>({
        method: 'POST',
        url: '/api/v1/fleet/toll/import',
        user: owner,
        payload: {
          vehicleId: vehicle.id,
          source: 'IMPORT',
          crossings: [{ plazaName: 'Kannauj Toll Plaza', amount: 750, crossedAt }],
        },
      });

      expect(imported.body.data.conflicts).toBe(1);

      const row = await prisma.tollTransaction.findFirstOrThrow({
        where: { plazaName: 'Kannauj Toll Plaza' },
      });
      // Both figures are kept and a person decides — the import does not
      // silently overwrite a receipt.
      expect(row.verificationStatus).toBe('CONFLICT');
      expect(row.conflictNote).toContain('750');
      expect(Number(row.amount)).toBe(375);
    });

    it('keeps one fleet crossings out of another', async () => {
      await request({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: crossing(),
      });

      const { body } = await request<{ items: unknown[] }>({
        method: 'GET',
        url: '/api/v1/fleet/toll/transactions',
        user: otherOwner,
      });
      expect(body.data.items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('trip cost and variance', () => {
    async function makeTrip(reference: string): Promise<string> {
      const trip = await prisma.trip.create({
        data: {
          reference,
          organizationId: fleet.id,
          truckId: vehicle.id,
          originAddress: 'Kanpur',
          originLatitude: 26.4499,
          originLongitude: 80.3319,
          destinationAddress: 'Delhi',
          destinationLatitude: 28.6139,
          destinationLongitude: 77.209,
          status: 'COMPLETED',
          price: 45_000,
          expenses: 2_000,
          actualDistanceKm: 480,
          actualStartAt: new Date(Date.now() - 3 * DAY),
          actualArrivalAt: new Date(Date.now() - 2 * DAY),
          createdById: owner.id,
        },
      });
      return trip.id;
    }

    it('separates toll from fuel in the trip cost', async () => {
      const tripId = await makeTrip(unique('TRIP-').toUpperCase().slice(0, 14));

      await request({
        method: 'POST',
        url: '/api/v1/fleet/toll/transactions',
        user: owner,
        payload: {
          vehicleId: vehicle.id,
          tripId,
          plazaName: 'Sikandra Toll Plaza',
          amount: 1_500,
          crossedAt: new Date(Date.now() - 2.5 * DAY).toISOString(),
        },
      });

      const { body } = await request<{
        tollCost: number;
        totalCost: number;
        margin: number | null;
        tollSharePercent: number | null;
        costPerKm: number | null;
      }>({ method: 'GET', url: `/api/v1/trips/${tripId}/cost`, user: owner });

      expect(body.data.tollCost).toBe(1_500);
      expect(body.data.totalCost).toBe(3_500);
      expect(body.data.margin).toBe(41_500);
      // The figure an operator rarely has: what share of the run was toll.
      expect(body.data.tollSharePercent).toBe(43);
      expect(body.data.costPerKm).toBeGreaterThan(0);
    });

    it('refuses a variance verdict on too few comparable runs', async () => {
      const tripId = await makeTrip(unique('TRIP-').toUpperCase().slice(0, 14));

      const { body } = await request<{
        verdict: string;
        expected: number | null;
        sampleSize: number;
      }>({ method: 'GET', url: `/api/v1/trips/${tripId}/toll-variance`, user: owner });

      // Two data points can explain any third. A confident variance figure from
      // them is how a driver ends up accused of something.
      expect(body.data.verdict).toBe('INSUFFICIENT_DATA');
      expect(body.data.expected).toBeNull();
    });

    it('compares against the median once there are enough runs', async () => {
      const fares = [1_400, 1_500, 1_600];
      for (const fare of fares) {
        const priorTrip = await makeTrip(unique('TRIP-').toUpperCase().slice(0, 14));
        await prisma.tollTransaction.create({
          data: {
            organizationId: fleet.id,
            vehicleId: vehicle.id,
            tripId: priorTrip,
            plazaName: 'Corridor total',
            amount: fare,
            crossedAt: new Date(Date.now() - 5 * DAY),
          },
        });
      }

      const tripId = await makeTrip(unique('TRIP-').toUpperCase().slice(0, 14));
      await prisma.tollTransaction.create({
        data: {
          organizationId: fleet.id,
          vehicleId: vehicle.id,
          tripId,
          plazaName: 'Corridor total',
          amount: 2_400,
          crossedAt: new Date(Date.now() - DAY),
        },
      });

      const { body } = await request<{
        verdict: string;
        expected: number | null;
        variancePercent: number | null;
      }>({ method: 'GET', url: `/api/v1/trips/${tripId}/toll-variance`, user: owner });

      expect(body.data.expected).toBe(1_500);
      expect(body.data.variancePercent).toBe(60);
      expect(body.data.verdict).toBe('HIGH');
    });
  });

  // -------------------------------------------------------------------------

  describe('warnings', () => {
    it('warns a fleet whose tag will not cover the next plaza', async () => {
      await registerTag({ balance: 150 });

      const result = await runFastagBalanceSweep();
      expect(result.warned).toBe(1);

      const notifications = await prisma.notification.findMany({
        where: { type: 'FASTAG_LOW_BALANCE' },
      });
      expect(notifications.length).toBeGreaterThan(0);
    });

    it('does not warn about a tag nobody has reported a balance for', async () => {
      await registerTag();

      const result = await runFastagBalanceSweep();
      // "We do not know" is not a reason to interrupt somebody.
      expect(result.warned).toBe(0);
      expect(result.blocked).toBe(0);
    });

    it('raises a blocked tag above a low one in the morning brief', async () => {
      await registerTag({ status: 'BLACKLISTED' });

      const brief = await buildDailyBrief(fleet.id);
      const blocked = brief.items.find((item) => item.kind === 'FASTAG_BLOCKED');

      expect(blocked).toBeDefined();
      expect(blocked?.severity).toBe('CRITICAL');
      expect(blocked?.detail).toContain('double');
      expect(brief.items[0]?.kind).toBe('FASTAG_BLOCKED');
    });
  });
});
