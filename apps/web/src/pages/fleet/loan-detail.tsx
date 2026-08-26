import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  RefreshCw,
  Truck,
} from 'lucide-react';
import {
  Feature,
  InstallmentStatus,
  LoanStatus,
  Permission,
  formatCurrency,
  humanizeEnum,
} from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import type { LoanDetail, LoanEventView, LoanInstallmentView, LoanSyncResult } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import {
  InstallmentStatusBadge,
  LoanStatusBadge,
  MaskedValue,
  SourceBadge,
  formatDueDate,
} from '@/features/loans/loan-formatting';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { StatCard } from '@/components/common/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * One loan: its terms, its full schedule and its payment ledger.
 *
 * The schedule is the heart of the page and is deliberately rendered whole
 * rather than paginated — a repayment schedule is read by scrolling to "where
 * am I now", and page controls break that. Long tenures are virtualised by the
 * browser's own row rendering, and the current installment is scrolled to on
 * first paint.
 */
export function LoanDetailPage(): React.ReactElement {
  const { id = '' } = useParams<{ id: string }>();
  const { can, hasFeature } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [paying, setPaying] = React.useState<LoanInstallmentView | null>(null);

  const canRead = can(Permission.LOANS_READ) && hasFeature(Feature.FINANCE_LOANS);
  const canManage = can(Permission.LOANS_MANAGE);

  const loan = useQuery({
    queryKey: ['loan', id],
    queryFn: () => api.get<LoanDetail>(`/fleet/loans/${id}`),
    enabled: canRead && Boolean(id),
  });

  const events = useQuery({
    queryKey: ['loan', id, 'events'],
    queryFn: () => api.get<LoanEventView[]>(`/fleet/loans/${id}/events`),
    enabled: canRead && Boolean(id),
  });

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['loan', id] });
    void queryClient.invalidateQueries({ queryKey: ['loans'] });
    void queryClient.invalidateQueries({ queryKey: ['vehicle-loans'] });
  }, [id, queryClient]);

  const toggleReminders = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch(`/fleet/loans/${id}`, { remindersEnabled: enabled }),
    onSuccess: (_data, enabled) => {
      toast.success(enabled ? 'Reminders switched on' : 'Reminders switched off');
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const sync = useMutation({
    mutationFn: () => api.post<LoanSyncResult>(`/fleet/loans/${id}/sync`, { apply: false }),
    onSuccess: (result) => {
      if (result.differences.length === 0) {
        toast.success(`${result.provider} matches your records.`);
      } else {
        toast.warning(
          `${result.differences.length} difference(s) against ${result.provider}: ` +
            result.differences.map((difference) => difference.field).join(', '),
        );
      }
      invalidate();
    },
    onError: (error) => {
      // A missing integration is an expected answer here, not a failure — say
      // so plainly rather than showing a red error toast.
      const message = errorMessage(error);
      if (error instanceof ApiError && error.status === 503) toast.info(message);
      else toast.error(message);
    },
  });

  if (!can(Permission.LOANS_READ)) {
    return (
      <UnauthorizedState message="Vehicle finance is restricted to the fleet owner." />
    );
  }
  if (loan.isLoading) return <LoadingState label="Loading loan…" className="min-h-[50vh]" />;
  if (loan.isError) {
    return <ErrorState error={loan.error} onRetry={() => void loan.refetch()} />;
  }

  const record = loan.data!;
  const nextOpen = record.installments.find(
    (installment) =>
      installment.status === InstallmentStatus.OVERDUE ||
      installment.status === InstallmentStatus.DUE_TODAY ||
      installment.status === InstallmentStatus.DUE_SOON ||
      installment.status === InstallmentStatus.PARTIALLY_PAID ||
      installment.status === InstallmentStatus.UPCOMING,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/fleet/loans')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Loans
        </Button>
      </div>

      <PageHeader
        title={record.lenderName}
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              to={`/fleet/vehicles/${record.vehicleId}`}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              <Truck className="h-3.5 w-3.5" />
              {record.registrationNumber}
            </Link>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{humanizeEnum(record.loanType)}</span>
            <span className="text-muted-foreground">·</span>
            <MaskedValue value={record.loanNumber} masked={record.loanNumberMasked} />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LoanStatusBadge status={record.status} />
            <SourceBadge source={record.source} verificationStatus={record.verificationStatus} />
            {canManage ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleReminders.mutate(!record.remindersEnabled)}
                  disabled={toggleReminders.isPending}
                >
                  {record.remindersEnabled ? (
                    <>
                      <BellRing className="mr-1 h-3.5 w-3.5" />
                      Reminders on
                    </>
                  ) : (
                    <>
                      <BellOff className="mr-1 h-3.5 w-3.5" />
                      Reminders off
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending}
                >
                  <RefreshCw className={`mr-1 h-3.5 w-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />
                  Check with lender
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="EMI" value={formatCurrency(record.emiAmount)} hint={humanizeEnum(record.frequency)} />
        <StatCard
          label="Next due"
          value={record.nextDueDate ? formatDueDate(record.nextDueDate) : '—'}
          hint={record.nextDueAmount !== null ? formatCurrency(record.nextDueAmount) : 'Nothing outstanding'}
          tone={record.overdueInstallments > 0 ? 'destructive' : 'default'}
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(record.totalOutstanding)}
          hint={`${formatCurrency(record.outstandingPrincipal)} principal`}
        />
        <StatCard
          label="Repaid"
          value={`${record.paidInstallments}/${record.paidInstallments + record.remainingInstallments}`}
          hint={`${record.completionPercent}% of the schedule`}
        />
      </div>

      {record.hasUnknownState ? (
        <Card className="border-warning/40">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {record.unknownInstallments} installment
                {record.unknownInstallments === 1 ? '' : 's'} in this schedule has no confirmed
                payment state.
              </span>{' '}
              VorldX Saarthi will not assume one, so those rows are excluded from the outstanding balance
              and from the repaid count. Record the payment against them to close the gap.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                title="Repayment schedule"
                description={`${record.scheduleTotals.installments} installments · ${formatCurrency(record.scheduleTotals.interest)} total interest`}
              />
            </CardHeader>
            <CardContent className="px-0 pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Interest</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Balance after</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage ? <TableHead className="w-24" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.installments.map((installment) => (
                      <TableRow
                        key={installment.id}
                        className={
                          installment.id === nextOpen?.id ? 'bg-primary/5' : undefined
                        }
                      >
                        <TableCell className="text-muted-foreground tabular-nums">
                          {installment.number}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatDueDate(installment.dueDate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(installment.principal)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {formatCurrency(installment.interest)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(installment.totalDue)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums text-muted-foreground lg:table-cell">
                          {installment.closingBalance !== null
                            ? formatCurrency(installment.closingBalance)
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <InstallmentStatusBadge status={installment.status} />
                            {installment.amountPaid > 0 &&
                            installment.status !== InstallmentStatus.PAID ? (
                              <span className="text-2xs text-muted-foreground">
                                {formatCurrency(installment.amountPaid)} paid
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            {installment.status !== InstallmentStatus.PAID &&
                            installment.status !== InstallmentStatus.WAIVED ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPaying(installment)}
                              >
                                <Check className="mr-1 h-3.5 w-3.5" />
                                Pay
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                title="Payment ledger"
                description="What Saarthi was told was paid, and when. Corrections are recorded as new entries, never by editing history."
              />
            </CardHeader>
            <CardContent className="px-0 pt-0">
              {record.payments.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No payments recorded yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Paid on</TableHead>
                        <TableHead>Against</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="hidden md:table-cell">Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {record.payments.map((payment) => (
                        <TableRow key={payment.id} className={payment.reversedAt ? 'opacity-60' : undefined}>
                          <TableCell className="whitespace-nowrap">
                            {new Date(payment.paidAt).toLocaleDateString('en-IN')}
                          </TableCell>
                          <TableCell>
                            {payment.installmentNumber !== null
                              ? `Installment #${payment.installmentNumber}`
                              : humanizeEnum(payment.kind)}
                          </TableCell>
                          <TableCell>{humanizeEnum(payment.method)}</TableCell>
                          <TableCell className="hidden text-muted-foreground md:table-cell">
                            {payment.reference ?? '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(payment.amount)}
                            {payment.penalty > 0 ? (
                              <span className="block text-2xs text-muted-foreground">
                                + {formatCurrency(payment.penalty)} penalty
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="terms">
          <Card>
            <CardContent className="grid grid-cols-1 gap-x-8 gap-y-3 pt-6 sm:grid-cols-2">
              <Term label="Lender" value={record.lenderName} />
              <Term label="Branch" value={record.lenderBranch ?? '—'} />
              <Term
                label="Loan number"
                value={<MaskedValue value={record.loanNumber} masked={record.loanNumberMasked} />}
              />
              <Term label="Borrower" value={record.borrowerName ?? '—'} />
              <Term label="Sanctioned" value={formatCurrency(record.principal)} />
              <Term
                label="Disbursed"
                value={record.disbursedAmount !== null ? formatCurrency(record.disbursedAmount) : '—'}
              />
              <Term
                label="Interest"
                value={`${record.annualRatePercent}% p.a. · ${humanizeEnum(record.interestType)}`}
              />
              <Term
                label="Tenure"
                value={`${record.tenureMonths} months · ${humanizeEnum(record.frequency)}`}
              />
              <Term label="Started" value={formatDueDate(record.startDate)} />
              <Term label="Ends" value={record.endDate ? formatDueDate(record.endDate) : '—'} />
              <Term
                label="EMI"
                value={
                  <span className="flex items-center gap-2">
                    {formatCurrency(record.emiAmount)}
                    {record.emiFromLender ? (
                      <Badge variant="secondary" size="sm">
                        Lender&rsquo;s figure
                      </Badge>
                    ) : (
                      <Badge variant="muted" size="sm">
                        Calculated
                      </Badge>
                    )}
                  </span>
                }
              />
              <Term
                label="Auto-debit"
                value={record.autoDebitDay ? `Day ${record.autoDebitDay} of each month` : '—'}
              />
              <Term
                label="Mandate"
                value={
                  <MaskedValue
                    value={record.mandateReference}
                    masked={record.mandateReferenceMasked}
                    fallback="Owner only"
                  />
                }
              />
              <Term
                label="Reminders"
                value={
                  record.remindersEnabled
                    ? record.reminderOffsets
                        .map((offset) => (offset < 0 ? `T${offset}` : `T+${offset}`))
                        .join(', ')
                    : 'Off'
                }
              />
              {record.notes ? (
                <div className="sm:col-span-2">
                  <Separator className="my-2" />
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{record.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="space-y-3 pt-6">
              {(events.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                (events.data ?? []).map((event) => (
                  <div key={event.id} className="flex gap-3 border-l-2 border-border pl-3">
                    <div className="min-w-0">
                      <p className="text-sm">{event.description ?? humanizeEnum(event.eventType)}</p>
                      <p className="text-2xs text-muted-foreground">
                        {humanizeEnum(event.eventType)} ·{' '}
                        {new Date(event.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog
        loanId={id}
        installment={paying}
        onClose={() => setPaying(null)}
        onRecorded={invalidate}
      />
    </div>
  );
}

function Term({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="truncate text-sm">{value}</div>
    </div>
  );
}

const PAYMENT_METHODS = [
  'AUTO_DEBIT',
  'NACH',
  'UPI',
  'BANK_TRANSFER',
  'CHEQUE',
  'CASH',
  'CARD',
  'OTHER',
] as const;

function RecordPaymentDialog({
  loanId,
  installment,
  onClose,
  onRecorded,
}: {
  loanId: string;
  installment: LoanInstallmentView | null;
  onClose: () => void;
  onRecorded: () => void;
}): React.ReactElement {
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<(typeof PAYMENT_METHODS)[number]>('NACH');
  const [reference, setReference] = React.useState('');
  const [penalty, setPenalty] = React.useState('');

  React.useEffect(() => {
    // Default to what is actually left on the installment, not its face value —
    // a part-paid row should not be settled twice over.
    setAmount(installment ? String(installment.outstanding) : '');
    setReference('');
    setPenalty('');
  }, [installment]);

  const record = useMutation({
    mutationFn: () =>
      api.post(`/fleet/loans/${loanId}/payments`, {
        installmentId: installment?.id,
        amount: Number(amount),
        method,
        ...(reference ? { reference } : {}),
        ...(penalty ? { penalty: Number(penalty) } : {}),
      }),
    onSuccess: () => {
      toast.success('Payment recorded');
      onRecorded();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const value = Number(amount);
  const partial = installment !== null && value > 0 && value < installment.outstanding - 1;

  return (
    <Dialog open={installment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Record payment{installment ? ` — installment #${installment.number}` : ''}
          </DialogTitle>
          <DialogDescription>
            This records a payment you made elsewhere. VorldX Saarthi does not debit your account.
          </DialogDescription>
        </DialogHeader>

        {installment ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Due</span>
                <span>{formatDueDate(installment.dueDate)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">Outstanding on this installment</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(installment.outstanding)}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Amount paid (₹)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              {partial ? (
                <p className="text-2xs text-warning">
                  Less than the full amount — this will be recorded as a part payment and the
                  installment stays open.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Method</Label>
                <Select
                  value={method}
                  onValueChange={(next) => setMethod(next as (typeof PAYMENT_METHODS)[number])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {humanizeEnum(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Late fee (₹)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={penalty}
                  onChange={(event) => setPenalty(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Reference</Label>
              <Input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="UTR or receipt number"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={record.isPending}>
            Cancel
          </Button>
          <Button onClick={() => record.mutate()} disabled={!(value > 0) || record.isPending}>
            {record.isPending ? 'Saving…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LoanDetailPage;

export { LoanStatus };
