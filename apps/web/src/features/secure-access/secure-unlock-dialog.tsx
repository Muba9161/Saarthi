import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Fingerprint, KeyRound, Lock } from 'lucide-react';
import { SECURE_PIN_LENGTH, formatDate } from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { LoadingState } from '@/components/common/states';
import {
  SECURE_ACCESS_KEY,
  isSecureAccessRequired,
  BIOMETRIC_UNAVAILABLE_NOTE,
  isBiometricCancelled,
  useBiometricSupport,
  setSecurePin,
  unlockWithPasskey,
  unlockWithPin,
  useSecureAccessStatus,
} from './secure-access-api';

/**
 * Ask for the secure PIN (or the device's fingerprint / face) before something
 * sensitive — the full RC, or switching RC details on for QR scans.
 *
 * One dialog for three situations, so every sensitive action behaves the same:
 * entering the PIN, setting one up the first time, and resetting a forgotten
 * one with the account password. Setting or resetting unlocks straight away,
 * so nobody is asked for the PIN they have just typed twice.
 */

const PIN_PATTERN = new RegExp(`^\\d{${SECURE_PIN_LENGTH}}$`);

function PinField({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={SECURE_PIN_LENGTH}
        pattern="[0-9]*"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, '').slice(0, SECURE_PIN_LENGTH))
        }
        className="text-center font-mono text-xl tracking-[0.6em]"
      />
    </div>
  );
}

export function SecureUnlockDialog({
  open,
  onOpenChange,
  purpose,
  onUnlocked,
  initialMode = 'enter',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Finishes "Enter your PIN to …", e.g. "see the full RC". */
  purpose: string;
  onUnlocked: () => void;
  /** `set` opens on choosing a new PIN — the settings screen's "Change PIN". */
  initialMode?: 'enter' | 'set';
}) {
  const queryClient = useQueryClient();
  const status = useSecureAccessStatus(open);
  const [mode, setMode] = React.useState<'enter' | 'set'>(initialMode);
  const [pin, setPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pinSet = status.data?.pinSet ?? false;
  const settingUp = !pinSet || mode === 'set';
  const lockedUntil = status.data?.pinLockedUntil ?? null;
  const biometrics = useBiometricSupport();
  // Offered to anyone who has added a device; disabled, with the reason, on one that cannot do it.
  const hasPasskey = pinSet && (status.data?.passkeys.length ?? 0) > 0;

  React.useEffect(() => {
    if (open) return;
    setMode(initialMode);
    setPin('');
    setConfirmPin('');
    setPassword('');
    setError(null);
  }, [open, initialMode]);

  const finish = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: SECURE_ACCESS_KEY });
    // Before closing: closing without unlocking is how a waiting request is
    // abandoned, so the retry has to be claimed first.
    onUnlocked();
    onOpenChange(false);
  };

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await finish();
    } catch (actionError) {
      // Closing the device's own prompt is a change of mind, not an error.
      if (!isBiometricCancelled(actionError)) setError(errorMessage(actionError));
      void queryClient.invalidateQueries({ queryKey: SECURE_ACCESS_KEY });
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    // React bubbles events through portals, so without this a PIN typed into a
    // dialog opened from inside another form would submit that form too.
    event.stopPropagation();
    if (!PIN_PATTERN.test(pin)) {
      setError(`Enter ${SECURE_PIN_LENGTH} digits.`);
      return;
    }
    if (settingUp) {
      if (pin !== confirmPin) {
        setError('The two PINs do not match.');
        return;
      }
      void run(async () => {
        await setSecurePin(pin, password);
        await unlockWithPin(pin);
      });
      return;
    }
    void run(() => unlockWithPin(pin));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4 text-primary" aria-hidden />
            {settingUp
              ? pinSet
                ? 'Reset your secure PIN'
                : 'Set up a secure PIN'
              : 'Enter your secure PIN'}
          </DialogTitle>
          <DialogDescription>
            {settingUp
              ? `A ${SECURE_PIN_LENGTH}-digit PIN keeps full RC details and sensitive settings to you, even on a device someone else picks up. Confirm it with your account password.`
              : `Enter your PIN to ${purpose}. It stays open on this device for a few minutes.`}
          </DialogDescription>
        </DialogHeader>

        {status.isLoading ? (
          <LoadingState label="Checking…" className="min-h-24" />
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {lockedUntil && !settingUp ? (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                Too many wrong PINs. Try again after {formatDate(lockedUntil)}{' '}
                {new Date(lockedUntil).toLocaleTimeString()}, or reset it with your password.
              </p>
            ) : null}

            {settingUp ? (
              <div className="space-y-1.5">
                <Label htmlFor="secure-password">Account password</Label>
                <PasswordInput
                  id="secure-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </div>
            ) : null}

            <PinField
              id="secure-pin"
              label={settingUp ? 'New PIN' : 'PIN'}
              value={pin}
              onChange={setPin}
              autoFocus={!settingUp}
            />
            {settingUp ? (
              <PinField
                id="secure-pin-confirm"
                label="Confirm PIN"
                value={confirmPin}
                onChange={setConfirmPin}
              />
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button type="submit" loading={busy} disabled={settingUp && password.length === 0}>
                <KeyRound className="size-4" aria-hidden />
                {settingUp ? 'Save PIN and continue' : 'Unlock'}
              </Button>
              {hasPasskey && !settingUp ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || biometrics !== 'available'}
                    onClick={() => void run(unlockWithPasskey)}
                  >
                    <Fingerprint className="size-4" aria-hidden />
                    Use fingerprint or face
                  </Button>
                  {biometrics === 'unavailable' ? (
                    <p className="text-center text-xs text-muted-foreground">
                      {BIOMETRIC_UNAVAILABLE_NOTE}
                    </p>
                  ) : null}
                </>
              ) : null}
              {pinSet ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setMode(settingUp ? 'enter' : 'set');
                    setPin('');
                    setConfirmPin('');
                    setError(null);
                  }}
                >
                  {settingUp ? 'I remember my PIN' : 'Forgot your PIN?'}
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Run a sensitive request, asking for the PIN only if the server wants it and
 * then trying again — so screens call the API as normal and never need to know
 * whether this session is already unlocked.
 */
export function useSecureAction(purpose: string) {
  const [open, setOpen] = React.useState(false);
  /** The request waiting on the PIN: retried on unlock, abandoned if the dialog closes. */
  const pending = React.useRef<{ retry: () => void; abandon: () => void } | null>(null);

  const guard = React.useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action();
    } catch (error) {
      if (!isSecureAccessRequired(error)) throw error;
      return new Promise<T | undefined>((resolve, reject) => {
        pending.current = {
          retry: () => void action().then(resolve, reject),
          abandon: () => resolve(undefined),
        };
        setOpen(true);
      });
    }
  }, []);

  const onOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next && pending.current) {
      // Closed without unlocking: the caller gets `undefined`, not a promise
      // that never settles.
      const { abandon } = pending.current;
      pending.current = null;
      abandon();
    }
  }, []);

  const dialog = (
    <SecureUnlockDialog
      open={open}
      onOpenChange={onOpenChange}
      purpose={purpose}
      onUnlocked={() => {
        const request = pending.current;
        pending.current = null;
        request?.retry();
      }}
    />
  );

  return { guard, dialog, openUnlock: () => setOpen(true) };
}
