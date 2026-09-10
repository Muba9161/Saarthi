import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  Permission,
  SALESMAN_STATUS_LABEL,
  SalesmanStatus,
  SalesmanVerificationMethod,
  formatDate,
  relativeTimeFrom,
} from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import type { SalesmanProfileView } from '@/features/sales/types';
import { FilterBar, PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
 * Salesman profiles — the Saarthi mirror of a GODWeb identity.
 *
 * The banner at the top of this screen is the important part. When GODWeb's
 * read-only validation endpoint is not configured, GODID verification is
 * *unavailable* rather than assumed, and this screen says so and offers the one
 * alternative: a platform administrator vouching for the GODID by hand, with
 * their name and their stated evidence attached to the profile forever.
 *
 * When GODWeb *is* reachable, the manual path is refused by the API — once the
 * authority can be asked, it must be asked. The screen reflects that by hiding
 * the button rather than letting somebody discover the refusal.
 *
 * Nothing here creates a GODWeb account. Saarthi has no code path that can.
 */
export function AdminSalesmenPage(): React.ReactElement {
  const { can } = useAuth();
  const { godWebVerificationAvailable } = useSalesProfile();

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [creating, setCreating] = React.useState(false);
  const [verifying, setVerifying] = React.useState<SalesmanProfileView | null>(null);

  const queryClient = useQueryClient();

  const salesmen = useQuery({
    queryKey: ['/sales/salesmen', page, search, status],
    queryFn: () =>
      api.get<Paginated<SalesmanProfileView>>('/sales/salesmen', {
        page,
        pageSize: 20,
        ...(search ? { search } : {}),
        ...(status !== 'all' ? { status } : {}),
      }),
    enabled: can(Permission.SALESMAN_MANAGE),
    placeholderData: keepPreviousData,
  });

  const verifyWithGodWeb = useMutation({
    mutationFn: (id: string) => api.post<SalesmanProfileView>(`/sales/salesmen/${id}/verify`),
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/salesmen'] });
      toast.success(
        profile.status === SalesmanStatus.ACTIVE
          ? 'GODWeb confirmed this GODID.'
          : SALESMAN_STATUS_LABEL[profile.status],
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!can(Permission.SALESMAN_MANAGE)) return <UnauthorizedState />;

  const columns: Column<SalesmanProfileView>[] = [
    {
      key: 'person',
      header: 'Salesperson',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name ?? 'Name not supplied'}</p>
          <p className="truncate text-xs text-muted-foreground">
            <code>{row.godId}</code>
            {row.externalSalespersonId ? ` · ${row.externalSalespersonId}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Standing',
      cell: (row) => (
        <div className="space-y-1">
          <StatusBadge status={row.status} />
          {row.verificationMethod === SalesmanVerificationMethod.PLATFORM_ADMIN ? (
            <Badge variant="warning" className="text-[10px]">
              Verified by hand
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Saarthi login',
      hideOnMobile: true,
      cell: (row) =>
        row.userId ? (
          <span className="text-sm text-muted-foreground">Linked</span>
        ) : (
          <span className="text-sm text-warning">Not linked</span>
        ),
    },
    {
      key: 'verified',
      header: 'Verified',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.verifiedAt ? formatDate(row.verifiedAt) : '—'}
        </span>
      ),
    },
    {
      key: 'checked',
      header: 'Last checked',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.lastCheckedAt ? relativeTimeFrom(row.lastCheckedAt) : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        row.canSell ? null : godWebVerificationAvailable ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => verifyWithGodWeb.mutate(row.id)}
            disabled={verifyWithGodWeb.isPending}
          >
            Verify with GODWeb
          </Button>
        ) : row.status === SalesmanStatus.REJECTED ? null : (
          <Button size="sm" variant="outline" onClick={() => setVerifying(row)}>
            Verify by hand
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform"
        title="Salespeople"
        description="Saarthi profiles for GODWeb identities. GODWeb owns who these people are."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add a GODID
          </Button>
        }
      />

      {godWebVerificationAvailable ? (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription className="text-xs">
            GODWeb validation is configured on this environment, so every GODID is confirmed
            against it. Verifying by hand is refused while that is true.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>GODWeb validation is not configured</AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            <p>
              Saarthi cannot ask GODWeb whether a GODID is real on this environment, so no profile
              can be verified automatically. Until <code>GODWEB_BASE_URL</code> and{' '}
              <code>GODWEB_API_KEY</code> are set, a profile stays pending: it issues no referral
              link and accrues no commission.
            </p>
            <p>
              You can vouch for a GODID by hand. Your user id and the evidence you cite are
              recorded on the profile and in the audit log permanently — this is an accountable
              decision, not a way round verification.
            </p>
          </AlertDescription>
        </Alert>
      )}

      <FilterBar>
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="GODID, name, email or staff id"
          className="sm:max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="Any standing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any standing</SelectItem>
            {Object.entries(SALESMAN_STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={salesmen.data?.items}
        rowKey={(row) => row.id}
        isLoading={salesmen.isLoading}
        error={salesmen.error}
        onRetry={() => void salesmen.refetch()}
        {...(salesmen.data?.pagination ? { pagination: salesmen.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle="No salesman profiles yet"
        emptyDescription="Add a GODWeb GODID to create the Saarthi profile that mirrors it."
      />

      <CreateSalesmanDialog open={creating} onOpenChange={setCreating} />
      <ManualVerifyDialog profile={verifying} onClose={() => setVerifying(null)} />
    </div>
  );
}

function CreateSalesmanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState({
    godId: '',
    name: '',
    phone: '',
    email: '',
    externalSalespersonId: '',
    territory: '',
    userId: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<SalesmanProfileView>('/sales/salesmen', {
        godId: form.godId,
        ...(form.name ? { name: form.name } : {}),
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.email ? { email: form.email } : {}),
        ...(form.externalSalespersonId
          ? { externalSalespersonId: form.externalSalespersonId }
          : {}),
        ...(form.territory ? { territory: form.territory } : {}),
        ...(form.userId ? { userId: form.userId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/salesmen'] });
      toast.success('Profile created. It stays pending until the GODID is verified.');
      onOpenChange(false);
      setForm({
        godId: '',
        name: '',
        phone: '',
        email: '',
        externalSalespersonId: '',
        territory: '',
        userId: '',
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a salesman profile</DialogTitle>
          <DialogDescription>
            For a GODID that already exists in GODWeb. This creates the Saarthi side only —
            Saarthi never creates a GODWeb account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="salesman-godid">GODID *</Label>
            <Input
              id="salesman-godid"
              value={form.godId}
              onChange={(event) => setForm({ ...form, godId: event.target.value })}
              placeholder="GOD-7F42K"
              autoCapitalize="characters"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-name">Name</Label>
            <Input
              id="salesman-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              GODWeb’s answer overwrites this once verification runs.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-staff">Staff id</Label>
            <Input
              id="salesman-staff"
              value={form.externalSalespersonId}
              onChange={(event) =>
                setForm({ ...form, externalSalespersonId: event.target.value })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-phone">Phone</Label>
            <Input
              id="salesman-phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-email">Email</Label>
            <Input
              id="salesman-email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              inputMode="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-territory">Territory</Label>
            <Input
              id="salesman-territory"
              value={form.territory}
              onChange={(event) => setForm({ ...form, territory: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-user">Saarthi user id</Label>
            <Input
              id="salesman-user"
              value={form.userId}
              onChange={(event) => setForm({ ...form, userId: event.target.value })}
              placeholder="Optional — link later"
            />
            <p className="text-xs text-muted-foreground">
              Linking a login also grants the SALESMAN role.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={form.godId.trim().length < 3 || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create profile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Vouch for a GODID by hand.
 *
 * The evidence field is required and is the reason the dialog exists: this
 * profile will be trusted for commission, and the only thing standing behind
 * it is the sentence typed here. It goes onto the profile and into an audit
 * action of its own — `salesman.verified_manually` — so a report can always
 * separate "GODWeb said yes" from "a named person said yes".
 */
function ManualVerifyDialog({
  profile,
  onClose,
}: {
  profile: SalesmanProfileView | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [evidence, setEvidence] = React.useState('');

  React.useEffect(() => setEvidence(''), [profile]);

  const verify = useMutation({
    mutationFn: () =>
      api.post<SalesmanProfileView>(`/sales/salesmen/${profile?.id}/verify-manually`, {
        evidence,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/sales/salesmen'] });
      toast.success('Profile verified. Your name is on the record.');
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={profile !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {profile?.godId} by hand</DialogTitle>
          <DialogDescription>
            Only because GODWeb cannot be asked on this environment. This profile will then be
            able to share a referral link and earn commission.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="verify-evidence">What did you check? *</Label>
          <Textarea
            id="verify-evidence"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            rows={3}
            placeholder="e.g. Confirmed against the GODWeb salesperson register with Priya Sharma (Sales Ops) on 11 Sep 2026; staff id EMP-2291 matches."
          />
          <p className="text-xs text-muted-foreground">
            Recorded on the profile and in the audit log permanently, with your user id.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => verify.mutate()}
            disabled={evidence.trim().length < 10 || verify.isPending}
          >
            {verify.isPending ? 'Verifying…' : 'Verify on my authority'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AdminSalesmenPage;
