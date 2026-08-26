import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  EmiFrequency,
  InterestType,
  LoanType,
  formatCurrency,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { LoanDetail, SchedulePreview } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea';

/**
 * Record a vehicle loan.
 *
 * The EMI is previewed live from the server's own amortisation as the terms are
 * typed, for one reason: an operator who sees a figure that does not match
 * their sanction letter has caught a typo *before* twelve months of reminders
 * are generated from it. The preview endpoint performs no writes.
 */

interface AddLoanDialogProps {
  vehicleId: string;
  registrationNumber: string;
  onCreated?: (loan: LoanDetail) => void;
  triggerLabel?: string;
}

interface LoanFormState {
  loanNumber: string;
  lenderName: string;
  lenderBranch: string;
  loanType: LoanType;
  principal: string;
  disbursedAmount: string;
  annualRatePercent: string;
  interestType: InterestType;
  tenureMonths: string;
  frequency: EmiFrequency;
  startDate: string;
  firstDueDate: string;
  emiAmount: string;
  autoDebitDay: string;
  mandateReference: string;
  notes: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function initialState(): LoanFormState {
  return {
    loanNumber: '',
    lenderName: '',
    lenderBranch: '',
    loanType: LoanType.HYPOTHECATION,
    principal: '',
    disbursedAmount: '',
    annualRatePercent: '',
    interestType: InterestType.REDUCING_BALANCE,
    tenureMonths: '',
    frequency: EmiFrequency.MONTHLY,
    startDate: today(),
    firstDueDate: '',
    emiAmount: '',
    autoDebitDay: '',
    mandateReference: '',
    notes: '',
  };
}

/** Debounce so the preview does not fire on every keystroke of a rate. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function AddLoanDialog({
  vehicleId,
  registrationNumber,
  onCreated,
  triggerLabel = 'Add loan',
}: AddLoanDialogProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<LoanFormState>(initialState);

  const set = <K extends keyof LoanFormState>(key: K, value: LoanFormState[K]): void =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const principal = Number(form.principal);
  const rate = Number(form.annualRatePercent);
  const tenure = Number(form.tenureMonths);
  const firstDue = form.firstDueDate || nextMonth(form.startDate);

  const previewInput = useDebounced(
    { principal, rate, tenure, interestType: form.interestType, frequency: form.frequency, firstDue },
    400,
  );

  const previewReady =
    previewInput.principal > 0 &&
    previewInput.tenure > 0 &&
    Number.isFinite(previewInput.rate) &&
    previewInput.rate >= 0 &&
    Boolean(previewInput.firstDue);

  const preview = useQuery({
    queryKey: ['loan-preview', previewInput],
    queryFn: () =>
      api.post<SchedulePreview>('/fleet/loans/preview-schedule', {
        principal: previewInput.principal,
        annualRatePercent: previewInput.rate,
        interestType: previewInput.interestType,
        tenureMonths: previewInput.tenure,
        frequency: previewInput.frequency,
        firstDueDate: previewInput.firstDue,
      }),
    enabled: open && previewReady,
    // Pure arithmetic on inputs the user just typed — no reason to refetch.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<LoanDetail>('/fleet/loans', {
        vehicleId,
        loanNumber: form.loanNumber,
        lenderName: form.lenderName,
        ...(form.lenderBranch ? { lenderBranch: form.lenderBranch } : {}),
        loanType: form.loanType,
        principal,
        ...(form.disbursedAmount ? { disbursedAmount: Number(form.disbursedAmount) } : {}),
        annualRatePercent: rate,
        interestType: form.interestType,
        tenureMonths: tenure,
        frequency: form.frequency,
        startDate: form.startDate,
        firstDueDate: firstDue,
        ...(form.emiAmount ? { emiAmount: Number(form.emiAmount) } : {}),
        ...(form.autoDebitDay ? { autoDebitDay: Number(form.autoDebitDay) } : {}),
        ...(form.mandateReference ? { mandateReference: form.mandateReference } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
      }),
    onSuccess: (loan) => {
      toast.success(`Loan recorded against ${registrationNumber}`);
      setForm(initialState());
      setOpen(false);
      onCreated?.(loan);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const computedEmi = preview.data?.emiAmount ?? null;
  const lenderEmi = form.emiAmount ? Number(form.emiAmount) : null;
  // A rupee or two apart is just rounding; a wider gap usually means a typo.
  const emiDiffers =
    computedEmi !== null && lenderEmi !== null && Math.abs(computedEmi - lenderEmi) > 5;

  const canSubmit =
    form.loanNumber.trim().length >= 3 &&
    form.lenderName.trim().length >= 2 &&
    principal > 0 &&
    tenure > 0 &&
    Number.isFinite(rate) &&
    !create.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a loan on {registrationNumber}</DialogTitle>
          <DialogDescription>
            VorldX Saarthi keeps the record and reminds you before each EMI. It does not contact your
            lender or move money.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Loan account number" required>
            <Input
              value={form.loanNumber}
              onChange={(event) => set('loanNumber', event.target.value)}
              placeholder="LOAN-123456789"
              autoComplete="off"
            />
          </Field>

          <Field label="Lender" required>
            <Input
              value={form.lenderName}
              onChange={(event) => set('lenderName', event.target.value)}
              placeholder="Shriram Finance"
            />
          </Field>

          <Field label="Branch">
            <Input
              value={form.lenderBranch}
              onChange={(event) => set('lenderBranch', event.target.value)}
              placeholder="Kanpur"
            />
          </Field>

          <Field label="Loan type">
            <Select value={form.loanType} onValueChange={(value) => set('loanType', value as LoanType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(LoanType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanizeEnum(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Loan amount (₹)" required>
            <Input
              type="number"
              inputMode="decimal"
              value={form.principal}
              onChange={(event) => set('principal', event.target.value)}
              placeholder="1000000"
            />
          </Field>

          <Field label="Amount disbursed (₹)" hint="Only if it differed from the sanction.">
            <Input
              type="number"
              inputMode="decimal"
              value={form.disbursedAmount}
              onChange={(event) => set('disbursedAmount', event.target.value)}
            />
          </Field>

          <Field label="Interest rate (% p.a.)" required>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.annualRatePercent}
              onChange={(event) => set('annualRatePercent', event.target.value)}
              placeholder="12.5"
            />
          </Field>

          <Field label="Interest type">
            <Select
              value={form.interestType}
              onValueChange={(value) => set('interestType', value as InterestType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(InterestType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanizeEnum(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tenure (months)" required>
            <Input
              type="number"
              inputMode="numeric"
              value={form.tenureMonths}
              onChange={(event) => set('tenureMonths', event.target.value)}
              placeholder="48"
            />
          </Field>

          <Field label="EMI frequency">
            <Select
              value={form.frequency}
              onValueChange={(value) => set('frequency', value as EmiFrequency)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(EmiFrequency).map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {humanizeEnum(frequency)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Loan start date" required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(event) => set('startDate', event.target.value)}
            />
          </Field>

          <Field label="First EMI date" hint="Defaults to a month after the start date.">
            <Input
              type="date"
              value={form.firstDueDate}
              onChange={(event) => set('firstDueDate', event.target.value)}
            />
          </Field>

          <Field label="Auto-debit day" hint="Day of month the bank debits.">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={form.autoDebitDay}
              onChange={(event) => set('autoDebitDay', event.target.value)}
            />
          </Field>

          <Field label="Mandate reference" hint="NACH/ECS reference. Stored privately.">
            <Input
              value={form.mandateReference}
              onChange={(event) => set('mandateReference', event.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>

        <Separator />

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Calculated EMI
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {computedEmi !== null ? formatCurrency(computedEmi) : '—'}
            </p>
          </div>
          {preview.data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {preview.data.totals.installments} installments ·{' '}
              {formatCurrency(preview.data.totals.interest)} total interest ·{' '}
              {formatCurrency(preview.data.totals.total)} repaid overall
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Enter the amount, rate and tenure to see the schedule.
            </p>
          )}

          <div className="mt-3">
            <Label htmlFor="lender-emi" className="text-xs">
              Lender&rsquo;s EMI, if it differs (₹)
            </Label>
            <Input
              id="lender-emi"
              type="number"
              inputMode="decimal"
              className="mt-1"
              value={form.emiAmount}
              onChange={(event) => set('emiAmount', event.target.value)}
              placeholder={computedEmi !== null ? String(Math.ceil(computedEmi)) : ''}
            />
            <p className="mt-1 text-2xs text-muted-foreground">
              Lenders usually round to the rupee. Whatever you enter here is what Saarthi bills and
              reminds against.
            </p>
            {emiDiffers ? (
              <p className="mt-1 text-2xs text-warning">
                That is {formatCurrency(Math.abs((lenderEmi ?? 0) - (computedEmi ?? 0)))} away from
                the calculated figure — worth re-checking the rate and tenure against your
                sanction letter.
              </p>
            ) : null}
          </div>
        </div>

        <Field label="Notes">
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Anything you want kept with this loan."
          />
        </Field>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit}>
            {create.isPending ? 'Saving…' : 'Record loan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Same clamping rule the server uses, so the hint matches what is saved. */
function nextMonth(startDate: string): string {
  if (!startDate) return '';
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return '';
  const day = start.getUTCDate();
  const shifted = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const daysInMonth = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(day, daysInMonth));
  return shifted.toISOString().slice(0, 10);
}
