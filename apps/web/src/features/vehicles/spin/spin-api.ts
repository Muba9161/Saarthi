import { toast } from 'sonner';
import { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { uploadImage } from '@/features/media/upload-image';

/**
 * A 360° spin, stored as ordinary media: one asset per frame, under the
 * vehicle, in their own purpose, ordered by `sortOrder`. No endpoint of its
 * own — the media library already does everything a spin needs.
 */

export function spinQueryKey(vehicleId: string) {
  return ['media', MediaOwnerType.VEHICLE, vehicleId, MediaPurpose.VEHICLE_SPIN_FRAME] as const;
}

/** Deletes every frame given; a spin is removed whole or not at all. */
export async function removeSpin(frameIds: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(frameIds.map((id) => api.delete(`/media/${id}`)));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/**
 * Upload a spin's frames, in order.
 *
 * Sequential for the same reason `PhotoUploader` is: over a weak connection,
 * two dozen parallel uploads fail together. If one fails part-way, the frames
 * already stored are taken back off, so a vehicle is never left with half a
 * spin that looks like a broken one.
 */
export async function uploadSpin(
  vehicleId: string,
  frames: readonly Blob[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const stored: string[] = [];
  try {
    for (const [index, frame] of frames.entries()) {
      const name = `spin-${String(index + 1).padStart(2, '0')}.jpg`;
      const uploaded = await uploadImage({
        ownerType: MediaOwnerType.VEHICLE,
        ownerId: vehicleId,
        purpose: MediaPurpose.VEHICLE_SPIN_FRAME,
        file: new File([frame], name, { type: 'image/jpeg' }),
        sortOrder: index,
      });
      stored.push(uploaded.id);
      onProgress?.((index + 1) / frames.length);
    }
  } catch (error) {
    await removeSpin(stored).catch(() => undefined);
    throw error;
  }
}

/**
 * The same upload for a record that has only just been saved — a failed spin
 * must not read as a failed save, so it reports instead of throwing.
 */
export async function uploadSpinOrWarn(vehicleId: string, frames: readonly Blob[]): Promise<void> {
  try {
    await uploadSpin(vehicleId, frames);
  } catch {
    toast.error('The vehicle was added, but its 360° spin could not be saved.', {
      description: 'You can add it from the vehicle’s Photos tab at any time.',
    });
  }
}
