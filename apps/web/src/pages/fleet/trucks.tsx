import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Gauge, IdCard, Plus, Search, Truck } from 'lucide-react';
import { toast } from 'sonner';
import {
  FuelType,
  Permission,
  TruckStatus,
  TruckType,
  createTruckSchema,
  formatNumber,
  formatRegistrationNumber,
  humanizeEnum,
  type CreateTruckInput,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { Paginated, TruckSummary } from '@/lib/api-types';
import { useAuth } from '@/features/auth/auth-context';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { ScoreBadge, StatusBadge } from '@/components/common/status-badge';
import { UnauthorizedState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  ...Object.values(TruckStatus).map((status) => ({ value: status, label: humanizeEnum(status) })),
];

/**
 * Add a truck.
 *
 * Three steps rather than seven stacked fields: the registration number is the
 * one thing that must be right and unique, so it is asked alone; the body type
 * and capacity decide what loads the vehicle can be matched to; the rest is
 * detail the fleet fills in when it has it.
 */
function AddTruckDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const form = useForm<CreateTruckInput>({
    resolver: zodResolver(createTruckSchema),
    defaultValues: {
      registrationNumber: '',
      truckType: TruckType.OPEN_BODY,
      manufacturer: '',
      model: '',
      capacityTons: 20,
      fuelType: FuelType.DIESEL,
      odometerKm: 0,
      shareLocation: true,
    },
  });

  const mutation = useMutation({
    mutationFn: (input: CreateTruckInput) => api.post<TruckSummary>('/trucks', input),
    onSuccess: (truck) => {
      toast.success('Truck added', {
        description: `${formatRegistrationNumber(truck.registrationNumber)} is now in your fleet. Upload its documents to start verification.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['trucks'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      form.reset();
      onOpenChange(false);
    },
    onError: (error) => {
      const fields =
        error instanceof Error && 'fieldErrors' in error
          ? (error as { fieldErrors: Record<string, string[]> }).fieldErrors
          : {};
      const registration = fields.registrationNumber?.[0];
      if (registration) {
        form.setError('registrationNumber', { message: registration });
      } else {
        toast.error('Could not add truck', { description: errorMessage(error) });
      }
    },
  });

  const steps: WizardStep[] = [
    {
      id: 'registration',
      title: 'Registration',
      description: 'The plate on the vehicle.',
      icon: IdCard,
      fields: ['registrationNumber'],
      content: (
        <FormField
          control={form.control}
          name="registrationNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>Registration number</FormLabel>
              <FormControl>
                <Input {...field} placeholder="UP 16 AB 1234" className="uppercase" autoFocus />
              </FormControl>
              <FormDescription>Spaces and dashes are ignored.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      ),
    },
    {
      id: 'body',
      title: 'Body & capacity',
      description: 'What loads it can take.',
      icon: Truck,
      fields: ['truckType', 'capacityTons'],
      content: (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="truckType"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Body type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.values(TruckType).map((type) => (
                      <SelectItem key={type} value={type}>
                        {humanizeEnum(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="capacityTons"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Capacity (tonnes)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={field.value}
                    onChange={(event) => field.onChange(Number(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ),
    },
    {
      id: 'details',
      title: 'Make & usage',
      description: 'Everything else we know.',
      icon: Gauge,
      optional: true,
      fields: ['manufacturer', 'model', 'fuelType', 'odometerKm'],
      content: (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="manufacturer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Manufacturer</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} placeholder="Tata Motors" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} placeholder="Signa 4825.TK" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="fuelType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fuel</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.values(FuelType).map((fuel) => (
                        <SelectItem key={fuel} value={fuel}>
                          {humanizeEnum(fuel)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="odometerKm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Odometer (km)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      value={field.value}
                      onChange={(event) => field.onChange(Number(event.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </>
      ),
    },
  ];

  const erroredStepIds = steps
    .filter((step) => step.fields?.some((name) => name in form.formState.errors))
    .map((step) => step.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>Add a truck</DialogTitle>
          <DialogDescription>
            The vehicle starts unverified. Upload its RC, insurance, fitness, permit and PUC to
            submit it for verification.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <FormWizard
            steps={steps}
            className={WIZARD_IN_DIALOG}
            panelClassName={WIZARD_DIALOG_PANEL}
            resetKey={open}
            onValidateStep={(step) =>
              step.fields?.length
                ? form.trigger(step.fields as (keyof CreateTruckInput)[], { shouldFocus: true })
                : true
            }
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            submitting={mutation.isPending}
            submitLabel="Add truck"
            erroredStepIds={erroredStepIds}
            footerStart={
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            }
          />
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function TrucksPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [addOpen, setAddOpen] = React.useState(false);

  // Debounce so typing does not fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['trucks', { page, search: debouncedSearch, status }],
    queryFn: () =>
      api.get<Paginated<TruckSummary>>('/trucks', {
        page,
        pageSize: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(status !== 'all' ? { status } : {}),
      }),
    enabled: can(Permission.TRUCKS_READ),
    placeholderData: keepPreviousData,
  });

  if (!can(Permission.TRUCKS_READ)) {
    return <UnauthorizedState />;
  }

  const columns: Column<TruckSummary>[] = [
    {
      key: 'registration',
      header: 'Vehicle',
      cell: (truck) => (
        <div className="min-w-0">
          <p className="font-medium">{formatRegistrationNumber(truck.registrationNumber)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[truck.manufacturer, truck.model].filter(Boolean).join(' ') ||
              humanizeEnum(truck.truckType)}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      hideOnMobile: true,
      cell: (truck) => (
        <span className="text-sm">
          {humanizeEnum(truck.truckType)}
          <span className="tabular block text-xs text-muted-foreground">{truck.capacityTons}T</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (truck) => <StatusBadge status={truck.status} /> },
    {
      key: 'driver',
      header: 'Driver',
      hideOnMobile: true,
      cell: (truck) =>
        truck.currentDriver ? (
          <div className="flex items-center gap-2">
            <span className="truncate text-sm">{truck.currentDriver.name}</span>
            <ScoreBadge score={truck.currentDriver.overallScore} />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Unassigned</span>
        ),
    },
    {
      key: 'compliance',
      header: 'Documents',
      hideOnMobile: true,
      cell: (truck) => {
        const { expired, expiringSoon, pending, total } = truck.documentHealth;
        if (total === 0) {
          return <Badge variant="muted">None uploaded</Badge>;
        }
        if (expired > 0) {
          return (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="size-3" />
              {expired} expired
            </Badge>
          );
        }
        if (expiringSoon > 0) return <Badge variant="warning">{expiringSoon} expiring</Badge>;
        if (pending > 0) return <Badge variant="info">{pending} in review</Badge>;
        return <Badge variant="success">All valid</Badge>;
      },
    },
    {
      key: 'verification',
      header: 'Verification',
      hideOnMobile: true,
      cell: (truck) => <StatusBadge status={truck.verificationStatus} size="sm" />,
    },
    {
      key: 'odometer',
      header: 'Odometer',
      numeric: true,
      hideOnMobile: true,
      cell: (truck) => <span className="text-sm">{formatNumber(Math.round(truck.odometerKm))} km</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trucks"
        description="Every vehicle in your fleet, with live status and document health."
        actions={
          can(Permission.TRUCKS_CREATE) ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add truck
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by registration, make or model…"
            className="pl-9"
            aria-label="Search trucks"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((filter) => (
              <SelectItem key={filter.value} value={filter.value}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={query.data?.items}
        rowKey={(truck) => truck.id}
        isLoading={query.isLoading || query.isFetching}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(truck) => navigate(`/fleet/trucks/${truck.id}`)}
        {...(query.data?.pagination ? { pagination: query.data.pagination } : {})}
        onPageChange={setPage}
        emptyTitle={debouncedSearch || status !== 'all' ? 'No matching trucks' : 'No trucks yet'}
        emptyDescription={
          debouncedSearch || status !== 'all'
            ? 'Try clearing the filters.'
            : 'Add your first truck to start managing your fleet.'
        }
        emptyAction={
          can(Permission.TRUCKS_CREATE) && !debouncedSearch && status === 'all' ? (
            <Button onClick={() => setAddOpen(true)}>
              <Truck className="size-4" />
              Add your first truck
            </Button>
          ) : undefined
        }
      />

      <AddTruckDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

export default TrucksPage;
