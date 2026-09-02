import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Car,
  FileWarning,
  IdCard,
  Info,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Truck,
  WifiOff,
} from 'lucide-react';
import {
  humanizeEnum,
  type DrivingLicenceRecord,
  type QrScope,
  type VehicleRcRecord,
} from '@saarthi/shared';
import { ApiError, apiRequest } from '@/lib/api-client';
import { BRAND_NAME, SaarthiLogo } from '@/components/common/logo';
import { LoadingState } from '@/components/common/states';
import {
  LicenceClasses,
  LicenceRecordDetails,
  LicenceValidityRows,
  RcComplianceRows,
  RcRecordDetails,
  RtoDetail,
} from '@/features/documents/rto-record-details';
import { DriverSignOnCard } from '@/features/terminal/driver-signon-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

/**
 * The screen a Saarthi QR sticker opens.
 *
 * This is the only route in the application that renders real fleet data with
 * no session, and it exists because the alternative is worse: a code fixed to a
 * cab door that answers "please sign in" is not an identity credential, it is a
 * decoration. A traffic officer, a loading supervisor or a customer at a gate
 * has no Saarthi account and never will.
 *
 * Three things make that safe, and none of them live in this file:
 *
 *  1. The token is 32 random bytes with no relationship to any record id, so
 *     the URL cannot be walked from one vehicle to the next.
 *  2. What comes back is the intersection of the code's scopes, the scanner's
 *     relationship to the subject (here: none) and the fleet's own field
 *     policy. This component renders what it is given and decides nothing.
 *  3. Every scan is logged, including the failures, so token-guessing is
 *     visible to the fleet that owns the code.
 *
 * Signing in *widens* what this page shows rather than being a precondition for
 * it, which is why the same route serves both cases.
 */

interface ScanIdentity {
  displayName: string;
  secondaryLabel: string | null;
  imageUrl: string | null;
  verified: boolean;
  organizationName: string | null;
}

interface PublicScanResult {
  subjectType: string;
  subjectId: string;
  scopesGranted: QrScope[];
  scopesWithheld: Array<{ scope: QrScope; reason: string }>;
  identity: ScanIdentity;
  contact?: { phone: string | null };
  vehicle?: {
    registrationNumber: string;
    vehicleType: string;
    truckType: string;
    capacityTons: number;
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    status: string;
  };
  driver?: {
    name?: string | null;
    photoUrl?: string | null;
    experienceYears: number;
    licenseClass: string | null;
    scoreBand: string | null;
    totalTrips: number;
  };
  compliance?: {
    documents: Array<{ type: string; label: string; validity: string; expiresAt: string | null }>;
    allValid: boolean;
  };
  service?: { health: string; lastServiceDate: string | null };
  finance?: { financed: boolean };
  rc?: {
    registrationNumber: string;
    retrievedAt: string;
    source: 'VEHICLE' | 'ASSIGNED_VEHICLE';
    record: VehicleRcRecord;
  };
  licence?: {
    licenceNumber: string;
    retrievedAt: string;
    source: 'DRIVER' | 'ASSIGNED_DRIVER';
    record: DrivingLicenceRecord;
  };
  privacy?: {
    profile: string;
    profileLabel: string;
    maskedFields: string[];
    hiddenFields: string[];
  };
  scannedAt: string;
}

const VALIDITY_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  VALID: 'success',
  EXPIRING_SOON: 'warning',
  EXPIRED: 'destructive',
  MISSING: 'muted',
  PENDING: 'muted',
};

/** A date the scanner can read at a glance, in the device's own locale. */
function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ScanShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <SaarthiLogo className="h-8" decorative />
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">{BRAND_NAME}</p>
              <p className="text-2xs uppercase tracking-widest text-muted-foreground">
                Verified identity
              </p>
            </div>
          </Link>
          <Badge variant="secondary" size="sm" className="gap-1">
            <ScanLine className="size-3" />
            Scan
          </Badge>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">{children}</main>
    </div>
  );
}

/**
 * The failure screens.
 *
 * Worded for somebody standing beside a truck with a phone, not for an
 * operator at a desk: each one says what to do next rather than naming an
 * HTTP status. A code that does not resolve and a code that was never real are
 * deliberately the same message — telling a stranger that a token exists but is
 * closed to them is itself a disclosure.
 */
function ScanProblem({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof FileWarning;
  title: string;
  description: string;
  /** Defaults to the sign-in link, which is wrong for a transport failure. */
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold">{title}</p>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="mt-1">
          {action ?? (
            <Button asChild variant="outline" size="sm">
              <Link to="/login">Sign in to VorldX Saarthi</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PublicScanPage() {
  const { token = '' } = useParams<{ token: string }>();

  const scan = useQuery({
    queryKey: ['qr', 'resolve', token],
    queryFn: () =>
      apiRequest<PublicScanResult>(`/qr/resolve/${encodeURIComponent(token)}`, {
        // A scan is not a session-expiry event. Without this an anonymous scan
        // would trip the client's refresh-and-retry path and fire the
        // unauthenticated handler, bouncing the phone to the sign-in screen —
        // which is the exact bug this page exists to fix.
        skipAuthRetry: true,
      }),
    enabled: token.length > 0,
    retry: false,
    // The result is a point-in-time disclosure that was written to the fleet's
    // scan log. Refetching it on window focus would log a second scan nobody
    // performed.
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  if (!token) {
    return (
      <ScanShell>
        <ScanProblem
          icon={FileWarning}
          title="No code in this link"
          description="Scan the QR code again, or type the short code printed beneath it into VorldX Saarthi."
        />
      </ScanShell>
    );
  }

  if (scan.isPending) {
    return (
      <ScanShell>
        <LoadingState label="Checking this code…" className="min-h-[40vh]" />
      </ScanShell>
    );
  }

  if (scan.error) {
    const error = scan.error instanceof ApiError ? scan.error : null;

    // 422 carries a real explanation from the server — revoked, expired — and
    // saying so is useful: it tells the holder to get a new sticker.
    if (error?.status === 422) {
      return (
        <ScanShell>
          <ScanProblem
            icon={FileWarning}
            title="This code is no longer valid"
            description={error.message}
          />
        </ScanShell>
      );
    }

    /*
     * A transport failure is not a verdict on the code.
     *
     * `status === 0` means the request never reached a server — no DNS, no
     * route, or the browser refused to send it at all. Reporting that as "this
     * code could not be read" blames the sticker for the network, and sends the
     * person holding the phone off to check a QR that was fine.
     */
    if (error?.status === 0) {
      return (
        <ScanShell>
          <ScanProblem
            icon={WifiOff}
            title="Could not reach VorldX Saarthi"
            description="The code was read correctly, but this device could not contact the server. Check your connection and try again."
            action={
              <Button variant="outline" size="sm" onClick={() => void scan.refetch()}>
                <RefreshCw className="size-3.5" />
                Try again
              </Button>
            }
          />
        </ScanShell>
      );
    }

    if (error?.status === 429) {
      return (
        <ScanShell>
          <ScanProblem
            icon={Info}
            title="Too many scans just now"
            description="This code has been scanned repeatedly in a short time. Wait a moment and try again."
          />
        </ScanShell>
      );
    }

    return (
      <ScanShell>
        <ScanProblem
          icon={FileWarning}
          title="This code could not be read"
          description="It may have been withdrawn by the fleet that issued it, or it may never have been a VorldX Saarthi code. Sign in if you were expecting to see more."
        />
      </ScanShell>
    );
  }

  const result = scan.data;
  const isVehicle = result.subjectType === 'VEHICLE';
  const photo = result.identity.imageUrl;
  const publicScan = result.privacy?.profile === 'PUBLIC';

  return (
    <ScanShell>
      {/* --- Who or what this is ------------------------------------------ */}
      <Card>
        <CardContent className="flex items-start gap-4 py-5">
          {photo ? (
            <img
              src={photo}
              alt=""
              className="size-16 shrink-0 rounded-lg object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted">
              {isVehicle ? (
                <Truck className="size-7 text-muted-foreground" />
              ) : (
                <IdCard className="size-7 text-muted-foreground" />
              )}
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className={
                  isVehicle
                    ? 'font-mono text-xl font-semibold tracking-wide'
                    : 'text-xl font-semibold tracking-tight'
                }
              >
                {result.identity.displayName}
              </h1>
              {result.identity.verified ? (
                <Badge variant="success" size="sm" className="gap-1">
                  <BadgeCheck className="size-3" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="muted" size="sm">
                  Not yet verified
                </Badge>
              )}
            </div>

            {result.identity.secondaryLabel ? (
              <p className="truncate text-sm text-muted-foreground">
                {result.identity.secondaryLabel}
              </p>
            ) : null}

            {result.identity.organizationName ? (
              <p className="flex items-center gap-1.5 text-sm">
                <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{result.identity.organizationName}</span>
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/*
        --- Driver sign-on --------------------------------------------------
        Only ever rendered for a signed-in driver scanning a vehicle in their
        own fleet; it returns null for everyone else. Placed directly under the
        identity card because for that one reader it is the whole reason they
        scanned.
      */}
      {isVehicle ? (
        <DriverSignOnCard
          qrToken={token}
          registrationNumber={result.vehicle?.registrationNumber ?? result.identity.displayName}
        />
      ) : null}

      {/* --- Registration certificate -------------------------------------- */}
      {result.rc ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Car className="size-4 text-muted-foreground" />
              Registration certificate
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{result.rc.registrationNumber}</span>
              {result.rc.source === 'ASSIGNED_VEHICLE' ? ' · vehicle currently assigned' : ''} ·
              from the RTO record held by Saarthi on {formatMoment(result.rc.retrievedAt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              <RcComplianceRows record={result.rc.record} />
            </div>
            <Separator />
            <RcRecordDetails record={result.rc.record} />
            {result.rc.record.redacted ? (
              <p className="text-xs text-muted-foreground">
                Some fields on this certificate are withheld at your access level.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : result.vehicle ? (
        // No stored RTO record, but the fleet's own vehicle data is granted —
        // better than a blank card, and it says plainly why it is thinner.
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Car className="size-4 text-muted-foreground" />
              Vehicle
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              No RTO registration record is on file for this vehicle yet.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <RtoDetail label="Registration" value={result.vehicle.registrationNumber} />
            <RtoDetail label="Type" value={humanizeEnum(result.vehicle.vehicleType)} />
            <RtoDetail label="Body" value={humanizeEnum(result.vehicle.truckType)} />
            <RtoDetail label="Maker" value={result.vehicle.manufacturer} />
            <RtoDetail label="Model" value={result.vehicle.model} />
            <RtoDetail label="Year" value={result.vehicle.year} />
            <RtoDetail
              label="Capacity"
              value={result.vehicle.capacityTons ? `${result.vehicle.capacityTons} t` : null}
            />
            <RtoDetail label="Status" value={humanizeEnum(result.vehicle.status)} />
          </CardContent>
        </Card>
      ) : null}

      {/* --- Driving licence ----------------------------------------------- */}
      {result.licence ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <IdCard className="size-4 text-muted-foreground" />
              Driving licence
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{result.licence.licenceNumber}</span>
              {result.licence.source === 'ASSIGNED_DRIVER' ? ' · driver currently assigned' : ''} ·
              from the RTO record held by Saarthi on {formatMoment(result.licence.retrievedAt)}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y divide-border rounded-lg border border-border px-3">
              <LicenceValidityRows record={result.licence.record} />
            </div>
            <LicenceClasses record={result.licence.record} />
            <Separator />
            <LicenceRecordDetails record={result.licence.record} />
            {result.licence.record.redacted ? (
              <p className="text-xs text-muted-foreground">
                Some fields on this licence are withheld at your access level.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* --- The driver, as Saarthi knows them ----------------------------- */}
      {result.driver ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <IdCard className="size-4 text-muted-foreground" />
              Driver
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {result.driver.name !== undefined ? (
              <RtoDetail label="Name" value={result.driver.name} />
            ) : null}
            <RtoDetail label="Licence class" value={result.driver.licenseClass} />
            <RtoDetail
              label="Experience"
              value={result.driver.experienceYears ? `${result.driver.experienceYears} yr` : null}
            />
            <RtoDetail label="Driving score" value={result.driver.scoreBand} />
            <RtoDetail label="Trips completed" value={result.driver.totalTrips} />
          </CardContent>
        </Card>
      ) : null}

      {/* --- Saarthi's own document tracking ------------------------------- */}
      {result.compliance && result.compliance.documents.length > 0 ? (
        <Card>
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-muted-foreground" />
              Documents on file
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Held by the operating fleet. The files themselves are never shared by a scan.
            </p>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {result.compliance.documents.map((document) => (
              <div
                key={`${document.type}-${document.expiresAt ?? 'none'}`}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="min-w-0 truncate text-sm">{document.label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {document.expiresAt ? (
                    <span className="tabular text-xs text-muted-foreground">
                      {document.expiresAt.slice(0, 10)}
                    </span>
                  ) : null}
                  <Badge variant={VALIDITY_VARIANT[document.validity] ?? 'muted'} size="sm">
                    {humanizeEnum(document.validity)}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* --- Service and finance ------------------------------------------- */}
      {result.service || result.finance ? (
        <Card>
          <CardContent className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-3">
            {result.service ? (
              <>
                <RtoDetail label="Service health" value={result.service.health} />
                <RtoDetail label="Last serviced" value={result.service.lastServiceDate} />
              </>
            ) : null}
            {result.finance ? (
              <RtoDetail label="Under finance" value={result.finance.financed ? 'Yes' : 'No'} />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* --- What this scan did and did not show --------------------------- */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            Seen as{' '}
            <strong className="font-medium">
              {result.privacy?.profileLabel ?? 'Public scan'}
            </strong>{' '}
            · {formatMoment(result.scannedAt)}
          </p>

          {result.scopesWithheld.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {result.scopesWithheld.map((entry) => (
                <li key={entry.scope}>{entry.reason}</li>
              ))}
            </ul>
          ) : null}

          {publicScan ? (
            <p className="text-xs text-muted-foreground">
              Sign in to VorldX Saarthi to see contact details and live trip status, if your account
              is entitled to them. This scan has been recorded for the fleet that issued the code.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </ScanShell>
  );
}

export default PublicScanPage;
