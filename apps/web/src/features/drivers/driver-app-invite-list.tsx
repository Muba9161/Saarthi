import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, BellRing, Check } from 'lucide-react';
import { api, errorMessage } from '@/lib/api-client';
import type { DriverSummary, Paginated } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** `GET /drivers/app-invites` — who has already been asked to install the app. */
export interface DriverAppInviteStatus {
  invitedDriverIds: string[];
  driverCount: number;
}

export function useDriverAppInviteStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['drivers', 'app-invites', 'status'],
    queryFn: () => api.get<DriverAppInviteStatus>('/drivers/app-invites'),
    enabled,
  });
}

/**
 * Ask drivers to install the Saarthi Driver App, one at a time or all at once.
 *
 * Used beside the trackers wherever an owner decides how a vehicle reports its
 * location — the telemetry screen and the add-vehicle form.
 */
export function DriverAppInviteList({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [notified, setNotified] = React.useState<Set<string>>(new Set());

  const drivers = useQuery({
    queryKey: ['drivers', 'app-invite'],
    queryFn: () => api.get<Paginated<DriverSummary>>('/drivers', { pageSize: 100 }),
    enabled,
  });

  const invite = useMutation({
    mutationFn: (driverIds: string[]) =>
      api.post<{ notified: number; skipped: number }>('/drivers/app-invites', { driverIds }),
    onSuccess: (result, driverIds) => {
      setNotified((current) => new Set([...current, ...driverIds]));
      void queryClient.invalidateQueries({ queryKey: ['drivers', 'app-invites', 'status'] });
      toast.success(
        result.notified > 0
          ? `${result.notified} driver${result.notified === 1 ? '' : 's'} notified`
          : 'Already notified in the last hour',
      );
    },
    onError: (error) => toast.error('Could not notify', { description: errorMessage(error) }),
  });

  const list = drivers.data?.items ?? [];
  const pendingIds = list.filter((driver) => !notified.has(driver.id)).map((driver) => driver.id);

  if (drivers.isLoading) return <p className="text-xs text-muted-foreground">Loading drivers…</p>;

  if (list.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        No drivers yet. Add drivers from the Drivers screen, then notify them here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {pendingIds.length > 1 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => invite.mutate(pendingIds)}
            loading={invite.isPending && (invite.variables?.length ?? 0) > 1}
          >
            <BellRing className="mr-1 size-3.5" aria-hidden />
            Notify all
          </Button>
        </div>
      ) : null}
      <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
        {list.map((driver) => {
          const done = notified.has(driver.id);
          return (
            <li key={driver.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{driver.fullName}</p>
                <p className="truncate text-2xs text-muted-foreground">{driver.phone ?? driver.email}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={done ? 'ghost' : 'outline'}
                disabled={done}
                onClick={() => invite.mutate([driver.id])}
                loading={invite.isPending && invite.variables?.length === 1 && invite.variables[0] === driver.id}
                aria-label={done ? `${driver.fullName} notified` : `Notify ${driver.fullName}`}
              >
                {done ? (
                  <Check className={cn('mr-1 size-3.5 text-success')} aria-hidden />
                ) : (
                  <Bell className="mr-1 size-3.5" aria-hidden />
                )}
                {done ? 'Notified' : 'Notify'}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
