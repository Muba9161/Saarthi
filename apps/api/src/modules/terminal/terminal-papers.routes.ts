import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errors } from '../../lib/errors';
import { ok, parseParams, parseQuery } from '../../lib/http';
import { authenticateDeviceRequest } from '../devices/device-auth';
import { storageProvider } from '../../providers/storage';
import { requireTerminal } from './terminal.service';
import { authorizedSessionForTerminal } from './session.service';
import {
  driverDocumentForDownload,
  driverDocuments,
  driverPapersWallet,
  vehiclePhotoForDownload,
} from './driver-papers.service';
import { idParamSchema, terminalLimit } from './terminal-http';

const photoQuerySchema = z.object({ variant: z.enum(['original', 'thumb']).default('original') });

/**
 * The papers a checkpoint might ask for, for the vehicle and driver on this
 * terminal — and nothing else in the fleet.
 *
 * Every byte route here is scoped by the terminal's own vehicle and session,
 * never by an id alone: a document or photo id is not a capability, and
 * answering "not found" for somebody else's file is what keeps a lifted tablet
 * from walking a fleet's paperwork.
 */
export async function terminalPapersRoutes(app: FastifyInstance): Promise<void> {
  /** Uploaded papers only — kept for terminals that predate the wallet. */
  app.get('/papers', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);

    return ok(
      reply,
      await driverDocuments(terminal.organizationId, terminal.vehicleId, session.driverId ?? null),
    );
  });

  /**
   * The whole wallet: folders as the web files them, the uploaded papers, the
   * RTO's virtual RC (masked for a driver), the driver's licence and the
   * vehicle's photographs — one request for the whole Papers tab.
   */
  app.get('/papers/wallet', { config: terminalLimit(20) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);

    return ok(
      reply,
      await driverPapersWallet(terminal.organizationId, terminal.vehicleId, session.driverId ?? null),
    );
  });

  /**
   * One document's bytes, so the app can hold it for a checkpoint.
   *
   * Cached by the app on purpose. A document that needs a signal to show is a
   * document that fails exactly where it is demanded — a border post, a mine
   * gate, a bypass at two in the morning.
   */
  app.get('/papers/:id/download', { config: terminalLimit(30) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    const session = await authorizedSessionForTerminal(terminal.device.id);
    const { id } = parseParams(idParamSchema, request.params);

    const document = await driverDocumentForDownload(
      terminal.organizationId,
      terminal.vehicleId,
      session.driverId ?? null,
      id,
    );
    if (!document) throw errors.notFound('Document');

    const download = await storageProvider.download(document.storageKey);

    reply
      .header('content-type', document.mimeType ?? 'application/octet-stream')
      .header('content-length', download.size)
      .header('content-disposition', `inline; filename="${document.fileName}"`)
      // Private: somebody's licence and address. It must not sit in a shared
      // cache between one driver signing off and the next signing on.
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff');

    return reply.send(download.stream);
  });

  /** One of this vehicle's photographs, for the Photos folder. */
  app.get('/papers/photos/:id', { config: terminalLimit(60) }, async (request, reply) => {
    const terminal = requireTerminal(await authenticateDeviceRequest(request));
    await authorizedSessionForTerminal(terminal.device.id);
    const { id } = parseParams(idParamSchema, request.params);
    const { variant } = parseQuery(photoQuerySchema, request.query);

    const photo = await vehiclePhotoForDownload(terminal.vehicleId, id, variant === 'thumb');
    if (!photo) throw errors.notFound('Photo');

    const download = await storageProvider.download(photo.storageKey);

    reply
      .header('content-type', photo.mimeType)
      .header('content-length', download.size)
      .header('content-disposition', 'inline')
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff');

    return reply.send(download.stream);
  });
}
