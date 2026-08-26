import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, EyeOff, IdCard, RefreshCw, Search } from 'lucide-react';
import {
  hasTransportEntitlement,
  isPlausibleIndianLicence,
  normalizeLicenceNumber,
  rcValidity,
  type DrivingLicenceRecord,
  type LicenceLookupResult,
  type RcValidity,
} from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Driving licence lookup.
 *
 * Reads the RTO record for a driver on your own roster. Like the RC panel it
 * loads whatever Saarthi already holds the moment it opens, so a record fetched
 * once stays visible — the button is for getting a *fresh* one.
 *
 * The provider verifies the licence number against a date of birth, so both are
 * required. Both are prefilled from the driver's profile where VorldX Saarthi has them.
 */

const LOOKUP_STAGES = [
  'Checking licence number…',
  'Verifying against RTO records…',
  'Preparing licence details…',
];

function useLookupStage(active: boolean): string {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active) {
      setIndex(0);
      return undefined;
    }
    const timer = setInterval(
      () => setIndex((previous) => Math.min(previous + 1, LOOKUP_STAGES.length - 1)),
      1400,
    );
    return () => clearInterval(timer);
  }, [active]);

  return LOOKUP_STAGES[index] ?? LOOKUP_STAGES[0]!;
}

const VALIDITY_TONE: Record<
  RcValidity,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }
> = {
  VALID: { label: 'Valid', variant: 'success' },
  EXPIRING_SOON: { label: 'Expiring soon', variant: 'warning' },
  EXPIRED: { label: 'Expired', variant: 'destructive' },
  UNKNOWN: { label: 'Not published', variant: 'muted' },
};

function ValidityRow({ label, validUntil }: { label: string; validUntil: string | null }) {
  const { validity, daysRemaining } = rcValidity(validUntil);
  const tone = VALIDITY_TONE[validity];

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {validUntil ? (
          <span className="tabular text-xs text-muted-foreground">
            {validUntil}
            {daysRemaining !== null && validity !== 'EXPIRED' ? ` · ${daysRemaining} days` : ''}
          </span>
        ) : null}
        <Badge variant={tone.variant} size="sm">
          {tone.label}
        </Badge>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm" title={display}>
        {display}
      </p>
    </div>
  );
}

function LicenceDetails({ licence }: { licence: DrivingLicenceRecord }) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Licence
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Detail label="Number" value={licence.licenceNumber} />
          <Detail label="State" value={licence.state} />
          <Detail label="Issuing RTO" value={licence.issuingAuthority} />
          <Detail label="RTO code" value={licence.issuingAuthorityCode} />
          <Detail label="Issued on" value={licence.issuedOn} />
          <Detail label="Transport issued on" value={licence.transportIssuedOn} />
        </div>
      </section>

      {licence.holder ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Holder
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Detail label="Name" value={licence.holder.name} />
            <Detail label="Father / husband" value={licence.holder.fatherOrHusbandName} />
            <Detail label="Date of birth" value={licence.holder.dateOfBirth} />
            <Detail label="Gender" value={licence.holder.gender} />
            <Detail label="Blood group" value={licence.holder.bloodGroup} />
            <Detail label="Citizenship" value={licence.holder.citizenship} />
            <Detail label="Permanent address" value={licence.holder.permanentAddress} />
            <Detail label="Permanent PIN" value={licence.holder.permanentZip} />
            <Detail label="Present address" value={licence.holder.temporaryAddress} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export interface LicenceLookupPanelProps {
  /** Prefilled from the driver's profile; the field stays read-only when set. */
  licenceNumber?: string;
  /** ISO date, prefilled from the driver's profile where VorldX Saarthi has it. */
  dateOfBirth?: string | null;
}

export function LicenceLookupPanel({
  licenceNumber: fixedLicence,
  dateOfBirth: knownDob,
}: LicenceLookupPanelProps = {}) {
  const queryClient = useQueryClient();
  const locked = Boolean(fixedLicence);
  const [input, setInput] = React.useState(fixedLicence ?? '');
  const [dob, setDob] = React.useState(knownDob ? knownDob.slice(0, 10) : '');
  const [result, setResult] = React.useState<LicenceLookupResult | null>(null);

  React.useEffect(() => {
    if (!fixedLicence) return;
    setInput(fixedLicence);
    setResult(null);
  }, [fixedLicence]);

  React.useEffect(() => {
    if (knownDob) setDob(knownDob.slice(0, 10));
  }, [knownDob]);

  /** Whatever Saarthi already holds. Costs nothing, never calls the provider. */
  const stored = useQuery({
    queryKey: ['licence-lookup', 'stored', fixedLicence],
    queryFn: () =>
      api.get<LicenceLookupResult | null>('/drivers/licence/latest', {
        licenceNumber: fixedLicence!,
      }),
    enabled: Boolean(fixedLicence),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (stored.data && !result) setResult(stored.data);
  }, [stored.data, result]);

  const lookup = useMutation({
    mutationFn: (variables: { licenceNumber: string; dateOfBirth: string; refresh: boolean }) =>
      api.post<LicenceLookupResult>('/drivers/licence/lookup', variables),
    onSuccess: (data) => {
      setResult(data);
      queryClient.setQueryData(['licence-lookup', 'stored', fixedLicence], data);
    },
    onError: (error) => {
      setResult(null);
      if (error instanceof ApiError && error.status === 404) return;
      toast.error('Lookup failed', { description: errorMessage(error) });
    },
  });

  const stage = useLookupStage(lookup.isPending);

  const submit = (refresh: boolean): void => {
    const licenceNumber = normalizeLicenceNumber(input);
    if (!isPlausibleIndianLicence(licenceNumber)) {
      toast.error('Check the licence number', {
        description: 'That does not look like an Indian driving licence number.',
      });
      return;
    }
    if (!dob) {
      toast.error('Date of birth is required', {
        description: 'The RTO verifies a licence number against the holder’s date of birth.',
      });
      return;
    }
    lookup.mutate({ licenceNumber, dateOfBirth: dob, refresh });
  };

  const notFound =
    lookup.error instanceof ApiError && lookup.error.status === 404 ? lookup.error : null;
  const transport = result ? hasTransportEntitlement(result.licence) : null;

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit(false);
            }}
          >
            <div className="min-w-52 flex-1 space-y-1.5">
              <Label htmlFor="licence-number">Licence number</Label>
              <Input
                id="licence-number"
                value={input}
                onChange={(event) => setInput(event.target.value.toUpperCase())}
                placeholder="MH0320140001234"
                autoComplete="off"
                spellCheck={false}
                readOnly={locked}
                aria-readonly={locked}
                className={cn(
                  'font-mono uppercase tracking-wide',
                  locked && 'cursor-default bg-muted/60',
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="licence-dob">Date of birth</Label>
              <Input
                id="licence-dob"
                type="date"
                required
                value={dob}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDob(event.target.value)}
                className="w-44"
              />
            </div>

            <Button
              type="submit"
              disabled={lookup.isPending || input.trim().length === 0 || !dob}
            >
              <Search className="size-4" />
              {locked ? 'Get details' : 'Verify licence'}
            </Button>

            {result ? (
              <Button
                type="button"
                variant="outline"
                disabled={lookup.isPending}
                onClick={() => submit(true)}
                title="Bypass the stored record and query the RTO again"
              >
                <RefreshCw className={cn('size-4', lookup.isPending && 'animate-spin')} />
                Refresh
              </Button>
            ) : null}
          </form>

          <p className="mt-2 text-xs text-muted-foreground">
            The RTO verifies a licence against the holder&rsquo;s date of birth, so both are
            required. Lookups are limited to drivers on your own roster.
          </p>
        </CardContent>
      </Card>

      {lookup.isPending ? <LoadingState label={stage} /> : null}

      {notFound ? (
        <EmptyState
          icon={IdCard}
          title="No licence record found"
          description="The RTO returned nothing for that licence number and date of birth. Check both and try again."
        />
      ) : null}

      {lookup.error && !notFound ? (
        <ErrorState error={lookup.error} onRetry={() => submit(false)} />
      ) : null}

      {result && !lookup.isPending ? (
        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="font-mono text-lg tracking-wide">
                {result.licenceNumber}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {result.licence.holder?.name ?? 'Licence holder details withheld'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {result.licence.state ? (
                  <Badge variant="secondary" size="sm">
                    {result.licence.state}
                  </Badge>
                ) : null}
                {transport === true ? (
                  <Badge variant="success" size="sm" className="gap-1">
                    <BadgeCheck className="size-3" />
                    Commercial entitlement
                  </Badge>
                ) : transport === false ? (
                  <Badge variant="warning" size="sm">
                    No commercial class
                  </Badge>
                ) : null}
                {result.cached ? (
                  <Badge variant="muted" size="sm">
                    From Saarthi records
                  </Badge>
                ) : null}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <section className="space-y-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Validity
              </h3>
              <div className="divide-y divide-border">
                <ValidityRow label="Licence" validUntil={result.licence.validUntil} />
                <ValidityRow
                  label="Transport (commercial)"
                  validUntil={result.licence.transportValidUntil}
                />
              </div>
            </section>

            {result.licence.vehicleClasses.length > 0 ? (
              <section className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Entitlement classes
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {result.licence.vehicleClasses.map((entry) => (
                    <Badge key={entry} variant="secondary" size="sm">
                      {entry}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            <Separator />

            <LicenceDetails licence={result.licence} />

            {result.licence.redacted ? (
              <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <EyeOff className="mt-0.5 size-3.5 shrink-0" />
                The holder&rsquo;s name, parentage, addresses and blood group are hidden. Your role
                does not include access to personal licence data.
              </p>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              RTO record retrieved {new Date(result.retrievedAt).toLocaleString()}
              {result.providerReference ? ` · reference ${result.providerReference}` : ''}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
