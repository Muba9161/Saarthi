import {
  FinanceDataSource,
  FinanceVerificationStatus,
  InstallmentStatus,
  LoanDisclosureLevel,
  LoanEventType,
  LoanStatus,
  NotificationPriority,
  NotificationType,
  Permission,
  addMonthsClamped,
  buildPaginationMeta,
  calculateEmi,
  computeLoanPosition,
  deriveInstallmentStatus,
  generateSchedule,
  hasPermission,
  installmentCount,
  isSettledInstallment,
  loanIsServiceable,
  maskLoanNumber,
  maskMandateReference,
  monthsPerPeriod,
  round2,
  scheduleTotals,
  type CloseLoanInput,
  type EmiFrequency,
  type CreateLoanInput,
  type ImportInstallmentsInput,
  type InstallmentListQuery,
  type InterestType,
  type LoanListQuery,
  type LoanPosition,
  type Paginated,
  type PreviewScheduleInput,
  type RecordLoanPaymentInput,
  type SyncLoanInput,
  type UpdateLoanInput,
  type UpcomingEmiQuery,
  type WaiveInstallmentInput,
} from '@saarthi/shared';
import { type Prisma, prisma, type Db } from '../../database/prisma';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { skipTake } from '../../lib/http';
import { cache } from '../../infra/cache';
import { cacheKeys } from '../../infra/cache-keys';
import { assertTenantAccess } from '../../server/guards';
import { AuditAction, recordAudit } from '../audit/audit.service';
import { notifyOrganization } from '../notifications/notification.service';
import { loanProvider } from '../../providers/loans';
import type { AuthContext } from '../../auth/context';

/**
 * Vehicle finance: loans, EMI schedules and repayments.
 *
 * Saarthi records finance, it does not provide it. Nothing here moves money —
 * a payment row is a note that a payment happened elsewhere. That distinction
 * drives three rules the whole module obeys:
 *
 *   • **Nothing is inferred about someone's debt.** An installment whose state
 *     a lender did not disclose stays UNKNOWN and is excluded from both the
 *     paid and the outstanding totals, with its own count so the gap is
 *     visible rather than averaged away.
 *   • **Settled history is immutable.** Editing loan terms regenerates only the
 *     unpaid tail of the schedule; a paid installment is never rewritten.
 *   • **Identifiers are disclosed by level, not by request.** Masking happens
 *     here, server-side — the full loan number never reaches a browser that is
 *     not entitled to it.
 */

const loanLogger = logger.child({ module: 'loans' });

/** Statuses that mean an installment is still owed. */
const OPEN_INSTALLMENTS: InstallmentStatus[] = [
  InstallmentStatus.UPCOMING,
  InstallmentStatus.DUE_SOON,
  InstallmentStatus.DUE_TODAY,
  InstallmentStatus.OVERDUE,
  InstallmentStatus.PARTIALLY_PAID,
];

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

/** What this caller may see of a loan. Derived from permissions, never input. */
export function loanDisclosureFor(auth: AuthContext): LoanDisclosureLevel {
  if (auth.isPlatformAdmin) return LoanDisclosureLevel.FULL;
  if (hasPermission(auth.permissions, Permission.LOANS_SENSITIVE)) {
    return LoanDisclosureLevel.FULL;
  }
  if (hasPermission(auth.permissions, Permission.LOANS_READ)) {
    return LoanDisclosureLevel.OPERATIONAL;
  }
  return LoanDisclosureLevel.NONE;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface LoanInstallmentView {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  totalDue: number;
  openingBalance: number | null;
  closingBalance: number | null;
  status: InstallmentStatus;
  amountPaid: number;
  penaltyPaid: number;
  outstanding: number;
  paidAt: string | null;
  paymentReference: string | null;
  waivedAt: string | null;
  waiveReason: string | null;
  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
  conflictNote: string | null;
}

export interface LoanPaymentView {
  id: string;
  installmentId: string | null;
  installmentNumber: number | null;
  amount: number;
  penalty: number;
  kind: string;
  method: string;
  paidAt: string;
  reference: string | null;
  notes: string | null;
  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
  reversedAt: string | null;
  reverseReason: string | null;
}

export interface LoanSummary {
  id: string;
  vehicleId: string;
  registrationNumber: string;
  /** Masked below owner level; `loanNumberMasked` says which you are seeing. */
  loanNumber: string | null;
  loanNumberMasked: boolean;
  lenderName: string;
  lenderBranch: string | null;
  borrowerName: string | null;
  loanType: string;
  status: LoanStatus;

  principal: number;
  disbursedAmount: number | null;
  annualRatePercent: number;
  interestType: InterestType;
  tenureMonths: number;
  frequency: EmiFrequency;
  startDate: string;
  endDate: string | null;
  firstDueDate: string;
  emiAmount: number;
  emiFromLender: boolean;

  autoDebitDay: number | null;
  mandateReference: string | null;
  mandateReferenceMasked: boolean;

  outstandingPrincipal: number;
  outstandingInterest: number;
  totalOutstanding: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  unknownInstallments: number;
  nextDueDate: string | null;
  nextDueAmount: number | null;
  completionPercent: number;
  /** True when at least one installment's payment state is unestablished. */
  hasUnknownState: boolean;

  source: FinanceDataSource;
  verificationStatus: FinanceVerificationStatus;
  providerName: string | null;
  lastSyncedAt: string | null;
  remindersEnabled: boolean;
  reminderOffsets: number[];
  notes: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoanDetail extends LoanSummary {
  installments: LoanInstallmentView[];
  payments: LoanPaymentView[];
  scheduleTotals: { installments: number; principal: number; interest: number; total: number };
}

type LoanRow = Prisma.VehicleLoanGetPayload<Record<string, never>>;
type InstallmentRow = Prisma.LoanInstallmentGetPayload<Record<string, never>>;
type PaymentRow = Prisma.LoanPaymentGetPayload<Record<string, never>>;

const num = (value: Prisma.Decimal | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * Present an installment.
 *
 * The stored status is authoritative for the terminal states; the transient
 * ones (UPCOMING → DUE_SOON → DUE_TODAY → OVERDUE) are recomputed on read so a
 * schedule is correct the moment a date rolls over, without waiting for the
 * nightly sweep to catch up.
 */
function toInstallmentView(row: InstallmentRow, now: Date): LoanInstallmentView {
  const totalDue = num(row.totalDue);
  const amountPaid = num(row.amountPaid);
  const status = deriveInstallmentStatus(
    {
      dueDate: row.dueDate,
      totalDue,
      amountPaid,
      explicitStatus: row.status as InstallmentStatus,
    },
    now,
    config.finance.dueSoonDays,
  );

  return {
    id: row.id,
    number: row.number,
    dueDate: dateOnly(row.dueDate),
    principal: num(row.principal),
    interest: num(row.interest),
    totalDue,
    openingBalance: row.openingBalance === null ? null : num(row.openingBalance),
    closingBalance: row.closingBalance === null ? null : num(row.closingBalance),
    status,
    amountPaid,
    penaltyPaid: num(row.penaltyPaid),
    outstanding:
      status === InstallmentStatus.WAIVED || status === InstallmentStatus.UNKNOWN
        ? 0
        : Math.max(0, round2(totalDue - amountPaid)),
    paidAt: row.paidAt?.toISOString() ?? null,
    paymentReference: row.paymentReference,
    waivedAt: row.waivedAt?.toISOString() ?? null,
    waiveReason: row.waiveReason,
    source: row.source as FinanceDataSource,
    verificationStatus: row.verificationStatus as FinanceVerificationStatus,
    conflictNote: row.conflictNote,
  };
}

function toPaymentView(row: PaymentRow, installmentNumbers: Map<string, number>): LoanPaymentView {
  return {
    id: row.id,
    installmentId: row.installmentId,
    installmentNumber: row.installmentId ? (installmentNumbers.get(row.installmentId) ?? null) : null,
    amount: num(row.amount),
    penalty: num(row.penalty),
    kind: row.kind,
    method: row.method,
    paidAt: row.paidAt.toISOString(),
    reference: row.reference,
    notes: row.notes,
    source: row.source as FinanceDataSource,
    verificationStatus: row.verificationStatus as FinanceVerificationStatus,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    reverseReason: row.reverseReason,
  };
}

function toSummary(
  loan: LoanRow,
  registrationNumber: string,
  position: LoanPosition,
  level: LoanDisclosureLevel,
): LoanSummary {
  const loanNumber = maskLoanNumber(loan.loanNumber, level);
  const mandate = maskMandateReference(loan.mandateReference, level);

  return {
    id: loan.id,
    vehicleId: loan.vehicleId,
    registrationNumber,
    loanNumber: loanNumber.value,
    loanNumberMasked: loanNumber.masked,
    lenderName: loan.lenderName,
    lenderBranch: loan.lenderBranch,
    borrowerName: loan.borrowerName,
    loanType: loan.loanType,
    status: loan.status as LoanStatus,

    principal: num(loan.principal),
    disbursedAmount: loan.disbursedAmount === null ? null : num(loan.disbursedAmount),
    annualRatePercent: num(loan.annualRatePercent),
    interestType: loan.interestType as InterestType,
    tenureMonths: loan.tenureMonths,
    frequency: loan.frequency as EmiFrequency,
    startDate: dateOnly(loan.startDate),
    endDate: loan.endDate ? dateOnly(loan.endDate) : null,
    firstDueDate: dateOnly(loan.firstDueDate),
    emiAmount: num(loan.emiAmount),
    emiFromLender: loan.emiFromLender,

    autoDebitDay: loan.autoDebitDay,
    mandateReference: mandate.value,
    mandateReferenceMasked: mandate.masked,

    outstandingPrincipal: position.outstandingPrincipal,
    outstandingInterest: position.outstandingInterest,
    totalOutstanding: position.totalOutstanding,
    paidInstallments: position.paidInstallments,
    remainingInstallments: position.remainingInstallments,
    overdueInstallments: position.overdueInstallments,
    overdueAmount: position.overdueAmount,
    unknownInstallments: position.unknownInstallments,
    nextDueDate: position.nextDueDate ? dateOnly(position.nextDueDate) : null,
    nextDueAmount: position.nextDueAmount,
    completionPercent: position.completionPercent,
    hasUnknownState: position.hasUnknownState,

    source: loan.source as FinanceDataSource,
    verificationStatus: loan.verificationStatus as FinanceVerificationStatus,
    providerName: loan.providerName,
    lastSyncedAt: loan.lastSyncedAt?.toISOString() ?? null,
    remindersEnabled: loan.remindersEnabled,
    reminderOffsets:
      loan.reminderOffsets.length > 0 ? loan.reminderOffsets : config.finance.reminderOffsets,
    notes: loan.notes,
    closedAt: loan.closedAt?.toISOString() ?? null,
    createdAt: loan.createdAt.toISOString(),
    updatedAt: loan.updatedAt.toISOString(),
  };
}

function positionFrom(rows: InstallmentRow[], now: Date): LoanPosition {
  return computeLoanPosition(
    rows.map((row) => ({
      number: row.number,
      dueDate: row.dueDate,
      principal: num(row.principal),
      interest: num(row.interest),
      totalDue: num(row.totalDue),
      amountPaid: num(row.amountPaid),
      status: deriveInstallmentStatus(
        {
          dueDate: row.dueDate,
          totalDue: num(row.totalDue),
          amountPaid: num(row.amountPaid),
          explicitStatus: row.status as InstallmentStatus,
        },
        now,
        config.finance.dueSoonDays,
      ),
    })),
    now,
  );
}

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

/**
 * Financial figures must never be served stale — an operator who has just
 * recorded a payment and still sees "overdue" stops trusting the number.
 */
async function invalidateFinanceCache(organizationId: string, vehicleId?: string): Promise<void> {
  await cache.delete(cacheKeys.fleetLoanSummary(organizationId));
  if (vehicleId) await cache.delete(cacheKeys.vehicleLoanSummary(vehicleId));
}

async function recordLoanEvent(
  db: Db,
  loan: { id: string; organizationId: string },
  eventType: LoanEventType,
  description: string,
  metadata?: Record<string, unknown>,
  actorUserId?: string | null,
): Promise<void> {
  await db.loanEvent.create({
    data: {
      loanId: loan.id,
      organizationId: loan.organizationId,
      eventType,
      description,
      metadata: (metadata ?? undefined) as never,
      actorUserId: actorUserId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

async function loadLoanOr404(auth: AuthContext, loanId: string): Promise<LoanRow> {
  const loan = await prisma.vehicleLoan.findUnique({ where: { id: loanId } });
  if (!loan) throw errors.notFound('Loan');
  assertTenantAccess(auth, loan.organizationId, 'Loan');
  return loan;
}

async function vehicleLabels(vehicleIds: string[]): Promise<Map<string, string>> {
  if (vehicleIds.length === 0) return new Map();
  const vehicles = await prisma.truck.findMany({
    where: { id: { in: [...new Set(vehicleIds)] } },
    select: { id: true, registrationNumber: true },
  });
  return new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));
}

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

interface ScheduleRow {
  loanId: string;
  organizationId: string;
  number: number;
  dueDate: Date;
  principal: number;
  interest: number;
  totalDue: number;
  openingBalance: number;
  closingBalance: number;
  source: FinanceDataSource;
}

function buildScheduleRows(
  loan: {
    id: string;
    organizationId: string;
    principal: number;
    annualRatePercent: number;
    interestType: InterestType;
    tenureMonths: number;
    frequency: EmiFrequency;
    firstDueDate: Date;
  },
  fromNumber = 1,
): ScheduleRow[] {
  return generateSchedule({
    principal: loan.principal,
    annualRatePercent: loan.annualRatePercent,
    interestType: loan.interestType,
    tenureMonths: loan.tenureMonths,
    frequency: loan.frequency,
    firstDueDate: loan.firstDueDate,
  })
    .filter((row) => row.number >= fromNumber)
    .map((row) => ({
      loanId: loan.id,
      organizationId: loan.organizationId,
      number: row.number,
      dueDate: row.dueDate,
      principal: row.principal,
      interest: row.interest,
      totalDue: row.totalDue,
      openingBalance: row.openingBalance,
      closingBalance: row.closingBalance,
      source: FinanceDataSource.CALCULATED,
    }));
}

/** Last installment date implied by the terms. */
function computeEndDate(firstDueDate: Date, tenureMonths: number, frequency: EmiFrequency): Date {
  const count = installmentCount(tenureMonths, frequency);
  return addMonthsClamped(firstDueDate, (count - 1) * monthsPerPeriod(frequency));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface LoanListTotals {
  loans: number;
  activeLoans: number;
  totalOutstanding: number;
  monthlyObligation: number;
  overdueAmount: number;
  overdueLoans: number;
}

export async function listLoans(
  auth: AuthContext,
  organizationId: string,
  query: LoanListQuery,
): Promise<Paginated<LoanSummary> & { totals: LoanListTotals }> {
  const level = loanDisclosureFor(auth);
  if (level === LoanDisclosureLevel.NONE) throw errors.forbidden();

  const where: Prisma.VehicleLoanWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    ...(query.status ? { status: { in: query.status as LoanStatus[] } } : {}),
    ...(query.lender ? { lenderName: { contains: query.lender, mode: 'insensitive' } } : {}),
    ...(query.search
      ? {
          OR: [
            { loanNumber: { contains: query.search, mode: 'insensitive' } },
            { lenderName: { contains: query.search, mode: 'insensitive' } },
            { vehicle: { registrationNumber: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
    /*
     * Installment filters compose through AND rather than as sibling keys.
     *
     * Both of these constrain `installments`, so spreading them into the same
     * object would let the second silently replace the first — a request for
     * "overdue, and due within 7 days" would quietly return everything due in
     * seven days, overdue or not.
     */
    ...(query.overdueOnly || query.dueWithinDays !== undefined
      ? {
          AND: [
            ...(query.overdueOnly
              ? [
                  {
                    installments: {
                      some: { dueDate: { lt: new Date() }, status: { in: OPEN_INSTALLMENTS } },
                    },
                  },
                ]
              : []),
            ...(query.dueWithinDays !== undefined
              ? [
                  {
                    installments: {
                      some: {
                        dueDate: {
                          lte: new Date(Date.now() + query.dueWithinDays * 86_400_000),
                        },
                        status: { in: OPEN_INSTALLMENTS },
                      },
                    },
                  },
                ]
              : []),
          ],
        }
      : {}),
  };

  const [total, loans] = await Promise.all([
    prisma.vehicleLoan.count({ where }),
    prisma.vehicleLoan.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      ...skipTake(query.page, query.pageSize),
      include: { installments: true },
    }),
  ]);

  const now = new Date();
  const labels = await vehicleLabels(loans.map((loan) => loan.vehicleId));

  const items = loans.map((loan) => {
    const { installments, ...row } = loan;
    return toSummary(
      row as LoanRow,
      labels.get(loan.vehicleId) ?? 'Unknown',
      positionFrom(installments, now),
      level,
    );
  });

  const totals = items.reduce<LoanListTotals>(
    (accumulator, loan) => ({
      loans: accumulator.loans + 1,
      activeLoans: accumulator.activeLoans + (loan.status === LoanStatus.ACTIVE ? 1 : 0),
      totalOutstanding: round2(accumulator.totalOutstanding + loan.totalOutstanding),
      monthlyObligation: round2(
        accumulator.monthlyObligation +
          (loanIsServiceable(loan.status)
            ? loan.emiAmount / monthsPerPeriod(loan.frequency)
            : 0),
      ),
      overdueAmount: round2(accumulator.overdueAmount + loan.overdueAmount),
      overdueLoans: accumulator.overdueLoans + (loan.overdueInstallments > 0 ? 1 : 0),
    }),
    {
      loans: 0,
      activeLoans: 0,
      totalOutstanding: 0,
      monthlyObligation: 0,
      overdueAmount: 0,
      overdueLoans: 0,
    },
  );

  return { items, pagination: buildPaginationMeta(query.page, query.pageSize, total), totals };
}

export async function getLoan(auth: AuthContext, loanId: string): Promise<LoanDetail> {
  const level = loanDisclosureFor(auth);
  if (level === LoanDisclosureLevel.NONE) throw errors.forbidden();

  const loan = await loadLoanOr404(auth, loanId);
  const now = new Date();

  const [installments, payments, vehicle] = await Promise.all([
    prisma.loanInstallment.findMany({ where: { loanId }, orderBy: { number: 'asc' } }),
    prisma.loanPayment.findMany({ where: { loanId }, orderBy: { paidAt: 'desc' }, take: 200 }),
    prisma.truck.findUnique({
      where: { id: loan.vehicleId },
      select: { registrationNumber: true },
    }),
  ]);

  const numbers = new Map(installments.map((row) => [row.id, row.number]));
  const summary = toSummary(
    loan,
    vehicle?.registrationNumber ?? 'Unknown',
    positionFrom(installments, now),
    level,
  );

  const views = installments.map((row) => toInstallmentView(row, now));

  return {
    ...summary,
    installments: views,
    payments: payments.map((row) => toPaymentView(row, numbers)),
    scheduleTotals: scheduleTotals(
      views.map((row) => ({
        number: row.number,
        dueDate: new Date(row.dueDate),
        openingBalance: row.openingBalance ?? 0,
        principal: row.principal,
        interest: row.interest,
        totalDue: row.totalDue,
        closingBalance: row.closingBalance ?? 0,
      })),
    ),
  };
}

/** Loans against one vehicle — the Vehicle Passport finance panel. */
export async function vehicleLoans(auth: AuthContext, vehicleId: string): Promise<LoanSummary[]> {
  const level = loanDisclosureFor(auth);
  if (level === LoanDisclosureLevel.NONE) throw errors.forbidden();

  const vehicle = await prisma.truck.findUnique({ where: { id: vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const loans = await prisma.vehicleLoan.findMany({
    where: { vehicleId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { installments: true },
  });

  const now = new Date();
  return loans.map((loan) => {
    const { installments, ...row } = loan;
    return toSummary(
      row as LoanRow,
      vehicle.registrationNumber,
      positionFrom(installments, now),
      level,
    );
  });
}

export interface UpcomingEmi {
  installmentId: string;
  loanId: string;
  vehicleId: string;
  registrationNumber: string;
  lenderName: string;
  number: number;
  dueDate: string;
  totalDue: number;
  amountPaid: number;
  outstanding: number;
  status: InstallmentStatus;
  daysUntilDue: number;
}

/** Installments falling due inside a horizon, overdue ones first. */
export async function upcomingEmis(
  auth: AuthContext,
  organizationId: string,
  query: UpcomingEmiQuery,
): Promise<{ items: UpcomingEmi[]; totalDue: number; overdueAmount: number }> {
  const level = loanDisclosureFor(auth);
  if (level === LoanDisclosureLevel.NONE) throw errors.forbidden();

  const now = new Date();
  const horizon = new Date(now.getTime() + query.days * 86_400_000);

  const rows = await prisma.loanInstallment.findMany({
    where: {
      ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
      ...(query.vehicleId ? { loan: { vehicleId: query.vehicleId } } : {}),
      dueDate: { lte: horizon },
      status: {
        in: query.includeOverdue
          ? OPEN_INSTALLMENTS
          : OPEN_INSTALLMENTS.filter((status) => status !== InstallmentStatus.OVERDUE),
      },
      // A closed or cancelled loan has no obligations left to chase.
      loan: { status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED] } },
    },
    orderBy: { dueDate: 'asc' },
    take: 200,
    include: { loan: { select: { vehicleId: true, lenderName: true } } },
  });

  const labels = await vehicleLabels(rows.map((row) => row.loan.vehicleId));

  const items = rows.map((row) => {
    const view = toInstallmentView(row, now);
    return {
      installmentId: row.id,
      loanId: row.loanId,
      vehicleId: row.loan.vehicleId,
      registrationNumber: labels.get(row.loan.vehicleId) ?? 'Unknown',
      lenderName: row.loan.lenderName,
      number: row.number,
      dueDate: view.dueDate,
      totalDue: view.totalDue,
      amountPaid: view.amountPaid,
      outstanding: view.outstanding,
      status: view.status,
      daysUntilDue: Math.round(
        (Date.UTC(row.dueDate.getUTCFullYear(), row.dueDate.getUTCMonth(), row.dueDate.getUTCDate()) -
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
          86_400_000,
      ),
    };
  });

  return {
    items,
    totalDue: round2(items.reduce((sum, item) => sum + item.outstanding, 0)),
    overdueAmount: round2(
      items
        .filter((item) => item.status === InstallmentStatus.OVERDUE)
        .reduce((sum, item) => sum + item.outstanding, 0),
    ),
  };
}

export async function listInstallments(
  auth: AuthContext,
  organizationId: string,
  query: InstallmentListQuery,
): Promise<Paginated<LoanInstallmentView & { loanId: string; registrationNumber: string }>> {
  const level = loanDisclosureFor(auth);
  if (level === LoanDisclosureLevel.NONE) throw errors.forbidden();

  const where: Prisma.LoanInstallmentWhereInput = {
    ...(auth.isPlatformAdmin && !auth.organizationId ? {} : { organizationId }),
    ...(query.loanId ? { loanId: query.loanId } : {}),
    ...(query.vehicleId ? { loan: { vehicleId: query.vehicleId } } : {}),
    ...(query.status ? { status: { in: query.status as InstallmentStatus[] } } : {}),
    ...(query.from || query.to
      ? {
          dueDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.loanInstallment.count({ where }),
    prisma.loanInstallment.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      ...skipTake(query.page, query.pageSize),
      include: { loan: { select: { vehicleId: true } } },
    }),
  ]);

  const now = new Date();
  const labels = await vehicleLabels(rows.map((row) => row.loan.vehicleId));

  return {
    items: rows.map((row) => ({
      ...toInstallmentView(row, now),
      loanId: row.loanId,
      registrationNumber: labels.get(row.loan.vehicleId) ?? 'Unknown',
    })),
    pagination: buildPaginationMeta(query.page, query.pageSize, total),
  };
}

// ---------------------------------------------------------------------------
// Fleet-level rollup
// ---------------------------------------------------------------------------

export interface FleetLoanSummary {
  activeLoans: number;
  financedVehicles: number;
  totalOutstanding: number;
  monthlyObligation: number;
  dueThisMonth: number;
  overdueInstallments: number;
  overdueAmount: number;
  unknownInstallments: number;
  nextDueDate: string | null;
  /** Vehicles whose next EMI falls inside the reminder window. */
  attention: {
    loanId: string;
    vehicleId: string;
    registrationNumber: string;
    lenderName: string;
    dueDate: string;
    amount: number;
    status: InstallmentStatus;
  }[];
  basis: 'calculated';
}

/**
 * Organization-wide finance position.
 *
 * Cached briefly because the dashboard and the AI brief both ask for it, and
 * invalidated on every write below — a 60-second window on a figure that only
 * changes when someone records a payment is a good trade; a stale one is not.
 */
export async function fleetLoanSummary(
  auth: AuthContext,
  organizationId: string,
): Promise<FleetLoanSummary> {
  const level = loanDisclosureFor(auth);
  if (level === LoanDisclosureLevel.NONE) throw errors.forbidden();

  const key = cacheKeys.fleetLoanSummary(organizationId);
  const hit = await cache.get<FleetLoanSummary>(key);
  if (hit) return hit;

  const now = new Date();
  const endOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
  );

  const loans = await prisma.vehicleLoan.findMany({
    where: { organizationId, status: { in: [LoanStatus.ACTIVE, LoanStatus.DEFAULTED] } },
    include: { installments: true },
  });

  const labels = await vehicleLabels(loans.map((loan) => loan.vehicleId));

  let totalOutstanding = 0;
  let monthlyObligation = 0;
  let dueThisMonth = 0;
  let overdueInstallments = 0;
  let overdueAmount = 0;
  let unknownInstallments = 0;
  let nextDueDate: Date | null = null;
  const attention: FleetLoanSummary['attention'] = [];

  for (const loan of loans) {
    const position = positionFrom(loan.installments, now);
    totalOutstanding = round2(totalOutstanding + position.totalOutstanding);
    monthlyObligation = round2(
      monthlyObligation + num(loan.emiAmount) / monthsPerPeriod(loan.frequency as EmiFrequency),
    );
    overdueInstallments += position.overdueInstallments;
    overdueAmount = round2(overdueAmount + position.overdueAmount);
    unknownInstallments += position.unknownInstallments;

    for (const installment of loan.installments) {
      const view = toInstallmentView(installment, now);
      if (isSettledInstallment(view.status) || view.status === InstallmentStatus.UNKNOWN) continue;
      if (installment.dueDate.getTime() <= endOfMonth.getTime()) {
        dueThisMonth = round2(dueThisMonth + view.outstanding);
      }
      if (
        view.status === InstallmentStatus.OVERDUE ||
        view.status === InstallmentStatus.DUE_TODAY ||
        view.status === InstallmentStatus.DUE_SOON
      ) {
        attention.push({
          loanId: loan.id,
          vehicleId: loan.vehicleId,
          registrationNumber: labels.get(loan.vehicleId) ?? 'Unknown',
          lenderName: loan.lenderName,
          dueDate: view.dueDate,
          amount: view.outstanding,
          status: view.status,
        });
      }
    }

    if (
      position.nextDueDate &&
      (nextDueDate === null || position.nextDueDate.getTime() < nextDueDate.getTime())
    ) {
      nextDueDate = position.nextDueDate;
    }
  }

  attention.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const summary: FleetLoanSummary = {
    activeLoans: loans.length,
    financedVehicles: new Set(loans.map((loan) => loan.vehicleId)).size,
    totalOutstanding,
    monthlyObligation,
    dueThisMonth,
    overdueInstallments,
    overdueAmount,
    unknownInstallments,
    nextDueDate: nextDueDate ? dateOnly(nextDueDate) : null,
    attention: attention.slice(0, 20),
    basis: 'calculated',
  };

  await cache.set(key, summary, 60);
  return summary;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createLoan(
  auth: AuthContext,
  organizationId: string,
  input: CreateLoanInput,
): Promise<LoanDetail> {
  const vehicle = await prisma.truck.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw errors.notFound('Vehicle');
  assertTenantAccess(auth, vehicle.organizationId, 'Vehicle');

  const duplicate = await prisma.vehicleLoan.findFirst({
    where: { organizationId, loanNumber: input.loanNumber },
  });
  if (duplicate) {
    throw errors.duplicate(
      `Loan ${input.loanNumber} is already recorded against ${
        duplicate.vehicleId === vehicle.id ? 'this vehicle' : 'another vehicle'
      }.`,
      { loanId: duplicate.id },
    );
  }

  const firstDueDate = input.firstDueDate ?? addMonthsClamped(input.startDate, 1);
  const computedEmi = calculateEmi({
    principal: input.principal,
    annualRatePercent: input.annualRatePercent,
    interestType: input.interestType as InterestType,
    tenureMonths: input.tenureMonths,
    frequency: input.frequency as EmiFrequency,
    firstDueDate,
  });

  const loan = await prisma.$transaction(async (tx) => {
    const created = await tx.vehicleLoan.create({
      data: {
        organizationId,
        vehicleId: input.vehicleId,
        loanNumber: input.loanNumber,
        lenderName: input.lenderName,
        lenderBranch: input.lenderBranch ?? null,
        borrowerName: input.borrowerName ?? null,
        loanType: input.loanType,
        status: input.status,
        principal: input.principal,
        disbursedAmount: input.disbursedAmount ?? null,
        annualRatePercent: input.annualRatePercent,
        interestType: input.interestType,
        tenureMonths: input.tenureMonths,
        frequency: input.frequency,
        startDate: input.startDate,
        endDate: computeEndDate(firstDueDate, input.tenureMonths, input.frequency as EmiFrequency),
        firstDueDate,
        // The lender's figure wins when given: their rounding is what the bank
        // account will actually show.
        emiAmount: input.emiAmount ?? computedEmi,
        emiFromLender: input.emiAmount !== undefined,
        autoDebitDay: input.autoDebitDay ?? null,
        mandateReference: input.mandateReference ?? null,
        accountNumber: input.accountNumber ?? null,
        reminderOffsets: input.reminderOffsets ?? [],
        notes: input.notes ?? null,
        source: FinanceDataSource.MANUAL,
        verificationStatus: FinanceVerificationStatus.UNVERIFIED,
        createdById: auth.user.id,
      },
    });

    if (input.generateSchedule && input.status !== LoanStatus.DRAFT) {
      const rows = buildScheduleRows({
        id: created.id,
        organizationId,
        principal: input.principal,
        annualRatePercent: input.annualRatePercent,
        interestType: input.interestType as InterestType,
        tenureMonths: input.tenureMonths,
        frequency: input.frequency as EmiFrequency,
        firstDueDate,
      });
      await tx.loanInstallment.createMany({ data: rows });
      await recordLoanEvent(
        tx,
        created,
        LoanEventType.SCHEDULE_GENERATED,
        `Generated ${rows.length} installments from the recorded terms.`,
        { installments: rows.length, emi: input.emiAmount ?? computedEmi },
        auth.user.id,
      );
    }

    await recordLoanEvent(
      tx,
      created,
      LoanEventType.CREATED,
      `Loan recorded against ${vehicle.registrationNumber}.`,
      { lender: input.lenderName, principal: input.principal },
      auth.user.id,
    );

    return created;
  });

  await invalidateFinanceCache(organizationId, input.vehicleId);
  await recordAudit({
    action: AuditAction.LOAN_CREATED,
    entityType: 'VehicleLoan',
    entityId: loan.id,
    actorUserId: auth.user.id,
    organizationId,
    after: { loanNumber: loan.loanNumber, lender: loan.lenderName, principal: input.principal },
  });

  loanLogger.info(
    { loanId: loan.id, vehicleId: input.vehicleId, organizationId },
    'Vehicle loan recorded',
  );

  return getLoan(auth, loan.id);
}

export async function updateLoan(
  auth: AuthContext,
  loanId: string,
  input: UpdateLoanInput,
): Promise<LoanDetail> {
  const loan = await loadLoanOr404(auth, loanId);

  const termsChanged =
    (input.annualRatePercent !== undefined &&
      input.annualRatePercent !== num(loan.annualRatePercent)) ||
    (input.interestType !== undefined && input.interestType !== loan.interestType) ||
    (input.tenureMonths !== undefined && input.tenureMonths !== loan.tenureMonths) ||
    (input.frequency !== undefined && input.frequency !== loan.frequency);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.vehicleLoan.update({
      where: { id: loanId },
      data: {
        ...(input.lenderName !== undefined ? { lenderName: input.lenderName } : {}),
        ...(input.lenderBranch !== undefined ? { lenderBranch: input.lenderBranch } : {}),
        ...(input.borrowerName !== undefined ? { borrowerName: input.borrowerName } : {}),
        ...(input.loanType !== undefined ? { loanType: input.loanType } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.annualRatePercent !== undefined
          ? { annualRatePercent: input.annualRatePercent }
          : {}),
        ...(input.interestType !== undefined ? { interestType: input.interestType } : {}),
        ...(input.tenureMonths !== undefined ? { tenureMonths: input.tenureMonths } : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.emiAmount !== undefined
          ? { emiAmount: input.emiAmount, emiFromLender: true }
          : {}),
        ...(input.autoDebitDay !== undefined ? { autoDebitDay: input.autoDebitDay } : {}),
        ...(input.mandateReference !== undefined
          ? { mandateReference: input.mandateReference }
          : {}),
        ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
        ...(input.reminderOffsets !== undefined ? { reminderOffsets: input.reminderOffsets } : {}),
        ...(input.remindersEnabled !== undefined
          ? { remindersEnabled: input.remindersEnabled }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (input.status !== undefined && input.status !== loan.status) {
      await recordLoanEvent(
        tx,
        updated,
        LoanEventType.STATUS_CHANGED,
        `Status changed from ${loan.status} to ${input.status}.`,
        undefined,
        auth.user.id,
      );
    }

    if (termsChanged) {
      // Only the unpaid tail is rebuilt. Rewriting a settled installment would
      // falsify a payment that actually happened.
      const settled = await tx.loanInstallment.findMany({
        where: {
          loanId,
          OR: [
            { status: InstallmentStatus.PAID },
            { status: InstallmentStatus.WAIVED },
            { status: InstallmentStatus.PARTIALLY_PAID },
            { amountPaid: { gt: 0 } },
          ],
        },
        orderBy: { number: 'desc' },
        take: 1,
      });

      const resumeFrom = (settled[0]?.number ?? 0) + 1;
      await tx.loanInstallment.deleteMany({ where: { loanId, number: { gte: resumeFrom } } });

      const rows = buildScheduleRows(
        {
          id: loanId,
          organizationId: loan.organizationId,
          principal: num(updated.principal),
          annualRatePercent: num(updated.annualRatePercent),
          interestType: updated.interestType as InterestType,
          tenureMonths: updated.tenureMonths,
          frequency: updated.frequency as EmiFrequency,
          firstDueDate: updated.firstDueDate,
        },
        resumeFrom,
      );
      if (rows.length > 0) await tx.loanInstallment.createMany({ data: rows });

      await tx.vehicleLoan.update({
        where: { id: loanId },
        data: {
          endDate: computeEndDate(
            updated.firstDueDate,
            updated.tenureMonths,
            updated.frequency as EmiFrequency,
          ),
          ...(input.emiAmount === undefined
            ? {
                emiAmount: calculateEmi({
                  principal: num(updated.principal),
                  annualRatePercent: num(updated.annualRatePercent),
                  interestType: updated.interestType as InterestType,
                  tenureMonths: updated.tenureMonths,
                  frequency: updated.frequency as EmiFrequency,
                  firstDueDate: updated.firstDueDate,
                }),
                emiFromLender: false,
              }
            : {}),
        },
      });

      await recordLoanEvent(
        tx,
        updated,
        LoanEventType.SCHEDULE_REGENERATED,
        `Terms changed — regenerated ${rows.length} unpaid installments from #${resumeFrom}. Settled installments were left untouched.`,
        { resumeFrom, regenerated: rows.length },
        auth.user.id,
      );
    } else {
      await recordLoanEvent(
        tx,
        updated,
        LoanEventType.UPDATED,
        'Loan details updated.',
        undefined,
        auth.user.id,
      );
    }
  });

  await invalidateFinanceCache(loan.organizationId, loan.vehicleId);
  await recordAudit({
    action: AuditAction.LOAN_UPDATED,
    entityType: 'VehicleLoan',
    entityId: loanId,
    actorUserId: auth.user.id,
    organizationId: loan.organizationId,
    before: { status: loan.status, rate: num(loan.annualRatePercent) },
    after: { ...input },
  });

  return getLoan(auth, loanId);
}

export async function closeLoan(
  auth: AuthContext,
  loanId: string,
  input: CloseLoanInput,
): Promise<LoanDetail> {
  const loan = await loadLoanOr404(auth, loanId);
  if (loan.closedAt) throw errors.conflict('This loan is already closed.');

  const closedAt = input.closedAt ?? new Date();

  await prisma.$transaction(async (tx) => {
    if (input.settlementAmount !== undefined && input.settlementAmount > 0) {
      await tx.loanPayment.create({
        data: {
          loanId,
          organizationId: loan.organizationId,
          amount: input.settlementAmount,
          kind: input.status === LoanStatus.FORECLOSED ? 'FORECLOSURE' : 'INSTALLMENT',
          method: 'BANK_TRANSFER',
          paidAt: closedAt,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          source: FinanceDataSource.MANUAL,
          recordedById: auth.user.id,
        },
      });
    }

    // Outstanding rows are marked WAIVED rather than PAID: the facility ended,
    // which is not the same as each installment having been collected.
    await tx.loanInstallment.updateMany({
      where: {
        loanId,
        status: { in: OPEN_INSTALLMENTS },
      },
      data: {
        status: InstallmentStatus.WAIVED,
        waivedAt: closedAt,
        waivedById: auth.user.id,
        waiveReason: `Loan ${input.status.toLowerCase()} on ${dateOnly(closedAt)}.`,
      },
    });

    await tx.vehicleLoan.update({
      where: { id: loanId },
      data: {
        status: input.status,
        closedAt,
        closeReason: input.notes ?? null,
      },
    });

    await recordLoanEvent(
      tx,
      loan,
      LoanEventType.CLOSED,
      `Loan ${input.status.toLowerCase()}.`,
      { settlementAmount: input.settlementAmount ?? null, reference: input.reference ?? null },
      auth.user.id,
    );
  });

  await invalidateFinanceCache(loan.organizationId, loan.vehicleId);
  await notifyOrganization(loan.organizationId, {
    type: NotificationType.LOAN_CLOSED,
    title: 'Vehicle loan closed',
    body: `${loan.lenderName} — loan closed (${input.status.toLowerCase()}).`,
    priority: NotificationPriority.NORMAL,
    actionUrl: `/fleet/loans/${loanId}`,
    roles: ['FLEET_OWNER'],
  });

  await recordAudit({
    action: AuditAction.LOAN_CLOSED,
    entityType: 'VehicleLoan',
    entityId: loanId,
    actorUserId: auth.user.id,
    organizationId: loan.organizationId,
    after: { status: input.status, closedAt: closedAt.toISOString() },
  });

  return getLoan(auth, loanId);
}

export async function recordPayment(
  auth: AuthContext,
  loanId: string,
  input: RecordLoanPaymentInput,
): Promise<LoanDetail> {
  const loan = await loadLoanOr404(auth, loanId);
  const paidAt = input.paidAt ?? new Date();

  let installment: InstallmentRow | null = null;
  if (input.installmentId) {
    installment = await prisma.loanInstallment.findUnique({ where: { id: input.installmentId } });
    if (!installment || installment.loanId !== loanId) {
      throw errors.notFound('Installment');
    }
    if (installment.status === InstallmentStatus.WAIVED) {
      throw errors.conflict('This installment was waived and cannot take a payment.');
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.loanPayment.create({
      data: {
        loanId,
        installmentId: installment?.id ?? null,
        organizationId: loan.organizationId,
        amount: input.amount,
        penalty: input.penalty ?? 0,
        kind: input.kind,
        method: input.method,
        paidAt,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        source: FinanceDataSource.MANUAL,
        verificationStatus: FinanceVerificationStatus.UNVERIFIED,
        recordedById: auth.user.id,
      },
    });

    if (installment) {
      const paid = round2(num(installment.amountPaid) + input.amount);
      const due = num(installment.totalDue);
      const settled = paid >= due - 1;

      await tx.loanInstallment.update({
        where: { id: installment.id },
        data: {
          amountPaid: paid,
          penaltyPaid: round2(num(installment.penaltyPaid) + (input.penalty ?? 0)),
          status: settled ? InstallmentStatus.PAID : InstallmentStatus.PARTIALLY_PAID,
          paidAt: settled ? paidAt : installment.paidAt,
          paymentReference: input.reference ?? installment.paymentReference,
          // A payment the operator entered themselves is a first-hand record.
          source: FinanceDataSource.MANUAL,
          verificationStatus: FinanceVerificationStatus.UNVERIFIED,
        },
      });
    }

    await recordLoanEvent(
      tx,
      loan,
      LoanEventType.PAYMENT_RECORDED,
      installment
        ? `Payment recorded against installment #${installment.number}.`
        : 'Payment recorded against the loan.',
      { amount: input.amount, method: input.method, kind: input.kind },
      auth.user.id,
    );
  });

  await invalidateFinanceCache(loan.organizationId, loan.vehicleId);
  await recordAudit({
    action: AuditAction.LOAN_PAYMENT_RECORDED,
    entityType: 'VehicleLoan',
    entityId: loanId,
    actorUserId: auth.user.id,
    organizationId: loan.organizationId,
    after: { amount: input.amount, installmentId: input.installmentId ?? null },
  });

  return getLoan(auth, loanId);
}

export async function waiveInstallment(
  auth: AuthContext,
  installmentId: string,
  input: WaiveInstallmentInput,
): Promise<LoanDetail> {
  const installment = await prisma.loanInstallment.findUnique({ where: { id: installmentId } });
  if (!installment) throw errors.notFound('Installment');
  assertTenantAccess(auth, installment.organizationId, 'Installment');
  if (installment.status === InstallmentStatus.PAID) {
    throw errors.conflict('A settled installment cannot be waived.');
  }

  const loan = await loadLoanOr404(auth, installment.loanId);

  await prisma.$transaction(async (tx) => {
    await tx.loanInstallment.update({
      where: { id: installmentId },
      data: {
        status: InstallmentStatus.WAIVED,
        waivedAt: new Date(),
        waivedById: auth.user.id,
        waiveReason: input.reason,
      },
    });
    await recordLoanEvent(
      tx,
      loan,
      LoanEventType.INSTALLMENT_WAIVED,
      `Installment #${installment.number} waived: ${input.reason}`,
      { installmentId, number: installment.number },
      auth.user.id,
    );
  });

  await invalidateFinanceCache(loan.organizationId, loan.vehicleId);
  return getLoan(auth, loan.id);
}

// ---------------------------------------------------------------------------
// Schedule preview
// ---------------------------------------------------------------------------

export interface SchedulePreview {
  emiAmount: number;
  installments: {
    number: number;
    dueDate: string;
    principal: number;
    interest: number;
    totalDue: number;
    closingBalance: number;
  }[];
  totals: { installments: number; principal: number; interest: number; total: number };
  basis: 'calculated';
}

/** Amortisation preview, before any record exists. Pure arithmetic, no writes. */
export function previewSchedule(input: PreviewScheduleInput): SchedulePreview {
  const terms = {
    principal: input.principal,
    annualRatePercent: input.annualRatePercent,
    interestType: input.interestType as InterestType,
    tenureMonths: input.tenureMonths,
    frequency: input.frequency as EmiFrequency,
    firstDueDate: input.firstDueDate,
  };
  const rows = generateSchedule(terms);

  return {
    emiAmount: calculateEmi(terms),
    installments: rows.map((row) => ({
      number: row.number,
      dueDate: dateOnly(row.dueDate),
      principal: row.principal,
      interest: row.interest,
      totalDue: row.totalDue,
      closingBalance: row.closingBalance,
    })),
    totals: scheduleTotals(rows),
    basis: 'calculated',
  };
}

// ---------------------------------------------------------------------------
// Provider sync and import
// ---------------------------------------------------------------------------

export interface LoanSyncDifference {
  field: string;
  saarthi: string | number | null;
  provider: string | number | null;
}

export interface LoanSyncResult {
  provider: string;
  retrievedAt: string;
  simulated: boolean;
  applied: boolean;
  differences: LoanSyncDifference[];
  installmentsReported: number;
  undisclosedInstallments: number;
}

/**
 * Reconcile against a finance provider.
 *
 * Differences are *reported* by default and only written when the caller opts
 * in. A provider's number is an assertion, not a correction — and when the two
 * disagree the loan is marked CONFLICT so a human decides, rather than the last
 * writer silently winning.
 */
export async function syncLoan(
  auth: AuthContext,
  loanId: string,
  input: SyncLoanInput,
): Promise<LoanSyncResult> {
  const loan = await loadLoanOr404(auth, loanId);

  if (!loanProvider.supportsRetrieval) {
    throw errors.providerNotConfigured('loans', loanProvider.retrievalUnavailableReason);
  }

  let statement;
  try {
    statement = await loanProvider.fetchStatement({
      loanNumber: loan.loanNumber,
      lenderName: loan.lenderName,
      consentReference: input.consentReference ?? null,
      known: {
        principal: num(loan.principal),
        annualRatePercent: num(loan.annualRatePercent),
        interestType: loan.interestType as InterestType,
        tenureMonths: loan.tenureMonths,
        frequency: loan.frequency as EmiFrequency,
        firstDueDate: loan.firstDueDate,
        emiAmount: num(loan.emiAmount),
      },
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.vehicleLoan.update({
        where: { id: loanId },
        data: { lastSyncError: error instanceof Error ? error.message : 'Sync failed.' },
      });
      await recordLoanEvent(
        tx,
        loan,
        LoanEventType.PROVIDER_SYNC_FAILED,
        'Provider sync failed.',
        { provider: loanProvider.name },
        auth.user.id,
      );
    });
    throw error;
  }

  const differences: LoanSyncDifference[] = [];
  const compare = (
    field: string,
    ours: number | string | null,
    theirs: number | string | null,
  ): void => {
    if (theirs === null || theirs === undefined) return;
    const same =
      typeof ours === 'number' && typeof theirs === 'number'
        ? Math.abs(ours - theirs) < 1
        : ours === theirs;
    if (!same) differences.push({ field, saarthi: ours, provider: theirs });
  };

  compare('emiAmount', num(loan.emiAmount), statement.emiAmount);
  compare('principal', num(loan.principal), statement.principal);
  compare('annualRatePercent', num(loan.annualRatePercent), statement.annualRatePercent);
  compare('tenureMonths', loan.tenureMonths, statement.tenureMonths);
  compare('status', loan.status, statement.status);

  const undisclosed = statement.installments.filter(
    (row) => row.status === undefined && row.amountPaid === undefined,
  ).length;

  const applied = input.apply;

  await prisma.$transaction(async (tx) => {
    await tx.vehicleLoan.update({
      where: { id: loanId },
      data: {
        providerName: statement.provider,
        providerReference: statement.providerReference,
        lastSyncedAt: new Date(statement.retrievedAt),
        lastSyncError: null,
        ...(applied
          ? {
              ...(statement.emiAmount !== null
                ? { emiAmount: statement.emiAmount, emiFromLender: true }
                : {}),
              // A statement is an external assertion. It never lands as VERIFIED,
              // and a disagreement is surfaced rather than resolved silently.
              source: statement.simulated
                ? FinanceDataSource.SIMULATED
                : FinanceDataSource.PROVIDER_SYNC,
              verificationStatus:
                differences.length > 0
                  ? FinanceVerificationStatus.CONFLICT
                  : FinanceVerificationStatus.PROVIDER_REPORTED,
            }
          : differences.length > 0
            ? { verificationStatus: FinanceVerificationStatus.CONFLICT }
            : {}),
      },
    });

    if (applied) {
      for (const row of statement.installments) {
        const undisclosedRow = row.status === undefined && row.amountPaid === undefined;
        await tx.loanInstallment.updateMany({
          where: {
            loanId,
            number: row.number,
            // Never overwrite a settlement Saarthi already recorded first-hand.
            status: { notIn: [InstallmentStatus.PAID, InstallmentStatus.WAIVED] },
          },
          data: {
            status: undisclosedRow
              ? InstallmentStatus.UNKNOWN
              : (row.status as InstallmentStatus | undefined),
            ...(row.amountPaid !== undefined ? { amountPaid: row.amountPaid } : {}),
            ...(row.paidAt ? { paidAt: new Date(row.paidAt) } : {}),
            ...(row.paymentReference ? { paymentReference: row.paymentReference } : {}),
            source: statement.simulated
              ? FinanceDataSource.SIMULATED
              : FinanceDataSource.PROVIDER_SYNC,
            verificationStatus: FinanceVerificationStatus.PROVIDER_REPORTED,
            ...(undisclosedRow
              ? { conflictNote: 'The lender statement did not disclose a payment state.' }
              : {}),
          },
        });
      }
    }

    await recordLoanEvent(
      tx,
      loan,
      applied ? LoanEventType.PROVIDER_SYNCED : LoanEventType.CONFLICT_RAISED,
      applied
        ? `Applied ${statement.provider} statement (${statement.installments.length} installments).`
        : `Compared against ${statement.provider}: ${differences.length} difference(s).`,
      { differences, simulated: statement.simulated },
      auth.user.id,
    );
  });

  if (differences.length > 0) {
    await notifyOrganization(loan.organizationId, {
      type: NotificationType.LOAN_SYNC_CONFLICT,
      title: 'Lender statement differs from your records',
      body: `${loan.lenderName}: ${differences.map((d) => d.field).join(', ')} differ. Review before relying on either figure.`,
      priority: NotificationPriority.HIGH,
      actionUrl: `/fleet/loans/${loanId}`,
      roles: ['FLEET_OWNER'],
    });
  }

  await invalidateFinanceCache(loan.organizationId, loan.vehicleId);

  return {
    provider: statement.provider,
    retrievedAt: statement.retrievedAt,
    simulated: statement.simulated,
    applied,
    differences,
    installmentsReported: statement.installments.length,
    undisclosedInstallments: undisclosed,
  };
}

/** Replace or add schedule rows from a statement the operator supplied. */
export async function importInstallments(
  auth: AuthContext,
  loanId: string,
  input: ImportInstallmentsInput,
): Promise<LoanDetail> {
  const loan = await loadLoanOr404(auth, loanId);

  await prisma.$transaction(async (tx) => {
    if (input.replaceUnpaid) {
      await tx.loanInstallment.deleteMany({
        where: {
          loanId,
          status: {
            in: [
              InstallmentStatus.UPCOMING,
              InstallmentStatus.DUE_SOON,
              InstallmentStatus.DUE_TODAY,
              InstallmentStatus.OVERDUE,
              InstallmentStatus.UNKNOWN,
            ],
          },
          amountPaid: 0,
        },
      });
    }

    for (const row of input.installments) {
      const undisclosed = row.status === undefined && row.amountPaid === undefined;
      const data = {
        loanId,
        organizationId: loan.organizationId,
        number: row.number,
        dueDate: row.dueDate,
        principal: row.principal,
        interest: row.interest,
        totalDue: row.totalDue,
        status: undisclosed
          ? InstallmentStatus.UNKNOWN
          : ((row.status ?? InstallmentStatus.UPCOMING) as InstallmentStatus),
        amountPaid: row.amountPaid ?? 0,
        paidAt: row.paidAt ?? null,
        paymentReference: row.paymentReference ?? null,
        source: input.source as FinanceDataSource,
        // Imported and AI-extracted rows are drafts until a human confirms them.
        verificationStatus:
          input.source === 'DOCUMENT_EXTRACTION'
            ? FinanceVerificationStatus.PENDING_REVIEW
            : FinanceVerificationStatus.UNVERIFIED,
      };

      const existing = await tx.loanInstallment.findUnique({
        where: { loanId_number: { loanId, number: row.number } },
      });

      if (!existing) {
        await tx.loanInstallment.create({ data });
        continue;
      }

      // A settlement Saarthi recorded first-hand outranks an imported row: the
      // operator watched that money leave their account, the statement is a
      // second-hand summary. The amounts and dates still update, only the
      // payment state is protected.
      const settledLocally =
        existing.status === InstallmentStatus.PAID ||
        existing.status === InstallmentStatus.WAIVED ||
        num(existing.amountPaid) > 0;

      await tx.loanInstallment.update({
        where: { id: existing.id },
        data: settledLocally
          ? {
              dueDate: data.dueDate,
              principal: data.principal,
              interest: data.interest,
              totalDue: data.totalDue,
              conflictNote:
                data.status !== existing.status
                  ? `The imported statement reported this installment as ${data.status.toLowerCase()}; your own record of it was kept.`
                  : null,
            }
          : data,
      });
    }

    await recordLoanEvent(
      tx,
      loan,
      LoanEventType.SCHEDULE_REGENERATED,
      `Imported ${input.installments.length} installments from ${input.source.toLowerCase().replace('_', ' ')}.`,
      { source: input.source, provider: input.providerName ?? null },
      auth.user.id,
    );
  });

  await invalidateFinanceCache(loan.organizationId, loan.vehicleId);
  return getLoan(auth, loanId);
}

export async function loanEvents(auth: AuthContext, loanId: string) {
  const loan = await loadLoanOr404(auth, loanId);
  const events = await prisma.loanEvent.findMany({
    where: { loanId: loan.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    description: event.description,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  }));
}
