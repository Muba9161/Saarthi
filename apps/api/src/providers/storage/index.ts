import { config } from '../../config/env';
import { logger } from '../../lib/logger';
import { LocalStorageProvider } from './local-storage.provider';
import type { StorageProvider } from './storage.provider';

/**
 * Storage provider factory.
 *
 * `object` is reserved for a hosted bucket. Until one is configured it falls
 * back to local disk with a warning rather than failing at boot — the same
 * degrade-never-fail rule the AI provider follows.
 */
function createStorageProvider(): StorageProvider {
  if (config.storage.provider === 'object') {
    logger.warn(
      'STORAGE_PROVIDER=object is not configured yet — falling back to local disk storage',
    );
  }
  return new LocalStorageProvider();
}

export const storageProvider: StorageProvider = createStorageProvider();

logger.info(
  { provider: storageProvider.name, path: config.storage.localPath },
  'Storage provider ready',
);

export * from './storage.provider';
