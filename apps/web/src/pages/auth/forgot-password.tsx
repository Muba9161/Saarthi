import * as React from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AuthCard, AuthHeading, FieldIcon } from '@/features/auth/auth-card';
import { api, errorMessage } from '@/lib/api-client';
import { AnimatePresence, motion } from '@/components/motion';
import { useT } from '@/features/i18n';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
});

export function ForgotPasswordPage() {
  const t = useT();
  const [sent, setSent] = React.useState(false);
  const [devToken, setDevToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: z.infer<typeof schema>): Promise<void> => {
    setError(null);
    try {
      const result = await api.post<{ message: string; devToken?: string }>(
        '/auth/forgot-password',
        values,
      );
      setSent(true);
      // Local development has no email provider, so the API returns the link.
      setDevToken(result.devToken ?? null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (sent) {
    return (
      <AuthCard>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-5"
        >
          <Alert variant="success">
            <MailCheck className="size-4" />
            <AlertTitle>{t('Check your inbox')}</AlertTitle>
            <AlertDescription>
              {t(
                'If an account exists for that address, a password reset link has been generated.',
              )}
            </AlertDescription>
          </Alert>

          {devToken ? (
            <Alert>
              <AlertTitle>{t('Development shortcut')}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{t('No email provider is configured locally, so use this link directly:')}</p>
                <Link
                  to={`/reset-password?token=${devToken}`}
                  className="block break-all font-mono text-xs text-primary hover:underline"
                >
                  /reset-password?token={devToken}
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}

          <Button variant="outline" size="lg" className="w-full" asChild>
            <Link to="/login">
              <ArrowLeft className="size-4" />
              {t('Back to sign in')}
            </Link>
          </Button>
        </motion.div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading
        eyebrow={t('Password')}
        title={t('Reset your password')}
        description={t('Enter your email address and we will send you a reset link.')}
      />

      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            key="form-error"
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Email address')}</FormLabel>
                <FieldIcon icon={Mail}>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      autoFocus
                      className="h-11 pl-10"
                    />
                  </FormControl>
                </FieldIcon>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            variant="gradient"
            size="lg"
            className="w-full"
            loading={form.formState.isSubmitting}
          >
            {t('Send reset link')}
          </Button>
        </form>
      </Form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 rounded font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
        >
          <ArrowLeft className="size-3.5" />
          {t('Back to sign in')}
        </Link>
      </p>
    </AuthCard>
  );
}

export default ForgotPasswordPage;
