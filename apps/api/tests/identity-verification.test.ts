import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, PlanTier, RoleName } from '@saarthi/shared';
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
 * Identity verification — Aadhaar, PAN, Voter ID and GSTIN.
 *
 * These tests deliberately run with **no provider key configured**, which is
 * the state of every developer machine and of CI. That is not a limitation
 * here, it is the most important thing to pin down: the local checksum gate,
 * the tenant scoping and the permission guards all have to work *before* any
 * money is spent, and this is the only way to prove they do without spending
 * it.
 *
 * What is asserted:
 *
 *  * A malformed number is refused locally, with no provider call.
 *  * A well-formed number reaches the provider layer and gets an honest 503
 *    rather than a fabricated "verified".
 *  * A driver on another fleet's roster is a 404, not a 403 — the tenant guard.
 *  * Aadhaar without a linked PAN is recorded as UNCONFIRMED, never VERIFIED.
 */

// Constructed to satisfy their own check digits and belonging to nobody.
const VALID_AADHAAR = '234567890124';
const VALID_PAN = 'ABCPE1234F';
const VALID_VOTER_ID = 'ABC1234567';
const VALID_GSTIN = '27ABCCE1234F1Z2';

describe('Identity verification', () => {
  let fleetA: TestOrganization;
  let fleetB: TestOrganization;
  let ownerA: TestUser;
  let ownerB: TestUser;
  let driverUserA: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    fleetA = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    fleetB = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.BUSINESS);
    ownerA = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetA.id });
    ownerB = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleetB.id });
    driverUserA = await createUser({
      role: RoleName.DRIVER,
      organizationId: fleetA.id,
      driver: true,
    });
  });

  const driverIdFor = async (user: TestUser): Promise<string> => {
    const driver = await prisma.driver.findFirstOrThrow({ where: { userId: user.id } });
    return driver.id;
  };

  describe('the catalogue', () => {
    it('tells the client which kinds exist and whether this environment can check them', async () => {
      const response = await request<{
        onlineVerificationAvailable: boolean;
        kinds: { kind: string; documentType: string; subjectType: string }[];
      }>({ method: 'GET', url: '/api/v1/identity/kinds', user: ownerA });

      expect(response.status).toBe(200);
      expect(response.body.data.kinds.map((entry) => entry.kind).sort()).toEqual([
        'AADHAAR',
        'GST',
        'PAN',
        'VOTER_ID',
      ]);

      // Each kind names the document type it verifies, which is what puts the
      // Verify button on the right row.
      const byKind = Object.fromEntries(
        response.body.data.kinds.map((entry) => [entry.kind, entry]),
      );
      expect(byKind.AADHAAR?.documentType).toBe('DRIVER_AADHAAR');
      expect(byKind.PAN?.documentType).toBe('DRIVER_PAN');
      expect(byKind.VOTER_ID?.documentType).toBe('DRIVER_VOTER_ID');
      expect(byKind.GST?.documentType).toBe('GST_CERTIFICATE');
      expect(byKind.GST?.subjectType).toBe('ORGANIZATION');
    });
  });

  describe('the local gate', () => {
    it('refuses a malformed number without calling the provider', async () => {
      const driverId = await driverIdFor(driverUserA);

      // A single wrong digit — the Verhoeff check catches it, so this costs
      // nothing and is reported as a bad number rather than as "not found".
      const response = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerA,
        payload: {
          kind: 'AADHAAR',
          subjectType: 'DRIVER',
          subjectId: driverId,
          number: '234567890125',
        },
      });

      expect(response.status).toBe(400);
      expect(response.body.error?.message).toMatch(/Aadhaar/i);

      // Nothing was recorded: a number that never went anywhere is not a check.
      expect(await prisma.identityVerification.count()).toBe(0);
    });

    it('refuses a PAN whose entity-type character could not have been issued', async () => {
      const driverId = await driverIdFor(driverUserA);

      const response = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerA,
        // `ABCDE1234F` is the placeholder PAN everyone uses and it is not one:
        // `D` is not an Income Tax entity-type code.
        payload: {
          kind: 'PAN',
          subjectType: 'DRIVER',
          subjectId: driverId,
          number: 'ABCDE1234F',
        },
      });

      expect(response.status).toBe(400);
      expect(await prisma.identityVerification.count()).toBe(0);
    });

    it('refuses a GSTIN with a broken check character', async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerA,
        payload: {
          kind: 'GST',
          subjectType: 'ORGANIZATION',
          subjectId: fleetA.id,
          number: '27ABCCE1234F1Z9',
        },
      });

      expect(response.status).toBe(400);
      expect(await prisma.identityVerification.count()).toBe(0);
    });
  });

  describe('tenant scoping', () => {
    it("refuses a driver on another fleet's roster as a 404, not a 403", async () => {
      const driverId = await driverIdFor(driverUserA);

      // ownerB must not be able to tell the difference between a driver that
      // belongs to somebody else and one that does not exist — otherwise this
      // endpoint confirms roster membership to an outsider.
      const response = await request({
        method: 'GET',
        url: `/api/v1/identity/subject/driver/${driverId}`,
        user: ownerB,
      });

      expect(response.status).toBe(404);
    });

    it("refuses another organization's GST record", async () => {
      const response = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerB,
        payload: {
          kind: 'GST',
          subjectType: 'ORGANIZATION',
          subjectId: fleetA.id,
          number: VALID_GSTIN,
        },
      });

      expect(response.status).toBe(404);
    });

    it('lets a driver read their own checks', async () => {
      const driverId = await driverIdFor(driverUserA);

      const response = await request<{ checks: { kind: string }[] }>({
        method: 'GET',
        url: `/api/v1/identity/subject/driver/${driverId}`,
        user: driverUserA,
      });

      expect(response.status).toBe(200);
      // A driver gets the three personal documents; GSTIN belongs to a business.
      expect(response.body.data.checks.map((entry) => entry.kind).sort()).toEqual([
        'AADHAAR',
        'PAN',
        'VOTER_ID',
      ]);
    });
  });

  describe('the subject view', () => {
    it('lists every applicable kind, unchecked, before anything has run', async () => {
      const response = await request<{
        onlineVerificationAvailable: boolean;
        checks: { kind: string; verification: unknown }[];
      }>({
        method: 'GET',
        url: `/api/v1/identity/subject/organization/${fleetA.id}`,
        user: ownerA,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.checks).toHaveLength(1);
      expect(response.body.data.checks[0]?.kind).toBe('GST');
      // Null rather than absent: the row still needs a Verify button.
      expect(response.body.data.checks[0]?.verification).toBeNull();
    });
  });

  describe('without a provider key', () => {
    /**
     * The honest-failure contract.
     *
     * With no key configured, a well-formed number must produce a 503 saying
     * verification is unavailable — never a fabricated pass. A green tick this
     * environment did not earn would be worse than no answer at all, because a
     * fleet would dispatch on it.
     */
    it('returns 503 rather than inventing a result', async () => {
      const driverId = await driverIdFor(driverUserA);

      for (const payload of [
        { kind: 'PAN', subjectType: 'DRIVER', subjectId: driverId, number: VALID_PAN },
        {
          kind: 'VOTER_ID',
          subjectType: 'DRIVER',
          subjectId: driverId,
          number: VALID_VOTER_ID,
        },
        {
          kind: 'GST',
          subjectType: 'ORGANIZATION',
          subjectId: fleetA.id,
          number: VALID_GSTIN,
        },
      ]) {
        const response = await request({
          method: 'POST',
          url: '/api/v1/identity/verify',
          user: ownerA,
          payload,
        });

        expect(response.status, `${payload.kind} should report unavailable`).toBe(503);
      }

      // No subject was marked verified on the way past.
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.panVerifiedAt).toBeNull();
      expect(driver.voterIdVerifiedAt).toBeNull();

      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: fleetA.id },
      });
      expect(organization.gstVerifiedAt).toBeNull();
      expect(organization.gstin).toBeNull();
    });

    /**
     * Aadhaar is the exception, and deliberately so.
     *
     * With no PAN to link-check against there is nothing to call, so the
     * checksum stands on its own and the outcome is recorded as UNCONFIRMED —
     * a real state that sends the document to a reviewer. It must never be
     * VERIFIED, and it must not fail: the number *was* checked, as far as
     * anything can check it.
     */
    it('records a checksum-valid Aadhaar as unconfirmed, never verified', async () => {
      const driverId = await driverIdFor(driverUserA);

      const response = await request<{
        outcome: string;
        maskedNumber: string;
        reason: string | null;
      }>({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerA,
        payload: {
          kind: 'AADHAAR',
          subjectType: 'DRIVER',
          subjectId: driverId,
          number: VALID_AADHAAR,
        },
      });

      expect(response.status).toBe(200);
      expect(response.body.data.outcome).toBe('UNCONFIRMED');
      expect(response.body.data.reason).toBeTruthy();

      // Only the last four digits are ever disclosed.
      expect(response.body.data.maskedNumber).toBe('XXXX XXXX 0124');

      // An unconfirmed check does not mark the driver verified.
      const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
      expect(driver.aadhaarVerifiedAt).toBeNull();
      expect(driver.aadhaarLast4).toBeNull();

      // The stored row holds no readable number.
      const stored = await prisma.identityVerification.findFirstOrThrow({
        where: { subjectId: driverId, kind: 'AADHAAR' },
      });
      expect(stored.numberHash).not.toContain(VALID_AADHAAR);
      expect(stored.maskedNumber).not.toContain('2345678901');
      expect(stored.outcome).toBe('UNCONFIRMED');
    });

    it('rejects a linked PAN that is itself malformed, before any call', async () => {
      const driverId = await driverIdFor(driverUserA);

      const response = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerA,
        payload: {
          kind: 'AADHAAR',
          subjectType: 'DRIVER',
          subjectId: driverId,
          number: VALID_AADHAAR,
          linkedPan: 'ABCDE1234F',
        },
      });

      expect(response.status).toBe(400);
    });
  });

  describe('document linkage', () => {
    it('refuses to attach a check to a document of the wrong type', async () => {
      const driverId = await driverIdFor(driverUserA);

      // A licence scan is not a PAN card, so a PAN check must not be able to
      // mark it verified.
      const document = await prisma.document.create({
        data: {
          ownerType: 'DRIVER',
          ownerId: driverId,
          organizationId: fleetA.id,
          documentType: 'DRIVING_LICENCE',
          storageKey: unique('key'),
          fileName: 'licence.pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          uploadedById: ownerA.id,
        },
      });

      const response = await request({
        method: 'POST',
        url: '/api/v1/identity/verify',
        user: ownerA,
        payload: {
          kind: 'PAN',
          subjectType: 'DRIVER',
          subjectId: driverId,
          number: VALID_PAN,
          documentId: document.id,
        },
      });

      expect(response.status).toBe(400);

      const unchanged = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(unchanged.verificationStatus).toBe('PENDING_VERIFICATION');
    });
  });
});
