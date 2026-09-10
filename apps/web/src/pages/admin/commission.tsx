import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import {
  COMMISSION_STATUSES,
  CommissionStatus,
  CommissionTrigger,
  CommissionType,
  PLAN_CATALOGUE,
  Permission,
  formatCurrency,
  formatDate,
  humanizeEnum,
} from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import type { CommissionRuleView, CommissionView } from '@/features/sales/types';
import { FilterBar, PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Commission rules and approvals — platform administration.
 *
 * Behind `commission.manage`, which the SALESMAN role deliberately does not
 * hold: the person a commission is owed to must not be the person authorising
 * it.
 *
 * Two things this screen cannot do, on purpose.
 *
 * **It cannot type an amount.** There is no field for one anywhere. An
 * administrator who believes a figure is wrong corrects the *rule* and
 * recalculates, which leaves a trail; typing a number over a computed one
 * leaves none.
 *
 * **It cannot approve a commission with no amount.** A sale that qualified
 * while no rule covered it has a null amount, and the API — and a database
 * CHECK behind it — refuse to settle one. The fix is to create the rule; the
 * amounts then fill in by themselves.
 */
export function AdminCommissionPage(): React.ReactElement {
  const { can } = useAuth();

  if (!can(Permission.COMMISSION_MANAGE)) return <UnauthorizedState />;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform"
        title="Commission"
        description="The rates Saarthi pays, and the sales they apply to."
      />

      <Tabs defaultValue="commissions">
        <TabsList>
          <TabsTrigger value="commissions">Commissions</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="commissions" className="pt-4">
          <CommissionsTab />
        </TabsContent>
        <TabsContent value="rules" className="pt-4">
          <RulesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CommissionsTab(): React.ReactElement {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState('all');
  const [deciding, setDeciding] = React.useState<CommissionView | null>(null);

  const commissions = useQuery({
    queryKey: ['/sales/commission', 'admin', page, status],
    queryFn: () =>
      api.get<Paginated<CommissionView>>('/sales/commission', {
        page,
        pageSize: 20,
        ...(status !== 'all' ? { status } : {}),
      }),
    placeholderData: keepPreviousData,
  });

  const recalculate = useMutation({
    mutationFn: () => api.post<{ priced: number }>('/sales/commission/recalculate'),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/commission'] });
      toast.success(
        result.priced === 0
          ? 'Nothing was waiting for a rule.'
          : `${result.priced} commission${result.priced === 1 ? '' : 's'} priced.`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const unpriced =
    commissions.data?.items.filter((row) => row.commissionAmount === null).length ?? 0;

  const columns: Column<CommissionView>[] = [
    {
      key: 'salesman',
      header: 'Salesperson',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.salesmanName ?? row.godId}</p>
          <p className="truncate text-xs text-muted-foreground">
            <code>{row.godId}</code>
          </p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.organizationName ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            {humanizeEnum(row.trigger)}
            {row.planTier ? ` · ${humanizeEnum(row.planTier)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      cell: (row) =>
        row.commissionAmount === null ? (
          <div className="text-right">
            <p className="text-sm font-medium text-warning">No rule</p>
            <p className="text-xs text-muted-foreground">
              on {formatCurrency(row.baseAmount, row.currency)}
            </p>
          </div>
        ) : (
          <div className="text-right">
            <p className="tabular-nums text-sm font-semibold">
              {formatCurrency(row.commissionAmount, row.currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.commissionRate !== null ? `${row.commissionRate}% of ` : 'on '}
              {formatCurrency(row.baseAmount, row.currency)}
            </p>
          </div>
        ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'eligible',
      header: 'Payable from',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.eligibleAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        row.status === CommissionStatus.PAID ||
        row.status === CommissionStatus.REVERSED ||
        row.status === CommissionStatus.REJECTED ? null : (
          <Button size="sm" variant="outline" onClick={() => setDeciding(row)}>
            Decide
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {unpriced > 0 ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {unpriced} commission{unpriced === 1 ? '' : 's'} on this page has no amount
          </AlertTitle>
          <AlertDescription className="space-y-2 text-xs">
            <p>
              These are real, paid-for sales that qualified while no commission rule covered them.
              They are held rather than discarded, and they cannot be approved with no figure.
              Create or correct the rule on the Rules tab and the amounts fill in by themselves.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => recalculate.mutate()}
              disabled={recalculate.isPending}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {recalculate.isPending ? 'Pricing…' : 'Recalculate now'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <FilterBar>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-52">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {COMMISSION_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={commissions.data?.items}
        rowKey={(row) => row.id}
        isLoading={commissions.isLoading}
        error={commissions.error}
        onRetry={() => void commissions.refetch()}
        {...(commissions.data?.pagination ? { pagination: commissions.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No commissions yet"
        emptyDescription="One appears when a customer attributed to a salesperson actually pays."
      />

      <DecisionDialog commission={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

/**
 * Approve, mark payable, pay, reverse or reject.
 *
 * The options offered are the legal next states for this row — `PENDING → PAID`
 * is not one of them, because APPROVED records who confirmed the figure and
 * PAYABLE records that a payout run picked it up. A payment with neither has no
 * record of who authorised it.
 */
function DecisionDialog({
  commission,
  onClose,
}: {
  commission: CommissionView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [paymentReference, setPaymentReference] = React.useState('');

  React.useEffect(() => {
    setStatus('');
    setReason('');
    setPaymentReference('');
  }, [commission]);

  const decide = useMutation({
    mutationFn: () =>
      api.post<CommissionView>(`/sales/commission/${commission?.id}/decision`, {
        status,
        ...(reason ? { reason } : {}),
        ...(paymentReference ? { paymentReference } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/commission'] });
      toast.success('Recorded.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!commission) return null;

  const nextStates: Record<string, string[]> = {
    [CommissionStatus.PENDING]: [
      CommissionStatus.APPROVED,
      CommissionStatus.REJECTED,
      CommissionStatus.REVERSED,
    ],
    [CommissionStatus.APPROVED]: [
      CommissionStatus.PAYABLE,
      CommissionStatus.REVERSED,
      CommissionStatus.REJECTED,
    ],
    [CommissionStatus.PAYABLE]: [CommissionStatus.PAID, CommissionStatus.REVERSED],
  };

  const options = nextStates[commission.status] ?? [];
  const denying =
    status === CommissionStatus.REVERSED || status === CommissionStatus.REJECTED;
  const unpriced = commission.commissionAmount === null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {commission.salesmanName ?? commission.godId} ·{' '}
            {commission.commissionAmount === null
              ? 'no amount'
              : formatCurrency(commission.commissionAmount, commission.currency)}
          </DialogTitle>
          <DialogDescription>
            {commission.organizationName ?? 'Customer'} ·{' '}
            {humanizeEnum(commission.trigger)} · payment{' '}
            <code>{commission.paymentReference}</code>
          </DialogDescription>
        </DialogHeader>

        {unpriced ? (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              {commission.unmatchedReason ??
                'No commission rule covered this sale, so there is no amount.'}{' '}
              It cannot be approved or paid until a rule exists. You can still reject or reverse
              it with a reason.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Decision</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder={`Currently ${humanizeEnum(commission.status)}`} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                    disabled={
                      unpriced &&
                      (option === CommissionStatus.APPROVED ||
                        option === CommissionStatus.PAYABLE ||
                        option === CommissionStatus.PAID)
                    }
                  >
                    {humanizeEnum(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status === CommissionStatus.PAID ? (
            <div className="space-y-1.5">
              <Label htmlFor="decision-ref">Payout reference</Label>
              <Input
                id="decision-ref"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="The transfer Saarthi made, not the customer’s payment"
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="decision-reason">Reason {denying ? '*' : ''}</Label>
            <Textarea
              id="decision-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={
                denying
                  ? 'Required. The salesperson sees this on their own commission screen.'
                  : 'Optional.'
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => decide.mutate()}
            disabled={
              !status || (denying && reason.trim().length === 0) || decide.isPending
            }
          >
            {decide.isPending ? 'Recording…' : 'Record decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The commercial terms.
 *
 * Ships empty on purpose — a rate committed to source control is one nobody
 * agreed to. Until a rule exists, qualifying sales still record commission rows
 * with a null amount, so no sale is lost while the terms are being settled.
 */
function RulesTab(): React.ReactElement {
  const [editing, setEditing] = React.useState<CommissionRuleView | null>(null);
  const [creating, setCreating] = React.useState(false);

  const rules = useQuery({
    queryKey: ['/sales/commission/rules'],
    queryFn: () => api.get<CommissionRuleView[]>('/sales/commission/rules'),
  });

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Commission rules"
        description="What Saarthi pays, on what, and after how long."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New rule
          </Button>
        }
      />

      {rules.data && rules.data.length === 0 ? (
        <EmptyState
          title="No commission rules yet"
          description="No commission has an amount until one exists. Sales are still recorded in the meantime, so nothing is lost — create the rule your sales team agreed to and the amounts fill in automatically."
          action={
            <Button size="sm" onClick={() => setCreating(true)}>
              Create the first rule
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rules.data?.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanizeEnum(rule.trigger)} ·{' '}
                      {rule.planTier ? humanizeEnum(rule.planTier) : 'Any plan'}
                    </p>
                  </div>
                  <Badge variant={rule.active ? 'success' : 'muted'} className="shrink-0">
                    {rule.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <p className="text-sm">
                  {rule.commissionType === CommissionType.PERCENTAGE
                    ? `${rule.commissionRate}% of the payment`
                    : `${formatCurrency(rule.fixedAmount ?? 0)} per sale`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Payable {rule.qualificationDays} day
                  {rule.qualificationDays === 1 ? '' : 's'} after the payment
                  {rule.effectiveFrom ? ` · from ${formatDate(rule.effectiveFrom)}` : ''}
                  {rule.effectiveTo ? ` to ${formatDate(rule.effectiveTo)}` : ''}
                </p>
                {rule.note ? (
                  <p className="text-xs text-muted-foreground">{rule.note}</p>
                ) : null}

                <Button size="sm" variant="outline" onClick={() => setEditing(rule)}>
                  Edit
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <RuleDialog
        rule={editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function RuleDialog({
  rule,
  open,
  onClose,
}: {
  rule: CommissionRuleView | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [form, setForm] = React.useState({
    name: '',
    trigger: CommissionTrigger.SUBSCRIPTION as string,
    planTier: 'any',
    commissionType: CommissionType.PERCENTAGE as string,
    commissionRate: '',
    fixedAmount: '',
    qualificationDays: '',
    active: true,
    note: '',
  });

  React.useEffect(() => {
    setForm({
      name: rule?.name ?? '',
      trigger: rule?.trigger ?? CommissionTrigger.SUBSCRIPTION,
      planTier: rule?.planTier ?? 'any',
      commissionType: rule?.commissionType ?? CommissionType.PERCENTAGE,
      commissionRate: rule?.commissionRate?.toString() ?? '',
      fixedAmount: rule?.fixedAmount?.toString() ?? '',
      qualificationDays: rule?.qualificationDays?.toString() ?? '',
      active: rule?.active ?? true,
      note: rule?.note ?? '',
    });
  }, [rule, open]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        trigger: form.trigger,
        ...(form.planTier !== 'any' ? { planTier: form.planTier } : { planTier: null }),
        commissionType: form.commissionType,
        ...(form.commissionType === CommissionType.PERCENTAGE
          ? { commissionRate: Number(form.commissionRate) }
          : { fixedAmount: Number(form.fixedAmount) }),
        qualificationDays: Number(form.qualificationDays),
        active: form.active,
        ...(form.note ? { note: form.note } : {}),
      };
      return rule
        ? api.put<CommissionRuleView>(`/sales/commission/rules/${rule.id}`, body)
        : api.post<CommissionRuleView>('/sales/commission/rules', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/commission/rules'] });
      void queryClient.invalidateQueries({ queryKey: ['/sales/commission'] });
      toast.success(rule ? 'Rule updated.' : 'Rule created. Pending sales have been priced.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const valid =
    form.name.trim().length >= 3 &&
    form.qualificationDays !== '' &&
    (form.commissionType === CommissionType.PERCENTAGE
      ? form.commissionRate !== ''
      : form.fixedAmount !== '');

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'New commission rule'}</DialogTitle>
          <DialogDescription>
            Existing commissions keep the rate they were computed at — a sale made in March does
            not change because the rate was renegotiated in June. Only sales with no amount yet
            are repriced.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rule-name">Name *</Label>
            <Input
              id="rule-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Standard field-sales commission"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <Select
              value={form.trigger}
              onValueChange={(value) => setForm({ ...form, trigger: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CommissionTrigger).map((trigger) => (
                  <SelectItem key={trigger} value={trigger}>
                    {humanizeEnum(trigger)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select
              value={form.planTier}
              onValueChange={(value) => setForm({ ...form, planTier: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any plan</SelectItem>
                {PLAN_CATALOGUE.map((plan) => (
                  <SelectItem key={plan.tier} value={plan.tier}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>How it is calculated</Label>
            <Select
              value={form.commissionType}
              onValueChange={(value) => setForm({ ...form, commissionType: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CommissionType.PERCENTAGE}>Percentage of the payment</SelectItem>
                <SelectItem value={CommissionType.FIXED}>Fixed amount per sale</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.commissionType === CommissionType.PERCENTAGE ? (
            <div className="space-y-1.5">
              <Label htmlFor="rule-rate">Rate (%) *</Label>
              <Input
                id="rule-rate"
                value={form.commissionRate}
                onChange={(event) => setForm({ ...form, commissionRate: event.target.value })}
                inputMode="decimal"
                placeholder="7.5"
              />
              <p className="text-xs text-muted-foreground">
                Of the pre-GST amount. GST is not Saarthi’s revenue.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rule-fixed">Amount (₹) *</Label>
              <Input
                id="rule-fixed"
                value={form.fixedAmount}
                onChange={(event) => setForm({ ...form, fixedAmount: event.target.value })}
                inputMode="decimal"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rule-days">Qualification period (days) *</Label>
            <Input
              id="rule-days"
              value={form.qualificationDays}
              onChange={(event) => setForm({ ...form, qualificationDays: event.target.value })}
              inputMode="numeric"
              placeholder="30"
            />
            <p className="text-xs text-muted-foreground">
              A sale refunded inside this window reverses rather than pays.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <div className="space-y-0.5">
              <Label htmlFor="rule-active">Active</Label>
              <p className="text-xs text-muted-foreground">
                Only one active rule may cover the same sale type and plan.
              </p>
            </div>
            <Switch
              id="rule-active"
              checked={form.active}
              onCheckedChange={(checked) => setForm({ ...form, active: checked })}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rule-note">Note</Label>
            <Textarea
              id="rule-note"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              rows={2}
              placeholder="Who agreed this, and when."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {save.isPending ? 'Saving…' : rule ? 'Save rule' : 'Create rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AdminCommissionPage;
