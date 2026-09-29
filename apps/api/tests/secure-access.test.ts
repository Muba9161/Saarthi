import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrganizationType, RoleName, type SecureAccessStatus } from '@saarthi/shared';
import { prisma } from '../src/database/prisma';
import { cache } from '../src/infra/cache';
import {
  TEST_PASSWORD,
  closeApp,
  createOrganization,
  createUser,
  getApp,
  request,
  resetDatabase,
  unlockSecureAccess,
  type TestUser,
} from './helpers';

/**
 * The secure PIN: set with the account password, entered to open sensitive
 * details on one session for a few minutes, locked after five wrong tries.
 */

const status = (user: TestUser) =>
  request<SecureAccessStatus>({ method: 'GET', url: '/api/v1/security/access', user });

const enterPin = (user: TestUser, pin: string) =>
  request<{ unlockedUntil: string }>({
    method: 'POST',
    url: '/api/v1/security/unlock/pin',
    user,
    payload: { pin },
  });

describe('secure access', () => {
  let owner: TestUser;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    await cache.clear();
    const fleet = await createOrganization(OrganizationType.FLEET_OWNER);
    owner = await createUser({ role: RoleName.FLEET_OWNER, organizationId: fleet.id });
  });

  describe('the PIN', () => {
    it('is set with the account password, and never with a wrong one', async () => {
      const refused = await request({
        method: 'PUT',
        url: '/api/v1/security/pin',
        user: owner,
        payload: { pin: '1357', password: 'not-my-password' },
      });
      expect(refused.status).toBe(400);

      const set = await request<SecureAccessStatus>({
        method: 'PUT',
        url: '/api/v1/security/pin',
        user: owner,
        payload: { pin: '1357', password: TEST_PASSWORD },
      });
      expect(set.status).toBe(200);
      expect(set.body.data.pinSet).toBe(true);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(row.securePinHash).not.toBe('1357');
    });

    it('accepts only four digits', async () => {
      const response = await request({
        method: 'PUT',
        url: '/api/v1/security/pin',
        user: owner,
        payload: { pin: '12a4', password: TEST_PASSWORD },
      });
      expect(response.status).toBe(400);
    });

    it('opens sensitive details on this session only', async () => {
      await unlockSecureAccess(owner, '1357');
      expect((await status(owner)).body.data.unlockedUntil).not.toBeNull();

      // Signing in again is a new session; the PIN has not been entered there.
      const elsewhere = await createUser({
        role: RoleName.FLEET_OWNER,
        organizationId: owner.organizationId,
      });
      await prisma.user.update({
        where: { id: elsewhere.id },
        data: {
          securePinHash: (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
            .securePinHash,
        },
      });
      expect((await status(elsewhere)).body.data.unlockedUntil).toBeNull();
    });

    it('locks after five wrong tries, and then refuses even the right one', async () => {
      await unlockSecureAccess(owner, '1357');
      await request({ method: 'POST', url: '/api/v1/security/lock', user: owner });

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const wrong = await enterPin(owner, '0000');
        expect(wrong.status).toBe(400);
      }
      const fifth = await enterPin(owner, '0000');
      expect(fifth.status).toBe(403);

      const right = await enterPin(owner, '1357');
      expect(right.status).toBe(403);
      expect((await status(owner)).body.data.pinLockedUntil).not.toBeNull();
    });
  });

  describe('what it guards', () => {
    it('asks for the PIN before a fingerprint or face unlock can be added', async () => {
      const before = await request({
        method: 'POST',
        url: '/api/v1/security/passkeys/options',
        user: owner,
      });
      expect(before.status).toBe(403);
      expect(before.body.error?.code).toBe('SECURE_ACCESS_REQUIRED');

      await unlockSecureAccess(owner);
      const after = await request<{ challenge: string }>({
        method: 'POST',
        url: '/api/v1/security/passkeys/options',
        user: owner,
      });
      expect(after.status).toBe(200);
      expect(after.body.data.challenge).toBeTruthy();
    });

    it('turns RC details on QR scans on only after the PIN, and keeps them off by default', async () => {
      const policy = await request<{ showRcDetails: boolean }>({
        method: 'GET',
        url: '/api/v1/qr/privacy-policy',
        user: owner,
      });
      expect(policy.body.data.showRcDetails).toBe(false);

      const refused = await request({
        method: 'PUT',
        url: '/api/v1/qr/rc-visibility',
        user: owner,
        payload: { enabled: true },
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error?.code).toBe('SECURE_ACCESS_REQUIRED');

      await unlockSecureAccess(owner);
      const turnedOn = await request<{ showRcDetails: boolean }>({
        method: 'PUT',
        url: '/api/v1/qr/rc-visibility',
        user: owner,
        payload: { enabled: true },
      });
      expect(turnedOn.status).toBe(200);
      expect(turnedOn.body.data.showRcDetails).toBe(true);
    });
  });
  describe('fingerprint or face sign-in', () => {
    const fakeAssertion = {
      id: 'not-a-registered-credential',
      rawId: 'not-a-registered-credential',
      type: 'public-key',
      response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
      clientExtensionResults: {},
    };

    it('hands out a one-time challenge without asking who is signing in', async () => {
      const response = await request<{ challengeId: string; options: { challenge: string } }>({
        method: 'POST',
        url: '/api/v1/auth/passkey/options',
      });
      expect(response.status).toBe(200);
      expect(response.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.body.data.options.challenge).toBeTruthy();
    });

    it('refuses a device that is not registered, and never reuses the challenge', async () => {
      const options = await request<{ challengeId: string }>({
        method: 'POST',
        url: '/api/v1/auth/passkey/options',
      });

      const attempt = await request({
        method: 'POST',
        url: '/api/v1/auth/passkey/login',
        payload: { challengeId: options.body.data.challengeId, response: fakeAssertion },
      });
      expect(attempt.status).toBe(401);
      expect(attempt.body.error?.code).toBe('INVALID_CREDENTIALS');

      const replay = await request({
        method: 'POST',
        url: '/api/v1/auth/passkey/login',
        payload: { challengeId: options.body.data.challengeId, response: fakeAssertion },
      });
      expect(replay.status).toBe(400);
    });
  });
});
