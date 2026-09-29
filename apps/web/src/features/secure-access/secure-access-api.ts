import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  WebAuthnError,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { ErrorCode, type SecureAccessStatus, type SessionPayload } from '@saarthi/shared';
import { ApiError, api } from '@/lib/api-client';

/**
 * Client side of secure access — the 4-digit PIN and device passkeys that open
 * sensitive details (the full RC) for a few minutes on this session.
 *
 * The unlock itself lives on the server; nothing here is trusted to decide it.
 * These helpers only ask for it and read back where it stands.
 */

export const SECURE_ACCESS_KEY = ['secure-access'] as const;

export function useSecureAccessStatus(enabled = true) {
  return useQuery({
    queryKey: SECURE_ACCESS_KEY,
    queryFn: () => api.get<SecureAccessStatus>('/security/access'),
    enabled,
    staleTime: 15_000,
  });
}

/** The API refused because this session has not entered the PIN recently. */
export function isSecureAccessRequired(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === ErrorCode.SECURE_ACCESS_REQUIRED;
}

export type BiometricSupport = 'checking' | 'available' | 'unavailable';

/** Shown, softly, wherever a biometric button is disabled because the device cannot do it. */
export const BIOMETRIC_UNAVAILABLE_NOTE =
  'This device has no fingerprint or face sensor your browser can use, so use your PIN or password here instead.';

/**
 * Can this device actually do a fingerprint or face check?
 *
 * Asks for a built-in, user-verifying authenticator — Touch ID, Face ID,
 * Windows Hello, an Android fingerprint — not merely a browser that speaks
 * WebAuthn, which would offer a button that then fails.
 */
export function useBiometricSupport(): BiometricSupport {
  const [support, setSupport] = React.useState<BiometricSupport>('checking');

  React.useEffect(() => {
    let live = true;
    void (async () => {
      const available =
        browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable().catch(() => false));
      if (live) setSupport(available ? 'available' : 'unavailable');
    })();
    return () => {
      live = false;
    };
  }, []);

  return support;
}

/** The person closed or declined the device prompt — not an error worth alarming them over. */
export function isBiometricCancelled(error: unknown): boolean {
  return (
    (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED') ||
    (error instanceof Error && error.name === 'NotAllowedError')
  );
}

export function unlockWithPin(pin: string) {
  return api.post<{ unlockedUntil: string }>('/security/unlock/pin', { pin });
}

export async function unlockWithPasskey(): Promise<void> {
  const optionsJSON = await api.post<PublicKeyCredentialRequestOptionsJSON>(
    '/security/unlock/passkey/options',
  );
  const response = await startAuthentication({ optionsJSON });
  await api.post('/security/unlock/passkey', { response });
}

/**
 * Whether a fingerprint or face was added on this device — what decides if the
 * login page offers biometric sign-in at all.
 *
 * Kept in the browser because the login page has nobody signed in to ask the
 * server about. It is only a hint for what to show: the sign-in itself is
 * still proven by the device and checked by the server every time. Storage
 * can be unavailable (private windows, blocked site data), which simply means
 * the button is not offered.
 */
const DEVICE_PASSKEY_KEY = 'saarthi.secure.device-passkey';

export function hasDevicePasskey(): boolean {
  try {
    return window.localStorage.getItem(DEVICE_PASSKEY_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberDevicePasskey(): void {
  try {
    window.localStorage.setItem(DEVICE_PASSKEY_KEY, 'true');
  } catch {
    // Without storage the login page just does not offer the button.
  }
}

export function forgetDevicePasskey(): void {
  try {
    window.localStorage.removeItem(DEVICE_PASSKEY_KEY);
  } catch {
    // Nothing was stored, so there is nothing to forget.
  }
}

/** Sign in with this device's fingerprint or face. The caller applies the session. */
export async function passkeySignIn(): Promise<{
  accessToken: string;
  expiresIn: number;
  session: SessionPayload;
}> {
  const { challengeId, options } = await api.post<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>('/auth/passkey/options');
  const response = await startAuthentication({ optionsJSON: options });
  try {
    const result = await api.post<{
      accessToken: string;
      expiresIn: number;
      session: SessionPayload;
    }>('/auth/passkey/login', { challengeId, response });
    rememberDevicePasskey();
    return result;
  } catch (error) {
    // The server no longer knows this device — it was removed elsewhere — so
    // stop offering a button that cannot work.
    if (error instanceof ApiError && error.code === ErrorCode.INVALID_CREDENTIALS) {
      forgetDevicePasskey();
    }
    throw error;
  }
}

export function setSecurePin(pin: string, password: string) {
  return api.put<SecureAccessStatus>('/security/pin', { pin, password });
}

/** Register this device's biometric. The server insists the PIN was entered first. */
export async function registerPasskey(label?: string): Promise<SecureAccessStatus> {
  const optionsJSON = await api.post<PublicKeyCredentialCreationOptionsJSON>(
    '/security/passkeys/options',
  );
  const response = await startRegistration({ optionsJSON });
  const status = await api.post<SecureAccessStatus>('/security/passkeys', { response, label });
  rememberDevicePasskey();
  return status;
}

export function removePasskey(passkeyId: string) {
  return api.delete(`/security/passkeys/${passkeyId}`);
}
