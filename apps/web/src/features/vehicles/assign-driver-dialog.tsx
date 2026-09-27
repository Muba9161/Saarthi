import * as React from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, ShieldAlert, UserRound, Users, type LucideIcon } from 'lucide-react';
import {
  Permission,
  VerificationStatus,
  selfDriverSchema,
  type SelfDriverInput,
} from '@saarthi/shared';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import type { DriverSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { EmptyState, LoadingState } from '@/components/common/states';
import { AnimatePresence, motion } from '@/components/motion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Who drives this vehicle: the owner themselves, or one of their drivers.
 *
 * The owner is asked here rather than at registration. Whether somebody drives
 * is a fact about a vehicle, not about the account — the same owner may drive
 * one car and employ drivers for the rest — and this is the moment it matters,
 * on Personal and Business alike.
 *
 * Assigning yourself the first time adds you to your own driver list against
 * your own account (`POST /drivers/me`), so your trips and score stay yours.
 * You are then assignable under the same rules as anybody you employ: verified,
 * and not already on another vehicle.
 */

type AssignMode = 'self' | 'driver';

const MODES: { id: AssignMode; icon: LucideIcon; title: string; description: string }[] = [
  {
    id: 'self',
    icon: UserRound,
    title: 'Assign to yourself',
    description: 'You drive this vehicle.',
  },
  {
    id: 'driver',
    icon: Users,
    title: 'Assign to a driver',
    description: 'Someone from your driver list drives it.',
  },
];

const EASE = [0.16, 1, 0.3, 1] as const;

export function AssignDriverDialog({
  vehicleId,
  vehicleLabel,
  open,
  onOpenChange,
}: {
  vehicleId: string;
  /** What the vehicle is, so the copy reads right for a taxi as for a truck. */
  vehicleLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { can, session, refreshSession } = useAuth();
  const self = session?.driver ?? null;
  // An owner can add themselves; somebody who already has a profile here can
  // be assigned with it even without that permission.
  const canSelfAssign = can(Permission.DRIVERS_MANAGE) || self !== null;

  const [mode, setMode] = React.useState<AssignMode | null>(canSelfAssign ? null : 'driver');
  const [driverId, setDriverId] = React.useState('');

  const form = useForm<SelfDriverInput>({
    resolver: zodResolver(selfDriverSchema),
    defaultValues: { licenseNumber: '' },
  });

  const reset = React.useCallback(() => {
    setMode(canSelfAssign ? null : 'driver');
    setDriverId('');
    form.reset({ licenseNumber: '' });
  }, [canSelfAssign, form]);

  const close = (next: boolean): void => {
    onOpenChange(next);
    if (!next) reset();
  };

  const drivers = useQuery({
    queryKey: ['drivers', 'assignable'],
    queryFn: () =>
      api.get<Paginated<DriverSummary>>('/drivers', {
        assigned: 'false',
        verificationStatus: 'VERIFIED',
        pageSize: 100,
      }),
    enabled: open && mode === 'driver',
  });

  const onAssigned = (message: string): void => {
    toast.success(message);
    for (const key of ['vehicle', 'truck'] as const) {
      void queryClient.invalidateQueries({ queryKey: [key, vehicleId] });
    }
    for (const key of ['vehicles', 'trucks', 'drivers'] as const) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    close(false);
  };

  const assignDriver = useMutation({
    mutationFn: () => api.post(`/trucks/${vehicleId}/assign-driver`, { driverId }),
    onSuccess: () => onAssigned('Driver assigned'),
    onError: (error) =>
      toast.error('Could not assign driver', { description: errorMessage(error) }),
  });

  const assignSelf = useMutation({
    mutationFn: async (input: SelfDriverInput | null): Promise<'assigned' | 'pending'> => {
      let profile: Pick<DriverSummary, 'id' | 'verificationStatus'> | null = self;
      if (!profile) {
        profile = await api.post<DriverSummary>('/drivers/me', input);
        // The session carries the profile — it is what adds "My driving".
        await refreshSession();
        void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      }
      if (profile.verificationStatus !== VerificationStatus.VERIFIED) return 'pending';
      await api.post(`/trucks/${vehicleId}/assign-driver`, { driverId: profile.id });
      return 'assigned';
    },
    onSuccess: (outcome) => {
      if (outcome === 'assigned') {
        onAssigned(`You are assigned to this ${vehicleLabel}`);
        return;
      }
      // Pending stays open: the refreshed session now shows what is missing.
      toast.info('You are on your driver list', {
        description: 'Complete your licence verification, then assign yourself.',
      });
    },
    onError: (error) => {
      const licenceError =
        error instanceof ApiError ? error.fieldErrors.licenseNumber?.[0] : undefined;
      if (licenceError) form.setError('licenseNumber', { message: licenceError });
      else toast.error('Could not assign you', { description: errorMessage(error) });
    },
  });

  // Yourself is never offered in the list — that is what the other choice is for.
  const available = (drivers.data?.items ?? []).filter((driver) => driver.id !== self?.id);
  const selfPending = self !== null && self.verificationStatus !== VerificationStatus.VERIFIED;
  const selfElsewhere =
    self !== null && self.currentTruckId !== null && self.currentTruckId !== vehicleId;

  const submitSelf = self
    ? () => assignSelf.mutate(null)
    : form.handleSubmit((values) => assignSelf.mutate(values));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who drives this {vehicleLabel}?</DialogTitle>
          <DialogDescription>
            Only verified drivers who are not already on another vehicle can be assigned.
          </DialogDescription>
        </DialogHeader>

        {canSelfAssign ? (
          <div role="radiogroup" aria-label="Who drives this vehicle" className="grid gap-2.5 sm:grid-cols-2">
            {MODES.map((option) => {
              const selected = mode === option.id;
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(option.id)}
                  whileTap={{ scale: 0.985 }}
                  className={cn(
                    'glass-inset relative flex items-start gap-3 p-3 pr-8 text-left',
                    'transition-[background-color,border-color,box-shadow] duration-200 ease-smooth',
                    selected
                      ? 'glass-choice-selected'
                      : 'hover:border-white/70 hover:bg-white/60 dark:hover:bg-white/[0.06]',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
                      selected
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted/60 text-muted-foreground dark:bg-white/[0.06]',
                    )}
                  >
                    <option.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                  {selected ? (
                    <span
                      className="absolute right-2.5 top-2.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      aria-hidden
                    >
                      <Check className="size-2.5" strokeWidth={4} />
                    </span>
                  ) : null}
                </motion.button>
              );
            })}
          </div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          {mode ? (
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {mode === 'driver' ? (
                drivers.isLoading ? (
                  <LoadingState label="Loading drivers…" />
                ) : available.length === 0 ? (
                  <EmptyState
                    title="No available verified drivers"
                    description="Add a driver and complete their verification before assigning a vehicle."
                    className="min-h-32"
                  />
                ) : (
                  <Select value={driverId} onValueChange={setDriverId}>
                    <SelectTrigger aria-label="Driver">
                      <SelectValue placeholder="Choose a driver" />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.fullName}
                          {driver.overallScore !== null ? ` · score ${driver.overallScore}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              ) : self ? (
                <SelfProfileStatus
                  licenseNumber={self.licenseNumber}
                  driverId={self.id}
                  pending={selfPending}
                  elsewhereVehicleId={selfElsewhere ? self.currentTruckId : null}
                />
              ) : (
                <form
                  className="space-y-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitSelf();
                  }}
                >
                  <Label htmlFor="self-licence">Your driving licence number</Label>
                  <Input
                    id="self-licence"
                    {...form.register('licenseNumber')}
                    placeholder="DL-1420-20100000000"
                    autoComplete="off"
                    className="h-10"
                    aria-invalid={Boolean(form.formState.errors.licenseNumber)}
                  />
                  {form.formState.errors.licenseNumber ? (
                    <p className="text-xs font-medium text-destructive">
                      {form.formState.errors.licenseNumber.message}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Adds you to your own driver list. Your trips, duty hours and score stay on
                      your account.
                    </p>
                  )}
                </form>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          {mode === 'self' ? (
            <Button
              disabled={selfPending || selfElsewhere}
              loading={assignSelf.isPending}
              onClick={() => void submitSelf()}
            >
              {self ? 'Assign to me' : 'Add me and assign'}
            </Button>
          ) : (
            <Button
              disabled={mode !== 'driver' || !driverId}
              loading={assignDriver.isPending}
              onClick={() => assignDriver.mutate()}
            >
              Assign
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The owner's own driver profile, and whatever still stands in its way. */
function SelfProfileStatus({
  licenseNumber,
  driverId,
  pending,
  elsewhereVehicleId,
}: {
  licenseNumber: string;
  driverId: string;
  pending: boolean;
  elsewhereVehicleId: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="glass-inset flex items-center gap-3 p-3">
        <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 text-sm">
          You <span className="text-muted-foreground">· licence {licenseNumber}</span>
        </p>
      </div>
      {pending ? (
        <Alert>
          <ShieldAlert className="size-4" />
          <AlertDescription>
            Your licence and identity are not verified yet.{' '}
            <Link to={`/fleet/drivers/${driverId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              Complete verification
            </Link>{' '}
            to assign yourself.
          </AlertDescription>
        </Alert>
      ) : elsewhereVehicleId ? (
        <Alert>
          <ShieldAlert className="size-4" />
          <AlertDescription>
            You are already assigned to{' '}
            <Link to={`/fleet/vehicles/${elsewhereVehicleId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              another vehicle
            </Link>
            . Unassign yourself there first.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export default AssignDriverDialog;
