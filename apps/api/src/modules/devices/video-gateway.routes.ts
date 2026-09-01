import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErrorCode } from '@saarthi/shared';
import { config } from '../../config/env';
import { prisma } from '../../database/prisma';
import { logger } from '../../lib/logger';
import { ok, parseBody } from '../../lib/http';
import { verifyGatewayTicket } from '../../providers/video/device-webrtc.provider';

/**
 * The video gateway's authorisation callback.
 *
 * A WHIP/WHEP gateway has to decide, per connection, whether to admit a
 * publisher or a viewer. It could hold its own user list — and then a camera
 * pointed at a driver would be governed by a config file on an SFU, separately
 * from the fleet's actual permissions, with its own copy of who is allowed what.
 *
 * Instead the gateway asks Saarthi. It hands back the ticket it was presented
 * with, and Saarthi answers yes or no from the session it issued that ticket
 * for. That keeps one authority for camera access, keeps the access log
 * complete, and means revoking a device or ending a session takes effect at the
 * gateway on the next connection rather than whenever somebody remembers to
 * update it.
 *
 *   device ──WHIP+ticket──▶ gateway ──POST /authorize──▶ Saarthi
 *                                   ◀──200 or 401───────
 *
 * ## Why this route is unauthenticated in the usual sense
 *
 * The caller is an SFU, not a person and not a device. It holds no session and
 * no device credential — the ticket *is* the credential, and it is verified
 * here. In deployment this endpoint should be reachable only from the gateway,
 * which is what the docker-compose network and a firewall rule are for; nothing
 * it returns is useful without a valid signed ticket in the first place.
 */

const gatewayLogger = logger.child({ module: 'video-gateway-auth' });

/**
 * MediaMTX's external-authentication payload.
 *
 * Fields beyond these are ignored rather than rejected: this is another
 * project's request shape, and pinning it exactly would break on their next
 * minor release for no benefit.
 */
const authorizeSchema = z.object({
  /** `publish` or `read`. MediaMTX's words, not Saarthi's. */
  action: z.string(),
  /** The stream path, which for Saarthi is the camera id. */
  path: z.string().optional(),
  /** The bearer token the client presented. */
  token: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  ip: z.string().optional(),
  protocol: z.string().optional(),
  id: z.string().optional(),
  query: z.string().optional(),
});

/**
 * One refusal for every reason.
 *
 * Deliberately uniform. A caller that could tell "bad signature" from "wrong
 * stream" from "session closed" could use this endpoint to map the system it is
 * trying to get into.
 */
function refuse(reply: FastifyReply) {
  return reply.code(401).send({
    success: false,
    error: { code: ErrorCode.UNAUTHENTICATED, message: 'Not authorised.' },
  });
}

export async function videoGatewayRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Admit or refuse one gateway connection.
   *
   * The status code is the answer — MediaMTX reads that and ignores the body.
   * The body exists so this is debuggable with curl and consistent with the
   * rest of the API, and every refusal returns the *same* body whatever went
   * wrong: which of several checks failed is information handed to whoever is
   * trying.
   */
  app.post(
    '/authorize',
    {
      config: {
        // The gateway asks once per connection. Generous enough for a fleet
        // reconnecting after an outage, low enough that this cannot be used to
        // grind at ticket signatures.
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest, reply) => {
      const secret = config.video.gatewaySecret;
      if (!secret) {
        // No gateway is configured, so nothing should be asking. Refused rather
        // than defaulted open.
        return refuse(reply);
      }

      const input = parseBody(authorizeSchema, request.body ?? {});
      const token = input.token ?? input.password ?? '';

      const claims = verifyGatewayTicket(token, secret);
      if (!claims) {
        gatewayLogger.warn(
          { action: input.action, path: input.path, ip: input.ip },
          'Video gateway presented an invalid or expired ticket',
        );
        return refuse(reply);
      }

      // The path the client asked for must be the camera the ticket was issued
      // for. Without this check a ticket for one camera would admit its holder
      // to any stream on the gateway — which, on a product where a camera points
      // at a driver, is the check that matters most on this endpoint.
      //
      // The path is the camera rather than the session because a publisher and
      // its viewers must name the same path to meet, and they each hold a
      // different session.
      if (input.path && input.path !== claims.cam) {
        gatewayLogger.warn(
          { requested: input.path, ticketCamera: claims.cam },
          'Video gateway ticket used for a different stream path',
        );
        return refuse(reply);
      }

      // `publish` and `read` are MediaMTX's names for the two directions.
      const wants = input.action === 'publish' ? 'publish' : 'watch';
      if (claims.dir !== wants) {
        gatewayLogger.warn(
          { ticketDirection: claims.dir, requested: wants },
          'Video gateway ticket used in the wrong direction',
        );
        return refuse(reply);
      }

      // The session must still be open. This is what makes ending a session in
      // Saarthi — or the sweep expiring one — actually stop the stream, rather
      // than leaving it running until the ticket happens to expire.
      const session = await prisma.videoStreamSession.findUnique({
        where: { id: claims.sid },
        select: { id: true, status: true, expiresAt: true, cameraId: true },
      });

      // The camera check matters as much as the session check: a ticket whose
      // session exists but names a different camera is a ticket that has been
      // tampered with, or a session that was re-used.
      if (!session || session.cameraId !== claims.cam) {
        return refuse(reply);
      }

      if (session.status === 'ENDED' || session.status === 'DENIED' || session.status === 'FAILED') {
        gatewayLogger.info(
          { sessionId: claims.sid, status: session.status },
          'Video gateway connection refused: the session is closed',
        );
        return refuse(reply);
      }

      if (session.expiresAt.getTime() < Date.now()) {
        gatewayLogger.info(
          { sessionId: claims.sid },
          'Video gateway connection refused: the session has expired',
        );
        return refuse(reply);
      }

      gatewayLogger.debug(
        { sessionId: claims.sid, direction: claims.dir, device: claims.dev },
        'Video gateway connection admitted',
      );

      // A publisher connecting is the first moment Saarthi knows frames are
      // genuinely flowing, as opposed to a ticket having been issued.
      if (claims.dir === 'publish') {
        await prisma.deviceCamera
          .update({
            where: { id: claims.cam },
            data: { status: 'ONLINE', lastFrameAt: new Date() },
          })
          .catch(() => undefined);
      }

      return ok(reply, { authorized: true, session: claims.sid, direction: claims.dir });
    },
  );
}
