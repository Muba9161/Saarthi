import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  DocumentOwnerType,
  documentListQuerySchema,
  endTerminalSessionSchema,
  finishAdHocTripSchema,
  nearbyCategoriesFor,
  pairTerminalSchema,
  reportOdometerSchema,
  reportTerminalIssueSchema,
  startAdHocTripSchema,
  submitChecklistSchema,
  terminalAskSchema,
  terminalNearbySchema,
  terminalPlaceSearchSchema,
  terminalRouteSchema,
  terminalTripEventSchema,
} from '@saarthi/shared';
import { errors } from '../../lib/errors';
import { created, ok, parseBody, parseQuery } from '../../lib/http';
import { publicAppUrl } from '../../lib/public-url';
import {
  authenticateDeviceRequest,
  deviceRateLimitKey,
} from '../devices/device-auth';
import { truckPassport } from '../analytics/analytics.service';
import { vehicleServiceTimeline } from '../maintenance/service-history.service';
import { listDocuments } from '../documents/document.service';
import { latestReadingForVehicle } from '../telemetry/telemetry.service';
import { prisma } from '../../database/prisma';
import { storageProvider } from '../../providers/storage';
import { redeemTerminalPairing } from './terminal-pairing.service';
import {
  driverAuthForSession,
  invalidateTerminalState,
  requireTerminal,
  terminalDriver,
  terminalState,
  terminalVehicleQr,
} from './terminal.service';
import {
  authorizedSessionForTerminal,
  completeTrip,
  endSession,
  startTrip,
} from './session.service';
import { prepareChecklist, submitChecklist } from './checklist.service';
import { findServices, routeTo, searchPlaces } from './navigation.service';
import {
  finishAdHocTrip,
  openAdHocTripForVehicle,
  startAdHocTrip,
} from './adhoc-trip.service';
import { applyOdometer } from '../vehicles/odometer.service';
import { issuesForVehicle, reportIssue } from './issue.service';
import { ask } from './assistant.service';

/**
 * The Saarthi Terminal client surface.
 *
 * Mounted under `/device-gateway`, alongside the existing device client routes,
 * for one reason that matters operationally: a terminal in a truck configures
 * exactly one base URL. Enrolment, token exchange, heartbeat, telemetry,
 * location, SOS, commands and camera are **not** re-declared here — a terminal
 * uses the endpoints that already exist for those, because a second ingestion
 * path is a second set of rate limits, idempotency rules and validation that
 * will eventually disagree with the first.
 *
 * `app.authenticate` is deliberately never registered on this plugin. A user
 * session is not an accepted identity here.
 *
 * The one thing every route below has in common: nothing is taken from the
 * request that identifies a vehicle, a driver or a fleet. All three come from
 * the terminal's own assignment and its live session.
 */

/** Rate-limit configuration for a terminal route, keyed on the device. */
function terminalLimit(max: number, timeWindow = '1 minute') {
  return {
    rateLimit: {
      max,
      timeWindow,
      keyGenerator: (request: FastifyRequest) => deviceRateLimitKey(request),
    },
  };
}

export async function terminalClientRoutes(app: FastifyInstance): Promise<void> {
  /*
   * Tolerate an empty JSON body — the same accommodation the device client
   * routes make, and for the same reason: OkHttp sends
   * `Content-Type: application/json` with no body for a POST with an empty
   * request body, and Fastify's default parser treats that as malformed. A
   * correct terminal would become a 400 nobody could diagnose from the cab.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string | Buffer, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      if (text.trim() === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text) as unknown);
      } catch {
        done(errors.validation('The request body is not valid JSON.'), undefined);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  /**
   * Connect this terminal to a vehicle.
   *
   * Accepts the scanned token or the typed `STH-XXXX-XXXX` code. Limited hard:
   * a pairing credential is a bearer capability, and an unbounded redemption
   * endpoint is how one gets brute-forced.
   */
  app.post('/pair', { config: terminalLimit(10) }, async (request, reply) => {
    const caller = await authenticateDeviceRequest(request);
    const input = parseBody(pairTerminalSchema, request.body);
    const result = await redeemTerminalPairing(caller, input);
    if (result.identity.deviceId) await invalidateTerminalState(result.identity.deviceId);
    return created(reply, result);
  });

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  /**
   * Everything the terminal needs to decide what to render.
   *
   * The single most-called endpoint in the product. It answers for an unpaired
   * terminal too, because "not connected to a vehicle" is the first screen the
   * app ever shows and a 4xx would be a worse way to say it.
   *
   * The ceiling is set for a tablet polling every few seconds as a fallback for
   * a dropped socket, which on a mobile network is most of them most of the
   * time.
   */
  app.get('/state', { config: terminalLimit(60) }, async (request, reply) => {
    const caller = await authenticateDeviceRequest(request);
    return ok(reply, await terminalState(caller, { frontendUrl: publicAppUrl(request) }));
  });

  /**
   * The vehicle's permanent QR.
   *
   * The same code printed on the windscreen. Never a per-driver code — see the
   * note on `terminalVehicleQr`.
   */
  app.get('/vehicle-qr', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    return ok(reply, await terminalVehicleQr(terminal.vehicleId, publicAppUrl(request)));
  });

  // -------------------------------------------------------------------------
  // Pre-trip checklist
  // -------------------------------------------------------------------------

  /** The checklist to present, with whatever the vehicle can answer itself. */
  app.get('/checklist', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    // Requires an approved driver: a checklist is signed by a person, and a
    // terminal with nobody on it has nobody to sign it.
    await authorizedSessionForTerminal(terminal.device.id);
    return ok(reply, await prepareChecklist(terminal.organizationId, terminal.vehicleId));
  });

  /**
   * Submit the completed check.
   *
   * Automated verdicts are recomputed server-side and override whatever the
   * payload claimed — see `submitChecklist`. Only a passing check makes the
   * session READY.
   */
  app.post('/checklist', { config: terminalLimit(10) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(submitChecklistSchema, request.body);
    return created(reply, await submitChecklist(session, input));
  });

  // -------------------------------------------------------------------------
  // Trip lifecycle
  // -------------------------------------------------------------------------

  app.post('/trip/start', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(terminalTripEventSchema, request.body ?? {});
    return ok(reply, await startTrip(session.id, input));
  });

  app.post('/trip/complete', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(terminalTripEventSchema, request.body ?? {});
    return ok(reply, await completeTrip(session.id, input));
  });

  // -------------------------------------------------------------------------
  // Service runs — a trip nobody dispatched
  // -------------------------------------------------------------------------

  /**
   * Open a trip for a run to a nearby service (specification sections 28 and 29).
   *
   * Posted when the driver picks a destination out of the nearby list and the
   * vehicle has no dispatched trip. Until this existed, a truck that drove
   * forty kilometres for diesel left no record of it anywhere: no distance, no
   * speeds, no braking, and an odometer that had not moved since the last time
   * somebody filled in a form.
   *
   * `null` is a valid answer and not an error. A vehicle already on a dispatched
   * trip is already being recorded, and failing here would break navigation for
   * the ordinary case in order to serve the exceptional one.
   */
  app.post('/trip/service-run', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(startAdHocTripSchema, request.body);
    return ok(reply, await startAdHocTrip(session, input));
  });

  /**
   * Close it, with what the run added up to.
   *
   * Sent on arrival, and again with `cancelled` when the driver stops navigating
   * short of the destination. Both keep the figures — a cancelled run is still a
   * journey the vehicle made, and discarding its distance would leave the same
   * hole this endpoint exists to fill.
   */
  app.post('/trip/service-run/finish', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(finishAdHocTripSchema, request.body ?? {});
    return ok(reply, await finishAdHocTrip(session, input));
  });

  /**
   * The service run currently open on this vehicle, if any.
   *
   * A terminal that restarted mid-run — a flat battery on a forecourt, an app
   * killed for memory — comes back with no idea it had a trip open. Without this
   * it would open a second one for the same journey and split the distance
   * between them.
   */
  app.get('/trip/service-run', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    const open = await openAdHocTripForVehicle(terminal.vehicleId);
    return ok(
      reply,
      open
        ? {
            id: open.id,
            reference: open.reference,
            status: open.status,
            destinationName: open.destinationAddress,
            destinationLatitude: open.destinationLatitude,
            destinationLongitude: open.destinationLongitude,
            plannedDistanceKm: open.plannedDistanceKm,
            actualDistanceKm: open.actualDistanceKm,
            startedAt: (open.actualStartAt ?? open.createdAt).toISOString(),
            startOdometerKm: open.startOdometerKm,
          }
        : null,
    );
  });

  /**
   * The odometer, as the vehicle currently reads it.
   *
   * Independent of any trip, because a vehicle accrues distance whether or not
   * anybody opened a movement against it — and because the figure has to reach
   * the maintenance schedule, the passport, the resale valuation and the fleet
   * list, not just the gauge in the cab.
   *
   * The reply carries the figure Saarthi actually holds afterwards, which is not
   * always the one that was sent: the odometer never moves backwards, so a
   * terminal fitted to a different truck learns the real reading here instead of
   * overwriting it.
   */
  app.post('/odometer', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(reportOdometerSchema, request.body);

    const odometerKm = await applyOdometer({
      vehicleId: terminal.vehicleId,
      odometerKm: input.odometerKm,
      reason: `terminal-report:${input.source}`,
    });

    return ok(reply, { odometerKm: odometerKm ?? input.odometerKm });
  });

  /** The driver signs off. The terminal returns to showing the vehicle QR. */
  app.post('/session/end', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(endTerminalSessionSchema, request.body ?? {});
    return ok(
      reply,
      await endSession(session.id, input.reason ?? null, session.driverUserId),
    );
  });

  // -------------------------------------------------------------------------
  // Vehicle information
  // -------------------------------------------------------------------------

  /**
   * The vehicle passport.
   *
   * The existing `truckPassport`, reached through the *driver's* own
   * authorisation rather than a device back door — so a driver whose account
   * was suspended since sign-on is refused here exactly as they would be in the
   * web app.
   */
  app.get('/passport', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    await driverAuthForSession(session);

    const passport = await truckPassport(terminal.organizationId, terminal.vehicleId);
    if (!passport) throw errors.notFound('Vehicle');
    return ok(reply, passport);
  });

  /** Maintenance and service history, as the driver may see it. */
  app.get('/maintenance', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const auth = await driverAuthForSession(session);

    const [timeline, issues] = await Promise.all([
      vehicleServiceTimeline(auth, terminal.vehicleId),
      issuesForVehicle(terminal.vehicleId, 10),
    ]);
    return ok(reply, { ...timeline, reportedIssues: issues });
  });

  /** Vehicle compliance documents. */
  app.get('/documents', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const auth = await driverAuthForSession(session);

    const documents = await listDocuments(
      auth,
      // Built through the shared schema rather than a literal, so a new
      // required filter cannot silently default to something this route did not
      // intend.
      parseQuery(documentListQuerySchema, {
        ownerType: DocumentOwnerType.TRUCK,
        ownerId: terminal.vehicleId,
        page: '1',
        pageSize: '50',
        sortBy: 'expiryDate',
        sortOrder: 'asc',
      }),
    );
    return ok(reply, documents);
  });

  /** The signed-on driver's own information (specification section 25). */
  app.get('/driver', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    return ok(reply, await terminalDriver(session.driverId));
  });

  /**
   * The arrival photo of the driver signed on to *this* terminal.
   *
   * The session view already carries a `selfieUrl`, but it points at
   * `/media/:id/file`, which authenticates a **person**. A terminal holds a
   * device credential from a different signing key, so it could never fetch its
   * own driver's photo — the tablet knew the URL and was refused at it. The
   * result was a cockpit that showed a name and no face, when a face is the
   * whole reason the photograph was taken.
   *
   * Scoped rather than general: no media id is accepted. The terminal asks for
   * "the selfie of whoever is signed on to me" and the server resolves it, so
   * this endpoint cannot be walked through a fleet's media library even by a
   * terminal whose credentials have been lifted off it.
   */
  app.get('/selfie', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);

    if (!session.selfieMediaId) {
      throw errors.notFound('Arrival photo', 'No arrival photo was taken for this driver.');
    }

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: session.selfieMediaId },
      select: { storageKey: true, mimeType: true, checksum: true, organizationId: true },
    });

    // Belt and braces: the session already scopes this to one terminal, and the
    // tenant check makes a mismatched row unreachable rather than merely
    // unlikely.
    if (!asset || asset.organizationId !== terminal.device.organizationId) {
      throw errors.notFound('Arrival photo');
    }

    const etag = asset.checksum ? `"${asset.checksum}-terminal"` : undefined;
    if (etag && request.headers['if-none-match'] === etag) {
      return reply.code(304).header('etag', etag).send();
    }

    const download = await storageProvider.download(asset.storageKey);

    reply
      .header('content-type', asset.mimeType)
      .header('content-length', download.size)
      .header('content-disposition', 'inline')
      // Private: this is a photograph of a person, and it must not sit in a
      // shared cache between one driver signing off and the next signing on.
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff');

    if (etag) reply.header('etag', etag);
    return reply.send(download.stream);
  });

  /** The live reading behind the dashboard gauges. */
  app.get('/telemetry/latest', { config: terminalLimit(60) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    return ok(reply, await latestReadingForVehicle(terminal.vehicleId));
  });

  // -------------------------------------------------------------------------
  // Services
  // -------------------------------------------------------------------------

  /**
   * Vehicle-aware nearby services (specification section 28).
   *
   * Goes through the same `/nearby/places` provider the web app uses. The
   * terminal passes its own position rather than the server inferring one from
   * the last telemetry frame, because a driver standing beside a parked truck
   * looking for a mechanic is asking about where *they* are.
   */
  app.get('/nearby', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    const query = parseQuery(terminalNearbySchema, request.query);

    return ok(
      reply,
      await findServices({
        organizationId: terminal.organizationId,
        vehicleId: terminal.vehicleId,
        service: query.service ?? null,
        categories: query.service ? nearbyCategoriesFor(query.service) : [],
        latitude: query.latitude,
        longitude: query.longitude,
        radiusKm: query.radiusKm,
        limit: query.limit,
      }),
    );
  });

  /**
   * The route to one place (specification sections 29 and 44).
   *
   * Fetched only when the driver has actually chosen somewhere — one routing
   * call for one decision, rather than a polyline for every row in a list they
   * scrolled past. Routed on the *vehicle's* profile, so a 40-tonne truck is not
   * sent under a bridge it does not fit beneath.
   *
   * Limited tightly. Routing is the one part of the map stack that costs money,
   * and a terminal in a loop would spend a fleet's daily allowance before
   * anybody noticed.
   */
  /**
   * Search for somewhere by name.
   *
   * A driver is sent to a named place far more often than to a category — a
   * society, a warehouse, a customer's gate — and no list of chips could ever
   * cover that. Results come back in the same shape a nearby place does, so
   * choosing one starts a trip through exactly the same path.
   */
  app.post('/search', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(terminalPlaceSearchSchema, request.body);

    return ok(
      reply,
      await searchPlaces({
        query: input.query,
        from: { latitude: input.latitude, longitude: input.longitude },
        limit: input.limit,
      }),
    );
  });

  app.post('/route', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(terminalRouteSchema, request.body);

    return ok(
      reply,
      await routeTo({
        vehicleId: terminal.vehicleId,
        from: { latitude: input.fromLatitude, longitude: input.fromLongitude },
        to: { latitude: input.toLatitude, longitude: input.toLongitude },
        destinationName: input.destinationName ?? 'Destination',
        avoidTolls: input.avoidTolls,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Issue reporting
  // -------------------------------------------------------------------------

  /**
   * Report a vehicle problem from the cab.
   *
   * Photographs are referenced by media id — the terminal uploads them through
   * the driver's own media endpoint first, so there is one copy of each image
   * and one retention policy.
   */
  app.post('/issues', { config: terminalLimit(10) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(reportTerminalIssueSchema, request.body);
    return created(reply, await reportIssue(session, input));
  });

  app.get('/issues', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    return ok(reply, await issuesForVehicle(terminal.vehicleId, 20));
  });

  // -------------------------------------------------------------------------
  // Assistant
  // -------------------------------------------------------------------------

  /**
   * "Hey Saarthi".
   *
   * Answered under the driver's own authorisation through the existing
   * controlled tool layer. Emergency intent is recognised before any model call
   * and returned as an action for the terminal to run against the existing
   * device SOS endpoint — see `assistant.service.ts`.
   *
   * The rate limit is a second line behind the per-session budget: this one
   * catches a terminal with no session at all hammering the endpoint.
   */
  app.post('/ai/ask', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const input = parseBody(terminalAskSchema, request.body);
    return ok(reply, await ask(session, input));
  });
}
