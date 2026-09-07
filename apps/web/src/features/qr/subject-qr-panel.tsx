import { useQuery } from '@tanstack/react-query';
import { QrCode } from 'lucide-react';
import { Feature, Permission, QrSubjectType } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { ErrorState, FeatureLockedState, LoadingState } from '@/components/common/states';
import { QrCodeCard, type QrCodeView } from '@/features/qr/qr-code-card';

/**
 * One subject's QR code, on the subject's own page.
 *
 * This is where a code belongs. An operator looking for a vehicle's sticker
 * thinks about the vehicle, not about a codes screen they have to cross-
 * reference by registration number — so the code sits as a tab beside that
 * vehicle's documents and service history, and the same for a driver.
 *
 * The endpoint is a get-or-create, which is what makes this safe to open for a
 * subject that somehow has no code yet: a vehicle imported before codes were
 * issued automatically gets one the first time somebody looks, so there is no
 * empty state telling the user to go and generate something.
 */
export function SubjectQrPanel({
  subjectType,
  subjectId,
  description,
}: {
  subjectType: Extract<QrSubjectType, 'VEHICLE' | 'DRIVER'>;
  subjectId: string;
  description?: string;
}) {
  const { can, hasFeature } = useAuth();

  const enabled = can(Permission.QR_READ) && hasFeature(Feature.QR_IDENTITY) && Boolean(subjectId);

  const code = useQuery({
    queryKey: ['qr', 'subject', subjectType, subjectId],
    queryFn: () => api.get<QrCodeView>(`/qr/subject/${subjectType}/${subjectId}`),
    enabled,
  });

  if (!hasFeature(Feature.QR_IDENTITY)) {
    return <FeatureLockedState feature="QR identity codes" requiredPlan="Pro" />;
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="QR code"
        description={
          description ??
          (subjectType === QrSubjectType.VEHICLE
            ? 'This vehicle’s scannable identity. Print it for the cab door or the windscreen — a gate check or a roadside stop becomes a scan instead of a phone call.'
            : 'This driver’s scannable badge. What a scanner sees depends on who they are, and every scan is logged.')
        }
      />

      {code.isLoading ? (
        <LoadingState label="Preparing the code…" />
      ) : code.error ? (
        <ErrorState error={code.error} onRetry={() => void code.refetch()} />
      ) : code.data ? (
        <QrCodeCard code={code.data} onChanged={() => void code.refetch()} />
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
          <QrCode className="size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No code is available for this record.</p>
        </div>
      )}
    </div>
  );
}

export default SubjectQrPanel;
