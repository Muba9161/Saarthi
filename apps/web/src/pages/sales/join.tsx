import * as React from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, BadgeCheck, MailCheck } from 'lucide-react';
import {
  salesmanSignupSchema,
  type SalesmanSignupInput,
  type SalesmanSignupStarted,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { AuthCard, AuthHeading, FieldIcon } from '@/features/auth/auth-card';
import { AnimatePresence, motion } from '@/components/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

/**
 * A salesperson joining Saarthi with their GODID — the link operations shares.
 *
 * Asks for the GODID and nothing else. Saarthi checks it with GODWeb and emails
 * a set-password link to the address GODWeb holds, so the name, email and
 * phone are never typed in and cannot be made up. The page only ever shows
 * that address masked.
 */
export function SalesJoinPage() {
  const [sent, setSent] = React.useState<SalesmanSignupStarted | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const form = useForm<SalesmanSignupInput>({
    resolver: zodResolver(salesmanSignupSchema),
    defaultValues: { godId: '' },
  });

  const onSubmit = async (values: SalesmanSignupInput): Promise<void> => {
    setError(null);
    try {
      setSent(await api.post<SalesmanSignupStarted>('/salesman-signup', values));
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
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              We sent a link to <strong>{sent.maskedEmail}</strong>, the email GODWeb has for your
              GODID. Open it to choose your password. It expires in {sent.expiresInHours} hours.
            </AlertDescription>
          </Alert>
          <p className="text-sm text-muted-foreground">
            Not in your inbox? Check spam, or come back and send it again.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" size="lg" className="sm:flex-1" onClick={() => setSent(null)}>
              Send again
            </Button>
            <Button variant="outline" size="lg" className="sm:flex-1" asChild>
              <Link to="/login">
                <ArrowLeft className="size-4" />
                Back to sign in
              </Link>
            </Button>
          </div>
        </motion.div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <AuthHeading
        eyebrow="Saarthi Sales"
        title="Join as a salesperson"
        description="Enter your GODID. We check it with GODWeb and email you a link to set your password."
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
            name="godId"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>GODID</FormLabel>
                <FieldIcon icon={BadgeCheck}>
                  <FormControl>
                    <Input
                      {...field}
                      autoFocus
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="GOD-7F42K"
                      className="h-11 pl-10 uppercase"
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
            Continue
          </Button>
        </form>
      </Form>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already joined? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </AuthCard>
  );
}

export default SalesJoinPage;
