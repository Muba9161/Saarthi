import {
  DOCUMENT_TYPES,
  DocumentOwnerType,
  MediaOwnerType,
  MediaPurpose,
  isRetiredDocumentType,
  maskRcRecord,
  normalizeLicenceNumber,
  normalizeRegistrationNumber,
  rcValidity,
  type DrivingLicenceRecord,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { prisma } from '../../database/prisma';

/**
 * A driver's papers wallet: everything a checkpoint might ask for, filed the
 * way the fleet files it on the web.
 *
 * The web keeps these in three places — uploaded files in `documents`, the RTO
 * register's RC in `vehicle_lookups` and the licence in `licence_lookups` and
 * on the driver row, the photographs in `media_assets` — and the app used to
 * read only the first. A vehicle whose papers had come from the RTO rather than
 * a scanner therefore showed "no papers" to the one person who had to produce
 * them at a barrier.
 *
 * Privacy follows the driver's own standing: the RC owner's personal details,
 * chassis and engine are masked (the driver is not the registered owner), and
 * the licence — the driver's own — is shown in full.
 */

export interface DriverDocument {
  id: string;
  ownerType: string;
  documentType: string;
  title: string | null;
  number: string | null;
  expiryDate: string | null;
  verificationStatus: string;
  /** Days until expiry; negative once expired. Null with no expiry recorded. */
  daysToExpiry: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

/** Documents of the vehicle and of the signed-on driver, nothing else in the fleet. */
function ownedBy(vehicleId: string, driverId: string | null) {
  return [
    { ownerType: DocumentOwnerType.TRUCK, ownerId: vehicleId },
    ...(driverId ? [{ ownerType: DocumentOwnerType.DRIVER, ownerId: driverId }] : []),
  ];
}

/**
 * Every uploaded paper, vehicle and driver together, soonest to expire first.
 *
 * Documents with no expiry sort last — they cannot lapse.
 */
export async function driverDocuments(
  organizationId: string,
  vehicleId: string,
  driverId: string | null,
): Promise<DriverDocument[]> {
  const rows = await prisma.document.findMany({
    where: { organizationId, deletedAt: null, OR: ownedBy(vehicleId, driverId) },
    select: {
      id: true,
      ownerType: true,
      documentType: true,
      title: true,
      documentNumber: true,
      expiryDate: true,
      verificationStatus: true,
      mimeType: true,
      fileSize: true,
    },
  });

  return rows
    .map((row) => ({
      id: row.id,
      ownerType: String(row.ownerType),
      documentType: String(row.documentType),
      title: row.title,
      number: row.documentNumber,
      expiryDate: row.expiryDate?.toISOString() ?? null,
      verificationStatus: String(row.verificationStatus),
      daysToExpiry: daysUntil(row.expiryDate),
      mimeType: row.mimeType,
      sizeBytes: row.fileSize === null ? null : Number(row.fileSize),
    }))
    .sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    });
}

/** One document's stored object, for the app to cache against a checkpoint. */
export async function driverDocumentForDownload(
  organizationId: string,
  vehicleId: string,
  driverId: string | null,
  documentId: string,
): Promise<{ storageKey: string; mimeType: string | null; fileName: string } | null> {
  const row = await prisma.document.findFirst({
    // Scoped by owner as well as by id: a document id is not a capability, and
    // a driver may read the papers of the vehicle they are signed on to and
    // their own — nothing else in the fleet.
    where: { id: documentId, organizationId, deletedAt: null, OR: ownedBy(vehicleId, driverId) },
    select: { storageKey: true, mimeType: true, fileName: true, documentType: true },
  });
  if (!row) return null;

  return {
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    fileName: row.fileName ?? `${String(row.documentType).toLowerCase()}.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Register records: the virtual RC and the licence
// ---------------------------------------------------------------------------

/** The RC as the RTO register holds it, masked for a driver. */
export interface DriverVirtualRc {
  registrationNumber: string;
  retrievedAt: string;
  dataAsOf: string | null;
  /** The fleet has confirmed the RC is genuine. */
  verified: boolean;
  registrationDate: string | null;
  registrationStatus: string | null;
  ownerName: string | null;
  maker: string | null;
  model: string | null;
  variant: string | null;
  vehicleClass: string | null;
  vehicleCategory: string | null;
  bodyType: string | null;
  fuelType: string | null;
  color: string | null;
  emissionNorms: string | null;
  manufacturedOn: string | null;
  chassisNumber: string | null;
  engineNumber: string | null;
  rto: string | null;
  seatingCapacity: number | null;
  grossVehicleWeight: number | null;
  unladenWeight: number | null;
  financer: string | null;
  insurer: string | null;
  insurancePolicyNumber: string | null;
  insuranceValidUntil: string | null;
  puccNumber: string | null;
  puccValidUntil: string | null;
  fitnessValidUntil: string | null;
  taxValidUntil: string | null;
  permitNumber: string | null;
  permitType: string | null;
  permitValidUntil: string | null;
  nationalPermitValidUntil: string | null;
  blacklistStatus: string | null;
}

/** The licence: the driver's own, so nothing is masked. */
export interface DriverLicenceCard {
  licenceNumber: string | null;
  /** `RTO` when read from the register; `PROFILE` when only the driver's own entry exists. */
  source: 'RTO' | 'PROFILE';
  retrievedAt: string | null;
  holderName: string | null;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  state: string | null;
  issuingAuthority: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  transportValidUntil: string | null;
  vehicleClasses: string[];
  verified: boolean;
}

/** The provider writes this for "no date"; it is never a real one. */
const LICENCE_NULL_DATE_PREFIX = '1800-01-01';

function realDate(value: string | null | undefined): string | null {
  if (!value || value.startsWith(LICENCE_NULL_DATE_PREFIX)) return null;
  return value;
}

/**
 * The latest RC on record for the vehicle's plate, in its fleet.
 *
 * Not filtered on `expiresAt`: that is the lookup cache's refresh horizon, not
 * the record's validity, and filtering on it would make the RC vanish from the
 * wallet a day after every lookup.
 */
async function virtualRcFor(
  organizationId: string,
  vehicle: { registrationNumber: string; verificationStatus: string },
): Promise<DriverVirtualRc | null> {
  const plate = normalizeRegistrationNumber(vehicle.registrationNumber);
  if (!plate) return null;

  const lookup = await prisma.vehicleLookup.findFirst({
    where: { registrationNumber: plate, organizationId },
    orderBy: { fetchedAt: 'desc' },
    select: { responseData: true, fetchedAt: true },
  });
  if (!lookup?.responseData) return null;

  return virtualRcFromRecord(
    maskRcRecord(lookup.responseData as unknown as VehicleRcRecord),
    plate,
    lookup.fetchedAt.toISOString(),
    vehicle.verificationStatus === 'VERIFIED',
  );
}

/**
 * An RC record, flattened into the card both phone apps draw.
 *
 * Takes the record already cut to what the reader may see — masked for a
 * driver, or as the web's access rules present it to an owner — so this only
 * reshapes it and never decides what is shown.
 */
export function virtualRcFromRecord(
  record: VehicleRcRecord,
  plate: string,
  retrievedAt: string,
  verified: boolean,
): DriverVirtualRc {
  return {
    registrationNumber: record.registrationNumber ?? plate,
    retrievedAt,
    dataAsOf: record.dataAsOf,
    verified,
    registrationDate: record.registrationDate,
    registrationStatus: record.registrationStatus,
    ownerName: record.owner?.name ?? null,
    maker: record.maker,
    model: record.model,
    variant: record.variant,
    vehicleClass: record.vehicleClass,
    vehicleCategory: record.vehicleCategory,
    bodyType: record.bodyType,
    fuelType: record.fuelType,
    color: record.color,
    emissionNorms: record.emissionNorms,
    manufacturedOn: record.manufacturedOn,
    chassisNumber: record.chassisNumber,
    engineNumber: record.engineNumber,
    rto: [record.rto, record.rtoCode].filter(Boolean).join(' · ') || null,
    seatingCapacity: record.seatingCapacity,
    grossVehicleWeight: record.grossVehicleWeight,
    unladenWeight: record.unladenWeight,
    financer: record.financer,
    insurer: record.insurer,
    insurancePolicyNumber: record.insurancePolicyNumber,
    insuranceValidUntil: record.insuranceValidUntil,
    puccNumber: record.puccNumber,
    puccValidUntil: record.puccValidUntil,
    fitnessValidUntil: record.fitnessValidUntil,
    taxValidUntil: record.tax?.validUntil ?? record.tax?.paidUntil ?? null,
    permitNumber: record.permit?.number ?? null,
    permitType: record.permit?.type ?? null,
    permitValidUntil: record.permit?.validUntil ?? null,
    nationalPermitValidUntil: record.permit?.national?.validUntil ?? null,
    blacklistStatus: record.blacklistStatus,
  };
}

/**
 * The signed-on driver's licence: the RTO record when there is one, otherwise
 * what the driver entered on their own profile — labelled as such.
 */
async function licenceFor(driverId: string): Promise<DriverLicenceCard | null> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      licenseNumber: true,
      licenseExpiryDate: true,
      licenseClass: true,
      licenceVerifiedAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });
  if (!driver) return null;

  const normalized = driver.licenseNumber ? normalizeLicenceNumber(driver.licenseNumber) : null;
  // Matched on the driver first: a licence renewed under a new number is still
  // this person's, and the id survives that where the string does not.
  const lookup = await prisma.licenceLookup.findFirst({
    where: { OR: [{ driverId }, ...(normalized ? [{ licenceNumber: normalized }] : [])] },
    orderBy: { fetchedAt: 'desc' },
    select: { responseData: true, fetchedAt: true, licenceNumber: true },
  });

  const verified = driver.licenceVerifiedAt !== null;

  if (lookup?.responseData) {
    const record = lookup.responseData as unknown as DrivingLicenceRecord;
    return {
      licenceNumber: record.licenceNumber ?? lookup.licenceNumber,
      source: 'RTO',
      retrievedAt: lookup.fetchedAt.toISOString(),
      holderName: record.holder?.name ?? null,
      dateOfBirth: realDate(record.holder?.dateOfBirth),
      bloodGroup: record.holder?.bloodGroup ?? null,
      state: record.state,
      issuingAuthority: record.issuingAuthority,
      issuedOn: realDate(record.issuedOn),
      validUntil: realDate(record.validUntil),
      transportValidUntil: realDate(record.transportValidUntil),
      vehicleClasses: record.vehicleClasses ?? [],
      verified,
    };
  }

  if (!driver.licenseNumber && !driver.licenseExpiryDate) return null;
  return {
    licenceNumber: driver.licenseNumber,
    source: 'PROFILE',
    retrievedAt: null,
    holderName: `${driver.user.firstName} ${driver.user.lastName}`.trim() || null,
    dateOfBirth: null,
    bloodGroup: null,
    state: null,
    issuingAuthority: null,
    issuedOn: null,
    validUntil: driver.licenseExpiryDate?.toISOString() ?? null,
    transportValidUntil: null,
    vehicleClasses: driver.licenseClass ? [driver.licenseClass] : [],
    verified,
  };
}

// ---------------------------------------------------------------------------
// Photographs
// ---------------------------------------------------------------------------

export interface DriverVehiclePhoto {
  id: string;
  caption: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
}

const PHOTO_LIMIT = 24;

export async function vehiclePhotos(vehicleId: string): Promise<DriverVehiclePhoto[]> {
  const rows = await prisma.mediaAsset.findMany({
    where: {
      ownerType: MediaOwnerType.VEHICLE,
      ownerId: vehicleId,
      purpose: MediaPurpose.VEHICLE_EXTERIOR,
      deletedAt: null,
    },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: PHOTO_LIMIT,
    select: {
      id: true,
      caption: true,
      altText: true,
      mimeType: true,
      width: true,
      height: true,
      thumbnailStorageKey: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    caption: row.caption ?? row.altText ?? null,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    hasThumbnail: row.thumbnailStorageKey !== null,
  }));
}

/** One of this vehicle's photographs, never any other media in the fleet. */
export async function vehiclePhotoForDownload(
  vehicleId: string,
  photoId: string,
  thumbnail: boolean,
): Promise<{ storageKey: string; mimeType: string } | null> {
  const asset = await prisma.mediaAsset.findFirst({
    where: {
      id: photoId,
      ownerType: MediaOwnerType.VEHICLE,
      ownerId: vehicleId,
      purpose: MediaPurpose.VEHICLE_EXTERIOR,
      deletedAt: null,
    },
    select: { storageKey: true, thumbnailStorageKey: true, mimeType: true },
  });
  if (!asset) return null;

  // Served under the asset's own type, exactly as `/media/:id/file` does.
  const useThumbnail = thumbnail && asset.thumbnailStorageKey !== null;
  return {
    storageKey: useThumbnail ? asset.thumbnailStorageKey! : asset.storageKey,
    mimeType: asset.mimeType,
  };
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export type PaperFolderKind = 'PAPER' | 'PHOTOS' | 'QR' | 'OTHER';

/** How a folder stands, in one word — the same words the web's folder tags use. */
export type PaperFolderStatus =
  | 'MISSING'
  | 'OPTIONAL'
  | 'VALID'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'REJECTED'
  | 'ON_FILE';

export interface PaperFolder {
  /** A document type code, or `PHOTOS`, `QR`, `OTHER`. */
  id: string;
  kind: PaperFolderKind;
  ownerType: 'TRUCK' | 'DRIVER';
  label: string;
  mandatory: boolean;
  status: PaperFolderStatus | null;
  /** The uploaded documents filed here, newest expiry first. */
  documentIds: string[];
  /** Files in the folder, counting photographs for the photo folder. */
  count: number;
  /** The date the RTO register gives for this paper, when it gives one. */
  registerValidUntil: string | null;
}

export interface DriverPapersWallet {
  folders: PaperFolder[];
  documents: DriverDocument[];
  rc: DriverVirtualRc | null;
  licence: DriverLicenceCard | null;
  photos: DriverVehiclePhoto[];
}

/** Shorter names than the catalogue's, sized for a folder — as on the web. */
const FOLDER_NAMES: Record<string, string> = {
  REGISTRATION_CERTIFICATE: 'Registration (RC)',
  POLLUTION_CERTIFICATE: 'Pollution (PUC)',
  ROAD_TAX: 'Road tax',
};

/** Which register date stands for which paper. */
function registerDateFor(
  code: string,
  rc: DriverVirtualRc | null,
  licence: DriverLicenceCard | null,
): string | null {
  switch (code) {
    case 'INSURANCE':
      return rc?.insuranceValidUntil ?? null;
    case 'POLLUTION_CERTIFICATE':
      return rc?.puccValidUntil ?? null;
    case 'FITNESS_CERTIFICATE':
      return rc?.fitnessValidUntil ?? null;
    case 'PERMIT':
      return rc?.permitValidUntil ?? rc?.nationalPermitValidUntil ?? null;
    case 'ROAD_TAX':
      return rc?.taxValidUntil ?? null;
    case 'DRIVING_LICENCE':
      return licence?.transportValidUntil ?? licence?.validUntil ?? null;
    default:
      return null;
  }
}

function statusFromDate(validUntil: string): PaperFolderStatus {
  const { validity } = rcValidity(validUntil);
  return validity === 'UNKNOWN' ? 'ON_FILE' : validity;
}

function folderStatus(
  documents: DriverDocument[],
  mandatory: boolean,
  registerValidUntil: string | null,
  hasRegisterRecord: boolean,
): PaperFolderStatus {
  const latest = documents[documents.length - 1];
  if (latest) {
    if (latest.verificationStatus === 'REJECTED') return 'REJECTED';
    if (latest.expiryDate) return statusFromDate(latest.expiryDate);
    return 'ON_FILE';
  }
  if (registerValidUntil) return statusFromDate(registerValidUntil);
  if (hasRegisterRecord) return 'ON_FILE';
  return mandatory ? 'MISSING' : 'OPTIONAL';
}

export function paperFolders(
  ownerType: 'TRUCK' | 'DRIVER',
  documents: DriverDocument[],
  rc: DriverVirtualRc | null,
  licence: DriverLicenceCard | null,
): { folders: PaperFolder[]; others: DriverDocument[] } {
  const definitions = DOCUMENT_TYPES.filter(
    (definition) => definition.ownerType === ownerType && !isRetiredDocumentType(definition.code),
  );
  const owned = documents.filter((document) => document.ownerType === ownerType);
  const codes = new Set(definitions.map((definition) => definition.code));

  const folders = definitions.map((definition): PaperFolder => {
    const filed = owned.filter((document) => document.documentType === definition.code);
    const registerValidUntil = registerDateFor(definition.code, rc, licence);
    const hasRegisterRecord =
      (definition.code === 'REGISTRATION_CERTIFICATE' && rc !== null) ||
      (definition.code === 'DRIVING_LICENCE' && licence !== null);
    return {
      id: definition.code,
      kind: 'PAPER',
      ownerType,
      label: FOLDER_NAMES[definition.code] ?? definition.label,
      mandatory: definition.mandatory,
      status: folderStatus(filed, definition.mandatory, registerValidUntil, hasRegisterRecord),
      documentIds: filed.map((document) => document.id),
      count: filed.length,
      registerValidUntil,
    };
  });

  return { folders, others: owned.filter((document) => !codes.has(document.documentType)) };
}

/** The vehicle's photographs and its QR sticker, which sit beside its papers. */
export function photoAndQrFolders(photoCount: number): PaperFolder[] {
  return [
    {
      id: 'PHOTOS',
      kind: 'PHOTOS',
      ownerType: 'TRUCK',
      label: 'Photos',
      mandatory: false,
      status: null,
      documentIds: [],
      count: photoCount,
      registerValidUntil: null,
    },
    {
      id: 'QR',
      kind: 'QR',
      ownerType: 'TRUCK',
      label: 'QR sticker',
      mandatory: false,
      status: null,
      documentIds: [],
      count: 0,
      registerValidUntil: null,
    },
  ];
}

/** Files of a type no longer offered keep a home rather than vanishing; none, no folder. */
export function otherFilesFolder(others: DriverDocument[]): PaperFolder[] {
  if (others.length === 0) return [];
  return [
    {
      id: 'OTHER',
      kind: 'OTHER',
      ownerType: 'TRUCK',
      label: 'Other files',
      mandatory: false,
      status: null,
      documentIds: others.map((document) => document.id),
      count: others.length,
      registerValidUntil: null,
    },
  ];
}

/**
 * A vehicle's papers exactly as its Papers tab shows them: what was uploaded,
 * and the RTO register's own dates where nothing was.
 *
 * For anything else that answers "are this vehicle's papers in order" — the
 * assistant above all, which used to read uploads alone and told a driver it
 * had no PUC on record while their own Papers tab showed its date.
 */
export async function vehiclePapers(
  organizationId: string,
  vehicleId: string,
): Promise<{ folders: PaperFolder[]; documents: DriverDocument[]; registerOnFile: boolean }> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { registrationNumber: true, verificationStatus: true },
  });
  const [documents, rc] = await Promise.all([
    driverDocuments(organizationId, vehicleId, null),
    vehicle ? virtualRcFor(organizationId, vehicle) : Promise.resolve(null),
  ]);
  return {
    folders: paperFolders('TRUCK', documents, rc, null).folders,
    documents,
    registerOnFile: rc !== null,
  };
}

/** The whole wallet in one answer, so the Papers tab renders from one request. */
export async function driverPapersWallet(
  organizationId: string,
  vehicleId: string,
  driverId: string | null,
): Promise<DriverPapersWallet> {
  const vehicle = await prisma.truck.findUnique({
    where: { id: vehicleId },
    select: { registrationNumber: true, verificationStatus: true },
  });

  const [documents, rc, licence, photos] = await Promise.all([
    driverDocuments(organizationId, vehicleId, driverId),
    vehicle ? virtualRcFor(organizationId, vehicle) : Promise.resolve(null),
    driverId ? licenceFor(driverId) : Promise.resolve(null),
    vehiclePhotos(vehicleId),
  ]);

  const vehiclePapers = paperFolders('TRUCK', documents, rc, licence);
  const driverPapers = driverId
    ? paperFolders('DRIVER', documents, rc, licence)
    : { folders: [], others: [] };
  const others = [...vehiclePapers.others, ...driverPapers.others];

  const folders: PaperFolder[] = [
    ...vehiclePapers.folders,
    ...photoAndQrFolders(photos.length),
    ...driverPapers.folders,
    ...otherFilesFolder(others),
  ];

  return { folders, documents, rc, licence, photos };
}
