import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { SecureAccessSettings } from '@/features/secure-access/secure-access-settings';

/**
 * Secure PIN and fingerprint / face unlock — a page of its own, reached from
 * the profile menu's Security group.
 *
 * Not a step of the profile wizard: those steps are about completing a profile
 * and end by moving on to verification, while this is a lock the person sets
 * once and returns to only to change it.
 */
export function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Secure PIN & fingerprint"
        description="Keep full RC details and sensitive settings to you, even on a device someone else picks up."
      />
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <SecureAccessSettings />
        </CardContent>
      </Card>
    </div>
  );
}

export default SecurityPage;
