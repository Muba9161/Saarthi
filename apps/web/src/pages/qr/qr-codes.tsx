import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QrCode, ShieldCheck } from 'lucide-react';
import { Feature, Permission } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader, SectionHeader } from '@/components/common/page-header';
import {
  EmptyState,
  ErrorState,
  FeatureLockedState,
  LoadingState,
  UnauthorizedState,
} from '@/components/common/states';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QrCodeCard, type QrCodeView } from '@/features/qr/qr-code-card';

/**
 * Every code this account can see.
 *
 * There is no "Generate code" button, and no subject picker. A code is issued
 * with its subject — the moment a vehicle or a driver is created, Saarthi mints
 * their code (see `provisionOnCreate` in the API's QR service), and the
 * just-added dialog shows it while the operator is still looking at the screen.
 * Asking somebody to remember a second step meant fleets ran vehicles that had
 * no code at all until a gate check needed one.
 *
 * So this screen is a register, not a workshop: it lists what exists, and the
 * lifecycle actions that genuinely need a human decision — rotate a compromised
 * code, revoke a lost badge — stay on each card. A code for one vehicle or one
 * driver is better reached from that vehicle or driver's own page, where it sits
 * as a tab beside their documents.
 */
export function QrCodesPage() {
  const { can, hasFeature } = useAuth();
  const queryClient = useQueryClient();

  const canRead = can(Permission.QR_READ);

  const codes = useQuery({
    queryKey: ['qr', 'list'],
    queryFn: () => api.get<Paginated<QrCodeView>>('/qr', { pageSize: 50 }),
    enabled: canRead,
  });

  if (!canRead) return <UnauthorizedState />;
  if (!hasFeature(Feature.QR_IDENTITY)) {
    return (
      <div className="space-y-5">
        <PageHeader title="QR codes" />
        <FeatureLockedState feature="QR identity codes" featureKey={Feature.QR_IDENTITY} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Saarthi Connect"
        title="QR codes"
        description="Scannable identity for vehicles and drivers - a roadside check, a gate entry or a handover, without a phone call."
        actions={
          // Privacy is the one control that belongs at this level: it decides
          // what every code in the fleet reveals, not what one of them does.
          <Button asChild variant="outline" className="gap-1.5">
            <Link to="/settings/qr-privacy">
              <ShieldCheck className="h-4 w-4" />
              Privacy
            </Link>
          </Button>
        }
      />

      {codes.isLoading ? (
        <LoadingState label="Loading codes…" />
      ) : codes.error ? (
        <ErrorState error={codes.error} onRetry={() => void codes.refetch()} />
      ) : (codes.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={QrCode}
          title="No codes yet"
          description="Codes are issued automatically with each vehicle and driver. Add your first one and its code will be waiting on its page."
        />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <SectionHeader
                title="How disclosure works"
                description="A code carries no data itself - it carries a token. What a scanner sees depends on who they are: a stranger sees far less than the vehicle's own fleet, and every scan is logged."
              />
            </CardHeader>
          </Card>

          <div className="space-y-3">
            {codes.data!.items.map((code) => (
              <QrCodeCard
                key={code.id}
                code={code}
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['qr'] })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default QrCodesPage;
