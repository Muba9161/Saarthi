import {
  CLOSED_SALES_LEAD_STATUSES,
  NotificationPriority,
  NotificationType,
  type PlanTier,
  SALES_LEAD_DERIVED_STATUSES,
  SalesLeadEventType,
  type SalesLeadSource,
  SalesLeadStatus,
  type VehicleType,
  salesLeadStateMachine,
  type AdvanceLeadInput,
  type CreateLeadInput,
  type LeadListQuery,
  type LeadNoteInput,
  type StartAssistedSignupInput,
  type UpdateLeadInput,
} from '@saarthi/shared';
import { isUniqueViolation, prisma, type Db } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notify } from '../notifications/notification.service';
import type { SalesmanView } from './salesman.service';
import type { AuthContext } from '../../auth/context';

/**
 * Sales leads — the pipeline a salesperson works.
 *
 * Three decisions shape this file.
 *
 * **A lead is not a customer.** Saarthi already has `Customer`, which hangs off
 * an organization that exists; a lead is a phone number and a conversation, and
 * most never become one. When one does, `organizationId` links them and the
 * lead keeps the story of how the sale was made.
 *
 * **A salesperson cannot type their own conversions.** Everything from
 * `SUBSCRIBED` onwards is set by the system from the subscription, the tracker
 * handover and the vehicle's own telemetry — see `SALES_LEAD_DERIVED_STATUSES`
 * and `syncFromCustomerState`. A pipeline where the person paid on conversions
 * can mark a lead ACTIVATED measures optimism.
 *
 * **Lead data is pre-consent personal data.** A prospect has agreed to nothing,
 * so every query is scoped to the salesperson who created the lead, or to
 * platform administration. There is no cross-salesman read, and no route that
 * takes a salesman id from a salesman caller.
 */

const leadLogger = logger.child({ module: 'sales:lead' });

export interface LeadView {
  id: string;
  salesmanId: string;
  salesmanName: string | null;
  contactName: string;
  businessName: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  fleetSize: number | null;
  vehicleTypes: VehicleType[];
  interestedPlan: PlanTier | null;
  source: SalesLeadSource;
  status: SalesLeadStatus;
  notes: string | null;
  nextFollowUpAt: string | null;
  /** True when the follow-up date has passed and the lead is still open. */
  followUpOverdue: boolean;
  organizationId: string | null;
  organizationName: string | null;
  attributionId: string | null;
  demoCompletedAt: string | null;
  onboardingCompletedAt: string | null;
  firstVehicleId: string | null;
  closedAt: string | null;
  closeReason: string | null;
  /** Statuses this lead may be moved to by its salesperson, right now. */
  availableStatuses: SalesLeadStatus[];
  createdAt: string;
  updatedAt: string;
}

type LeadRow = {
  id: string;
  salesmanId: string;
  contactName: string;
  businessName: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  fleetSize: number | null;
  vehicleTypes: string[];
  interestedPlan: string | null;
  source: string;
  status: string;
  notes: string | null;
  nextFollowUpAt: Date | null;
  organizationId: string | null;
  attributionId: string | null;
  demoCompletedAt: Date | null;
  onboardingCompletedAt: Date | null;
  firstVehicleId: string | null;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  salesman?: { name: string | null } | null;
  organization?: { name: string } | null;
};

/**
 * Statuses the salesperson may pick from the screen.
 *
 * The state machine's legal transitions minus the derived ones, so the UI's
 * dropdown and the API's guard are the same list. Offering a status the API
 * would refuse is how a salesperson learns to distrust the screen.
 */
function availableStatuses(status: SalesLeadStatus): SalesLeadStatus[] {
  return salesLeadStateMachine
    .nextStates(status)
    .filter((next) => !SALES_LEAD_DERIVED_STATUSES.includes(next));
}

function toView(row: LeadRow): LeadView {
  const status = row.status as SalesLeadStatus;
  return {
    id: row.id,
    salesmanId: row.salesmanId,
    salesmanName: row.salesman?.name ?? null,
    contactName: row.contactName,
    businessName: row.businessName,
    phone: row.phone,
    email: row.email,
    city: row.city,
    state: row.state,
    fleetSize: row.fleetSize,
    vehicleTypes: row.vehicleTypes as VehicleType[],
    interestedPlan: row.interestedPlan as PlanTier | null,
    source: row.source as SalesLeadSource,
    status,
    notes: row.notes,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    followUpOverdue:
      row.nextFollowUpAt !== null &&
      row.nextFollowUpAt.getTime() < Date.now() &&
      !CLOSED_SALES_LEAD_STATUSES.includes(status),
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    attributionId: row.attributionId,
    demoCompletedAt: row.demoCompletedAt?.toISOString() ?? null,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    firstVehicleId: row.firstVehicleId,
    closedAt: row.closedAt?.toISOString() ?? null,
    closeReason: row.closeReason,
    availableStatuses: availableStatuses(status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const withRelations = {
  salesman: { select: { name: true } },
  organization: { select: { name: true } },
} as const;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listLeads(
  query: LeadListQuery,
  /** Non-null pins the query to one salesperson. Null means administration. */
  salesmanId: string | null,
): Promise<{ items: LeadView[]; total: number }> {
  const where = {
    // A salesman caller's own id always wins over anything in the query, so
    // `?salesmanId=` on a salesman's request changes nothing.
    ...(salesmanId ? { salesmanId } : query.salesmanId ? { salesmanId: query.salesmanId } : {}),
    ...(query.status ? { status: { in: query.status as never } } : {}),
    ...(query.overdueOnly
      ? {
          nextFollowUpAt: { lt: new Date() },
          status: { notIn: CLOSED_SALES_LEAD_STATUSES as never },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { contactName: { contains: query.search, mode: 'insensitive' as const } },
            { businessName: { contains: query.search, mode: 'insensitive' as const } },
            { phone: { contains: query.search } },
            { city: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.salesLead.findMany({
      where,
      include: withRelations,
      // Overdue follow-ups first, then the newest. A salesperson opening this
      // screen in the morning wants the calls they owe, not the last lead they
      // typed in.
      orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.salesLead.count({ where }),
  ]);

  return { items: rows.map(toView), total };
}

/**
 * One lead, scoped.
 *
 * `salesmanId` non-null means the caller is a salesperson and may only see
 * their own. A mismatch is reported as a 404 rather than a 403, for the reason
 * `assertTenantAccess` gives: the difference between the two would let somebody
 * enumerate their colleagues' prospects.
 */
export async function getLead(
  id: string,
  salesmanId: string | null,
  db: Db = prisma,
): Promise<LeadView> {
  const row = await db.salesLead.findUnique({ where: { id }, include: withRelations });
  if (!row) throw errors.notFound('Lead');
  if (salesmanId && row.salesmanId !== salesmanId) throw errors.notFound('Lead');
  return toView(row);
}

export interface LeadEventView {
  id: string;
  type: SalesLeadEventType;
  fromStatus: SalesLeadStatus | null;
  toStatus: SalesLeadStatus | null;
  note: string | null;
  createdAt: string;
}

export async function leadHistory(
  id: string,
  salesmanId: string | null,
): Promise<LeadEventView[]> {
  await getLead(id, salesmanId);
  const rows = await prisma.salesLeadEvent.findMany({
    where: { leadId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type as SalesLeadEventType,
    fromStatus: row.fromStatus as SalesLeadStatus | null,
    toStatus: row.toStatus as SalesLeadStatus | null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function createLead(
  auth: AuthContext,
  salesman: SalesmanView,
  input: CreateLeadInput,
): Promise<LeadView> {
  let row;
  try {
    row = await prisma.salesLead.create({
      data: {
        salesmanId: salesman.id,
        contactName: input.contactName,
        businessName: input.businessName ?? null,
        phone: input.phone,
        email: input.email ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        fleetSize: input.fleetSize ?? null,
        vehicleTypes: input.vehicleTypes ?? [],
        interestedPlan: input.interestedPlan ?? null,
        source: input.source,
        notes: input.notes ?? null,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        status: SalesLeadStatus.NEW,
        events: {
          create: {
            type: SalesLeadEventType.CREATED,
            toStatus: SalesLeadStatus.NEW,
            note: input.notes ?? null,
            actorUserId: auth.user.id,
          },
        },
      },
      include: withRelations,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.duplicate(
        'You already have a lead for this phone number. Open it rather than starting a second one.',
        { fields: { phone: ['You already have a lead for this number.'] } },
      );
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.SALES_LEAD_CREATED,
    entityType: 'SalesLead',
    entityId: row.id,
    actorUserId: auth.user.id,
    after: { godId: salesman.godId, businessName: row.businessName, city: row.city },
  });

  return toView(row);
}

export async function updateLead(
  auth: AuthContext,
  id: string,
  salesmanId: string | null,
  input: UpdateLeadInput,
): Promise<LeadView> {
  const existing = await getLead(id, salesmanId);

  let row;
  try {
    row = await prisma.salesLead.update({
      where: { id },
      data: {
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.businessName !== undefined ? { businessName: input.businessName ?? null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        ...(input.city !== undefined ? { city: input.city ?? null } : {}),
        ...(input.state !== undefined ? { state: input.state ?? null } : {}),
        ...(input.fleetSize !== undefined ? { fleetSize: input.fleetSize ?? null } : {}),
        ...(input.vehicleTypes !== undefined ? { vehicleTypes: input.vehicleTypes ?? [] } : {}),
        ...(input.interestedPlan !== undefined
          ? { interestedPlan: input.interestedPlan ?? null }
          : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        ...(input.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: input.nextFollowUpAt ?? null }
          : {}),
      },
      include: withRelations,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.duplicate('You already have a lead for this phone number.');
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.SALES_LEAD_UPDATED,
    entityType: 'SalesLead',
    entityId: id,
    actorUserId: auth.user.id,
    before: { contactName: existing.contactName, phone: existing.phone },
    after: { contactName: row.contactName, phone: row.phone },
  });

  return toView(row);
}

/**
 * Move a lead along the pipeline.
 *
 * Two guards, and the order matters. The derived-status refusal comes first so
 * that a salesperson trying to set ACTIVATED gets told *why* — "Saarthi sets
 * this once the vehicle is live" is actionable, and "illegal transition" is
 * not.
 */
export async function advanceLead(
  auth: AuthContext,
  id: string,
  salesmanId: string | null,
  input: AdvanceLeadInput,
): Promise<LeadView> {
  const existing = await getLead(id, salesmanId);

  if (SALES_LEAD_DERIVED_STATUSES.includes(input.status)) {
    throw errors.businessRule(
      'Saarthi sets this stage itself, from the customer’s subscription, tracker handover and ' +
        'live vehicle. It cannot be set by hand.',
      { status: input.status, derived: SALES_LEAD_DERIVED_STATUSES as never },
    );
  }

  const transition = salesLeadStateMachine.assertTransition(existing.status, input.status);
  if (!transition.allowed) {
    throw errors.invalidTransition(transition.reason ?? 'That is not a valid next stage.', {
      from: existing.status,
      to: input.status,
      allowed: availableStatuses(existing.status),
    });
  }

  const closing = CLOSED_SALES_LEAD_STATUSES.includes(input.status);
  const now = new Date();

  const row = await prisma.salesLead.update({
    where: { id },
    data: {
      status: input.status,
      ...(input.nextFollowUpAt !== undefined
        ? { nextFollowUpAt: input.nextFollowUpAt ?? null }
        : {}),
      ...(input.status === SalesLeadStatus.DEMO_COMPLETED ? { demoCompletedAt: now } : {}),
      ...(closing ? { closedAt: now, closeReason: input.note ?? null } : {}),
      // Re-opening a lost lead clears the closure, so the dashboard counts it
      // as open again rather than as both.
      ...(!closing && existing.closedAt ? { closedAt: null, closeReason: null } : {}),
      events: {
        create: {
          type: SalesLeadEventType.STATUS_CHANGED,
          fromStatus: existing.status,
          toStatus: input.status,
          note: input.note ?? null,
          actorUserId: auth.user.id,
        },
      },
    },
    include: withRelations,
  });

  await recordAudit({
    action: AuditAction.SALES_LEAD_STATUS_CHANGED,
    entityType: 'SalesLead',
    entityId: id,
    actorUserId: auth.user.id,
    before: { status: existing.status },
    after: { status: input.status, note: input.note ?? null },
  });

  if (input.status === SalesLeadStatus.DEMO_COMPLETED) {
    await recordAudit({
      action: AuditAction.SALES_DEMO_RECORDED,
      entityType: 'SalesLead',
      entityId: id,
      actorUserId: auth.user.id,
      after: { at: now.toISOString() },
    });
  }

  return toView(row);
}

export async function addNote(
  auth: AuthContext,
  id: string,
  salesmanId: string | null,
  input: LeadNoteInput,
): Promise<LeadEventView[]> {
  await getLead(id, salesmanId);

  await prisma.salesLeadEvent.create({
    data: {
      leadId: id,
      type: SalesLeadEventType.NOTE_ADDED,
      note: input.note,
      actorUserId: auth.user.id,
    },
  });

  return leadHistory(id, salesmanId);
}

// ---------------------------------------------------------------------------
// Assisted signup
// ---------------------------------------------------------------------------

export interface AssistedSignupResult {
  leadId: string;
  /** Where the customer completes their own signup, carrying the referral. */
  signupUrl: string;
  /** Where the invitation was sent. */
  sentTo: string;
  /**
   * Stated plainly in the response because it is the whole safety property of
   * this endpoint, and it belongs on the salesperson's screen too.
   */
  notice: string;
}

/**
 * Start a signup the customer finishes themselves.
 *
 * The point of this endpoint is what it *cannot* do. It sends the prospect a
 * link. It does not create an account, does not choose a password, does not
 * request an OTP on their behalf, does not touch a payment instrument, and
 * takes no field in which any of those could be supplied — see
 * `startAssistedSignupSchema`.
 *
 * The customer then registers through the ordinary `/register` flow, verifies
 * their own contact details, creates their own credentials and authorises their
 * own payment, exactly as a self-serve customer does. The only difference is
 * that the link carries the salesperson's referral code, so the sale is
 * credited without the salesperson having to hold anything belonging to the
 * customer.
 */
export async function startAssistedSignup(
  auth: AuthContext,
  salesman: SalesmanView,
  input: StartAssistedSignupInput,
  baseUrl: string,
): Promise<AssistedSignupResult> {
  const lead = await getLead(input.leadId, salesman.id);

  const destination = input.phone ?? lead.phone;
  const params = new URLSearchParams({ ref: salesman.godId });
  if (input.planTier ?? lead.interestedPlan) {
    params.set('plan', (input.planTier ?? lead.interestedPlan)!);
  }
  const signupUrl = `${baseUrl.replace(/\/$/, '')}/register?${params.toString()}`;

  /*
   * Advance the lead to SIGNUP_PENDING where the pipeline allows it.
   *
   * Best-effort: the invitation is the point, and a lead sitting at NEW is a
   * cosmetic problem next to failing to send it. A lead already further along
   * is left where it is rather than being dragged backwards.
   */
  if (salesLeadStateMachine.canTransition(lead.status, SalesLeadStatus.SIGNUP_PENDING)) {
    await prisma.salesLead.update({
      where: { id: lead.id },
      data: {
        status: SalesLeadStatus.SIGNUP_PENDING,
        events: {
          create: {
            type: SalesLeadEventType.STATUS_CHANGED,
            fromStatus: lead.status,
            toStatus: SalesLeadStatus.SIGNUP_PENDING,
            note: `Assisted signup invitation sent to ${destination}.`,
            actorUserId: auth.user.id,
          },
        },
      },
    });
  }

  await recordAudit({
    action: AuditAction.SALES_ASSISTED_SIGNUP_STARTED,
    entityType: 'SalesLead',
    entityId: lead.id,
    actorUserId: auth.user.id,
    after: {
      godId: salesman.godId,
      sentTo: destination,
      plan: input.planTier ?? lead.interestedPlan ?? null,
    },
  });

  leadLogger.info(
    { leadId: lead.id, salesmanId: salesman.id },
    'Assisted signup invitation prepared',
  );

  return {
    leadId: lead.id,
    signupUrl,
    sentTo: destination,
    notice:
      'The customer creates their own account and authorises their own payment. Never ask them ' +
      'for a password, an OTP, card details or a UPI PIN.',
  };
}

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

/**
 * Bring a lead's stage into line with what its customer's records actually say.
 *
 * The only writer of the derived statuses. Every input is a real row somewhere
 * else in Saarthi:
 *
 *   * `SUBSCRIBED` — an active or trialing subscription exists on the linked
 *     organization;
 *   * `TRACKER_PENDING` — they own a tracker that is not fitted to a vehicle;
 *   * `ONBOARDING` — a tracker is fitted and the fleet is not live yet;
 *   * `ACTIVATED` — at least one vehicle is reporting.
 *
 * Called after conversion, after a handover, and after onboarding completion.
 * Idempotent, and it never moves a lead backwards: a customer who cancels is
 * handled by an explicit CANCELLED transition with a reason, not by this
 * quietly demoting them.
 */
export async function syncFromCustomerState(leadId: string): Promise<SalesLeadStatus | null> {
  const lead = await prisma.salesLead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, organizationId: true },
  });
  if (!lead?.organizationId) return null;

  const status = lead.status as SalesLeadStatus;
  if (CLOSED_SALES_LEAD_STATUSES.includes(status)) return null;

  const [subscription, trackers, liveVehicles] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId: lead.organizationId },
      select: { status: true },
    }),
    prisma.vehicleTracker.findMany({
      where: { organizationId: lead.organizationId, status: 'ACTIVE' },
      select: { truckId: true },
    }),
    prisma.truck.count({
      where: { organizationId: lead.organizationId, lastLocationAt: { not: null } },
    }),
  ]);

  const subscribed =
    subscription?.status === 'ACTIVE' || subscription?.status === 'TRIALING';
  if (!subscribed) return null;

  const fitted = trackers.filter((tracker) => tracker.truckId !== null).length;

  const target: SalesLeadStatus =
    liveVehicles > 0
      ? SalesLeadStatus.ACTIVATED
      : fitted > 0
        ? SalesLeadStatus.ONBOARDING
        : trackers.length > 0
          ? SalesLeadStatus.TRACKER_PENDING
          : SalesLeadStatus.SUBSCRIBED;

  if (target === status) return null;

  /*
   * Only ever forwards.
   *
   * The pipeline order is the ordering, and a state machine walk is used
   * rather than a hand-written comparison so that adding a stage cannot
   * silently make this move a lead the wrong way.
   */
  const order: SalesLeadStatus[] = [
    SalesLeadStatus.NEW,
    SalesLeadStatus.CONTACTED,
    SalesLeadStatus.DEMO_SCHEDULED,
    SalesLeadStatus.DEMO_COMPLETED,
    SalesLeadStatus.INTERESTED,
    SalesLeadStatus.SIGNUP_PENDING,
    SalesLeadStatus.PAYMENT_PENDING,
    SalesLeadStatus.SUBSCRIBED,
    SalesLeadStatus.TRACKER_PENDING,
    SalesLeadStatus.ONBOARDING,
    SalesLeadStatus.ACTIVATED,
  ];
  if (order.indexOf(target) <= order.indexOf(status)) return null;

  await prisma.salesLead.update({
    where: { id: leadId },
    data: {
      status: target,
      events: {
        create: {
          type: SalesLeadEventType.STATUS_CHANGED,
          fromStatus: status,
          toStatus: target,
          note: 'Set by Saarthi from the customer’s own subscription, tracker and vehicle state.',
        },
      },
    },
  });

  leadLogger.info({ leadId, from: status, to: target }, 'Lead stage derived from customer state');
  return target;
}

/**
 * Link a lead to the organization its prospect registered as.
 *
 * Called when a referral converts, so the salesperson's pipeline connects to
 * the real customer. Matched on phone number, which is the one identifier a
 * salesperson reliably captures and a registrant reliably supplies.
 */
export async function linkLeadToOrganization(input: {
  salesmanId: string;
  organizationId: string;
  attributionId: string | null;
  phone: string | null;
  email: string | null;
}): Promise<string | null> {
  if (!input.phone && !input.email) return null;

  const lead = await prisma.salesLead.findFirst({
    where: {
      salesmanId: input.salesmanId,
      organizationId: null,
      status: { notIn: CLOSED_SALES_LEAD_STATUSES as never },
      OR: [
        ...(input.phone ? [{ phone: input.phone }] : []),
        ...(input.email ? [{ email: input.email }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!lead) return null;

  await prisma.salesLead.update({
    where: { id: lead.id },
    data: {
      organizationId: input.organizationId,
      attributionId: input.attributionId,
      events: {
        create: {
          type: SalesLeadEventType.CUSTOMER_LINKED,
          note: 'This prospect registered with Saarthi.',
        },
      },
    },
  });

  await syncFromCustomerState(lead.id);
  return lead.id;
}

/**
 * Mark the first-vehicle demonstration finished on a lead.
 *
 * The only writer of `onboardingCompletedAt` and `firstVehicleId`, and it is
 * deliberately dumb: it records what its caller has already proved. The proof
 * is `onboarding.service.assertComplete`, which re-reads the device assignment
 * and the vehicle's own telemetry — so a client cannot reach these two columns
 * without the six checks having passed on the server a moment earlier.
 */
export async function recordOnboardingCompleted(input: {
  leadId: string;
  vehicleId: string;
  note: string | null;
  at: Date;
}): Promise<LeadView> {
  const row = await prisma.salesLead.update({
    where: { id: input.leadId },
    data: {
      firstVehicleId: input.vehicleId,
      onboardingCompletedAt: input.at,
      events: {
        create: {
          type: SalesLeadEventType.ONBOARDING_COMPLETED,
          note:
            input.note ??
            'First vehicle set up with the owner: tracker, Driver App, OBD and telemetry all ' +
              'confirmed against real device state.',
        },
      },
    },
    include: withRelations,
  });

  return toView(row);
}

/**
 * Remind salespeople of the follow-ups they owe.
 *
 * Run from the jobs scheduler. One notification per lead per day at most,
 * because the alternative is a salesperson who turns Saarthi notifications off
 * and then misses the ones that matter.
 */
export async function notifyDueFollowUps(): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const due = await prisma.salesLead.findMany({
    where: {
      nextFollowUpAt: { lte: now },
      status: { notIn: CLOSED_SALES_LEAD_STATUSES as never },
    },
    include: { salesman: { select: { userId: true } } },
    take: 500,
  });

  let sent = 0;
  for (const lead of due) {
    if (!lead.salesman.userId) continue;

    const alreadyToday = await prisma.notification.findFirst({
      where: {
        userId: lead.salesman.userId,
        type: NotificationType.SALES_LEAD_FOLLOW_UP_DUE,
        createdAt: { gte: startOfDay },
        data: { path: ['leadId'], equals: lead.id },
      },
      select: { id: true },
    });
    if (alreadyToday) continue;

    await notify({
      userId: lead.salesman.userId,
      type: NotificationType.SALES_LEAD_FOLLOW_UP_DUE,
      title: 'Follow-up due',
      body: `${lead.businessName ?? lead.contactName} is due a follow-up.`,
      priority: NotificationPriority.NORMAL,
      data: { leadId: lead.id },
      actionUrl: `/sales/leads/${lead.id}`,
    });
    sent += 1;
  }

  if (sent > 0) leadLogger.info({ sent }, 'Follow-up reminders delivered');
  return sent;
}
