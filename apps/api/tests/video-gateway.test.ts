import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationType, PlanTier, TruckType } from '@saarthi/shared';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/database/prisma';
import {
  signGatewayTicket,
  verifyGatewayTicket,
  type GatewayTicketClaims,
} from '../src/providers/video/device-webrtc.provider';
import {
  closeApp,
  createOrganization,
  getApp,
  request,
  resetDatabase,
  unique,
  type TestOrganization,
} from './helpers';

/**
 * The video gateway's authorisation callback.
 *
 * This endpoint is the reason a camera pointed at a driver stays governed by
 * the fleet's own permissions rather than by a config file on an SFU. Its whole
 * job is to say no, so the tests are almost entirely about the cases where it
 * must: a forged ticket, an expired one, a ticket used on the wrong stream, in
 * the wrong direction, or after the session it belongs to was closed.
 *
 * The ticket format is exercised directly as well, because it is verified in
 * two places — here and by whatever issues it — and a signature scheme with no
 * test is a signature scheme nobody will notice breaking.
 */
describe('Video gateway authorisation', () => {
  const SECRET = 'test-video-gateway-secret-value-long-enough-1234';

  let fleet: TestOrganization;
  let cameraId: string;
  let sessionId: string;

  beforeAll(async () => {
    await getApp();
  });

  afterAll(async () => {
    await closeApp();
    vi.restoreAllMocks();
  });

  /** A well-formed ticket for the session under test. */
  function ticketFor(overrides: Partial<GatewayTicketClaims> = {}): string {
    return signGatewayTicket(
      {
        sid: sessionId,
        cam: cameraId,
        dev: 'SAARTHI-DEV-001',
        ch: 1,
        dir: 'publish',
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: 'test-nonce',
        ...overrides,
      },
      SECRET,
    );
  }

  async function authorize(body: Record<string, unknown>) {
    return request<unknown>({
      method: 'POST',
      url: '/api/v1/video-gateway/authorize',
      payload: body,
    });
  }

  beforeEach(async () => {
    await resetDatabase();

    // The route reads the secret from config at request time, so stubbing the
    // getter is enough — no need to rebuild the app between tests.
    const { config } = await import('../src/config/env');
    vi.spyOn(config.video, 'gatewaySecret', 'get').mockReturnValue(SECRET);

    fleet = await createOrganization(OrganizationType.FLEET_OWNER, PlanTier.INTELLIGENCE);

    const truck = await prisma.truck.create({
      data: {
        organizationId: fleet.id,
        registrationNumber: 'UP32AB9001',
        truckType: TruckType.TIPPER,
        capacityTons: 25,
      },
    });

    const device = await prisma.hardwareDevice.create({
      data: {
        organizationId: fleet.id,
        deviceIdentifier: unique('DEV-').toUpperCase().slice(0, 16),
        provider: 'MOBILE',
        deviceType: 'MOBILE_TEST_DEVICE',
        role: 'TELEMETRY',
        serialNumber: unique('SN-'),
        secretHash: await bcrypt.hash('device-secret', 4),
        status: 'ACTIVE',
        supportedMetrics: [],
        observedMetrics: [],
      },
    });

    await prisma.deviceAssignment.create({
      data: {
        deviceId: device.id,
        vehicleId: truck.id,
        organizationId: fleet.id,
        status: 'ACTIVE',
      },
    });

    const camera = await prisma.deviceCamera.create({
      data: {
        deviceId: device.id,
        organizationId: fleet.id,
        channel: 1,
        position: 'FRONT',
        label: 'Road-facing camera',
        continuousRecording: false,
      },
    });
    cameraId = camera.id;

    const session = await prisma.videoStreamSession.create({
      data: {
        cameraId: camera.id,
        organizationId: fleet.id,
        vehicleId: truck.id,
        requestedById: device.id,
        status: 'ACTIVE',
        tokenHash: 'unused-by-this-route',
        expiresAt: new Date(Date.now() + 300_000),
        startedAt: new Date(),
      },
    });
    sessionId = session.id;
  });

  // -------------------------------------------------------------------------
  // The ticket format
  // -------------------------------------------------------------------------

  describe('ticket signing', () => {
    it('round-trips its claims', () => {
      const claims: GatewayTicketClaims = {
        sid: 'session-1',
        cam: 'camera-1',
        dev: 'SAARTHI-DEV-001',
        ch: 2,
        dir: 'watch',
        exp: Math.floor(Date.now() / 1000) + 60,
        nonce: 'abc',
      };

      const verified = verifyGatewayTicket(signGatewayTicket(claims, SECRET), SECRET);
      expect(verified).toEqual(claims);
    });

    it('refuses a ticket signed with a different secret', () => {
      const token = signGatewayTicket(
        {
          sid: 'session-1',
          cam: 'camera-1',
          dev: 'D',
          ch: 1,
          dir: 'publish',
          exp: Math.floor(Date.now() / 1000) + 60,
          nonce: 'abc',
        },
        'a-different-secret-that-is-long-enough-here',
      );
      expect(verifyGatewayTicket(token, SECRET)).toBeNull();
    });

    it('refuses a ticket whose claims were edited', () => {
      const token = signGatewayTicket(
        {
          sid: 'session-1',
          cam: 'camera-1',
          dev: 'D',
          ch: 1,
          dir: 'watch',
          exp: Math.floor(Date.now() / 1000) + 60,
          nonce: 'abc',
        },
        SECRET,
      );

      // Re-encode the payload with the direction flipped, keeping the original
      // signature — the exact attack the HMAC exists to stop.
      const [payload, signature] = token.split('.');
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
      claims.dir = 'publish';
      const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;

      expect(verifyGatewayTicket(forged, SECRET)).toBeNull();
    });

    it('refuses an expired ticket', () => {
      const token = signGatewayTicket(
        {
          sid: 'session-1',
          cam: 'camera-1',
          dev: 'D',
          ch: 1,
          dir: 'publish',
          exp: Math.floor(Date.now() / 1000) - 1,
          nonce: 'abc',
        },
        SECRET,
      );
      expect(verifyGatewayTicket(token, SECRET)).toBeNull();
    });

    it('refuses malformed input rather than throwing', () => {
      expect(verifyGatewayTicket('', SECRET)).toBeNull();
      expect(verifyGatewayTicket('no-separator', SECRET)).toBeNull();
      expect(verifyGatewayTicket('not-base64.not-a-signature', SECRET)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // The endpoint
  // -------------------------------------------------------------------------

  describe('admitting a publisher', () => {
    it('accepts a valid ticket for an open session', async () => {
      const response = await authorize({
        action: 'publish',
        path: cameraId,
        token: ticketFor(),
      });
      expect(response.status).toBe(200);
    });

    it('marks the camera online, because frames are now genuinely flowing', async () => {
      await authorize({ action: 'publish', path: cameraId, token: ticketFor() });

      const camera = await prisma.deviceCamera.findUniqueOrThrow({ where: { id: cameraId } });
      expect(camera.status).toBe('ONLINE');
      expect(camera.lastFrameAt).not.toBeNull();
    });

    it('accepts the ticket in the password field, for gateways that send it there', async () => {
      const response = await authorize({
        action: 'publish',
        path: cameraId,
        password: ticketFor(),
      });
      expect(response.status).toBe(200);
    });
  });

  describe('refusing', () => {
    it('refuses a ticket for a different stream path', async () => {
      const response = await authorize({
        action: 'publish',
        // A valid ticket, but pointed at somebody else's camera — the check
        // that stops one camera's credential opening every camera on the
        // gateway.
        path: '00000000-0000-4000-8000-000000000000',
        token: ticketFor(),
      });
      expect(response.status).toBe(401);
    });

    it('admits a publisher and a viewer on the same path', async () => {
      // The reason the path is the camera and not the session. A device and a
      // dispatcher hold different sessions by definition, and if the path came
      // from the session they would each open a different one and never meet —
      // a failure that only appears with a real publisher and a real viewer
      // connected at once, because every individual answer looks correct.
      const publisher = await authorize({
        action: 'publish',
        path: cameraId,
        token: ticketFor({ dir: 'publish' }),
      });

      const viewerSession = await prisma.videoStreamSession.create({
        data: {
          cameraId,
          organizationId: fleet.id,
          requestedById: '00000000-0000-4000-8000-00000000beef',
          status: 'ACTIVE',
          tokenHash: 'viewer',
          expiresAt: new Date(Date.now() + 300_000),
        },
      });

      const viewer = await authorize({
        action: 'read',
        path: cameraId,
        token: ticketFor({ dir: 'watch', sid: viewerSession.id }),
      });

      expect(publisher.status).toBe(200);
      expect(viewer.status).toBe(200);
    });

    it('refuses a viewer ticket used to publish', async () => {
      const response = await authorize({
        action: 'publish',
        path: cameraId,
        token: ticketFor({ dir: 'watch' }),
      });
      expect(response.status).toBe(401);
    });

    it('refuses a publisher ticket used to watch', async () => {
      const response = await authorize({
        action: 'read',
        path: cameraId,
        token: ticketFor({ dir: 'publish' }),
      });
      expect(response.status).toBe(401);
    });

    it('refuses a ticket naming a camera the session is not for', async () => {
      const response = await authorize({
        action: 'publish',
        path: cameraId,
        token: ticketFor({ cam: '00000000-0000-4000-8000-000000000000' }),
      });
      expect(response.status).toBe(401);
    });

    it('refuses once the session has been closed', async () => {
      // This is what makes "Close" in the dashboard actually stop a stream,
      // rather than leaving it running until the ticket happens to lapse.
      await prisma.videoStreamSession.update({
        where: { id: sessionId },
        data: { status: 'ENDED', endedAt: new Date() },
      });

      const response = await authorize({
        action: 'publish',
        path: cameraId,
        token: ticketFor(),
      });
      expect(response.status).toBe(401);
    });

    it('refuses once the session has expired', async () => {
      await prisma.videoStreamSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const response = await authorize({
        action: 'publish',
        path: cameraId,
        token: ticketFor(),
      });
      expect(response.status).toBe(401);
    });

    it('refuses a request with no ticket at all', async () => {
      const response = await authorize({ action: 'publish', path: sessionId });
      expect(response.status).toBe(401);
    });

    it('says nothing about why it refused', async () => {
      const forged = await authorize({
        action: 'publish',
        path: cameraId,
        token: 'garbage.signature',
      });
      const wrongPath = await authorize({
        action: 'publish',
        path: '00000000-0000-4000-8000-000000000000',
        token: ticketFor(),
      });

      // Identical answers, so the endpoint cannot be used to work out which of
      // several things was wrong with an attempt.
      expect(forged.status).toBe(401);
      expect(wrongPath.status).toBe(401);
      expect(forged.body).toEqual(wrongPath.body);
    });
  });

  // -------------------------------------------------------------------------
  // The device's own view
  // -------------------------------------------------------------------------

  describe('a device asking to publish', () => {
    /** The fixture device's own credentials, as it would present them. */
    async function deviceHeaders(): Promise<Record<string, string>> {
      const device = await prisma.hardwareDevice.findFirstOrThrow({
        where: { organizationId: fleet.id },
      });
      return {
        'x-device-id': device.deviceIdentifier,
        'x-device-secret': 'device-secret',
      };
    }

    it('is told plainly when the environment has no gateway', async () => {
      /*
       * Publishing is switched off for this test rather than assumed off.
       *
       * The first version of this read `VIDEO_PROVIDER` from the developer's own
       * `.env`, and passed only for as long as nobody had configured a gateway
       * locally — so it started failing the moment somebody set one up, which is
       * exactly backwards for a test about what happens when there isn't one.
       *
       * `supportsPublishing` is a plain readonly property rather than a getter,
       * so it is redefined and restored instead of spied on.
       */
      const { videoProvider } = await import('../src/providers/video');
      const original = videoProvider.supportsPublishing;
      Object.defineProperty(videoProvider, 'supportsPublishing', {
        value: false,
        configurable: true,
      });

      try {
        const response = await request<unknown>({
          method: 'POST',
          url: '/api/v1/device-gateway/camera/publish-ticket',
          headers: await deviceHeaders(),
          payload: { channel: 1 },
        });

        // A device handed a ticket here would open its camera, spend a driver's
        // battery and mobile data, and send frames into nothing.
        expect(response.status).toBe(503);
        // The wording depends on whether *viewing* still works — an environment
        // that can show a fitted recorder but has nowhere for a phone to push
        // is a real configuration, and it deserves its own sentence rather than
        // a generic "unavailable".
        expect(response.body.error?.message ?? '').toMatch(
          /nowhere for a device to publish|no video gateway/i,
        );

        // And nothing was recorded as having started, because nothing did.
        const sessions = await prisma.videoStreamSession.count({
          where: { cameraId, status: 'ACTIVE', id: { not: sessionId } },
        });
        expect(sessions).toBe(0);
      } finally {
        Object.defineProperty(videoProvider, 'supportsPublishing', {
          value: original,
          configurable: true,
        });
      }
    });

    it('is refused a channel the device does not have', async () => {
      const response = await request<unknown>({
        method: 'POST',
        url: '/api/v1/device-gateway/camera/publish-ticket',
        headers: await deviceHeaders(),
        payload: { channel: 4 },
      });

      // Reported before the gateway question is even reached: a channel that
      // does not exist is the device's mistake, not the deployment's.
      expect(response.status).toBe(404);
    });

    it('is refused a camera an operator has switched off', async () => {
      await prisma.deviceCamera.update({
        where: { id: cameraId },
        data: { enabled: false },
      });

      const response = await request<unknown>({
        method: 'POST',
        url: '/api/v1/device-gateway/camera/publish-ticket',
        headers: await deviceHeaders(),
        payload: { channel: 1 },
      });

      expect(response.status).toBe(422);
      expect(response.body.error?.message ?? '').toMatch(/switched off/i);
    });
  });
});
