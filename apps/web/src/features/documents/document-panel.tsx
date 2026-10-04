import * as React from 'react';
import { BadgeCheck, FileText, ShieldCheck, ShieldQuestion, Upload } from 'lucide-react';
import {
  Permission,
  type DocumentOwnerType,
  type DriverVerificationChecklist,
} from '@saarthi/shared';
import { IdentityVerifyDialog } from '@/features/verification/identity-verify-dialog';
import { StatusBadge } from '@/components/common/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';
import { SectionHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DocumentRow } from './document-row';
import { UploadDialog } from './document-upload-dialog';
import { useOwnerDocuments } from './use-owner-documents';

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

export function DocumentPanel({
  ownerType,
  ownerId,
  ownerLabel,
}: {
  ownerType: DocumentOwnerType;
  ownerId: string;
  ownerLabel?: string;
}) {
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const {
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
  } = useOwnerDocuments({ ownerType, ownerId, ownerLabel });

  return (
    <div className="space-y-4">
      {/*
        The four checks, first — because for a driver this is the question that
        decides their status, and every other panel here is subordinate to it.
      */}
      {driverChecklist ? (
        <DriverChecklistCard checklist={driverChecklist} canVerify={canVerifyIdentity} />
      ) : null}

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
            checked against the issuing authority and takes a few seconds - no reviewer needed.
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
        subjectType={
          supportsIdentity ? (String(subjectType) as 'DRIVER' | 'ORGANIZATION') : undefined
        }
        canVerifyInline={canVerifyIdentity}
        onUploaded={onUploaded}
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
 * The four checks that decide whether a driver is verified.
 *
 * Shown as a list rather than a percentage because the useful information is
 * *which* check is outstanding — that is what tells somebody which card to go
 * and find. Each outstanding row carries what to do about it, so nobody has to
 * infer the next step from a red dot.
 */
function DriverChecklistCard({
  checklist,
  canVerify,
}: {
  checklist: DriverVerificationChecklist;
  canVerify: boolean;
}) {
  return (
    <Alert variant={checklist.complete ? 'success' : 'warning'}>
      {checklist.complete ? (
        <BadgeCheck className="size-4" />
      ) : (
        <ShieldQuestion className="size-4" />
      )}
      <AlertTitle>
        {checklist.complete
          ? 'Fully verified - all four checks confirmed'
          : `Driver verification: ${checklist.verifiedCount} of ${checklist.totalCount} checks confirmed`}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        {!checklist.complete ? (
          <p className="text-xs leading-relaxed">
            A driver is verified once the licensing authority has confirmed their licence and their
            Aadhaar, PAN and Voter ID have each been confirmed by their own source. Until then they
            cannot be assigned a trip.
          </p>
        ) : null}

        <ul className="space-y-1.5">
          {checklist.items.map((item) => (
            <li key={item.key} className="flex gap-2">
              {item.verified ? (
                <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              ) : (
                <ShieldQuestion
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {item.label}
                  {item.verified && item.verifiedAt ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      confirmed {new Date(item.verifiedAt).toLocaleDateString('en-IN')}
                    </span>
                  ) : null}
                </p>
                {!item.verified ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {canVerify
                      ? item.hint
                      : `${item.hint} Your role cannot run this check - ask an owner or fleet manager.`}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
