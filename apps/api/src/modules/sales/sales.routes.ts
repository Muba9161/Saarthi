import type { FastifyInstance } from 'fastify';
import {
  Permission,
  ReferralSource,
  advanceLeadSchema,
  assignTrackerToSalesmanSchema,
  attributeCustomerSchema,
  captureReferralSchema,
  commissionDecisionSchema,
  commissionListQuerySchema,
  commissionRuleSchema,
  completeOnboardingSchema,
  createLeadSchema,
  createSalesmanSchema,
  handOverTrackerSchema,
  handoverListQuerySchema,
  handoverStatusSchema,
  idParamSchema,
  leadListQuerySchema,
  leadNoteSchema,
  manualVerifySalesmanSchema,
  onboardingReadinessQuerySchema,
  paginationSchema,
  referralCodeParamSchema,
  referralListQuerySchema,
  revokeAttributionSchema,
  salesmanListQuerySchema,
  salesmanStandingSchema,
  startAssistedSignupSchema,
  updateLeadSchema,
  updateSalesmanSchema,
  uuidSchema,
  validateReferralSchema,
} from '@saarthi/shared';
import { z } from 'zod';
import { config } from '../../config/env';
import { created, makePagination, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { publicAppUrl } from '../../lib/public-url';
import { requireAuth, requirePermission, requirePlatformAdmin } from '../../server/guards';
import { renderPayloadDataUri } from '../qr/qr-render.service';
import { AuditAction, auditFromRequest } from '../audit/audit.service';
import * as salesmanService from './salesman.service';
import * as leadService from './lead.service';
import * as referralService from './referral.service';
import * as commissionService from './commission.service';
import * as handoverService from './handover.service';
import * as onboardingService from './onboarding.service';
import * as dashboardService from './dashboard.service';
import * as demoService from './demo.service';
import { godWebConfigured } from '../../providers/godweb';

/**
 * The Sales surface.
 *
 * One module inside the one Saarthi platform. There is no sales portal, no
 * salesman website, no salesman APK and no salesman authentication system —
 * these routes sit behind the same `app.authenticate`, the same RBAC guards and
 * the same error envelope as every other module, and the Sales screens are
 * pages in the same React application.
 *
 * ## Scoping, which is different here
 *
 * Every other module scopes by tenant. A salesperson has no tenant, so these
 * routes scope by *salesman profile* instead:
 * `requireSalesmanProfile(auth)` resolves the caller's own profile from their
 * user id, and every query is keyed on it. A salesman caller can never supply
 * a salesman id — `scopeFor` below returns their own or refuses — so
 * `?salesmanId=` is honoured for platform administration and silently ignored
 * for everybody else.
 *
 * ## What is deliberately absent
 *
 * No endpoint accepts a commission amount. No endpoint accepts a customer's
 * password, OTP or payment credential. No endpoint activates a tracker, pairs a
 * device, writes telemetry or resolves a tracker QR — those belong to
 * `modules/devices`, `modules/terminal` and `modules/telemetry`, which this
 * module only ever reads.
 */

const attributeSalesSchema = z.object({
  organizationId: uuidSchema,
  source: z
    .enum([ReferralSource.PHYSICAL, ReferralSource.ASSISTED_SIGNUP] as const)
    .default(ReferralSource.PHYSICAL),
});

const customerIdParamSchema = z.object({ organizationId: uuidSchema });

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  /**
   * Which salesperson's records this request may see.
   *
   * A platform administrator gets `null`, meaning "unscoped", and may pass an
   * explicit `salesmanId`. Everybody else is pinned to their own profile. This
   * is the single place that decision is made, so no handler can forget it.
   */
  async function scopeFor(request: Parameters<typeof requireAuth>[0]): Promise<string | null> {
    const auth = requireAuth(request);
    if (auth.isPlatformAdmin) return null;
    const profile = await salesmanService.requireSalesmanProfile(auth);
    return profile.id;
  }

  // =========================================================================
  // The salesperson's own profile
  // =========================================================================

  /**
   * Who am I, as a salesperson.
   *
   * Answers with the profile *and* the reason it cannot sell yet when it
   * cannot, so the Sales screens can explain a pending GODID rather than
   * showing an empty dashboard. Returns `null` rather than 403 for a caller
   * with no profile at all, because the platform-admin case is legitimate.
   */
  app.get(
    '/me',
    { preHandler: requirePermission(Permission.SALES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.currentSalesman(auth);
      return ok(reply, {
        profile,
        godWebVerificationAvailable: godWebConfigured,
        attributionWindowDays: config.sales.attributionWindowDays,
      });
    },
  );

  app.get(
    '/dashboard',
    { preHandler: requirePermission(Permission.SALES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      return ok(
        reply,
        await dashboardService.dashboard({ salesmanId: profile.id, godId: profile.godId }),
      );
    },
  );

  // =========================================================================
  // Leads
  // =========================================================================

  app.get(
    '/leads',
    { preHandler: requirePermission(Permission.LEADS_READ) },
    async (request, reply) => {
      const query = parseQuery(leadListQuerySchema, request.query ?? {});
      const salesmanId = await scopeFor(request);
      const { items, total } = await leadService.listLeads(query, salesmanId);
      return paginated(reply, items, makePagination(query.page, query.pageSize, total));
    },
  );

  app.post(
    '/leads',
    { preHandler: requirePermission(Permission.LEADS_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      // Creating a lead needs a sellable profile: an unverified salesperson
      // building a pipeline Saarthi will never credit them for is worse than
      // being told plainly that their GODID is not verified yet.
      const profile = await salesmanService.requireActiveSalesman(auth);
      const input = parseBody(createLeadSchema, request.body ?? {});
      const lead = await leadService.createLead(auth, profile, input);
      await dashboardService.invalidateDashboard(profile.id);
      return created(reply, lead);
    },
  );

  app.get(
    '/leads/:id',
    { preHandler: requirePermission(Permission.LEADS_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await leadService.getLead(id, await scopeFor(request)));
    },
  );

  app.patch(
    '/leads/:id',
    { preHandler: requirePermission(Permission.LEADS_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateLeadSchema, request.body ?? {});
      return ok(reply, await leadService.updateLead(auth, id, await scopeFor(request), input));
    },
  );

  app.get(
    '/leads/:id/history',
    { preHandler: requirePermission(Permission.LEADS_READ) },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await leadService.leadHistory(id, await scopeFor(request)));
    },
  );

  app.post(
    '/leads/:id/status',
    { preHandler: requirePermission(Permission.LEADS_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(advanceLeadSchema, request.body ?? {});
      const salesmanId = await scopeFor(request);
      const lead = await leadService.advanceLead(auth, id, salesmanId, input);
      if (salesmanId) await dashboardService.invalidateDashboard(salesmanId);
      return ok(reply, lead);
    },
  );

  app.post(
    '/leads/:id/notes',
    { preHandler: requirePermission(Permission.LEADS_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(leadNoteSchema, request.body ?? {});
      return created(reply, await leadService.addNote(auth, id, await scopeFor(request), input));
    },
  );

  /**
   * Start a signup the customer completes themselves.
   *
   * The response carries the notice about never asking for a password, an OTP
   * or a payment credential, so it is rendered rather than relying on training.
   */
  app.post(
    '/leads/assisted-signup',
    { preHandler: requirePermission(Permission.LEADS_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireActiveSalesman(auth);
      const input = parseBody(startAssistedSignupSchema, request.body ?? {});
      return created(
        reply,
        await leadService.startAssistedSignup(auth, profile, input, publicAppUrl(request)),
      );
    },
  );

  // =========================================================================
  // Customers
  // =========================================================================

  app.get(
    '/customers',
    { preHandler: requirePermission(Permission.SALES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      const query = parseQuery(paginationSchema, request.query ?? {});
      const { items, total } = await dashboardService.customers(
        profile.id,
        query.page,
        query.pageSize,
      );
      return paginated(reply, items, makePagination(query.page, query.pageSize, total));
    },
  );

  /**
   * One attributed customer's vehicles, for the first-vehicle demonstration.
   *
   * Registration, whether a tracker is fitted, and whether it has ever
   * reported. Nothing else — see `customerVehicles`.
   */
  app.get(
    '/customers/:organizationId/vehicles',
    { preHandler: requirePermission(Permission.SALES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      const { organizationId } = parseParams(customerIdParamSchema, request.params);
      return ok(reply, await dashboardService.customerVehicles(profile.id, organizationId));
    },
  );

  /**
   * Record a physical sale: this salesperson, in front of this customer.
   *
   * Cannot displace a live attribution — a salesperson cannot walk into a
   * customer a colleague signed up and claim them. Reports the refusal rather
   * than throwing, because "already attributed to somebody else" is
   * information the salesperson needs, not an error in their request.
   */
  app.post(
    '/customers/attribute',
    { preHandler: requirePermission(Permission.REFERRALS_CREATE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireActiveSalesman(auth);
      const input = parseBody(attributeSalesSchema, request.body ?? {});

      const outcome = await referralService.attributePhysicalSale({
        salesman: profile,
        organizationId: input.organizationId,
        source: input.source,
      });

      if (outcome.attributed) {
        await leadService.linkLeadToOrganization({
          salesmanId: profile.id,
          organizationId: input.organizationId,
          attributionId: outcome.attributionId,
          phone: null,
          email: null,
        });
        await dashboardService.invalidateDashboard(profile.id);
      }

      return ok(reply, outcome);
    },
  );

  // =========================================================================
  // Referrals
  // =========================================================================

  /**
   * The salesperson's own link, QR and share text.
   *
   * The QR is rendered by the existing QR service. It encodes the referral URL,
   * which is a public web page — nothing about a tracker, which carries no QR
   * at all.
   */
  app.get(
    '/referrals/mine',
    { preHandler: requirePermission(Permission.REFERRALS_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      return ok(
        reply,
        await salesmanService.referralShare(profile, publicAppUrl(request), (payload) =>
          renderPayloadDataUri(payload, { size: 512 }),
        ),
      );
    },
  );

  app.get(
    '/referrals',
    { preHandler: requirePermission(Permission.REFERRALS_READ) },
    async (request, reply) => {
      const query = parseQuery(referralListQuerySchema, request.query ?? {});
      const salesmanId = await scopeFor(request);
      const { items, total } = await referralService.listAttributions(query, salesmanId);
      return paginated(reply, items, makePagination(query.page, query.pageSize, total));
    },
  );

  /**
   * Check a GODID before relying on it.
   *
   * Authenticated, unlike the public resolution route, because this one is used
   * by the manual-GODID fallback and by administration. Returns the same thin
   * shape — validating a code must not become a way to enumerate staff.
   */
  app.post(
    '/referrals/validate',
    { preHandler: requirePermission(Permission.REFERRALS_READ, Permission.SALES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(validateReferralSchema, request.body ?? {});
      return ok(reply, await referralService.validateCode(input.code, auth.user.id));
    },
  );

  // =========================================================================
  // Commission
  // =========================================================================

  app.get(
    '/commission',
    { preHandler: requirePermission(Permission.COMMISSION_READ) },
    async (request, reply) => {
      const query = parseQuery(commissionListQuerySchema, request.query ?? {});
      const salesmanId = await scopeFor(request);
      const { items, total } = await commissionService.listCommissions(query, salesmanId);
      return paginated(reply, items, makePagination(query.page, query.pageSize, total));
    },
  );

  /**
   * The salesperson's own totals.
   *
   * `awaitingRule` is a count and not a sum, on purpose: a commission with no
   * amount cannot contribute to a total, and quietly treating it as zero would
   * show a smaller figure than is owed with nothing on the screen to explain it.
   */
  app.get(
    '/commission/summary',
    { preHandler: requirePermission(Permission.COMMISSION_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      return ok(reply, await commissionService.commissionTotals(profile.id));
    },
  );

  // =========================================================================
  // Tracker handover
  // =========================================================================

  app.get(
    '/trackers',
    { preHandler: requirePermission(Permission.TRACKER_HANDOVER_READ) },
    async (request, reply) => {
      const query = parseQuery(handoverListQuerySchema, request.query ?? {});
      const salesmanId = await scopeFor(request);
      const { items, total } = await handoverService.listHandovers(query, salesmanId);
      return paginated(reply, items, makePagination(query.page, query.pageSize, total));
    },
  );

  app.get(
    '/trackers/summary',
    { preHandler: requirePermission(Permission.TRACKER_HANDOVER_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      return ok(reply, await handoverService.handoverSummary(profile.id));
    },
  );

  app.get(
    '/trackers/available/:organizationId',
    { preHandler: requirePermission(Permission.TRACKER_HANDOVER_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireSalesmanProfile(auth);
      const { organizationId } = parseParams(customerIdParamSchema, request.params);
      return ok(reply, await handoverService.availableForCustomer(profile.id, organizationId));
    },
  );

  /**
   * Record a tracker changing hands.
   *
   * A statement about the past, not a state change with consequences: it grants
   * nothing, activates nothing and starts no billing. Fitting the tracker to a
   * vehicle remains the customer's own action on their own subscription screen.
   */
  app.post(
    '/trackers/:id/handover',
    { preHandler: requirePermission(Permission.TRACKER_HANDOVER_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireActiveSalesman(auth);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(handOverTrackerSchema, request.body ?? {});
      const handover = await handoverService.handToCustomer(auth, id, profile, input);
      await dashboardService.invalidateDashboard(profile.id);
      return ok(reply, handover);
    },
  );

  app.post(
    '/trackers/:id/close',
    { preHandler: requirePermission(Permission.TRACKER_HANDOVER_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(handoverStatusSchema, request.body ?? {});
      const salesmanId = await scopeFor(request);
      const handover = await handoverService.closeHandover(auth, id, salesmanId, input);
      if (salesmanId) await dashboardService.invalidateDashboard(salesmanId);
      return ok(reply, handover);
    },
  );

  // =========================================================================
  // First-vehicle demonstration
  // =========================================================================

  /**
   * Where this vehicle has got to, read from the systems that know.
   *
   * Safe to poll — the salesperson's screen refreshes it while they wait for
   * the first reading. Every step is a `SELECT`; nothing here connects
   * anything.
   */
  app.get(
    '/onboarding/readiness',
    { preHandler: requirePermission(Permission.SALES_READ) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = parseQuery(onboardingReadinessQuerySchema, request.query ?? {});

      if (auth.isPlatformAdmin) {
        return ok(reply, await onboardingService.readiness(query.vehicleId));
      }

      /*
       * A salesperson's claim on a vehicle comes from the customer they are
       * credited with, not from a tenant membership they do not have.
       * `readinessForSalesman` resolves vehicle → organization → live
       * attribution and reports anything else as not found.
       */
      const profile = await salesmanService.requireSalesmanProfile(auth);
      return ok(reply, await onboardingService.readinessForSalesman(profile.id, query.vehicleId));
    },
  );

  /**
   * Complete the first-vehicle demonstration.
   *
   * The request carries a lead id and a vehicle id and no evidence at all. The
   * evidence is re-read here by `assertComplete`, so a client cannot post its
   * way to a finished onboarding — if any of the six steps is not confirmed,
   * this refuses and says which.
   */
  app.post(
    '/onboarding/complete',
    { preHandler: requirePermission(Permission.SALES_WRITE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const profile = await salesmanService.requireActiveSalesman(auth);
      const input = parseBody(completeOnboardingSchema, request.body ?? {});

      const lead = await leadService.getLead(input.leadId, profile.id);
      if (!lead.organizationId) {
        return ok(reply, {
          completed: false,
          reason:
            'This lead is not linked to a Saarthi customer yet, so there is no vehicle to ' +
            'confirm. Record the sale first.',
          readiness: null,
        });
      }

      const readiness = await onboardingService.assertComplete(
        input.vehicleId,
        lead.organizationId,
      );

      const now = new Date();
      await leadService.recordOnboardingCompleted({
        leadId: lead.id,
        vehicleId: input.vehicleId,
        note: input.note ?? null,
        at: now,
      });

      await auditFromRequest(request, {
        action: AuditAction.FIRST_VEHICLE_DEMONSTRATED,
        entityType: 'SalesLead',
        entityId: lead.id,
        organizationId: lead.organizationId,
        after: {
          vehicleId: input.vehicleId,
          registrationNumber: readiness.registrationNumber,
          godId: profile.godId,
          steps: readiness.steps.map((step) => ({ step: step.step, state: step.state })),
        },
      });

      await leadService.syncFromCustomerState(lead.id);
      await dashboardService.invalidateDashboard(profile.id);

      return ok(reply, { completed: true, reason: null, readiness });
    },
  );

  // =========================================================================
  // Demo Mode
  // =========================================================================

  /**
   * The demo script and the real pricing to quote from.
   *
   * There is no demo data endpoint and no demo tenant. The tour drives the
   * existing Saarthi screens, and movement comes from the existing GPS
   * simulator, which is already gated behind `DEMO_MODE` and already refuses to
   * start in production.
   */
  app.get(
    '/demo',
    { preHandler: requirePermission(Permission.DEMO_USE) },
    async (_request, reply) => ok(reply, demoService.demoScript()),
  );

  // =========================================================================
  // Platform administration
  // =========================================================================

  app.get(
    '/salesmen',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const query = parseQuery(salesmanListQuerySchema, request.query ?? {});
      const { items, total } = await salesmanService.listSalesmen(query);
      return paginated(reply, items, makePagination(query.page, query.pageSize, total));
    },
  );

  app.post(
    '/salesmen',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(createSalesmanSchema, request.body ?? {});
      return created(reply, await salesmanService.createSalesman(auth, input));
    },
  );

  app.get(
    '/salesmen/:id',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await salesmanService.getSalesman(id));
    },
  );

  app.patch(
    '/salesmen/:id',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(updateSalesmanSchema, request.body ?? {});
      return ok(reply, await salesmanService.updateSalesman(auth, id, input));
    },
  );

  /** Ask GODWeb. 503 when this environment has no GODWeb integration. */
  app.post(
    '/salesmen/:id/verify',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      return ok(reply, await salesmanService.verifyAgainstGodWeb(auth, id));
    },
  );

  /**
   * Verify on the administrator's own authority.
   *
   * Refused whenever GODWeb is reachable — see `verifyManually`. The evidence
   * they cite is written onto the profile and into an audit action of its own,
   * so a report can always tell this apart from a GODWeb answer.
   */
  app.post(
    '/salesmen/:id/verify-manually',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(manualVerifySalesmanSchema, request.body ?? {});
      return ok(reply, await salesmanService.verifyManually(auth, id, input));
    },
  );

  app.post(
    '/salesmen/:id/standing',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(salesmanStandingSchema, request.body ?? {});
      return ok(reply, await salesmanService.changeStanding(auth, id, input));
    },
  );

  /** Allocate a paid-for tracker to a salesperson. Operations, not field sales. */
  app.post(
    '/trackers/assign',
    { preHandler: requirePermission(Permission.TRACKER_INVENTORY_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(assignTrackerToSalesmanSchema, request.body ?? {});
      const handover = await handoverService.assignToSalesman(auth, input);
      await dashboardService.invalidateDashboard(input.salesmanId);
      return created(reply, handover);
    },
  );

  app.post(
    '/referrals/attribute',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(attributeCustomerSchema, request.body ?? {});
      return created(reply, await referralService.attributeManually(auth, input));
    },
  );

  app.post(
    '/referrals/:id/revoke',
    { preHandler: requirePlatformAdmin() },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(revokeAttributionSchema, request.body ?? {});
      return ok(reply, await referralService.revokeAttribution(auth, id, input));
    },
  );

  app.get(
    '/commission/rules',
    { preHandler: requirePermission(Permission.COMMISSION_MANAGE) },
    async (_request, reply) => ok(reply, await commissionService.listRules()),
  );

  app.post(
    '/commission/rules',
    { preHandler: requirePermission(Permission.COMMISSION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const input = parseBody(commissionRuleSchema, request.body ?? {});
      return created(reply, await commissionService.createRule(auth, input));
    },
  );

  app.put(
    '/commission/rules/:id',
    { preHandler: requirePermission(Permission.COMMISSION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(commissionRuleSchema, request.body ?? {});
      return ok(reply, await commissionService.updateRule(auth, id, input));
    },
  );

  /**
   * Approve, pay, reverse or reject one commission.
   *
   * `commission.manage`, which the SALESMAN role does not hold: the person a
   * commission is owed to must not be the person who authorises it.
   */
  app.post(
    '/commission/:id/decision',
    { preHandler: requirePermission(Permission.COMMISSION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      const { id } = parseParams(idParamSchema, request.params);
      const input = parseBody(commissionDecisionSchema, request.body ?? {});
      const commission = await commissionService.decide(auth, id, input);
      await dashboardService.invalidateDashboard(commission.salesmanId);
      return ok(reply, commission);
    },
  );

  /** Price the commissions that qualified before a rule existed. */
  app.post(
    '/commission/recalculate',
    { preHandler: requirePermission(Permission.COMMISSION_MANAGE) },
    async (request, reply) => {
      const auth = requireAuth(request);
      return ok(reply, { priced: await commissionService.recalculatePending(auth) });
    },
  );
}

/**
 * Public referral routes.
 *
 * Mounted outside the authenticated shell, like the QR scan target and for the
 * same reason: a referral link is opened by somebody who has no Saarthi account
 * and no reason to make one yet. Both routes are rate-limited, and both return
 * only the thin public shape — a display name and whether the code is real.
 */
export async function publicReferralRoutes(app: FastifyInstance): Promise<void> {
  const referralLimit = {
    rateLimit: {
      max: config.sales.referralRateLimitMax,
      timeWindow: config.sales.referralRateLimitWindow,
    },
  };

  /** Who invited me? Anonymous, and answers almost nothing. */
  app.get('/:code', { config: referralLimit }, async (request, reply) => {
    const { code } = parseParams(referralCodeParamSchema, request.params);
    return ok(reply, await referralService.resolvePublic(code));
  });

  /**
   * Record the visit.
   *
   * Anonymous by necessity — there is no customer yet. The row it creates
   * carries no personal data beyond a salted hash of the caller's IP, kept only
   * so that one device minting attributions in bulk is visible.
   */
  app.post('/:code/capture', { config: referralLimit }, async (request, reply) => {
    const { code } = parseParams(referralCodeParamSchema, request.params);
    const body = parseBody(captureReferralSchema.partial({ code: true }), {
      ...(request.body as Record<string, unknown> | null),
      code,
    });

    return created(
      reply,
      await referralService.capture({
        code,
        source: body.source ?? ReferralSource.REFERRAL_LINK,
        ipAddress: request.clientIp ?? null,
      }),
    );
  });
}
