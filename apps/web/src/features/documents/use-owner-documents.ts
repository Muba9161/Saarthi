import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  IdentityDocumentKind,
  Permission,
  identityKindForDocumentType,
  type DocumentOwnerType,
  type DriverVerificationChecklist,
  type VerificationSubjectType,
} from '@saarthi/shared';
import { absoluteApiUrl, api, errorMessage, getAccessToken } from '@/lib/api-client';
import type { DocumentSummary, IdentitySubjectView, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import type { IdentityVerifyTarget } from '@/features/verification/identity-verify-dialog';

/**
 * One owner's documents and what can be done with them — list, download,
 * subject-level review, and the per-document identity checks.
 *
 * Shared by the document panel (one list, any owner) and a vehicle's folder
 * view (the same documents, filed by type), so the two can never disagree
 * about what is on file or who may verify it.
 */

const SUBJECT_FOR_OWNER: Partial<Record<DocumentOwnerType, VerificationSubjectType>> = {
  TRUCK: 'TRUCK' as VerificationSubjectType,
  DRIVER: 'DRIVER' as VerificationSubjectType,
  ORGANIZATION: 'ORGANIZATION' as VerificationSubjectType,
  USER: 'USER' as VerificationSubjectType,
};

/**
 * Owners whose documents can carry an instant identity check.
 *
 * `USER` joined the other two when a Personal account holder gained an Aadhaar
 * check of their own. It is a different check from the driver's, against a
 * different subject, recorded in a different place — see `IDENTITY_KINDS` — and
 * clearing it says nothing about whether the person may drive.
 */
const IDENTITY_SUBJECTS = new Set<string>(['DRIVER', 'ORGANIZATION', 'USER']);

export interface Readiness {
  ready: boolean;
  missing: { documentType: string; label: string }[];
  invalid: { documentType: string; label: string; reason: string }[];
}

export function useOwnerDocuments({
  ownerType,
  ownerId,
  ownerLabel,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel?: string | undefined;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
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
      api.get<{
        case: { status: string } | null;
        readiness: Readiness;
        driverChecklist: DriverVerificationChecklist | null;
      }>(`/verification/subject/${String(subjectType).toLowerCase()}/${ownerId}`),
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
  const driverChecklist = verification.data?.driverChecklist ?? null;
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
      subjectType: String(subjectType) as 'DRIVER' | 'ORGANIZATION' | 'USER',
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

  /**
   * The prompt straight after upload. This is the "only ask once" half of the
   * flow: it opens by itself, and if it is dismissed the row keeps its Verify
   * button rather than the chance being lost.
   */
  const onUploaded = (document: DocumentSummary, alreadyVerified: boolean): void => {
    // Already settled in the form — asking again would be asking twice.
    if (alreadyVerified) return;
    if (!canVerifyIdentity) return;
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

  return {
    can,
    documents,
    subjectType,
    supportsIdentity,
    submit,
    download,
    readiness,
    caseStatus,
    driverChecklist,
    canVerifyIdentity,
    checkFor,
    openVerify,
    pendingIdentityCount,
    verifyTarget,
    setVerifyTarget,
    onUploaded,
  };
}
