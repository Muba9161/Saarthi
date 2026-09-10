import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Smartphone } from 'lucide-react';
import { Permission } from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Get Saarthi onto the driver's phone.
 *
 * The first thing a driver needs after registering, and until now the one thing
 * they had no way to obtain: the app is not on the Play Store, so a newly
 * registered driver's next step was to telephone somebody and ask for a file.
 *
 * Shown only to people who may actually drive — the same permission that lets
 * somebody sign on to a vehicle. A dispatcher or an accountant has no use for it
 * and would only wonder what it was.
 *
 * Renders nothing when no release is published. A download button that fails is
 * worse than an absent one, and a fleet in the middle of its first rollout will
 * have days where there is genuinely nothing to offer.
 */

interface DriverAppRelease {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  sha256: string;
  notes: string | null;
  publishedAt: string | null;
}

export function DriverAppCard() {
  const { can } = useAuth();
  const eligible = can(Permission.TERMINAL_DRIVE);
  const [progress, setProgress] = React.useState<number | null>(null);

  const release = useQuery({
    queryKey: ['/terminal/driver-app'],
    queryFn: () => api.get<DriverAppRelease | null>('/terminal/driver-app'),
    enabled: eligible,
    // The answer changes when somebody publishes a build, which is rarely.
    staleTime: 5 * 60_000,
  });

  const app = release.data;

  /**
   * Fetch the APK with the session token, then hand it to the browser.
   *
   * The same shape as the document download: the route is authenticated, so the
   * token travels in a header rather than sitting in a URL the browser would
   * keep in its history and hand to anybody who opened the address bar.
   *
   * Progress is reported because this is forty megabytes rather than a PDF, and
   * a driver on a yard's connection needs to see that something is happening —
   * a button that appears to do nothing for two minutes gets pressed again.
   */
  const download = (): void => {
    if (!app) return;

    void (async () => {
      setProgress(0);
      try {
        const response = await fetch(absoluteApiUrl('/terminal/driver-app/download'), {
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!response.ok) throw new Error('The download was refused.');

        const total = Number(response.headers.get('content-length') ?? 0);
        const reader = response.body?.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;

        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value as unknown as BlobPart);
              received += value.byteLength;
              // Indeterminate when a proxy stripped the length: a bar that is
              // guessing is worse than one that admits it does not know.
              if (total > 0) setProgress(Math.round((received / total) * 100));
            }
          }
        } else {
          chunks.push(await response.blob());
        }

        const url = URL.createObjectURL(new Blob(chunks));
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = `saarthi-driver-${app.versionName}.apk`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch (error) {
        toast.error('Could not download the app', { description: errorMessage(error) });
      } finally {
        setProgress(null);
      }
    })();
  };

  if (!eligible || !app) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Smartphone className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-medium">Saarthi on your phone</p>
            <p className="text-sm text-muted-foreground">
              Sign on to a vehicle, complete your safety check and run trips from the cab -
              without opening this dashboard.
            </p>
            <p className="text-xs text-muted-foreground">
              Version {app.versionName} · {Math.round(app.sizeBytes / 1_000_000)} MB · Android 8
              and later
            </p>
            {app.notes ? <p className="text-xs text-muted-foreground">{app.notes}</p> : null}
            {/*
              Said before they tap it, not discovered afterwards. Android asks
              permission to install a file from outside the Play Store, and a
              driver who was not told assumes the download went wrong.
            */}
            <p className="text-xs text-muted-foreground">
              Your phone will ask you to allow the install - that is normal for a fleet app.
            </p>
          </div>
        </div>

        <Button onClick={download} disabled={progress !== null} className="shrink-0">
          <Download className="size-4" />
          {progress === null
            ? 'Download app'
            : progress > 0
              ? `Downloading ${progress}%`
              : 'Starting…'}
        </Button>
      </CardContent>
    </Card>
  );
}

export default DriverAppCard;
