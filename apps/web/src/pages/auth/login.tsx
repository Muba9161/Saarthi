import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowRight,
  KeyRound,
  Mail,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AuthCard, AuthDivider, AuthHeading, FieldIcon } from '@/features/auth/auth-card';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { AnimatePresence, Stagger, StaggerItem, motion } from '@/components/motion';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

// Deliberately permissive: the server decides whether credentials are valid,
// and the form should not pre-judge a legacy password.
const schema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

/** Four accounts, one per side of the product. Password is shared. */
const DEMO_ACCOUNTS = [
  {
    label: 'Fleet owner',
    email: 'owner@saarthi.local',
    hint: 'Fleet, trips, live map, simulator',
    icon: Truck,
  },
  {
    label: 'Driver',
    email: 'driver@saarthi.local',
    hint: 'Driver app, SOS, safety score',
    icon: UserRound,
  },
  {
    label: 'Customer',
    email: 'customer@saarthi.local',
    hint: 'Marketplace, orders, tracking',
    icon: ShoppingCart,
  },
  {
    label: 'Platform admin',
    email: 'admin@saarthi.local',
    hint: 'Verification queue, audit log',
    icon: ShieldCheck,
  },
] as const;

const DEMO_PASSWORD = 'Saarthi@2026';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues): Promise<void> => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      navigate('/', { replace: true });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Unable to sign in right now. Please try again.';
      setFormError(message);
    }
  };

  const useDemoAccount = (email: string): void => {
    form.setValue('email', email, { shouldValidate: true });
    form.setValue('password', DEMO_PASSWORD, { shouldValidate: true });
    setFormError(null);
    toast.info(t('Demo credentials filled in'), { description: email });
  };

  const submitting = form.formState.isSubmitting;

  return (
    <Stagger className="space-y-5">
      <StaggerItem>
        <AuthCard>
          <AuthHeading
            eyebrow={t('Welcome back')}
            title={t('Sign in to Saarthi')}
            description={t('Enter your details to reach your fleet.')}
          />

          {/* Animated in and out so a failed attempt is noticed without the
              rest of the card jumping. */}
          <AnimatePresence initial={false}>
            {formError ? (
              <motion.div
                key="form-error"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
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

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-3">
                      <FormLabel required>{t('Password')}</FormLabel>
                      <Link
                        to="/forgot-password"
                        className="rounded text-xs font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                      >
                        {t('Forgot password?')}
                      </Link>
                    </div>
                    <FieldIcon icon={KeyRound}>
                      <FormControl>
                        <PasswordInput
                          {...field}
                          autoComplete="current-password"
                          placeholder="••••••••••"
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
                className="group w-full"
                loading={submitting}
              >
                {t('Sign in')}
                {submitting ? null : (
                  <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
              </Button>
            </form>
          </Form>

          <div className="mt-6 space-y-4">
            <AuthDivider>{t('New to Saarthi?')}</AuthDivider>
            <Button variant="outline" size="lg" className="w-full" asChild>
              <Link to="/register">{t('Create an account')}</Link>
            </Button>
          </div>
        </AuthCard>
      </StaggerItem>

      {import.meta.env.VITE_DEMO_MODE === 'true' ? (
        <StaggerItem>
          <section className="glass rounded-2xl p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="section-label inline-flex items-center gap-1.5">
                <Sparkles className="size-3 text-accent" aria-hidden />
                {t('Try it instantly')}
              </p>
              <p className="text-2xs text-muted-foreground">
                {t('Four demo accounts, password')}{' '}
                <span className="rounded bg-muted px-1 py-0.5 font-mono text-2xs text-foreground">
                  {DEMO_PASSWORD}
                </span>
              </p>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => useDemoAccount(account.email)}
                  disabled={submitting}
                  className={cn(
                    'group flex items-center gap-2.5 rounded-xl border border-border/70 bg-card/50 p-2.5 text-left',
                    'transition-all duration-200 ease-smooth',
                    'hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lifted',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'active:translate-y-0 disabled:pointer-events-none disabled:opacity-60',
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary/15">
                    <account.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t(account.label)}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {t(account.hint)}
                    </span>
                  </span>
                  <ArrowRight
                    className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </section>
        </StaggerItem>
      ) : null}
    </Stagger>
  );
}

export default LoginPage;
