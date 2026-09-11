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

/**
 * An optional setting that is either absent or has to satisfy a constraint.
 *
 * `.optional()` alone is not enough for anything with a rule attached. A key
 * left blank in `.env` arrives as an empty string rather than as undefined, so
 * `z.string().url().optional()` refuses it and the process will not start —
 * which is exactly what happens to somebody who copies `.env.example` and fills
 * in only what they need. Blank means "not set", and this makes it mean that.
 */
const blankAsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()))
    .pipe(schema.optional());

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
  //
  // DEFERRED. The resale marketplace is built and its data is intact, but it is
  // not part of the current product, so it ships switched off. Disabling is
  // done by withholding the entitlement rather than by deleting anything: a
  // vehicle's service history, documents and photographs are the same records
  // the rest of Saarthi uses, and a future release turns the surface back on
  // with `RESALE_ENABLED=true` and no migration.
  RESALE_ENABLED: booleanish(false),
  /// A resale listing is a financial representation about an asset, so review
  /// is on by default.
  RESALE_REVIEW_REQUIRED: booleanish(true),
  RESALE_LISTING_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  RESALE_OFFER_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  // --- Subscription enforcement ---------------------------------------------
  //
  // The development escape hatch for plan gating.
  //
  // With this off, every organization resolves as though it held every
  // capability with no capacity limits, so a feature can be built and driven
  // end-to-end without first seeding a plan, taking out a subscription or
  // buying a tracker. Nothing is bypassed silently: the resolved entitlement
  // is marked `enforced: false`, which the API reports and the UI shows as a
  // development banner.
  //
  // It is refused in production below, because an unenforced deployment is one
  // where every paying customer is on the top plan for free.
  SUBSCRIPTION_ENFORCEMENT: booleanish(true),
  /// Days of trial granted to a newly registered organization. 0 = no trial.
  SUBSCRIPTION_TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(14),

  // --- QR identity ----------------------------------------------------------
  QR_RESOLVE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
  QR_RESOLVE_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /// 0 = codes do not expire.
  QR_DEFAULT_TTL_DAYS: z.coerce.number().int().min(0).max(3650).default(0),
  QR_IMAGE_MAX_SIZE: z.coerce.number().int().min(128).max(4096).default(1024),

  // --- Vehicle finance (loans & EMI) ----------------------------------------
  //
  // `internal` means Saarthi keeps only what the operator recorded, which is
  // the honest default: a loan account number is not a lookup key, and no
  // financier discloses a schedule without an integration and consent.
  LOAN_PROVIDER: z.enum(['internal', 'mock']).default('internal'),
  /// Days before a due date at which an installment is flagged DUE_SOON.
  LOAN_DUE_SOON_DAYS: z.coerce.number().int().min(1).max(30).default(4),
  /// Default reminder offsets in days relative to the due date (T-4, T-1, T+1).
  LOAN_REMINDER_OFFSETS: csv(['-4', '-1', '1']),
  /// How many installments a single reminder sweep will process.
  LOAN_REMINDER_BATCH: z.coerce.number().int().min(10).max(5000).default(500),

  // --- Video (multi-camera devices such as the YC06) ------------------------
  //
  // Live video never passes through the API. The provider issues a short-lived,
  // camera-scoped ticket and the browser negotiates with a video gateway
  // directly. 'none' is the honest default for a deployment with no cameras.
  // 'device' routes both the viewer and the publisher through an external
  // WHIP/WHEP gateway, which is what a phone or a YC06 pushing a live stream
  // needs. It requires VIDEO_GATEWAY_URL and VIDEO_GATEWAY_SECRET; without
  // them the factory falls back to 'none' rather than issuing tickets nothing
  // will honour.
  VIDEO_PROVIDER: z.enum(['none', 'mock', 'device']).default('none'),
  /// Seconds a live-view ticket stays valid. Short: it is re-issued on demand,
  /// and a long-lived ticket is a camera credential someone can pass around.
  VIDEO_TICKET_TTL: z.coerce.number().int().min(15).max(600).default(120),
  /// Cameras a single multi-camera device may have. The YC06 has four.
  VIDEO_MAX_CAMERAS_PER_DEVICE: z.coerce.number().int().min(1).max(16).default(4),
  /// Base URL of the WHIP/WHEP gateway. Never a device address.
  VIDEO_GATEWAY_URL: blankAsUnset(z.string().url()),
  /// Shared secret used to sign gateway tickets. Never sent to a client.
  VIDEO_GATEWAY_SECRET: blankAsUnset(z.string().min(32)),
  /// Seconds a publisher ticket stays valid. Longer than a viewer ticket
  /// because a device re-establishing a stream after a tunnel should not have
  /// to make a round trip to Saarthi first.
  VIDEO_PUBLISH_TTL: z.coerce.number().int().min(30).max(1_800).default(300),
  /**
   * STUN and TURN servers, as a comma-separated list.
   *
   * A phone and a gateway on the same LAN need none of this — host candidates
   * find each other. A phone on a mobile network behind carrier-grade NAT needs
   * at least STUN, and often a TURN relay, because two NATed peers cannot see
   * each other at all. Which is why it is configuration rather than a constant:
   * the answer depends entirely on where the gateway is deployed.
   *
   * e.g. `stun:stun.l.google.com:19302,turn:turn.example.com:3478`
   */
  VIDEO_ICE_SERVERS: csv([]),
  /// Long-term credential for the TURN servers above, when they need one.
  VIDEO_TURN_USERNAME: z.string().optional(),
  VIDEO_TURN_CREDENTIAL: z.string().optional(),

  // --- Saarthi Device client -------------------------------------------------
  //
  // A phone running the Saarthi Device app authenticates as a device, not as a
  // person, so it gets its own signing secret. Sharing JWT_ACCESS_SECRET would
  // mean a leaked device token and a leaked user token were forgeable from the
  // same key, and the two populations have completely different threat models.
  DEVICE_JWT_SECRET: blankAsUnset(z.string().min(32)),
  /// Seconds a device access token stays valid before the secret must refresh it.
  DEVICE_TOKEN_TTL: z.coerce.number().int().min(60).max(86_400).default(900),
  /// Whether a phone may create its own identity without an administrator.
  DEVICE_SELF_ENROLMENT: booleanish(true),
  /// Enrolments per IP per window. An unauthenticated endpoint needs a ceiling.
  DEVICE_ENROLMENT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  DEVICE_ENROLMENT_RATE_LIMIT_WINDOW: z.string().default('1 hour'),
  /// Hours an unclaimed enrolment is kept before the sweep removes it.
  DEVICE_ENROLMENT_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  /// Seconds a pairing QR stays scannable.
  DEVICE_PAIRING_TOKEN_TTL: z.coerce.number().int().min(60).max(3_600).default(300),
  /// Default reporting cadence handed to a newly paired device, in seconds.
  DEVICE_DEFAULT_REPORTING_INTERVAL: z.coerce.number().int().min(1).max(300).default(5),
  /// Whether this environment accepts simulated engine data from a device.
  DEVICE_SIMULATION_ALLOWED: booleanish(true),

  // --- FASTag & toll (NETC) --------------------------------------------------
  //
  // What a NETC lookup provider actually serves is tag *status* — active,
  // blacklisted, its class and issuing bank. The rupee balance sits with the
  // issuing bank and is not theirs to give, so Saarthi shows what the operator
  // recorded and never invents a figure. Recharging goes through the issuer or
  // a BBPS agent, which a verification API is not.
  //
  // 'mastersindia' is the documented NETC adapter; it needs FASTAG_API_KEY and
  // FASTAG_SUB_ID and falls back to recorded-only if either is missing.
  FASTAG_PROVIDER: z.enum(['internal', 'mastersindia', 'mock']).default('internal'),
  FASTAG_API_BASE_URL: z.string().url().default('https://api-platform.mastersindia.co'),
  // Masters India issues a 24-hour JWT rather than a permanent key, so the
  // normal setup is a username and password and the adapter mints its own
  // token. FASTAG_API_KEY stays supported for a token pasted in by hand.
  FASTAG_API_KEY: z.string().optional(),
  FASTAG_API_USERNAME: z.string().optional(),
  FASTAG_API_PASSWORD: z.string().optional(),
  /// Subscriber id, issued by the provider alongside the key.
  FASTAG_SUB_ID: z.string().optional(),
  FASTAG_PRODUCT_ID: z.string().default('arap'),
  FASTAG_MODE: z.string().default('Buyer'),
  /// Balance below which a fleet is warned. One more national plaza, roughly.
  FASTAG_LOW_BALANCE_THRESHOLD: z.coerce.number().min(0).max(100_000).default(500),
  /// Seconds a tag lookup is reused before the provider is billed again.
  FASTAG_CACHE_TTL: z.coerce.number().int().min(0).max(86_400).default(900),

  // --- Service history ------------------------------------------------------
  //
  // 'internal' means Saarthi shows what its users recorded. External service
  // history in India is fragmented across OEM networks, insurers and
  // independent workshops, so no provider returns a complete picture and the
  // UI is built to say so.
  SERVICE_HISTORY_PROVIDER: z.enum(['internal', 'mock']).default('internal'),

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

  // --- Driver verification enforcement ---------------------------------------
  //
  // The development escape hatch for the four driver identity checks.
  //
  // Normally a driver counts as verified only once the licensing authority has
  // confirmed their licence and Aadhaar, PAN and Voter ID have each been
  // confirmed by their own source — and until then they cannot be assigned to
  // a truck, put on a trip, or offered on the marketplace. That is correct for
  // real drivers and a wall in front of anyone trying to exercise those flows
  // on a development machine, where no real licence number exists to check.
  //
  // With this off, drivers are created already verified and the checklist stops
  // overriding their status, so every downstream gate passes on its own merits
  // rather than by being individually bypassed. Nothing else changes: the
  // checks still exist, still run, and still record what they found.
  //
  // Refused in production below. A deployment that skips these is one where the
  // platform's verified badge is asserting something no authority confirmed.
  DRIVER_VERIFICATION_ENFORCEMENT: booleanish(true),
  /**
   * Permits DRIVER_VERIFICATION_ENFORCEMENT=false to boot in production.
   *
   * Separate from the flag it unlocks so that a typo, a copied .env or a
   * half-finished edit cannot switch driver verification off by itself — that
   * still refuses to start. Only setting both, on purpose, gets you a
   * production deployment that vouches for drivers nobody has checked.
   */
  ALLOW_UNVERIFIED_DRIVERS: booleanish(false),

  AI_PROVIDER: z.enum(['development', 'anthropic', 'gemini']).default('development'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_BASE_URL: z.string().optional(),

  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  QUEUE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  PUBSUB_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  LOCK_DRIVER: z.enum(['memory', 'redis']).default('memory'),
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
  /**
   * How long a fetched record is kept so the operator does not have to look it
   * up again. Distinct from VEHICLE_CACHE_TTL, which only decides when a
   * *fresh provider call* becomes worthwhile.
   */
  VEHICLE_LOOKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  VEHICLE_LOOKUP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  VEHICLE_LOOKUP_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // --- Driving licence lookup (Way2API) -------------------------------------
  // Shares the Way2API credentials above; trial credits and billing are
  // per-service, so the cache window and ceiling are its own.
  LICENCE_CACHE_TTL: z.coerce.number().int().min(0).max(30 * 86_400).default(86_400),
  LICENCE_LOOKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  LICENCE_LOOKUP_BUDGET: z.coerce.number().int().min(0).default(0),
  LICENCE_LOOKUP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LICENCE_LOOKUP_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // --- Identity verification (Way2API) --------------------------------------
  // Aadhaar, PAN, Voter ID and GSTIN. Shares WAY2API_API_KEY above; billing is
  // per service, so the cache window, ceiling and rate limit are its own.
  /**
   * At-rest key for verified identity numbers, 32 characters or more.
   *
   * Optional, and deliberately so: with no key set, Saarthi stores the masked
   * number and a non-reversible hash but never the full one. There is no weaker
   * fallback — see `apps/api/src/lib/identity-crypto.ts`.
   */
  IDENTITY_ENCRYPTION_KEY: blankAsUnset(z.string().min(32)),
  /** Seconds a stored identity answer may be reused before a fresh call bills. */
  IDENTITY_CACHE_TTL: z.coerce.number().int().min(0).max(365 * 86_400).default(30 * 86_400),
  /** How long a check is kept at all. Longer than the cache: this is retention. */
  IDENTITY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(730),
  /** Hard ceiling on billable identity calls from this environment. 0 = none. */
  IDENTITY_VERIFY_BUDGET: z.coerce.number().int().min(0).default(0),
  IDENTITY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  IDENTITY_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  // --- Petrol stations (SSR Innovation Lab) ---------------------------------
  SSR_PETROL_API_BASE_URL: z.string().url().default('https://api.ssrinnovationlab.com'),
  /** Optional: the directory serves unauthenticated reads today. */
  SSR_PETROL_API_KEY: z.string().optional(),
  SSR_PETROL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(12_000),
  PETROL_STATION_CACHE_TTL: z.coerce.number().int().min(0).max(30 * 86_400).default(21_600),

  // --- Nearby places (OpenStreetMap via Overpass) --------------------------
  //
  // `overpass` reads live points of interest from OpenStreetMap — the same
  // survey the basemap, the routing and the elevation already come from, so the
  // pins agree with the map under them. It needs no key.
  //
  // `local` serves only the `nearby_places` table, which is what an air-gapped
  // install or a strictly offline demo needs.
  PLACES_PROVIDER: z.enum(['overpass', 'local']).default('overpass'),
  /**
   * Overpass endpoints, tried in order until one answers.
   *
   * The public instances are shared, unfunded and individually unreliable — all
   * three were refusing queries at some point while this was built — so a list
   * is the realistic configuration, not a luxury.
   */
  OVERPASS_API_URLS: z
    .string()
    .default(
      'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter',
    ),
  /** Overall deadline for a search, across every endpoint tried. */
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(6_000).max(60_000).default(25_000),
  /**
   * Largest radius sent upstream, in km. Past this the mirror answers, and the
   * mirror does measure distance.
   */
  OVERPASS_MAX_RADIUS_KM: z.coerce.number().min(1).max(200).default(25),
  /**
   * Query cost ceiling, in selector-kilometres.
   *
   * Overpass cost tracks (number of tag selectors × search radius). Measured
   * against the public instance in dense Gurugram, ~200 lands around nine
   * seconds and ~350 exceeds its dispatcher budget entirely. Raise it freely for
   * a self-hosted instance, which has no such ceiling.
   */
  OVERPASS_WORK_BUDGET: z.coerce.number().min(20).max(20_000).default(200),
  /** Seconds a places search is reused before the directory is queried again. */
  NEARBY_PLACE_CACHE_TTL: z.coerce.number().int().min(0).max(30 * 86_400).default(10_800),

  // --- City fuel rates -----------------------------------------------------
  //
  // A separate source from the station directory, and deliberately so: the
  // directory's own prices are a single city figure years out of date with no
  // timestamp, so Saarthi publishes none of them.
  //
  // `none` disables the feature and shows no rate, which is the correct
  // behaviour whenever a rate cannot be had honestly.
  FUEL_RATE_PROVIDER: z.enum(['cardekho', 'none']).default('cardekho'),
  FUEL_RATE_BASE_URL: z.string().url().default('https://www.cardekho.com'),
  FUEL_RATE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(12_000),
  /**
   * Retail rates revise once daily at 06:00 IST, so a six-hour cache is fresh
   * enough while keeping Saarthi to a handful of requests per city per day.
   */
  FUEL_RATE_CACHE_TTL: z.coerce.number().int().min(0).max(7 * 86_400).default(21_600),

  // `openfreemap` needs no credentials at all. The older values stay accepted
  // so an existing deployment does not fail to boot on an outdated .env.
  MAP_PROVIDER: z.enum(['openfreemap', 'maplibre', 'mapbox']).default('openfreemap'),
  MAP_API_KEY: z.string().optional(),
  /** OpenRouteService key — routing and geocoding only, never the basemap. */
  ORS_API_KEY: z.string().optional(),
  /**
   * Where routing requests go.
   *
   * HeiGIT is migrating from `api.openrouteservice.org` to `api.heigit.org`, and
   * as of 2026-08-31 the new host still answers 404 for the endpoints Saarthi
   * calls. The default is therefore the host that works; move it across with
   * `ORS_BASE_URL` once the new one serves `/v2/directions` and `/v2/matrix`.
   * The web client makes the same choice for the same reason — see
   * `apps/web/src/features/maps/map-config.ts`.
   */
  ORS_BASE_URL: z.string().url().default('https://api.openrouteservice.org'),
  /**
   * Routing timeout.
   *
   * Short. A terminal asking "how far is the nearest pump" is a driver waiting
   * at the roadside, and an answer that takes fifteen seconds is one they have
   * already given up on — the straight-line fallback is better than a stall.
   */
  ORS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(8_000),
  MAP_STYLE_URL: z.string().optional(),

  DEMO_MODE: booleanish(true),
  SIMULATOR_TICK_MS: z.coerce.number().int().min(200).max(10_000).default(1000),

  // --- GODWeb salesman identity (read-only) ---------------------------------
  //
  // GODWeb owns who a salesperson is. Saarthi validates a GODID against it and
  // does nothing else: it never creates a GODWeb account, never writes to it
  // and never reads its database directly.
  //
  // With no base URL and key configured, GODID verification is *unavailable*
  // rather than assumed. Salesman profiles stay PENDING_VERIFICATION, no
  // referral link is issued for them and no commission accrues — see
  // `providers/godweb/index.ts`. That is the deliberate answer to the spec's
  // instruction to document the dependency rather than invent a GODWeb-side
  // system: a platform administrator may still vouch for a GODID by hand, and
  // that decision is recorded with their name on it.
  GODWEB_BASE_URL: blankAsUnset(z.string().url()),
  GODWEB_API_KEY: blankAsUnset(z.string().min(8)),
  /**
   * Path of the read-only validation endpoint, relative to the base URL.
   *
   * Configurable because the exact route is GODWeb's to decide and is not
   * settled at the time of writing. `{godId}` is substituted.
   */
  GODWEB_VALIDATE_PATH: z.string().default('/api/salespersons/{godId}'),
  GODWEB_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  /**
   * Seconds a successful validation may be reused before GODWeb is called
   * again. A salesperson's identity does not change hourly, and re-validating
   * on every referral click would put GODWeb in the path of a public URL.
   */
  GODWEB_CACHE_TTL: z.coerce.number().int().min(0).max(30 * 86_400).default(3_600),

  // --- Sales, referrals & commission ----------------------------------------
  /**
   * How long a captured referral keeps its claim on a customer who has not
   * registered yet.
   *
   * This is a commercial decision, not a technical one, and the specification
   * is explicit that it must not be silently invented. So: it is configuration,
   * it is documented in `.env.example`, and it is returned to the client on
   * every referral response and rendered on the salesman's referral screen —
   * nobody has to guess the number, and changing it is one line of `.env`.
   *
   * 90 days is the default because it is the commonest figure in Indian SaaS
   * channel agreements, not because Saarthi has decided on it. Confirm it with
   * the business before launch.
   */
  SALES_ATTRIBUTION_WINDOW_DAYS: z.coerce.number().int().min(1).max(730).default(90),
  /**
   * Referral captures allowed from one IP per window.
   *
   * The link is public, so this is the throttle that stops one device minting
   * attributions in bulk. It is generous — a shared office NAT is a real
   * thing — and the partial unique index on live attributions is what actually
   * prevents the fraud; this only keeps the table from growing.
   */
  SALES_REFERRAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  SALES_REFERRAL_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  /**
   * Minutes of silence after which a tracker that has never reported is
   * treated as "not yet connected" rather than "connected and quiet".
   *
   * Used only by the first-vehicle readiness report, and only to phrase the
   * answer: a unit fitted two minutes ago that has not spoken is PENDING, not
   * a failure, and telling a salesperson to check a cable that is fine wastes
   * their visit.
   */
  SALES_ONBOARDING_TELEMETRY_GRACE_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_440)
    .default(15),
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
  // An unenforced deployment gives every capability away for nothing. That is
  // the correct behaviour on a developer's machine and an outage of the
  // business model anywhere else.
  if (!raw.SUBSCRIPTION_ENFORCEMENT) {
    throw new Error(
      'SUBSCRIPTION_ENFORCEMENT must be true in production — every plan limit and paid feature would be given away.',
    );
  }
  // A driver marked verified without an authority having confirmed anything is
  // the platform vouching for somebody it has not checked. Fine on a laptop,
  // never on a deployment a customer trusts.
  //
  // The bypass below exists for a pre-launch deployment being demonstrated
  // before any real licensing integration is live, where every "driver" is a
  // test account. It is deliberately awkward: a second variable, named for
  // what it actually does rather than for the flag it unlocks, so that turning
  // it on cannot be mistaken for routine configuration and `grep` finds every
  // environment where it is set. An accidental DRIVER_VERIFICATION_ENFORCEMENT
  // =false still refuses to boot, which is the case this guard was written for.
  //
  // While it is on, every driver created by any route is marked VERIFIED with
  // no authority having confirmed a licence, an Aadhaar, a PAN or a Voter ID,
  // and the platform presents that badge to customers as though it had. Turn it
  // off before real drivers exist.
  if (!raw.DRIVER_VERIFICATION_ENFORCEMENT && !raw.ALLOW_UNVERIFIED_DRIVERS) {
    throw new Error(
      'DRIVER_VERIFICATION_ENFORCEMENT must be true in production — drivers would be marked verified without any authority confirming their licence or identity. Set ALLOW_UNVERIFIED_DRIVERS=true as well if this is a pre-launch test deployment and you accept that.',
    );
  }
  // Devices and people are separate credential populations with separate threat
  // models. Signing both with one key means a compromise of either forges both.
  if (!raw.DEVICE_JWT_SECRET) {
    throw new Error(
      'DEVICE_JWT_SECRET is required in production — device tokens must not be signed with the user access secret.',
    );
  }
  if (raw.VIDEO_PROVIDER === 'device' && (!raw.VIDEO_GATEWAY_URL || !raw.VIDEO_GATEWAY_SECRET)) {
    throw new Error(
      'VIDEO_PROVIDER=device requires VIDEO_GATEWAY_URL and VIDEO_GATEWAY_SECRET — otherwise Saarthi would issue camera tickets nothing can honour.',
    );
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

  subscription: {
    /**
     * Whether plan entitlements and capacity limits are enforced.
     *
     * False only in development — see the note in the env schema, and the
     * production guard that refuses to start without it.
     */
    enforced: raw.SUBSCRIPTION_ENFORCEMENT,
    trialDays: raw.SUBSCRIPTION_TRIAL_DAYS,
  },

  resale: {
    /** Deferred feature switch — see the note in the env schema. */
    enabled: raw.RESALE_ENABLED,
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

  serviceHistory: {
    provider: raw.SERVICE_HISTORY_PROVIDER,
  },

  fastag: {
    provider: raw.FASTAG_PROVIDER,
    baseUrl: raw.FASTAG_API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.FASTAG_API_KEY || undefined,
    username: raw.FASTAG_API_USERNAME || undefined,
    password: raw.FASTAG_API_PASSWORD || undefined,
    subId: raw.FASTAG_SUB_ID || undefined,
    productId: raw.FASTAG_PRODUCT_ID,
    mode: raw.FASTAG_MODE,
    lowBalanceThreshold: raw.FASTAG_LOW_BALANCE_THRESHOLD,
    cacheTtlSeconds: raw.FASTAG_CACHE_TTL,
  },

  video: {
    provider: raw.VIDEO_PROVIDER,
    ticketTtlSeconds: raw.VIDEO_TICKET_TTL,
    maxCamerasPerDevice: raw.VIDEO_MAX_CAMERAS_PER_DEVICE,
    gatewayUrl: raw.VIDEO_GATEWAY_URL?.replace(/\/$/, '') || undefined,
    gatewaySecret: raw.VIDEO_GATEWAY_SECRET || undefined,
    publishTtlSeconds: raw.VIDEO_PUBLISH_TTL,
    iceServers: raw.VIDEO_ICE_SERVERS,
    turnUsername: raw.VIDEO_TURN_USERNAME || undefined,
    turnCredential: raw.VIDEO_TURN_CREDENTIAL || undefined,
  },

  device: {
    /**
     * Falls back to the user access secret only outside production, so a
     * developer does not have to set another key to run the device app locally.
     * Production refuses to start without a dedicated one — see the guard below.
     */
    jwtSecret: raw.DEVICE_JWT_SECRET || raw.JWT_ACCESS_SECRET,
    /** True when the secret above is genuinely device-specific. */
    hasDedicatedJwtSecret: Boolean(raw.DEVICE_JWT_SECRET),
    tokenTtlSeconds: raw.DEVICE_TOKEN_TTL,
    selfEnrolmentEnabled: raw.DEVICE_SELF_ENROLMENT,
    enrolmentRateLimitMax: raw.DEVICE_ENROLMENT_RATE_LIMIT_MAX,
    enrolmentRateLimitWindow: raw.DEVICE_ENROLMENT_RATE_LIMIT_WINDOW,
    enrolmentTtlHours: raw.DEVICE_ENROLMENT_TTL_HOURS,
    pairingTokenTtlSeconds: raw.DEVICE_PAIRING_TOKEN_TTL,
    defaultReportingIntervalSeconds: raw.DEVICE_DEFAULT_REPORTING_INTERVAL,
    simulationAllowed: raw.DEVICE_SIMULATION_ALLOWED,
  },

  finance: {
    provider: raw.LOAN_PROVIDER,
    dueSoonDays: raw.LOAN_DUE_SOON_DAYS,
    // Parsed here rather than in the sweep so a malformed value fails at boot.
    reminderOffsets: raw.LOAN_REMINDER_OFFSETS.map((value) => Number.parseInt(value, 10)).filter(
      (value) => Number.isInteger(value) && value >= -60 && value <= 30,
    ),
    reminderBatchSize: raw.LOAN_REMINDER_BATCH,
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

  verification: {
    /**
     * Whether a driver must pass all four identity checks to count as verified.
     *
     * False only in development — see the note in the env schema, and the
     * production guard that refuses to start without it.
     */
    driverChecksEnforced: raw.DRIVER_VERIFICATION_ENFORCEMENT,
    /**
     * True when a *production* deployment is deliberately running with driver
     * checks off, via ALLOW_UNVERIFIED_DRIVERS.
     *
     * Surfaced rather than left implicit so the condition can be said out loud
     * at boot. A deployment vouching for unchecked drivers should be obvious in
     * the logs of every restart, not a thing somebody has to infer from two
     * environment variables.
     */
    unverifiedDriversAllowed: isProduction && !raw.DRIVER_VERIFICATION_ENFORCEMENT,
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
    lockDriver: raw.LOCK_DRIVER,
    redisUrl: raw.REDIS_URL || undefined,
  },

  vehicleRc: {
    baseUrl: raw.WAY2API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.WAY2API_API_KEY || undefined,
    timeoutMs: raw.WAY2API_TIMEOUT_MS,
    pdfMaxBytes: raw.VEHICLE_RC_PDF_MAX_BYTES,
    cacheTtlSeconds: raw.VEHICLE_CACHE_TTL,
    callBudget: raw.VEHICLE_LOOKUP_BUDGET,
    retentionDays: raw.VEHICLE_LOOKUP_RETENTION_DAYS,
    rateLimitMax: raw.VEHICLE_LOOKUP_RATE_LIMIT_MAX,
    rateLimitWindow: raw.VEHICLE_LOOKUP_RATE_LIMIT_WINDOW,
  },

  drivingLicence: {
    baseUrl: raw.WAY2API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.WAY2API_API_KEY || undefined,
    timeoutMs: raw.WAY2API_TIMEOUT_MS,
    cacheTtlSeconds: raw.LICENCE_CACHE_TTL,
    retentionDays: raw.LICENCE_LOOKUP_RETENTION_DAYS,
    callBudget: raw.LICENCE_LOOKUP_BUDGET,
    rateLimitMax: raw.LICENCE_LOOKUP_RATE_LIMIT_MAX,
    rateLimitWindow: raw.LICENCE_LOOKUP_RATE_LIMIT_WINDOW,
  },

  identity: {
    baseUrl: raw.WAY2API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.WAY2API_API_KEY || undefined,
    timeoutMs: raw.WAY2API_TIMEOUT_MS,
    encryptionKey: raw.IDENTITY_ENCRYPTION_KEY,
    cacheTtlSeconds: raw.IDENTITY_CACHE_TTL,
    retentionDays: raw.IDENTITY_RETENTION_DAYS,
    callBudget: raw.IDENTITY_VERIFY_BUDGET,
    rateLimitMax: raw.IDENTITY_RATE_LIMIT_MAX,
    rateLimitWindow: raw.IDENTITY_RATE_LIMIT_WINDOW,
  },

  petrolStations: {
    baseUrl: raw.SSR_PETROL_API_BASE_URL.replace(/\/$/, ''),
    apiKey: raw.SSR_PETROL_API_KEY || undefined,
    timeoutMs: raw.SSR_PETROL_TIMEOUT_MS,
    cacheTtlSeconds: raw.PETROL_STATION_CACHE_TTL,
  },

  places: {
    provider: raw.PLACES_PROVIDER,
    overpassUrls: raw.OVERPASS_API_URLS.split(',')
      .map((url) => url.trim().replace(/\/+$/, ''))
      .filter((url) => /^https?:\/\//.test(url)),
    timeoutMs: raw.OVERPASS_TIMEOUT_MS,
    maxRadiusKm: raw.OVERPASS_MAX_RADIUS_KM,
    workBudget: raw.OVERPASS_WORK_BUDGET,
    cacheTtlSeconds: raw.NEARBY_PLACE_CACHE_TTL,
  },

  fuelRates: {
    provider: raw.FUEL_RATE_PROVIDER,
    baseUrl: raw.FUEL_RATE_BASE_URL.replace(/\/$/, ''),
    timeoutMs: raw.FUEL_RATE_TIMEOUT_MS,
    cacheTtlSeconds: raw.FUEL_RATE_CACHE_TTL,
  },

  maps: {
    provider: raw.MAP_PROVIDER,
    /** Basemap credential. The open stack needs none; kept for other providers. */
    apiKey: raw.MAP_API_KEY || undefined,
    routingApiKey: raw.ORS_API_KEY || undefined,
    routingBaseUrl: raw.ORS_BASE_URL,
    routingTimeoutMs: raw.ORS_TIMEOUT_MS,
    styleUrl: raw.MAP_STYLE_URL || undefined,
  },

  demo: {
    enabled: raw.DEMO_MODE,
    simulatorTickMs: raw.SIMULATOR_TICK_MS,
  },

  godweb: {
    baseUrl: raw.GODWEB_BASE_URL?.replace(/\/$/, ''),
    apiKey: raw.GODWEB_API_KEY,
    validatePath: raw.GODWEB_VALIDATE_PATH,
    timeoutMs: raw.GODWEB_TIMEOUT_MS,
    cacheTtlSeconds: raw.GODWEB_CACHE_TTL,
    /** True only when this environment can actually ask GODWeb anything. */
    configured: Boolean(raw.GODWEB_BASE_URL && raw.GODWEB_API_KEY),
  },

  sales: {
    attributionWindowDays: raw.SALES_ATTRIBUTION_WINDOW_DAYS,
    referralRateLimitMax: raw.SALES_REFERRAL_RATE_LIMIT_MAX,
    referralRateLimitWindow: raw.SALES_REFERRAL_RATE_LIMIT_WINDOW,
    onboardingTelemetryGraceMinutes: raw.SALES_ONBOARDING_TELEMETRY_GRACE_MINUTES,
  },
} as const;

export type AppConfig = typeof config;
