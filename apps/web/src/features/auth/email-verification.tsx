import * as React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { MailCheck, RotateCw } from 'lucide-react';
import {
  EMAIL_VERIFICATION_CODE_LENGTH,
  type RegisterInput,
  type RegistrationEmailCodeResult,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useT } from '@/features/i18n';
import { ApiError, api, errorMessage } from '@/lib/api-client';

/**
 * Registration email verification — the last step of every registration.
 *
 * The API opens an account only for an address its owner has proved they can
 * read, so the step before this one emails a code and this one asks for it
 * back. Shared by the registration wizard and the guided tutorial, which fill
 * the same form: a code sent from one is still good in the other.
 */

export const VERIFY_EMAIL_STEP_ID = 'verify-email';

/** Resend a code rather than trust one this close to expiring. */
const EXPIRY_MARGIN_MS = 30_000;

function normaliseEmail(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export interface EmailCodeController {
  /** The address the live code went to, or null before one is sent. */
  sentTo: string | null;
  /** Handed back only by a development API with no mailbox configured. */
  devCode: string | null;
  sending: boolean;
  /** Seconds until another code may be requested. */
  resendIn: number;
  /** Email a fresh code to the form's address. Resolves false on failure. */
  send: () => Promise<boolean>;
  /** Send only if the form's address has no live code yet. */
  ensureSent: () => Promise<boolean>;
}

export function useRegistrationEmailCode(form: UseFormReturn<RegisterInput>): EmailCodeController {
  const t = useT();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [devCode, setDevCode] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const [expiresAt, setExpiresAt] = React.useState(0);
  const [resendAt, setResendAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  // Ticks only while a cooldown is running, so an idle form re-renders nothing.
  React.useEffect(() => {
    if (resendAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const send = React.useCallback(async (): Promise<boolean> => {
    const { email, firstName } = form.getValues();
    setSending(true);
    try {
      const result = await api.post<RegistrationEmailCodeResult>('/auth/register/email-code', {
        email,
        ...(firstName ? { firstName } : {}),
      });
      const issuedAt = Date.now();
      setSentTo(result.sentTo);
      setDevCode(result.devCode ?? null);
      setExpiresAt(issuedAt + result.expiresIn * 1000);
      setResendAt(issuedAt + result.resendIn * 1000);
      setNow(issuedAt);
      form.setValue('emailCode', '', { shouldValidate: false });
      form.clearErrors('emailCode');
      toast.success(t('We emailed a verification code to {email}.', { email: result.sentTo }));
      return true;
    } catch (error) {
      // An address that already has an account belongs to the details step.
      const emailProblem = error instanceof ApiError ? error.fieldErrors.email?.[0] : undefined;
      if (emailProblem) form.setError('email', { message: emailProblem });
      toast.error(errorMessage(error, t('The code could not be sent. Please try again.')));
      return false;
    } finally {
      setSending(false);
    }
  }, [form, t]);

  const ensureSent = React.useCallback(async (): Promise<boolean> => {
    const live =
      sentTo !== null &&
      sentTo === normaliseEmail(form.getValues('email')) &&
      expiresAt - Date.now() > EXPIRY_MARGIN_MS;
    return live ? true : send();
  }, [expiresAt, form, send, sentTo]);

  return {
    sentTo,
    devCode,
    sending,
    resendIn: Math.max(0, Math.ceil((resendAt - now) / 1000)),
    send,
    ensureSent,
  };
}

/** Under every registration email field: says up front that the address is checked. */
export function EmailVerificationHint() {
  const t = useT();
  return (
    <FormDescription className="flex items-start gap-1.5">
      <MailCheck className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
      {t(
        'We will email a 6-digit code to this address at the last step, to confirm it is yours. Use an inbox you can open now.',
      )}
    </FormDescription>
  );
}

/** The code box, with resend. Rendered as the final step of both flows. */
export function EmailCodeStep({
  form,
  controller,
}: {
  form: UseFormReturn<RegisterInput>;
  controller: EmailCodeController;
}) {
  const t = useT();
  const email = form.watch('email');
  const { sentTo, devCode, sending, resendIn, send } = controller;
  // The address may have been changed on an earlier step since the code went.
  const current = sentTo !== null && sentTo === normaliseEmail(email);

  return (
    <div className="space-y-4">
      <div className="glass-inset flex items-start gap-3 p-3.5" aria-live="polite">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <MailCheck className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">
            {current ? t('Check your inbox') : t('Confirm your email address')}
          </p>
          <p className="break-words text-xs leading-relaxed text-muted-foreground">
            {current
              ? t('We sent a 6-digit code to {email}. Enter it below to finish creating your account.', {
                  email: sentTo,
                })
              : t('We will email a 6-digit code to {email}.', { email: normaliseEmail(email) })}
          </p>
        </div>
      </div>

      {current ? (
        <FormField
          control={form.control}
          name="emailCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t('Verification code')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ''}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value.replace(/\D/g, '').slice(0, EMAIL_VERIFICATION_CODE_LENGTH),
                    )
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={EMAIL_VERIFICATION_CODE_LENGTH}
                  placeholder="000000"
                  className="h-12 text-center font-mono text-xl tracking-[0.5em] placeholder:tracking-[0.5em]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => void send()} loading={sending}>
          <MailCheck className="size-4" />
          {t('Send code')}
        </Button>
      )}

      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-xs text-muted-foreground">
            {t('Not arrived? Check your spam folder. Wrong address? Go back and change it.')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void send()}
            disabled={sending || resendIn > 0}
          >
            <RotateCw className="size-3.5" aria-hidden />
            {resendIn > 0
              ? t('Resend in {seconds}s', { seconds: resendIn })
              : t('Resend code')}
          </Button>
        </div>
      ) : null}

      {current && devCode ? (
        // Developer-facing only, so deliberately untranslated.
        <p className="text-2xs text-muted-foreground">
          Development only - email is not configured, so your code is {devCode}.
        </p>
      ) : null}
    </div>
  );
}
