import * as React from 'react';
import { Car, Download, RefreshCw, Search } from 'lucide-react';
import { RcDetailAccess, formatRegistrationNumber } from '@saarthi/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SecureUnlockDialog } from '@/features/secure-access/secure-unlock-dialog';
import { useSubjectQrCode } from '@/features/qr/subject-qr-panel';
import { useAuthedImage } from '@/features/qr/qr-code-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Panel } from '../detail/panel';
import { SWITCH_LIST_CLASS, SWITCH_TRIGGER_CLASS } from '../detail/section-switch';
import { MASKED_REASON, useRcLookup } from './use-rc-lookup';
import { VirtualRcPaper, type RcSide } from './virtual-rc-paper';

/**
 * The Virtual RC tab: the vehicle's RTO record, printed as a certificate.
 *
 * Every behaviour is the RC lookup's own (`useRcLookup`) — the free stored
 * record on open, a paid lookup only when asked, Refresh to bypass the cache,
 * the PDF download and the secure-PIN unlock. Only the presentation is new.
 */

function printedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function VirtualRc({
  vehicleId,
  registrationNumber,
  verified,
}: {
  vehicleId: string;
  registrationNumber: string;
  verified: boolean;
}) {
  const rc = useRcLookup(registrationNumber);
  const [side, setSide] = React.useState<RcSide>('front');
  const qr = useSubjectQrCode('VEHICLE', vehicleId);
  const { src: qrSrc } = useAuthedImage(qr.data ? `${qr.data.imageUrl}?size=160` : null);
  const plate = formatRegistrationNumber(registrationNumber);
  const result = rc.result;

  const body = (() => {
    if (rc.lookup.isPending) return <LoadingState label={rc.stage} />;
    if (rc.storedLoading) return <LoadingState label="Loading the RC…" />;
    if (rc.notFound) {
      return (
        <EmptyState
          icon={Car}
          title="No vehicle information found for this registration number."
          description="Newly registered vehicles can take a few days to appear in the RTO record."
        />
      );
    }
    if (rc.failure) return <ErrorState error={rc.failure} onRetry={() => rc.submit(false)} />;
    if (!result) {
      return (
        <Panel className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-[15px] font-semibold">No RC on file yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Pull the record from the RTO and it is printed here as this vehicle&rsquo;s Virtual RC.
            Repeat views are served from Saarthi&rsquo;s cache.
          </p>
          <Button className="mt-1 rounded-[12px]" onClick={() => rc.submit(false)}>
            <Search className="size-4" />
            Get details from the RTO
          </Button>
        </Panel>
      );
    }

    const asOf = printedDate(result.vehicle.dataAsOf ?? result.retrievedAt);
    const paper = (paperSide: RcSide) => (
      <div className="vrc-stage [container-type:inline-size]">
        <VirtualRcPaper
          record={result.vehicle}
          plate={plate}
          side={paperSide}
          verified={verified}
          qrSrc={qrSrc}
          asOf={asOf}
        />
      </div>
    );

    return (
      <Tabs value={side} onValueChange={(value) => setSide(value as RcSide)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="RC side" className={SWITCH_LIST_CLASS}>
            <TabsTrigger value="front" className={SWITCH_TRIGGER_CLASS}>
              Front · registration
            </TabsTrigger>
            <TabsTrigger value="back" className={SWITCH_TRIGGER_CLASS}>
              Back · vehicle
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted-foreground">
              Fetched from the RTO register · {printedDate(result.retrievedAt)}
            </span>
            {result.cached ? (
              <Badge variant="muted" size="sm">
                From Saarthi cache
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="rounded-[12px]"
              disabled={rc.lookup.isPending}
              onClick={() => rc.submit(true)}
              title="Bypass the cached record and query the RTO again"
            >
              <RefreshCw className={cn('size-4', rc.lookup.isPending && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              size="sm"
              className="rounded-[12px]"
              disabled={!rc.canDownload}
              onClick={rc.download}
              title={rc.downloadTitle}
            >
              <Download className="size-4" />
              {rc.downloading ? 'Preparing…' : 'Download RC'}
            </Button>
          </div>
        </div>

        {result.access !== RcDetailAccess.FULL ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-warning/10 py-2.5 pl-4 pr-3 text-sm">
            <span>{MASKED_REASON[result.access]}</span>
            {result.access === RcDetailAccess.LOCKED ? (
              <Button variant="outline" size="sm" className="rounded-[12px]" onClick={rc.unlockDetails}>
                Unlock
              </Button>
            ) : null}
          </div>
        ) : null}

        <TabsContent value="front" className="mt-0">
          {paper('front')}
        </TabsContent>
        <TabsContent value="back" className="mt-0">
          {paper('back')}
        </TabsContent>

        <p className="text-[11px] text-muted-foreground">
          RTO record retrieved {new Date(result.retrievedAt).toLocaleString('en-IN')}
          {result.vehicle.dataAsOf ? ` · provider data as of ${result.vehicle.dataAsOf}` : ''}
          {result.providerReference ? ` · reference ${result.providerReference}` : ''}
          {!result.pdfAvailable
            ? ' · No RC document was produced for this lookup; use Refresh to ask the provider again.'
            : ''}
        </p>
      </Tabs>
    );
  })();

  return (
    <div role="region" aria-label="Virtual RC">
      {body}
      <SecureUnlockDialog {...rc.unlockDialog} />
    </div>
  );
}
