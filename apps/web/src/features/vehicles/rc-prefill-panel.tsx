import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, FileSearch, PencilLine, Sparkles } from 'lucide-react';
import { ErrorCode, RcDetailLevel, type VehicleRcPrefill } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFullDetails } from './rc/use-full-details';

/** Why a lookup did not fill the form, in terms the owner can act on. */
function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return error.message;
    if (error.status === 404) {
      return 'No RC record was found for this number. Check it, or enter the details yourself.';
    }
    if (error.code === ErrorCode.RATE_LIMITED)
      return 'Too many lookups just now - wait a minute and try again.';
    if (error.status === 400 || error.status === 422) return error.message;
  }
  return 'The RC lookup is not available right now. Enter the details yourself - you can verify the vehicle later.';
}

/**
 * The first step of adding a vehicle: its RC number, and how much to fetch.
 *
 * Saarthi fetches the RC and hands back a draft of the vehicle — type, make,
 * model, fuel, capacity — for the owner to review, edit and save. Saving it
 * verifies the vehicle against that record, at no charge. Basic details are
 * free (RC Details Lite, often without make, model or fuel); full details cost
 * ₹20 through Pay & Verify (RC Details Advanced, merged with the basic record,
 * with the RC certificate). When there is no record, or the lookup is down,
 * the owner fills the form in by hand as before.
 */
export function RcPrefillPanel({
  onPrefilled,
  onManual,
}: {
  onPrefilled: (prefill: VehicleRcPrefill) => void;
  onManual: (registrationNumber: string) => void;
}) {
  const { session } = useAuth();
  const organizationId = session?.organization?.id;
  const [registrationNumber, setRegistrationNumber] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const full = useFullDetails();

  const fetchRc = useMutation({
    mutationFn: (plate: string) =>
      api.post<VehicleRcPrefill>('/vehicles/rc-prefill', { registrationNumber: plate }),
    onSuccess: (prefill) => {
      setProblem(null);
      onPrefilled(prefill);
    },
    onError: (error) => setProblem(explain(error)),
  });

  const plate = registrationNumber.replace(/\s+/g, '').toUpperCase();
  const ready = plate.length >= 6;
  const working = fetchRc.isPending || full.busy;

  const fetchBasic = (): void => {
    if (ready) fetchRc.mutate(plate);
  };

  /** Pay, then read the stored full record back: the payment settles on the server. */
  const fetchFull = async (): Promise<void> => {
    if (!ready || !organizationId) return;
    setProblem(null);
    const bought = await full.buy({
      subjectType: 'ORGANIZATION',
      subjectId: organizationId,
      registrationNumber: plate,
    });
    if (!bought) return;
    try {
      const prefill = await api.get<VehicleRcPrefill | null>('/vehicles/rc-prefill/stored', {
        registrationNumber: plate,
      });
      if (prefill) onPrefilled(prefill);
      else setProblem('The full details were fetched but could not be read back. Try Full details again - it is free now.');
    } catch (error) {
      setProblem(explain(error));
    }
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    fetchBasic();
  };

  const shownProblem = problem ?? full.problem;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="rc-number" required>
          RC number
        </Label>
        <Input
          id="rc-number"
          value={registrationNumber}
          onChange={(event) => setRegistrationNumber(event.target.value)}
          placeholder="MH12AB1234"
          autoComplete="off"
          autoFocus
          className="h-11 font-mono text-base uppercase tracking-wider"
          aria-invalid={shownProblem ? true : undefined}
          aria-describedby="rc-number-hint"
        />
        <p id="rc-number-hint" className="text-xs text-muted-foreground">
          The registration number on the vehicle&rsquo;s RC. We fill in the rest from the RTO
          record.
        </p>
      </div>

      {shownProblem ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          {shownProblem}
        </p>
      ) : null}

      <div role="group" aria-label="How much to fetch" className="grid gap-3 sm:grid-cols-2">
        <TierOption
          title="Basic details"
          price="Free"
          description="Registration and validity dates, RTO, weights and seats. Make, model and fuel are often missing."
          action={
            <Button
              type="submit"
              variant="outline"
              className="w-full"
              loading={fetchRc.isPending}
              disabled={!ready || working}
            >
              <FileSearch className="size-4" aria-hidden />
              <span>Fetch basic details</span>
            </Button>
          }
        />
        <TierOption
          title="Full details"
          price={full.fee || 'Paid'}
          featured
          description="Adds what basic often misses: make, model, fuel, colour and emission norms, from two registry sources, plus the RC certificate."
          action={
            <Button
              type="button"
              className="w-full"
              loading={full.busy}
              disabled={!ready || working || !full.available || !organizationId}
              onClick={() => void fetchFull()}
            >
              <Sparkles className="size-4" aria-hidden />
              <span>{full.label}</span>
            </Button>
          }
        />
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
        The vehicle is verified against the RTO record when you save it - no charge. With basic
        details you can still get full details later from the vehicle&rsquo;s page.
      </p>

      <div className="flex justify-start">
        <Button type="button" variant="ghost" onClick={() => onManual(plate)} disabled={working}>
          <PencilLine className="size-4" aria-hidden />
          <span>Enter details myself</span>
        </Button>
      </div>
    </form>
  );
}

/** One way to fill the form: what it costs, what it brings, and its button. */
function TierOption({
  title,
  price,
  description,
  action,
  featured = false,
}: {
  title: string;
  price: string;
  description: string;
  action: React.ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        featured ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <p
          className={cn(
            'text-sm font-semibold tabular-nums',
            featured ? 'text-primary' : 'text-success',
          )}
        >
          {price}
        </p>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

/** Plates compared the way the API stores them: no spaces or dashes, upper case. */
function normalisePlate(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Where an add-vehicle dialog is: asking for the RC number, or showing the
 * form — filled in from the RC, or blank for somebody entering it by hand.
 * Reset every time the dialog opens.
 */
export function useRcPrefill(active: boolean) {
  const [stage, setStage] = React.useState<'entry' | 'form'>('entry');
  const [prefill, setPrefill] = React.useState<VehicleRcPrefill | null>(null);

  React.useEffect(() => {
    if (!active) return;
    setStage('entry');
    setPrefill(null);
  }, [active]);

  return {
    /** True while the dialog should show only the RC number. */
    asking: active && stage === 'entry',
    prefill,
    begin(next: VehicleRcPrefill): void {
      setPrefill(next);
      setStage('form');
    },
    manual(): void {
      setPrefill(null);
      setStage('form');
    },
    /** Start again from the RC number. */
    restart(): void {
      setPrefill(null);
      setStage('entry');
    },
    /**
     * The lookup to verify against on save — only while the plate is still
     * the one it was fetched for. An edited plate is a different vehicle.
     */
    lookupIdFor(registrationNumber: string): string | null {
      if (!prefill) return null;
      return normalisePlate(registrationNumber) === normalisePlate(prefill.registrationNumber)
        ? prefill.lookupId
        : null;
    },
  };
}

/** Above the review form: where the details came from, and what saving does. */
export function RcPrefilledNotice({
  registrationNumber,
  detailLevel,
  typeWarning,
  onRestart,
}: {
  registrationNumber: string;
  detailLevel: RcDetailLevel;
  /** Set when the RC's vehicle type is not one this account can add. */
  typeWarning: string | null;
  onRestart: () => void;
}) {
  const basic = detailLevel === RcDetailLevel.BASIC;
  return (
    <div className="mx-4 mt-3 space-y-2 sm:mx-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm">
        <Sparkles className="size-4 shrink-0 text-success" aria-hidden />
        <p className="min-w-0 flex-1">
          {`Filled in from the ${basic ? 'basic' : 'full'} RTO record for `}
          <span className="font-mono font-medium">{registrationNumber}</span>
          {basic
            ? '. Make, model or fuel may be blank - fill them in, or get full details later from the vehicle’s page. Check each step, add a photo, and save - it is verified when saved.'
            : '. Check each step, add a photo, and save - it is verified when saved.'}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRestart}>
          Different number
        </Button>
      </div>
      {typeWarning ? (
        <p
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
        >
          {typeWarning}
        </p>
      ) : null}
    </div>
  );
}
