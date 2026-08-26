import {
  InstallmentStatus,
  LoanEventType,
  LoanReminderKind,
  LoanStatus,
  NotificationPriority,
  NotificationType,
  addDays,
  daysBetween,
  formatCurrency,
  reminderOffsets,
  round2,
} from '@saarthi/shared';
import { type Prisma, prisma } from '../../database/prisma';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { withLock } from '../../infra/lock';
import { notifyOrganization } from '../notifications/notification.service';

/**
 * EMI reminders and the overdue check.
 *
 * The failure this exists to prevent is concrete: a single-truck operator who
 * misses an installment because nobody told them, and loses the vehicle their
 * livelihood depends on. That makes duplicate suppression as important as
 * delivery — an owner who gets the same T-4 notice six times stops reading
 * them, and the T-1 notice arrives into an ignored inbox.
 *
 * Suppression is enforced by a unique key on (installment, reminder kind) in
 * PostgreSQL rather than by timing, so a restarted worker, an overlapping tick
 * or a second instance cannot resend what was already delivered.
 */

const reminderLogger = logger.child({ module: 'loans:reminders' });

const REMINDER_LOCK_TTL_MS = 5 * 60_000;

/** How far back a missed overdue notice is still worth sending. */
const OVERDUE_LOOKBACK_DAYS = 30;

const OPEN_STATUSES: InstallmentStatus[] = [
  InstallmentStatus.UPCOMING,
  InstallmentStatus.DUE_SOON,
  InstallmentStatus.DUE_TODAY,
  InstallmentStatus.OVERDUE,
  InstallmentStatus.PARTIALLY_PAID,
];

interface ReminderCopy {
  type: NotificationType;
  title: string;
  priority: NotificationPriority;
}

function copyFor(kind: LoanReminderKind, daysUntilDue: number): ReminderCopy {
  if (kind === LoanReminderKind.OVERDUE) {
    return {
      type: NotificationType.LOAN_EMI_OVERDUE,
      title: 'EMI overdue',
      priority: NotificationPriority.CRITICAL,
    };
  }
  if (daysUntilDue <= 0) {
    return {
      type: NotificationType.LOAN_EMI_DUE_TODAY,
      title: 'EMI due today',
      priority: NotificationPriority.HIGH,
    };
  }
  return {
    type: NotificationType.LOAN_EMI_DUE_SOON,
    title: `EMI due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'}`,
    priority: NotificationPriority.HIGH,
  };
}

export interface ReminderSweepResult {
  examined: number;
  sent: number;
  suppressed: number;
}

/**
 * Send every reminder that has come due and has not already been sent.
 *
 * One query pulls the whole window (widest configured offset either side of
 * today) so the sweep is a single scan rather than a query per loan.
 */
export async function runEmiReminderSweep(): Promise<ReminderSweepResult> {
  const result = await withLock('jobs:loan:emi-reminder', REMINDER_LOCK_TTL_MS, async () => {
    const now = new Date();
    const offsets = config.finance.reminderOffsets;
    const earliest = Math.min(...offsets, -1);
    const latest = Math.max(...offsets, 1);

    // A reminder at offset -4 fires when the due date is 4 days away, so the
    // window runs from (today + |earliest|) back to (today - latest).
    /*
     * How far back to look for installments that still owe a notice.
     *
     * The naive window is `-latest`, i.e. one day back for a T+1 reminder — and
     * that is wrong. It means an installment that lapsed while the workers were
     * down, or a loan entered a week after its EMI was missed, never gets an
     * overdue notice at all. The one case the reminder exists for is exactly
     * the case it would skip.
     *
     * A month of lookback covers a realistic outage or a late entry. Beyond
     * that the fleet has other ways of knowing, and the unique key means an
     * installment already notified is never notified twice.
     */
    const windowStart = addDays(now, -Math.max(latest, OVERDUE_LOOKBACK_DAYS));
    const windowEnd = addDays(now, Math.abs(earliest));

    const installments = await prisma.loanInstallment.findMany({
      where: {
        dueDate: { gte: windowStart, lte: windowEnd },
        status: { in: OPEN_STATUSES },
        loan: {
          remindersEnabled: true,
          status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED] },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: config.finance.reminderBatchSize,
      include: {
        loan: {
          select: {
            id: true,
            organizationId: true,
            lenderName: true,
            vehicleId: true,
            reminderOffsets: true,
          },
        },
      },
    });

    if (installments.length === 0) {
      return { examined: 0, sent: 0, suppressed: 0 };
    }

    const vehicles = await prisma.truck.findMany({
      where: { id: { in: [...new Set(installments.map((row) => row.loan.vehicleId))] } },
      select: { id: true, registrationNumber: true },
    });
    const labels = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));

    let sent = 0;
    let suppressed = 0;

    for (const installment of installments) {
      const outstanding = round2(Number(installment.totalDue) - Number(installment.amountPaid));
      if (outstanding <= 0) continue;

      const daysUntilDue = daysBetween(now, installment.dueDate);
      const configured = reminderOffsets(
        installment.loan.reminderOffsets.length > 0
          ? installment.loan.reminderOffsets
          : config.finance.reminderOffsets,
      );

      /*
       * Which reminder windows have opened for this installment.
       *
       * Usually one. But a loan entered mid-schedule — someone recording a
       * facility they have been paying for a year — can arrive with T-4, T-1
       * and even T+1 all already past. Sending three notifications about one
       * installment in the same minute is how an owner learns to ignore them,
       * so only the most urgent is delivered and the ones it has overtaken are
       * marked as sent. "Due in 4 days" has no value once "overdue" is true.
       */
      const due = configured.filter((offset) => {
        // `daysUntilDue <= -offsetDays` reads as: the due date is now within
        // `offsetDays` days of today, or past it.
        if (daysUntilDue > -offset.offsetDays) return false;
        // The overdue notice only applies once the date has genuinely passed.
        if (offset.kind === LoanReminderKind.OVERDUE && daysUntilDue >= 0) return false;
        return true;
      });

      if (due.length === 0) continue;

      // Later offset = closer to (or past) the due date = more urgent.
      const ordered = [...due].sort((a, b) => b.offsetDays - a.offsetDays);
      const toDeliver = ordered[0]!;
      const overtaken = ordered.slice(1);

      const claimed: LoanReminderKind[] = [];
      let alreadySent = false;

      for (const offset of ordered) {
        try {
          // The unique constraint is the suppression mechanism. Racing workers
          // both attempt the insert; exactly one succeeds and sends.
          await prisma.loanReminder.create({
            data: {
              loanId: installment.loanId,
              installmentId: installment.id,
              organizationId: installment.organizationId,
              kind: offset.kind,
              dueDate: installment.dueDate,
            },
          });
          claimed.push(offset.kind);
        } catch (error) {
          if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
            suppressed += 1;
            if (offset.kind === toDeliver.kind) alreadySent = true;
            continue;
          }
          throw error;
        }
      }

      // Nothing to say: either every window was already delivered, or the one
      // that mattered was claimed by another worker between our two statements.
      if (claimed.length === 0 || alreadySent) continue;

      const copy = copyFor(toDeliver.kind, daysUntilDue);
      const registration = labels.get(installment.loan.vehicleId) ?? 'A vehicle';

      await notifyOrganization(installment.organizationId, {
        type: copy.type,
        title: `${copy.title} — ${registration}`,
        body:
          `${installment.loan.lenderName}: installment #${installment.number} of ` +
          `${formatCurrency(outstanding)} due ${installment.dueDate.toISOString().slice(0, 10)}.`,
        priority: copy.priority,
        actionUrl: `/fleet/loans/${installment.loanId}`,
        // Finance is owner-level information — see Permission.LOANS_READ.
        roles: ['FLEET_OWNER'],
      });

      await prisma.loanEvent.create({
        data: {
          loanId: installment.loanId,
          organizationId: installment.organizationId,
          eventType: LoanEventType.REMINDER_SENT,
          description:
            `${toDeliver.kind} reminder sent for installment #${installment.number}` +
            (overtaken.length > 0
              ? `; ${overtaken.map((offset) => offset.kind).join(', ')} superseded.`
              : '.'),
          metadata: {
            kind: toDeliver.kind,
            superseded: overtaken.map((offset) => offset.kind),
            dueDate: installment.dueDate.toISOString(),
          },
        },
      });

      sent += 1;
    }

    reminderLogger.info(
      { examined: installments.length, sent, suppressed },
      'EMI reminder sweep complete',
    );
    return { examined: installments.length, sent, suppressed };
  });

  return result ?? { examined: 0, sent: 0, suppressed: 0 };
}

export interface OverdueSweepResult {
  markedOverdue: number;
  loansAffected: number;
}

/**
 * Promote past-due installments to OVERDUE in storage.
 *
 * The API already derives the transient states on read, so this exists for the
 * things that cannot: reminder targeting, provider reconciliation and the
 * fleet-level overdue counters, which all compare against a stored value.
 */
export async function runOverdueSweep(): Promise<OverdueSweepResult> {
  const result = await withLock('jobs:loan:overdue-check', REMINDER_LOCK_TTL_MS, async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const stale = await prisma.loanInstallment.findMany({
      where: {
        dueDate: { lt: today },
        status: {
          in: [
            InstallmentStatus.UPCOMING,
            InstallmentStatus.DUE_SOON,
            InstallmentStatus.DUE_TODAY,
          ],
        },
        loan: { status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED] } },
      },
      select: { id: true, loanId: true, organizationId: true, number: true },
      take: 2000,
    });

    if (stale.length === 0) return { markedOverdue: 0, loansAffected: 0 };

    await prisma.loanInstallment.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { status: InstallmentStatus.OVERDUE },
    });

    const loanIds = [...new Set(stale.map((row) => row.loanId))];
    await prisma.loanEvent.createMany({
      data: loanIds.map((loanId) => ({
        loanId,
        organizationId:
          stale.find((row) => row.loanId === loanId)?.organizationId ?? '',
        eventType: LoanEventType.MARKED_OVERDUE,
        description: `${stale.filter((row) => row.loanId === loanId).length} installment(s) passed their due date.`,
      })),
    });

    // The fleet finance rollup is cached; an overdue flip must be visible now.
    for (const organizationId of new Set(stale.map((row) => row.organizationId))) {
      await cache.delete(cacheKeys.fleetLoanSummary(organizationId));
    }

    reminderLogger.info(
      { markedOverdue: stale.length, loans: loanIds.length },
      'Loan overdue sweep complete',
    );
    return { markedOverdue: stale.length, loansAffected: loanIds.length };
  });

  return result ?? { markedOverdue: 0, loansAffected: 0 };
}
