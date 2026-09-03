import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Gavel, MapPin, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  BID_SCOPE_LABELS,
  LIVE_BID_STATUSES,
  Permission,
  REQUIREMENT_KIND_LABELS,
  RequirementKind,
  formatCurrency,
  formatDateTime,
  relativeTimeFrom,
} from '@saarthi/shared';
import type { RequirementBidScope } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { BoardRequirement, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { BidDialog } from '@/features/requirements/bid-dialog';
import { routeLabel, summarise } from '@/features/requirements/requirement-line';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The bidding board.
 *
 * This is the screen that did not exist before: demand, visible to the
 * businesses that can serve it. A supplier sees material requirements, a fleet
 * sees loads, a tour operator sees journeys — decided entirely by the account
 * type, on the server. The client asks for "the board"; it never asks for
 * somebody else's market.
 *
 * Rendered as cards rather than a table because the four kinds do not share
 * columns: tonnes, passengers, nights and truck bodies do not line up, and a
 * table would either be mostly empty or lie about what it was showing.
 */
export function RequirementBoardPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = React.useState(1);
  const [kind, setKind] = React.useState('all');
  const [radiusKm, setRadiusKm] = React.useState('500');
  const [excludeBid, setExcludeBid] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [bidding, setBidding] = React.useState<{
    requirement: BoardRequirement;
    scope: RequirementBidScope;
  } | null>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['requirements', 'board', { page, kind, radiusKm, excludeBid, search: debounced }],
    queryFn: () =>
      api.get<Paginated<BoardRequirement>>('/requirements/board', {
        page,
        pageSize: 20,
        radiusKm: Number(radiusKm),
        ...(kind === 'all' ? {} : { kind }),
        ...(excludeBid ? { excludeBid: true } : {}),
        ...(debounced ? { search: debounced } : {}),
      }),
    enabled: can(Permission.REQUIREMENTS_READ),
    placeholderData: keepPreviousData,
  });

  const withdraw = useMutation({
    mutationFn: (bidId: string) => api.delete(`/requirements/bids/${bidId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['requirements', 'board'] });
      toast.success('Bid withdrawn');
    },
    onError: (error) => toast.error('Could not withdraw', { description: errorMessage(error) }),
  });

  if (!can(Permission.REQUIREMENTS_READ)) return <UnauthorizedState />;

  const rows = query.data?.items ?? [];
  const pagination = query.data?.pagination;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Open requirements"
        description="What customers are asking for right now, and what your business can bid on."
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, goods or place…"
            className="pl-9"
            aria-label="Search open requirements"
          />
        </div>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All I can serve</SelectItem>
            {Object.values(RequirementKind).map((value) => (
              <SelectItem key={value} value={value}>
                {REQUIREMENT_KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={radiusKm}
          onValueChange={(value) => {
            setRadiusKm(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="100">Within 100 km</SelectItem>
            <SelectItem value="250">Within 250 km</SelectItem>
            <SelectItem value="500">Within 500 km</SelectItem>
            <SelectItem value="1500">Within 1500 km</SelectItem>
            <SelectItem value="3000">Anywhere</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm">
          <Switch checked={excludeBid} onCheckedChange={setExcludeBid} />
          Hide ones I have bid on
        </label>
      </div>

      {query.isLoading ? (
        <LoadingState label="Loading open requirements…" />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing open right now"
          description="When a customer posts a requirement your business can serve, it appears here and you are notified."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {rows.map((requirement) => (
            <BoardCard
              key={requirement.id}
              requirement={requirement}
              onBid={(scope) => setBidding({ requirement, scope })}
              onWithdraw={(bidId) => withdraw.mutate(bidId)}
            />
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      {bidding ? (
        <BidDialog
          requirement={bidding.requirement}
          scope={bidding.scope}
          open
          onOpenChange={(open) => !open && setBidding(null)}
          onPlaced={() => {
            setBidding(null);
            void queryClient.invalidateQueries({ queryKey: ['requirements', 'board'] });
          }}
        />
      ) : null}
    </div>
  );
}

function BoardCard({
  requirement,
  onBid,
  onWithdraw,
}: {
  requirement: BoardRequirement;
  onBid: (scope: RequirementBidScope) => void;
  onWithdraw: (bidId: string) => void;
}) {
  const { headline, detail } = summarise(requirement);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{requirement.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {requirement.reference} · {requirement.customerName} ·{' '}
              {relativeTimeFrom(requirement.createdAt)}
            </p>
          </div>
          <Badge variant="secondary" size="sm" className="shrink-0">
            {REQUIREMENT_KIND_LABELS[requirement.kind]}
          </Badge>
        </div>

        <div>
          <p className="text-sm font-medium">{headline}</p>
          {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="size-3.5" />
            {routeLabel(requirement)}
            {requirement.distanceToOriginKm !== null
              ? ` · ${requirement.distanceToOriginKm} km from you`
              : ''}
          </span>
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3.5" />
            {formatDateTime(requirement.startAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Bidding closes {formatDateTime(requirement.bidsCloseAt)}
          </span>
          {requirement.budgetAmount !== null ? (
            <Badge variant="accent" size="sm">
              Budget {formatCurrency(requirement.budgetAmount)}
            </Badge>
          ) : null}
          {requirement.bidCount > 0 ? (
            <span className="text-muted-foreground">
              {requirement.bidCount} bid{requirement.bidCount > 1 ? 's' : ''} so far
            </span>
          ) : (
            <span className="font-medium text-success">No bids yet</span>
          )}
        </div>

        {requirement.myBid ? (
          <div className="rounded-md bg-muted/50 p-2.5">
            <p className="text-sm">
              Your offer: <span className="font-semibold">{formatCurrency(requirement.myBid.price)}</span>{' '}
              <span className="text-xs text-muted-foreground">
                ({requirement.myBid.status.toLowerCase()})
              </span>
            </p>
            {/*
              Only a live offer can be revised or pulled. A rejected or expired
              one is shown so the bidder knows where they stand, but offering
              buttons that the API will refuse is worse than offering none.
            */}
            {LIVE_BID_STATUSES.includes(requirement.myBid.status) ? (
              <div className="mt-2 flex gap-2">
                {requirement.availableScopes.includes(requirement.myBid.scope) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onBid(requirement.myBid!.scope)}
                  >
                    Revise
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => onWithdraw(requirement.myBid!.id)}>
                  Withdraw
                </Button>
              </div>
            ) : null}
          </div>
        ) : requirement.availableScopes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {requirement.availableScopes.map((scope) => (
              <Button key={scope} size="sm" onClick={() => onBid(scope)}>
                <Gavel className="size-4" />
                Bid{requirement.availableScopes.length > 1 ? ` for ${BID_SCOPE_LABELS[scope].toLowerCase()}` : ''}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default RequirementBoardPage;
