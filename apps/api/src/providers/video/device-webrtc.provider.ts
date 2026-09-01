import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import type {
  ClipQuery,
  PublishRequest,
  PublishTicket,
  RecordingClip,
  StreamRequest,
  StreamTicket,
  VideoProvider,
} from './video.provider';

/**
 * WebRTC through an external WHIP/WHEP gateway.
 *
 * This is what makes a phone camera reachable from a dashboard, and the reason
 * it is a *provider* rather than something built into the API is the reason the
 * abstraction exists at all: video must never pass through Saarthi. Four 4G
 * streams routed through an application server would cost more in bandwidth
 * than the entire telematics product, and would put a stack that answers JSON
 * in the path of something running at fifteen frames a second.
 *
 * So Saarthi issues credentials and records who used them. Frames go
 * device → gateway → browser and are never seen here.
 *
 * ## The two directions
 *
 * A YC06 sits on a fixed address a gateway can dial. A phone sits behind
 * carrier NAT and cannot be reached at all, so it publishes outward. Both
 * arrive at the viewer as WebRTC, and the dashboard cannot tell which it is
 * watching.
 *
 *   phone  ──WHIP──▶ gateway ──WHEP──▶ browser
 *   YC06   ◀──dial── gateway ──WHEP──▶ browser
 *
 * ## The tickets
 *
 * A ticket is an HMAC over the facts the gateway needs, signed with a secret
 * only Saarthi and the gateway hold. The gateway does not verify it itself — it
 * hands it back through `POST /video-gateway/authorize`, so the decision about
 * who may point a camera at a driver stays with Saarthi, where the access log
 * is. See `video-gateway.routes.ts`.
 *
 * Tickets are short-lived, single-camera and single-session. A stolen one buys
 * a few minutes on one camera, and the session it belongs to is in the access
 * log either way.
 *
 * ## URL shape
 *
 * `{gateway}/{cameraId}/whip` and `{gateway}/{cameraId}/whep` — the convention
 * MediaMTX, Cloudflare Stream and most WHIP servers use.
 *
 * The path is the **camera**, deliberately, and not the session. A gateway path
 * is a rendezvous: the device publishing and the dispatcher watching have to
 * name the same one or they never meet, and they hold different sessions by
 * definition — one per device, one per viewer, several viewers at once. Keying
 * the path on the session was a bug that could only ever appear with a real
 * publisher and a real viewer at the same time, because everything answers
 * correctly right up until the point where the stream should appear.
 *
 * Sessions still exist and still matter: each ticket carries its own, the access
 * log records who watched and for how long, and closing one revokes that
 * ticket. They identify *who is connected*, not *what they are connected to*.
 */

/** What a ticket asserts, and what the gateway asks Saarthi to confirm. */
export interface GatewayTicketClaims {
  /** Stream session id — who is connected, and the row in the access log. */
  sid: string;
  /** Camera this ticket is for. Also the gateway path both ends meet on. */
  cam: string;
  /** Device identifier, for the gateway's own logs. */
  dev: string;
  /** Camera channel on that device. */
  ch: number;
  /** `publish` for a device sending, `watch` for a browser receiving. */
  dir: 'publish' | 'watch';
  /** Unix seconds. */
  exp: number;
  nonce: string;
}

/**
 * Sign a ticket.
 *
 * Exported because the authorisation route has to verify what this produced,
 * and duplicating the format in two files is how the two drift apart.
 */
export function signGatewayTicket(claims: GatewayTicketClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Verify a ticket and return what it claims.
 *
 * Returns `null` for every failure without saying which — a malformed token, a
 * bad signature and an expired one are indistinguishable from outside, so the
 * endpoint cannot be used to probe the format.
 *
 * The signature is compared with `timingSafeEqual`, because this is reachable
 * by anything that can talk to the gateway.
 */
export function verifyGatewayTicket(
  token: string,
  secret: string,
  now: Date = new Date(),
): GatewayTicketClaims | null {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  let claims: GatewayTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GatewayTicketClaims;
  } catch {
    return null;
  }

  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now.getTime()) return null;
  if (claims.dir !== 'publish' && claims.dir !== 'watch') return null;
  if (typeof claims.sid !== 'string' || typeof claims.cam !== 'string') return null;

  return claims;
}

export class DeviceWebRtcVideoProvider implements VideoProvider {
  readonly name = 'device-webrtc';
  readonly supportsLive = true;
  readonly supportsPlayback = false;
  readonly supportsPublishing = true;
  readonly unavailableReason =
    'This gateway carries live video only. Recorded footage stays on the device and is not retrievable through Saarthi.';

  private readonly gatewayUrl: string;
  private readonly secret: string;

  constructor() {
    if (!config.video.gatewayUrl || !config.video.gatewaySecret) {
      // Thrown at construction so the factory can fall back at boot, rather
      // than every camera request failing at the moment somebody urgently
      // needs one.
      throw new Error(
        'VIDEO_PROVIDER=device requires VIDEO_GATEWAY_URL and VIDEO_GATEWAY_SECRET.',
      );
    }
    this.gatewayUrl = config.video.gatewayUrl;
    this.secret = config.video.gatewaySecret;
  }

  /**
   * ICE servers for this deployment.
   *
   * Empty on a LAN, where host candidates find each other directly. A phone on
   * a mobile network behind carrier-grade NAT needs at least STUN and often a
   * TURN relay — which is a deployment fact, not something the app can know, so
   * it is configuration.
   */
  private iceServers(): PublishTicket['iceServers'] {
    return config.video.iceServers.map((urls) => ({
      urls,
      ...(urls.startsWith('turn') && config.video.turnUsername
        ? {
            username: config.video.turnUsername,
            credential: config.video.turnCredential ?? '',
          }
        : {}),
    }));
  }

  async issueTicket(request: StreamRequest): Promise<StreamTicket> {
    const expiresAt = new Date(Date.now() + request.ttlSeconds * 1000);

    return {
      // The camera is the rendezvous point. See the note on URL shape.
      gatewayUrl: `${this.gatewayUrl}/${request.cameraId}/whep`,
      token: signGatewayTicket(
        {
          // What the ticket is for, and nothing more. The gateway deliberately
          // learns nothing about the vehicle, the driver or the fleet — it is a
          // relay, not a participant in the business.
          sid: request.sessionId,
          cam: request.cameraId,
          dev: request.deviceIdentifier,
          ch: request.channel,
          dir: 'watch',
          exp: Math.floor(expiresAt.getTime() / 1000),
          nonce: randomBytes(8).toString('base64url'),
        },
        this.secret,
      ),
      protocol: 'webrtc',
      expiresAt: expiresAt.toISOString(),
      iceServers: this.iceServers(),
      posterUrl: null,
      simulated: false,
    };
  }

  async issuePublishTicket(request: PublishRequest): Promise<PublishTicket> {
    const expiresAt = new Date(Date.now() + request.ttlSeconds * 1000);

    return {
      ingestUrl: `${this.gatewayUrl}/${request.cameraId}/whip`,
      sessionId: request.sessionId,
      token: signGatewayTicket(
        {
          sid: request.sessionId,
          cam: request.cameraId,
          dev: request.deviceIdentifier,
          ch: request.channel,
          dir: 'publish',
          exp: Math.floor(expiresAt.getTime() / 1000),
          nonce: randomBytes(8).toString('base64url'),
        },
        this.secret,
      ),
      protocol: 'whip',
      expiresAt: expiresAt.toISOString(),
      iceServers: this.iceServers(),
      // Chosen for a truck on 4G in a district town, not a demo on office wifi.
      // 720p at 15 fps is legible enough to identify a hazard and cheap enough
      // that a driver's data allowance survives the month; anything more
      // ambitious is a stream that stalls exactly when somebody needs it.
      constraints: {
        maxWidth: 1280,
        maxHeight: 720,
        maxFrameRate: 15,
        maxBitrateKbps: 800,
      },
      simulated: false,
    };
  }

  async listClips(_query: ClipQuery): Promise<RecordingClip[]> {
    throw errors.providerNotConfigured('video', this.unavailableReason);
  }
}
