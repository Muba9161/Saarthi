import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Info, ScanLine, Tablet } from 'lucide-react';
import { Permission, readScannedQr, type TerminalSessionView } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { QrCameraScanner } from '@/features/qr/qr-camera-scanner';
import { DriverSignOnCard } from '@/features/terminal/driver-signon-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Scan a vehicle to sign on.
 *
 * The driver's entry point into the terminal handshake. Until this page existed
 * the only way in was to leave Saarthi, use the phone's own camera app, and
 * hope the link opened in the browser the driver happened to be signed in to —
 * which on a work phone with two browsers often it did not. The sign-on card
 * simply would not appear, with nothing on screen to explain why.
 *
 * A scan is not authorisation, here or anywhere. It resolves the vehicle and
 * opens a request; a named person still has to approve it. That is why a
 * successful scan hands straight over to the ordinary scan result rather than
 * doing anything clever of its own — one screen for what a Saarthi code means,
 * whoever scanned it.
 */

/** How long a rejection stays on screen before the scanner resumes. */
const REJECTION_MS = 6_000;

export function DriverScanPage(): React.ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [rejection, setRejection] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState('');

  /*
   * A driver with a request already under way should be shown it rather than
   * left to scan a second vehicle and be refused by the API. It is also where
   * they come back to for the arrival photo, so the request is not something
   * they can only reach by scanning again.
   */
  const mine = useQuery({
    queryKey: ['terminal', 'my-session'],
    queryFn: () => api.get<TerminalSessionView | null>('/terminal/assignments/mine'),
    enabled: can(Permission.TERMINAL_READ),
    refetchInterval: 20_000,
  });

  React.useEffect(() => {
    if (!rejection) return undefined;
    const timer = window.setTimeout(() => setRejection(null), REJECTION_MS);
    return () => window.clearTimeout(timer);
  }, [rejection]);

  /**
   * Act on a decoded code.
   *
   * Every outcome says something. A scanner that stays silent on a code it
   * cannot use is indistinguishable from a scanner that is not working, and the
   * driver's next move — hold it steadier, wipe the sticker, give up — depends
   * entirely on which of those it is.
   */
  const handle = React.useCallback(
    (raw: string) => {
      const scanned = readScannedQr(raw);

      if (scanned.kind === 'IDENTITY') {
        navigate(`/q/${scanned.token}`);
        return;
      }

      if (scanned.kind === 'PAIRING') {
        setRejection(
          scanned.target === 'TERMINAL'
            ? 'That is the terminal’s own setup code, shown on the dashboard while a tablet is being fitted. Scan the vehicle QR the terminal is displaying instead.'
            : 'That is a device pairing code, meant for the Saarthi Device app. Scan the vehicle QR instead.',
        );
        return;
      }

      setRejection(
        'That is not a Saarthi vehicle code. Scan the QR on the terminal or the windscreen sticker.',
      );
    },
    [navigate],
  );

  const active = mine.data ?? null;

  return (
    <div className="mx-auto max-w-md space-y-5">
      <PageHeader
        title="Scan a vehicle"
        description="Point your camera at the QR on the terminal or the windscreen to ask to be signed on."
      />

      {/*
        A request already under way takes the top of the screen, and carries its
        own next step — the arrival photo, the submission, the wait. Without a
        `qrToken` the card cannot open a new request, which is correct here:
        nothing has been scanned yet.
      */}
      {active ? <DriverSignOnCard registrationNumber={active.registrationNumber} /> : null}

      {rejection ? (
        <Alert variant="warning">
          <Tablet />
          <AlertTitle>That is not a vehicle code</AlertTitle>
          <AlertDescription>{rejection}</AlertDescription>
        </Alert>
      ) : null}

      {/* Paused while a rejection is up, so a code still in frame is not read
          straight back and the driver has time to read what went wrong. */}
      <QrCameraScanner onDecode={handle} paused={rejection !== null} />

      <Alert variant="info">
        <Info />
        <AlertTitle>Scanning does not sign you on</AlertTitle>
        <AlertDescription>
          It tells your fleet you are at the vehicle. Someone still has to approve you, and the
          safety check on the terminal has to pass before you drive.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-sm font-medium">Camera not working?</p>
          <p className="text-xs text-muted-foreground">
            Paste the scan link — the address the sticker opens. It is too long to type from
            memory, so ask your manager to send it to you.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handle(typed);
            }}
          >
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="https://…/q/…"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="secondary" disabled={typed.trim().length === 0}>
              <ScanLine className="mr-1.5 size-3.5" />
              Open
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default DriverScanPage;
