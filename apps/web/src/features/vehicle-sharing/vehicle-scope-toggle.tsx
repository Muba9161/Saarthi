import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSharedWithMe } from './sharing-api';

export type VehicleScope = 'mine' | 'shared';

/**
 * Mine / Shared with me, at the top of the Vehicles screen.
 *
 * Two lists rather than one mixed list, because the two are used differently:
 * the account's own vehicles can be edited, sold and assigned; shared ones can
 * only be followed and logged against. The count on "Shared with me" is the
 * invitations waiting, so a new one is noticed without opening the tab.
 */
export function VehicleScopeToggle({
  value,
  onChange,
}: {
  value: VehicleScope;
  onChange: (value: VehicleScope) => void;
}) {
  const shared = useSharedWithMe();
  const waiting = shared.data?.invitations.length ?? 0;

  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as VehicleScope)}>
      <TabsList aria-label="Which vehicles to show">
        <TabsTrigger value="mine">Mine</TabsTrigger>
        <TabsTrigger value="shared" className="gap-1.5">
          Shared with me
          {waiting > 0 ? (
            <Badge size="sm" variant="default" aria-label={`${waiting} waiting`}>
              {waiting}
            </Badge>
          ) : null}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
