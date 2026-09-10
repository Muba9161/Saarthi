import {
  COMMISSION_TRANSITIONS,
  CommissionStatus,
  type CommissionTrigger,
  type CommissionType,
  NotificationPriority,
  NotificationType,
  type PlanTier,
  canTransitionCommission,
  computeCommission,
  type CommissionDecisionInput,
  type CommissionListQuery,
  type CommissionRuleInput,
} from '@saarthi/shared';
import { isUniqueViolation, prisma, type Db } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyAsync } from '../notifications/notification.service';
import { liveAttributionFor, markConverted } from './referral.service';
import type { AuthContext } from '../../auth/context';

/**
 * Commission — money owed to a salesperson for a sale that was actually paid
 * for.
 *
 * Five rules govern this file. Every one of them is a rule about not paying
 * somebody for something that did not happen.
 *
 * **1. A commission is generated from a payment, never from a subscription
 * record.** `generateForPayment` takes a payment reference and an amount that
 * genuinely left a customer's account. A subscription row on its own — a trial,
 * a plan selected but declined at the gateway, a `PAYMENT_FAILED` top-up — earns
 * nothing.
 *
 * **2. One commission per payment, per trigger.** Enforced by a unique index
 * and reached through `upsert`, so a retried webhook, a replayed renewal or two
 * concurrent qualification passes converge on one row instead of paying twice.
 *
 * **3. Amounts are computed here and nowhere else.** No endpoint in Saarthi
 * accepts a commission amount. The salesperson's role holds `commission.read`
 * and not `commission.manage`, so the person earning it cannot approve it
 * either.
 *
 * **4. A null amount is not zero.** When no rule covers a sale, the row is
 * created `PENDING` with a null amount and a note saying so. It is visible to
 * an administrator as something to fix, cannot be approved (a database CHECK
 * refuses it), and is filled in by `recalculatePending` once a rule exists.
 *
 * **5. Nothing is payable without a human.** `PENDING → PAID` is not a legal
 * transition. APPROVED records who confirmed the figure; PAYABLE records that a
 * payout run picked it up.
 */

const commissionLogger = logger.child({ module: 'sales:commission' });

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface CommissionRuleView {
  id: string;
  name: string;
  planTier: PlanTier | null;
  trigger: CommissionTrigger;
  commissionType: CommissionType;
  commissionRate: number | null;
  fixedAmount: number | null;
  qualificationDays: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
}

type RuleRow = {
  id: string;
  name: string;
  planTier: string | null;
  trigger: string;
  commissionType: string;
  commissionRate: unknown;
  fixedAmount: unknown;
  qualificationDays: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  active: boolean;
  note: string | null;
  createdAt: Date;
};

function toRuleView(row: RuleRow): CommissionRuleView {
  return {
    id: row.id,
    name: row.name,
    planTier: row.planTier as PlanTier | null,
    trigger: row.trigger as CommissionTrigger,
    commissionType: row.commissionType as CommissionType,
    commissionRate: row.commissionRate === null ? null : Number(row.commissionRate),
    fixedAmount: row.fixedAmount === null ? null : Number(row.fixedAmount),
    qualificationDays: row.qualificationDays,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    active: row.active,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listRules(): Promise<CommissionRuleView[]> {
  const rows = await prisma.commissionRule.findMany({
    orderBy: [{ active: 'desc' }, { trigger: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(toRuleView);
}

export async function createRule(
  auth: AuthContext,
  input: CommissionRuleInput,
): Promise<CommissionRuleView> {
  let row;
  try {
    row = await prisma.commissionRule.create({
      data: {
        name: input.name,
        planTier: input.planTier ?? null,
        trigger: input.trigger,
        commissionType: input.commissionType,
        commissionRate: input.commissionRate ?? null,
        fixedAmount: input.fixedAmount ?? null,
        qualificationDays: input.qualificationDays,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        active: input.active,
        note: input.note ?? null,
        createdByUserId: auth.user.id,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // One of the partial unique indexes from the migration. Two active rules
      // covering the same sale would make the amount depend on row order.
      throw errors.conflict(
        'An active rule already covers this combination of sale type and plan. Deactivate it ' +
          'first, or narrow one of the two.',
      );
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.COMMISSION_RULE_CREATED,
    entityType: 'CommissionRule',
    entityId: row.id,
    actorUserId: auth.user.id,
    after: toRuleView(row) as never,
  });

  /*
   * Fill in the commissions that were waiting for exactly this rule.
   *
   * The whole point of keeping a null-amount row rather than dropping the sale:
   * an administrator who configures commission a month after launch does not
   * lose the month.
   */
  const filled = await recalculatePending(auth);
  if (filled > 0) {
    commissionLogger.info({ ruleId: row.id, filled }, 'Pending commissions priced by new rule');
  }

  return toRuleView(row);
}

export async function updateRule(
  auth: AuthContext,
  id: string,
  input: CommissionRuleInput,
): Promise<CommissionRuleView> {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Commission rule');

  let row;
  try {
    row = await prisma.commissionRule.update({
      where: { id },
      data: {
        name: input.name,
        planTier: input.planTier ?? null,
        trigger: input.trigger,
        commissionType: input.commissionType,
        commissionRate: input.commissionRate ?? null,
        fixedAmount: input.fixedAmount ?? null,
        qualificationDays: input.qualificationDays,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        active: input.active,
        note: input.note ?? null,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw errors.conflict(
        'An active rule already covers this combination of sale type and plan.',
      );
    }
    throw error;
  }

  await recordAudit({
    action: AuditAction.COMMISSION_RULE_UPDATED,
    entityType: 'CommissionRule',
    entityId: id,
    actorUserId: auth.user.id,
    before: toRuleView(existing) as never,
    after: toRuleView(row) as never,
  });

  /*
   * Existing commissions keep the rate they were computed at.
   *
   * Deliberate: a salesperson's earnings on a sale made in March must not
   * change because the rate was renegotiated in June. Only rows that never got
   * a figure at all are revisited.
   */
  await recalculatePending(auth);

  return toRuleView(row);
}

/**
 * The rule that covers one sale, or null.
 *
 * A plan-specific rule beats a catch-all, which is the only ordering that
 * makes "Business earns 10%, everything else 7%" expressible. The partial
 * unique indexes guarantee at most one of each is active, so this is a lookup
 * rather than a tie-break.
 */
async function resolveRule(input: {
  trigger: CommissionTrigger;
  planTier: PlanTier | null;
  at: Date;
  db: Db;
}): Promise<RuleRow | null> {
  const effective = {
    active: true,
    trigger: input.trigger,
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: input.at } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.at } }] },
    ],
  };

  if (input.planTier) {
    const specific = await input.db.commissionRule.findFirst({
      where: { ...effective, planTier: input.planTier },
    });
    if (specific) return specific as RuleRow;
  }

  const catchAll = await input.db.commissionRule.findFirst({
    where: { ...effective, planTier: null },
  });
  return (catchAll as RuleRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface QualifyInput {
  organizationId: string;
  /** What the customer actually paid. Commissionable base, GST excluded. */
  baseAmount: number;
  /** The successful payment's reference. The idempotency key. */
  paymentReference: string;
  trigger: CommissionTrigger;
  planTier?: PlanTier | null;
  subscriptionId?: string | null;
  paymentId?: string | null;
  db?: Db;
}

export interface QualifyResult {
  /** Null when the customer is not attributed to anybody. */
  commissionId: string | null;
  /** The amount recorded, or null when no rule covered the sale. */
  amount: number | null;
  status: CommissionStatus | null;
  /** Why nothing was generated, when nothing was. */
  skipped: string | null;
}

/**
 * Record the commission owed on one successful payment.
 *
 * **Never throws.** Its callers are payment paths that have already taken a
 * customer's money and provisioned what they bought; a commission failure must
 * not roll any of that back or surface to the customer, who has no idea a
 * salesperson exists. Everything is reported through the return value and the
 * log.
 *
 * The sequence:
 *
 *   1. Is this customer attributed to anybody? No → nothing owed, and that is
 *      the ordinary case for a self-serve signup.
 *   2. Is there a rule covering this sale, in force on the day of the payment?
 *      No → a `PENDING` row with a null amount and the reason, so the sale is
 *      not lost.
 *   3. `upsert` on `(trigger, paymentReference)` → at most one row, whatever
 *      the caller does.
 *   4. Mark the attribution `CONVERTED`, because a real payment has now been
 *      seen against it.
 */
export async function generateForPayment(input: QualifyInput): Promise<QualifyResult> {
  const db = input.db ?? prisma;

  try {
    const attribution = await liveAttributionFor(input.organizationId, db);
    if (!attribution) {
      return {
        commissionId: null,
        amount: null,
        status: null,
        skipped: 'This customer is not attributed to a salesperson.',
      };
    }

    const now = new Date();
    const rule = await resolveRule({
      trigger: input.trigger,
      planTier: input.planTier ?? null,
      at: now,
      db,
    });

    const computed = rule
      ? computeCommission(
          {
            commissionType: rule.commissionType as CommissionType,
            commissionRate: rule.commissionRate === null ? null : Number(rule.commissionRate),
            fixedAmount: rule.fixedAmount === null ? null : Number(rule.fixedAmount),
          },
          input.baseAmount,
        )
      : {
          amount: null,
          rate: null,
          reason:
            'No active commission rule covers this sale. Create one and the amount will be ' +
            'filled in automatically.',
        };

    /*
     * When the amount may be approved.
     *
     * The qualification period is the cooling-off window: a subscription
     * refunded inside it reverses rather than pays. With no rule there is no
     * agreed period either, so the row is held until one exists — which is
     * what a null amount already means.
     */
    const eligibleAt = rule
      ? new Date(now.getTime() + rule.qualificationDays * 86_400_000)
      : now;

    const shared = {
      salesmanId: attribution.salesmanId,
      attributionId: attribution.id,
      ruleId: rule?.id ?? null,
      godId: attribution.godId,
      salespersonExternalId: attribution.salespersonExternalId,
      organizationId: input.organizationId,
      planTier: input.planTier ?? null,
      status: CommissionStatus.PENDING,
      baseAmount: input.baseAmount,
      commissionRate: computed.rate,
      commissionAmount: computed.amount,
      paymentId: input.paymentId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      eligibleAt,
      unmatchedReason: computed.reason,
    };

    const row = await db.commission.upsert({
      where: {
        trigger_paymentReference: {
          trigger: input.trigger,
          paymentReference: input.paymentReference,
        },
      },
      create: { ...shared, trigger: input.trigger, paymentReference: input.paymentReference },
      /*
       * A replayed payment updates nothing.
       *
       * The first pass is authoritative: it captured the rule and the rate in
       * force at the time. Re-pricing on a retry would mean the amount depended
       * on when the gateway happened to redeliver its webhook.
       */
      update: {},
    });

    await markConverted(attribution.id, db);

    await recordAudit(
      {
        action: AuditAction.COMMISSION_GENERATED,
        entityType: 'Commission',
        entityId: row.id,
        organizationId: input.organizationId,
        after: {
          godId: attribution.godId,
          trigger: input.trigger,
          baseAmount: input.baseAmount,
          amount: computed.amount,
          rate: computed.rate,
          ruleId: rule?.id ?? null,
          paymentReference: input.paymentReference,
          unmatched: computed.reason,
        },
      },
      db,
    );

    await notifySalesman(attribution.salesmanId, {
      type: NotificationType.SALES_COMMISSION_PENDING,
      title: computed.amount === null ? 'A sale was recorded' : 'Commission pending',
      body:
        computed.amount === null
          ? 'A customer you brought to Saarthi has paid. Saarthi operations is confirming the amount.'
          : `₹${computed.amount.toLocaleString('en-IN')} is pending on a customer you brought to Saarthi.`,
      actionUrl: '/sales/commission',
    });

    return {
      commissionId: row.id,
      amount: computed.amount,
      status: CommissionStatus.PENDING,
      skipped: null,
    };
  } catch (error) {
    // Deliberately terminal. See the doc comment: the customer's purchase has
    // already succeeded, and this must not undo it.
    commissionLogger.error(
      {
        err: error,
        organizationId: input.organizationId,
        paymentReference: input.paymentReference,
        trigger: input.trigger,
      },
      'Commission could not be generated for a successful payment',
    );
    return {
      commissionId: null,
      amount: null,
      status: null,
      skipped: 'Commission could not be recorded. Saarthi operations has been notified.',
    };
  }
}

/**
 * Price the commissions that were qualified before a rule existed.
 *
 * Only `PENDING` rows with a null amount, and each is priced by the rule in
 * force *now* — there is no other honest choice, since there was no agreement
 * on the day of the sale. Rows that already carry an amount are never
 * repriced.
 */
export async function recalculatePending(auth: AuthContext): Promise<number> {
  const unpriced = await prisma.commission.findMany({
    where: { status: CommissionStatus.PENDING, commissionAmount: null },
    take: 500,
  });

  if (unpriced.length === 0) return 0;

  const now = new Date();
  let filled = 0;

  for (const row of unpriced) {
    const rule = await resolveRule({
      trigger: row.trigger as CommissionTrigger,
      planTier: row.planTier as PlanTier | null,
      at: now,
      db: prisma,
    });
    if (!rule) continue;

    const computed = computeCommission(
      {
        commissionType: rule.commissionType as CommissionType,
        commissionRate: rule.commissionRate === null ? null : Number(rule.commissionRate),
        fixedAmount: rule.fixedAmount === null ? null : Number(rule.fixedAmount),
      },
      Number(row.baseAmount),
    );
    if (computed.amount === null) continue;

    await prisma.commission.update({
      where: { id: row.id },
      data: {
        ruleId: rule.id,
        commissionRate: computed.rate,
        commissionAmount: computed.amount,
        eligibleAt: new Date(row.createdAt.getTime() + rule.qualificationDays * 86_400_000),
        unmatchedReason: null,
      },
    });

    await recordAudit({
      action: AuditAction.COMMISSION_RECALCULATED,
      entityType: 'Commission',
      entityId: row.id,
      actorUserId: auth.user.id,
      organizationId: row.organizationId,
      after: { ruleId: rule.id, amount: computed.amount, rate: computed.rate },
    });

    filled += 1;
  }

  return filled;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface CommissionView {
  id: string;
  godId: string;
  salesmanId: string;
  salesmanName: string | null;
  organizationId: string;
  organizationName: string | null;
  planTier: PlanTier | null;
  trigger: CommissionTrigger;
  status: CommissionStatus;
  baseAmount: number;
  commissionRate: number | null;
  commissionAmount: number | null;
  currency: string;
  paymentReference: string;
  eligibleAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  payoutReference: string | null;
  decisionReason: string | null;
  unmatchedReason: string | null;
  createdAt: string;
}

type CommissionRow = {
  id: string;
  godId: string;
  salesmanId: string;
  organizationId: string;
  planTier: string | null;
  trigger: string;
  status: string;
  baseAmount: unknown;
  commissionRate: unknown;
  commissionAmount: unknown;
  currency: string;
  paymentReference: string;
  eligibleAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  payoutReference: string | null;
  decisionReason: string | null;
  unmatchedReason: string | null;
  createdAt: Date;
  salesman?: { name: string | null } | null;
  organization?: { name: string } | null;
};

function toCommissionView(row: CommissionRow): CommissionView {
  return {
    id: row.id,
    godId: row.godId,
    salesmanId: row.salesmanId,
    salesmanName: row.salesman?.name ?? null,
    organizationId: row.organizationId,
    organizationName: row.organization?.name ?? null,
    planTier: row.planTier as PlanTier | null,
    trigger: row.trigger as CommissionTrigger,
    status: row.status as CommissionStatus,
    baseAmount: Number(row.baseAmount),
    commissionRate: row.commissionRate === null ? null : Number(row.commissionRate),
    commissionAmount: row.commissionAmount === null ? null : Number(row.commissionAmount),
    currency: row.currency,
    paymentReference: row.paymentReference,
    eligibleAt: row.eligibleAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    payoutReference: row.payoutReference,
    decisionReason: row.decisionReason,
    unmatchedReason: row.unmatchedReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCommissions(
  query: CommissionListQuery,
  salesmanId: string | null,
): Promise<{ items: CommissionView[]; total: number }> {
  const where = {
    ...(salesmanId ? { salesmanId } : query.salesmanId ? { salesmanId: query.salesmanId } : {}),
    ...(query.status ? { status: { in: query.status as never } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.commission.findMany({
      where,
      include: { salesman: { select: { name: true } }, organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.commission.count({ where }),
  ]);

  return { items: rows.map(toCommissionView), total };
}

export interface CommissionTotals {
  pending: number;
  approved: number;
  paid: number;
  reversed: number;
  /** Rows that qualified but have no amount yet. Counted, never summed. */
  awaitingRule: number;
  currency: string;
}

/**
 * What a salesperson is owed, by state.
 *
 * `awaitingRule` is a **count**, not a total, and that asymmetry is the point:
 * a row with no amount cannot contribute to a sum, and quietly treating it as
 * zero would show a salesperson a smaller figure than they are owed with
 * nothing on the screen to explain it.
 */
export async function commissionTotals(salesmanId: string): Promise<CommissionTotals> {
  const [grouped, awaitingRule] = await Promise.all([
    prisma.commission.groupBy({
      by: ['status'],
      where: { salesmanId, commissionAmount: { not: null } },
      _sum: { commissionAmount: true },
    }),
    prisma.commission.count({
      where: { salesmanId, status: CommissionStatus.PENDING, commissionAmount: null },
    }),
  ]);

  const sumFor = (...statuses: CommissionStatus[]): number =>
    grouped
      .filter((group) => statuses.includes(group.status as CommissionStatus))
      .reduce((total, group) => total + Number(group._sum.commissionAmount ?? 0), 0);

  return {
    pending: sumFor(CommissionStatus.PENDING),
    approved: sumFor(CommissionStatus.APPROVED, CommissionStatus.PAYABLE),
    paid: sumFor(CommissionStatus.PAID),
    reversed: sumFor(CommissionStatus.REVERSED),
    awaitingRule,
    currency: 'INR',
  };
}

/**
 * Approve, mark payable, pay, reverse or reject one commission.
 *
 * Platform administration only. Four guards, in order:
 *
 *   1. The transition has to be legal — `PENDING → PAID` is not.
 *   2. Anything that settles money needs an amount. A null-amount row cannot be
 *      approved; the database CHECK agrees, but the message here is the useful
 *      one.
 *   3. Approval waits for the qualification period. Paying inside the
 *      cooling-off window is paying before the refund risk has passed.
 *   4. Denying or taking back money needs a stated reason.
 */
export async function decide(
  auth: AuthContext,
  id: string,
  input: CommissionDecisionInput,
): Promise<CommissionView> {
  const existing = await prisma.commission.findUnique({ where: { id } });
  if (!existing) throw errors.notFound('Commission');

  const from = existing.status as CommissionStatus;
  const to = input.status;

  if (!canTransitionCommission(from, to)) {
    // The real next states, not an empty array: the screen renders these as the
    // options it offers, so a wrong guess here becomes a dropdown the API then
    // refuses.
    throw errors.invalidTransition(`A commission cannot move from ${from} to ${to}.`, {
      from,
      to,
      allowed: COMMISSION_TRANSITIONS[from] ?? [],
    });
  }

  const settles =
    to === CommissionStatus.APPROVED ||
    to === CommissionStatus.PAYABLE ||
    to === CommissionStatus.PAID;

  if (settles && existing.commissionAmount === null) {
    throw errors.businessRule(
      'This commission has no amount yet because no rule covered the sale. Create or correct a ' +
        'commission rule first — the amount is then filled in automatically.',
      { unmatchedReason: existing.unmatchedReason },
    );
  }

  if (to === CommissionStatus.APPROVED && existing.eligibleAt > new Date()) {
    throw errors.businessRule(
      `This sale is still inside its qualification period, which ends on ` +
        `${existing.eligibleAt.toLocaleDateString('en-IN')}. It can be approved after that.`,
      { eligibleAt: existing.eligibleAt.toISOString() },
    );
  }

  if (
    (to === CommissionStatus.REVERSED || to === CommissionStatus.REJECTED) &&
    !input.reason
  ) {
    throw errors.validation('A reason is required to reverse or reject a commission.', {
      fields: { reason: ['Say why this commission is not being paid.'] },
    });
  }

  const now = new Date();
  const row = await prisma.commission.update({
    where: { id },
    data: {
      status: to,
      ...(to === CommissionStatus.APPROVED
        ? { approvedAt: now, approvedByUserId: auth.user.id }
        : {}),
      ...(to === CommissionStatus.PAID
        ? {
            paidAt: now,
            paidByUserId: auth.user.id,
            payoutReference: input.paymentReference ?? null,
          }
        : {}),
      ...(to === CommissionStatus.REVERSED ? { reversedAt: now } : {}),
      ...(input.reason ? { decisionReason: input.reason } : {}),
    },
    include: { salesman: { select: { name: true } }, organization: { select: { name: true } } },
  });

  const action =
    to === CommissionStatus.APPROVED
      ? AuditAction.COMMISSION_APPROVED
      : to === CommissionStatus.PAYABLE
        ? AuditAction.COMMISSION_PAYABLE
        : to === CommissionStatus.PAID
          ? AuditAction.COMMISSION_PAID
          : to === CommissionStatus.REVERSED
            ? AuditAction.COMMISSION_REVERSED
            : AuditAction.COMMISSION_REJECTED;

  await recordAudit({
    action,
    entityType: 'Commission',
    entityId: id,
    actorUserId: auth.user.id,
    organizationId: existing.organizationId,
    before: { status: from, amount: Number(existing.commissionAmount ?? 0) },
    after: {
      status: to,
      amount: row.commissionAmount === null ? null : Number(row.commissionAmount),
      reason: input.reason ?? null,
      payoutReference: input.paymentReference ?? null,
      godId: existing.godId,
    },
  });

  if (to === CommissionStatus.APPROVED || to === CommissionStatus.PAID) {
    const amount = Number(row.commissionAmount ?? 0);
    await notifySalesman(existing.salesmanId, {
      type:
        to === CommissionStatus.PAID
          ? NotificationType.SALES_COMMISSION_PAID
          : NotificationType.SALES_COMMISSION_APPROVED,
      title: to === CommissionStatus.PAID ? 'Commission paid' : 'Commission approved',
      body: `₹${amount.toLocaleString('en-IN')} on ${row.organization?.name ?? 'a customer'} has been ${
        to === CommissionStatus.PAID ? 'paid' : 'approved'
      }.`,
      actionUrl: '/sales/commission',
    });
  }

  return toCommissionView(row);
}

/** Deliver a notification to whoever holds a salesman profile, if anybody does. */
async function notifySalesman(
  salesmanId: string,
  message: { type: NotificationType; title: string; body: string; actionUrl: string },
): Promise<void> {
  const profile = await prisma.salesmanProfile.findUnique({
    where: { id: salesmanId },
    select: { userId: true },
  });
  if (!profile?.userId) return;

  notifyAsync({
    userId: profile.userId,
    type: message.type,
    title: message.title,
    body: message.body,
    priority: NotificationPriority.NORMAL,
    actionUrl: message.actionUrl,
  });
}
