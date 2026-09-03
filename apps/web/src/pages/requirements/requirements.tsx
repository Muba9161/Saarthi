import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import {
  Permission,
  REQUIREMENT_KIND_LABELS,
  RequirementKind,
  RequirementStatus,
  formatCurrency,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { Paginated, RequirementSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { RequirementLine } from '@/features/requirements/requirement-line';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * The customer's own requirements.
 *
 * Deliberately one list across all four categories rather than a tab per kind:
 * a customer who posted a load and a tour in the same week thinks of both as
 * "things I am waiting on", and splitting them would hide whichever one they
 * were not looking at.
 */
export function RequirementsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState('all');
  const [kind, setKind] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['requirements', { page, status, kind, search: debounced }],
    queryFn: () =>
      api.get<Paginated<RequirementSummary>>('/requirements', {
        page,
        pageSize: 20,
        ...(status === 'active' ? { activeOnly: true } : status === 'all' ? {} : { status }),
        ...(kind === 'all' ? {} : { kind }),
        ...(debounced ? { search: debounced } : {}),
      }),
    enabled: can(Permission.REQUIREMENTS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.REQUIREMENTS_READ)) return <UnauthorizedState />;

  const columns: Column<RequirementSummary>[] = [
    {
      key: 'reference',
      header: 'Requirement',
      cell: (requirement) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{requirement.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {requirement.reference} · {relativeTimeFrom(requirement.createdAt)}
          </p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Category',
      cell: (requirement) => (
        <Badge variant="secondary" size="sm">
          {REQUIREMENT_KIND_LABELS[requirement.kind]}
        </Badge>
      ),
    },
    {
      key: 'what',
      header: 'What',
      hideOnMobile: true,
      cell: (requirement) => <RequirementLine requirement={requirement} />,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (requirement) => <StatusBadge status={requirement.status} />,
    },
    {
      key: 'bids',
      header: 'Bids',
      numeric: true,
      cell: (requirement) =>
        requirement.bidCount > 0 ? (
          <div className="text-right">
            <p className="text-sm font-medium">{requirement.bidCount}</p>
            {requirement.lowestBid !== null ? (
              <p className="text-xs text-muted-foreground">
                from {formatCurrency(requirement.lowestBid)}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {requirement.biddingClosed ? 'None' : 'Waiting'}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="My requirements"
        description="What you have asked for, and what businesses have offered."
        actions={
          can(Permission.REQUIREMENTS_CREATE) ? (
            <Button onClick={() => navigate('/requirements/new')}>
              <Plus className="size-4" />
              Post a requirement
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, reference or place…"
            className="pl-9"
            aria-label="Search requirements"
          />
        </div>
        <Select
          value={kind}
          onValueChange={(value) => {
            setKind(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.values(RequirementKind).map((value) => (
              <SelectItem key={value} value={value}>
                {REQUIREMENT_KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="active">In progress</SelectItem>
            {Object.values(RequirementStatus).map((value) => (
              <SelectItem key={value} value={value}>
                {humanizeEnum(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataView
        surface="marketplace.requirements"
        columns={columns}
        rows={query.data?.items}
        rowKey={(requirement) => requirement.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(requirement) => navigate(`/requirements/${requirement.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="Nothing posted yet"
        emptyDescription="Tell Saarthi what you need — material, transport, a cab or a tour — and the businesses that can serve it will bid for your work."
        emptyAction={
          can(Permission.REQUIREMENTS_CREATE) ? (
            <Button onClick={() => navigate('/requirements/new')}>
              <Plus className="size-4" />
              Post a requirement
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

export default RequirementsPage;
