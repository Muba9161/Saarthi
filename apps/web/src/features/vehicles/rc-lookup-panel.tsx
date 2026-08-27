import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Car, Download, EyeOff, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import {
  formatRegistrationNumber,
  isPlausibleIndianRegistration,
  normalizeRegistrationNumber,
  type VehicleLookupResult,
} from '@saarthi/shared';
import { ApiError, absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { RcComplianceRows, RcRecordDetails } from '@/features/documents/rto-record-details';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Vehicle registration (RC) lookup.
 *
 * The panel is deliberately explicit about provenance: it shows whether the
 * answer came from Saarthi's cache or a fresh RTO call, and says plainly when
 * personal fields have been withheld from the signed-in user rather than
 * silently rendering blanks.
 */

/** The provider's own progress, narrated while the call is in flight. */
const LOOKUP_STAGES = [
  'Checking vehicle registration…',
  'Fetching RC details…',
  'Preparing RC document…',
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

export interface RcLookupPanelProps {
  /**
   * Look this vehicle up and nothing else.
   *
   * Set when the panel is embedded on a vehicle's own page: the plate is
   * already known, so the search box is replaced by a single button. Left
   * undefined on the standalone page, where the user types a plate.
   */
  registrationNumber?: string;
}

export function RcLookupPanel({ registrationNumber: fixedPlate }: RcLookupPanelProps = {}) {
  const queryClient = useQueryClient();
  const locked = Boolean(fixedPlate);
  const [input, setInput] = React.useState(fixedPlate ?? '');
  const [result, setResult] = React.useState<VehicleLookupResult | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  // Follow the vehicle if the surrounding page switches to another one.
  React.useEffect(() => {
    if (!fixedPlate) return;
    setInput(fixedPlate);
    setResult(null);
  }, [fixedPlate]);

  /**
   * Whatever Saarthi already holds for this vehicle.
   *
   * Costs nothing and never touches the provider, so the record a colleague
   * pulled last week is simply on screen — the operator only presses a button
   * when they want a *fresh* one.
   */
  const stored = useQuery({
    queryKey: ['vehicle-lookup', 'stored', fixedPlate],
    queryFn: () =>
      api.get<VehicleLookupResult | null>('/vehicles/lookups/latest', {
        registrationNumber: fixedPlate!,
      }),
    enabled: Boolean(fixedPlate),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    // A freshly fetched result always wins over the stored one.
    if (stored.data && !result) setResult(stored.data);
  }, [stored.data, result]);

  const lookup = useMutation({
    mutationFn: (variables: { registrationNumber: string; refresh: boolean }) =>
      api.post<VehicleLookupResult>('/vehicles/lookup', variables),
    onSuccess: (data) => {
      setResult(data);
      // Keep the stored copy in step, so leaving and returning shows this one.
      queryClient.setQueryData(['vehicle-lookup', 'stored', fixedPlate], data);
    },
    onError: (error) => {
      setResult(null);
      // 404 is a legitimate answer, not a failure worth a toast.
      if (error instanceof ApiError && error.status === 404) return;
      toast.error('Lookup failed', { description: errorMessage(error) });
    },
  });

  const stage = useLookupStage(lookup.isPending);

  const submit = (refresh: boolean): void => {
    const registrationNumber = normalizeRegistrationNumber(input);
    if (!isPlausibleIndianRegistration(registrationNumber)) {
      toast.error('Check the registration number', {
        description: 'That does not look like an Indian vehicle registration number.',
      });
      return;
    }
    lookup.mutate({ registrationNumber, refresh });
  };

  /**
   * The document route is authenticated, so the token travels with the fetch
   * rather than sitting in a URL the browser would keep in history.
   */
  const downloadRc = (lookupId: string, registrationNumber: string): void => {
    void (async () => {
      setDownloading(true);
      try {
        const response = await fetch(absoluteApiUrl(`/vehicles/lookups/${lookupId}/document`), {
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!response.ok) throw new Error('Download failed');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = `RC-${registrationNumber}.pdf`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch {
        toast.error('Could not download the RC document', {
          description: 'The document may no longer be available. Try running the lookup again.',
        });
      } finally {
        setDownloading(false);
      }
    })();
  };

  const notFound =
    lookup.error instanceof ApiError && lookup.error.status === 404 ? lookup.error : null;

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
              <Label htmlFor="rc-number">Registration number</Label>
              <Input
                id="rc-number"
                value={locked ? formatRegistrationNumber(input) : input}
                onChange={(event) => setInput(event.target.value.toUpperCase())}
                placeholder="UP32AB1234"
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
            <Button type="submit" disabled={lookup.isPending || input.trim().length === 0}>
              <Search className="size-4" />
              {locked ? 'Get details' : 'Search vehicle'}
            </Button>
            {result ? (
              <Button
                type="button"
                variant="outline"
                disabled={lookup.isPending}
                onClick={() => submit(true)}
                title="Bypass the cached record and query the RTO again"
              >
                <RefreshCw className={cn('size-4', lookup.isPending && 'animate-spin')} />
                Refresh
              </Button>
            ) : null}
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            {locked ? (
              <>
                Pulled live from the RTO record for this vehicle. Repeat lookups are served from
                Saarthi&rsquo;s cache; use Refresh to force a fresh check after a renewal.
              </>
            ) : (
              <>
                Lookups are limited to vehicles in your own fleet — add the vehicle first, then pull
                its RC record. Spaces and hyphens are fine:{' '}
                <span className="font-mono">up32 ab 1234</span> and{' '}
                <span className="font-mono">UP-32-AB-1234</span> both resolve to the same vehicle.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {lookup.isPending ? <LoadingState label={stage} /> : null}

      {notFound ? (
        <EmptyState
          icon={Car}
          title="No vehicle information found for this registration number."
          description="Check the number and try again. Newly registered vehicles can take a few days to appear in the RTO record."
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
                {formatRegistrationNumber(result.registrationNumber)}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {[result.vehicle.maker, result.vehicle.model].filter(Boolean).join(' ') ||
                  'Vehicle details not published'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {result.vehicle.registrationStatus ? (
                  <Badge
                    variant={
                      result.vehicle.registrationStatus.toUpperCase() === 'ACTIVE'
                        ? 'success'
                        : 'warning'
                    }
                    size="sm"
                  >
                    {result.vehicle.registrationStatus}
                  </Badge>
                ) : null}
                {result.vehicle.fuelType ? (
                  <Badge variant="secondary" size="sm">
                    {result.vehicle.fuelType}
                  </Badge>
                ) : null}
                {result.cached ? (
                  <Badge variant="muted" size="sm">
                    From Saarthi cache
                  </Badge>
                ) : null}
              </div>
            </div>

            <Button
              variant="gradient"
              disabled={!result.pdfAvailable || downloading}
              onClick={() => downloadRc(result.lookupId, result.registrationNumber)}
              title={
                result.pdfAvailable
                  ? 'Download the RC certificate'
                  : 'The provider did not produce a document for this vehicle'
              }
            >
              <Download className="size-4" />
              {downloading ? 'Preparing…' : 'Download RC'}
            </Button>
          </CardHeader>

          <CardContent className="space-y-5">
            <section className="space-y-1">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                Compliance
              </h3>
              <div className="divide-y divide-border">
                <RcComplianceRows record={result.vehicle} />
              </div>
            </section>

            <Separator />

            <RcRecordDetails record={result.vehicle} />

            {result.vehicle.redacted ? (
              <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <EyeOff className="mt-0.5 size-3.5 shrink-0" />
                Owner details, engine number and chassis number are hidden. Your role does not
                include access to personal vehicle data.
              </p>
            ) : null}

            {!result.pdfAvailable ? (
              <p className="text-xs text-muted-foreground">
                No RC document was produced for this lookup. Use Refresh to ask the provider again.
              </p>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              RTO record retrieved {new Date(result.retrievedAt).toLocaleString()}
              {result.vehicle.dataAsOf ? ` · provider data as of ${result.vehicle.dataAsOf}` : ''}
              {result.providerReference ? ` · reference ${result.providerReference}` : ''}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
