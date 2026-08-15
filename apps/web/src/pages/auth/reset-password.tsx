import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { passwordSchema } from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api, errorMessage } from '@/lib/api-client';

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
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTitle>This link is not valid</AlertTitle>
          <AlertDescription>
            The reset link is missing its token. Request a new one and try again.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="w-full" asChild>
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  const onSubmit = async (values: z.infer<typeof schema>): Promise<void> => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password });
      toast.success('Password updated', { description: 'Sign in with your new password.' });
      navigate('/login', { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          Setting a new password signs you out of every other device.
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>New password</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" autoFocus />
                </FormControl>
                <FormDescription>
                  At least 10 characters, with upper case, lower case and a number.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Confirm new password</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      </Form>
    </div>
  );
}

export default ResetPasswordPage;
