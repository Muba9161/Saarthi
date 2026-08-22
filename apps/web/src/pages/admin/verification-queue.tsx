import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, MessageSquareWarning, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Permission, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import type { Paginated, VerificationCaseSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, LoadingState, UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Verification review queue.
 *
 * Opening a case shows the submitted documents and the readiness check the
 * applicant saw, so a reviewer approves against the same evidence. Rejecting
 * or requesting a correction requires a written reason — the applicant is told
 * exactly what to fix.
 */

interface CaseDetail extends VerificationCaseSummary {
  readiness: {
    ready: boolean;
    missing: { documentType: string; label: string }[];
    invalid: { documentType: string; label: string; reason: string }[];
  };
  documents: {
    id: string;
    documentType: string;
    title: string | null;
    fileName: string;
    mimeType: string;
    expiryDate: string | null;
    verificationStatus: string;
  }[];
  events: {
    id: string;
    status: string;
    note: string | null;
    actorUserId: string | null;
    createdAt: string;
  }[];
}

type Decision = 'VERIFIED' | 'REJECTED' | 'CORRECTION_REQUESTED';

function ReviewPanel({
  caseId,
  open,
  onOpenChange,
}: {
  caseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const detail = useQuery({
    queryKey: ['verification', caseId],
    queryFn: () => api.get<CaseDetail>(`/verification/${caseId}`),
    enabled: Boolean(caseId) && open,
  });

  React.useEffect(() => {
    if (!open) {
      setDecision(null);
      setReason('');
      setNotes('');
    }
  }, [open]);

  const review = useMutation({
    mutationFn: () =>
      api.post(`/verification/${caseId}/review`, {
        decision,
        ...(notes ? { reviewerNotes: notes } : {}),
        ...(reason ? { rejectionReason: reason } : {}),
      }),
    onSuccess: () => {
      toast.success(
        decision === 'VERIFIED'
          ? 'Verified'
          : decision === 'REJECTED'
            ? 'Rejected'
            : 'Correction requested',
        { description: 'The applicant has been notified.' },
      );
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not submit the review', { description: errorMessage(error) }),
  });

  /** Documents are private, so the token travels with the fetch, not the URL. */
  const openDocument = (documentId: string): void => {
    void (async () => {
      try {
        const response = await fetch(
          absoluteApiUrl(`/documents/${documentId}/download?disposition=inline`),
          {
            credentials: 'include',
            headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
          },
        );
        if (!response.ok) throw new Error('Download failed');
        const url = URL.createObjectURL(await response.blob());
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch {
        toast.error('Could not open the document');
      }
    })();
  };

  const needsReason = decision === 'REJECTED' || decision === 'CORRECTION_REQUESTED';
  const canSubmit = Boolean(decision) && (!needsReason || reason.trim().length >= 5);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Review submission</SheetTitle>
          <SheetDescription>
            {detail.data
              ? `${humanizeEnum(detail.data.subjectType)} · ${detail.data.subjectLabel}`
              : 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {detail.isLoading ? (
            <LoadingState label="Loading case…" />
          ) : detail.data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detail.data.status} />
                {detail.data.organizationName ? (
                  <Badge variant="secondary" size="sm">
                    {detail.data.organizationName}
                  </Badge>
                ) : null}
                {detail.data.submittedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Submitted {relativeTimeFrom(detail.data.submittedAt)}
                  </span>
                ) : null}
              </div>

              {/* The same readiness check the applicant saw before submitting. */}
              {detail.data.readiness.ready ? (
                <Alert variant="success">
                  <ShieldCheck className="size-4" />
                  <AlertTitle>All mandatory documents present and valid</AlertTitle>
                </Alert>
              ) : (
                <Alert variant="warning">
                  <MessageSquareWarning className="size-4" />
                  <AlertTitle>Evidence is incomplete</AlertTitle>
                  <AlertDescription className="space-y-1">
                    {detail.data.readiness.missing.length > 0 ? (
                      <p>
                        Missing:{' '}
                        {detail.data.readiness.missing.map((entry) => entry.label).join(', ')}
                      </p>
                    ) : null}
                    {detail.data.readiness.invalid.map((entry) => (
                      <p key={entry.documentType}>
                        {entry.label}: {entry.reason}
                      </p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <SectionHeader
                  title={`Documents (${detail.data.documents.length})`}
                  description="Open each one before deciding."
                />
                {detail.data.documents.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No documents attached to this submission.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.data.documents.map((document) => (
                      <li
                        key={document.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-2.5"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {document.title ?? humanizeEnum(document.documentType)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {document.expiryDate
                              ? `Expires ${new Date(document.expiryDate).toLocaleDateString('en-IN')}`
                              : 'No expiry'}
                          </p>
                        </div>
                        <StatusBadge status={document.verificationStatus} size="sm" />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openDocument(document.id)}
                        >
                          Open
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-3">
                <SectionHeader title="Decision" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(
                    [
                      { value: 'VERIFIED', label: 'Approve', icon: Check, variant: 'success' },
                      {
                        value: 'CORRECTION_REQUESTED',
                        label: 'Request fix',
                        icon: MessageSquareWarning,
                        variant: 'outline',
                      },
                      { value: 'REJECTED', label: 'Reject', icon: X, variant: 'destructive' },
                    ] as const
                  ).map((option) => (
                    <Button
                      key={option.value}
                      variant={decision === option.value ? option.variant : 'outline'}
                      onClick={() => setDecision(option.value)}
                    >
                      <option.icon className="size-4" />
                      {option.label}
                    </Button>
                  ))}
                </div>

                {needsReason ? (
                  <div className="space-y-1.5">
                    <Label required>What needs to change?</Label>
                    <Textarea
                      rows={3}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Be specific — the applicant sees this and acts on it."
                    />
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label>Internal notes (optional)</Label>
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Recorded on the case for other reviewers."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <SectionHeader title="History" />
                <ol className="relative space-y-2.5 border-l border-border pl-4">
                  {detail.data.events.map((event) => (
                    <li key={event.id} className="relative">
                      <span className="absolute -left-[1.15rem] top-1.5 size-2 rounded-full bg-primary" />
                      <p className="text-sm">{event.note ?? humanizeEnum(event.status)}</p>
                      <p className="text-xs text-muted-foreground">
                        {relativeTimeFrom(event.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          ) : null}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} loading={review.isPending} onClick={() => review.mutate()}>
            Submit review
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function AdminVerificationQueuePage() {
  const { can } = useAuth();
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState('pending');
  const [activeCase, setActiveCase] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['verification', 'queue', page, status],
    queryFn: () =>
      api.get<Paginated<VerificationCaseSummary>>('/verification', {
        page,
        pageSize: 20,
        ...(status === 'pending'
          ? { status: 'SUBMITTED,UNDER_REVIEW' }
          : status === 'all'
            ? {}
            : { status }),
      }),
    enabled: can(Permission.VERIFICATION_REVIEW),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  if (!can(Permission.VERIFICATION_REVIEW)) return <UnauthorizedState />;

  const columns: Column<VerificationCaseSummary>[] = [
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.subjectLabel}</p>
          <p className="truncate text-xs text-muted-foreground">{humanizeEnum(row.subjectType)}</p>
        </div>
      ),
    },
    {
      key: 'org',
      header: 'Organization',
      hideOnMobile: true,
      cell: (row) => (
        <span className="truncate text-sm text-muted-foreground">
          {row.organizationName ?? '—'}
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'documents',
      header: 'Docs',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => row.documentCount,
    },
    {
      key: 'submitted',
      header: 'Waiting',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.submittedAt ? relativeTimeFrom(row.submittedAt) : '—'}
        </span>
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
            setActiveCase(row.id);
          }}
        >
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform operations"
        title="Verification queue"
        description="Drivers, trucks and businesses waiting for review."
      />

      <Select
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      >
        <SelectTrigger className="sm:w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Awaiting review</SelectItem>
          <SelectItem value="all">All submissions</SelectItem>
          <SelectItem value="VERIFIED">Verified</SelectItem>
          <SelectItem value="REJECTED">Rejected</SelectItem>
        </SelectContent>
      </Select>

      {query.data?.items.length === 0 && status === 'pending' ? (
        <EmptyState
          icon={ShieldCheck}
          title="Queue is clear"
          description="Every submission has been reviewed. Nice."
        />
      ) : (
        <DataTable
          columns={columns}
          rows={query.data?.items}
          rowKey={(row) => row.id}
          isLoading={query.isLoading || query.isFetching}
          error={query.error}
          onRetry={() => void query.refetch()}
          onRowClick={(row) => setActiveCase(row.id)}
          {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
          onPageChange={setPage}
          emptyTitle="No submissions"
        />
      )}

      <ReviewPanel
        caseId={activeCase}
        open={Boolean(activeCase)}
        onOpenChange={(open) => !open && setActiveCase(null)}
      />
    </div>
  );
}

export default AdminVerificationQueuePage;
