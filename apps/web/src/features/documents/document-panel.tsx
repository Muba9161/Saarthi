import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Download, FileText, ShieldCheck, ShieldQuestion, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  DOCUMENT_TYPES,
  IdentityDocumentKind,
  Permission,
  identityFormatMessage,
  identityKindForDocumentType,
  isValidIdentityNumber,
  normalizeIdentityNumber,
  type DocumentOwnerType,
  type VerificationSubjectType,
} from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import type { DocumentSummary, IdentitySubjectView, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import {
  IdentityVerifyDialog,
  type IdentityVerifyTarget,
} from '@/features/verification/identity-verify-dialog';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SectionHeader } from '@/components/common/page-header';
import { FileDropzone, FilePreviewCard } from '@/components/common/file-dropzone';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
 *
 * Verification works on two levels here, and keeping them visibly apart is the
 * point of the layout:
 *
 *  * **Per document.** Aadhaar, PAN, Voter ID and the GST certificate carry a
 *    number a government source can confirm outright. Uploading one opens the
 *    verify prompt immediately; dismissing it leaves a Verify button on the row
 *    until the check has actually run. No row is ever left in a state where the
 *    next action is unclear.
 *  * **Per subject.** Once the mandatory documents are on file the whole
 *    driver / truck / business goes to a reviewer as one case. That is the
 *    banner at the top, and it is a different question from "is this number
 *    real" — which is why it no longer looks like the same button.
 */

const SUBJECT_FOR_OWNER: Partial<Record<DocumentOwnerType, VerificationSubjectType>> = {
  TRUCK: 'TRUCK' as VerificationSubjectType,
  DRIVER: 'DRIVER' as VerificationSubjectType,
  ORGANIZATION: 'ORGANIZATION' as VerificationSubjectType,
  USER: 'USER' as VerificationSubjectType,
};

/** Owners whose documents can carry an instant identity check. */
const IDENTITY_SUBJECTS = new Set<string>(['DRIVER', 'ORGANIZATION']);

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
  const [verifyTarget, setVerifyTarget] = React.useState<IdentityVerifyTarget | null>(null);

  const documents = useQuery({
    queryKey: ['documents', ownerType, ownerId],
    queryFn: () =>
      api.get<Paginated<DocumentSummary>>(`/documents/owner/${ownerType.toLowerCase()}/${ownerId}`, {
        pageSize: 50,
      }),
    enabled: Boolean(ownerId),
  });

  const subjectType = SUBJECT_FOR_OWNER[ownerType];
  const supportsIdentity = Boolean(subjectType && IDENTITY_SUBJECTS.has(String(subjectType)));

  const verification = useQuery({
    queryKey: ['verification', 'subject', subjectType, ownerId],
    queryFn: () =>
      api.get<{ case: { status: string } | null; readiness: Readiness }>(
        `/verification/subject/${String(subjectType).toLowerCase()}/${ownerId}`,
      ),
    enabled: Boolean(subjectType && ownerId) && can(Permission.VERIFICATION_READ),
  });

  // Which numbers have already been confirmed. Free to read — no provider call
  // — so the rows know whether to show a badge or a button as soon as they render.
  const identity = useQuery({
    queryKey: ['identity', 'subject', subjectType, ownerId],
    queryFn: () =>
      api.get<IdentitySubjectView>(
        `/identity/subject/${String(subjectType).toLowerCase()}/${ownerId}`,
      ),
    enabled: supportsIdentity && Boolean(ownerId) && can(Permission.VERIFICATION_READ),
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
  const identityChecks = identity.data?.checks ?? [];
  const onlineVerificationAvailable = identity.data?.onlineVerificationAvailable ?? false;
  const canVerifyIdentity = can(Permission.IDENTITY_VERIFY) && onlineVerificationAvailable;

  /** The stored check for a document row, matched on its document type. */
  const checkFor = (documentType: string) =>
    identityChecks.find((entry) => entry.documentType === documentType)?.verification ?? null;

  /**
   * Open the verify prompt for one document row.
   *
   * The number is taken from what was typed at upload, which is why the upload
   * form insists on it for these types — a scan with no number attached cannot
   * be verified, only looked at.
   */
  const openVerify = (document: DocumentSummary): void => {
    const definition = identityKindForDocumentType(document.documentType);
    if (!definition || !subjectType) return;

    setVerifyTarget({
      kind: definition.kind,
      subjectType: String(subjectType) as 'DRIVER' | 'ORGANIZATION',
      subjectId: ownerId,
      documentId: document.id,
      initialNumber: document.documentNumber ?? undefined,
      initialHolderName: definition.kind === IdentityDocumentKind.PAN ? ownerLabel : undefined,
    });
  };

  const pendingIdentityCount = (documents.data?.items ?? []).filter(
    (document) =>
      identityKindForDocumentType(document.documentType) !== undefined &&
      checkFor(document.documentType)?.outcome !== 'VERIFIED',
  ).length;

  return (
    <div className="space-y-4">
      {/*
        Subject-level verification. Deliberately worded as a review of the whole
        record rather than of any one number, so it no longer reads as a second,
        competing "verify" for the same thing.
      */}
      {readiness && subjectType ? (
        readiness.ready && caseStatus !== 'VERIFIED' ? (
          <Alert variant="info">
            <ShieldCheck className="size-4" />
            <AlertTitle>Ready to send for review</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>All mandatory documents are present and valid.</span>
              {can(Permission.VERIFICATION_SUBMIT) && caseStatus !== 'SUBMITTED' && caseStatus !== 'UNDER_REVIEW' ? (
                <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate()}>
                  Send for review
                </Button>
              ) : caseStatus ? (
                <StatusBadge status={caseStatus} size="sm" />
              ) : null}
            </AlertDescription>
          </Alert>
        ) : !readiness.ready ? (
          <Alert variant="warning">
            <ShieldCheck className="size-4" />
            <AlertTitle>Not ready for review yet</AlertTitle>
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

      {/*
        Instant checks still outstanding. One line, only when there is something
        to do, with the count — so the operator knows the Verify buttons below
        are waiting on them rather than on a queue somewhere.
      */}
      {canVerifyIdentity && pendingIdentityCount > 0 ? (
        <Alert variant="warning">
          <ShieldQuestion className="size-4" />
          <AlertTitle>
            {pendingIdentityCount} document{pendingIdentityCount === 1 ? '' : 's'} can be verified
            instantly
          </AlertTitle>
          <AlertDescription>
            Use the <span className="font-medium">Verify</span> button on the row. The number is
            checked against the issuing authority and takes a few seconds — no reviewer needed.
          </AlertDescription>
        </Alert>
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
                <DocumentRow
                  key={document.id}
                  document={document}
                  check={checkFor(document.documentType)}
                  canVerify={canVerifyIdentity}
                  onVerify={() => openVerify(document)}
                  onDownload={download}
                />
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
        ownerLabel={ownerLabel}
        // The prompt straight after upload. This is the "only ask once" half of
        // the flow: it opens by itself, and if it is dismissed the row keeps its
        // Verify button rather than the chance being lost.
        onUploaded={(document) => {
          if (!canVerifyIdentity) return;
          const definition = identityKindForDocumentType(document.documentType);
          if (!definition || !subjectType) return;
          setVerifyTarget({
            kind: definition.kind,
            subjectType: String(subjectType) as 'DRIVER' | 'ORGANIZATION',
            subjectId: ownerId,
            documentId: document.id,
            initialNumber: document.documentNumber ?? undefined,
            initialHolderName:
              definition.kind === IdentityDocumentKind.PAN ? ownerLabel : undefined,
          });
        }}
      />

      <IdentityVerifyDialog
        target={verifyTarget}
        open={verifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVerifyTarget(null);
        }}
      />
    </div>
  );
}

/**
 * One document row.
 *
 * The verify affordance sits in front of the download controls rather than
 * among them, because it is the *action* on the row while those are utilities.
 * A verified row shows what verified it, so nobody has to guess whether the
 * green tick means "a reviewer looked at the scan" or "the government confirmed
 * the number".
 */
function DocumentRow({
  document,
  check,
  canVerify,
  onVerify,
  onDownload,
}: {
  document: DocumentSummary;
  check: { outcome: string; maskedNumber: string; reason: string | null } | null;
  canVerify: boolean;
  onVerify: () => void;
  onDownload: (document: DocumentSummary, inline: boolean) => void;
}) {
  const definition = identityKindForDocumentType(document.documentType);
  const verifiable = definition !== undefined;
  const verified = check?.outcome === 'VERIFIED';

  // A number that is present but malformed is worth saying so before the
  // operator presses Verify and waits for a round trip to tell them.
  const numberInvalid =
    verifiable &&
    Boolean(document.documentNumber) &&
    !isValidIdentityNumber(
      definition.kind,
      normalizeIdentityNumber(document.documentNumber ?? ''),
    );

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 truncate text-sm font-medium">
          {document.documentTypeLabel}
          {verified ? (
            <Badge variant="success" size="sm" className="gap-1">
              <BadgeCheck className="size-3" />
              Govt. verified
            </Badge>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {verified && check ? `${check.maskedNumber} · ` : document.documentNumber ? `${document.documentNumber} · ` : ''}
          {document.expiryDate
            ? `Expires ${new Date(document.expiryDate).toLocaleDateString('en-IN')}`
            : 'No expiry'}
          {document.currentVersion > 1 ? ` · v${document.currentVersion}` : ''}
        </p>
        {document.rejectionReason ? (
          <p className="mt-0.5 text-xs text-destructive">{document.rejectionReason}</p>
        ) : check && !verified && check.reason ? (
          <p className="mt-0.5 text-xs text-warning">{check.reason}</p>
        ) : null}
        {numberInvalid ? (
          <p className="mt-0.5 text-xs text-destructive">
            {identityFormatMessage(definition.kind)}
          </p>
        ) : null}
        {verifiable && !verified && !document.documentNumber ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Add the number to verify this instantly.
          </p>
        ) : null}
      </div>

      <StatusBadge status={document.validity} size="sm" />

      {/* In front of the utilities: the row's action, not another icon. */}
      {verifiable && !verified && canVerify ? (
        <Button size="sm" variant="outline" onClick={onVerify}>
          <ShieldCheck className="size-4" />
          Verify
        </Button>
      ) : null}

      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onDownload(document, true)}
          aria-label={`Preview ${document.documentTypeLabel}`}
        >
          <FileText className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onDownload(document, false)}
          aria-label={`Download ${document.documentTypeLabel}`}
        >
          <Download className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  ownerType,
  ownerId,
  ownerLabel,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel?: string | undefined;
  onUploaded?: (document: DocumentSummary) => void;
}) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = React.useState('');
  const [documentNumber, setDocumentNumber] = React.useState('');
  const [issueDate, setIssueDate] = React.useState('');
  const [expiryDate, setExpiryDate] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);

  const types = DOCUMENT_TYPES.filter((definition) => definition.ownerType === ownerType);
  const definition = types.find((entry) => entry.code === documentType);
  const identityKind = definition ? identityKindForDocumentType(definition.code) : undefined;

  const normalizedNumber = identityKind ? normalizeIdentityNumber(documentNumber) : documentNumber;
  const numberValid = identityKind
    ? normalizedNumber.length > 0 && isValidIdentityNumber(identityKind.kind, normalizedNumber)
    : true;
  const showNumberError = Boolean(identityKind) && normalizedNumber.length >= 6 && !numberValid;

  const reset = (): void => {
    setDocumentType('');
    setDocumentNumber('');
    setIssueDate('');
    setExpiryDate('');
    setFile(null);
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file to upload.');
      const body = new FormData();
      body.append('ownerType', ownerType);
      body.append('ownerId', ownerId);
      body.append('documentType', documentType);
      // Normalised for a verifiable type, so the number stored on the document
      // is the same string the check will be run against.
      if (documentNumber) body.append('documentNumber', normalizedNumber);
      if (issueDate) body.append('issueDate', issueDate);
      if (expiryDate) body.append('expiryDate', expiryDate);
      body.append('file', file);
      return api.post<DocumentSummary>('/documents', body);
    },
    onSuccess: (document) => {
      toast.success('Document uploaded', {
        description: identityKind
          ? 'Verify the number now to skip the review queue.'
          : 'It is now awaiting verification.',
      });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      void queryClient.invalidateQueries({ queryKey: ['identity'] });
      onOpenChange(false);
      reset();
      // Handed back so the panel can open the verify prompt straight away.
      onUploaded?.(document);
    },
    onError: (error) => toast.error('Upload failed', { description: errorMessage(error) }),
  });

  const canSubmit = Boolean(
    documentType &&
      file &&
      (!definition?.requiresExpiry || expiryDate) &&
      // A verifiable document with no number, or a malformed one, cannot be
      // checked — so it is required here rather than discovered later.
      (!identityKind || numberValid),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
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
                    {type.verifiableAs ? ' · verifiable' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {definition ? (
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label required={Boolean(identityKind)}>
              {identityKind ? `${identityKind.label} number` : 'Document number'}
            </Label>
            <Input
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder={identityKind?.placeholder ?? 'Optional reference on the document'}
              autoComplete="off"
              spellCheck={false}
              className={identityKind ? 'font-mono tracking-wide' : undefined}
              aria-invalid={showNumberError}
            />
            {identityKind ? (
              <p className={showNumberError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {showNumberError
                  ? identityFormatMessage(identityKind.kind)
                  : `${identityKind.formatHint} Required — it is what gets verified.`}
              </p>
            ) : null}
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
            {file ? (
              <FilePreviewCard
                file={file}
                onRemove={() => setFile(null)}
                disabled={upload.isPending}
              />
            ) : (
              <FileDropzone
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                maxSizeMb={10}
                disabled={upload.isPending}
                onFiles={(files) => setFile(files[0] ?? null)}
                onReject={(reason) => toast.error(reason)}
                title="Drag the document here, or click to browse"
                hint="PDF, JPEG, PNG, WebP or HEIC · up to 10 MB"
              />
            )}
          </div>

          {identityKind ? (
            <Alert variant="info">
              <ShieldCheck className="size-4" />
              <AlertTitle>Verified as soon as you upload</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                {ownerLabel ? `${ownerLabel}'s ` : 'This '}
                {identityKind.shortLabel} is checked against the issuing authority the moment this
                is saved. If you skip it, a Verify button stays on the row.
              </AlertDescription>
            </Alert>
          ) : null}
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
