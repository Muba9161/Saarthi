import { deflateRawSync } from 'node:zlib';

/**
 * Building an APK from nothing, for tests.
 *
 * The release pipeline reads version and package out of the binary, so a test
 * that mocks the reader proves nothing about it. These helpers assemble a real
 * ZIP around a real Android binary XML manifest — small, but genuinely the
 * format `inspectApk` has to cope with, and the same one aapt2 emits.
 */

export const CHUNK_XML = 0x0003;
const CHUNK_STRING_POOL = 0x0001;
const CHUNK_RESOURCE_MAP = 0x0180;
const CHUNK_START_ELEMENT = 0x0102;

export const TYPE_STRING = 0x03;
export const TYPE_INT_DEC = 0x10;

/** A UTF-16 string pool, the encoding a real aapt2 manifest uses. */
export function stringPool(strings: string[]): Buffer {
  const encoded = strings.map((value) => {
    const body = Buffer.from(value, 'utf16le');
    const chunk = Buffer.alloc(2 + body.length + 2);
    chunk.writeUInt16LE(value.length, 0);
    body.copy(chunk, 2);
    return chunk;
  });

  const offsets = Buffer.alloc(strings.length * 4);
  let running = 0;
  encoded.forEach((chunk, index) => {
    offsets.writeUInt32LE(running, index * 4);
    running += chunk.length;
  });

  const data = Buffer.concat(encoded);
  const header = Buffer.alloc(28);
  const size = 28 + offsets.length + data.length;
  header.writeUInt16LE(CHUNK_STRING_POOL, 0);
  header.writeUInt16LE(28, 2);
  header.writeUInt32LE(size, 4);
  header.writeUInt32LE(strings.length, 8);
  header.writeUInt32LE(0, 12); // style count
  header.writeUInt32LE(0, 16); // flags: UTF-16, not sorted
  header.writeUInt32LE(28 + offsets.length, 20); // where the strings begin
  header.writeUInt32LE(0, 24); // styles start

  return Buffer.concat([header, offsets, data]);
}

export function resourceMap(ids: number[]): Buffer {
  const chunk = Buffer.alloc(8 + ids.length * 4);
  chunk.writeUInt16LE(CHUNK_RESOURCE_MAP, 0);
  chunk.writeUInt16LE(8, 2);
  chunk.writeUInt32LE(chunk.length, 4);
  ids.forEach((id, index) => chunk.writeUInt32LE(id, 8 + index * 4));
  return chunk;
}

export interface TestAttribute {
  nameIndex: number;
  type: number;
  data: number;
}

export function startElement(nameIndex: number, attributes: TestAttribute[]): Buffer {
  // 16 bytes of node header (type, sizes, line, comment), then 20 of element
  // header (namespace, name, and the three index fields), then the attributes.
  const size = 16 + 20 + attributes.length * 20;
  const chunk = Buffer.alloc(size);
  chunk.writeUInt16LE(CHUNK_START_ELEMENT, 0);
  chunk.writeUInt16LE(16, 2);
  chunk.writeUInt32LE(size, 4);
  chunk.writeUInt32LE(1, 8); // line number
  chunk.writeUInt32LE(0xffffffff, 12); // no comment

  const body = 16;
  chunk.writeUInt32LE(0xffffffff, body); // namespace
  chunk.writeUInt32LE(nameIndex, body + 4);
  chunk.writeUInt16LE(20, body + 8); // attributes start, relative to body
  chunk.writeUInt16LE(20, body + 10); // attribute size
  chunk.writeUInt16LE(attributes.length, body + 12);

  attributes.forEach((attribute, index) => {
    const at = body + 20 + index * 20;
    chunk.writeUInt32LE(0xffffffff, at); // namespace
    chunk.writeUInt32LE(attribute.nameIndex, at + 4);
    chunk.writeUInt32LE(attribute.type === TYPE_STRING ? attribute.data : 0xffffffff, at + 8);
    chunk.writeUInt16LE(8, at + 12); // typed value size
    chunk.writeUInt8(0, at + 14);
    chunk.writeUInt8(attribute.type, at + 15);
    chunk.writeUInt32LE(attribute.data, at + 16);
  });

  return chunk;
}

/** A binary manifest declaring one package at one version. */
export function binaryManifest(options: {
  packageName: string;
  versionCode: number;
  versionName: string;
  minSdk?: number;
}): Buffer {
  // Index 0-3 are attribute names, which the resource map runs parallel to.
  const strings = [
    'versionCode',
    'versionName',
    'minSdkVersion',
    'package',
    'manifest',
    'uses-sdk',
    options.packageName,
    options.versionName,
  ];
  const ids = [0x0101021b, 0x0101021c, 0x0101020c, 0];

  const chunks: Buffer[] = [stringPool(strings), resourceMap(ids)];

  chunks.push(
    startElement(4, [
      { nameIndex: 3, type: TYPE_STRING, data: 6 },
      { nameIndex: 0, type: TYPE_INT_DEC, data: options.versionCode },
      { nameIndex: 1, type: TYPE_STRING, data: 7 },
    ]),
  );

  if (options.minSdk !== undefined) {
    chunks.push(startElement(5, [{ nameIndex: 2, type: TYPE_INT_DEC, data: options.minSdk }]));
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(CHUNK_XML, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

// ---------------------------------------------------------------------------
// Building a minimal ZIP around it
// ---------------------------------------------------------------------------

/** A ZIP holding the given entries, deflated the way a real APK's manifest is. */
export function zip(entries: { name: string; content: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.content);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflated
    local.writeUInt32LE(0, 10); // time and date
    local.writeUInt32LE(0, 14); // crc, unchecked by the reader
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); // deflated
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, eocd]);
}

export function apk(options: {
  packageName?: string;
  versionCode?: number;
  versionName?: string;
  minSdk?: number;
}): Buffer {
  return zip([
    {
      name: 'AndroidManifest.xml',
      content: binaryManifest({
        packageName: options.packageName ?? 'com.saarthi.terminal',
        versionCode: options.versionCode ?? 7,
        versionName: options.versionName ?? '1.4.0',
        minSdk: options.minSdk,
      }),
    },
    { name: 'classes.dex', content: Buffer.from('not really a dex') },
  ]);
}

