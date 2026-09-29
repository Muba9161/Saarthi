import { z } from 'zod';

/**
 * Contracts for secure access: the 4-digit PIN and device passkeys that unlock
 * sensitive details (the unmasked RC) and sensitive settings (whether a QR scan
 * shows the RC), for a few minutes on the session that entered them.
 */

export const SECURE_PIN_LENGTH = 4;

/** How long one PIN or passkey entry keeps sensitive details open. */
export const SECURE_UNLOCK_SECONDS = 5 * 60;

export const securePinSchema = z
  .string()
  .regex(new RegExp(`^\\d{${SECURE_PIN_LENGTH}}$`), `Enter ${SECURE_PIN_LENGTH} digits.`);

/** Setting or changing the PIN takes the account password — a session alone is not enough. */
export const setSecurePinSchema = z.object({
  pin: securePinSchema,
  password: z.string().min(1, 'Enter your account password.').max(200),
});
export type SetSecurePinInput = z.infer<typeof setSecurePinSchema>;

export const unlockWithPinSchema = z.object({ pin: securePinSchema });
export type UnlockWithPinInput = z.infer<typeof unlockWithPinSchema>;

/**
 * A browser's WebAuthn response. Its shape is the WebAuthn specification's and
 * is checked cryptographically by the verifier, so only the envelope is
 * validated here.
 */
const webAuthnResponseSchema = z
  .object({ id: z.string().min(1).max(1024), type: z.literal('public-key') })
  .passthrough();

export const registerPasskeySchema = z.object({
  response: webAuthnResponseSchema,
  label: z.string().trim().min(1).max(60).optional(),
});
export type RegisterPasskeyInput = z.infer<typeof registerPasskeySchema>;

export const unlockWithPasskeySchema = z.object({ response: webAuthnResponseSchema });
export type UnlockWithPasskeyInput = z.infer<typeof unlockWithPasskeySchema>;

/** Signing in with a fingerprint or face: the challenge it answers, and the signed answer. */
export const passkeySignInSchema = z.object({
  challengeId: z.string().uuid(),
  response: webAuthnResponseSchema,
});
export type PasskeySignInInput = z.infer<typeof passkeySignInSchema>;

export const qrRcVisibilitySchema = z.object({ enabled: z.boolean() });
export type QrRcVisibilityInput = z.infer<typeof qrRcVisibilitySchema>;

export interface PasskeySummary {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SecureAccessStatus {
  pinSet: boolean;
  /** Set while too many wrong PINs have locked it. */
  pinLockedUntil: string | null;
  /** Set while this session has sensitive details open. */
  unlockedUntil: string | null;
  passkeys: PasskeySummary[];
}
