import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Magnetic } from '../magnetic';
import { Reveal } from '../motion-extras';
import { apkMegabytes, publicAppDownloadUrl, publicAppQuery, type PublicApp } from './public-apps';

/**
 * A band's "download the app" call to action, for either phone app.
 *
 * A plain link to the APK rather than the dashboard card's fetch-and-save, so
 * the phone's own download manager shows the progress and the address can be
 * long-pressed and shared to somebody who is not here.
 *
 * Renders nothing until a published build is confirmed, and nothing if there
 * is none or the API cannot be reached: a download button that fails is worse
 * than an absent one.
 */
export function AppDownload({
  app,
  label = 'Download for Android',
  audience,
  align = 'start',
  onDark = false,
  className,
}: {
  app: PublicApp;
  label?: string;
  /** Who should take this app, when the band around it does not already say. */
  audience?: string;
  /** `center` stacks the details under the button, for a centred heading. */
  align?: 'start' | 'center';
  /** The photographic stage bands are near-black in either theme. */
  onDark?: boolean;
  className?: string;
}) {
  const release = useQuery(publicAppQuery(app));

  const published = release.data;
  if (!published) return null;

  return (
    <Reveal
      delay={0.2}
      className={cn(
        'flex flex-col gap-4',
        align === 'center' ? 'items-center text-center' : 'sm:flex-row sm:items-center sm:gap-6',
        className,
      )}
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
          <a href={publicAppDownloadUrl(app)} download>
            <Download
              className="size-4 transition-transform duration-200 group-hover:translate-y-0.5"
              aria-hidden
            />
            <span>{label}</span>
          </a>
        </Button>
      </Magnetic>

      {/* Said before they tap it, not discovered afterwards: a visitor who
          was not told Android will ask assumes the download went wrong. */}
      <p
        className={cn(
          'text-xs leading-relaxed',
          onDark ? 'text-white/55' : 'text-muted-foreground',
        )}
      >
        {audience ? (
          <span className={cn('block font-medium', onDark ? 'text-white/75' : 'text-foreground/80')}>
            {audience}
          </span>
        ) : null}
        <span className="block">
          {`Version ${published.versionName} · ${apkMegabytes(published.sizeBytes)} MB · Android 8 and later`}
        </span>
        <span className={cn('block', onDark ? 'text-white/40' : 'text-muted-foreground/75')}>
          Installed directly rather than from the Play Store, so your phone will ask you to allow it.
        </span>
      </p>
    </Reveal>
  );
}
