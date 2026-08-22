import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { Stagger, StaggerItem, motion } from '@/components/motion';

// Deliberately permissive: the server decides whether credentials are valid,
// and the form should not pre-judge a legacy password.
const schema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

/** Four accounts, one per side of the product. Password is shared. */
const DEMO_ACCOUNTS = [
  { label: 'Fleet owner', email: 'owner@saarthi.local', hint: 'Fleet, trips, live map, simulator' },
  { label: 'Driver', email: 'driver@saarthi.local', hint: 'Driver app, SOS, safety score' },
  { label: 'Customer', email: 'customer@saarthi.local', hint: 'Marketplace, orders, tracking' },
  { label: 'Platform admin', email: 'admin@saarthi.local', hint: 'Verification queue, audit log' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
    form.setValue('email', email);
    form.setValue('password', 'Saarthi@2026');
    toast.info('Demo credentials filled in', { description: email });
  };

  return (
    <Stagger className="space-y-6">
      <StaggerItem className="space-y-1.5">
        <p className="section-label">Welcome back</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Saarthi</h1>
        <p className="text-sm text-muted-foreground">
          Enter your details to reach your fleet.
        </p>
      </StaggerItem>

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <motion.form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Email address</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    autoFocus
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel required>Password</FormLabel>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input {...field} type="password" autoComplete="current-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            variant="gradient"
            className="w-full"
            loading={form.formState.isSubmitting}
          >
            Sign in
          </Button>
        </motion.form>
      </Form>

      <StaggerItem>
        <p className="text-center text-sm text-muted-foreground">
          New to Saarthi?{' '}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </StaggerItem>

      {import.meta.env.VITE_DEMO_MODE === 'true' ? (
        <StaggerItem className="glass rounded-xl p-4">
          <p className="section-label">Try it instantly</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Four demo accounts, password{' '}
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-2xs">Saarthi@2026</span>
          </p>
          <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => useDemoAccount(account.email)}
                className="surface-interactive rounded-lg border border-border/70 px-3 py-2 text-left"
              >
                <span className="block text-sm font-medium">{account.label}</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {account.hint}
                </span>
              </button>
            ))}
          </div>
        </StaggerItem>
      ) : null}
    </Stagger>
  );
}

export default LoginPage;
