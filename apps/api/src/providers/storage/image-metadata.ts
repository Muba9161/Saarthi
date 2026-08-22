/**
 * Intrinsic image dimensions, read from the file header.
 *
 * Saarthi resizes in the browser rather than on the server, which keeps the API
 * free of a native image dependency. It still has to know how large an image
 * actually is — to reject a 20 000 px bomb, and to give the client an aspect
 * ratio it can reserve layout space for.
 *
 * Reading four header formats by hand is a small amount of code and no
 * dependency. Anything unrecognised returns `null`, which is stored as an
 * unknown dimension rather than a guess: a wrong width produces a page that
 * jumps, and a fabricated one is worse than an absent one.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

/** PNG: IHDR is always the first chunk, at a fixed offset. */
function readPng(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return null;
  }
  // Bytes 12-15 are the chunk type; it must be IHDR for the offsets to hold.
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * JPEG: walk the marker chain to the first Start-Of-Frame.
 *
 * The dimensions live in SOF0/1/2/3/5/6/7/9/10/11/13/14/15 and nowhere else, so
 * every other segment is skipped by its declared length.
 */
function readJpeg(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      // Fill bytes are legal between segments; skip them one at a time.
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === undefined) return null;

    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan — pixel data begins, so there is no SOF to find.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      // SOF payload: precision(1), height(2), width(2).
      if (offset + 9 >= buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }
  return null;
}

/** WebP: three container variants, each with its own dimension encoding. */
function readWebp(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

  const format = buffer.toString('ascii', 12, 16);

  // Lossy: VP8 bitstream, 14-bit dimensions after the 3-byte start code.
  if (format === 'VP8 ') {
    if (buffer.length < 30) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  // Lossless: 14-bit dimensions minus one, packed across four bytes.
  if (format === 'VP8L') {
    if (buffer.length < 25) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  // Extended: canvas size as 24-bit values minus one.
  if (format === 'VP8X') {
    if (buffer.length < 30) return null;
    const width = buffer.readUIntLE(24, 3) + 1;
    const height = buffer.readUIntLE(27, 3) + 1;
    return { width, height };
  }

  return null;
}

/** GIF: logical screen descriptor, little-endian, right after the signature. */
function readGif(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10) return null;
  const header = buffer.toString('ascii', 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

/**
 * Best-effort dimensions for an image buffer.
 *
 * HEIC is deliberately not parsed: its dimensions live inside an ISO-BMFF box
 * tree that is not worth hand-rolling, and the browser has already resized the
 * image by the time it reaches here. HEIC uploads simply store null dimensions.
 */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  const result =
    readPng(buffer) ?? readJpeg(buffer) ?? readWebp(buffer) ?? readGif(buffer) ?? null;

  if (!result) return null;
  // A header can be corrupt or hostile; refuse implausible geometry.
  if (
    !Number.isFinite(result.width) ||
    !Number.isFinite(result.height) ||
    result.width <= 0 ||
    result.height <= 0 ||
    result.width > 30_000 ||
    result.height > 30_000
  ) {
    return null;
  }
  return result;
}

/** Longest edge, or null when the geometry is unknown. */
export function longestEdge(dimensions: ImageDimensions | null): number | null {
  return dimensions ? Math.max(dimensions.width, dimensions.height) : null;
}
