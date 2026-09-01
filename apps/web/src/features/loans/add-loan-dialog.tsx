import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, IndianRupee, Landmark, Plus, Wallet } from 'lucide-react';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  FormWizard,
  WizardField,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';

/**
 * Record a vehicle loan.
 *
 * The EMI is previewed live from the server's own amortisation as the terms are
 * typed, for one reason: an operator who sees a figure that does not match
 * their sanction letter has caught a typo *before* twelve months of reminders
 * are generated from it. The preview endpoint performs no writes.
 *
 * That preview is the reason the steps are ordered the way they are, and why
 * it rides along in the wizard's aside rather than living on one step. The
 * amount and rate are entered on step two, the tenure on step three, and the
 * calculated EMI updates in place across both — so the figure to check against
 * the sanction letter is already on screen by the time step four asks whether
 * the lender's own EMI differs.
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

type FieldErrors = Partial<Record<keyof LoanFormState, string>>;

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

/** Per-step rules, keyed by step id. */
const STEP_RULES: Record<string, (form: LoanFormState) => FieldErrors> = {
  lender: (form) => {
    const errors: FieldErrors = {};
    if (form.loanNumber.trim().length < 3)
      errors.loanNumber = 'Enter the loan account number from your sanction letter.';
    if (form.lenderName.trim().length < 2) errors.lenderName = 'Who lent the money?';
    return errors;
  },
  amount: (form) => {
    const errors: FieldErrors = {};
    const principal = Number(form.principal);
    const rate = Number(form.annualRatePercent);
    if (!Number.isFinite(principal) || principal <= 0)
      errors.principal = 'Enter the sanctioned amount.';
    if (form.annualRatePercent.trim() === '' || !Number.isFinite(rate) || rate < 0)
      errors.annualRatePercent = 'Enter the annual interest rate.';
    if (form.disbursedAmount && Number(form.disbursedAmount) > principal)
      errors.disbursedAmount = 'More was disbursed than sanctioned — check the figures.';
    return errors;
  },
  schedule: (form) => {
    const errors: FieldErrors = {};
    const tenure = Number(form.tenureMonths);
    if (!Number.isFinite(tenure) || tenure <= 0) errors.tenureMonths = 'How many months does it run?';
    if (!form.startDate) errors.startDate = 'When did the loan start?';
    return errors;
  },
  emi: () => ({}),
};

export function AddLoanDialog({
  vehicleId,
  registrationNumber,
  onCreated,
  triggerLabel = 'Add loan',
}: AddLoanDialogProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<LoanFormState>(initialState);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);

  const set = <K extends keyof LoanFormState>(key: K, value: LoanFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));
  };

  const principal = Number(form.principal);
  const rate = Number(form.annualRatePercent);
  const tenure = Number(form.tenureMonths);
  const firstDue = form.firstDueDate || nextMonth(form.startDate);

  const previewInput = useDebounced(
    {
      principal,
      rate,
      tenure,
      interestType: form.interestType,
      frequency: form.frequency,
      firstDue,
    },
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
      setErrors({});
      setErroredStepIds([]);
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

  const validateStep = (step: WizardStep): boolean => {
    const found = STEP_RULES[step.id]?.(form) ?? {};
    const ok = Object.keys(found).length === 0;

    setErrors(found);
    setErroredStepIds((previous) =>
      ok
        ? previous.filter((id) => id !== step.id)
        : previous.includes(step.id)
          ? previous
          : [...previous, step.id],
    );

    return ok;
  };

  /** The running schedule, shown beside every step. */
  const scheduleAside = (
    <div className="glass-inset space-y-1 p-3">
      <p className="section-label">Calculated EMI</p>
      <p className="text-lg font-semibold tabular-nums">
        {computedEmi !== null ? formatCurrency(computedEmi) : '—'}
      </p>
      {preview.data ? (
        <p className="text-2xs leading-relaxed text-muted-foreground">
          {preview.data.totals.installments} installments ·{' '}
          {formatCurrency(preview.data.totals.interest)} total interest ·{' '}
          {formatCurrency(preview.data.totals.total)} repaid overall
        </p>
      ) : (
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Enter the amount, rate and tenure to see the schedule.
        </p>
      )}
    </div>
  );

  const steps: WizardStep[] = [
    {
      id: 'lender',
      title: 'Lender',
      description: 'Who holds the loan.',
      icon: Landmark,
      content: (
        <>
          <WizardField
            label="Loan account number"
            htmlFor="loan-number"
            required
            error={errors.loanNumber}
          >
            <Input
              id="loan-number"
              value={form.loanNumber}
              aria-invalid={Boolean(errors.loanNumber) || undefined}
              onChange={(event) => set('loanNumber', event.target.value)}
              placeholder="LOAN-123456789"
              autoComplete="off"
            />
          </WizardField>

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField label="Lender" htmlFor="loan-lender" required error={errors.lenderName}>
              <Input
                id="loan-lender"
                value={form.lenderName}
                aria-invalid={Boolean(errors.lenderName) || undefined}
                onChange={(event) => set('lenderName', event.target.value)}
                placeholder="Shriram Finance"
              />
            </WizardField>

            <WizardField label="Branch" htmlFor="loan-branch">
              <Input
                id="loan-branch"
                value={form.lenderBranch}
                onChange={(event) => set('lenderBranch', event.target.value)}
                placeholder="Kanpur"
              />
            </WizardField>
          </div>

          <WizardField label="Loan type">
            <Select
              value={form.loanType}
              onValueChange={(value) => set('loanType', value as LoanType)}
            >
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
          </WizardField>
        </>
      ),
    },
    {
      id: 'amount',
      title: 'Amount & rate',
      description: 'What was borrowed, and at what cost.',
      icon: IndianRupee,
      content: (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField
              label="Loan amount (₹)"
              htmlFor="loan-principal"
              required
              error={errors.principal}
            >
              <Input
                id="loan-principal"
                type="number"
                inputMode="decimal"
                value={form.principal}
                aria-invalid={Boolean(errors.principal) || undefined}
                onChange={(event) => set('principal', event.target.value)}
                placeholder="1000000"
              />
            </WizardField>

            <WizardField
              label="Amount disbursed (₹)"
              htmlFor="loan-disbursed"
              error={errors.disbursedAmount}
              hint="Only if it differed from the sanction."
            >
              <Input
                id="loan-disbursed"
                type="number"
                inputMode="decimal"
                value={form.disbursedAmount}
                aria-invalid={Boolean(errors.disbursedAmount) || undefined}
                onChange={(event) => set('disbursedAmount', event.target.value)}
              />
            </WizardField>

            <WizardField
              label="Interest rate (% p.a.)"
              htmlFor="loan-rate"
              required
              error={errors.annualRatePercent}
            >
              <Input
                id="loan-rate"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.annualRatePercent}
                aria-invalid={Boolean(errors.annualRatePercent) || undefined}
                onChange={(event) => set('annualRatePercent', event.target.value)}
                placeholder="12.5"
              />
            </WizardField>

            <WizardField label="Interest type">
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
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'schedule',
      title: 'Schedule',
      description: 'How long, and from when.',
      icon: CalendarClock,
      content: (
        <div className="grid gap-3 sm:grid-cols-2">
          <WizardField
            label="Tenure (months)"
            htmlFor="loan-tenure"
            required
            error={errors.tenureMonths}
          >
            <Input
              id="loan-tenure"
              type="number"
              inputMode="numeric"
              value={form.tenureMonths}
              aria-invalid={Boolean(errors.tenureMonths) || undefined}
              onChange={(event) => set('tenureMonths', event.target.value)}
              placeholder="48"
            />
          </WizardField>

          <WizardField label="EMI frequency">
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
          </WizardField>

          <WizardField
            label="Loan start date"
            htmlFor="loan-start"
            required
            error={errors.startDate}
          >
            <Input
              id="loan-start"
              type="date"
              value={form.startDate}
              aria-invalid={Boolean(errors.startDate) || undefined}
              onChange={(event) => set('startDate', event.target.value)}
            />
          </WizardField>

          <WizardField
            label="First EMI date"
            htmlFor="loan-first-due"
            hint="Defaults to a month after the start date."
          >
            <Input
              id="loan-first-due"
              type="date"
              value={form.firstDueDate}
              onChange={(event) => set('firstDueDate', event.target.value)}
            />
          </WizardField>
        </div>
      ),
    },
    {
      id: 'emi',
      title: 'EMI & mandate',
      description: 'What is actually billed.',
      icon: Wallet,
      optional: true,
      content: (
        <>
          <WizardField
            label="Lender's EMI, if it differs (₹)"
            htmlFor="lender-emi"
            hint="Lenders usually round to the rupee. Whatever you enter here is what Saarthi bills and reminds against."
          >
            <Input
              id="lender-emi"
              type="number"
              inputMode="decimal"
              value={form.emiAmount}
              onChange={(event) => set('emiAmount', event.target.value)}
              placeholder={computedEmi !== null ? String(Math.ceil(computedEmi)) : ''}
            />
          </WizardField>

          {emiDiffers ? (
            <p className="-mt-2 text-xs text-warning">
              That is {formatCurrency(Math.abs((lenderEmi ?? 0) - (computedEmi ?? 0)))} away from the
              calculated figure — worth re-checking the rate and tenure against your sanction
              letter.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField
              label="Auto-debit day"
              htmlFor="loan-debit-day"
              hint="Day of month the bank debits."
            >
              <Input
                id="loan-debit-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={form.autoDebitDay}
                onChange={(event) => set('autoDebitDay', event.target.value)}
              />
            </WizardField>

            <WizardField
              label="Mandate reference"
              htmlFor="loan-mandate"
              hint="NACH/ECS reference. Stored privately."
            >
              <Input
                id="loan-mandate"
                value={form.mandateReference}
                onChange={(event) => set('mandateReference', event.target.value)}
                autoComplete="off"
              />
            </WizardField>
          </div>

          <WizardField label="Notes" htmlFor="loan-notes">
            <Textarea
              id="loan-notes"
              rows={2}
              value={form.notes}
              onChange={(event) => set('notes', event.target.value)}
              placeholder="Anything you want kept with this loan."
            />
          </WizardField>
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>Record a loan on {registrationNumber}</DialogTitle>
          <DialogDescription>
            VorldX Saarthi keeps the record and reminds you before each EMI. It does not contact your
            lender or move money.
          </DialogDescription>
        </DialogHeader>

        <FormWizard
          steps={steps}
          className={WIZARD_IN_DIALOG}
          panelClassName={WIZARD_DIALOG_PANEL}
          resetKey={open}
          aside={scheduleAside}
          onValidateStep={validateStep}
          onSubmit={() => create.mutate()}
          submitting={create.isPending}
          submitLabel="Record loan"
          erroredStepIds={erroredStepIds}
          footerStart={
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
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
