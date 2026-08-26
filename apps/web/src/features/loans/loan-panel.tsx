import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRight, Banknote } from 'lucide-react';
import {
  Feature,
  InstallmentStatus,
  Permission,
  formatCurrency,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { LoanSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { AddLoanDialog } from './add-loan-dialog';
import {
  LoanStatusBadge,
  MaskedValue,
  SourceBadge,
  formatDueDate,
} from './loan-formatting';

/**
 * Vehicle Passport → Loan & Finance.
 *
 * This panel answers one question the owner of a financed truck asks constantly:
 * *what do I owe on this vehicle, and when is the next payment?* Everything
 * else — the full schedule, the payment ledger, lender reconciliation — lives on
 * the loan page and is one click away.
 *
 * The panel renders nothing at all for a caller without `LOANS_READ`, and the
 * API refuses the same request independently, so a manager cannot reach a
 * vehicle's finance by guessing the URL.
 */

interface LoanPanelProps {
  vehicleId: string;
  registrationNumber: string;
}

export function LoanPanel({ vehicleId, registrationNumber }: LoanPanelProps): React.ReactElement | null {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();

  const canRead = can(Permission.LOANS_READ) && hasFeature(Feature.FINANCE_LOANS);
  const canManage = can(Permission.LOANS_MANAGE);

  const loans = useQuery({
    queryKey: ['vehicle-loans', vehicleId],
    queryFn: () => api.get<LoanSummary[]>(`/fleet/vehicles/${vehicleId}/loans`),
    enabled: canRead,
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['vehicle-loans', vehicleId] });
    void queryClient.invalidateQueries({ queryKey: ['loans'] });
  }, [queryClient, vehicleId]);

  // Finance is owner-level information. A caller without the grant is not shown
  // an empty panel or an upgrade prompt — they are shown nothing, because the
  // existence of a loan is itself private.
  if (!canRead) return null;

  if (loans.isLoading) return <LoadingState label="Loading finance…" />;
  if (loans.isError) {
    return <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />;
  }

  const records = loans.data ?? [];

  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={Banknote}
            title="No finance recorded"
            description={`Nothing is recorded against ${registrationNumber}. Add a loan to track EMIs, get reminders before each due date, and keep the repayment history with the vehicle.`}
            action={
              canManage ? (
                <AddLoanDialog
                  vehicleId={vehicleId}
                  registrationNumber={registrationNumber}
                  onCreated={refresh}
                />
              ) : undefined
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <AddLoanDialog
            vehicleId={vehicleId}
            registrationNumber={registrationNumber}
            onCreated={refresh}
            triggerLabel="Add another loan"
          />
        </div>
      ) : null}

      {records.map((loan) => (
        <LoanCard key={loan.id} loan={loan} />
      ))}
    </div>
  );
}

function LoanCard({ loan }: { loan: LoanSummary }): React.ReactElement {
  const overdue = loan.overdueInstallments > 0;

  return (
    <Card className={overdue ? 'border-destructive/40' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {loan.lenderName}
              <LoanStatusBadge status={loan.status} />
              <SourceBadge source={loan.source} verificationStatus={loan.verificationStatus} />
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {humanizeEnum(loan.loanType)} ·{' '}
              <MaskedValue value={loan.loanNumber} masked={loan.loanNumberMasked} />
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to={`/fleet/loans/${loan.id}`}>
              Schedule
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {overdue ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-destructive">
                {loan.overdueInstallments} installment
                {loan.overdueInstallments === 1 ? '' : 's'} overdue
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(loan.overdueAmount)} past its due date.
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="EMI" value={formatCurrency(loan.emiAmount)} hint={humanizeEnum(loan.frequency)} />
          <Figure
            label="Next due"
            value={loan.nextDueDate ? formatDueDate(loan.nextDueDate) : '—'}
            hint={loan.nextDueAmount !== null ? formatCurrency(loan.nextDueAmount) : undefined}
          />
          <Figure label="Outstanding" value={formatCurrency(loan.totalOutstanding)} hint="Principal + interest" />
          <Figure
            label="Rate"
            value={`${loan.annualRatePercent}%`}
            hint={humanizeEnum(loan.interestType)}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {loan.paidInstallments} of {loan.paidInstallments + loan.remainingInstallments} paid
            </span>
            <span className="tabular-nums">{loan.completionPercent}%</span>
          </div>
          <Progress value={loan.completionPercent} className="h-1.5" />
        </div>

        {loan.hasUnknownState ? (
          <>
            <Separator />
            <p className="text-xs text-muted-foreground">
              {loan.unknownInstallments} installment
              {loan.unknownInstallments === 1 ? '' : 's'} could not be confirmed as paid or unpaid,
              so {loan.unknownInstallments === 1 ? 'it is' : 'they are'} excluded from the totals
              above. Record the payment, or import the lender statement, to close the gap.
            </p>
          </>
        ) : null}

        {!loan.remindersEnabled ? (
          <Badge variant="muted" size="sm">
            Reminders off
          </Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      {hint ? <p className="truncate text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Record a repayment against one installment.
 *
 * Exported here rather than on the detail page so the same control can be
 * dropped next to an overdue EMI wherever one is surfaced.
 */
export function useRecordPayment(loanId: string, onDone?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      installmentId?: string;
      amount: number;
      method?: string;
      reference?: string;
      penalty?: number;
    }) => api.post(`/fleet/loans/${loanId}/payments`, input),
    onSuccess: () => {
      toast.success('Payment recorded');
      void queryClient.invalidateQueries({ queryKey: ['loan', loanId] });
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicle-loans'] });
      onDone?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export { InstallmentStatus };
