import { Feature, Permission, hasPermission, type RcDetailAccess } from '@saarthi/shared';
import type { AuthContext } from '../../auth/context';
import { prisma } from '../../database/prisma';
import { errors } from '../../lib/errors';
import { hasFeature } from '../../server/guards';
import { getStoredLookup } from '../vehicle-lookup/vehicle-lookup.service';
import {
  driverDocuments,
  otherFilesFolder,
  paperFolders,
  photoAndQrFolders,
  vehiclePhotos,
  virtualRcFromRecord,
  type DriverDocument,
  type DriverVehiclePhoto,
  type DriverVirtualRc,
  type PaperFolder,
} from '../terminal/driver-papers.service';

/**
 * A vehicle's papers for its owner: the folders, the virtual RC and the
 * photographs, in the one answer the owner app's Papers screen draws.
 *
 * The same folders the driver's wallet files, built by the same code, so the
 * owner and the driver of one vehicle can never be told different things about
 * whether its insurance is valid. What differs is the RC: a driver always sees
 * it masked, while an owner sees exactly what the web's Registration tab would
 * show them, under the same access rules — in full only once ownership is
 * verified and the secure PIN is entered.
 */

/** The RC card, with what the owner app needs to explain and open it. */
export interface OwnerVirtualRc extends DriverVirtualRc {
  /** Handle for `GET /vehicles/lookups/:lookupId/document`. */
  lookupId: string;
  /** How much of the record this caller was shown, and so why the rest is masked. */
  access: RcDetailAccess;
  /** A stored RC certificate exists. Downloading it takes `FULL` access. */
  pdfAvailable: boolean;
}

export interface OwnerPapersWallet {
  folders: PaperFolder[];
  documents: DriverDocument[];
  photos: DriverVehiclePhoto[];
  rc: OwnerVirtualRc | null;
}

/**
 * The stored RC, or null when the caller could not open it on the web either.
 *
 * Gated exactly as `GET /vehicles/lookups/latest` is, permission and plan both,
 * so the app is never a way round the Registration tab. Free: it reads the
 * record already held and never calls the provider.
 */
async function ownerRc(
  auth: AuthContext,
  vehicle: { registrationNumber: string; verificationStatus: string },
): Promise<OwnerVirtualRc | null> {
  if (!hasPermission(auth.permissions, Permission.VEHICLE_LOOKUP)) return null;
  if (!hasFeature(auth, Feature.FLEET_BASIC)) return null;

  const stored = await getStoredLookup(auth, vehicle.registrationNumber);
  if (!stored) return null;

  return {
    ...virtualRcFromRecord(
      stored.vehicle,
      stored.registrationNumber,
      stored.retrievedAt,
      vehicle.verificationStatus === 'VERIFIED',
    ),
    lookupId: stored.lookupId,
    access: stored.access,
    pdfAvailable: stored.pdfAvailable,
  };
}

export async function ownerPapersWallet(
  auth: AuthContext,
  vehicleId: string,
): Promise<OwnerPapersWallet> {
  // Checked before the query: an `organizationId` of undefined would make
  // Prisma drop the filter and search every tenant.
  if (!auth.isPlatformAdmin && !auth.organizationId) throw errors.notFound('Vehicle');

  // Scoped to the caller's own business. Reported as "not found" rather than
  // "forbidden" so a vehicle id cannot be probed across tenants.
  const vehicle = await prisma.truck.findFirst({
    where: {
      id: vehicleId,
      archivedAt: null,
      ...(auth.isPlatformAdmin ? {} : { organizationId: auth.organizationId! }),
    },
    select: {
      id: true,
      organizationId: true,
      registrationNumber: true,
      verificationStatus: true,
    },
  });
  if (!vehicle) throw errors.notFound('Vehicle');

  const [documents, rc, photos] = await Promise.all([
    driverDocuments(vehicle.organizationId, vehicle.id, null),
    ownerRc(auth, vehicle),
    vehiclePhotos(vehicle.id),
  ]);

  const papers = paperFolders('TRUCK', documents, rc, null);
  return {
    folders: [
      ...papers.folders,
      ...photoAndQrFolders(photos.length),
      ...otherFilesFolder(papers.others),
    ],
    documents,
    photos,
    rc,
  };
}
