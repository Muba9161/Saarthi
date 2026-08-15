import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Test environment bootstrap.
 *
 * Runs before any application module is imported, so the config layer reads
 * these values instead of the developer's real `.env`. Tests always run
 * against a dedicated `saarthi_test` database — never the demo database.
 */
const repoRoot = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const baseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/saarthi';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = baseUrl.replace(/\/saarthi(\?|$)/, '/saarthi_test$1');
process.env.LOG_LEVEL = 'silent';
process.env.DEMO_MODE = 'true';
process.env.CACHE_DRIVER = 'memory';
process.env.QUEUE_DRIVER = 'memory';
process.env.PUBSUB_DRIVER = 'memory';
process.env.STORAGE_PROVIDER = 'local';
process.env.STORAGE_LOCAL_PATH = './storage/test-documents';
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-value-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-value-that-is-long-enough-123456';
process.env.COOKIE_SECRET ||= 'test-cookie-secret-value-that-is-long-enough-123456';
