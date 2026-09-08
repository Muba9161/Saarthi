import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Copy,
  Download,
  Layers,
  QrCode,
  RefreshCw,
  ScanLine,
  Scissors,
  ShieldOff,
} from 'lucide-react';
import { Permission, humanizeEnum, type QrSubjectType } from '@saarthi/shared';
import { ApiError, api, apiBase, getAccessToken } from '@/lib/api-client';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The QR identity card, and the pieces every QR surface needs.
 *
 * A code is a *credential*, not a picture. Two consequences shape everything
 * here:
 *
 *  * The image is fetched with the session token and rendered from a blob URL
 *    rather than pointed at with a plain `<img src>`, because the endpoint is
 *    authenticated — an unauthenticated `src` would simply render broken.
 *  * Rotating a code invalidates the printed sticker. The dialog says so before
 *    it happens, because "regenerate" that silently breaks every windscreen in
 *    the yard is a trap.
 *
 * This lives in `features/` rather than on the QR page because the card is what
 * a vehicle's passport, a driver's profile and the just-added dialog all show.
 */

export interface QrCodeView {
  id: string;
  subjectType: QrSubjectType;
  subjectId: string;
  status: string;
  scopes: string[];
  label: string | null;
  version: number;
  allowPublicResolve: boolean;
  /** Human-typeable fallback for a sticker too dirty to scan. */
  shortLabel: string;
  targetUrl: string;
  imageUrl: string;
  badgeUrl: string;
  expiresAt: string | null;
  lastScannedAt: string | null;
  scanCount: number;
  createdAt: string;
}

export interface QrScanEntry {
  id: string;
  purpose: string;
  result: string;
  scopesGranted: string[];
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

/**
 * Fetch an authenticated image and expose it as a blob URL.
 *
 * The QR endpoints require the bearer token, so the browser cannot load them
 * directly from an `<img src>`. Revoking the object URL on unmount keeps a long
 * session from leaking one blob per code viewed.
 */
export function useAuthedImage(path: string | null): { src: string | null; loading: boolean } {
  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);

    const base = apiBase();
    fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
      credentials: 'include',
    })
      .then((response) => (response.ok ? response.blob() : Promise.reject(response.status)))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return { src, loading };
}

export function QrCodeImage({ code }: { code: QrCodeView }) {
  const { src, loading } = useAuthedImage(`${code.imageUrl}?size=320`);

  if (loading) {
    return <div className="h-40 w-40 animate-pulse rounded-lg bg-secondary" />;
  }
  if (!src) {
    return (
      <div className="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center text-2xs text-muted-foreground">
        <QrCode className="h-5 w-5" />
        Image unavailable
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`QR code ${code.shortLabel}`}
      className="h-40 w-40 rounded-lg bg-white p-2"
    />
  );
}

export interface StickerOption {
  key: string;
  label: string;
  size: string;
  hint: string;
  mirror?: boolean;
}

/**
 * The printable options, worded by *where the sticker goes*.
 *
 * A fleet clerk fitting forty trucks knows the answer to "which part of the
 * vehicle", not to "100 mm or 90 mm" — so the place leads and the measurement
 * sits alongside as confirmation. The list is filtered by subject, because a
 * driver has no windscreen and a truck wears no lanyard.
 */
export function stickerOptionsFor(subjectType: string): StickerOption[] {
  if (subjectType === 'DRIVER' || subjectType === 'USER') {
    return [
      {
        key: 'driver-card',
        label: 'Driver ID card',
        size: '85.6 x 54 mm',
        hint: 'Bank-card size, fits a lanyard holder they already own.',
      },
    ];
  }

  return [
    {
      key: 'vehicle-sticker',
      label: 'Cab door',
      size: '100 x 100 mm',
      hint: 'Largest code. Reads from about three metres across a yard.',
    },
    {
      key: 'vehicle-windscreen',
      label: 'Windscreen, outside',
      size: '90 x 55 mm',
      hint: 'Sits in a corner without obstructing the view. Normal print.',
    },
    {
      key: 'vehicle-windscreen',
      label: 'Windscreen, inside the glass',
      size: '90 x 55 mm',
      hint: 'Reverse-printed, so it reads correctly from outside.',
      mirror: true,
    },
    {
      key: 'vehicle-strip',
      label: 'Tailgate strip',
      size: '150 x 60 mm',
      hint: 'Landscape, sits above the number plate.',
    },
  ];
}

/** The preset used for the batch and print-shop variants. */
export function defaultStickerFor(subjectType: string): string {
  return subjectType === 'DRIVER' || subjectType === 'USER' ? 'driver-card' : 'vehicle-sticker';
}

/** Download an authenticated asset without exposing the token in a URL. */
export async function downloadAsset(path: string, filename: string): Promise<void> {
  const base = apiBase();
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!response.ok) return;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function QrCodeCard({ code, onChanged }: { code: QrCodeView; onChanged: () => void }) {
  const { can } = useAuth();
  const [showScans, setShowScans] = React.useState(false);
  const [rotateReason, setRotateReason] = React.useState('');
  const [revokeReason, setRevokeReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const canManage = can(Permission.QR_MANAGE);
  const active = code.status === 'ACTIVE';

  const scans = useQuery({
    queryKey: ['qr', code.id, 'scans'],
    queryFn: () => api.get<Paginated<QrScanEntry>>(`/qr/${code.id}/scans`, { pageSize: 10 }),
    enabled: showScans,
  });

  function onError(mutationError: unknown) {
    setError(
      mutationError instanceof ApiError
        ? mutationError.message
        : 'That action could not be completed.',
    );
  }

  const rotate = useMutation({
    mutationFn: () =>
      api.post(`/qr/${code.id}/rotate`, {
        reason: rotateReason.trim() || undefined,
        keepScopes: true,
      }),
    onSuccess: () => {
      setRotateReason('');
      setError(null);
      onChanged();
    },
    onError,
  });

  const revoke = useMutation({
    mutationFn: () => api.post(`/qr/${code.id}/revoke`, { reason: revokeReason.trim() }),
    onSuccess: () => {
      setRevokeReason('');
      setError(null);
      onChanged();
    },
    onError,
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row">
        <div className="shrink-0">{active ? <QrCodeImage code={code} /> : null}</div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {code.label ?? `${humanizeEnum(code.subjectType)} code`}
              </p>
              <p className="text-xs text-muted-foreground">
                {humanizeEnum(code.subjectType)} · v{code.version} · created{' '}
                {new Date(code.createdAt).toLocaleDateString('en-IN')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge
                variant={
                  code.status === 'ACTIVE'
                    ? 'success'
                    : code.status === 'REVOKED'
                      ? 'destructive'
                      : 'secondary'
                }
                size="sm"
              >
                {humanizeEnum(code.status)}
              </Badge>
              {code.allowPublicResolve ? (
                <Badge variant="warning" size="sm">
                  public
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Type-in fallback
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-secondary px-2 py-1 font-mono text-sm">
                {code.shortLabel}
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => {
                  void navigator.clipboard?.writeText(code.targetUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              For when a sticker is too dirty or damaged to scan.
            </p>
          </div>

          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Discloses</p>
            <div className="flex flex-wrap gap-1">
              {code.scopes.map((scope) => (
                <Badge key={scope} variant="outline" size="sm">
                  {humanizeEnum(scope)}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ScanLine className="h-3.5 w-3.5" />
              {code.scanCount} scan{code.scanCount === 1 ? '' : 's'}
            </span>
            {code.lastScannedAt ? (
              <span>last {new Date(code.lastScannedAt).toLocaleString('en-IN')}</span>
            ) : (
              <span>never scanned</span>
            )}
            {code.expiresAt ? (
              <span>expires {new Date(code.expiresAt).toLocaleDateString('en-IN')}</span>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            {active ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    void downloadAsset(
                      `${code.imageUrl}?size=1024`,
                      `saarthi-qr-${code.shortLabel}.svg`,
                    )
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                  Code
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="gap-1.5">
                      <Download className="h-3.5 w-3.5" />
                      Printable sticker
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Choose where it will be fitted
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {stickerOptionsFor(code.subjectType).map((option) => (
                      <DropdownMenuItem
                        key={option.key + String(option.mirror ?? false)}
                        className="flex-col items-start gap-0.5 py-2"
                        onSelect={() =>
                          void downloadAsset(
                            `${code.badgeUrl}?preset=${option.key}${option.mirror ? '&mirror=true' : ''}`,
                            `saarthi-${option.key}${option.mirror ? '-reversed' : ''}-${code.shortLabel}.svg`,
                          )
                        }
                      >
                        <span className="flex w-full items-baseline justify-between gap-3">
                          <span className="font-medium">{option.label}</span>
                          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                            {option.size}
                          </span>
                        </span>
                        <span className="text-xs leading-snug text-muted-foreground">
                          {option.hint}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 text-xs"
                      onSelect={() =>
                        void downloadAsset(
                          `${code.badgeUrl}?preset=${defaultStickerFor(code.subjectType)}&sheet=true`,
                          `saarthi-sheet-${code.shortLabel}.svg`,
                        )
                      }
                    >
                      <Layers className="h-3.5 w-3.5" />
                      A4 sheet, several to a page
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 text-xs"
                      onSelect={() =>
                        void downloadAsset(
                          `${code.badgeUrl}?preset=${defaultStickerFor(code.subjectType)}&printMarks=true`,
                          `saarthi-print-${code.shortLabel}.svg`,
                        )
                      }
                    >
                      <Scissors className="h-3.5 w-3.5" />
                      With bleed and crop marks
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowScans((current) => !current)}
            >
              <ScanLine className="h-3.5 w-3.5" />
              {showScans ? 'Hide scans' : 'Scan log'}
            </Button>

            {canManage && active ? (
              <>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rotate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Rotate this code</DialogTitle>
                      <DialogDescription>
                        A new token is issued and the old one stops working immediately. Anything
                        already printed will no longer scan — reprint the badge afterwards.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                      <Label htmlFor={`rotate-${code.id}`}>Reason (optional)</Label>
                      <Textarea
                        id={`rotate-${code.id}`}
                        rows={2}
                        value={rotateReason}
                        onChange={(event) => setRotateReason(event.target.value)}
                        placeholder="Sticker was photographed by a third party."
                      />
                    </div>
                    <DialogFooter>
                      <Button loading={rotate.isPending} onClick={() => rotate.mutate()}>
                        Rotate and reprint
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-destructive">
                      <ShieldOff className="h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Revoke this code</DialogTitle>
                      <DialogDescription>
                        The code stops resolving permanently. Use this when a badge is lost or a
                        vehicle leaves the fleet.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                      <Label htmlFor={`revoke-${code.id}`}>Reason</Label>
                      <Textarea
                        id={`revoke-${code.id}`}
                        rows={2}
                        value={revokeReason}
                        onChange={(event) => setRevokeReason(event.target.value)}
                        placeholder="Driver left the fleet."
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        variant="destructive"
                        disabled={revokeReason.trim().length < 3}
                        loading={revoke.isPending}
                        onClick={() => revoke.mutate()}
                      >
                        Revoke
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
          </div>

          {showScans ? (
            <div className="rounded-lg border border-border p-3">
              {scans.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading scans…</p>
              ) : (scans.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No scans recorded. Every scan is logged — that is how a guessing attempt becomes
                  visible.
                </p>
              ) : (
                <ul className="space-y-2">
                  {scans.data!.items.map((scan) => (
                    <li key={scan.id} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{humanizeEnum(scan.purpose)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(scan.createdAt).toLocaleString('en-IN')}
                          {scan.latitude !== null
                            ? ` · ${scan.latitude.toFixed(3)}, ${scan.longitude?.toFixed(3)}`
                            : ''}
                        </p>
                      </div>
                      <Badge
                        variant={scan.result === 'ALLOWED' ? 'success' : 'destructive'}
                        size="sm"
                      >
                        {humanizeEnum(scan.result)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
