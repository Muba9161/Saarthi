import type { AuthContext } from '../../auth/context';
import {
  driverDocumentForDownload,
  driverPapersWallet,
  vehiclePhotoForDownload,
  type DriverPapersWallet,
} from '../terminal/driver-papers.service';
import { requireActiveShare } from './vehicle-share.service';

/**
 * A shared vehicle's papers, for the person it is shared with: to look at,
 * never to change.
 *
 * The same wallet a driver of the vehicle sees, built by the same code — the
 * folders, the uploaded papers and photographs, and the RC as the register
 * holds it, masked. Not the owner's: no full RC behind the Secure PIN, no
 * finance, and not the vehicle's QR sticker, which is the owner's to hand out.
 * Every read starts at `requireActiveShare`, so an ended share, a lapsed plan
 * or an unconfirmed vehicle shows nothing.
 */

export type SharedVehiclePapers = Omit<DriverPapersWallet, 'licence'>;

export async function sharedVehiclePapers(auth: AuthContext, shareId: string): Promise<SharedVehiclePapers> {
  const share = await requireActiveShare(auth, shareId);
  const { licence: _noDriver, ...wallet } = await driverPapersWallet(share.ownerOrganizationId, share.vehicleId, null);
  return { ...wallet, folders: wallet.folders.filter((folder) => folder.kind !== 'QR') };
}

/** One of the shared vehicle's papers, and nothing else of the owner's. */
export async function sharedPaperForDownload(auth: AuthContext, shareId: string, documentId: string) {
  const share = await requireActiveShare(auth, shareId);
  return driverDocumentForDownload(share.ownerOrganizationId, share.vehicleId, null, documentId);
}

/** One of the shared vehicle's photographs. */
export async function sharedPhotoForDownload(auth: AuthContext, shareId: string, photoId: string, thumbnail: boolean) {
  const share = await requireActiveShare(auth, shareId);
  return vehiclePhotoForDownload(share.vehicleId, photoId, thumbnail);
}
