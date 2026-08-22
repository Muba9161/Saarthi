import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Environment loading + validation.
 *
 * The whole monorepo shares a single `.env` at the repository root so the API
 * and the Vite client can never drift apart. Configuration is validated once,
 * at boot, and the process refuses to start on invalid input — a misconfigured
 * secret must fail loudly, not at the first login attempt.
 */

function findRepoRoot(startDir: string): string {
  let current = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8')) as {
        workspaces?: unknown;
      };
      if (pkg.workspaces) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

export const REPO_ROOT = findRepoRoot(__dirname);

// `.env` first, then `.env.local` overrides for machine-specific tweaks.
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
dotenv.config({ path: path.join(REPO_ROOT, '.env.local'), override: true });

const booleanish = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    });

const csv = (defaultValue: string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? defaultValue
        : value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
    );

const secret = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters long`);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: csv(['http://localhost:5173', 'http://127.0.0.1:5173']),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_SECRET: secret('COOKIE_SECRET'),
  COOKIE_SECURE: booleanish(false),
  COOKIE_DOMAIN: z.string().optional(),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  STORAGE_PROVIDER: z.enum(['local', 'object']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/documents'),
  STORAGE_MAX_FILE_SIZE: z.coerce.number().int().min(1024).default(10 * 1024 * 1024),

  // --- Media library --------------------------------------------------------
  //
  // Smaller than the document cap on purpose: renditions are produced in the
  // browser before upload, so anything larger than this is a client that did
  // not resize rather than a legitimately large photograph.
  MEDIA_MAX_FILE_SIZE: z.coerce.number().int().min(1024).default(5 * 1024 * 1024),
  MEDIA_THUMBNAIL_MAX_SIZE: z.coerce.number().int().min(1024).default(512 * 1024),
  MEDIA_MAX_PER_OWNER: z.coerce.number().int().min(1).max(200).default(24),
  /// How long a soft-deleted asset is kept before its bytes are purged.
  MEDIA_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // --- Supplier inventory ---------------------------------------------------
  STOCK_RESERVATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  STOCK_LOW_DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(8),

  // --- Vehicle resale -------------------------------------------------------
  /// A resale listing is a financial representation about an asset, so review
  /// is on by default.
  RESALE_REVIEW_REQUIRED: booleanish(true),
  RESALE_LISTING_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  RESALE_OFFER_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  // --- QR identity ----------------------------------------------------------
  QR_RESOLVE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  QR_RESOLVE_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /// 0 = codes do not expire.
  QR_DEFAULT_TTL_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
  QR_IMAGE_MAX_SIZE: z.coerce.number().int().min(128).max(4096).default(1024),

  // --- Return loads ---------------------------------------------------------
  RETURN_LOAD_MAX_PICKUP_KM: z.coerce.number().min(1).max(1000).default(150),
  RETURN_LOAD_MIN_SCORE: z.coerce.number().min(0).max(100).default(45),
  RETURN_LOAD_DEFAULT_WINDOW_HOURS: z.coerce.number().int().min(1).max(336).default(48),

  // --- Last-mile relay ------------------------------------------------------
  RELAY_OFFER_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(45),
  RELAY_BROADCAST_RADIUS_KM: z.coerce.number().min(1).max(300).default(60),

  // --- Route intelligence ---------------------------------------------------
  HAZARD_LOOKAHEAD_METERS: z.coerce.number().int().min(100).max(5000).default(800),
  HAZARD_CORRIDOR_METERS: z.coerce.number().int().min(50).max(2000).default(300),
  HAZARD_CONFIDENCE_HALF_LIFE_MINUTES: z.coerce.number().int().min(5).max(1440).default(45),
  HAZARD_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.25),
  HAZARD_REPORTS_PER_HOUR: z.coerce.number().int().min(1).max(200).default(10),
  HAZARD_VIEWPORT_MAX_FEATURES: z.coerce.number().int().min(50).max(5000).default(500),

  GPS_PROVIDER: z.enum(['mock', 'production']).default('mock'),
  PAYMENT_PROVIDER: z.enum(['mock', 'production']).default('mock'),
  NOTIFICATION_PROVIDER: z.enum(['local', 'production']).default('local'),
  VERIFICATION_PROVIDER: z.enum(['manual', 'external']).default('manual'),

  AI_PROVIDER: z.enum(['development', 'anthropic']).default('development'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_BASE_URL: z.string().optional(),

  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  QUEUE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  PUBSUB_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().optional(),

  // --- Vehicle RC lookup (Way2API) ------------------------------------------
  WAY2API_BASE_URL: z.string().url().default('https://app.way2api.com'),
  WAY2API_API_KEY: z.string().optional(),
  WAY2API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  /** Cap on the RC PDF Saarthi will pull down and store. */
  VEHICLE_RC_PDF_MAX_BYTES: z.coerce.number().int().min(1024).default(8 * 1024 * 1024),
  /** Seconds a stored RC record may be reused before a fresh lookup is billed. */
  VEHICLE_CACHE_TTL: z.coerce.number().int().min(0).max(30 * 86_400).default(86_400),
  /** RC lookups per user per minute — the provider bills each one. */
  /**
   * Hard ceiling on billable provider calls for this environment (0 = none).
   * A development guard against burning a trial allowance by accident.
   */
  VEHICLE_LOOKUP_BUDGET: z.coerce.number().int().min(0).default(0),
  VEHICLE_LOOKUP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  VEHICLE_LOOKUP_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // --- Petrol stations (SSR Innovation Lab) ---------------------------------
  SSR_PETROL_API_BASE_URL: z.string().url().default('https://api.ssrinnovationlab.com'),
  /** Optional: the directory serves unauthenticated reads today. */
  SSR_PETROL_API_KEY: z.string().optional(),
  SSR_PETROL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(12_000),
  PETROL_STATION_CACHE_TTL: z.coerce.number().int().min(0).max(30 * 86_400).default(21_600),

  // `openfreemap` needs no credentials at all. The older values stay accepted
  // so an existing deployment does not fail to boot on an outdated .env.
  MAP_PROVIDER: z.enum(['openfreemap', 'maplibre', 'mapbox']).default('openfreemap'),
  MAP_API_KEY: z.string().optional(),
  /** OpenRouteService key — routing and geocoding only, never the basemap. */
  ORS_API_KEY: z.string().optional(),
  MAP_STYLE_URL: z.string().optional(),

  DEMO_MODE: booleanish(true),
  SIMULATOR_TICK_MS: z.coerce.number().int().min(200).max(10_000).default(1000),
});

export type RawEnv = z.infer<typeof envSchema>;

function parseEnv(): RawEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration.\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }
  return parsed.data;
}

const raw = parseEnv();

const isProduction = raw.NODE_ENV === 'production';

if (isProduction) {
  const weak = ['change-me', 'secret', 'password'];
  for (const [key, value] of Object.entries({
    JWT_ACCESS_SECRET: raw.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: raw.JWT_REFRESH_SECRET,
    COOKIE_SECRET: raw.COOKIE_SECRET,
  })) {
    if (weak.some((needle) => value.toLowerCase().includes(needle))) {
      throw new Error(`${key} still contains a placeholder value — refusing to start in production.`);
    }
  }
  if (raw.DEMO_MODE) {
    throw new Error('DEMO_MODE must be false in production — simulation endpoints would be exposed.');
  }
}

export const config = {
  env: raw.NODE_ENV,
  isProduction,
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  repoRoot: REPO_ROOT,

  log: {
    level: raw.LOG_LEVEL,
    pretty: raw.NODE_ENV === 'development',
  },

  server: {
    host: raw.API_HOST,
    port: raw.API_PORT,
    apiUrl: raw.API_URL,
    frontendUrl: raw.FRONTEND_URL,
    corsOrigins: raw.CORS_ORIGINS,
  },

  database: {
    url: raw.DATABASE_URL,
  },

  auth: {
    accessSecret: raw.JWT_ACCESS_SECRET,
    refreshSecret: raw.JWT_REFRESH_SECRET,
    accessTtl: raw.JWT_ACCESS_TTL,
    refreshTtl: raw.JWT_REFRESH_TTL,
    cookieSecret: raw.COOKIE_SECRET,
    cookieSecure: raw.COOKIE_SECURE,
    cookieDomain: raw.COOKIE_DOMAIN || undefined,
    bcryptRounds: raw.NODE_ENV === 'test' ? 4 : raw.BCRYPT_ROUNDS,
    refreshCookieName: 'saarthi_refresh',
  },

  rateLimit: {
    max: raw.RATE_LIMIT_MAX,
    window: raw.RATE_LIMIT_WINDOW,
    authMax: raw.AUTH_RATE_LIMIT_MAX,
    authWindow: raw.AUTH_RATE_LIMIT_WINDOW,
  },

  storage: {
    provider: raw.STORAGE_PROVIDER,
    localPath: path.isAbsolute(raw.STORAGE_LOCAL_PATH)
      ? raw.STORAGE_LOCAL_PATH
      : path.join(REPO_ROOT, raw.STORAGE_LOCAL_PATH),
    maxFileSize: raw.STORAGE_MAX_FILE_SIZE,
  },

  media: {
    maxFileSize: raw.MEDIA_MAX_FILE_SIZE,
    maxThumbnailSize: raw.MEDIA_THUMBNAIL_MAX_SIZE,
    maxPerOwner: raw.MEDIA_MAX_PER_OWNER,
    retentionDays: raw.MEDIA_RETENTION_DAYS,
  },

  inventory: {
    reservationTtlHours: raw.STOCK_RESERVATION_TTL_HOURS,
    lowStockDigestHour: raw.STOCK_LOW_DIGEST_HOUR,
  },

  resale: {
    reviewRequired: raw.RESALE_REVIEW_REQUIRED,
    listingTtlDays: raw.RESALE_LISTING_TTL_DAYS,
    offerTtlDays: raw.RESALE_OFFER_TTL_DAYS,
  },

  qr: {
    resolveRateLimitMax: raw.QR_RESOLVE_RATE_LIMIT_MAX,
    resolveRateLimitWindow: raw.QR_RESOLVE_RATE_LIMIT_WINDOW,
    defaultTtlDays: raw.QR_DEFAULT_TTL_DAYS,
    maxImageSize: raw.QR_IMAGE_MAX_SIZE,
  },

  returnLoads: {
    maxPickupKm: raw.RETURN_LOAD_MAX_PICKUP_KM,
    minScore: raw.RETURN_LOAD_MIN_SCORE,
    defaultWindowHours: raw.RETURN_LOAD_DEFAULT_WINDOW_HOURS,
  },

  relay: {
    offerTtlMinutes: raw.RELAY_OFFER_TTL_MINUTES,
    broadcastRadiusKm: raw.RELAY_BROADCAST_RADIUS_KM,
  },

  routeIntelligence: {
    lookaheadMeters: raw.HAZARD_LOOKAHEAD_METERS,
    corridorMeters: raw.HAZARD_CORRIDOR_METERS,
    confidenceHalfLifeMinutes: raw.HAZARD_CONFIDENCE_HALF_LIFE_MINUTES,
    minConfidence: raw.HAZARD_MIN_CONFIDENCE,
    reportsPerHour: raw.HAZARD_REPORTS_PER_HOUR,
    viewportMaxFeatures: raw.HAZARD_VIEWPORT_MAX_FEATURES,
  },

  providers: {
    gps: raw.GPS_PROVIDER,
    payment: raw.PAYMENT_PROVIDER,
    notification: raw.NOTIFICATION_PROVIDER,
    verification: raw.VERIFICATION_PROVIDER,
  },

  ai: {
    provider: raw.AI_PROVIDER,
    apiKey: raw.AI_API_KEY || undefined,
    model: raw.AI_MODEL,
    baseUrl: raw.AI_BASE_URL || undefined,
  },

  infra: {
    cacheDriver: raw.CACHE_DRIVER,
    queueDriver: raw.QUEUE_DRIVER,
    pubsubDriver: raw.PUBSUB_DRIVER,
    redisUrl: raw.REDIS_URL || undefined,
  },

  vehicleRc: {
    baseUrl: raw.WAY2API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.WAY2API_API_KEY || undefined,
    timeoutMs: raw.WAY2API_TIMEOUT_MS,
    pdfMaxBytes: raw.VEHICLE_RC_PDF_MAX_BYTES,
    cacheTtlSeconds: raw.VEHICLE_CACHE_TTL,
    callBudget: raw.VEHICLE_LOOKUP_BUDGET,
    rateLimitMax: raw.VEHICLE_LOOKUP_RATE_LIMIT_MAX,
    rateLimitWindow: raw.VEHICLE_LOOKUP_RATE_LIMIT_WINDOW,
  },

  petrolStations: {
    baseUrl: raw.SSR_PETROL_API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.SSR_PETROL_API_KEY || undefined,
    timeoutMs: raw.SSR_PETROL_TIMEOUT_MS,
    cacheTtlSeconds: raw.PETROL_STATION_CACHE_TTL,
  },

  maps: {
    provider: raw.MAP_PROVIDER,
    /** Basemap credential. The open stack needs none; kept for other providers. */
    apiKey: raw.MAP_API_KEY || undefined,
    routingApiKey: raw.ORS_API_KEY || undefined,
    styleUrl: raw.MAP_STYLE_URL || undefined,
  },

  demo: {
    enabled: raw.DEMO_MODE,
    simulatorTickMs: raw.SIMULATOR_TICK_MS,
  },
} as const;

export type AppConfig = typeof config;
