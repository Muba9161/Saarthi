import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { FileWarning, ShieldCheck } from 'lucide-react';
import { Permission, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { ComplianceSummary, DocumentSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatCard } from '@/components/common/stat-card';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SectionHeader } from '@/components/common/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function DocumentsPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = React.useState(1);
  const filter = searchParams.get('filter') ?? 'all';

  const compliance = useQuery({
    queryKey: ['documents', 'compliance'],
    queryFn: () => api.get<ComplianceSummary>('/documents/compliance'),
    enabled: can(Permission.DOCUMENTS_READ),
  });

  const validity =
    filter === 'expiring' ? 'EXPIRING_SOON' : filter === 'expired' ? 'EXPIRED' : filter === 'review' ? 'PENDING_VERIFICATION' : undefined;

  const documents = useQuery({
    queryKey: ['documents', 'list', page, validity],
    queryFn: () => api.get<Paginated<DocumentSummary>>('/documents', { page, pageSize: 20, ...(validity ? { validity } : {}) }),
    enabled: can(Permission.DOCUMENTS_READ),
  });

  if (!can(Permission.DOCUMENTS_READ)) return <UnauthorizedState />;

  const columns: Column<DocumentSummary>[] = [
    { key: 'type', header: 'Document', cell: (row) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.documentTypeLabel}</p>
        <p className="truncate text-xs text-muted-foreground">{row.title ?? row.fileName}</p>
      </div>
    ) },
    { key: 'owner', header: 'Belongs to', hideOnMobile: true, cell: (row) => <span className="text-sm">{humanizeEnum(row.ownerType)}</span> },
    { key: 'number', header: 'Number', hideOnMobile: true, cell: (row) => <span className="text-sm text-muted-foreground">{row.documentNumber ?? '—'}</span> },
    { key: 'expiry', header: 'Expiry', cell: (row) => (
      <div className="text-sm">
        <p>{row.expiryDate ? new Date(row.expiryDate).toLocaleDateString('en-IN') : 'No expiry'}</p>
        {row.daysRemaining !== null ? (
          <p className="text-xs text-muted-foreground">{row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)} days ago` : `in ${row.daysRemaining} days`}</p>
        ) : null}
      </div>
    ) },
    { key: 'validity', header: 'Status', cell: (row) => <StatusBadge status={row.validity} /> },
  ];

  const summary = compliance.data;

  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description="Compliance across every truck, driver and business record." />

      {summary ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Valid" value={summary.valid} icon={ShieldCheck} tone="success" />
          <StatCard label="Expiring soon" value={summary.expiringSoon} icon={FileWarning} tone={summary.expiringSoon > 0 ? 'warning' : 'default'} onClick={() => setSearchParams({ filter: 'expiring' })} />
          <StatCard label="Expired" value={summary.expired} icon={FileWarning} tone={summary.expired > 0 ? 'destructive' : 'default'} onClick={() => setSearchParams({ filter: 'expired' })} />
          <StatCard label="Awaiting review" value={summary.pendingVerification} icon={ShieldCheck} tone={summary.pendingVerification > 0 ? 'info' : 'default'} onClick={() => setSearchParams({ filter: 'review' })} />
        </div>
      ) : null}

      {summary && summary.missingMandatory.length > 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader className="pb-3">
            <SectionHeader title="Missing mandatory documents" description="These must be uploaded before verification can be submitted." />
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 pt-0">
            {summary.missingMandatory.slice(0, 20).map((entry) => (
              <span key={`${entry.ownerId}-${entry.documentType}`} className="rounded-full border border-warning/40 bg-card px-2.5 py-1 text-xs">
                <span className="font-medium">{entry.ownerLabel}</span> · {entry.label}
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Select value={filter} onValueChange={(value) => { setSearchParams(value === 'all' ? {} : { filter: value }); setPage(1); }}>
        <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All documents</SelectItem>
          <SelectItem value="expiring">Expiring soon</SelectItem>
          <SelectItem value="expired">Expired</SelectItem>
          <SelectItem value="review">Awaiting review</SelectItem>
        </SelectContent>
      </Select>

      <DataTable
        columns={columns}
        rows={documents.data?.items}
        rowKey={(row) => row.id}
        isLoading={documents.isLoading}
        error={documents.error}
        onRetry={() => void documents.refetch()}
        {...(documents.data?.pagination ? { pagination: documents.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No documents"
        emptyDescription="Upload documents from a truck or driver profile."
      />
    </div>
  );
}

export default DocumentsPage;
