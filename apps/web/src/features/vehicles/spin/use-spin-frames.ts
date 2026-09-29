import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { fetchMediaBlob } from '@/features/media/fetch-media';
import type { MediaAsset } from '@/features/media/photo-uploader';
import { spinQueryKey } from './spin-api';

/** Object URLs for local frames, revoked when the frames change or unmount. */
export function useBlobUrls(blobs: readonly Blob[] | null): string[] {
  const [urls, setUrls] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!blobs || blobs.length === 0) {
      setUrls([]);
      return undefined;
    }
    const created = blobs.map((blob) => URL.createObjectURL(blob));
    setUrls(created);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, [blobs]);

  return urls;
}

export interface VehicleSpin {
  /** The stored frames, in display order. */
  assets: MediaAsset[];
  /** Object URLs for every frame, once all of them have arrived. */
  frames: string[];
  /** Fraction of frames downloaded so far, for the loading bar. */
  loaded: number;
  status: 'loading' | 'ready' | 'empty' | 'error';
  refetch: () => void;
}

/**
 * A vehicle's stored spin, downloaded whole before it is shown.
 *
 * All frames are fetched up front because a spin that stalls mid-drag while
 * the next frame arrives reads as broken. The bytes go through the session
 * like every other private image (`fetchMediaBlob`), and are held as object
 * URLs released on unmount.
 */
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
  const idsKey = assets.map((asset) => asset.id).join(',');

  const [frames, setFrames] = React.useState<string[]>([]);
  const [loaded, setLoaded] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFrames([]);
    setLoaded(0);
    setFailed(false);
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) return undefined;

    const controller = new AbortController();
    const created: string[] = [];
    let done = 0;

    void Promise.all(
      ids.map(async (id) => {
        const blob = await fetchMediaBlob(id, { signal: controller.signal });
        done += 1;
        if (!controller.signal.aborted) setLoaded(done / ids.length);
        return blob;
      }),
    )
      .then((blobs) => {
        if (controller.signal.aborted) return;
        created.push(...blobs.map((blob) => URL.createObjectURL(blob)));
        setFrames([...created]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });

    return () => {
      controller.abort();
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [idsKey]);

  const status: VehicleSpin['status'] =
    list.isError || failed
      ? 'error'
      : list.isPending
        ? 'loading'
        : assets.length === 0
          ? 'empty'
          : frames.length === assets.length
            ? 'ready'
            : 'loading';

  return { assets, frames, loaded, status, refetch: () => void list.refetch() };
}
