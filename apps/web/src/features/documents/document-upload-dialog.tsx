import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  DOCUMENT_TYPES,
  driverCheckForDocumentType,
  identityFormatMessage,
  identityKindForDocumentType,
  isValidIdentityNumber,
  normalizeIdentityNumber,
  type DocumentOwnerType,
  type ScannableNumberKind,
  type ScannedCard,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { DocumentSummary } from '@/lib/api-types';
import { InlineNumberVerify } from '@/features/verification/inline-number-verify';
import { isScannableImage, useCardScan } from '@/features/verification/scan-card';
import { ScanNumberButton, announceScan } from '@/features/verification/scan-number-button';
import { FileDropzone, FilePreviewCard } from '@/components/common/file-dropzone';
import { Button } from '@/components/ui/button';
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
 * Upload one document for an owner.
 *
 * `presetType` and `initialFile` let a caller that already knows both — a
 * vehicle's folder, where a file was dropped onto the Insurance folder — open
 * the dialog with them filled in, so only the number and dates are asked.
 */
export function UploadDialog({
  open,
  onOpenChange,
  ownerType,
  ownerId,
  ownerLabel,
  subjectType,
  canVerifyInline,
  onUploaded,
  presetType,
  initialFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel?: string | undefined;
  /** The verification subject these documents hang off, when there is one. */
  subjectType?: 'DRIVER' | 'ORGANIZATION' | undefined;
  /** False where the environment has no provider key, so nothing is offered. */
  canVerifyInline: boolean;
  onUploaded?: (document: DocumentSummary, alreadyVerified: boolean) => void;
  /** Open on this document type, fixed — the caller has already chosen it. */
  presetType?: string | undefined;
  /** A file the caller already has, e.g. dropped onto a folder. */
  initialFile?: File | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [documentType, setDocumentType] = React.useState('');
  const [documentNumber, setDocumentNumber] = React.useState('');
  const [issueDate, setIssueDate] = React.useState('');
  const [expiryDate, setExpiryDate] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  /**
   * Whether the number in the field has already been confirmed.
   *
   * Held here so the upload can say so, and so the automatic prompt that
   * normally follows an upload is not fired for a number that is already
   * settled — being asked to verify something you just verified is the kind of
   * detail that makes a flow feel broken.
   */
  const [numberVerified, setNumberVerified] = React.useState(false);

  const types = DOCUMENT_TYPES.filter((definition) => definition.ownerType === ownerType);
  const definition = types.find((entry) => entry.code === documentType);
  const identityKind = definition ? identityKindForDocumentType(definition.code) : undefined;
  /**
   * One of the four checks a driver must pass, if this is one of them.
   *
   * Wider than `identityKind`: it also covers the driving licence, which is
   * verified against the licensing authority rather than an identity source
   * but is just as much a number an authority can confirm.
   */
  const driverCheck = definition ? driverCheckForDocumentType(definition.code) : undefined;
  /** The number a photo of this document can be read for, if any. */
  const scanKind: ScannableNumberKind | undefined =
    identityKind?.kind ?? (driverCheck?.key === 'DRIVING_LICENCE' ? 'DRIVING_LICENCE' : undefined);
  const numberLabel = identityKind?.label ?? driverCheck?.label ?? 'Document';
  const { scan: scanCard, reading: readingCard } = useCardScan(scanKind);
  /** The file the form holds now, so a read that finishes late only fills its own form. */
  const chosenFile = React.useRef<File | null>(null);

  /**
   * Fill the number and dates from a scanned card. A scan the person asked for
   * replaces what is there; the one that runs by itself when a photo is chosen
   * only fills what is still empty.
   */
  const fillFromCard = (card: ScannedCard, replace: boolean): void => {
    const fill = (scanned: string | undefined) => (current: string) =>
      scanned && (replace || !current.trim()) ? scanned : current;
    setDocumentNumber(fill(card.number));
    setIssueDate(fill(card.issueDate));
    setExpiryDate(fill(card.expiryDate));
  };

  /**
   * A photo of the card chosen as the file doubles as the scan: with the
   * number still empty, it is read on this device and the form filled in, so
   * the person photographs the card once and is done. Nothing typed is ever
   * overwritten.
   */
  const chooseFile = async (chosen: File | null): Promise<void> => {
    setFile(chosen);
    chosenFile.current = chosen;
    if (!scanKind || documentNumber.trim() || !isScannableImage(chosen)) return;
    const result = await scanCard(chosen);
    // Removed, replaced, or the dialog closed while it was being read.
    if (chosenFile.current !== chosen) return;
    if (result.status === 'found') fillFromCard(result.card, false);
    announceScan(result, numberLabel);
  };

  /*
   * Seed the presets each time the dialog opens. Read through a ref so a
   * caller re-rendering with a new File object does not re-seed a form the
   * user has started editing.
   */
  const presets = React.useRef({ presetType, initialFile, chooseFile });
  presets.current = { presetType, initialFile, chooseFile };
  React.useEffect(() => {
    if (!open) return;
    const seed = presets.current;
    if (seed.presetType) setDocumentType(seed.presetType);
    if (seed.initialFile) void seed.chooseFile(seed.initialFile);
  }, [open]);

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
    chosenFile.current = null;
    setNumberVerified(false);
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
      const verifiedFirst = numberVerified;
      toast.success('Document uploaded', {
        description: verifiedFirst
          ? 'The number on it was already confirmed with the issuing authority.'
          : driverCheck
            ? 'Verify the number now to skip the review queue.'
            : 'It is now awaiting verification.',
      });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['verification'] });
      void queryClient.invalidateQueries({ queryKey: ['identity'] });
      onOpenChange(false);
      reset();
      // Handed back so the panel can open the verify prompt straight away —
      // unless the number was confirmed in the form, in which case there is
      // nothing left to ask.
      onUploaded?.(document, verifiedFirst);
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
            <Select
              value={documentType}
              onValueChange={setDocumentType}
              disabled={Boolean(presetType)}
            >
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
            <div className="flex items-center justify-between gap-3">
              <Label required={Boolean(identityKind)}>
                {identityKind ? `${identityKind.label} number` : 'Document number'}
              </Label>
              {scanKind ? (
                <ScanNumberButton
                  kind={scanKind}
                  label={numberLabel}
                  onScan={(card) => fillFromCard(card, true)}
                />
              ) : null}
            </div>
            <Input
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              placeholder={identityKind?.placeholder ?? 'Optional reference on the document'}
              autoComplete="off"
              spellCheck={false}
              className={identityKind ? 'font-mono tracking-wide' : undefined}
              aria-invalid={showNumberError}
              disabled={readingCard}
            />
            {readingCard ? (
              <p className="text-xs text-muted-foreground" role="status">
                Reading the number from your photo…
              </p>
            ) : null}
            {identityKind ? (
              <p className={showNumberError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {showNumberError
                  ? identityFormatMessage(identityKind.kind)
                  : `${identityKind.formatHint} Required - it is what gets verified.`}
              </p>
            ) : null}

            {/*
              Verify, right under the number it verifies.
              Offered for the four documents whose number an authority can
              confirm, so the answer arrives while the card is still in hand
              rather than after the file has been filed away.
            */}
            {driverCheck && subjectType && canVerifyInline ? (
              <div className="pt-1">
                <InlineNumberVerify
                  documentType={documentType}
                  subjectType={subjectType}
                  subjectId={ownerId}
                  number={documentNumber}
                  holderName={ownerLabel}
                  onOutcome={(outcome) => setNumberVerified(outcome.verified)}
                />
              </div>
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
                onRemove={() => void chooseFile(null)}
                disabled={upload.isPending}
              />
            ) : (
              <FileDropzone
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                maxSizeMb={10}
                disabled={upload.isPending}
                onFiles={(files) => void chooseFile(files[0] ?? null)}
                onReject={(reason) => toast.error(reason)}
                title="Drag the document here, or click to browse"
                hint="PDF, JPEG, PNG, WebP or HEIC · up to 10 MB"
              />
            )}
          </div>

          {driverCheck && !numberVerified ? (
            <Alert variant="info">
              <ShieldCheck className="size-4" />
              <AlertTitle>One of the four checks a driver must pass</AlertTitle>
              <AlertDescription className="text-xs leading-relaxed">
                {driverCheck.label} is one of four - with the driving licence, Aadhaar, PAN and
                Voter ID - that each have to be confirmed by their own authority before
                {ownerLabel ? ` ${ownerLabel}` : ' this driver'} counts as verified. Verify it above
                now, or from the row afterwards.
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
