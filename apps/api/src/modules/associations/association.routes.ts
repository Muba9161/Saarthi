import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  OrganizationType,
  Permission,
  VerificationStatus,
  acknowledgeAlertSchema,
  alertNoteSchema,
  assignResponderSchema,
  associationAlertListQuerySchema,
  associationListQuerySchema,
  coverageAreaSchema,
  escalateAlertSchema,
  idParamSchema,
  registerAssociationSchema,
  resolveAlertSchema,
  updateAssociationSchema,
  updateResponderSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireOrganizationType,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as associationService from './association.service';
import * as alertService from './association-alert.service';

/**
 * Truck association routes.
 *
 * Two audiences, deliberately separated:
 *
 *  * an association working its own queue (`association.*` permissions), and
 *  * platform staff verifying associations and reading the directory.
 *
 * Registration is the only route open to any signed-in user, because that is
 * how an association joins Saarthi in the first place.
 */
/**
 * Running an emergency queue is what a truck association *is*. Registering a
 * profile and administering it therefore require the account to actually be
 * one, chosen at sign-up — a fleet cannot register itself as an association.
 */
const requireAssociation = () =>
  requireOrganizationType(OrganizationType.TRUCK_ASSOCIATION);

export async function associationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  // -------------------------------------------------------------------------
  // Registration & profile
  // -------------------------------------------------------------------------

  app.post('/register', { preHandler: requireAssociation() }, async (request, reply) => {
    const auth = requireAuth(request);
    const input = parseBody(registerAssociationSchema, request.body);
    const association = await associationService.registerAssociation(auth, input);

    await auditFromRequest(request, {
      action: AuditAction.ASSOCIATION_REGISTERED,
      entityType: 'AssociationProfile',
      entityId: association.id,
      organizationId: association.organizationId,
      after: {
        name: association.name,
        district: association.district,
        state: association.state,
        coverageAreas: association.coverageAreas.length,
      },
    });

    return created(reply, association);
  });

  app.get(
    '/me',
    { preHandler: requirePermission(Permission.ASSOCIATION_READ) },
    async (request, reply) => ok(reply, await associationService.getOwnAssociation(requireAuth(request))),
  );

  app.patch(
    '/me',
    { preHandler: [requirePermission(Permission.ASSOCIATION_MANAGE), requireAssociation()] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(updateAssociationSchema, request.body);
      const association = await associationService.updateAssociation(auth, input);

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_UPDATED,
        entityType: 'AssociationProfile',
        entityId: association.id,
        after: { acceptingAlerts: association.acceptingAlerts },
      });

      return ok(reply, association);
    },
  );

  app.put(
    '/me/coverage',
    { preHandler: [requirePermission(Permission.ASSOCIATION_MANAGE), requireAssociation()] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(z.object({ areas: z.array(coverageAreaSchema).min(1).max(25) }), request.body);
      const association = await associationService.replaceCoverageAreas(auth, input.areas);

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_COVERAGE_UPDATED,
        entityType: 'AssociationProfile',
        entityId: association.id,
        after: { areas: association.coverageAreas.map((area) => `${area.district}, ${area.state}`) },
      });

      return ok(reply, association);
    },
  );

  // -------------------------------------------------------------------------
  // The alert queue
  // -------------------------------------------------------------------------

  app.get(
    '/alerts',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(associationAlertListQuerySchema, request.query);
      const result = await alertService.listAlerts(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/alerts/overview',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_READ) },
    async (request, reply) => ok(reply, await alertService.alertOverview(requireAuth(request))),
  );

  app.get(
    '/alerts/:id',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const alert = await alertService.getAlert(auth, id);

      // Reading an acknowledged alert exposes the driver's name and number, so
      // the access itself is recorded — spec section 51 requires sensitive
      // data access to be auditable, not merely authorised.
      if (alert.driverPhone) {
        await auditFromRequest(request, {
          action: AuditAction.ASSOCIATION_SENSITIVE_ACCESS,
          entityType: 'AssociationAlert',
          entityId: id,
          after: { reference: alert.reference, fields: ['driverName', 'driverPhone'] },
        });
      }

      return ok(reply, alert);
    },
  );

  app.post(
    '/alerts/:id/acknowledge',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(acknowledgeAlertSchema, request.body ?? {});
      const alert = await alertService.acknowledgeAlert(auth, id, input.note);

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_ALERT_ACKNOWLEDGED,
        entityType: 'AssociationAlert',
        entityId: id,
        after: { reference: alert.reference, ageMinutes: alert.ageMinutes },
      });

      return ok(reply, alert);
    },
  );

  app.post(
    '/alerts/:id/responders',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(assignResponderSchema, request.body);
      const alert = await alertService.assignResponder(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_ALERT_RESPONDER_ASSIGNED,
        entityType: 'AssociationAlert',
        entityId: id,
        after: { kind: input.kind, etaMinutes: input.etaMinutes ?? null },
      });

      return ok(reply, alert);
    },
  );

  app.patch(
    '/alerts/:id/responders/:responderId',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id, responderId } = parseParams(
        z.object({ id: idParamSchema.shape.id, responderId: idParamSchema.shape.id }),
        request.params,
      );
      const input = parseBody(updateResponderSchema, request.body);
      return ok(reply, await alertService.updateResponder(auth, id, responderId, input));
    },
  );

  app.post(
    '/alerts/:id/notes',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(alertNoteSchema, request.body);
      return ok(reply, await alertService.addNote(auth, id, input));
    },
  );

  app.post(
    '/alerts/:id/escalate',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(escalateAlertSchema, request.body);
      const alert = await alertService.escalateAlert(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_ALERT_ESCALATED,
        entityType: 'AssociationAlert',
        entityId: id,
        after: { reference: alert.reference, reason: input.reason },
      });

      return ok(reply, alert);
    },
  );

  app.post(
    '/alerts/:id/resolve',
    { preHandler: requirePermission(Permission.ASSOCIATION_ALERTS_RESPOND) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(resolveAlertSchema, request.body);
      const alert = await alertService.resolveAlert(auth, id, input);

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_ALERT_RESOLVED,
        entityType: 'AssociationAlert',
        entityId: id,
        after: {
          reference: alert.reference,
          assistanceProvided: input.assistanceProvided,
          outcome: input.outcome,
        },
      });

      return ok(reply, alert);
    },
  );

  // -------------------------------------------------------------------------
  // Platform administration
  // -------------------------------------------------------------------------

  app.get(
    '/',
    { preHandler: requirePermission(Permission.ADMIN_ORGANIZATIONS) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(associationListQuerySchema, request.query);
      const result = await associationService.listAssociations(auth, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  app.get(
    '/:id',
    { preHandler: requirePermission(Permission.ASSOCIATION_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await associationService.getAssociation(auth, id));
    },
  );

  app.post(
    '/:id/verification',
    { preHandler: requirePermission(Permission.VERIFICATION_REVIEW) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(
        z.object({
          status: z.enum([
            VerificationStatus.UNDER_REVIEW,
            VerificationStatus.VERIFIED,
            VerificationStatus.REJECTED,
            VerificationStatus.SUSPENDED,
          ]),
          reason: z.string().trim().max(1000).optional(),
        }),
        request.body,
      );

      const association = await associationService.setAssociationVerification(
        auth,
        id,
        input.status,
      );

      await auditFromRequest(request, {
        action: AuditAction.ASSOCIATION_VERIFIED,
        entityType: 'AssociationProfile',
        entityId: id,
        organizationId: association.organizationId,
        after: { status: input.status, reason: input.reason ?? null },
      });

      return ok(reply, association);
    },
  );
}
