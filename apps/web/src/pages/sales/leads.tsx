import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Plus } from 'lucide-react';
import {
  PLAN_CATALOGUE,
  Permission,
  SALES_LEAD_SOURCES,
  SALES_LEAD_STATUS_LABEL,
  VEHICLE_TYPES,
  formatDate,
  humanizeEnum,
  relativeTimeFrom,
} from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import type { LeadView } from '@/features/sales/types';
import { FilterBar, PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * My leads.
 *
 * Ordered by the follow-up a salesperson owes, oldest first — the API decides
 * that, so the list a salesperson opens in the morning is the list of calls to
 * make rather than the last thing they typed in.
 *
 * The `overdueOnly` filter is in the URL rather than in component state so the
 * dashboard's "follow-ups you owe" row can link straight to it.
 */
export function SalesLeadsPage(): React.ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile, godWebVerificationAvailable, canSell } = useSalesProfile();

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [creating, setCreating] = React.useState(false);

  const overdueOnly = searchParams.get('overdueOnly') === 'true';

  const leads = useQuery({
    queryKey: ['/sales/leads', page, search, status, overdueOnly],
    queryFn: () =>
      api.get<Paginated<LeadView>>('/sales/leads', {
        page,
        pageSize: 20,
        ...(search ? { search } : {}),
        ...(status !== 'all' ? { status } : {}),
        ...(overdueOnly ? { overdueOnly: true } : {}),
      }),
    enabled: can(Permission.LEADS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.LEADS_READ)) return <UnauthorizedState />;

  const columns: Column<LeadView>[] = [
    {
      key: 'contact',
      header: 'Prospect',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.businessName ?? row.contactName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.businessName ? `${row.contactName} · ` : ''}
            {row.phone}
          </p>
        </div>
      ),
    },
    {
      key: 'where',
      header: 'Where',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.city ?? '—'}
          {row.fleetSize !== null ? ` · ${row.fleetSize} vehicles` : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Stage',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={row.status} />
          {row.organizationId ? (
            <Badge variant="outline" className="text-[10px]">
              Customer
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'followUp',
      header: 'Follow-up',
      hideOnMobile: true,
      cell: (row) =>
        row.nextFollowUpAt ? (
          <span
            className={
              row.followUpOverdue
                ? 'inline-flex items-center gap-1 text-sm font-medium text-destructive'
                : 'text-sm text-muted-foreground'
            }
          >
            {row.followUpOverdue ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
            {formatDate(row.nextFollowUpAt)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'updated',
      header: 'Updated',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{relativeTimeFrom(row.updatedAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Sales"
        title="My leads"
        description="Prospects you are working. Only you and Saarthi operations can see them."
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={!canSell}>
            <Plus className="mr-1.5 h-4 w-4" />
            New lead
          </Button>
        }
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      <FilterBar>
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Business, name, phone or city"
          className="sm:max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-52">
            <SelectValue placeholder="Any stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any stage</SelectItem>
            {Object.entries(SALES_LEAD_STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={overdueOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            if (overdueOnly) next.delete('overdueOnly');
            else next.set('overdueOnly', 'true');
            setSearchParams(next, { replace: true });
            setPage(1);
          }}
        >
          Overdue only
        </Button>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={leads.data?.items}
        rowKey={(row) => row.id}
        isLoading={leads.isLoading}
        error={leads.error}
        onRetry={() => void leads.refetch()}
        onRowClick={(row) => navigate(`/sales/leads/${row.id}`)}
        {...(leads.data?.pagination ? { pagination: leads.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle={overdueOnly ? 'No follow-up is overdue' : 'No leads yet'}
        emptyDescription={
          overdueOnly
            ? 'Everything you owe a call is up to date.'
            : 'Add the first prospect you visit and Saarthi will keep the pipeline for you.'
        }
        emptyAction={
          overdueOnly ? undefined : (
            <Button size="sm" onClick={() => setCreating(true)} disabled={!canSell}>
              New lead
            </Button>
          )
        }
      />

      <CreateLeadDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/**
 * The new-lead form.
 *
 * Phone is the only required contact detail and it is required deliberately: a
 * lead nobody can ring is a note, and the pipeline counts on the dashboard
 * would quietly fill with them. Fleet size is optional for the opposite reason
 * — it is usually a guess at first contact, and a mandatory field invites an
 * invented number.
 */
function CreateLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = React.useState({
    contactName: '',
    businessName: '',
    phone: '',
    city: '',
    fleetSize: '',
    interestedPlan: '',
    vehicleType: '',
    source: 'FIELD_VISIT',
    notes: '',
    nextFollowUpAt: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<LeadView>('/sales/leads', {
        contactName: form.contactName,
        ...(form.businessName ? { businessName: form.businessName } : {}),
        phone: form.phone,
        ...(form.city ? { city: form.city } : {}),
        ...(form.fleetSize ? { fleetSize: Number(form.fleetSize) } : {}),
        ...(form.interestedPlan ? { interestedPlan: form.interestedPlan } : {}),
        ...(form.vehicleType ? { vehicleTypes: [form.vehicleType] } : {}),
        source: form.source,
        ...(form.notes ? { notes: form.notes } : {}),
        ...(form.nextFollowUpAt ? { nextFollowUpAt: form.nextFollowUpAt } : {}),
      }),
    onSuccess: (lead) => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/leads'] });
      void queryClient.invalidateQueries({ queryKey: ['/sales/dashboard'] });
      toast.success('Lead added.');
      onOpenChange(false);
      navigate(`/sales/leads/${lead.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const canSubmit = form.contactName.trim().length >= 2 && form.phone.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New lead</DialogTitle>
          <DialogDescription>
            Only the name and a phone number are needed now. Everything else can be filled in
            after the visit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lead-business">Business name</Label>
            <Input
              id="lead-business"
              value={form.businessName}
              onChange={(event) => setForm({ ...form, businessName: event.target.value })}
              placeholder="ABC Transport"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-contact">Contact name *</Label>
            <Input
              id="lead-contact"
              value={form.contactName}
              onChange={(event) => setForm({ ...form, contactName: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-phone">Phone *</Label>
            <Input
              id="lead-phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="9876543210"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-city">City</Label>
            <Input
              id="lead-city"
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-fleet">Fleet size</Label>
            <Input
              id="lead-fleet"
              value={form.fleetSize}
              onChange={(event) => setForm({ ...form, fleetSize: event.target.value })}
              inputMode="numeric"
              placeholder="Their estimate"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle type</Label>
            <Select
              value={form.vehicleType}
              onValueChange={(value) => setForm({ ...form, vehicleType: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Not sure yet" />
              </SelectTrigger>
              <SelectContent>
                {VEHICLE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanizeEnum(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Interested plan</Label>
            <Select
              value={form.interestedPlan}
              onValueChange={(value) => setForm({ ...form, interestedPlan: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Undecided" />
              </SelectTrigger>
              <SelectContent>
                {PLAN_CATALOGUE.map((plan) => (
                  <SelectItem key={plan.tier} value={plan.tier}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>How you met</Label>
            <Select
              value={form.source}
              onValueChange={(value) => setForm({ ...form, source: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SALES_LEAD_SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>
                    {humanizeEnum(source)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-followup">Next follow-up</Label>
            <Input
              id="lead-followup"
              type="date"
              value={form.nextFollowUpAt}
              onChange={(event) => setForm({ ...form, nextFollowUpAt: event.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lead-notes">Notes</Label>
            <Textarea
              id="lead-notes"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="What they run, what they complained about, who decides."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
            {create.isPending ? 'Adding…' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SalesLeadsPage;
