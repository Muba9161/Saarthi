import { toast } from 'sonner';
import type { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { api } from '@/lib/api-client';

/**
 * Attaching one image to a record that has just been created.
 *
 * Every "add" form in the app is in the same position: media is addressed to
 * an owner id, so the picture cannot go up until the vehicle, driver or
 * account it belongs to exists. The form therefore holds the file, saves the
 * record, and calls this — which is why it is a plain function rather than
 * another mutation hook wrapped around the same POST.
 *
 * `PhotoUploader` is the other half of this story and stays as it is: it is
 * for a record that already exists, where an upload can start the moment a
 * file is chosen.
 */

export interface UploadedImage {
  id: string;
  fileName: string;
  purpose: string;
  url: string;
  thumbnailUrl: string | null;
}

export interface ImageAttachment {
  ownerType: MediaOwnerType;
  ownerId: string;
  purpose: MediaPurpose;
  file: File;
}

export async function uploadImage(attachment: ImageAttachment): Promise<UploadedImage> {
  const body = new FormData();
  body.append('ownerType', attachment.ownerType);
  body.append('ownerId', attachment.ownerId);
  body.append('purpose', attachment.purpose);
  body.append('file', attachment.file, attachment.file.name);
  return api.post<UploadedImage>('/media', body);
}

/**
 * The same upload, for the callers who have already saved the record.
 *
 * A failed image must not read as a failed save — the vehicle is registered,
 * the driver is invited — so this reports and returns null instead of
 * throwing, and the caller carries on to close its dialog.
 */
export async function uploadImageOrWarn(
  attachment: ImageAttachment,
  failureMessage: string,
): Promise<UploadedImage | null> {
  try {
    return await uploadImage(attachment);
  } catch {
    toast.error(failureMessage, {
      description: 'You can add it from the record itself at any time.',
    });
    return null;
  }
}
