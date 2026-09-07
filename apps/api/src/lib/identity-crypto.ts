import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config/env';
import { logger } from './logger';

/**
 * At-rest protection for identity numbers.
 *
 * An Aadhaar number is not a password — it cannot be one-way hashed and thrown
 * away, because a re-check has to send the same number upstream again. So two
 * different derivations are used, for two different jobs:
 *
 *  * **HMAC** produces `numberHash`: a stable, non-reversible key that answers
 *    "have we already checked this number" without the number being readable
 *    in the table or in a database backup.
 *  * **AES-256-GCM** produces `encryptedNumber`: reversible, authenticated, and
 *    written *only* when `IDENTITY_ENCRYPTION_KEY` is configured.
 *
 * There is deliberately no fallback for the encryption key. If it is unset the
 * full number is simply not retained — a re-check asks the operator to type it
 * again. Deriving a key from `COOKIE_SECRET` to "make it work" would put an
 * Aadhaar number in the database protected by a secret that exists for an
 * unrelated purpose and rotates on a different schedule, which is worse than
 * not storing it at all.
 *
 * The HMAC pepper does fall back to `COOKIE_SECRET`, and that is sound: an HMAC
 * discloses nothing even if the pepper leaks, it only stops offline enumeration
 * of a 12-digit space, and a hash that changes when the key is set would orphan
 * every stored row.
 */

const cryptoLogger = logger.child({ module: 'identity-crypto' });

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Distinct salts, so the two subkeys cannot be derived from one another. */
const ENCRYPTION_SALT = 'saarthi:identity:enc:v1';
const MAC_SALT = 'saarthi:identity:mac:v1';

/** Marks the format, so a future scheme can be told apart from this one. */
const ENVELOPE_PREFIX = 'v1';

function deriveKey(secret: string, salt: string): Buffer {
  return scryptSync(secret, salt, KEY_BYTES);
}

// Derived once at boot — scrypt is deliberately slow, and doing it per request
// would make it a denial-of-service surface rather than a protection.
const encryptionKey: Buffer | null = config.identity.encryptionKey
  ? deriveKey(config.identity.encryptionKey, ENCRYPTION_SALT)
  : null;

const macKey: Buffer = deriveKey(
  config.identity.encryptionKey ?? config.auth.cookieSecret,
  MAC_SALT,
);

if (!encryptionKey) {
  cryptoLogger.warn(
    'IDENTITY_ENCRYPTION_KEY is not set — verified Aadhaar/PAN/Voter/GST numbers will not be ' +
      'retained in full. Checks still work; a re-check will ask for the number again.',
  );
}

/** `true` when this environment can retain full identity numbers. */
export const canRetainIdentityNumbers = encryptionKey !== null;

/**
 * The lookup key for a number.
 *
 * Keyed by kind as well as by value so the same digits under two schemes can
 * never collide into one row, and so a hash lifted from one column cannot be
 * replayed against another.
 */
export function hashIdentityNumber(kind: string, normalizedNumber: string): string {
  return createHmac('sha256', macKey).update(`${kind}:${normalizedNumber}`).digest('hex');
}

/** Constant-time comparison of two hashes produced by `hashIdentityNumber`. */
export function identityHashEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * Encrypt a normalised identity number for storage.
 *
 * Returns `null` when no key is configured, which the caller stores as-is —
 * the column is nullable precisely so this case needs no special handling.
 */
export function encryptIdentityNumber(normalizedNumber: string): string | null {
  if (!encryptionKey) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizedNumber, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/**
 * Decrypt a stored number.
 *
 * Returns `null` rather than throwing for every recoverable failure — no key,
 * an envelope from a different scheme, or a key that has since been rotated.
 * A tampered ciphertext fails the GCM tag and also returns `null`, logged at
 * warn: the caller's correct response in all four cases is the same, which is
 * to ask for the number again.
 */
export function decryptIdentityNumber(envelope: string | null | undefined): string | null {
  if (!envelope || !encryptionKey) return null;

  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_PREFIX) return null;

  try {
    const iv = Buffer.from(parts[1]!, 'base64');
    const tag = Buffer.from(parts[2]!, 'base64');
    const ciphertext = Buffer.from(parts[3]!, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    cryptoLogger.warn(
      'A stored identity number could not be decrypted — the key may have been rotated.',
    );
    return null;
  }
}
