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

/** Draw the photo scaled and in greyscale with extra contrast, which printed cards read better as. */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot read images.');
  context.filter = 'grayscale(1) contrast(1.4)';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

/** The number of this kind on the photographed card, or null when none can be read with confidence. */
export async function readNumberFromCard(
  file: Blob,
  kind: ScannableNumberKind,
): Promise<string | null> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(await prepare(file));
    return extractCardNumber(kind, data.text);
  } finally {
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
