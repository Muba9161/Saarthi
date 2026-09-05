import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Permission, formatNumber, relativeTimeFrom } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Shipping a new Saarthi Terminal build to the fleet.
 *
 * A terminal is a tablet bolted into a cab that may be three states away, and
 * the person nearest it is driving. This page is how a build reaches it without
 * anybody visiting the truck: upload the APK, check what the binary says it is,
 * then publish — at which point terminals begin offering their drivers a button.
 *
 * Uploading and publishing are separate on purpose. Picking the wrong file in a
 * dialog must not be capable of changing what a thousand vehicles are running.
 */

interface TerminalRelease {
  id: string;
  versionCode: number;
  versionName: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  mandatory: boolean;
  notes: string | null;
  fileSize: number;
  sha256: string;
  minSdk: number;
  publishedAt: string | null;
  createdAt: string;
  terminalsOnThisVersion: number;
}

export function AdminTerminalReleasesPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [file, setFile] = React.useState<File | null>(null);
  const [notes, setNotes] = React.useState('');
  const [mandatory, setMandatory] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const releases = useQuery({
    queryKey: ['/terminal-releases'],
    queryFn: () => api.get<TerminalRelease[]>('/terminal-releases'),
    enabled: can(Permission.ADMIN_PLATFORM),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/terminal-releases'] });
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose an APK first.');
      const form = new FormData();
      form.append('apk', file);
      if (notes.trim()) form.append('notes', notes.trim());
      form.append('mandatory', String(mandatory));
      return api.post<{ versionName: string; versionCode: number }>('/terminal-releases', form);
    },
    onSuccess: (result) => {
      // The version comes back from the binary, not from anything typed here —
      // showing it is how the uploader confirms they picked the right file.
      toast.success(`Uploaded ${result.versionName} (build ${result.versionCode}) as a draft.`);
      setFile(null);
      setNotes('');
      setMandatory(false);
      if (fileInput.current) fileInput.current.value = '';
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/terminal-releases/${id}/publish`),
    onSuccess: () => {
      toast.success('Published. Terminals will offer this update at their next check.');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.post(`/terminal-releases/${id}/archive`),
    onSuccess: () => {
      toast.success('Withdrawn. Terminals already on it keep running it.');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!can(Permission.ADMIN_PLATFORM)) return <UnauthorizedState />;

  const columns: Column<TerminalRelease>[] = [
    {
      key: 'version',
      header: 'Version',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.versionName}</p>
          <p className="truncate text-xs text-muted-foreground">
            build {row.versionCode} · Android {row.minSdk}+
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'mandatory',
      header: 'Required',
      hideOnMobile: true,
      cell: (row) => (row.mandatory ? 'Yes' : '—'),
    },
    {
      key: 'fleet',
      header: 'Terminals on it',
      numeric: true,
      cell: (row) => formatNumber(row.terminalsOnThisVersion),
    },
    {
      key: 'size',
      header: 'Size',
      numeric: true,
      hideOnMobile: true,
      // Megabytes: nobody reasons about an APK in bytes, and the figure exists
      // so somebody can judge what it costs a truck on a metered SIM.
      cell: (row) => `${Math.round(row.fileSize / 1_000_000)} MB`,
    },
    {
      key: 'when',
      header: 'Published',
      hideOnMobile: true,
      cell: (row) =>
        row.publishedAt ? relativeTimeFrom(row.publishedAt) : `Uploaded ${relativeTimeFrom(row.createdAt)}`,
    },
    {
      key: 'actions',
      header: '',
      cell: (row) => (
        <div className="flex justify-end gap-2">
          {row.status !== 'PUBLISHED' && (
            <Button
              size="sm"
              onClick={() => publish.mutate(row.id)}
              disabled={publish.isPending}
            >
              Publish
            </Button>
          )}
          {row.status === 'PUBLISHED' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => archive.mutate(row.id)}
              disabled={archive.isPending}
            >
              Withdraw
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Terminal releases"
        description="Ship a new Saarthi Terminal build to fitted vehicles over the air."
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload a build</CardTitle>
          <CardDescription>
            The version, package and Android floor are read out of the APK itself — there is
            nothing to type. It arrives as a draft and reaches no vehicle until you publish it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apk">Release APK</Label>
            <input
              id="apk"
              ref={fileInput}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
            />
            <p className="text-xs text-muted-foreground">
              A release build, signed with the Saarthi keystore. A debug APK is refused: it
              carries the simulator and is signed with a throwaway key that no fitted terminal
              will accept.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">What changed</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Shown to the driver on the update card. One line is plenty."
              rows={2}
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="mandatory"
              checked={mandatory}
              onCheckedChange={(value) => setMandatory(value === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="mandatory" className="font-normal">
                Required update
              </Label>
              <p className="text-xs text-muted-foreground">
                Blocks the cockpit until installed. For a security or data-integrity fix only —
                a driver who cannot start a trip cannot earn.
              </p>
            </div>
          </div>

          <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload as draft'}
          </Button>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={releases.data}
        rowKey={(row) => row.id}
        isLoading={releases.isLoading}
        error={releases.error}
        onRetry={() => void releases.refetch()}
        emptyTitle="No builds uploaded yet"
      />
    </div>
  );
}

export default AdminTerminalReleasesPage;
