import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { passwordSchema } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
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
import { PasswordStrength } from '@/components/common/password-strength';
import { api, errorMessage } from '@/lib/api-client';
import { AnimatePresence, motion } from '@/components/motion';
import { useT } from '@/features/i18n';

const schema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

export function ResetPasswordPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  if (!token) {
    return (
      <AuthCard>
        <div className="space-y-5">
          <Alert variant="destructive">
            <AlertTitle>{t('This link is not valid')}</AlertTitle>
            <AlertDescription>
              {t('The reset link is missing its token. Request a new one and try again.')}
            </AlertDescription>
          </Alert>
          <Button variant="outline" size="lg" className="w-full" asChild>
            <Link to="/forgot-password">{t('Request a new link')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  const onSubmit = async (values: z.infer<typeof schema>): Promise<void> => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password });
      toast.success(t('Password updated'), { description: t('Sign in with your new password.') });
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <AuthCard>
      <AuthHeading
        eyebrow={t('Security')}
        title={t('Choose a new password')}
        description={t('Setting a new password signs you out of every other device.')}
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('New password')}</FormLabel>
                <FieldIcon icon={KeyRound}>
                  <FormControl>
                    <PasswordInput
                      {...field}
                      autoComplete="new-password"
                      autoFocus
                      className="h-11 pl-10"
                    />
                  </FormControl>
                </FieldIcon>
                <PasswordStrength value={field.value ?? ''} className="pt-1" />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Confirm new password')}</FormLabel>
                <FieldIcon icon={KeyRound}>
                  <FormControl>
                    <PasswordInput {...field} autoComplete="new-password" className="h-11 pl-10" />
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
            {t('Update password')}
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}

export default ResetPasswordPage;
