import { MediaOwnerType, MediaPurpose } from '@saarthi/shared';
import { primaryUrlsFor } from '../media/media.service';

/**
 * A driver's photo, as every screen that shows a driver should draw it.
 *
 * The person's own profile photo comes first. It is uploaded to their account
 * (`USER` / `AVATAR`) and mirrored into `User.avatarUrl`, so it costs no query
 * beyond the user row the caller already loads. A photo the fleet attached to
 * the driver record (`DRIVER` / `AVATAR`, from the web's add-driver form) is the
 * fallback, read in one batch for only the drivers that have no photo of
 * their own.
 *
 * Only `AVATAR` is read: a driver record also owns arrival selfies, which are
 * evidence for one approval and must never stand in as a portrait.
 */
export interface DriverPhotoSource {
  id: string;
  user: { avatarUrl: string | null };
}

/** Each driver's photo URL by driver id; a driver with no photo has no entry. */
export async function driverPhotoUrls(
  drivers: readonly DriverPhotoSource[],
): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  const withoutOwnPhoto: string[] = [];
  for (const driver of drivers) {
    if (driver.user.avatarUrl) photos.set(driver.id, driver.user.avatarUrl);
    else withoutOwnPhoto.push(driver.id);
  }

  const attached = await primaryUrlsFor(
    MediaOwnerType.DRIVER,
    withoutOwnPhoto,
    MediaPurpose.AVATAR,
  );
  for (const [driverId, url] of attached) photos.set(driverId, url);
  return photos;
}
