import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeIndianRupee,
  CircleCheck,
  Clock,
  HelpCircle,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { formatCurrency, humanizeEnum } from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import type { FastagCapabilities, FastagView } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * One FASTag, as an operator needs to see it.
 *
 * The design problem here is that three different numbers all look like "the
 * balance", and only one of them is:
 *
 *   • a balance somebody recorded today — usable;
 *   • a balance recorded last week — a historical note, because the tag has
 *     been paying tolls ever since;
 *   • no balance at all — which is *not* zero.
 *
 * So the card never shows a bare figure. It shows the figure, when it was true,
 * and what that means for the next plaza. A tag with nothing recorded says so
 * in words rather than displaying ₹0 beside a working tag.
 */

const HEALTH_PRESENTATION: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted'; icon: React.ComponentType<{ className?: string }> }
> = {
  OK: { label: 'Good', variant: 'success', icon: CircleCheck },
  LOW_BALANCE: { label: 'Low balance', variant: 'warning', icon: Wallet },
  BLOCKED: { label: 'Blocked', variant: 'destructive', icon: AlertTriangle },
  EXPIRING: { label: 'Expiring', variant: 'warning', icon: Clock },
  UNKNOWN: { label: 'Balance unknown', variant: 'muted', icon: HelpCircle },
};

interface FastagCardProps {
  tag: FastagView;
  capabilities: FastagCapabilities | undefined;
  canManage: boolean;
  onChanged: () => void;
}

export function FastagCard({
  tag,
  capabilities,
  canManage,
  onChanged,
}: FastagCardProps): React.ReactElement {
  const [rechargeOpen, setRechargeOpen] = React.useState(false);
  const [balanceOpen, setBalanceOpen] = React.useState(false);

  const presentation = HEALTH_PRESENTATION[tag.health.health] ?? HEALTH_PRESENTATION.UNKNOWN!;
  const Icon = presentation.icon;

  const sync = useMutation({
    mutationFn: () => api.post(`/fleet/toll/fastag/${tag.id}/sync`, {}),
    onSuccess: () => {
      toast.success('Tag checked with the network');
      onChanged();
    },
    onError: (error) => {
      // "Not connected to a provider" is an expected answer on most
      // deployments, not a failure worth a red toast.
      const message = errorMessage(error);
      if (error instanceof ApiError && error.status === 503) toast.info(message);
      else toast.error(message);
    },
  });

  return (
    <Card className={cn(tag.health.health === 'BLOCKED' && 'border-destructive/40')}>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {tag.registrationNumber}
              <Badge variant={presentation.variant} size="sm" className="gap-1">
                <Icon className="h-3 w-3" />
                {presentation.label}
              </Badge>
              {tag.status !== 'ACTIVE' && tag.status !== 'UNKNOWN' ? (
                <Badge variant="outline" size="sm">
                  {humanizeEnum(tag.status)}
                </Badge>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tag.issuerBank}
              {tag.vehicleClass ? ` · ${tag.vehicleClass}` : ''}
              {tag.tagId ? ` · ${tag.tagId}` : ''}
              {tag.tagIdMasked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 cursor-help underline decoration-dotted">masked</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    A tag id is a payment instrument identifier. It is shown in full only to the
                    fleet owner.
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </p>
          </div>

          {capabilities?.supportsLookup && canManage ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              <RefreshCw className={cn('mr-1 h-3.5 w-3.5', sync.isPending && 'animate-spin')} />
              Check with network
            </Button>
          ) : null}
        </div>

        {/* The balance, always with what it means rather than as a bare figure. */}
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          {tag.balance === null ? (
            <>
              <p className="text-sm font-medium">No balance recorded</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {capabilities?.supportsBalance
                  ? 'Check with the network, or enter the balance from your issuer app.'
                  : 'Your FASTag provider serves tag status but not the rupee balance — that sits with the issuing bank. Enter what your issuer app shows and Saarthi will track it from there.'}
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(tag.balance)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tag.health.balanceAgeDays === null
                    ? 'just recorded'
                    : tag.health.balanceAgeDays === 0
                      ? 'recorded today'
                      : `recorded ${tag.health.balanceAgeDays} day${tag.health.balanceAgeDays === 1 ? '' : 's'} ago`}
                </p>
              </div>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                Warns below {formatCurrency(tag.lowBalanceThreshold)}
              </p>
            </>
          )}

          {tag.health.reasons.length > 0 ? (
            <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
              {tag.health.reasons.map((reason) => (
                <li key={reason} className="text-xs text-muted-foreground">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setBalanceOpen(true)}>
              <Wallet className="mr-1 h-3.5 w-3.5" />
              Update balance
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRechargeOpen(true)}>
              <BadgeIndianRupee className="mr-1 h-3.5 w-3.5" />
              Record recharge
            </Button>
            {issuerRechargeUrl(tag.issuerBank) ? (
              <Button variant="ghost" size="sm" asChild>
                <a href={issuerRechargeUrl(tag.issuerBank)!} target="_blank" rel="noreferrer">
                  Recharge at {tag.issuerBank}
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {tag.lastSyncError ? (
          <p className="text-2xs text-destructive">Last check failed: {tag.lastSyncError}</p>
        ) : null}
      </CardContent>

      <BalanceDialog
        tag={tag}
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        onSaved={onChanged}
      />
      <RechargeDialog
        tag={tag}
        open={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        onSaved={onChanged}
      />
    </Card>
  );
}

/**
 * Where an operator actually tops a tag up.
 *
 * Saarthi links out rather than embedding a payment it cannot make. The list is
 * deliberately short and only covers issuers whose portal is stable; an unknown
 * issuer simply gets no link, rather than a guess that 404s.
 */
function issuerRechargeUrl(issuerBank: string): string | null {
  const normalised = issuerBank.toLowerCase();
  if (normalised.includes('icici')) return 'https://www.icicibank.com/personal-banking/cards/prepaid-card/fastag';
  if (normalised.includes('hdfc')) return 'https://www.hdfcbank.com/personal/borrow/popular-loans/fastag';
  if (normalised.includes('paytm')) return 'https://paytm.com/fastag';
  if (normalised.includes('axis')) return 'https://www.axisbank.com/retail/cards/fastag';
  if (normalised.includes('idfc')) return 'https://www.idfcfirstbank.com/fastag';
  return null;
}

function BalanceDialog({
  tag,
  open,
  onClose,
  onSaved,
}: {
  tag: FastagView;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [balance, setBalance] = React.useState('');
  const [observedAt, setObservedAt] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setBalance(tag.balance === null ? '' : String(tag.balance));
      setObservedAt('');
    }
  }, [open, tag.balance]);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/fleet/toll/fastag/${tag.id}/balance`, {
        balance: Number(balance),
        ...(observedAt ? { observedAt: new Date(observedAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      toast.success('Balance updated');
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update balance — {tag.registrationNumber}</DialogTitle>
          <DialogDescription>
            Enter what your issuer app or SMS shows. Saarthi tracks it from there and warns you
            before the tag runs out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Balance (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">When was this true?</Label>
            <Input
              type="datetime-local"
              value={observedAt}
              onChange={(event) => setObservedAt(event.target.value)}
            />
            <p className="text-2xs text-muted-foreground">
              Leave blank for now. If you are entering a reading from a few days ago, say so — a
              tag spends by itself, and Saarthi treats an old reading as out of date rather than
              current.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!balance || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save balance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RechargeDialog({
  tag,
  open,
  onClose,
  onSaved,
}: {
  tag: FastagView;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [amount, setAmount] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [balanceAfter, setBalanceAfter] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setAmount('');
      setReference('');
      setBalanceAfter('');
    }
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(`/fleet/toll/fastag/${tag.id}/recharge`, {
        amount: Number(amount),
        ...(reference ? { reference } : {}),
        ...(balanceAfter ? { balanceAfter: Number(balanceAfter) } : {}),
      }),
    onSuccess: (result) => {
      toast.success('Recharge recorded', { description: result.message });
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record recharge — {tag.registrationNumber}</DialogTitle>
          <DialogDescription>
            Topping up happens at {tag.issuerBank}. This records the top-up you made so your
            balance and toll spend stay in step — it does not move money.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Amount added (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Balance after, if the issuer showed one (₹)</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={balanceAfter}
              onChange={(event) => setBalanceAfter(event.target.value)}
            />
            <p className="text-2xs text-muted-foreground">
              Preferred over arithmetic: a plaza may have been crossed between the last reading and
              your top-up.
            </p>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-xs">Reference</Label>
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="UPI or transaction reference"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!amount || save.isPending}>
            {save.isPending ? 'Saving…' : 'Record recharge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The FASTag panel on the Vehicle Passport. */
export function VehicleFastagPanel({
  vehicleId,
}: {
  vehicleId: string;
}): React.ReactElement {
  const queryClient = useQueryClient();

  const tags = useQuery({
    queryKey: ['vehicle-fastag', vehicleId],
    queryFn: () => api.get<FastagView[]>(`/fleet/vehicles/${vehicleId}/fastag`),
  });

  const capabilities = useQuery({
    queryKey: ['fastag-capabilities'],
    queryFn: () => api.get<FastagCapabilities>('/fleet/toll/fastag/capabilities'),
    staleTime: 30 * 60_000,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['vehicle-fastag', vehicleId] });
    void queryClient.invalidateQueries({ queryKey: ['fastag'] });
  };

  const active = (tags.data ?? []).filter((tag) => tag.closedAt === null);

  if (active.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Wallet className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No FASTag recorded</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Add the tag fitted to this vehicle to track its balance, see what it spends at each
            plaza, and be warned before it runs out at a barrier.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {active.map((tag) => (
        <FastagCard
          key={tag.id}
          tag={tag}
          capabilities={capabilities.data}
          canManage
          onChanged={refresh}
        />
      ))}
    </div>
  );
}
