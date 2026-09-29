/**
 * Downscale an image source and encode it as JPEG, in the browser.
 *
 * The media API caps uploads well below what a phone camera produces, on the
 * understanding that renditions are made client-side. Anything a canvas can
 * draw is accepted — a decoded photo, or a video paused on a frame.
 */
export function encodeJpeg(
  source: CanvasImageSource,
  size: { width: number; height: number },
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);

  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('This browser cannot process the photo.'));
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo.'))),
      'image/jpeg',
      quality,
    );
  });
}
