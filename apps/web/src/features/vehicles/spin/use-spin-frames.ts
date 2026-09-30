import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { fetchMediaBlob } from '@/features/media/fetch-media';
import type { MediaAsset } from '@/features/media/photo-uploader';
import { spinQueryKey } from './spin-api';

/** Parallel frame downloads — the browser's own per-host connection limit. */
const FETCH_CONCURRENCY = 6;
/** Full-size frames kept decoded at once; the rest are released as you turn. */
const HI_RES_CACHE_SIZE = 8;

/**
 * Object URLs for local blobs.
 *
 * Each blob keeps its URL for as long as it is in the list, so re-ordering a
 * draft (reversing it, dropping a frame) never re-creates the URLs of frames
 * that did not change. URLs are revoked the moment their blob leaves the list.
 */
export function useBlobUrls(blobs: readonly Blob[]): string[] {
  const cache = React.useRef(new Map<Blob, string>());
  const [urls, setUrls] = React.useState<string[]>([]);

  React.useEffect(() => {
    const owned = cache.current;
    return () => {
      owned.forEach((url) => URL.revokeObjectURL(url));
      owned.clear();
    };
  }, []);

  React.useEffect(() => {
    const owned = cache.current;
    const live = new Set(blobs);
    for (const [blob, url] of owned) {
      if (!live.has(blob)) {
        URL.revokeObjectURL(url);
        owned.delete(blob);
      }
    }
    setUrls(
      blobs.map((blob) => {
        const existing = owned.get(blob);
        if (existing) return existing;
        const created = URL.createObjectURL(blob);
        owned.set(blob, created);
        return created;
      }),
    );
  }, [blobs]);

  return urls;
}

export interface VehicleSpin {
  /** The stored frames, in display order. */
  assets: MediaAsset[];
  status: 'loading' | 'ready' | 'empty' | 'error';
  refetch: () => void;
}

/** Which frames a vehicle's spin is made of. The images themselves load separately. */
export function useVehicleSpin(vehicleId: string): VehicleSpin {
  const list = useQuery({
    queryKey: spinQueryKey(vehicleId),
    queryFn: () =>
      api.get<MediaAsset[]>(`/media/owner/${MediaOwnerType.VEHICLE.toLowerCase()}/${vehicleId}`, {
        purpose: MediaPurpose.VEHICLE_SPIN_FRAME,
      }),
    enabled: Boolean(vehicleId),
  });

  const assets = React.useMemo(() => list.data ?? [], [list.data]);
  const status: VehicleSpin['status'] = list.isError
    ? 'error'
    : list.isPending
      ? 'loading'
      : assets.length === 0
        ? 'empty'
        : 'ready';

  return { assets, status, refetch: () => void list.refetch() };
}

export interface SpinFrameSources {
  /** Small frames in display order; `null` until each one arrives. */
  frames: (string | null)[];
  /** Fraction of small frames downloaded. */
  loaded: number;
  failed: boolean;
  retry: () => void;
  /** A full-size frame on demand — for when the turning stops, or on zoom. */
  resolveHiRes: (index: number) => Promise<string>;
}

/**
 * The images of a stored spin, loaded progressively.
 *
 * Thumbnails only, and the opening view first: the viewer can be shown and
 * turned while the rest are still arriving. Full-size frames are fetched one
 * at a time, only for the angles somebody actually stops on, and only a few
 * are kept — a spin that is turned end to end never holds two dozen full-size
 * images in memory.
 *
 * Every request goes through the session like other private images
 * (`fetchMediaBlob`), and the browser's HTTP cache answers repeat visits.
 */
export function useSpinFrameSources(assetIds: readonly string[]): SpinFrameSources {
  const idsKey = assetIds.join(',');
  const [frames, setFrames] = React.useState<(string | null)[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const hiRes = React.useRef(new Map<string, Promise<string>>());

  React.useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    setFrames(ids.map(() => null));
    setFailed(false);
    if (ids.length === 0) return undefined;

    const controller = new AbortController();
    const created: string[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < ids.length && !controller.signal.aborted) {
        const index = next;
        next += 1;
        const id = ids[index];
        if (!id) continue;
        const blob = await fetchMediaBlob(id, {
          variant: 'thumbnail',
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        created.push(url);
        setFrames((previous) => {
          const updated = [...previous];
          updated[index] = url;
          return updated;
        });
      }
    };

    // Index 0 is claimed first by the first worker, so the opening view is
    // always the first request on the wire.
    void Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) }, worker)).catch(
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );

    return () => {
      controller.abort();
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [idsKey, attempt]);

  // Full-size frames belong to this set of ids; a new spin starts a new cache.
  React.useEffect(() => {
    const cache = hiRes.current;
    return () => {
      cache.forEach(
        (pending) =>
          void pending.then(
            (url) => URL.revokeObjectURL(url),
            () => undefined,
          ),
      );
      cache.clear();
    };
  }, [idsKey]);

  const resolveHiRes = React.useCallback(
    (index: number): Promise<string> => {
      const id = idsKey.split(',')[index];
      if (!id) return Promise.reject(new Error('No such frame.'));

      const cache = hiRes.current;
      const cached = cache.get(id);
      if (cached) {
        // Re-inserted to mark it most recently used.
        cache.delete(id);
        cache.set(id, cached);
        return cached;
      }

      const pending = fetchMediaBlob(id).then((blob) => URL.createObjectURL(blob));
      // A failed fetch is not remembered, so the next stop on this angle retries.
      pending.catch(() => cache.delete(id));
      cache.set(id, pending);

      while (cache.size > HI_RES_CACHE_SIZE) {
        const [oldestId, oldest] = cache.entries().next().value as [string, Promise<string>];
        cache.delete(oldestId);
        void oldest.then(
          (url) => URL.revokeObjectURL(url),
          () => undefined,
        );
      }
      return pending;
    },
    [idsKey],
  );

  const loadedCount = frames.filter(Boolean).length;
  return {
    frames,
    loaded: frames.length === 0 ? 0 : loadedCount / frames.length,
    failed,
    retry: () => setAttempt((value) => value + 1),
    resolveHiRes,
  };
}
