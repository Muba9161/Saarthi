import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUpRight, Wallet } from 'lucide-react';
import {
  BankAccountStatus,
  WalletCashoutStatus,
  formatCurrency,
  formatDate,
  humanizeEnum,
  type WalletCashoutView,
} from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { WalletBankForm } from './wallet-bank-form';
import { WALLET_KEY, useWallet } from './use-wallet';

const cashoutColumns: Column<WalletCashoutView>[] = [
  {
    key: 'amount',
    header: 'Amount',
    cell: (row) => <span className="font-medium tabular-nums">{formatCurrency(row.amount)}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'requested',
    header: 'Requested',
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{formatDate(row.requestedAt)}</span>
    ),
  },
  {
    key: 'account',
    header: 'To account',
    hideOnMobile: true,
    cell: (row) => (
      <span className="font-mono text-sm text-muted-foreground">•••• {row.accountLast4}</span>
    ),
  },
];

/**
 * The Saarthi wallet — Refer & Earn rewards, and cash-out.
 *
 * Nothing waits on a person here. Rewards unlock on their own after the hold,
 * and a cash-out goes straight to the holder's verified bank account; the only
 * gates are the ones the holder can see and act on — a verified account and
 * the minimum balance.
 */
export function WalletPanel() {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [editingBank, setEditingBank] = React.useState(false);

  const wallet = useWallet();

  const cashouts = useQuery({
    queryKey: [...WALLET_KEY, 'cashouts', page],
    queryFn: () =>
      api.get<Paginated<WalletCashoutView>>('/wallet/cashouts', { page, pageSize: 10 }),
    enabled: Boolean(wallet.data?.cashoutEnabled),
    placeholderData: keepPreviousData,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: WALLET_KEY });

  const cashout = useMutation({
    mutationFn: () => api.post<WalletCashoutView>('/wallet/cashouts'),
    onSuccess: (result) => {
      refresh();
      if (result.status === WalletCashoutStatus.PAID) {
        toast.success(`${formatCurrency(result.amount)} sent to your bank account`);
      } else if (result.status === WalletCashoutStatus.FAILED) {
        toast.error('The transfer failed', {
          description: `${result.failureReason ?? 'The bank did not accept it.'} The amount is back in your wallet.`,
        });
      } else {
        toast.info('Cash-out is on its way', {
          description: 'Banks usually confirm within a few minutes.',
        });
      }
    },
    onError: (error) => toast.error('Could not cash out', { description: errorMessage(error) }),
  });

  if (wallet.isLoading) return <LoadingState label="Loading your wallet…" />;
  if (wallet.error) return <ErrorState error={wallet.error} onRetry={() => void wallet.refetch()} />;
  if (!wallet.data) return null;

  const data = wallet.data;
  const bank = data.bankAccount;
  const bankVerified = bank?.status === BankAccountStatus.VERIFIED;
  const showBankForm = data.cashoutEnabled && (!bank || editingBank || bank.status === BankAccountStatus.FAILED);

  const blocker = !data.cashoutEnabled
    ? 'Cash-out opens soon. Your rewards keep adding up here in the meantime.'
    : !bankVerified
      ? 'Connect and verify your bank account to cash out.'
      : data.available < data.minCashout
        ? `You can cash out once ${formatCurrency(data.minCashout)} is available.`
        : null;

  return (
    <section className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            title="Your wallet"
            description={`Rewards unlock ${data.holdDays} days after your friend's trial starts, while it is still active.`}
          />
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                <Wallet className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Available to cash out</p>
                <p className="text-xl font-semibold tabular-nums">{formatCurrency(data.available)}</p>
                <p className="text-sm text-muted-foreground">
                  {blocker ?? `Sent straight to your account ending ${bank?.accountLast4}.`}
                </p>
              </div>
            </div>
            <Button
              disabled={blocker !== null}
              loading={cashout.isPending}
              onClick={() => cashout.mutate()}
              className="sm:shrink-0"
            >
              <ArrowUpRight className="size-4" />
              Cash out {formatCurrency(data.available)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.cashoutEnabled ? (
        <Card>
          <CardHeader className="pb-3">
            <SectionHeader
              title="Bank account"
              description="Where your cash-outs are sent. It must be in your own name."
              actions={
                bank ? (
                  <Badge variant={bankVerified ? 'success' : bank.status === 'FAILED' ? 'destructive' : 'warning'}>
                    {humanizeEnum(bank.status)}
                  </Badge>
                ) : null
              }
            />
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {bank?.status === BankAccountStatus.FAILED && bank.failureReason ? (
              <Alert variant="destructive">
                <AlertDescription>{bank.failureReason}</AlertDescription>
              </Alert>
            ) : null}

            {bank && !showBankForm ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <p className="font-medium">
                    {bank.nameAtBank ?? bank.accountHolderName} · •••• {bank.accountLast4}
                  </p>
                  <p className="text-muted-foreground">
                    {[bank.bankName, bank.ifsc].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Button variant="outline" onClick={() => setEditingBank(true)}>
                  Change account
                </Button>
              </div>
            ) : null}

            {showBankForm ? (
              <WalletBankForm
                onConnected={() => {
                  setEditingBank(false);
                  refresh();
                }}
                {...(bank && bank.status !== BankAccountStatus.FAILED
                  ? { onCancel: () => setEditingBank(false) }
                  : {})}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {data.cashoutEnabled ? (
        <div className="space-y-3">
          <SectionHeader title="Cash-out history" />
          <DataTable
            columns={cashoutColumns}
            rows={cashouts.data?.items}
            rowKey={(row) => row.id}
            isLoading={cashouts.isLoading}
            error={cashouts.error}
            onRetry={() => void cashouts.refetch()}
            {...(cashouts.data?.pagination ? { pagination: cashouts.data.pagination } : {})}
            onPageChange={setPage}
            emptyTitle="No cash-outs yet"
            emptyDescription="Your withdrawals to your bank account will appear here."
          />
        </div>
      ) : null}
    </section>
  );
}
