import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Permission, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { Paginated, VerificationCaseSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Your organization's own verification submissions.
 *
 * In demo mode each pending case can be self-approved. A self-served install
 * has no platform reviewer, and an unverified driver cannot be assigned to a
 * trip — without this the product would dead-end on a queue nobody can drain.
 * The endpoint behind the button is refused unless DEMO_MODE is on, which the
 * API will not allow in production.
 */

const PENDING_STATUSES = ['PENDING', 'SUBMITTED', 'UNDER_REVIEW'];

export function VerificationPage() {
  const { can, session } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['verification', 'mine', page],
    queryFn: () => api.get<Paginated<VerificationCaseSummary>>('/verification', { page, pageSize: 20 }),
    enabled: can(Permission.VERIFICATION_READ),
    placeholderData: keepPreviousData,
  });

  const selfApprove = useMutation({
    mutationFn: (caseId: string) => api.post(`/verification/${caseId}/self-approve`, {}),
    onSuccess: () => {
      toast.success('Verified', { description: 'The record can now be used in operations.' });
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });
    },
    onError: (error) => toast.error('Could not verify', { description: errorMessage(error) }),
  });

  if (!can(Permission.VERIFICATION_READ)) return <UnauthorizedState />;

  const canSelfApprove = Boolean(session?.demoMode) && can(Permission.VERIFICATION_SUBMIT);
  const pending = (query.data?.items ?? []).filter((row) => PENDING_STATUSES.includes(row.status));

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
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'documents',
      header: 'Documents',
      numeric: true,
      hideOnMobile: true,
      cell: (row) => row.documentCount,
    },
    {
      key: 'reason',
      header: 'Notes',
      hideOnMobile: true,
      cell: (row) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">
          {row.rejectionReason ?? row.reviewerNotes ?? '—'}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Updated',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{relativeTimeFrom(row.updatedAt)}</span>
      ),
    },
    ...(canSelfApprove
      ? [
          {
            key: 'action',
            header: '',
            cell: (row: VerificationCaseSummary) =>
              PENDING_STATUSES.includes(row.status) ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={selfApprove.isPending && selfApprove.variables === row.id}
                  onClick={() => selfApprove.mutate(row.id)}
                >
                  <BadgeCheck className="size-4" />
                  Verify
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              ),
          } satisfies Column<VerificationCaseSummary>,
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Compliance"
        title="Verification"
        description="The status of every verification submission for your organization."
      />

      {canSelfApprove && pending.length > 0 ? (
        <Alert variant="info">
          <Sparkles className="size-4" />
          <AlertTitle>
            {pending.length} submission{pending.length === 1 ? '' : 's'} waiting on review
          </AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              This install is in demo mode, so you can approve your own submissions and keep
              moving. On a real deployment a platform reviewer does this.
            </span>
            <Button
              size="sm"
              variant="glass"
              loading={selfApprove.isPending}
              onClick={() => pending.forEach((row) => selfApprove.mutate(row.id))}
            >
              <ShieldCheck className="size-4" />
              Verify all {pending.length}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(row) => row.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="Nothing submitted yet"
        emptyDescription="Upload documents against a driver or truck, then submit them for verification."
      />
    </div>
  );
}

export default VerificationPage;
