import { useQueries } from '@tanstack/react-query';
import { Building2, CarFront, Download, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  PUBLIC_APPS,
  apkMegabytes,
  publicAppDownloadUrl,
  publicAppQuery,
  type PublicApp,
  type PublicAppRelease,
} from './public-apps';

const APP_ICONS: Record<PublicApp['id'], LucideIcon> = {
  driver: CarFront,
  owner: Building2,
};

/**
 * Both phone apps, one tap each, for the mobile menu.
 *
 * The menu is the only chrome a phone visitor has, and a phone is exactly where
 * these APKs install. A row appears only once its build is confirmed published,
 * and the block is not drawn at all when neither is: a download button that
 * fails is worse than an absent one. A placeholder holds the space while the
 * lookups are in flight, so the account buttons below do not jump.
 */
export function AppDownloadLinks({ className }: { className?: string }) {
  const releases = useQueries({ queries: PUBLIC_APPS.map((app) => publicAppQuery(app)) });

  const pending = releases.some((release) => release.isPending);
  const available = PUBLIC_APPS.flatMap((app, index) => {
    const release = releases[index]?.data;
    return release ? [{ app, release }] : [];
  });

  if (!pending && available.length === 0) return null;

  return (
    <section aria-labelledby="menu-apps-heading" className={cn('space-y-2.5', className)}>
      <div className="flex items-baseline justify-between px-1">
        <h2
          id="menu-apps-heading"
          className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
        >
          Get the apps
        </h2>
        <span className="text-2xs text-muted-foreground">Android 8 and later</span>
      </div>

      {pending ? (
        <div className="space-y-2" role="status" aria-label="Loading apps">
          {PUBLIC_APPS.map((app) => (
            <Skeleton key={app.id} className="h-[3.75rem] rounded-lg" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {available.map(({ app, release }) => (
            <li key={app.id}>
              <AppDownloadLink app={app} release={release} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AppDownloadLink({ app, release }: { app: PublicApp; release: PublicAppRelease }) {
  const Icon = APP_ICONS[app.id];

  return (
    // A plain link with `download`, so the phone's own download manager shows
    // the progress. The file name comes from the server and names the version
    // actually sent.
    <a
      href={publicAppDownloadUrl(app)}
      download
      className="group flex min-h-[3.75rem] items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors duration-200 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-[1.125rem]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          <span className="sr-only">Download </span>
          <span>{app.name}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {`${app.role} · ${apkMegabytes(release.sizeBytes)} MB`}
        </span>
      </span>
      <Download
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-y-0.5"
        aria-hidden
      />
    </a>
  );
}
