import { toast } from 'sonner';
import { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';
import { uploadImage } from '@/features/media/upload-image';
import type { SpinFrame } from './spin-frames';

/**
 * A 360° spin, stored as ordinary media: one asset per frame, under the
 * vehicle, in their own purpose, ordered by `sortOrder`, each carrying its own
 * thumbnail. No endpoint of its own — the media library already does
 * everything a spin needs.
 */

/** Frames in flight at once: quicker than one at a time, gentle on a weak signal. */
const UPLOAD_CONCURRENCY = 3;
/** Tries per frame before the whole upload is given up. */
const UPLOAD_ATTEMPTS = 3;
const RETRY_BASE_MS = 600;

export function spinQueryKey(vehicleId: string) {
  return ['media', MediaOwnerType.VEHICLE, vehicleId, MediaPurpose.VEHICLE_SPIN_FRAME] as const;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Worth trying again: the network dropped, or the server was busy — never a refusal. */
function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Upload cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Deletes every frame given; a spin is removed whole or not at all. */
export async function removeSpin(frameIds: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(frameIds.map((id) => api.delete(`/media/${id}`)));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

async function uploadFrame(
  vehicleId: string,
  frame: SpinFrame,
  index: number,
  signal: AbortSignal,
): Promise<string> {
  const name = `spin-${String(index + 1).padStart(2, '0')}.jpg`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const uploaded = await uploadImage({
        ownerType: MediaOwnerType.VEHICLE,
        ownerId: vehicleId,
        purpose: MediaPurpose.VEHICLE_SPIN_FRAME,
        file: new File([frame.full], name, { type: 'image/jpeg' }),
        thumbnail: frame.thumb,
        sortOrder: index,
        signal,
      });
      return uploaded.id;
    } catch (error) {
      if (attempt >= UPLOAD_ATTEMPTS || !isTransient(error)) throw error;
      await pause(RETRY_BASE_MS * 2 ** (attempt - 1), signal);
    }
  }
}

/**
 * Upload a spin's frames.
 *
 * A few at a time, each retried on a dropped connection, and ordered by
 * `sortOrder` rather than by arrival. If any frame finally fails — or the
 * upload is cancelled — the others are stopped and whatever already landed is
 * taken back off, so a vehicle is never left with half a spin that looks like
 * a broken one.
 */
export async function uploadSpin(
  vehicleId: string,
  frames: readonly SpinFrame[],
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });

  const stored: string[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted && next < frames.length) {
      const index = next;
      next += 1;
      const frame = frames[index];
      if (!frame) continue;
      stored.push(await uploadFrame(vehicleId, frame, index, controller.signal));
      onProgress?.(stored.length / frames.length);
    }
  };

  const results = await Promise.allSettled(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, frames.length) }, () =>
      // The first failure stops its siblings rather than letting them carry on.
      worker().catch((error: unknown) => {
        controller.abort();
        throw error;
      }),
    ),
  );
  signal?.removeEventListener('abort', cancel);

  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failures.length === 0 && !controller.signal.aborted) return;

  // Best effort: the failure being reported matters more than the clean-up's.
  await removeSpin(stored).catch(() => undefined);
  throw (
    failures.find((error) => !isAbortError(error)) ??
    new DOMException('Upload cancelled.', 'AbortError')
  );
}

/**
 * The same upload for a record that has only just been saved — a failed spin
 * must not read as a failed save, so it reports instead of throwing.
 */
export async function uploadSpinOrWarn(
  vehicleId: string,
  frames: readonly SpinFrame[],
): Promise<void> {
  try {
    await uploadSpin(vehicleId, frames);
  } catch {
    toast.error('The vehicle was added, but its 360° spin could not be saved.', {
      description: 'You can add it from the vehicle’s Photos tab at any time.',
    });
  }
}
