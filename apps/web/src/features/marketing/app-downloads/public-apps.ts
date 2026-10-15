import { queryOptions } from '@tanstack/react-query';
import { absoluteApiUrl, api } from '@/lib/api-client';

/**
 * The phone apps the public site offers as direct downloads.
 *
 * One place says where each app's public endpoint is and what it is called, so
 * the driver band and the mobile menu can never point at different builds.
 */

/** What a public endpoint says about the newest published build of an app. */
export interface PublicAppRelease {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  publishedAt: string | null;
}

export interface PublicApp {
  id: 'driver' | 'owner';
  /** The public lookup; the APK itself is at `${path}/download`. */
  path: string;
  /** The app's own name, exactly as the phone's home screen shows it once installed. */
  name: string;
  /** Who it is for, so a visitor knows which of the two to take. */
  role: string;
}

export const DRIVER_APP: PublicApp = {
  id: 'driver',
  path: '/driver-app/public',
  name: 'Humsafar',
  role: 'Driver app',
};

export const OWNER_APP: PublicApp = {
  id: 'owner',
  path: '/owner-app/public',
  name: 'VorldX Saarthi',
  role: 'Owner app',
};

export const PUBLIC_APPS: readonly PublicApp[] = [DRIVER_APP, OWNER_APP];

/**
 * The newest published build of one app, or `null` when there is none.
 *
 * Keyed by the path so every surface asking about the same app shares one
 * request and one cached answer.
 */
export function publicAppQuery(app: PublicApp) {
  return queryOptions({
    queryKey: [app.path],
    queryFn: () => api.get<PublicAppRelease | null>(app.path),
    // The answer changes when somebody publishes a build, which is rarely.
    staleTime: 5 * 60_000,
  });
}

/** A plain link to the APK, so the phone's own download manager shows progress. */
export function publicAppDownloadUrl(app: PublicApp): string {
  return absoluteApiUrl(`${app.path}/download`);
}

/** Whole megabytes, never zero: nobody reasons about an APK in bytes. */
export function apkMegabytes(sizeBytes: number): number {
  return Math.max(1, Math.round(sizeBytes / 1_000_000));
}
