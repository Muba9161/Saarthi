import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CreditCard, LogOut, ShieldAlert } from 'lucide-react';
import { Permission, formatCurrency } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useCheckout, useCheckoutReturn } from '@/features/payments/use-checkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/common/states';
import type { BillingStatus } from './billing-card';
import { useBillingActions } from './use-billing-actions';

function inrDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Shown in place of every screen while the account is archived for
 * non-payment. The API refuses everything but renewal, so this is the one
 * thing the app offers: pay, and everything comes back as it was.
 */
export function ArchivedAccountScreen({ dataPurgeAt }: { dataPurgeAt: string | null }) {
  const { can, logout, refreshSession, session } = useAuth();
  const queryClient = useQueryClient();
  const canRenew = can(Permission.SUBSCRIPTION_MANAGE);

  const billing = useQuery({
    queryKey: ['subscription', 'billing'],
    queryFn: () => api.get<BillingStatus | null>('/subscriptions/billing'),
    enabled: canRenew,
  });

  // A settled renewal unlocks the account; the session says so on refresh.
  const refresh = React.useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    void refreshSession();
  }, [queryClient, refreshSession]);

  const checkout = useCheckout(refresh);
  const { payNow } = useBillingActions({ onCheckout: checkout.run, onChanged: refresh });
  useCheckoutReturn({ onPayment: refresh });

  const daysLeft = dataPurgeAt
    ? Math.max(0, Math.ceil((new Date(dataPurgeAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center py-10">
      <Card className="border-destructive/30">
        <CardContent className="space-y-5 p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <Archive className="size-6" aria-hidden />
          </span>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">This account is archived</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {session?.organization?.name ?? 'This account'}&rsquo;s plan was not renewed, so it is locked.
              Nothing has been deleted yet - renew and everything comes back exactly as it was.
            </p>
          </div>

          {dataPurgeAt ? (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <p>
                If it is not renewed by <strong>{inrDate(dataPurgeAt)}</strong>
                {daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)` : ''}, its vehicles,
                trips, documents and other data are <strong>permanently deleted</strong>. Payments and invoices
                are kept, and drivers keep their own profiles.
              </p>
            </div>
          ) : null}

          {canRenew ? (
            billing.isLoading ? (
              <LoadingState label="Loading your plan…" className="min-h-0 p-2" />
            ) : (
              <Button
                size="lg"
                className="w-full"
                loading={payNow.isPending || checkout.busy}
                onClick={() => payNow.mutate()}
              >
                <CreditCard className="size-4" />
                {billing.data
                  ? `Renew ${billing.data.planName} - ${formatCurrency(billing.data.monthlyTotal)}`
                  : 'Renew now'}
              </Button>
            )
          ) : (
            <p className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">
              Only the account owner can renew. Ask them to sign in and renew the plan to restore access.
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>SOS keeps working while the account is archived.</span>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
