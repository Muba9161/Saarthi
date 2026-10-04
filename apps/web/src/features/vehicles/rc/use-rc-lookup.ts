import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ErrorCode,
  RcDetailAccess,
  isPlausibleIndianRegistration,
  normalizeRegistrationNumber,
  type VehicleLookupResult,
} from '@saarthi/shared';
import { ApiError, absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';

/**
 * Everything an RC lookup does, without how it looks.
 *
 * Two screens render an RC: the lookup page (a search box and a record card)
 * and a vehicle's Virtual RC (the record as a printed certificate). They share
 * this one implementation of the stored-record read, the fresh and forced
 * lookups, the PDF download and the secure-PIN unlock, so the two can never
 * disagree about what a caller may see or when a lookup is charged.
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

/**
 * Why the owner's details are masked, in words the reader can act on — never
 * "hidden" with no reason, and never a suggestion to pay for a refresh that
 * would come back masked too.
 */
export const MASKED_REASON: Record<Exclude<RcDetailAccess, 'FULL'>, string> = {
  [RcDetailAccess.NOT_PERMITTED]:
    'Owner details, engine number and chassis number are hidden. Your role does not include access to personal vehicle data.',
  [RcDetailAccess.OWNERSHIP_REQUIRED]:
    'Owner details are masked because this account has not confirmed it owns the vehicle. The RC owner’s name has to match a verified PAN, Voter ID or business GSTIN on the account — the vehicle’s Ownership card shows where it stands.',
  [RcDetailAccess.LOCKED]:
    'Owner details are masked. Enter your secure PIN to see them in full and download the certificate.',
};

export function useRcLookup(fixedPlate?: string) {
  const queryClient = useQueryClient();
  const [input, setInput] = React.useState(fixedPlate ?? '');
  const [result, setResult] = React.useState<VehicleLookupResult | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  /** What to do once the PIN is in: reload the record, or retry a download. */
  const afterUnlock = React.useRef<() => void>(() => undefined);

  const requestUnlock = (then: () => void): void => {
    afterUnlock.current = then;
    setUnlockOpen(true);
  };

  /** Read the stored record again, now that this session may see more of it. */
  const reloadRecord = async (registrationNumber: string): Promise<void> => {
    try {
      const fresh = await api.get<VehicleLookupResult | null>('/vehicles/lookups/latest', {
        registrationNumber,
      });
      if (fresh) {
        setResult(fresh);
        queryClient.setQueryData(['vehicle-lookup', 'stored', fixedPlate], fresh);
      }
    } catch (error) {
      toast.error('Could not load the full record', { description: errorMessage(error) });
    }
  };

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
        if (response.status === 403) {
          const body = (await response.json().catch(() => null)) as {
            error?: { code?: string };
          } | null;
          // The unlock window ran out between showing the button and pressing it.
          if (body?.error?.code === ErrorCode.SECURE_ACCESS_REQUIRED) {
            requestUnlock(() => downloadRc(lookupId, registrationNumber));
            return;
          }
        }
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

  /** Whether the certificate PDF can be fetched by this caller right now. */
  const canDownload = Boolean(
    result &&
      result.pdfAvailable &&
      !downloading &&
      result.access !== RcDetailAccess.NOT_PERMITTED &&
      result.access !== RcDetailAccess.OWNERSHIP_REQUIRED,
  );

  const downloadTitle = !result?.pdfAvailable
    ? 'The provider did not produce a document for this vehicle'
    : result.access === RcDetailAccess.OWNERSHIP_REQUIRED
      ? 'Available once this account has confirmed it owns the vehicle'
      : 'Download the RC certificate';

  /** Download, asking for the secure PIN first when the record is locked. */
  const download = (): void => {
    if (!result) return;
    if (result.access === RcDetailAccess.LOCKED) {
      requestUnlock(() => {
        void reloadRecord(result.registrationNumber);
        downloadRc(result.lookupId, result.registrationNumber);
      });
      return;
    }
    downloadRc(result.lookupId, result.registrationNumber);
  };

  /** Ask for the secure PIN, then reload the record unmasked. */
  const unlockDetails = (): void => {
    if (!result) return;
    requestUnlock(() => void reloadRecord(result.registrationNumber));
  };

  return {
    input,
    setInput,
    result,
    storedLoading: stored.isLoading,
    lookup,
    stage,
    notFound,
    /** A failure other than "no such vehicle". */
    failure: lookup.error && !notFound ? lookup.error : null,
    submit,
    downloading,
    canDownload,
    downloadTitle,
    download,
    unlockDetails,
    /** Spread onto `SecureUnlockDialog`. */
    unlockDialog: {
      open: unlockOpen,
      onOpenChange: setUnlockOpen,
      purpose: 'see the full RC',
      onUnlocked: () => afterUnlock.current(),
    },
  };
}
