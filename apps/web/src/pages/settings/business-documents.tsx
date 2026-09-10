import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Building2 } from 'lucide-react';
import { Permission, humanizeEnum } from '@saarthi/shared';
import { api } from '@/lib/api-client';
import type { IdentitySubjectView } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { DocumentPanel } from '@/features/documents/document-panel';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, UnauthorizedState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SectionHeader } from '@/components/common/page-header';

/**
 * The business's own documents and its GST registration.
 *
 * A driver reaches their documents from their profile and a vehicle from its
 * detail screen, but the *organization* had no such screen — its documents
 * could only be uploaded through an API call. That is why GST verification
 * needs a home rather than a place in an existing tab: the business is the one
 * subject in the system with no detail page of its own.
 */
export function BusinessDocumentsPage() {
  const { can, session } = useAuth();
  const organization = session?.organization;

  const identity = useQuery({
    queryKey: ['identity', 'subject', 'ORGANIZATION', organization?.id],
    queryFn: () =>
      api.get<IdentitySubjectView>(`/identity/subject/organization/${organization?.id}`),
    enabled: Boolean(organization?.id) && can(Permission.VERIFICATION_READ),
  });

  if (!can(Permission.DOCUMENTS_READ)) return <UnauthorizedState />;

  if (!organization) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHeader
          eyebrow="Account"
          title="Business documents"
          description="Registration, tax and bank documents for your business."
        />
        <EmptyState
          icon={Building2}
          title="No organization on this account"
          description="This account is not acting for a business, so it has no business documents to keep."
        />
      </div>
    );
  }

  const gst = identity.data?.checks.find((entry) => entry.kind === 'GST')?.verification ?? null;
  const gstVerified = gst?.outcome === 'VERIFIED';
  const gstRecord = gstVerified
    ? (gst?.record as {
        legalName?: string | null;
        tradeName?: string | null;
        status?: string | null;
        taxpayerType?: string | null;
        registrationDate?: string | null;
        state?: string | null;
      } | null)
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Business documents"
        description="Registration, tax and bank documents for your business - and the GST check that confirms who you are to everyone you trade with."
        actions={
          <Badge variant={organization.verificationStatus === 'VERIFIED' ? 'success' : 'warning'}>
            {humanizeEnum(organization.verificationStatus)}
          </Badge>
        }
      />

      {/*
        What the GST portal holds, once the check has run. Shown above the
        documents because it is the answer the rest of the marketplace cares
        about: a customer deciding whether to trust a supplier is asking this
        question, not whether a scan was filed.
      */}
      {gstVerified && gstRecord ? (
        <Card className="border-success/40 bg-success/5">
          <CardHeader className="pb-3">
            <SectionHeader
              title="GST registration verified"
              description="Confirmed against the GST portal."
              actions={
                <Badge variant="success" className="gap-1">
                  <BadgeCheck className="size-3.5" />
                  {gst?.maskedNumber}
                </Badge>
              }
            />
          </CardHeader>
          <CardContent className="pt-0">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Fact label="Legal name" value={gstRecord.legalName} />
              <Fact label="Trade name" value={gstRecord.tradeName} />
              <Fact label="Status" value={gstRecord.status} />
              <Fact label="Taxpayer type" value={gstRecord.taxpayerType} />
              <Fact label="State" value={gstRecord.state} />
              <Fact
                label="Registered"
                value={
                  gstRecord.registrationDate
                    ? new Date(gstRecord.registrationDate).toLocaleDateString('en-IN')
                    : null
                }
              />
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <DocumentPanel
        ownerType="ORGANIZATION"
        ownerId={organization.id}
        ownerLabel={organization.name}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default BusinessDocumentsPage;
