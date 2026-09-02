import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  Permission,
  approveTerminalAssignmentSchema,
  cancelTerminalAssignmentSchema,
  createTerminalPairingTokenSchema,
  idParamSchema,
  rejectTerminalAssignmentSchema,
  requestTerminalAssignmentSchema,
  submitTerminalAssignmentSchema,
  terminalAssignmentListSchema,
  terminalIssueListSchema,
  terminalSelfieMetaSchema,
  updateChecklistTemplateSchema,
  updateTerminalIssueSchema,
  type VehicleType,
} from '@saarthi/shared';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { created, ok, paginated, parseBody, parseInput, parseParams, parseQuery } from '../../lib/http';
import { publicAppUrl } from '../../lib/public-url';
import {
  requireAuth,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import type { UploadFilePart } from '../media/media.service';
import { createTerminalPairing, listTerminalPairings } from './terminal-pairing.service';
import { listTerminals } from './terminal.service';
import * as sessions from './session.service';
import * as checklist from './checklist.service';
import * as issues from './issue.service';

/**
 * The people-facing Saarthi Terminal surface.
 *
 * Two very different callers share this plugin, and the permission on each
 * route is what separates them:
 *
 *   * a **driver**, holding `terminal.drive`, acting on their own request from
 *     their phone or the web app;
 *   * an **owner, provider or manager**, holding `terminal.approve`, deciding
 *     other people's requests.
 *
 * The approve route is the most consequential endpoint in this product. It is
 * the only thing that puts a person behind a wheel, and it is gated on a
 * dedicated permission rather than on `devices.*` or `fleet.trucks.assign`,
 * precisely so a fleet can grant it deliberately.
 */

/** Multipart parts for a selfie upload: one image, one optional thumbnail. */
async function readSelfieUpload(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  file: UploadFilePart | null;
  thumbnail: UploadFilePart | null;
}> {
  const fields: Record<string, string> = {};
  let file: UploadFilePart | null = null;
  let thumbnail: UploadFilePart | null = null;

  /*
   * Two file parts, not one.
   *
   * The application-wide multipart limit is a single file, which is right for
   * every other upload and wrong here: an uploader that sends its own
   * thumbnail sends two, and busboy aborts the *second* one with a bare
   * "reach files limit". The photo never arrives and the message names no
   * photo, no limit anybody set, and nothing the person holding the phone can
   * change.
   *
   * Raised only for this reader. A route that accepts one file keeps rejecting
   * a second, which is the actual protection.
   */
  for await (const part of request.parts({ limits: { files: 2 } })) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.file.truncated) {
        throw errors.payloadTooLarge(
          `The photo is larger than the ${Math.round(config.media.maxFileSize / 1024 / 1024)} MB limit. Take it again at a lower resolution.`,
        );
      }
      const rendition: UploadFilePart = {
        buffer,
        fileName: part.filename ?? 'selfie.jpg',
        declaredMimeType: part.mimetype ?? 'application/octet-stream',
      };
      if (part.fieldname === 'thumbnail') thumbnail = rendition;
      else file = rendition;
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  return { fields, file, thumbnail };
}

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // Driver — arriving at a vehicle
  // -------------------------------------------------------------------------

  /**
   * Ask to be assigned to the vehicle whose QR was just scanned.
   *
   * The QR is the vehicle's own permanent code; no per-driver code is created
   * anywhere in this flow. Scanning is not authorisation — this opens a request
   * and nothing more (specification sections 10 and 52).
   */
  app.post(
    '/assignments/request',
    { preHandler: requirePermission(Permission.TERMINAL_DRIVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(requestTerminalAssignmentSchema, request.body);
      const session = await sessions.requestAssignment(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_ASSIGNMENT_REQUESTED,
        entityType: 'TerminalSession',
        entityId: session.id,
        after: { vehicleId: session.vehicleId, registrationNumber: session.registrationNumber },
      });

      return created(reply, session);
    },
  );

  /**
   * Attach the arrival selfie.
   *
   * Multipart, stored once through the existing media library. Retaking before
   * submission is allowed and supersedes the previous photo.
   */
  app.post(
    '/assignments/:id/selfie',
    { preHandler: requirePermission(Permission.TERMINAL_DRIVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);

      if (!request.isMultipart()) {
        throw errors.validation('The arrival photo must be uploaded as multipart/form-data.');
      }

      const { fields, file, thumbnail } = await readSelfieUpload(request);
      if (!file) throw errors.validation('Attach the arrival photo.');

      const meta = parseInput(terminalSelfieMetaSchema, fields);
      const session = await sessions.attachSelfie(
        auth,
        id,
        meta,
        file,
        thumbnail ?? undefined,
      );
      return ok(reply, session);
    },
  );

  /** Hand the request to the fleet. This is where the SLA clock starts. */
  app.post(
    '/assignments/:id/submit',
    { preHandler: requirePermission(Permission.TERMINAL_DRIVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(submitTerminalAssignmentSchema, request.body ?? {});
      return ok(reply, await sessions.submitForApproval(auth, id, input));
    },
  );

  /** Withdraw a request before anybody has decided it. */
  app.post(
    '/assignments/:id/cancel',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(cancelTerminalAssignmentSchema, request.body ?? {});
      return ok(reply, await sessions.cancelAssignment(auth, id, input));
    },
  );

  /** The driver's own live request, for their phone or the driver home screen. */
  app.get(
    '/assignments/mine',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      return ok(reply, await sessions.mySession(auth));
    },
  );

  // -------------------------------------------------------------------------
  // Fleet — the arrival queue
  // -------------------------------------------------------------------------

  app.get(
    '/assignments',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(terminalAssignmentListSchema, request.query);
      const result = await sessions.listSessions(auth, organizationId, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/assignments/:id',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const session = await sessions.getSession(auth, id);

      // The approver needs to know whether this is somebody who drives this
      // truck every week or somebody who has never been near it (section 14).
      const history = session.driver
        ? await sessions.recentHistoryForApprover(session.driver.driverId, session.vehicleId)
        : [];

      return ok(reply, {
        ...session,
        recentAssignments: history,
        events: await sessions.sessionHistory(auth, id),
      });
    },
  );

  /**
   * Approve a driver onto a vehicle.
   *
   * The only path in Saarthi that authorises somebody to drive. Audited by
   * name, because six months later somebody will need to know who decided.
   */
  app.post(
    '/assignments/:id/approve',
    { preHandler: requirePermission(Permission.TERMINAL_APPROVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(approveTerminalAssignmentSchema, request.body ?? {});
      const session = await sessions.approveAssignment(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_ASSIGNMENT_APPROVED,
        entityType: 'TerminalSession',
        entityId: session.id,
        after: {
          driverId: session.driver?.driverId ?? null,
          vehicleId: session.vehicleId,
          registrationNumber: session.registrationNumber,
          assignedVehicle: input.assignVehicle,
        },
      });

      return ok(reply, session);
    },
  );

  /** Refuse a driver. The reason is mandatory and is shown to them. */
  app.post(
    '/assignments/:id/reject',
    { preHandler: requirePermission(Permission.TERMINAL_APPROVE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(rejectTerminalAssignmentSchema, request.body);
      const session = await sessions.rejectAssignment(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_ASSIGNMENT_REJECTED,
        entityType: 'TerminalSession',
        entityId: session.id,
        after: {
          driverId: session.driver?.driverId ?? null,
          vehicleId: session.vehicleId,
          reason: input.reason,
        },
      });

      return ok(reply, session);
    },
  );

  // -------------------------------------------------------------------------
  // Fleet — terminals
  // -------------------------------------------------------------------------

  app.get(
    '/terminals',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      return ok(reply, await listTerminals(organizationId));
    },
  );

  // -------------------------------------------------------------------------
  // Fleet — the configurable checklist (specification section 17)
  // -------------------------------------------------------------------------

  app.get(
    '/checklist-template',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const vehicleType = (request.query as { vehicleType?: string }).vehicleType;
      return ok(
        reply,
        await checklist.getTemplate(organizationId, (vehicleType as VehicleType) ?? null),
      );
    },
  );

  app.put(
    '/checklist-template',
    { preHandler: requirePermission(Permission.TERMINAL_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(updateChecklistTemplateSchema, request.body);
      const template = await checklist.updateTemplate(auth, organizationId, input);

      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_CHECKLIST_UPDATED,
        entityType: 'TerminalChecklistTemplate',
        entityId: template.id,
        after: { items: template.items.length, vehicleType: template.vehicleType },
      });

      return ok(reply, template);
    },
  );

  /** Recent safety checks for one vehicle — the evidence they happen. */
  app.get(
    '/vehicles/:id/checklists',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await checklist.checklistHistory(id));
    },
  );

  // -------------------------------------------------------------------------
  // Fleet — driver-reported issues (specification section 27)
  // -------------------------------------------------------------------------

  app.get(
    '/issues',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(terminalIssueListSchema, request.query);
      const result = await issues.listIssues(auth, organizationId, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.patch(
    '/issues/:id',
    { preHandler: requirePermission(Permission.MAINTENANCE_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateTerminalIssueSchema, request.body);
      return ok(reply, await issues.updateIssue(auth, id, input));
    },
  );
}

/**
 * Terminal pairing, mounted under the vehicle it connects something to.
 *
 * Beside `vehiclePairingRoutes` and for the same reason: issuing the code
 * belongs on the vehicle's Hardware screen, not under a devices menu.
 */
export async function vehicleTerminalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.post(
    '/:id/terminal-pairing',
    { preHandler: requirePermission(Permission.TERMINAL_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(createTerminalPairingTokenSchema, request.body ?? {});

      /*
       * `publicAppUrl(request)` rather than the configured API_URL.
       *
       * API_URL is `http://localhost:4000` in every checkout, and localhost is
       * the one address a tablet can never reach — on a tablet, localhost is
       * the tablet. The code has to encode the address the browser generating
       * it is actually using.
       */
      const issued = await createTerminalPairing(auth, id, input, publicAppUrl(request));

      await auditFromRequest(request, {
        action: AuditAction.TERMINAL_PAIRING_ISSUED,
        entityType: 'DevicePairingToken',
        entityId: issued.id,
        after: { vehicleId: id, registrationNumber: issued.registrationNumber },
      });

      return created(reply, issued);
    },
  );

  /** Pairing history for this vehicle. Never includes a redeemable credential. */
  app.get(
    '/:id/terminal-pairings',
    { preHandler: requirePermission(Permission.TERMINAL_READ) },
    async (request, reply) => {
      const organizationId = requireOrganizationId(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await listTerminalPairings(organizationId, id));
    },
  );
}
