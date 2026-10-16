import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatRegistrationNumber,
  humanizeEnum,
  relativeTimeFrom,
  type OwnershipReviewDetail,
  type OwnershipReviewSummary,
} from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import type { Paginated } from '@/lib/api-types';
import { SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * Vehicle ownership requests: owners asking the Saarthi team to confirm a
 * vehicle is theirs when the RC owner's name could not be matched to a
 * verified name automatically.
 *
 * The panel puts the evidence side by side — the RC owner as the RTO records
 * them and the account's verified names — so most decisions are one look. An
 * approval confirms the account's own vehicle at once, or lets a plate another
 * account holds move when the requester adds it again. A rejection must say
 * why: the owner reads it.
 */

type StatusFilter = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';

const KIND_LABEL: Record<OwnershipReviewSummary['kind'], string> = {
  OWN_VEHICLE: 'Own vehicle',
  CLAIM: 'Held by another account',
};

export function OwnershipReviewQueue() {
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<StatusFilter>('PENDING');
  const [active, setActive] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['ownership-reviews', 'queue', page, status],
    queryFn: () =>
      api.get<Paginated<OwnershipReviewSummary>>('/admin/ownership-reviews', {
        page,
        pageSize: 20,
        status,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const columns: Column<OwnershipReviewSummary>[] = [
    {
      key: 'vehicle',
      header: 'Vehicle',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">
            {formatRegistrationNumber(row.registrationNumber)}
          </p>
          <p className="truncate text-xs text-muted-foreground">{KIND_LABEL[row.kind]}</p>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Account',
      hideOnMobile: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.organizationName ?? '-'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.requestedByName ?? ''}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'waiting',
      header: 'Asked',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{relativeTimeFrom(row.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <Button
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setActive(row.id);
          }}
        >
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Select
        value={status}
        onValueChange={(value) => {
          setStatus(value as StatusFilter);
          setPage(1);
        }}
      >
        <SelectTrigger className="sm:w-56" aria-label="Show requests">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="PENDING">Awaiting review</SelectItem>
          <SelectItem value="APPROVED">Approved</SelectItem>
          <SelectItem value="REJECTED">Rejected</SelectItem>
          <SelectItem value="ALL">All requests</SelectItem>
        </SelectContent>
      </Select>

      {query.data?.items.length === 0 && status === 'PENDING' ? (
        <EmptyState
          icon={ShieldCheck}
          title="No ownership requests waiting"
          description="Every request to confirm a vehicle has been decided."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={query.data?.items}
          rowKey={(row) => row.id}
          isLoading={query.isLoading || query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(row) => setActive(row.id)}
          {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
          onPageChange={setPage}
          emptyTitle="No requests"
        />
      )}

      <OwnershipReviewPanel
        reviewId={active}
        open={Boolean(active)}
        onOpenChange={(open) => !open && setActive(null)}
      />
    </div>
  );
}

function OwnershipReviewPanel({
  reviewId,
  open,
  onOpenChange,
}: {
  reviewId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = React.useState<'APPROVED' | 'REJECTED' | null>(null);
  const [note, setNote] = React.useState('');

  const detail = useQuery({
    queryKey: ['ownership-reviews', reviewId],
    queryFn: () => api.get<OwnershipReviewDetail>(`/admin/ownership-reviews/${reviewId}`),
    enabled: Boolean(reviewId) && open,
  });

  React.useEffect(() => {
    if (!open) {
      setDecision(null);
      setNote('');
    }
  }, [open]);

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/admin/ownership-reviews/${reviewId}/decision`, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Rejected', {
        description: 'The owner has been notified.',
      });
      void queryClient.invalidateQueries({ queryKey: ['ownership-reviews'] });
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error('Could not record the decision', { description: errorMessage(error) }),
  });

  /** The attachment is private, so the token travels with the fetch, not the URL. */
  const openAttachment = (): void => {
    void (async () => {
      try {
        const response = await fetch(absoluteApiUrl(`/admin/ownership-reviews/${reviewId}/attachment`), {
          credentials: 'include',
          headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
        });
        if (!response.ok) throw new Error('Download failed');
        const url = URL.createObjectURL(await response.blob());
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch {
        toast.error('Could not open the attachment');
      }
    })();
  };

  const review = detail.data;
  const pending = review?.status === 'PENDING';
  const canSubmit =
    pending && Boolean(decision) && (decision === 'APPROVED' || note.trim().length >= 5);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Review vehicle ownership</SheetTitle>
          <SheetDescription>
            {review
              ? `${formatRegistrationNumber(review.registrationNumber)} · ${KIND_LABEL[review.kind]}`
              : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {detail.isLoading ? (
            <LoadingState label="Loading request…" />
          ) : review ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={review.status} />
                {review.organizationName ? (
                  <Badge variant="secondary" size="sm">
                    {review.organizationName}
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {`Asked ${relativeTimeFrom(review.createdAt)}`}
                  {review.requestedByName ? ` by ${review.requestedByName}` : ''}
                </span>
              </div>

              <div className="space-y-2">
                <SectionHeader title="Their message" />
                <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  {review.message}
                </p>
                {review.hasAttachment ? (
                  <Button size="sm" variant="outline" onClick={openAttachment}>
                    <FileText className="size-4" />
                    <span>Open the attachment</span>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">No RC or document attached.</p>
                )}
              </div>

              {/* The evidence the automatic match could not settle, side by side. */}
              <div className="space-y-2">
                <SectionHeader title="Names to compare" />
                <dl className="grid gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">RC owner (RTO record)</dt>
                    <dd className="font-medium">{review.rcOwnerName ?? 'No RTO record fetched yet'}</dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs text-muted-foreground">Verified names on the account</dt>
                    <dd className="font-medium">
                      {review.verifiedNames.length > 0
                        ? review.verifiedNames.join(', ')
                        : 'None verified yet'}
                    </dd>
                  </div>
                </dl>
              </div>

              {review.holder ? (
                <div className="space-y-1">
                  <SectionHeader title="Held now by" />
                  <p className="text-sm">
                    {`${review.holder.organizationName ?? 'Another account'} · ownership ${humanizeEnum(review.holder.ownershipStatus).toLowerCase()}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Approving lets the requester add it; that account&rsquo;s copy is then archived
                    and they are told.
                  </p>
                </div>
              ) : null}

              {pending ? (
                <div className="space-y-3">
                  <SectionHeader title="Decision" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={decision === 'APPROVED' ? 'success' : 'outline'}
                      onClick={() => setDecision('APPROVED')}
                    >
                      <Check className="size-4" />
                      <span>Approve</span>
                    </Button>
                    <Button
                      variant={decision === 'REJECTED' ? 'destructive' : 'outline'}
                      onClick={() => setDecision('REJECTED')}
                    >
                      <X className="size-4" />
                      <span>Reject</span>
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ownership-review-note" required={decision === 'REJECTED'}>
                      {decision === 'REJECTED' ? 'Why is it rejected?' : 'Note to the owner (optional)'}
                    </Label>
                    <Textarea
                      id="ownership-review-note"
                      rows={3}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="The owner sees this."
                    />
                  </div>
                </div>
              ) : review.decisionNote ? (
                <div className="space-y-1">
                  <SectionHeader title="Decision note" />
                  <p className="text-sm">{review.decisionNote}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {pending ? 'Cancel' : 'Close'}
          </Button>
          {pending ? (
            <Button disabled={!canSubmit} loading={decide.isPending} onClick={() => decide.mutate()}>
              Submit decision
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
