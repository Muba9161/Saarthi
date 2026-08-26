import { z } from 'zod';
import { Feature, InstallmentStatus, Permission, formatCurrency } from '@saarthi/shared';
import { prisma } from '../../../database/prisma';
import { getLoan, upcomingEmis, vehicleLoans } from '../../loans/loan.service';
import { ResultBasis, type AiTool, type ToolResult } from './tool.types';

/**
 * Loan and EMI tools.
 *
 * Two rules apply harder here than anywhere else in the registry.
 *
 * **Authorisation is not negotiable.** Every one of these requires
 * `LOANS_READ`, which sits with the fleet owner. A dispatcher asking the
 * assistant "how much do we owe on UP32 AB 1234" is told they cannot see it,
 * not given a number.
 *
 * **Unknown stays unknown.** The loan service excludes installments with no
 * confirmed payment state from every total, and these tools carry that gap
 * forward as a caveat rather than letting the model quietly round it away.
 * A total presented as complete when it is not is how someone under-provisions
 * for a payment and loses a truck.
 */

function result<T>(
  data: T,
  options: {
    basis?: ResultBasis;
    references?: ToolResult['references'];
    caveats?: string[];
    recordCount?: number;
  } = {},
): ToolResult<T> {
  return {
    data,
    basis: options.basis ?? ResultBasis.RULE_RESULT,
    references: options.references ?? [],
    caveats: options.caveats ?? [],
    recordCount: options.recordCount ?? 0,
  };
}

/** Financial figures get the shortest cache window in the registry. */
const FINANCE_CACHE_SECONDS = 20;

export const FINANCE_TOOLS: AiTool[] = [
  {
    name: 'get_vehicle_loan_summary',
    description:
      'Finance recorded against one vehicle: lender, EMI, outstanding balance, next due date and how much of the schedule is repaid.',
    input: z.object({ vehicleId: z.string().uuid() }),
    permissions: [Permission.LOANS_READ],
    feature: Feature.FINANCE_LOANS,
    category: 'finance',
    cacheTtlSeconds: FINANCE_CACHE_SECONDS,
    handler: async ({ auth }, input) => {
      const { vehicleId } = input as { vehicleId: string };
      const loans = await vehicleLoans(auth, vehicleId);

      if (loans.length === 0) {
        return result(
          { financed: false, loans: [] },
          {
            recordCount: 0,
            caveats: [
              'No finance is recorded against this vehicle in Saarthi. That is not proof the vehicle is unfinanced — only that nothing was entered.',
            ],
          },
        );
      }

      const unknown = loans.reduce((sum, loan) => sum + loan.unknownInstallments, 0);

      return result(
        {
          financed: true,
          loans: loans.map((loan) => ({
            loanId: loan.id,
            lender: loan.lenderName,
            status: loan.status,
            emiAmount: loan.emiAmount,
            frequency: loan.frequency,
            outstandingPrincipal: loan.outstandingPrincipal,
            totalOutstanding: loan.totalOutstanding,
            nextDueDate: loan.nextDueDate,
            nextDueAmount: loan.nextDueAmount,
            paidInstallments: loan.paidInstallments,
            remainingInstallments: loan.remainingInstallments,
            overdueInstallments: loan.overdueInstallments,
            overdueAmount: loan.overdueAmount,
            completionPercent: loan.completionPercent,
          })),
        },
        {
          recordCount: loans.length,
          references: loans.map((loan) => ({
            type: 'loan',
            id: loan.id,
            label: `${loan.lenderName} — ${loan.registrationNumber}`,
          })),
          caveats:
            unknown > 0
              ? [
                  `${unknown} installment(s) have no confirmed payment state and are excluded from these totals, which are therefore a floor rather than the full figure.`,
                ]
              : [],
        },
      );
    },
  },

  {
    name: 'get_upcoming_loan_emis',
    description:
      'Installments falling due across the fleet inside a horizon, overdue ones first, with the amount still outstanding on each.',
    input: z.object({
      days: z.number().int().min(1).max(365).default(30).describe('Horizon in days.'),
      vehicleId: z.string().uuid().optional().describe('Restrict to one vehicle.'),
    }),
    permissions: [Permission.LOANS_READ],
    feature: Feature.FINANCE_LOANS,
    category: 'finance',
    cacheTtlSeconds: FINANCE_CACHE_SECONDS,
    handler: async ({ auth, organizationId }, input) => {
      const { days, vehicleId } = input as { days: number; vehicleId?: string };
      const upcoming = await upcomingEmis(auth, organizationId, {
        days,
        includeOverdue: true,
        ...(vehicleId ? { vehicleId } : {}),
      });

      return result(
        {
          horizonDays: days,
          totalDue: upcoming.totalDue,
          overdueAmount: upcoming.overdueAmount,
          installments: upcoming.items.map((item) => ({
            registrationNumber: item.registrationNumber,
            lender: item.lenderName,
            number: item.number,
            dueDate: item.dueDate,
            outstanding: item.outstanding,
            status: item.status,
            daysUntilDue: item.daysUntilDue,
          })),
        },
        {
          recordCount: upcoming.items.length,
          references: upcoming.items.slice(0, 10).map((item) => ({
            type: 'loan',
            id: item.loanId,
            label: `${item.registrationNumber} #${item.number}`,
          })),
        },
      );
    },
  },

  {
    name: 'get_overdue_loan_payments',
    description: 'Installments that have passed their due date and are not settled.',
    input: z.object({}),
    permissions: [Permission.LOANS_READ],
    feature: Feature.FINANCE_LOANS,
    category: 'finance',
    cacheTtlSeconds: FINANCE_CACHE_SECONDS,
    handler: async ({ organizationId }) => {
      const overdue = await prisma.loanInstallment.findMany({
        where: {
          organizationId,
          status: InstallmentStatus.OVERDUE,
          loan: { status: { in: ['ACTIVE', 'DEFAULTED'] } },
        },
        orderBy: { dueDate: 'asc' },
        take: 100,
        include: {
          loan: { select: { id: true, lenderName: true, vehicleId: true } },
        },
      });

      const vehicles = await prisma.truck.findMany({
        where: { id: { in: [...new Set(overdue.map((row) => row.loan.vehicleId))] } },
        select: { id: true, registrationNumber: true },
      });
      const labels = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.registrationNumber]));

      const items = overdue.map((row) => ({
        registrationNumber: labels.get(row.loan.vehicleId) ?? 'Unknown',
        lender: row.loan.lenderName,
        number: row.number,
        dueDate: row.dueDate.toISOString().slice(0, 10),
        outstanding: Number(row.totalDue) - Number(row.amountPaid),
        daysOverdue: Math.round((Date.now() - row.dueDate.getTime()) / 86_400_000),
      }));

      return result(
        {
          count: items.length,
          totalOverdue: Number(
            items.reduce((sum, item) => sum + item.outstanding, 0).toFixed(2),
          ),
          installments: items,
        },
        { recordCount: items.length },
      );
    },
  },

  {
    name: 'get_monthly_loan_obligations',
    description:
      'Total EMI commitment per month across the fleet, and how it is split between lenders.',
    input: z.object({}),
    permissions: [Permission.LOANS_READ],
    feature: Feature.FINANCE_LOANS,
    category: 'finance',
    cacheTtlSeconds: FINANCE_CACHE_SECONDS,
    handler: async ({ organizationId }) => {
      const loans = await prisma.vehicleLoan.findMany({
        where: { organizationId, status: { in: ['ACTIVE', 'DEFAULTED'] } },
        select: {
          id: true,
          lenderName: true,
          emiAmount: true,
          frequency: true,
          vehicleId: true,
        },
      });

      const monthlyFor = (emi: number, frequency: string): number => {
        const months = frequency === 'QUARTERLY' ? 3 : frequency === 'HALF_YEARLY' ? 6 : frequency === 'ANNUAL' ? 12 : 1;
        return emi / months;
      };

      const byLender = new Map<string, number>();
      let total = 0;

      for (const loan of loans) {
        const monthly = monthlyFor(Number(loan.emiAmount), loan.frequency);
        total += monthly;
        byLender.set(loan.lenderName, (byLender.get(loan.lenderName) ?? 0) + monthly);
      }

      return result(
        {
          activeLoans: loans.length,
          monthlyObligation: Number(total.toFixed(2)),
          monthlyObligationFormatted: formatCurrency(total),
          byLender: Object.fromEntries(
            [...byLender].map(([lender, amount]) => [lender, Number(amount.toFixed(2))]),
          ),
        },
        {
          recordCount: loans.length,
          caveats: [
            'Quarterly, half-yearly and annual installments are divided down to a monthly equivalent, so this is an average commitment rather than what leaves the account each month.',
          ],
        },
      );
    },
  },

  {
    name: 'get_loan_payment_history',
    description: 'Payments recorded against one loan, most recent first.',
    input: z.object({ loanId: z.string().uuid() }),
    permissions: [Permission.LOANS_READ],
    feature: Feature.FINANCE_LOANS,
    category: 'finance',
    cacheTtlSeconds: FINANCE_CACHE_SECONDS,
    handler: async ({ auth }, input) => {
      const { loanId } = input as { loanId: string };
      const loan = await getLoan(auth, loanId);

      return result(
        {
          lender: loan.lenderName,
          registrationNumber: loan.registrationNumber,
          totalOutstanding: loan.totalOutstanding,
          payments: loan.payments.slice(0, 50).map((payment) => ({
            paidAt: payment.paidAt,
            amount: payment.amount,
            method: payment.method,
            installmentNumber: payment.installmentNumber,
            reference: payment.reference,
            reversed: payment.reversedAt !== null,
          })),
        },
        {
          basis: ResultBasis.SOURCE_DATA,
          recordCount: loan.payments.length,
          references: [
            { type: 'loan', id: loan.id, label: `${loan.lenderName} — ${loan.registrationNumber}` },
          ],
          caveats: [
            'These are payments recorded in Saarthi. A payment made and not recorded will not appear here.',
          ],
        },
      );
    },
  },
];
