import * as React from 'react';
import { extractCardNumber, type ScannableNumberKind } from '@saarthi/shared';

/**
 * Reading an identity number off a card photo — on this device.
 *
 * The photo never leaves the browser: the text is recognised here, and only
 * the number the person then confirms is sent anywhere. That matters most for
 * Aadhaar, whose image Saarthi has no business receiving just to fill a field.
 *
 * The recogniser is loaded on first use only, so nobody who types their number
 * pays for it; its language model comes from the library's CDN and is cached
 * by the browser after that.
 */

/** Longest edge the photo is scaled to: sharp enough to read, small enough to be quick on a phone. */
const MAX_EDGE = 1800;

/**
 * Words read with less confidence than this are ignored.
 *
 * A PAN or a Voter ID has no check digit, so a run of misread characters can
 * look exactly like one. Text read from a card held the wrong way up came back
 * in the 0–65 range and once produced a perfectly shaped, wrong PAN; the number
 * on a readable card comes back at 85 or more.
 */
export const MIN_WORD_CONFIDENCE = 70;

/** Turns tried until the number is found: as taken, then sideways, upside down last. */
const ROTATIONS = [0, 90, 270, 180] as const;

/** The parts of a recognition result this reads — structurally, so it can be tested without OCR. */
export interface RecognisedBlock {
  paragraphs: { lines: { words: { text: string; confidence: number }[] }[] }[];
}

/** The recognised text, line by line, keeping only the words read with confidence. */
export function confidentText(blocks: readonly RecognisedBlock[] | null): string {
  return (blocks ?? [])
    .flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))
    .map((line) =>
      line.words
        .filter((word) => word.confidence >= MIN_WORD_CONFIDENCE)
        .map((word) => word.text)
        .join(' '),
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * Decode the photo upright, as its orientation tag says.
 *
 * Older Safari rejects `from-image`; there the photo is decoded as stored, and
 * the turns tried in `readNumberFromCard` find the right way up instead.
 */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(file);
  }
}

/**
 * Draw the photo scaled, turned, and in greyscale with extra contrast, which
 * printed cards read better as.
 */
function prepare(bitmap: ImageBitmap, rotation: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const sideways = rotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? height : width;
  canvas.height = sideways ? width : height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot read images.');
  context.filter = 'grayscale(1) contrast(1.4)';
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);
  return canvas;
}

/**
 * The number of this kind on the photographed card, or null when none can be
 * read with confidence.
 *
 * Phones store most photos sideways and say so in the photo's orientation tag,
 * which is honoured; a card photographed sideways or upside down is still
 * found, by trying the other turns when the first finds nothing.
 */
export async function readNumberFromCard(
  file: Blob,
  kind: ScannableNumberKind,
): Promise<string | null> {
  const { createWorker } = await import('tesseract.js');
  const bitmap = await decode(file);
  const worker = await createWorker('eng');
  try {
    for (const rotation of ROTATIONS) {
      const { data } = await worker.recognize(prepare(bitmap, rotation), {}, { blocks: true });
      const number = extractCardNumber(kind, confidentText(data.blocks));
      if (number) return number;
    }
    return null;
  } finally {
    bitmap.close();
    await worker.terminate();
  }
}

export type CardScanResult = { status: 'found'; number: string } | { status: 'not-found' } | { status: 'failed' };

/** Scan state for a screen: whether a read is running, and the one call that runs it. */
export function useCardScan(kind: ScannableNumberKind | null | undefined) {
  const [reading, setReading] = React.useState(false);

  const scan = React.useCallback(
    async (file: Blob): Promise<CardScanResult> => {
      if (!kind) return { status: 'not-found' };
      setReading(true);
      try {
        const number = await readNumberFromCard(file, kind);
        return number ? { status: 'found', number } : { status: 'not-found' };
      } catch {
        // An unreadable format (HEIC on a desktop browser), a blocked model
        // download: the field stays as it was and the person types it.
        return { status: 'failed' };
      } finally {
        setReading(false);
      }
    },
    [kind],
  );

  return { scan, reading };
}

/** Whether a file is a photo this can read — a PDF or a document scan is left alone. */
export function isScannableImage(file: File | null | undefined): file is File {
  return Boolean(file && file.type.startsWith('image/'));
}
