import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/**
 * What is actually inside an uploaded APK.
 *
 * A release record has to say which version it is, and there are only two
 * places that could come from: the person uploading it, or the file. It comes
 * from the file. An uploader who mistypes `versionCode` would publish a build
 * that every terminal either ignores forever or installs over a newer one, and
 * neither failure looks like a typo when it happens three weeks later in a cab.
 *
 * So this reads the four facts that matter straight out of the binary:
 *
 *   * `applicationId` — refused if it is not the Terminal package, which stops
 *     an unrelated APK being shipped to the fleet by a slip of the file picker.
 *   * `versionCode` — the only number the update check compares.
 *   * `versionName` — what a driver reads on the update card.
 *   * `minSdk` — so a tablet too old for the build is never offered it.
 *
 * Two formats have to be understood to get there, and neither needs a
 * dependency: an APK is a ZIP, and the `AndroidManifest.xml` inside it is
 * Android's binary XML rather than text. Both readers below are deliberately
 * narrow — enough to find one file and read four attributes from one element,
 * and nothing else.
 */

/** What the binary says about itself. */
export interface ApkInfo {
  applicationId: string;
  versionCode: number;
  versionName: string;
  minSdk: number;
  /** Lower-case hex SHA-256 of the whole file. */
  sha256: string;
}

/** An upload that is not a usable APK. Carries a message fit to show a person. */
export class ApkInspectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApkInspectionError';
  }
}

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

/** The largest trailing comment a ZIP may carry, so the furthest back EOCD can be. */
const MAX_ZIP_COMMENT = 0xffff;

const STORED = 0;
const DEFLATED = 8;

/**
 * Read one named file out of a ZIP archive.
 *
 * Via the central directory rather than by scanning for local headers: the
 * central directory is the authoritative index, and an APK signed with the v2
 * scheme carries a signing block between the entries and the directory that a
 * naive forward scan would walk straight into.
 */
function readZipEntry(archive: Buffer, wanted: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(archive);
  if (eocd === null) {
    throw new ApkInspectionError('That file is not a ZIP archive, so it cannot be an APK.');
  }

  const entryCount = archive.readUInt16LE(eocd + 10);
  let offset = archive.readUInt32LE(eocd + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length) return null;
    if (archive.readUInt32LE(offset) !== CENTRAL_FILE_SIGNATURE) return null;

    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === wanted) {
      return readLocalEntry(archive, localOffset, method, compressedSize);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

/** The bytes of one entry, following its local header. */
function readLocalEntry(
  archive: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
): Buffer {
  if (localOffset + 30 > archive.length) {
    throw new ApkInspectionError('The archive is truncated.');
  }
  if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new ApkInspectionError('The archive index does not match its contents.');
  }

  // The local header repeats the name and extra lengths, and they are allowed
  // to differ from the central directory's. The local ones govern where the
  // data starts, so they are the ones read here.
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = start + compressedSize;
  if (end > archive.length) {
    throw new ApkInspectionError('The archive is truncated.');
  }

  const raw = archive.subarray(start, end);
  if (method === STORED) return Buffer.from(raw);
  if (method === DEFLATED) {
    try {
      return inflateRawSync(raw);
    } catch {
      throw new ApkInspectionError('The archive is corrupt and could not be read.');
    }
  }
  throw new ApkInspectionError(`The archive uses an unsupported compression method (${method}).`);
}

/** Scan backwards for the end-of-central-directory record. */
function findEndOfCentralDirectory(archive: Buffer): number | null {
  const earliest = Math.max(0, archive.length - MAX_ZIP_COMMENT - 22);
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Android binary XML
// ---------------------------------------------------------------------------

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_RESOURCE_MAP = 0x0180;
const CHUNK_START_ELEMENT = 0x0102;

const STRING_POOL_UTF8 = 1 << 8;

/** Value types, from `android.util.TypedValue`. Only the three that appear here. */
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

/**
 * Framework attribute resource ids.
 *
 * The manifest identifies its attributes by resource id, not by name — the
 * string "versionCode" need not even be present. These four ids are frozen
 * public API and have not changed since API 1.
 */
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const ATTR_MIN_SDK_VERSION = 0x0101020c;

interface Attribute {
  resourceId: number;
  name: string;
  value: string | number | null;
}

interface Element {
  name: string;
  attributes: Attribute[];
}

/** Every start-element in a binary manifest, flattened. */
function parseBinaryXml(buffer: Buffer): Element[] {
  if (buffer.length < 8) {
    throw new ApkInspectionError('The manifest inside the APK is empty.');
  }

  let strings: string[] = [];
  let resourceIds: number[] = [];
  const elements: Element[] = [];

  // The file is a chunk whose payload is more chunks. Skipping by the declared
  // size rather than parsing every type is what keeps this reader narrow: an
  // unknown chunk costs nothing.
  let offset = buffer.readUInt16LE(2); // header size of the outer chunk

  while (offset + 8 <= buffer.length) {
    const type = buffer.readUInt16LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > buffer.length) break;

    if (type === CHUNK_STRING_POOL) {
      strings = parseStringPool(buffer, offset);
    } else if (type === CHUNK_RESOURCE_MAP) {
      const count = (size - 8) / 4;
      resourceIds = [];
      for (let index = 0; index < count; index += 1) {
        resourceIds.push(buffer.readUInt32LE(offset + 8 + index * 4));
      }
    } else if (type === CHUNK_START_ELEMENT) {
      elements.push(parseStartElement(buffer, offset, strings, resourceIds));
    }

    offset += size;
  }

  return elements;
}

/** The pool every name and string value in the document is indexed into. */
function parseStringPool(buffer: Buffer, chunkOffset: number): string[] {
  const count = buffer.readUInt32LE(chunkOffset + 8);
  const flags = buffer.readUInt32LE(chunkOffset + 16);
  const stringsStart = buffer.readUInt32LE(chunkOffset + 20);
  const utf8 = (flags & STRING_POOL_UTF8) !== 0;

  const offsetsAt = chunkOffset + 28;
  const dataAt = chunkOffset + stringsStart;
  const strings: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const at = dataAt + buffer.readUInt32LE(offsetsAt + index * 4);
    if (at >= buffer.length) {
      strings.push('');
      continue;
    }

    if (utf8) {
      // Two lengths, each one or two bytes: characters then bytes. Only the
      // second is needed, and a high bit on the first byte means it took two.
      let cursor = at;
      const skip = (): void => {
        cursor += (buffer[cursor] ?? 0) & 0x80 ? 2 : 1;
      };
      skip();
      const lengthAt = cursor;
      const byteLength =
        ((buffer[lengthAt] ?? 0) & 0x80) !== 0
          ? (((buffer[lengthAt] ?? 0) & 0x7f) << 8) | (buffer[lengthAt + 1] ?? 0)
          : (buffer[lengthAt] ?? 0);
      skip();
      strings.push(buffer.toString('utf8', cursor, cursor + byteLength));
    } else {
      const length = buffer.readUInt16LE(at) & 0x7fff;
      strings.push(buffer.toString('utf16le', at + 2, at + 2 + length * 2));
    }
  }

  return strings;
}

/** One element and its attributes. */
function parseStartElement(
  buffer: Buffer,
  chunkOffset: number,
  strings: string[],
  resourceIds: number[],
): Element {
  const body = chunkOffset + 8 + 8; // chunk header, then line number and comment
  const nameIndex = buffer.readUInt32LE(body + 4);
  const attributeStart = buffer.readUInt16LE(body + 8);
  const attributeSize = buffer.readUInt16LE(body + 10);
  const attributeCount = buffer.readUInt16LE(body + 12);

  const attributes: Attribute[] = [];
  for (let index = 0; index < attributeCount; index += 1) {
    const at = body + attributeStart + index * attributeSize;
    if (at + 20 > buffer.length) break;

    const attributeNameIndex = buffer.readUInt32LE(at + 4);
    const rawValueIndex = buffer.readUInt32LE(at + 8);
    const dataType = buffer.readUInt8(at + 15);
    const data = buffer.readUInt32LE(at + 16);

    let value: string | number | null = null;
    if (dataType === TYPE_STRING) {
      // The typed value points at the pool; the raw value is the same string
      // for a manifest, but the typed one is what the platform reads.
      value = strings[data] ?? strings[rawValueIndex] ?? null;
    } else if (dataType === TYPE_INT_DEC || dataType === TYPE_INT_HEX) {
      value = data;
    }

    attributes.push({
      resourceId: resourceIds[attributeNameIndex] ?? 0,
      name: strings[attributeNameIndex] ?? '',
      value,
    });
  }

  return { name: strings[nameIndex] ?? '', attributes };
}

// ---------------------------------------------------------------------------
// The inspection itself
// ---------------------------------------------------------------------------

/** Find an attribute by its framework resource id, falling back to its name. */
function attribute(element: Element | undefined, resourceId: number, name: string): Attribute | null {
  if (!element) return null;
  return (
    element.attributes.find((candidate) => candidate.resourceId === resourceId) ??
    element.attributes.find((candidate) => candidate.name === name) ??
    null
  );
}

/**
 * Read an uploaded APK.
 *
 * Throws `ApkInspectionError` with a message fit to put in front of the person
 * who uploaded the file — every failure here is something they can act on by
 * choosing a different file.
 */
export function inspectApk(bytes: Buffer): ApkInfo {
  // A ZIP starts "PK\x03\x04". Checked before anything else so the commonest
  // mistake by far — uploading an .aab, a .zip of the folder, or a screenshot —
  // is named plainly rather than surfacing as a parse failure deeper down.
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new ApkInspectionError('That file is not an APK.');
  }

  const manifestBytes = readZipEntry(bytes, 'AndroidManifest.xml');
  if (!manifestBytes) {
    throw new ApkInspectionError(
      'That archive has no AndroidManifest.xml, so it is not an APK. An .aab bundle ' +
        'cannot be installed directly — upload the APK your build produced.',
    );
  }

  const elements = parseBinaryXml(manifestBytes);
  const manifest = elements.find((element) => element.name === 'manifest');
  if (!manifest) {
    throw new ApkInspectionError('The APK manifest could not be read.');
  }

  const packageName = manifest.attributes.find((candidate) => candidate.name === 'package')?.value;
  const versionCode = attribute(manifest, ATTR_VERSION_CODE, 'versionCode')?.value;
  const versionName = attribute(manifest, ATTR_VERSION_NAME, 'versionName')?.value;

  const usesSdk = elements.find((element) => element.name === 'uses-sdk');
  const minSdk = attribute(usesSdk, ATTR_MIN_SDK_VERSION, 'minSdkVersion')?.value;

  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new ApkInspectionError('The APK does not name a package.');
  }
  if (typeof versionCode !== 'number' || versionCode <= 0) {
    throw new ApkInspectionError('The APK does not declare a version code.');
  }

  return {
    applicationId: packageName,
    versionCode,
    // A version name is not strictly required by Android. Falling back to the
    // code keeps the update card from showing an empty line.
    versionName: typeof versionName === 'string' && versionName ? versionName : String(versionCode),
    // Absent means "any", which for this app is its own floor rather than 1 —
    // but claiming a floor the binary did not state would be a guess, so the
    // honest reading is the platform's own default.
    minSdk: typeof minSdk === 'number' ? minSdk : 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
