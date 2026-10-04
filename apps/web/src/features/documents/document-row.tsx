import * as React from 'react';
import { BadgeCheck, Download, FileText, ShieldCheck } from 'lucide-react';
import {
  identityFormatMessage,
  identityKindForDocumentType,
  isRetiredDocumentType,
  isValidIdentityNumber,
  normalizeIdentityNumber,
} from '@saarthi/shared';
import type { DocumentSummary } from '@/lib/api-types';
import { StatusBadge } from '@/components/common/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * One document row.
 *
 * The verify affordance sits in front of the download controls rather than
 * among them, because it is the *action* on the row while those are utilities.
 * A verified row shows what verified it, so nobody has to guess whether the
 * green tick means "a reviewer looked at the scan" or "the government confirmed
 * the number".
 */
export function DocumentRow({
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
  /**
   * A type that is no longer offered — today, only the vehicle photograph.
   *
   * It keeps its row, its preview and its download, because the file is still
   * the file. What it loses is the validity badge: a photograph was never going
   * to be verified, and leaving it marked "pending verification" for the life
   * of the vehicle is a queue entry that describes nothing and clears never.
   */
  const retired = isRetiredDocumentType(document.documentType);

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
        {retired ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Vehicle photographs are kept under Photos now, where they are previewed rather than
            downloaded. This one is left here untouched.
          </p>
        ) : null}
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

      {retired ? (
        <Badge variant="outline" size="sm">
          Not verified
        </Badge>
      ) : (
        <StatusBadge status={document.validity} size="sm" />
      )}

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
