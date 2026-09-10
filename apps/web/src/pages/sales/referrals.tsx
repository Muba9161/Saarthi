import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Mail, MessageCircle, Share2 } from 'lucide-react';
import { Permission, formatDate, humanizeEnum, relativeTimeFrom } from '@saarthi/shared';
import type { Paginated } from '@/lib/api-types';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { useSalesProfile } from '@/features/sales/use-sales-profile';
import { SalesStandingNotice } from '@/features/sales/standing-notice';
import type { AttributionView, ReferralShareResponse } from '@/features/sales/types';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { StatusBadge } from '@/components/common/status-badge';
import { LoadingState, UnauthorizedState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * My referral link and QR.
 *
 * The link is the salesperson's GODID, deliberately — they can read their own
 * identity in the URL and see that it is theirs, and there is no second code
 * that could resolve to the wrong person and misdirect a commission.
 *
 * It is not a secret and is not presented as one. Following it grants nothing
 * and reveals nothing beyond a display name; the attribution is decided by the
 * backend at registration from the code it re-resolves, so a hand-edited URL
 * credits nobody.
 *
 * The attribution window is displayed rather than assumed. It is configuration
 * (`SALES_ATTRIBUTION_WINDOW_DAYS`) and the API sends it on this response, so
 * nobody has to be told a number that was never written down.
 */
export function SalesReferralsPage(): React.ReactElement {
  const { can } = useAuth();
  const { profile, godWebVerificationAvailable, canSell } = useSalesProfile();
  const [page, setPage] = React.useState(1);

  const share = useQuery({
    queryKey: ['/sales/referrals/mine'],
    queryFn: () => api.get<ReferralShareResponse>('/sales/referrals/mine'),
    enabled: can(Permission.REFERRALS_READ) && canSell,
    staleTime: 10 * 60_000,
  });

  const attributions = useQuery({
    queryKey: ['/sales/referrals', page],
    queryFn: () =>
      api.get<Paginated<AttributionView>>('/sales/referrals', { page, pageSize: 20 }),
    enabled: can(Permission.REFERRALS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.REFERRALS_READ)) return <UnauthorizedState />;

  const link = share.data;

  const copy = (value: string, label: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => toast.success(`${label} copied.`))
      .catch(() => toast.error(`Could not copy the ${label.toLowerCase()}.`));
  };

  const columns: Column<AttributionView>[] = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.organizationName ?? 'Link opened, no signup yet'}
          </p>
          <p className="truncate text-xs text-muted-foreground">{humanizeEnum(row.source)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'captured',
      header: 'Opened',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{relativeTimeFrom(row.capturedAt)}</span>
      ),
    },
    {
      key: 'expires',
      header: 'Claim until',
      hideOnMobile: true,
      cell: (row) =>
        row.status === 'CAPTURED' ? (
          <span className="text-sm text-muted-foreground">{formatDate(row.expiresAt)}</span>
        ) : (
          /*
           * An attribution with a customer behind it has no meaningful expiry —
           * the window only governs a click that has not become a signup yet.
           * Showing a date here would suggest the credit runs out, which it
           * does not.
           */
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'converted',
      header: 'Paid',
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.convertedAt ? formatDate(row.convertedAt) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="My referral link"
        description="Share it however the customer prefers. Saarthi credits the signup to you."
      />

      <SalesStandingNotice
        profile={profile}
        godWebVerificationAvailable={godWebVerificationAvailable}
      />

      {canSell ? (
        share.isLoading ? (
          <LoadingState />
        ) : link ? (
          <Card>
            <CardContent className="grid gap-6 pt-6 md:grid-cols-[auto_1fr]">
              {link.qrDataUri ? (
                <div className="mx-auto w-full max-w-[220px] rounded-xl border border-border bg-white p-3">
                  <img
                    src={link.qrDataUri}
                    alt={`Referral QR code for ${link.godId}`}
                    className="h-auto w-full"
                  />
                </div>
              ) : null}

              <div className="min-w-0 space-y-4">
                <div className="space-y-1">
                  <p className="section-label">GODID</p>
                  <p className="text-lg font-semibold tracking-tight">{link.godId}</p>
                </div>

                <div className="space-y-1.5">
                  <p className="section-label">Link</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1.5 text-xs">
                      {link.url}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => copy(link.url, 'Link')}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(link.shareText)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle className="mr-1.5 h-4 w-4" />
                      WhatsApp
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={`sms:?body=${encodeURIComponent(link.shareText)}`}>SMS</a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={`mailto:?subject=${encodeURIComponent(
                        'Saarthi for your fleet',
                      )}&body=${encodeURIComponent(link.shareText)}`}
                    >
                      <Mail className="mr-1.5 h-4 w-4" />
                      Email
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(link.shareText, 'Message')}
                  >
                    <Share2 className="mr-1.5 h-4 w-4" />
                    Copy message
                  </Button>
                </div>

                <Alert>
                  <AlertDescription className="text-xs">
                    A customer who opens your link and signs up later is still credited to you for{' '}
                    <strong>{link.attributionWindowDays} days</strong>. If somebody else has
                    already been credited with a customer, your link will not take them over —
                    the first valid credit stands.
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        ) : null
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          title="Who your link brought"
          description="Every row is a real click or a real signup. Nothing here is estimated."
        />
        <DataTable
          columns={columns}
          rows={attributions.data?.items}
          rowKey={(row) => row.id}
          isLoading={attributions.isLoading}
          error={attributions.error}
          onRetry={() => void attributions.refetch()}
          {...(attributions.data?.pagination
            ? { pagination: attributions.data.pagination }
            : {})}
          onPageChange={setPage}
          emptyTitle="Nobody has used your link yet"
          emptyDescription="Share it on WhatsApp, or show the QR code on a visit."
        />
      </section>
    </div>
  );
}

export default SalesReferralsPage;
