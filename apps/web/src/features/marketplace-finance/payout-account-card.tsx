import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Lock, RefreshCw } from 'lucide-react';
import {
  BankAccountStatus,
  connectBankAccountSchema,
  formatDate,
  humanizeEnum,
  type ConnectBankAccountInput,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { SectionHeader } from '@/components/common/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import type { PayoutAccountView } from './types';

export const PAYOUT_ACCOUNT_KEY = ['finance', 'payout-account'] as const;

const STATUS_BADGE: Record<BankAccountStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  NOT_CONNECTED: 'muted',
  PENDING_VERIFICATION: 'warning',
  VERIFIED: 'success',
  FAILED: 'destructive',
  BLOCKED: 'destructive',
};

/**
 * The bank account marketplace payments are routed to.
 *
 * Verified by penny validation through Cashfree before anything is paid into
 * it; only its last four digits ever come back from the API.
 */
export function PayoutAccountCard({ account }: { account: PayoutAccountView }) {
  const queryClient = useQueryClient();
  const connected = account.status !== BankAccountStatus.NOT_CONNECTED;
  const [editing, setEditing] = React.useState(!connected);

  const form = useForm<ConnectBankAccountInput>({
    resolver: zodResolver(connectBankAccountSchema),
    defaultValues: { accountHolderName: '', accountNumber: '', ifsc: '', pan: '' },
  });

  const store = (next: PayoutAccountView) => queryClient.setQueryData(PAYOUT_ACCOUNT_KEY, next);

  const connect = useMutation({
    mutationFn: (input: ConnectBankAccountInput) => api.post<PayoutAccountView>('/finance/payout-account', input),
    onSuccess: (next) => {
      store(next);
      form.reset();
      if (next.status === BankAccountStatus.VERIFIED) {
        toast.success('Bank account verified', { description: `${next.maskedAccount} · ${next.ifsc}` });
        setEditing(false);
      } else if (next.status === BankAccountStatus.FAILED) {
        toast.error('The bank could not validate this account', {
          description: next.failureReason ?? 'Check the account number and IFSC.',
        });
      } else {
        toast.info('Verification in progress', { description: 'The bank has not answered yet.' });
        setEditing(false);
      }
    },
    onError: (error) => toast.error('Could not connect the account', { description: errorMessage(error) }),
  });

  const refresh = useMutation({
    mutationFn: () => api.post<PayoutAccountView>('/finance/payout-account/refresh'),
    onSuccess: store,
    onError: (error) => toast.error('Could not refresh', { description: errorMessage(error) }),
  });

  const awaitingActivation = account.status === BankAccountStatus.VERIFIED && !account.usable;

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionHeader
          title="Payout bank account"
          description="Customers pay through Saarthi's Cashfree checkout; your share settles here."
          actions={
            <Badge variant={awaitingActivation ? 'warning' : STATUS_BADGE[account.status]}>
              {awaitingActivation ? 'Awaiting activation' : humanizeEnum(account.status)}
            </Badge>
          }
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {connected ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <Fact label="Account" value={account.maskedAccount} mono />
            <Fact label="IFSC" value={account.ifsc} mono />
            <Fact label="Account holder" value={account.accountHolderName} />
            <Fact label="Name at bank" value={account.nameAtBank} />
            <Fact label="Bank" value={account.bankName} />
            <Fact label="Verified" value={account.verifiedAt ? formatDate(account.verifiedAt) : null} />
          </dl>
        ) : null}

        {account.status === BankAccountStatus.FAILED && account.failureReason ? (
          <Alert variant="destructive">
            <AlertTitle>Validation failed</AlertTitle>
            <AlertDescription>{account.failureReason}</AlertDescription>
          </Alert>
        ) : null}

        {awaitingActivation ? (
          <Alert>
            <AlertTitle>Registered with Cashfree</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                The account is verified. Cashfree activates new payout accounts shortly — until then
                you cannot win delivered bids or receive marketplace payments.
              </p>
              <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw className="mr-1.5 size-3.5" />
                {refresh.isPending ? 'Checking…' : 'Check again'}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {editing ? (
          <Form {...form}>
            <form
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              onSubmit={form.handleSubmit((input) => connect.mutate(input))}
              noValidate
            >
              <FormField
                control={form.control}
                name="accountHolderName"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel required>Account holder name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>Account number</FormLabel>
                    <FormControl>
                      <Input inputMode="numeric" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ifsc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>IFSC</FormLabel>
                    <FormControl>
                      <Input className="uppercase" autoComplete="off" placeholder="HDFC0001234" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="pan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>PAN</FormLabel>
                    <FormControl>
                      <Input className="uppercase" autoComplete="off" placeholder="ABCDE1234F" {...field} />
                    </FormControl>
                    <FormDescription>Of the account holder - Cashfree&apos;s KYC for payouts.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5 shrink-0" />
                  Saarthi keeps only the last four digits of the account number.
                </p>
                <div className="flex gap-2">
                  {connected ? (
                    <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={connect.isPending}>
                    <Landmark className="mr-1.5 size-4" />
                    {connect.isPending ? 'Verifying…' : 'Verify and connect'}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        ) : (
          <Button variant="outline" onClick={() => setEditing(true)}>
            Replace bank account
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono font-medium tabular-nums' : 'font-medium'}>{value ?? '—'}</dd>
    </div>
  );
}
