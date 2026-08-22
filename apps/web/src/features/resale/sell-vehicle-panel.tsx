import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, IndianRupee, Megaphone, Undo2 } from 'lucide-react';
import {
  LISTING_MEDIA_REQUIREMENTS,
  MediaOwnerType,
  MediaPurpose,
  VEHICLE_CONDITION_LABELS,
  VISIBILITY_LABELS,
  VehicleCondition,
  VehicleListingStatus,
  VehicleListingVisibility,
  formatRegistrationNumber,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { LoadingState } from '@/components/common/states';
import { PhotoUploader } from '@/features/media/photo-uploader';

/**
 * Sell this vehicle.
 *
 * The form starts from what Saarthi already knows — registration, make, model,
 * year, odometer — and asks only for what it cannot: condition, price,
 * ownership count, accident history. Re-typing an odometer reading the platform
 * has recorded for two years would be both tedious and less trustworthy.
 *
 * Publishing is gated on the vehicle being genuinely sellable and on there
 * being enough photographs to judge it. Those blockers are listed up front
 * rather than revealed one per failed submission.
 */

/** What the seller-side API returns for a listing. */
interface SellerListing {
  listing: {
    id: string;
    reference: string;
    status: VehicleListingStatus;
    visibility: VehicleListingVisibility;
    title: string;
    description: string | null;
    askingPrice: string | number;
    negotiable: boolean;
    minimumPrice: string | number | null;
    condition: VehicleCondition;
    odometerKm: number;
    ownershipCount: number;
    accidentHistory: boolean;
    accidentNote: string | null;
    majorRepairsNote: string | null;
    tyreConditionPercent: number | null;
    engineConditionNote: string | null;
    city: string | null;
    state: string | null;
    publishedAt: string | null;
  };
  photos: { exterior: number; odometer: number; total: number };
  readiness: { ready: boolean; blockers: string[] };
}

export interface SellVehiclePanelProps {
  vehicleId: string;
  registrationNumber: string;
  /** Prefilled from the vehicle record so the seller does not retype them. */
  manufacturer?: string | null;
  model?: string | null;
  year?: number | null;
  odometerKm?: number;
}

interface FormState {
  title: string;
  description: string;
  askingPrice: string;
  negotiable: boolean;
  minimumPrice: string;
  condition: VehicleCondition;
  odometerKm: string;
  ownershipCount: string;
  accidentHistory: boolean;
  accidentNote: string;
  majorRepairsNote: string;
  tyreConditionPercent: string;
  engineConditionNote: string;
  city: string;
  state: string;
  visibility: VehicleListingVisibility;
}

const STATUS_TONE: Partial<Record<VehicleListingStatus, 'success' | 'warning' | 'muted' | 'destructive'>> =
  {
    [VehicleListingStatus.PUBLISHED]: 'success',
    [VehicleListingStatus.DRAFT]: 'muted',
    [VehicleListingStatus.PENDING_REVIEW]: 'warning',
    [VehicleListingStatus.RESERVED]: 'warning',
    [VehicleListingStatus.SOLD]: 'success',
    [VehicleListingStatus.WITHDRAWN]: 'muted',
    [VehicleListingStatus.REJECTED]: 'destructive',
  };

export function SellVehiclePanel({
  vehicleId,
  registrationNumber,
  manufacturer,
  model,
  year,
  odometerKm = 0,
}: SellVehiclePanelProps) {
  const queryClient = useQueryClient();

  const listingQuery = useQuery({
    queryKey: ['resale-listing', vehicleId],
    queryFn: () => api.get<SellerListing | null>(`/resale/listings/vehicle/${vehicleId}`),
    enabled: Boolean(vehicleId),
  });

  const existing = listingQuery.data ?? null;

  /** Seed the form from the vehicle, then from the listing once one exists. */
  const seed = React.useCallback((): FormState => {
    const listing = existing?.listing;
    const describedAs = [manufacturer, model, year ? String(year) : null]
      .filter(Boolean)
      .join(' ');

    return {
      title: listing?.title ?? (describedAs ? `${describedAs} · ${registrationNumber}` : registrationNumber),
      description: listing?.description ?? '',
      askingPrice: listing ? String(Number(listing.askingPrice)) : '',
      negotiable: listing?.negotiable ?? true,
      minimumPrice:
        listing?.minimumPrice !== null && listing?.minimumPrice !== undefined
          ? String(Number(listing.minimumPrice))
          : '',
      condition: listing?.condition ?? VehicleCondition.GOOD,
      odometerKm: String(listing?.odometerKm ?? Math.round(odometerKm)),
      ownershipCount: String(listing?.ownershipCount ?? 1),
      accidentHistory: listing?.accidentHistory ?? false,
      accidentNote: listing?.accidentNote ?? '',
      majorRepairsNote: listing?.majorRepairsNote ?? '',
      tyreConditionPercent:
        listing?.tyreConditionPercent !== null && listing?.tyreConditionPercent !== undefined
          ? String(listing.tyreConditionPercent)
          : '',
      engineConditionNote: listing?.engineConditionNote ?? '',
      city: listing?.city ?? '',
      state: listing?.state ?? '',
      visibility: listing?.visibility ?? VehicleListingVisibility.PLATFORM,
    };
  }, [existing, manufacturer, model, year, odometerKm, registrationNumber]);

  const [form, setForm] = React.useState<FormState>(seed);

  // Re-seed when the listing loads or the vehicle changes.
  React.useEffect(() => {
    setForm(seed());
  }, [seed]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['resale-listing', vehicleId] });
  };

  const payload = (): Record<string, unknown> => ({
    title: form.title.trim(),
    askingPrice: Number(form.askingPrice || 0),
    negotiable: form.negotiable,
    condition: form.condition,
    odometerKm: Number(form.odometerKm || 0),
    ownershipCount: Number(form.ownershipCount || 1),
    accidentHistory: form.accidentHistory,
    visibility: form.visibility,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.minimumPrice ? { minimumPrice: Number(form.minimumPrice) } : {}),
    ...(form.accidentHistory && form.accidentNote.trim()
      ? { accidentNote: form.accidentNote.trim() }
      : {}),
    ...(form.majorRepairsNote.trim() ? { majorRepairsNote: form.majorRepairsNote.trim() } : {}),
    ...(form.tyreConditionPercent
      ? { tyreConditionPercent: Number(form.tyreConditionPercent) }
      : {}),
    ...(form.engineConditionNote.trim()
      ? { engineConditionNote: form.engineConditionNote.trim() }
      : {}),
    ...(form.city.trim() ? { city: form.city.trim() } : {}),
    ...(form.state.trim() ? { state: form.state.trim() } : {}),
  });

  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.patch(`/resale/listings/${existing.listing.id}`, payload())
        : api.post('/resale/listings', { vehicleId, ...payload() }),
    onSuccess: () => {
      toast.success(existing ? 'Listing updated' : 'Listing created');
      refresh();
    },
    onError: (error) => toast.error('Could not save the listing', { description: errorMessage(error) }),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/resale/listings/${existing?.listing.id}/publish`, {}),
    onSuccess: () => {
      toast.success('Listing is live');
      refresh();
    },
    onError: (error) => toast.error('Could not publish', { description: errorMessage(error) }),
  });

  const withdraw = useMutation({
    mutationFn: () =>
      api.post(`/resale/listings/${existing?.listing.id}/withdraw`, {
        reason: 'Withdrawn by the seller.',
      }),
    onSuccess: () => {
      toast.success('Listing withdrawn');
      refresh();
    },
    onError: (error) => toast.error('Could not withdraw', { description: errorMessage(error) }),
  });

  if (listingQuery.isLoading) return <LoadingState label="Checking sale status…" />;

  const status = existing?.listing.status;
  const readOnly = status === VehicleListingStatus.SOLD;
  const busy = save.isPending || publish.isPending || withdraw.isPending;

  return (
    <div className="space-y-4">
      {existing ? (
        <Card>
          <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">
                Listing {existing.listing.reference}
                <Badge
                  variant={STATUS_TONE[existing.listing.status] ?? 'muted'}
                  size="sm"
                  className="ml-2"
                >
                  {existing.listing.status.replace(/_/g, ' ')}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {formatRegistrationNumber(registrationNumber)} ·{' '}
                {VISIBILITY_LABELS[existing.listing.visibility]}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {status !== VehicleListingStatus.PUBLISHED && !readOnly ? (
                <Button
                  size="sm"
                  variant="gradient"
                  disabled={busy || !existing.readiness.ready}
                  onClick={() => publish.mutate()}
                  title={
                    existing.readiness.ready
                      ? 'Make this listing visible to buyers'
                      : 'Clear the blockers below first'
                  }
                >
                  <Megaphone className="size-4" />
                  Publish
                </Button>
              ) : null}
              {status === VehicleListingStatus.PUBLISHED ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => withdraw.mutate()}
                >
                  <Undo2 className="size-4" />
                  Withdraw
                </Button>
              ) : null}
            </div>
          </CardHeader>

          <CardContent>
            {existing.readiness.ready ? (
              <Alert variant="success">
                <CheckCircle2 className="size-4" />
                <AlertTitle>Ready to go live</AlertTitle>
                <AlertDescription>
                  Everything a buyer needs is in place.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="warning">
                <AlertTriangle className="size-4" />
                <AlertTitle>Before this can be published</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {existing.readiness.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sale details</CardTitle>
          <p className="text-sm text-muted-foreground">
            Make, model, year and odometer come from this vehicle&rsquo;s record. Add what only you
            know.
          </p>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="listing-title">Advert title</Label>
              <Input
                id="listing-title"
                required
                minLength={6}
                maxLength={160}
                value={form.title}
                onChange={(event) => set('title', event.target.value)}
                disabled={readOnly}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-description">Description</Label>
              <Textarea
                id="listing-description"
                rows={4}
                maxLength={4000}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder="Service history, recent work, why you are selling…"
                disabled={readOnly}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="listing-price">Asking price (₹)</Label>
                <Input
                  id="listing-price"
                  type="number"
                  min={1}
                  required
                  value={form.askingPrice}
                  onChange={(event) => set('askingPrice', event.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-minimum">Walk-away price (₹)</Label>
                <Input
                  id="listing-minimum"
                  type="number"
                  min={0}
                  value={form.minimumPrice}
                  onChange={(event) => set('minimumPrice', event.target.value)}
                  disabled={readOnly}
                />
                <p className="text-[11px] text-muted-foreground">Never shown to buyers.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-condition">Condition</Label>
                <Select
                  value={form.condition}
                  onValueChange={(value) => set('condition', value as VehicleCondition)}
                  disabled={readOnly}
                >
                  <SelectTrigger id="listing-condition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(VehicleCondition).map((condition) => (
                      <SelectItem key={condition} value={condition}>
                        {VEHICLE_CONDITION_LABELS[condition]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="listing-odometer">Odometer (km)</Label>
                <Input
                  id="listing-odometer"
                  type="number"
                  min={0}
                  required
                  value={form.odometerKm}
                  onChange={(event) => set('odometerKm', event.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-owners">Previous owners</Label>
                <Input
                  id="listing-owners"
                  type="number"
                  min={1}
                  max={20}
                  value={form.ownershipCount}
                  onChange={(event) => set('ownershipCount', event.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-tyres">Tyre life left (%)</Label>
                <Input
                  id="listing-tyres"
                  type="number"
                  min={0}
                  max={100}
                  value={form.tyreConditionPercent}
                  onChange={(event) => set('tyreConditionPercent', event.target.value)}
                  disabled={readOnly}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="listing-city">City</Label>
                <Input
                  id="listing-city"
                  value={form.city}
                  onChange={(event) => set('city', event.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-state">State</Label>
                <Input
                  id="listing-state"
                  value={form.state}
                  onChange={(event) => set('state', event.target.value)}
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-visibility">Who can see it</Label>
                <Select
                  value={form.visibility}
                  onValueChange={(value) => set('visibility', value as VehicleListingVisibility)}
                  disabled={readOnly}
                >
                  <SelectTrigger id="listing-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(VehicleListingVisibility).map((visibility) => (
                      <SelectItem key={visibility} value={visibility}>
                        {VISIBILITY_LABELS[visibility]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-repairs">Major repairs</Label>
              <Textarea
                id="listing-repairs"
                rows={2}
                value={form.majorRepairsNote}
                onChange={(event) => set('majorRepairsNote', event.target.value)}
                placeholder="Engine overhaul at 2,40,000 km…"
                disabled={readOnly}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="listing-accident">Accident history</Label>
                  <p className="text-xs text-muted-foreground">
                    Declaring it up front is what keeps a deal from collapsing at inspection.
                  </p>
                </div>
                <Switch
                  id="listing-accident"
                  checked={form.accidentHistory}
                  onCheckedChange={(checked) => set('accidentHistory', checked)}
                  disabled={readOnly}
                />
              </div>
              {form.accidentHistory ? (
                <Textarea
                  rows={2}
                  value={form.accidentNote}
                  onChange={(event) => set('accidentNote', event.target.value)}
                  placeholder="What happened, what was repaired, when."
                  disabled={readOnly}
                />
              ) : null}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <Label htmlFor="listing-negotiable">Price negotiable</Label>
                <p className="text-xs text-muted-foreground">Buyers may send offers.</p>
              </div>
              <Switch
                id="listing-negotiable"
                checked={form.negotiable}
                onCheckedChange={(checked) => set('negotiable', checked)}
                disabled={readOnly}
              />
            </div>

            {!readOnly ? (
              <Button type="submit" disabled={busy}>
                <IndianRupee className="size-4" />
                {save.isPending
                  ? 'Saving…'
                  : existing
                    ? 'Save changes'
                    : 'Create listing'}
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {/*
        Photos hang off the listing, so they can only be uploaded once one
        exists — there is nothing to attach them to before that.
      */}
      {existing ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Photos</CardTitle>
            <p className="text-sm text-muted-foreground">
              At least {LISTING_MEDIA_REQUIREMENTS.minExteriorPhotos} exterior shots and one
              odometer photo are required before the listing can go live.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <PhotoUploader
              ownerType={MediaOwnerType.VEHICLE_LISTING}
              ownerId={existing.listing.id}
              purpose={MediaPurpose.VEHICLE_EXTERIOR}
              label="Exterior"
              description="Front, rear and both sides."
              requiredCount={LISTING_MEDIA_REQUIREMENTS.minExteriorPhotos}
              max={LISTING_MEDIA_REQUIREMENTS.maxPhotos}
              disabled={readOnly}
            />
            <Separator />
            <PhotoUploader
              ownerType={MediaOwnerType.VEHICLE_LISTING}
              ownerId={existing.listing.id}
              purpose={MediaPurpose.ODOMETER}
              label="Odometer"
              description="A clear reading of the cluster."
              requiredCount={1}
              max={2}
              disabled={readOnly}
            />
            <Separator />
            <PhotoUploader
              ownerType={MediaOwnerType.VEHICLE_LISTING}
              ownerId={existing.listing.id}
              purpose={MediaPurpose.VEHICLE_INTERIOR}
              label="Interior"
              description="Cabin, seats and dashboard. Optional but expected by buyers."
              max={8}
              disabled={readOnly}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
