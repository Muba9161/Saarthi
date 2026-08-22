import { Feature, Permission } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { FeatureLockedState, UnauthorizedState } from '@/components/common/states';
import { RcLookupPanel } from '@/features/vehicles/rc-lookup-panel';

/**
 * Vehicle registration lookup.
 *
 * Reads the RTO record for any Indian registration number — used when
 * onboarding a vehicle, checking a subcontractor's truck before assigning a
 * load, or verifying that insurance and fitness are current.
 */
export function RcLookupPage() {
  const { can, hasFeature } = useAuth();

  if (!can(Permission.VEHICLE_LOOKUP)) return <UnauthorizedState />;

  if (!hasFeature(Feature.FLEET_BASIC)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Vehicle registration" />
        <FeatureLockedState feature="Vehicle registration lookup" requiredPlan="Basic" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Fleet"
        title="Vehicle registration"
        description="Look up the RC record for any Indian registration number and download the certificate."
      />
      <RcLookupPanel />
    </div>
  );
}

export default RcLookupPage;
