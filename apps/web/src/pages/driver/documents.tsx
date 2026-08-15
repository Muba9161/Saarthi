import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/states';
import { DocumentPanel } from '@/features/documents/document-panel';

export function DriverDocumentsPage() {
  const { session } = useAuth();
  const driverId = session?.driver?.id;

  if (!driverId) {
    return <EmptyState title="No driver profile" description="This account is not linked to a driver profile." />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="My documents" description="Keep your licence and identity documents current to stay compliant." />
      <DocumentPanel ownerType="DRIVER" ownerId={driverId} ownerLabel={session?.user.fullName} />
    </div>
  );
}

export default DriverDocumentsPage;
