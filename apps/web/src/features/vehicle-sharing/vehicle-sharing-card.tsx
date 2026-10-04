import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Share2, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  MAX_VEHICLE_SHARES,
  Permission,
  VehicleOwnershipStatus,
  VehicleShareStatus,
  relativeTimeFrom,
} from '@saarthi/shared';
import { errorMessage } from '@/lib/api-client';
import { useAuth } from '@/features/auth/auth-context';
import { SectionHeader } from '@/components/common/page-header';
import { ErrorState, LoadingState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  endShare,
  shareVehicle,
  sharesOfVehicleKey,
  useSharingAvailable,
  useVehicleShares,
} from './sharing-api';
import { cn } from '@/lib/utils';

/**
 * Share this vehicle with other Saarthi accounts — the owner's side.
 *
 * Up to three people; they accept before they see anything, can track the
 * vehicle and add its trips, fuel and maintenance, and never see its costs,
 * finance, documents or full RC. The vehicle stays on this account's bill
 * alone. Rendered only for an account whose plan includes sharing and a
 * person who may edit vehicles.
 */
export function VehicleSharingCard({
  vehicleId,
  ownershipStatus,
  className,
}: {
  vehicleId: string;
  ownershipStatus: string;
  className?: string;
}) {
  const { can } = useAuth();
  const available = useSharingAvailable() && can(Permission.VEHICLES_UPDATE);
  const confirmed = ownershipStatus === VehicleOwnershipStatus.VERIFIED;
  const queryClient = useQueryClient();
  const shares = useVehicleShares(vehicleId, available && confirmed);
  const [email, setEmail] = React.useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: sharesOfVehicleKey(vehicleId) });

  const invite = useMutation({
    mutationFn: () => shareVehicle(vehicleId, email.trim()),
    onSuccess: () => {
      toast.success('Invitation sent', { description: 'It appears once they accept it.' });
      setEmail('');
      void refresh();
    },
    onError: (error) => toast.error('Could not share it', { description: errorMessage(error) }),
  });

  const revoke = useMutation({
    mutationFn: (shareId: string) => endShare(shareId),
    onSuccess: () => {
      toast.success('Stopped sharing');
      void refresh();
    },
    onError: (error) => toast.error('Could not stop sharing', { description: errorMessage(error) }),
  });

  if (!available) return null;

  const list = shares.data ?? [];
  const full = list.length >= MAX_VEHICLE_SHARES;

  return (
    <Card className={cn('rounded-2xl', className)}>
      <CardHeader className="pb-2">
        <SectionHeader
          title="Sharing"
          description={`Let up to ${MAX_VEHICLE_SHARES} people on Saarthi track this vehicle and add its trips, fuel and maintenance. It stays on your bill only.`}
          actions={<Share2 className="size-4 text-muted-foreground" aria-hidden />}
        />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {!confirmed ? (
          <p className="text-sm text-muted-foreground">
            Confirm that you own this vehicle first — its Ownership card shows how.
          </p>
        ) : shares.isLoading ? (
          <LoadingState className="min-h-20" />
        ) : shares.isError ? (
          <ErrorState error={shares.error} onRetry={() => void shares.refetch()} />
        ) : (
          <>
            {list.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg ring-1 ring-border">
                {list.map((share) => (
                  <li key={share.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{share.sharedWith.name}</p>
                      <p className="truncate text-2xs text-muted-foreground">
                        {share.sharedWith.email} · invited {relativeTimeFrom(share.invitedAt)}
                      </p>
                    </div>
                    <Badge
                      size="sm"
                      variant={share.status === VehicleShareStatus.ACTIVE ? 'success' : 'muted'}
                    >
                      {share.status === VehicleShareStatus.ACTIVE ? 'Sharing' : 'Invited'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Stop sharing with ${share.sharedWith.name}`}
                      loading={revoke.isPending && revoke.variables === share.id}
                      onClick={() => revoke.mutate(share.id)}
                    >
                      <UserMinus className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {full ? (
              <p className="text-xs text-muted-foreground">
                Shared with {MAX_VEHICLE_SHARES} people — the most one vehicle can be. Stop sharing
                with someone to invite another.
              </p>
            ) : (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (email.trim()) invite.mutate();
                }}
              >
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={`share-email-${vehicleId}`}>Their Saarthi email</Label>
                  <Input
                    id={`share-email-${vehicleId}`}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <Button type="submit" disabled={!email.trim()} loading={invite.isPending}>
                  <UserPlus className="size-4" aria-hidden />
                  Share
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
