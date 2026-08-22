import { type Readable } from 'node:stream';

/**
 * Document storage abstraction.
 *
 * Saarthi stores uploaded documents behind this interface so the local
 * filesystem today and an object store tomorrow are interchangeable. Callers
 * only ever hold an opaque `storageKey` — never a path, bucket or URL — which
 * keeps the persistence layer free to move without a data migration.
 *
 * Content types are decided by *magic bytes*, never by the browser-supplied
 * content-type header, so a `.pdf` that is really an executable is rejected.
 */

/** Content types accepted for document upload. */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Canonical file extension for each accepted type. */
const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Canonical extension for a detected type, including the leading dot. */
export function extensionForMimeType(mimeType: string): string {
  return isAllowedMimeType(mimeType) ? EXTENSION_BY_MIME[mimeType] : '.bin';
}

// ---------------------------------------------------------------------------
// Magic byte sniffing
// ---------------------------------------------------------------------------

/** ISO base media brands that identify a HEIF/HEIC still image. */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

function startsWith(buffer: Buffer, signature: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + signature.length) return false;
  return signature.every((byte, index) => buffer[offset + index] === byte);
}

/**
 * Identify a buffer by its leading bytes.
 *
 * Returns `null` when the content matches none of the accepted formats, which
 * the caller should treat as a rejected upload rather than an unknown type.
 */
export function detectMimeType(buffer: Buffer): AllowedMimeType | null {
  // %PDF-
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';

  // JPEG SOI + marker
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG signature
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }

  // ....ftyp<brand> — ISO base media, narrowed to HEIF still-image brands.
  if (buffer.length >= 12 && startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export interface StorageUploadInput {
  /** Logical folder for the object, e.g. `documents/truck/<id>`. */
  prefix: string;
  /** Client-supplied name, used only to derive a readable slug. */
  fileName: string;
  /** Type already verified against the file's magic bytes. */
  mimeType: string;
  content: Buffer;
}

export interface StoredFile {
  /** Opaque handle persisted on the document row. */
  storageKey: string;
  size: number;
  /** SHA-256 of the stored bytes, for integrity and duplicate detection. */
  checksum: string;
  mimeType: string;
}

export interface StorageDownload {
  stream: Readable;
  size: number;
  storageKey: string;
}

export interface StorageProvider {
  readonly name: string;
  upload(input: StorageUploadInput): Promise<StoredFile>;
  download(storageKey: string): Promise<StorageDownload>;
  exists(storageKey: string): Promise<boolean>;
  /** Hard-deletes the bytes. Document rows are soft-deleted and keep theirs. */
  remove(storageKey: string): Promise<void>;
}
