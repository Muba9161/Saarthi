import bcrypt from 'bcryptjs';
import { config } from '../config/env';

/**
 * Password hashing behind an interface.
 *
 * bcrypt is used locally because it needs no native toolchain; swapping in
 * argon2id in production is a one-line change here and requires no migration
 * beyond re-hashing on next successful login (see `needsRehash`).
 */
export interface PasswordHasher {
  readonly algorithm: string;
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

class BcryptPasswordHasher implements PasswordHasher {
  readonly algorithm = 'bcrypt';

  constructor(private readonly rounds: number) {}

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
    if (!match?.[1]) return true;
    return Number.parseInt(match[1], 10) < this.rounds;
  }
}

export const passwordHasher: PasswordHasher = new BcryptPasswordHasher(config.auth.bcryptRounds);

/**
 * Constant-ish work even when the account does not exist, so an attacker
 * cannot distinguish "unknown email" from "wrong password" by timing.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO3nJ1p3Wgh0N3nqYVQ0X1yVvOKQOdVjq';

export async function verifyWithTimingGuard(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    await passwordHasher.verify(plain, DUMMY_HASH);
    return false;
  }
  return passwordHasher.verify(plain, hash);
}
