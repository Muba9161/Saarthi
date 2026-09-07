import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, PartyPopper, Share2 } from 'lucide-react';
import { QrSubjectType } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  QrCodeImage,
  defaultStickerFor,
  downloadAsset,
  type QrCodeView,
} from '@/features/qr/qr-code-card';

/**
 * The moment just after a vehicle or a driver joins the fleet.
 *
 * Adding a truck used to end in a toast that vanished in four seconds, which is
 * a strange way to mark the thing an operator came to the software to do. This
 * gives the moment somewhere to land: the record is in, here is its code, and
 * here is the one useful next action — get that code to the person who will
 * scan it.
 *
 * The code is fetched rather than passed in, because the API issues it during
 * creation and the create response says nothing about it. The endpoint is a
 * get-or-create, so on the rare occasion provisioning did not manage it, asking
 * for it here is what mints it — the dialog cannot show an empty frame.
 *
 * Nothing here is required. Every path out of it is "Done", and the code is on
 * the subject's own page from now on, so a user who closes it immediately has
 * lost nothing.
 */

/** Warm, specific, and never overstated — it is one record, not a milestone. */
function encouragement(subjectType: QrSubjectType, isFirst: boolean): string {
  if (isFirst) {
    return subjectType === QrSubjectType.VEHICLE
      ? 'Your first vehicle is on the road with Saarthi. Everything else — documents, service, trips — hangs off this one record.'
      : 'Your first driver is set up. Their score, documents and trip history start building from here.';
  }
  return subjectType === QrSubjectType.VEHICLE
    ? 'Fitted to the cab door or the windscreen, this turns a gate check into a scan.'
    : 'On a lanyard card, this answers "is this the driver who was sent?" without a phone call.';
}

export function QrWelcomeDialog({
  open,
  onOpenChange,
  subjectType,
  subjectId,
  subjectLabel,
  headline,
  isFirst = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectType: Extract<QrSubjectType, 'VEHICLE' | 'DRIVER'>;
  subjectId: string | null;
  /** The plate, or the driver's name — whatever the user just typed in. */
  subjectLabel: string;
  /** Overrides the default congratulation line. */
  headline?: string;
  /** Softens the copy for somebody's very first vehicle or driver. */
  isFirst?: boolean;
  /** Anything the caller must still show, such as a driver's set-up link. */
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = React.useState(false);
  const [shared, setShared] = React.useState(false);

  const code = useQuery({
    queryKey: ['qr', 'subject', subjectType, subjectId],
    queryFn: () => api.get<QrCodeView>(`/qr/subject/${subjectType}/${subjectId!}`),
    enabled: open && Boolean(subjectId),
  });

  const noun = subjectType === QrSubjectType.VEHICLE ? 'vehicle' : 'driver';
  const target = code.data?.targetUrl ?? null;

  const copyLink = (): void => {
    if (!target) return;
    void navigator.clipboard?.writeText(target);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  /**
   * The native share sheet where there is one, the clipboard where there is
   * not. A desktop browser without `navigator.share` still needs the link, so
   * the fallback is the copy that already works rather than a disabled button.
   */
  const share = async (): Promise<void> => {
    if (!target) return;

    const payload = {
      title: `Saarthi · ${subjectLabel}`,
      text: `Scan to verify ${subjectLabel} on VorldX Saarthi.`,
      url: target,
    };

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(payload);
        setShared(true);
        window.setTimeout(() => setShared(false), 2000);
        return;
      } catch {
        // A cancelled share sheet is not a failure; fall through to the copy.
      }
    }
    copyLink();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PartyPopper className="size-5 text-success" />
            {headline ?? `${subjectLabel} is in your fleet`}
          </DialogTitle>
          <DialogDescription>
            Saarthi issued this {noun}’s QR code automatically — there is nothing to generate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
            {code.isLoading ? (
              <div className="size-40 animate-pulse rounded-lg bg-secondary" />
            ) : code.data ? (
              <>
                <QrCodeImage code={code.data} />
                <code className="rounded bg-secondary px-2 py-1 font-mono text-sm">
                  {code.data.shortLabel}
                </code>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                The code is being prepared. You will find it on the {noun}’s page in a moment.
              </p>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            {encouragement(subjectType, isFirst)}
          </p>

          {code.data ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => void share()}>
                {shared ? <Check className="size-3.5" /> : <Share2 className="size-3.5" />}
                {shared ? 'Shared' : 'Share'}
              </Button>
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={copyLink}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  void downloadAsset(
                    `${code.data!.badgeUrl}?preset=${defaultStickerFor(subjectType)}`,
                    `saarthi-${noun}-${code.data!.shortLabel}.svg`,
                  )
                }
              >
                <Download className="size-3.5" />
                Printable
              </Button>
            </div>
          ) : null}

          {children}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default QrWelcomeDialog;
