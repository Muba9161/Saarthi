import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { absoluteApiUrl, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Magnetic } from '../magnetic';
import { Reveal } from '../motion-extras';

/** What the public endpoint says about the newest published driver app. */
interface PublicDriverApp {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  publishedAt: string | null;
}

const DRIVER_APP_PATH = '/driver-app/public';

/**
 * "Download for Android", for anybody reading about Humsafar.
 *
 * A plain link to the APK rather than the dashboard card's fetch-and-save, so
 * the phone's own download manager shows the progress and the address can be
 * long-pressed and shared to a driver who is not here.
 *
 * Renders nothing until a published build is confirmed, and nothing if there
 * is none or the API cannot be reached: a download button that fails is worse
 * than an absent one.
 */
export function DriverAppDownload({ className }: { className?: string }) {
  const release = useQuery({
    queryKey: [DRIVER_APP_PATH],
    queryFn: () => api.get<PublicDriverApp | null>(DRIVER_APP_PATH),
    // The answer changes when somebody publishes a build, which is rarely.
    staleTime: 5 * 60_000,
  });

  const app = release.data;
  if (!app) return null;

  const megabytes = Math.max(1, Math.round(app.sizeBytes / 1_000_000));

  return (
    <Reveal
      delay={0.2}
      className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6', className)}
    >
      <Magnetic className="w-full sm:w-auto">
        <Button
          size="lg"
          variant="gradient"
          asChild
          className="group w-full rounded-full sm:w-auto"
        >
          {/* The file name comes from the server, so it always names the
              version actually sent. */}
          <a href={absoluteApiUrl(`${DRIVER_APP_PATH}/download`)} download>
            <Download
              className="size-4 transition-transform duration-200 group-hover:translate-y-0.5"
              aria-hidden
            />
            <span>Download for Android</span>
          </a>
        </Button>
      </Magnetic>

      {/* Said before they tap it, not discovered afterwards: a visitor who
          was not told Android will ask assumes the download went wrong. */}
      <p className="text-xs leading-relaxed text-white/55">
        <span className="block">{`Version ${app.versionName} · ${megabytes} MB · Android 8 and later`}</span>
        <span className="block text-white/40">
          Installed directly rather than from the Play Store, so your phone will ask you to allow it.
        </span>
      </p>
    </Reveal>
  );
}
