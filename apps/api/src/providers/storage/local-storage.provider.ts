import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env';
import { errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  extensionForMimeType,
  type StorageDownload,
  type StorageProvider,
  type StorageUploadInput,
  type StoredFile,
} from './storage.provider';

/**
 * Local filesystem storage.
 *
 * Objects live under `STORAGE_LOCAL_PATH`, keyed by a POSIX-style relative
 * path that is generated here — never taken from the client. Keys are still
 * re-validated on the way back in, because a key read from the database is
 * only as trustworthy as whatever wrote it.
 *
 * Writes go to a temporary file and are renamed into place, so a crashed or
 * partial upload can never be served as a whole document.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  private readonly root: string;

  constructor(root: string = config.storage.localPath) {
    this.root = path.resolve(root);
  }

  /**
   * Reduce one path segment to a safe slug. Anything outside the allowlist is
   * collapsed to a dash, which neutralises `..`, separators and NUL bytes.
   */
  private static segment(value: string, fallback: string): string {
    const cleaned = value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 64);
    return cleaned.length > 0 ? cleaned : fallback;
  }

  /** Resolve a key to an absolute path, refusing anything that escapes root. */
  private resolveKey(storageKey: string): string {
    if (typeof storageKey !== 'string' || storageKey.length === 0) {
      throw errors.validation('A storage key is required.');
    }
    if (storageKey.includes('\0')) {
      throw errors.validation('The storage key is not valid.');
    }

    const target = path.resolve(this.root, storageKey);
    const boundary = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;

    // `path.resolve` collapses `..`, so this catches traversal after the fact.
    if (!target.startsWith(boundary)) {
      logger.error({ storageKey }, 'Rejected a storage key that escapes the storage root');
      throw errors.validation('The storage key is not valid.');
    }
    return target;
  }

  async upload(input: StorageUploadInput): Promise<StoredFile> {
    const prefix = input.prefix
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => LocalStorageProvider.segment(part, 'segment'))
      .join('/');

    const base = LocalStorageProvider.segment(
      path.parse(input.fileName).name,
      'document',
    );
    // The extension follows the *detected* type, not the client's filename.
    const extension = extensionForMimeType(input.mimeType);
    const storageKey = `${prefix}/${randomUUID()}-${base}${extension}`;

    const target = this.resolveKey(storageKey);
    await mkdir(path.dirname(target), { recursive: true });

    // Write-then-rename keeps a torn write from ever being readable.
    const temporary = `${target}.${randomUUID()}.part`;
    try {
      await writeFile(temporary, input.content, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      logger.error({ err: error, storageKey }, 'Document upload could not be written to disk');
      throw errors.internal('The document could not be stored.', error);
    }

    return {
      storageKey,
      size: input.content.byteLength,
      checksum: createHash('sha256').update(input.content).digest('hex'),
      mimeType: input.mimeType,
    };
  }

  async download(storageKey: string): Promise<StorageDownload> {
    const target = this.resolveKey(storageKey);

    let size: number;
    try {
      const info = await stat(target);
      if (!info.isFile()) throw new Error('Not a regular file');
      size = info.size;
    } catch (error) {
      logger.warn({ err: error, storageKey }, 'Stored document is missing from disk');
      throw errors.notFound('Document file');
    }

    return { stream: createReadStream(target), size, storageKey };
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const info = await stat(this.resolveKey(storageKey));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }
}
