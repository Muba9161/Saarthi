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
// External integrations: a dummy key so the provider constructs, with every
// outbound call stubbed in the tests themselves. No paid API is ever called.
process.env.WAY2API_BASE_URL = 'https://way2api.test';
process.env.WAY2API_API_KEY = 'test-way2api-key';
process.env.WAY2API_TIMEOUT_MS = '2000';
process.env.VEHICLE_CACHE_TTL = '3600';
// No call ceiling in tests — every provider call is stubbed, so none are billable.
process.env.VEHICLE_LOOKUP_BUDGET = '0';
process.env.LICENCE_CACHE_TTL = '3600';
process.env.LICENCE_LOOKUP_BUDGET = '0';
process.env.SSR_PETROL_API_BASE_URL = 'https://petrol.test';
process.env.SSR_PETROL_API_KEY = '';
process.env.SSR_PETROL_TIMEOUT_MS = '2000';
process.env.PETROL_STATION_CACHE_TTL = '600';
// Nearby places read the `nearby_places` table only.
//
// The Overpass adapter has its own unit tests over recorded payloads; wiring the
// live directory in here would put a shared, unfunded public instance on the
// critical path of the whole suite, and make every assertion about what happens
// to be mapped in OpenStreetMap today.
process.env.PLACES_PROVIDER = 'local';
process.env.NEARBY_PLACE_CACHE_TTL = '0';

// Rate limits are raised, not disabled.
//
// Every fixture user signs in to get a token, so a test file that builds four
// users per case issues hundreds of logins a minute — far past the production
// AUTH_RATE_LIMIT_MAX of 10, which exists to stop credential stuffing rather
// than to throttle a test harness. No test asserts these two limiters, so
// raising them removes a source of flakiness without weakening any assertion.
// The provider-side limiters (vehicle lookup, petrol stations) are deliberately
// left alone, because tests *do* assert those.
process.env.AUTH_RATE_LIMIT_MAX = '10000';
process.env.RATE_LIMIT_MAX = '100000';
process.env.QR_RESOLVE_RATE_LIMIT_MAX = '10000';

// Device credentials are their own population with their own signing key, so
// the tests exercise the same split production enforces rather than falling
// back to the user secret.
process.env.DEVICE_JWT_SECRET ||= 'test-device-secret-value-that-is-long-enough-123456';
process.env.DEVICE_ENROLMENT_RATE_LIMIT_MAX = '10000';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-value-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-value-that-is-long-enough-123456';
process.env.COOKIE_SECRET ||= 'test-cookie-secret-value-that-is-long-enough-123456';
