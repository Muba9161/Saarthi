import * as React from 'react';
import { Car, Download, EyeOff, LockKeyhole, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { RcDetailAccess, formatRegistrationNumber } from '@saarthi/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { RcComplianceRows, RcRecordDetails } from '@/features/documents/rto-record-details';
import { SecureUnlockDialog } from '@/features/secure-access/secure-unlock-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { MASKED_REASON, useRcLookup } from './rc/use-rc-lookup';

/**
 * Vehicle registration (RC) lookup.
 *
 * The panel is deliberately explicit about provenance: it shows whether the
 * answer came from Saarthi's cache or a fresh RTO call, and says plainly when
 * personal fields have been withheld from the signed-in user rather than
 * silently rendering blanks.
 */

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
  const locked = Boolean(fixedPlate);
  const {
    input,
    setInput,
    result,
    lookup,
    stage,
    notFound,
    failure,
    submit,
    downloading,
    canDownload,
    downloadTitle,
    download,
    unlockDetails,
    unlockDialog,
  } = useRcLookup(fixedPlate);

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
                Lookups are limited to vehicles in your own fleet - add the vehicle first, then pull
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

      {failure ? <ErrorState error={failure} onRetry={() => submit(false)} /> : null}

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
              disabled={!canDownload}
              onClick={download}
              title={downloadTitle}
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

            {result.access !== RcDetailAccess.FULL ? (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2 sm:flex-row sm:items-center">
                <p className="flex flex-1 items-start gap-2 text-xs text-muted-foreground">
                  <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {MASKED_REASON[result.access]}
                </p>
                {result.access === RcDetailAccess.LOCKED ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={unlockDetails}
                  >
                    <LockKeyhole className="size-4" aria-hidden />
                    Unlock full details
                  </Button>
                ) : null}
              </div>
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

      <SecureUnlockDialog {...unlockDialog} />
    </div>
  );
}
