import * as React from 'react';
import { ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  DOCUMENT_TYPES,
  DocumentOwnerType,
  Permission,
  humanizeEnum,
  isRetiredDocumentType,
} from '@saarthi/shared';
import type { DocumentSummary } from '@/lib/api-types';
import { ErrorState, LoadingState } from '@/components/common/states';
import { StatusBadge } from '@/components/common/status-badge';
import { FileDropzone } from '@/components/common/file-dropzone';
import { Button } from '@/components/ui/button';
import { DocumentRow } from '@/features/documents/document-row';
import { UploadDialog } from '@/features/documents/document-upload-dialog';
import { useOwnerDocuments } from '@/features/documents/use-owner-documents';
import { IdentityVerifyDialog } from '@/features/verification/identity-verify-dialog';
import { SubjectQrPanel } from '@/features/qr/subject-qr-panel';
import { cn } from '@/lib/utils';
import { VehiclePhotosPanel } from './vehicle-photos';
import { EmptyRows, Panel, PanelHeader } from './panel';

/**
 * The Documents tab: one folder per vehicle paper, plus the photographs and the
 * QR sticker — so every file has an obvious home and uploading starts from the
 * folder it belongs in rather than from a type picker.
 *
 * The documents themselves are the owner's documents as the document panel
 * reads them (`useOwnerDocuments`); this only files them by type.
 */

/** Folder ids beyond the document types. */
export const DOCUMENT_FOLDERS = { photos: 'photos', qr: 'qr', other: 'other' } as const;

const PAPER_COLOUR = 'hsl(var(--primary))';
const FOLDER_COLOURS = {
  [DOCUMENT_FOLDERS.photos]: '#1F9D8B',
  [DOCUMENT_FOLDERS.qr]: '#5B6170',
  [DOCUMENT_FOLDERS.other]: '#8A8F9C',
};

/** Shorter names than the catalogue's, sized for a folder. */
const FOLDER_NAMES: Record<string, string> = {
  REGISTRATION_CERTIFICATE: 'Registration (RC)',
  POLLUTION_CERTIFICATE: 'Pollution (PUC)',
  ROAD_TAX: 'Road tax',
};

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic';
const MAX_SIZE_MB = 10;

type Tag = { label: string; tone: 'warning' | 'muted' | 'success' | 'destructive' | 'info' };

const TAG_TONES: Record<Tag['tone'], string> = {
  warning: 'bg-warning/[0.13] text-warning',
  muted: 'bg-foreground/[0.05] text-muted-foreground',
  success: 'bg-success/[0.12] text-success',
  destructive: 'bg-destructive/[0.12] text-destructive',
  info: 'bg-info/[0.12] text-info',
};

/** The one word that says how a folder stands. */
function folderTag(documents: DocumentSummary[], mandatory: boolean): Tag {
  const latest = documents[0];
  if (!latest) return mandatory ? { label: 'Missing', tone: 'warning' } : { label: 'Optional', tone: 'muted' };
  switch (latest.validity) {
    case 'VALID':
      return { label: 'Valid', tone: 'success' };
    case 'EXPIRING_SOON':
      return { label: 'Expiring', tone: 'warning' };
    case 'EXPIRED':
      return { label: 'Expired', tone: 'destructive' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'destructive' };
    default:
      return { label: humanizeEnum(latest.validity), tone: 'info' };
  }
}

function filesLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

/** A folder with a sheet of paper in it; opens on hover. */
function FolderArt({ small = false }: { small?: boolean }) {
  return (
    <span className={cn('vd-fold', small && 'vd-fold-sm')} aria-hidden>
      <span className="vd-fold-back" />
      <span className="vd-fold-paper" />
      <span className="vd-fold-front" />
    </span>
  );
}

function FolderTag({ tag }: { tag: Tag }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-[22px] items-center rounded-full px-2.5 text-[11px] font-semibold',
        TAG_TONES[tag.tone],
      )}
    >
      {tag.label}
    </span>
  );
}

interface Folder {
  id: string;
  name: string;
  description: string;
  meta: string;
  colour: string;
  tag: Tag | null;
  kind: 'paper' | 'photos' | 'qr' | 'other';
  documents: DocumentSummary[];
}

export function VehicleDocuments({
  vehicleId,
  registrationNumber,
  folder: openId,
  onFolderChange,
  canSeeQr,
  canLookupRegistration,
  onOpenVirtualRc,
}: {
  vehicleId: string;
  registrationNumber: string;
  /** The open folder, or `null` for the grid. Controlled so the header menu can open one. */
  folder: string | null;
  onFolderChange: (folder: string | null) => void;
  canSeeQr: boolean;
  canLookupRegistration: boolean;
  onOpenVirtualRc: () => void;
}) {
  const owner = useOwnerDocuments({
    ownerType: DocumentOwnerType.TRUCK,
    ownerId: vehicleId,
    ownerLabel: registrationNumber,
  });
  const { can, documents, readiness, caseStatus, submit } = owner;
  const [upload, setUpload] = React.useState<{ type: string; file: File | null } | null>(null);

  // Vehicle documents are stored against the vehicle row, whose owner type is
  // TRUCK for every vehicle on the platform.
  const paperTypes = DOCUMENT_TYPES.filter(
    (definition) =>
      definition.ownerType === DocumentOwnerType.TRUCK && !isRetiredDocumentType(definition.code),
  );
  const items = documents.data?.items ?? [];
  const paperCodes = new Set(paperTypes.map((definition) => definition.code));
  const others = items.filter((document) => !paperCodes.has(document.documentType));

  const folders: Folder[] = [
    ...paperTypes.map((definition) => {
      const filed = items.filter((document) => document.documentType === definition.code);
      return {
        id: definition.code,
        name: FOLDER_NAMES[definition.code] ?? definition.label,
        description: definition.description,
        meta: filesLabel(filed.length),
        colour: PAPER_COLOUR,
        tag: folderTag(filed, definition.mandatory),
        kind: 'paper' as const,
        documents: filed,
      };
    }),
    {
      id: DOCUMENT_FOLDERS.photos,
      name: 'Photos',
      description: 'Exterior photographs and the 360° spin.',
      meta: 'Exterior · 360° spin',
      colour: FOLDER_COLOURS.photos,
      tag: null,
      kind: 'photos',
      documents: [],
    },
    ...(canSeeQr
      ? [
          {
            id: DOCUMENT_FOLDERS.qr,
            name: 'QR sticker',
            description: 'The code on the windscreen — a scan opens this vehicle.',
            meta: 'Print or download',
            colour: FOLDER_COLOURS.qr,
            tag: null,
            kind: 'qr' as const,
            documents: [],
          },
        ]
      : []),
    // Files of a type no longer offered (an old vehicle photograph, say) keep a
    // home rather than vanishing from the screen.
    ...(others.length > 0
      ? [
          {
            id: DOCUMENT_FOLDERS.other,
            name: 'Other files',
            description: 'Files of a type that is no longer offered. Kept as they were.',
            meta: filesLabel(others.length),
            colour: FOLDER_COLOURS.other,
            tag: null,
            kind: 'other' as const,
            documents: others,
          },
        ]
      : []),
  ];

  const required = paperTypes.filter((definition) => definition.mandatory);
  const requiredOnFile = required.filter((definition) =>
    items.some((document) => document.documentType === definition.code),
  ).length;
  const open = folders.find((entry) => entry.id === openId) ?? null;
  const canUpload = can(Permission.DOCUMENTS_UPLOAD);

  const reviewAction =
    readiness?.ready && caseStatus !== 'VERIFIED' ? (
      can(Permission.VERIFICATION_SUBMIT) &&
      caseStatus !== 'SUBMITTED' &&
      caseStatus !== 'UNDER_REVIEW' ? (
        <Button className="rounded-[12px]" loading={submit.isPending} onClick={() => submit.mutate()}>
          Send for review
        </Button>
      ) : caseStatus ? (
        <StatusBadge status={caseStatus} size="sm" />
      ) : null
    ) : null;

  const content = (() => {
    if (documents.isLoading) return <LoadingState label="Loading documents…" />;
    if (documents.error) {
      return <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />;
    }

    if (!open) {
      return (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Documents</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                One folder per paper — open a folder to add its files.
              </p>
              <div
                className="vd-meter mt-2"
                role="img"
                aria-label={`${requiredOnFile} of ${required.length} required papers on file`}
              >
                <span
                  className={cn(
                    'block h-full rounded-full',
                    requiredOnFile === required.length ? 'bg-success' : 'bg-warning',
                  )}
                  style={{
                    width: `${Math.max(3, (requiredOnFile / Math.max(1, required.length)) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {requiredOnFile} of {required.length} required papers on file
              </p>
              {readiness && !readiness.ready && readiness.invalid.length > 0 ? (
                <p className="mt-1 text-[13px] text-warning">
                  {readiness.invalid.map((entry) => `${entry.label}: ${entry.reason}`).join(' · ')}
                </p>
              ) : null}
            </div>
            {reviewAction}
          </div>

          <div className="vd-folders">
            {folders.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onFolderChange(entry.id)}
                aria-label={`Open ${entry.name} folder`}
                className="vd-panel vd-folder flex min-h-[150px] flex-col items-start gap-4 p-[18px] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary"
                style={{ '--fc': entry.colour } as React.CSSProperties}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <FolderArt />
                  {entry.tag ? <FolderTag tag={entry.tag} /> : null}
                </span>
                <span className="mt-auto">
                  <span className="block text-sm font-semibold">{entry.name}</span>
                  <span className="text-xs text-muted-foreground">{entry.meta}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-[18px]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            onClick={() => onFolderChange(null)}
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
          >
            <ChevronLeft className="size-4" />
            Documents
          </button>
          <span aria-hidden>/</span>
          <span className="font-semibold text-foreground">{open.name}</span>
        </nav>

        {open.kind === 'photos' ? (
          <VehiclePhotosPanel vehicleId={vehicleId} registrationNumber={registrationNumber} />
        ) : open.kind === 'qr' ? (
          <SubjectQrPanel subjectType="VEHICLE" subjectId={vehicleId} />
        ) : (
          <Panel aria-labelledby="folder-title">
            <PanelHeader
              id="folder-title"
              title={
                <span
                  className="flex items-start gap-3.5"
                  style={{ '--fc': open.colour } as React.CSSProperties}
                >
                  <FolderArt small />
                  {open.name}
                </span>
              }
              description={open.description}
              action={open.tag ? <FolderTag tag={open.tag} /> : null}
            />

            {open.kind === 'paper' && canUpload ? (
              <FileDropzone
                accept={ACCEPT}
                maxSizeMb={MAX_SIZE_MB}
                onFiles={(files) => setUpload({ type: open.id, file: files[0] ?? null })}
                onReject={(reason) => toast.error(reason)}
                title="Drop a PDF or photo here, or click to browse"
                hint="PDF, JPEG, PNG, WebP or HEIC · up to 10 MB · the dates are asked for next"
              />
            ) : null}

            <p className="mb-1 mt-5 text-sm font-semibold">Files</p>
            {open.documents.length === 0 ? (
              <EmptyRows
                title="No files in this folder yet"
                hint={canUpload ? 'Upload one, then send it for review.' : 'Nothing has been uploaded.'}
              />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {open.documents.map((document) => (
                  <DocumentRow
                    key={document.id}
                    document={document}
                    check={owner.checkFor(document.documentType)}
                    canVerify={owner.canVerifyIdentity}
                    onVerify={() => owner.openVerify(document)}
                    onDownload={owner.download}
                  />
                ))}
              </ul>
            )}

            {open.id === 'REGISTRATION_CERTIFICATE' && canLookupRegistration ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[14px] bg-foreground/[0.04] px-[18px] py-4 dark:bg-white/[0.05]">
                <div>
                  <p className="text-sm font-semibold">RTO record</p>
                  <p className="text-[13px] text-muted-foreground">
                    The record fetched from the RTO register — check it against your RC.
                  </p>
                </div>
                <Button variant="outline" className="rounded-[12px]" onClick={onOpenVirtualRc}>
                  Open Virtual RC
                </Button>
              </div>
            ) : null}
          </Panel>
        )}
      </div>
    );
  })();

  return (
    <div role="region" aria-label="Documents">
      {content}

      <UploadDialog
        open={upload !== null}
        onOpenChange={(next) => {
          if (!next) setUpload(null);
        }}
        ownerType={DocumentOwnerType.TRUCK}
        ownerId={vehicleId}
        ownerLabel={registrationNumber}
        canVerifyInline={owner.canVerifyIdentity}
        onUploaded={owner.onUploaded}
        presetType={upload?.type}
        initialFile={upload?.file}
      />

      <IdentityVerifyDialog
        target={owner.verifyTarget}
        open={owner.verifyTarget !== null}
        onOpenChange={(next) => {
          if (!next) owner.setVerifyTarget(null);
        }}
      />
    </div>
  );
}
