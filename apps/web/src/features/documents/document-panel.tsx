import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  DOCUMENT_TYPES,
  Permission,
  type DocumentOwnerType,
  type VerificationSubjectType,
} from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import type { DocumentSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SectionHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Documents for one owner (truck, driver, organization…), with upload,
 * download and the verification-readiness summary in one panel. Reused by the
 * truck, driver and account screens.
 */

const SUBJECT_FOR_OWNER: Partial<Record<DocumentOwnerType, VerificationSubjectType>> = {
  TRUCK: 'TRUCK' as VerificationSubjectType,
  DRIVER: 'DRIVER' as VerificationSubjectType,
  ORGANIZATION: 'ORGANIZATION' as VerificationSubjectType,
  USER: 'USER' as VerificationSubjectType,
};

interface Readiness {
  ready: boolean;
  missing: { documentType: string; label: string }[];
  invalid: { documentType: string; label: string; reason: string }[];
}

export function DocumentPanel({
  ownerType,
  ownerId,
  ownerLabel,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel?: string;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const documents = useQuery({
    queryKey: ['documents', ownerType, ownerId],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>(`/documents/owner/${ownerType.toLowerCase()}/${ownerId}`, {
        pageSize: 50,
      }),
    enabled: Boolean(ownerId),
  });

  const subjectType = SUBJECT_FOR_OWNER[ownerType];

  const verification = useQuery({
    queryKey: ['verification', 'subject', subjectType, ownerId],
    queryFn: () =>
      api.get<{ case: { status: string } | null; readiness: Readiness }>(
        `/verification/subject/${String(subjectType).toLowerCase()}/${ownerId}`,
      ),
    enabled: Boolean(subjectType && ownerId) && can(Permission.VERIFICATION_READ),
  });

  const submit = useMutation({
    mutationFn: () => api.post('/verification', { subjectType, subjectId: ownerId }),
    onSuccess: () => {
      toast.success('Submitted for verification', {
        description: 'The Saarthi operations team will review it shortly.',
      });
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      void queryClient.invalidateQueries({ queryKey: ['truck'] });
      // The vehicle detail screen keys off 'vehicle' — a goods vehicle and a
      // taxi are the same row, so both caches are refreshed.
      void queryClient.invalidateQueries({ queryKey: ['vehicle'] });
      void queryClient.invalidateQueries({ queryKey: ['driver'] });
    },
    onError: (error) =>
      toast.error('Cannot submit yet', { description: errorMessage(error) }),
  });

  const download = (document: DocumentSummary, inline: boolean): void => {
    // The document route is authenticated, so the token travels with the fetch
    // rather than sitting in a URL the browser would keep in history.
    void (async () => {
      try {
        const response = await fetch(
          absoluteApiUrl(`/documents/${document.id}/download${inline ? '?disposition=inline' : ''}`),
          {
            credentials: 'include',
            headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
          },
        );
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (inline) {
          window.open(url, '_blank', 'noopener');
        } else {
          const anchor = window.document.createElement('a');
          anchor.href = url;
          anchor.download = document.fileName;
          anchor.click();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } catch {
        toast.error('Could not open the document');
      }
    })();
  };

  const readiness = verification.data?.readiness;
  const caseStatus = verification.data?.case?.status;

  return (
    <div className="space-y-4">
      {readiness && subjectType ? (
        readiness.ready && caseStatus !== 'VERIFIED' ? (
          <Alert variant="info">
            <ShieldCheck className="size-4" />
            <AlertTitle>Ready for verification</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>All mandatory documents are present and valid.</span>
              {can(Permission.VERIFICATION_SUBMIT) && caseStatus !== 'SUBMITTED' && caseStatus !== 'UNDER_REVIEW' ? (
                <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate()}>
                  Submit for verification
                </Button>
              ) : caseStatus ? (
                <StatusBadge status={caseStatus} size="sm" />
              ) : null}
            </AlertDescription>
          </Alert>
        ) : !readiness.ready ? (
          <Alert variant="warning">
            <ShieldCheck className="size-4" />
            <AlertTitle>Not ready for verification</AlertTitle>
            <AlertDescription className="space-y-1.5">
              {readiness.missing.length > 0 ? (
                <p>Missing: {readiness.missing.map((entry) => entry.label).join(', ')}.</p>
              ) : null}
              {readiness.invalid.map((entry) => (
                <p key={entry.documentType}>
                  {entry.label}: {entry.reason}
                </p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <SectionHeader
            title="Documents"
            description={ownerLabel ? `Attached to ${ownerLabel}` : undefined}
            actions={
              can(Permission.DOCUMENTS_UPLOAD) ? (
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  Upload
                </Button>
              ) : null
            }
          />
        </CardHeader>
        <CardContent className="pt-0">
          {documents.isLoading ? (
            <LoadingState label="Loading documents…" />
          ) : documents.error ? (
            <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
          ) : (documents.data?.items ?? []).length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents uploaded"
              description="Upload the mandatory documents to start verification."
              className="min-h-40 border-0"
              action={
                can(Permission.DOCUMENTS_UPLOAD) ? (
                  <Button size="sm" onClick={() => setUploadOpen(true)}>
                    <Upload className="size-4" />
                    Upload a document
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {(documents.data?.items ?? []).map((document) => (
                <li key={document.id} className="flex flex-wrap items-center gap-3 py-3">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{document.documentTypeLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {document.documentNumber ? `${document.documentNumber} · ` : ''}
                      {document.expiryDate
                        ? `Expires ${new Date(document.expiryDate).toLocaleDateString('en-IN')}`
                        : 'No expiry'}
                      {document.currentVersion > 1 ? ` · v${document.currentVersion}` : ''}
                    </p>
                    {document.rejectionReason ? (
                      <p className="mt-0.5 text-xs text-destructive">{document.rejectionReason}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={document.validity} size="sm" />
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => download(document, true)}
                      aria-label={`Preview ${document.documentTypeLabel}`}
                    >
                      <FileText className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => download(document, false)}
                      aria-label={`Download ${document.documentTypeLabel}`}
                    >
                      <Download className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        ownerType={ownerType}
        ownerId={ownerId}
      />
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  ownerType,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerType: DocumentOwnerType;
  ownerId: string;
}) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = React.useState('');
  const [documentNumber, setDocumentNumber] = React.useState('');
  const [issueDate, setIssueDate] = React.useState('');
  const [expiryDate, setExpiryDate] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);

  const types = DOCUMENT_TYPES.filter((definition) => definition.ownerType === ownerType);
  const definition = types.find((entry) => entry.code === documentType);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file to upload.');
      const body = new FormData();
      body.append('ownerType', ownerType);
      body.append('ownerId', ownerId);
      body.append('documentType', documentType);
      if (documentNumber) body.append('documentNumber', documentNumber);
      if (issueDate) body.append('issueDate', issueDate);
      if (expiryDate) body.append('expiryDate', expiryDate);
      body.append('file', file);
      return api.post<DocumentSummary>('/documents', body);
    },
    onSuccess: () => {
      toast.success('Document uploaded', { description: 'It is now awaiting verification.' });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      onOpenChange(false);
      setDocumentType('');
      setDocumentNumber('');
      setIssueDate('');
      setExpiryDate('');
      setFile(null);
    },
    onError: (error) => toast.error('Upload failed', { description: errorMessage(error) }),
  });

  const canSubmit = Boolean(documentType && file && (!definition?.requiresExpiry || expiryDate));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
          <DialogDescription>
            PDF, JPEG, PNG, WebP or HEIC, up to 10 MB. Re-uploading the same type creates a new
            version and returns it to review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label required>Document type</Label>
            <Select value={documentType} onValueChange={setDocumentType}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {types.map((type) => (
                  <SelectItem key={type.code} value={type.code}>
                    {type.label}
                    {type.mandatory ? ' (required)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {definition ? (
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Document number</Label>
            <Input
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder="Optional reference on the document"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Issue date</Label>
              <Input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label required={definition?.requiresExpiry}>Expiry date</Label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label required>File</Label>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} loading={upload.isPending} onClick={() => upload.mutate()}>
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
