import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ErrorState, LoadingState } from '@/components/common/states';
import {
  SECURE_ACCESS_KEY,
  BIOMETRIC_UNAVAILABLE_NOTE,
  forgetDevicePasskey,
  isBiometricCancelled,
  useBiometricSupport,
  registerPasskey,
  removePasskey,
  useSecureAccessStatus,
} from './secure-access-api';
import { SecureUnlockDialog, useSecureAction } from './secure-unlock-dialog';

/** A name for this device's passkey, so the list says which is which. */
function deviceLabel(): string {
  const agent = navigator.userAgent;
  if (/android/i.test(agent)) return 'Android phone';
  if (/iphone|ipad/i.test(agent)) return 'iPhone or iPad';
  if (/mac os/i.test(agent)) return 'Mac';
  if (/windows/i.test(agent)) return 'Windows computer';
  return 'This device';
}

/**
 * The secure PIN and fingerprint / face unlock, on the profile's Security step.
 *
 * Kept beside the password because it is the same kind of thing — a secret
 * that proves it is really you — and because changing it takes that password.
 */
export function SecureAccessSettings() {
  const queryClient = useQueryClient();
  const status = useSecureAccessStatus();
  const biometrics = useBiometricSupport();
  const [changingPin, setChangingPin] = React.useState(false);
  const { guard, dialog } = useSecureAction('add a fingerprint or face unlock');

  const refresh = () => queryClient.invalidateQueries({ queryKey: SECURE_ACCESS_KEY });

  const addDevice = useMutation({
    mutationFn: () => guard(() => registerPasskey(deviceLabel())),
    onSuccess: (result) => {
      if (!result) return;
      toast.success('Fingerprint or face unlock added', {
        description: 'We have emailed you to confirm it.',
      });
      void refresh();
    },
    onError: (error) => {
      if (isBiometricCancelled(error)) return;
      toast.error('Could not add this device', { description: errorMessage(error) });
    },
  });

  const removeDevice = useMutation({
    mutationFn: (passkeyId: string) => removePasskey(passkeyId),
    onSuccess: () => {
      // The last one gone: no device of this account can sign in by fingerprint.
      if ((status.data?.passkeys.length ?? 0) <= 1) forgetDevicePasskey();
      toast.success('Device removed');
      void refresh();
    },
    onError: (error) => toast.error('Could not remove it', { description: errorMessage(error) }),
  });

  if (status.isLoading)
    return <LoadingState label="Loading your secure PIN…" className="min-h-24" />;
  if (status.isError || !status.data) {
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  }

  const { pinSet, passkeys } = status.data;

  return (
    <section id="secure-pin" className="space-y-4" aria-labelledby="secure-pin-heading">
      <div className="space-y-1">
        <h3 id="secure-pin-heading" className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-primary" aria-hidden />
          Secure PIN
        </h3>
        <p className="text-xs text-muted-foreground">
          A 4-digit PIN that unlocks full RC details and sensitive settings, like showing RC details
          on QR scans. Setting or changing it takes your account password.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
        <p className="text-sm">{pinSet ? 'Your PIN is set.' : 'You have not set a PIN yet.'}</p>
        <Button variant="outline" size="sm" onClick={() => setChangingPin(true)}>
          {pinSet ? 'Change PIN' : 'Set up PIN'}
        </Button>
      </div>

      <Separator />
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Fingerprint className="size-4 text-primary" aria-hidden />
          Fingerprint or face unlock
        </h3>
        <p className="text-xs text-muted-foreground">
          Use this device’s fingerprint, face or Windows Hello instead of typing your PIN. You will
          be asked for your PIN once to add it.
        </p>
      </div>

      {passkeys.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{passkey.label ?? 'Device'}</p>
                <p className="text-2xs text-muted-foreground">
                  Added {formatDate(passkey.createdAt)}
                  {passkey.lastUsedAt ? ` · last used ${formatDate(passkey.lastUsedAt)}` : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${passkey.label ?? 'device'}`}
                loading={removeDevice.isPending && removeDevice.variables === passkey.id}
                onClick={() => removeDevice.mutate(passkey.id)}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        disabled={!pinSet || biometrics !== 'available'}
        loading={addDevice.isPending}
        onClick={() => addDevice.mutate()}
        title={pinSet ? undefined : 'Set up a PIN first'}
      >
        <Fingerprint className="size-4" aria-hidden />
        Add this device
      </Button>
      {biometrics === 'unavailable' ? (
        <p className="text-xs text-muted-foreground">{BIOMETRIC_UNAVAILABLE_NOTE}</p>
      ) : null}

      <SecureUnlockDialog
        open={changingPin}
        onOpenChange={setChangingPin}
        purpose="change your PIN"
        initialMode="set"
        onUnlocked={() => toast.success(pinSet ? 'PIN changed' : 'PIN set up')}
      />
      {dialog}
    </section>
  );
}
