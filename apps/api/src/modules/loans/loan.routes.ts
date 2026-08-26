import type { FastifyInstance } from 'fastify';
import {
  Feature,
  Permission,
  closeLoanSchema,
  createLoanSchema,
  idParamSchema,
  importInstallmentsSchema,
  installmentListQuerySchema,
  loanListQuerySchema,
  previewScheduleSchema,
  recordLoanPaymentSchema,
  syncLoanSchema,
  upcomingEmiQuerySchema,
  updateLoanSchema,
  waiveInstallmentSchema,
} from '@saarthi/shared';
import { created, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import {
  requireAuth,
  requireFeature,
  requireOrganizationId,
  requirePermission,
} from '../../server/guards';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as loanService from './loan.service';

/**
 * Vehicle finance routes.
 *
 * Everything here is gated on `Permission.LOANS_READ` / `LOANS_MANAGE`, which
 * are owner-level grants rather than part of the general fleet permission set.
 * A dispatcher who can move a truck has no automatic business seeing what is
 * still owed on it, and an association responding to an emergency must never
 * reach this router at all.
 *
 * Masking is applied inside the service, not here: the full loan number never
 * leaves the process for a caller who lacks `LOANS_SENSITIVE`.
 */
export async function loanRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(loanListQuerySchema, request.query);
      const result = await loanService.listLoans(auth, organizationId, query);
      // Totals ride in `meta` so the list header can show the fleet's monthly
      // obligation without a second round trip.
      return ok(
        reply,
        { items: result.items, pagination: result.pagination },
        { totals: result.totals },
      );
    },
  );

  // Kept separate from the list so the dashboard can ask for totals without
  // paying for a page of loans it will not render.
  app.get(
    '/summary',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) =>
      ok(
        reply,
        await loanService.fleetLoanSummary(requireAuth(request), requireOrganizationId(request)),
      ),
  );

  app.get(
    '/upcoming',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(upcomingEmiQuerySchema, request.query);
      return ok(reply, await loanService.upcomingEmis(auth, organizationId, query));
    },
  );

  app.get(
    '/installments',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const query = parseQuery(installmentListQuerySchema, request.query);
      const result = await loanService.listInstallments(auth, organizationId, query);
      return paginated(reply, result.items, result.pagination);
    },
  );

  /**
   * Amortisation preview.
   *
   * Deliberately a POST with no persistence: it is pure arithmetic on figures
   * the caller supplies, used to show an EMI before a loan is recorded.
   */
  app.post(
    '/preview-schedule',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const input = parseBody(previewScheduleSchema, request.body);
      return ok(reply, loanService.previewSchedule(input));
    },
  );

  app.get(
    '/:id',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await loanService.getLoan(auth, id));
    },
  );

  app.get(
    '/:id/events',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await loanService.loanEvents(auth, id));
    },
  );

  app.post(
    '/',
    {
      preHandler: [requirePermission(Permission.LOANS_MANAGE), requireFeature(Feature.FINANCE_LOANS)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const organizationId = requireOrganizationId(request);
      const input = parseBody(createLoanSchema, request.body);
      const loan = await loanService.createLoan(auth, organizationId, input);
      await auditFromRequest(request, {
        action: AuditAction.LOAN_CREATED,
        entityType: 'VehicleLoan',
        entityId: loan.id,
      });
      return created(reply, loan);
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: [requirePermission(Permission.LOANS_MANAGE), requireFeature(Feature.FINANCE_LOANS)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateLoanSchema, request.body);
      return ok(reply, await loanService.updateLoan(auth, id, input));
    },
  );

  app.post(
    '/:id/close',
    {
      preHandler: [requirePermission(Permission.LOANS_MANAGE), requireFeature(Feature.FINANCE_LOANS)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(closeLoanSchema, request.body);
      return ok(reply, await loanService.closeLoan(auth, id, input));
    },
  );

  app.post(
    '/:id/payments',
    {
      preHandler: [requirePermission(Permission.LOANS_MANAGE), requireFeature(Feature.FINANCE_LOANS)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(recordLoanPaymentSchema, request.body);
      const loan = await loanService.recordPayment(auth, id, input);
      await auditFromRequest(request, {
        action: AuditAction.LOAN_PAYMENT_RECORDED,
        entityType: 'VehicleLoan',
        entityId: id,
        after: { amount: input.amount, installmentId: input.installmentId ?? null },
      });
      return created(reply, loan);
    },
  );

  app.post(
    '/installments/:id/waive',
    {
      preHandler: [requirePermission(Permission.LOANS_MANAGE), requireFeature(Feature.FINANCE_LOANS)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(waiveInstallmentSchema, request.body);
      const loan = await loanService.waiveInstallment(auth, id, input);
      await auditFromRequest(request, {
        action: AuditAction.LOAN_INSTALLMENT_WAIVED,
        entityType: 'LoanInstallment',
        entityId: id,
        after: { reason: input.reason },
      });
      return ok(reply, loan);
    },
  );

  app.post(
    '/:id/import-installments',
    {
      preHandler: [requirePermission(Permission.LOANS_MANAGE), requireFeature(Feature.FINANCE_LOANS)],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(importInstallmentsSchema, request.body);
      const loan = await loanService.importInstallments(auth, id, input);
      await auditFromRequest(request, {
        action: AuditAction.LOAN_SCHEDULE_IMPORTED,
        entityType: 'VehicleLoan',
        entityId: id,
        after: { source: input.source, rows: input.installments.length },
      });
      return ok(reply, loan);
    },
  );

  /**
   * Reconcile against the lender.
   *
   * Gated on its own entitlement because a provider call costs money to make,
   * and returns the differences rather than applying them unless the caller
   * explicitly asks — a lender's figure is an assertion, not a correction.
   */
  app.post(
    '/:id/sync',
    {
      preHandler: [
        requirePermission(Permission.LOANS_MANAGE),
        requireFeature(Feature.FINANCE_LOAN_SYNC),
      ],
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(syncLoanSchema, request.body ?? {});
      const result = await loanService.syncLoan(auth, id, input);
      await auditFromRequest(request, {
        action: AuditAction.LOAN_PROVIDER_SYNCED,
        entityType: 'VehicleLoan',
        entityId: id,
        after: {
          provider: result.provider,
          applied: result.applied,
          differences: result.differences.length,
        },
      });
      return ok(reply, result);
    },
  );
}

/**
 * Finance panel for one vehicle, mounted under the vehicle surface.
 *
 * Registered separately so the Vehicle Passport can load it from the path the
 * rest of the vehicle record uses, without the loans router having to know
 * anything about vehicle routing.
 */
export async function vehicleLoanRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/:id/loans',
    { preHandler: [requirePermission(Permission.LOANS_READ), requireFeature(Feature.FINANCE_LOANS)] },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await loanService.vehicleLoans(auth, id));
    },
  );
}
