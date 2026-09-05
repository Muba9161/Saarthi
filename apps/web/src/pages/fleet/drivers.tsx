import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Contact, IdCard, Plus, Search, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  MediaOwnerType,
  MediaPurpose,
  Permission,
  createDriverSchema,
  formatDistanceKm,
  type CreateDriverInput,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { DriverSummary, Paginated } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataView, type Column } from '@/components/common/data-view';
import { ScoreBadge, StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  FormWizard,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';
import { ImageCircleField } from '@/components/common/file-dropzone';
import { uploadImageOrWarn } from '@/features/media/upload-image';

/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const PHOTO_MAX_SIZE_MB = 5;
const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

/**
 * Add a driver.
 *
 * Saarthi creates the account, so the questions split cleanly into who the
 * person is, how the platform reaches them, and what licenses them to drive.
 * The licence step is last because it is the one an owner most often has to go
 * and find — and by then the account details are already entered rather than
 * lost to an abandoned dialog.
 */
function AddDriverDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [setupUrl, setSetupUrl] = React.useState<string | null>(null);
  /**
   * Held until the driver record exists: media is addressed to an owner id,
   * and there is nothing to own the photograph until the account is created.
   */
  const [photo, setPhoto] = React.useState<File | null>(null);

  const form = useForm<CreateDriverInput>({
    resolver: zodResolver(createDriverSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      licenseNumber: '',
      experienceYears: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: CreateDriverInput) => {
      const result = await api.post<{ driver: DriverSummary; setupUrl: string }>('/drivers', input);
      // Inside the mutation rather than after it, so the submit button stays
      // busy until the photograph has actually landed.
      if (photo) {
        await uploadImageOrWarn(
          {
            ownerType: MediaOwnerType.DRIVER,
            ownerId: result.driver.id,
            purpose: MediaPurpose.AVATAR,
            file: photo,
          },
          'The driver was added, but their photo could not be saved.',
        );
      }
      return result;
    },
    onSuccess: (result) => {
      toast.success('Driver account created');
      // There is no email provider locally, so the one-time link is surfaced here.
      setSetupUrl(result.setupUrl);
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['media'] });
      setPhoto(null);
      form.reset();
    },
    onError: (error) => toast.error('Could not add driver', { description: errorMessage(error) }),
  });

  const close = (next: boolean): void => {
    onOpenChange(next);
    if (!next) setSetupUrl(null);
  };

  const steps: WizardStep[] = [
    {
      id: 'name',
      title: 'Name',
      description: 'Who is driving.',
      icon: UserRound,
      fields: ['firstName', 'lastName'],
      content: (
        <>
          <ImageCircleField
            value={photo}
            onChange={setPhoto}
            label="Driver photo"
            hint={`Optional · JPEG, PNG, WebP or HEIC up to ${PHOTO_MAX_SIZE_MB} MB`}
            accept={PHOTO_ACCEPT}
            maxSizeMb={PHOTO_MAX_SIZE_MB}
            icon={UserRound}
            onReject={(reason) => toast.error(reason)}
            className="pb-1"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>First name</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Last name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </>
      ),
    },
    {
      id: 'contact',
      title: 'Contact',
      description: 'Where the invite goes.',
      icon: Contact,
      fields: ['email', 'phone'],
      content: (
        <>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Email</FormLabel>
                <FormControl>
                  <Input {...field} type="email" />
                </FormControl>
                <FormDescription>The one-time password link is sent here.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Mobile number</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="9876543210" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ),
    },
    {
      id: 'licence',
      title: 'Licence',
      description: 'What lets them drive.',
      icon: IdCard,
      fields: ['licenseNumber', 'licenseExpiryDate', 'experienceYears'],
      content: (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="licenseNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Licence number</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="licenseExpiryDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Licence expiry</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      value={field.value ? String(field.value).slice(0, 10) : ''}
                      onChange={(event) => field.onChange(event.target.value || undefined)}
                    />
                  </FormControl>
                  <FormDescription>Feeds the compliance score.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="experienceYears"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Experience (years)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    value={field.value}
                    onChange={(event) => field.onChange(Number(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ),
    },
  ];

  const erroredStepIds = steps
    .filter((step) => step.fields?.some((name) => name in form.formState.errors))
    .map((step) => step.id);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className={
          setupUrl ? 'max-w-lg' : `${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`
        }
      >
        <DialogHeader className={setupUrl ? undefined : WIZARD_DIALOG_HEADER}>
          <DialogTitle>Add a driver</DialogTitle>
          <DialogDescription>
            Saarthi creates the account and issues a one-time link so the driver chooses their own
            password.
          </DialogDescription>
        </DialogHeader>

        {setupUrl ? (
          <div className="space-y-4">
            <Alert variant="success">
              <AlertTitle>Driver added</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>Share this one-time link so they can set a password:</p>
                <code className="block break-all rounded bg-muted p-2 text-xs">{setupUrl}</code>
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSetupUrl(null)}>
                Add another
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <FormWizard
              steps={steps}
              className={WIZARD_IN_DIALOG}
              panelClassName={WIZARD_DIALOG_PANEL}
              resetKey={open}
              onValidateStep={(step) =>
                step.fields?.length
                  ? form.trigger(step.fields as (keyof CreateDriverInput)[], { shouldFocus: true })
                  : true
              }
              onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
              submitting={mutation.isPending}
              submitLabel="Add driver"
              erroredStepIds={erroredStepIds}
              footerStart={
                <Button type="button" variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
              }
            />
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DriversPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [addOpen, setAddOpen] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['drivers', { page, search: debounced }],
    queryFn: () =>
      api.get<Paginated<DriverSummary>>('/drivers', {
        page,
        pageSize: 20,
        ...(debounced ? { search: debounced } : {}),
      }),
    enabled: can(Permission.DRIVERS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.DRIVERS_READ)) return <UnauthorizedState />;

  const columns: Column<DriverSummary>[] = [
    {
      key: 'name',
      header: 'Driver',
      cell: (driver) => (
        <div className="min-w-0">
          <p className="font-medium">{driver.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{driver.email}</p>
        </div>
      ),
    },
    {
      key: 'licence',
      header: 'Licence',
      hideOnMobile: true,
      cell: (driver) => (
        <div>
          <p className="text-sm">{driver.licenseNumber}</p>
          <p className="text-xs text-muted-foreground">
            {driver.licenseExpiryDate
              ? `Expires ${new Date(driver.licenseExpiryDate).toLocaleDateString('en-IN')}`
              : 'No expiry recorded'}
          </p>
        </div>
      ),
    },
    {
      key: 'availability',
      header: 'Availability',
      cell: (driver) => <StatusBadge status={driver.availability} />,
    },
    {
      key: 'verification',
      header: 'Verification',
      hideOnMobile: true,
      cell: (driver) => <StatusBadge status={driver.verificationStatus} size="sm" />,
    },
    {
      key: 'truck',
      header: 'Truck',
      hideOnMobile: true,
      cell: (driver) =>
        driver.currentTruck ? (
          <span className="text-sm">{driver.currentTruck.registrationNumber}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Unassigned</span>
        ),
    },
    {
      key: 'score',
      header: 'Score',
      numeric: true,
      cell: (driver) => <ScoreBadge score={driver.overallScore} />,
    },
    {
      key: 'trips',
      header: 'Trips',
      numeric: true,
      hideOnMobile: true,
      cell: (driver) => (
        <div className="text-sm">
          <p>{driver.totalTrips}</p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceKm(driver.totalDistanceKm)}
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        description="Profiles, verification, assignments and performance."
        actions={
          can(Permission.DRIVERS_MANAGE) ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add driver
            </Button>
          ) : null
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, email, phone or licence…"
          className="pl-9"
          aria-label="Search drivers"
        />
      </div>

      <DataView
        surface="fleet.drivers"
        columns={columns}
        rows={query.data?.items}
        rowKey={(driver) => driver.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(driver) => navigate(`/fleet/drivers/${driver.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle={debounced ? 'No matching drivers' : 'No drivers yet'}
        emptyDescription={
          debounced
            ? 'Try a different search.'
            : 'Add a driver here, or share your fleet invite code so they can register themselves.'
        }
        emptyAction={
          can(Permission.DRIVERS_MANAGE) && !debounced ? (
            <Button onClick={() => setAddOpen(true)}>
              <Users className="size-4" />
              Add your first driver
            </Button>
          ) : undefined
        }
      />

      <AddDriverDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

export default DriversPage;
