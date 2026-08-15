import * as React from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api, errorMessage } from '@/lib/api-client';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address.').email('Enter a valid email address.'),
});

export function ForgotPasswordPage() {
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
      <div className="space-y-6">
        <Alert variant="success">
          <MailCheck className="size-4" />
          <AlertTitle>Check your inbox</AlertTitle>
          <AlertDescription>
            If an account exists for that address, a password reset link has been generated.
          </AlertDescription>
        </Alert>

        {devToken ? (
          <Alert>
            <AlertTitle>Development shortcut</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>No email provider is configured locally, so use this link directly:</p>
              <Link
                to={`/reset-password?token=${devToken}`}
                className="block break-all font-mono text-xs text-primary hover:underline"
              >
                /reset-password?token={devToken}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}

        <Button variant="outline" className="w-full" asChild>
          <Link to="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email address and we will send you a reset link.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Email address</FormLabel>
                <FormControl>
                  <Input {...field} type="email" autoComplete="email" autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      </Form>

      <p className="text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default ForgotPasswordPage;
