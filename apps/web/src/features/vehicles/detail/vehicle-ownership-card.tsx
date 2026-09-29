import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  Permission,
  VehicleOwnershipStatus,
  formatDate,
  type VehicleOwnershipView,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

/**
 * Whether this account has shown it owns the vehicle.
 *
 * Not the same as the RC being verified: that proves the plate is real, this
 * proves it is theirs — automatically, by the RC owner's name matching a
 * verified PAN, Voter ID or business GSTIN on the account. Until it does, the
 * RC stays masked and the vehicle cannot be advertised for sale; everything
 * else, driver assignment included, works as normal. So the card says plainly
 * what is missing and offers the one thing to do about it: check again once
 * that verified name is in place.
 */
export function VehicleOwnershipCard({
  vehicleId,
  ownership,
}: {
  vehicleId: string;
  ownership: VehicleOwnershipView;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canAct = can(Permission.VEHICLES_UPDATE);

  const recheck = useMutation({
    mutationFn: () =>
      api.post<VehicleOwnershipView>(`/fleet/vehicles/${vehicleId}/ownership/check`),
    onSuccess: (result) => {
      if (result.status === VehicleOwnershipStatus.VERIFIED) toast.success('Ownership confirmed');
      else toast.info('Not confirmed yet', { description: result.note ?? undefined });
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (error) =>
      toast.error('Could not check ownership', { description: errorMessage(error) }),
  });

  const verified = ownership.status === VehicleOwnershipStatus.VERIFIED;
  const pending = ownership.status === VehicleOwnershipStatus.PENDING;
  const Icon = verified ? ShieldCheck : ShieldAlert;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <SectionHeader
          title="Ownership"
          description={
            verified
              ? 'This account has shown it owns the vehicle.'
              : 'Full RC details and selling this vehicle unlock once the RC owner matches a verified name on this account.'
          }
          actions={<StatusBadge status={ownership.status} />}
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-start gap-3">
          <Icon
            aria-hidden
            className={
              verified
                ? 'mt-0.5 size-5 shrink-0 text-success'
                : 'mt-0.5 size-5 shrink-0 text-warning'
            }
          />
          <div className="space-y-1 text-sm">
            <p>
              {verified
                ? 'The RC owner matches a verified name on this account.'
                : (ownership.note ?? 'Ownership has not been checked yet.')}
            </p>
            {verified && ownership.verifiedAt ? (
              <p className="text-muted-foreground">
                Confirmed on {formatDate(ownership.verifiedAt)}.
              </p>
            ) : null}
          </div>
        </div>

        {pending && canAct ? (
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => recheck.mutate()}
            loading={recheck.isPending}
          >
            <RefreshCw className="size-4" aria-hidden />
            Check again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
