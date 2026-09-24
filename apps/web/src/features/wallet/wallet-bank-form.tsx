import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Lock } from 'lucide-react';
import {
  BankAccountStatus,
  connectWalletBankAccountSchema,
  type ConnectWalletBankAccountInput,
  type WalletBankAccountView,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
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
 * Connecting the bank account a wallet cashes out to.
 *
 * The bank validates the account with a ₹1 penny drop before it can be used,
 * and Saarthi keeps only its last four digits.
 */
export function WalletBankForm({
  onConnected,
  onCancel,
}: {
  onConnected: (account: WalletBankAccountView) => void;
  onCancel?: () => void;
}) {
  const form = useForm<ConnectWalletBankAccountInput>({
    resolver: zodResolver(connectWalletBankAccountSchema),
    defaultValues: { accountHolderName: '', accountNumber: '', ifsc: '' },
  });

  const connect = useMutation({
    mutationFn: (input: ConnectWalletBankAccountInput) =>
      api.put<WalletBankAccountView>('/wallet/bank-account', input),
    onSuccess: (account) => {
      form.reset();
      if (account.status === BankAccountStatus.VERIFIED) {
        toast.success('Bank account verified', {
          description: `Account ending ${account.accountLast4} · ${account.ifsc}`,
        });
      } else if (account.status === BankAccountStatus.FAILED) {
        toast.error('The bank could not validate this account', {
          description: account.failureReason ?? 'Check the account number and IFSC.',
        });
      } else {
        toast.info('Verification in progress', { description: 'The bank has not answered yet.' });
      }
      onConnected(account);
    },
    onError: (error) =>
      toast.error('Could not connect the account', { description: errorMessage(error) }),
  });

  return (
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
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            Verified with a ₹1 bank check. Saarthi keeps only the last four digits.
          </p>
          <div className="flex gap-2">
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" loading={connect.isPending}>
              <Landmark className="size-4" />
              Verify and connect
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
