import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, MapPinned, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react';
import {
  MediaOwnerType,
  MediaPurpose,
  ProviderStatus,
  SERVICE_TYPES,
  type ServiceType,
  humanizeEnum,
} from '@saarthi/shared';
import { api, errorMessage } from '@/lib/api-client';
import type { ProviderSummary } from '@/lib/mobility-types';
// Reached through the modules rather than `@/features/maps`, because that index
// also exports the MapLibre-backed map: a city lookup in a dialog has no
// business pulling the whole map engine into the travel chunk.
import { searchPlaces, type PlaceResult } from '@/features/maps/places';
import { isRoutingConfigured } from '@/features/maps/map-config';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ChipInput } from '@/components/common/chip-input';
import { ImageCircleField } from '@/components/common/file-dropzone';
import { useAuth } from '@/features/auth/auth-context';
import { MediaImage } from '@/features/media/media-image';
import { uploadImageOrWarn } from '@/features/media/upload-image';
import {
  FormWizard,
  WizardField,
  WIZARD_DIALOG_CONTENT,
  WIZARD_DIALOG_HEADER,
  WIZARD_DIALOG_PANEL,
  WIZARD_IN_DIALOG,
  type WizardStep,
} from '@/components/common/form-wizard';
import { cn } from '@/lib/utils';

/**
 * Create or edit the travel provider profile.
 *
 * The profile is the gate in front of everything a provider sells: packages,
 * quotes and bookings all resolve it first, and the API refuses those writes
 * until it exists. Until this dialog there was no way to make one from the
 * app — the packages screen sent operators to the generic profile builder,
 * which describes the *organization*, not what it offers — so the "New
 * package" button could never be reached.
 *
 * Same component for both cases. `PUT /travel/me/profile` is an upsert that
 * replaces service areas wholesale, so an edit has to submit the full set
 * anyway; a separate edit form would only be this one with the values filled
 * in.
 */

const PHONE_PATTERN = /^(\+91)?[6-9]\d{9}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const LOGO_MAX_SIZE_MB = 5;
const LOGO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

/** Matches `phoneSchema`, which strips separators before it validates. */
function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, '');
}

function coordinate(value: string, limit: number): boolean {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) && Math.abs(parsed) <= limit;
}

interface AreaFormState {
  /** Stable across re-renders, so a row keeps its focus while others are removed. */
  key: string;
  city: string;
  state: string;
  latitude: string;
  longitude: string;
  radiusKm: string;
}

interface ProfileFormState {
  displayName: string;
  serviceTypes: ServiceType[];
  about: string;
  contactPhone: string;
  contactEmail: string;
  whatsappPhone: string;
  businessRegistrationNumber: string;
  yearsInBusiness: string;
  languages: string[];
  areas: AreaFormState[];
  /** ACTIVE when on, PAUSED when off — see `statusFor`. */
  accepting: boolean;
}

type FieldKey = 'displayName' | 'serviceTypes' | 'contactPhone' | 'contactEmail' | 'whatsappPhone';
type FieldErrors = Partial<Record<FieldKey | 'areas', string>>;
type AreaErrors = Partial<Record<'city' | 'state' | 'latitude' | 'longitude' | 'radiusKm', string>>;

let areaSequence = 0;

function blankArea(): AreaFormState {
  areaSequence += 1;
  return {
    key: `new-area-${areaSequence}`,
    city: '',
    state: '',
    latitude: '',
    longitude: '',
    radiusKm: '150',
  };
}

function initialState(profile: ProviderSummary | null | undefined): ProfileFormState {
  if (!profile) {
    return {
      displayName: '',
      serviceTypes: [],
      about: '',
      contactPhone: '',
      contactEmail: '',
      whatsappPhone: '',
      businessRegistrationNumber: '',
      yearsInBusiness: '',
      languages: [],
      areas: [blankArea()],
      accepting: true,
    };
  }

  return {
    displayName: profile.displayName,
    serviceTypes: [...profile.serviceTypes],
    about: profile.about ?? '',
    contactPhone: profile.contactPhone,
    contactEmail: profile.contactEmail ?? '',
    whatsappPhone: profile.whatsappPhone ?? '',
    businessRegistrationNumber: profile.businessRegistrationNumber ?? '',
    yearsInBusiness: profile.yearsInBusiness === null ? '' : String(profile.yearsInBusiness),
    languages: [...profile.languages],
    areas:
      profile.serviceAreas.length > 0
        ? profile.serviceAreas.map((area) => ({
            key: area.id,
            city: area.city,
            state: area.state,
            latitude: String(area.latitude),
            longitude: String(area.longitude),
            radiusKm: String(area.radiusKm),
          }))
        : [blankArea()],
    accepting: profile.status !== ProviderStatus.PAUSED,
  };
}

/**
 * A suspension is an administrative decision, so the switch must not be able to
 * lift it — the existing status is carried through untouched instead.
 */
function statusFor(
  profile: ProviderSummary | null | undefined,
  accepting: boolean,
): ProviderStatus {
  if (profile?.status === ProviderStatus.SUSPENDED) return ProviderStatus.SUSPENDED;
  return accepting ? ProviderStatus.ACTIVE : ProviderStatus.PAUSED;
}

/** Per-row rules, so the coverage step can point at the row that is wrong. */
function validateArea(area: AreaFormState): AreaErrors {
  const found: AreaErrors = {};
  if (area.city.trim().length < 2) found.city = 'Name the city.';
  if (area.state.trim().length < 2) found.state = 'Name the state.';
  if (!coordinate(area.latitude, 90)) found.latitude = 'Latitude between -90 and 90.';
  if (!coordinate(area.longitude, 180)) found.longitude = 'Longitude between -180 and 180.';
  const radius = Number(area.radiusKm);
  if (!Number.isFinite(radius) || radius < 5 || radius > 2000)
    found.radiusKm = 'Between 5 and 2000 km.';
  return found;
}

/** "Lucknow, Uttar Pradesh, India" — the geocoder's label, minus the country. */
function splitPlaceLabel(address: string): { city: string; state: string } {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const local =
    parts.length > 1 && /^india$/i.test(parts[parts.length - 1] ?? '') ? parts.slice(0, -1) : parts;
  return {
    city: local[0] ?? '',
    state: local.length > 1 ? (local[local.length - 1] ?? '') : '',
  };
}

/**
 * One city the provider works from.
 *
 * Coordinates are what discovery actually matches on — `coversPoint` measures
 * the distance from them — but nobody knows their own city's latitude. So the
 * row offers the place search that already backs the map, and still lets the
 * numbers be typed, because that search needs an ORS key a self-hosted
 * deployment may not have.
 */
function ServiceAreaFields({
  area,
  index,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  area: AreaFormState;
  index: number;
  errors: AreaErrors | undefined;
  canRemove: boolean;
  onChange: (patch: Partial<Omit<AreaFormState, 'key'>>) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<PlaceResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const idBase = `area-${area.key}`;

  const lookup = async (): Promise<void> => {
    const text = query.trim();
    if (text.length < 3) {
      toast.info('Type at least three letters of the city name.');
      return;
    }
    setSearching(true);
    try {
      const found = await searchPlaces(text, { limit: 5 });
      setResults(found);
      if (found.length === 0) toast.info('No place matched that name.');
    } catch (error) {
      toast.error('Place search is unavailable', { description: errorMessage(error) });
    } finally {
      setSearching(false);
    }
  };

  const choose = (place: PlaceResult): void => {
    // The search now returns the city and state as fields rather than buried
    // in a label, so nothing has to be unpicked from a comma-separated string.
    const { city, state } = place.city
      ? { city: place.city, state: place.state ?? '' }
      : splitPlaceLabel(place.address);

    onChange({
      city: city || place.name,
      // Only fill the state when one came back — never blank out a value the
      // operator has already typed.
      ...(state ? { state } : {}),
      latitude: place.position.latitude.toFixed(6),
      longitude: place.position.longitude.toFixed(6),
    });
    setResults([]);
    setQuery('');
  };

  return (
    <div className="glass-inset space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          City {index + 1}
        </p>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onRemove}
          >
            <Trash2 className="size-3.5" />
            Remove
          </Button>
        ) : null}
      </div>

      {isRoutingConfigured ? (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              id={`${idBase}-search`}
              value={query}
              placeholder="Search a city to fill this in"
              aria-label={`Search a city for entry ${index + 1}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter searches. Left alone it would reach the wizard and try
                // to advance the step instead.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void lookup();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              loading={searching}
              onClick={() => void lookup()}
            >
              <Search className="size-4" />
              Find
            </Button>
          </div>
          {results.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-border p-1">
              {results.map((feature) => (
                <li key={feature.id}>
                  <button
                    type="button"
                    onClick={() => choose(feature)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    {feature.address}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <WizardField label="City" htmlFor={`${idBase}-city`} required error={errors?.city}>
          <Input
            id={`${idBase}-city`}
            maxLength={120}
            value={area.city}
            aria-invalid={Boolean(errors?.city) || undefined}
            onChange={(event) => onChange({ city: event.target.value })}
            placeholder="Lucknow"
          />
        </WizardField>
        <WizardField label="State" htmlFor={`${idBase}-state`} required error={errors?.state}>
          <Input
            id={`${idBase}-state`}
            maxLength={120}
            value={area.state}
            aria-invalid={Boolean(errors?.state) || undefined}
            onChange={(event) => onChange({ state: event.target.value })}
            placeholder="Uttar Pradesh"
          />
        </WizardField>
        <WizardField label="Latitude" htmlFor={`${idBase}-lat`} required error={errors?.latitude}>
          <Input
            id={`${idBase}-lat`}
            type="number"
            step="0.000001"
            value={area.latitude}
            aria-invalid={Boolean(errors?.latitude) || undefined}
            onChange={(event) => onChange({ latitude: event.target.value })}
            placeholder="26.846700"
          />
        </WizardField>
        <WizardField label="Longitude" htmlFor={`${idBase}-lng`} required error={errors?.longitude}>
          <Input
            id={`${idBase}-lng`}
            type="number"
            step="0.000001"
            value={area.longitude}
            aria-invalid={Boolean(errors?.longitude) || undefined}
            onChange={(event) => onChange({ longitude: event.target.value })}
            placeholder="80.946200"
          />
        </WizardField>
      </div>

      <WizardField
        label="How far you will travel (km)"
        htmlFor={`${idBase}-radius`}
        required
        error={errors?.radiusKm}
        hint="Customers searching inside this radius will find you."
      >
        <Input
          id={`${idBase}-radius`}
          type="number"
          min={5}
          max={2000}
          value={area.radiusKm}
          aria-invalid={Boolean(errors?.radiusKm) || undefined}
          onChange={(event) => onChange({ radiusKm: event.target.value })}
        />
      </WizardField>
    </div>
  );
}

export interface ProviderProfileDialogProps {
  /** Omit to create one; pass the current profile to edit it. */
  profile?: ProviderSummary | null;
  /** Replaces the default button — the empty state wants its own wording. */
  trigger?: React.ReactNode;
}

export function ProviderProfileDialog({ profile, trigger }: ProviderProfileDialogProps) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const isEdit = Boolean(profile);
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<ProfileFormState>(() => initialState(profile));
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [areaErrors, setAreaErrors] = React.useState<Record<string, AreaErrors>>({});
  const [erroredStepIds, setErroredStepIds] = React.useState<string[]>([]);
  /** A newly picked logo. Null while the one already on the profile stands. */
  const [logo, setLogo] = React.useState<File | null>(null);

  // Read through a ref so a background refetch of the profile cannot reset the
  // form under someone who is halfway through editing it.
  const profileRef = React.useRef(profile);
  profileRef.current = profile;

  React.useEffect(() => {
    if (!open) return;
    setForm(initialState(profileRef.current));
    setLogo(null);
    setErrors({});
    setAreaErrors({});
    setErroredStepIds([]);
  }, [open]);

  const set = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    // Clear the message as soon as the field is touched — leaving it under a
    // field the user is actively fixing reads as though it is still wrong.
    setErrors((previous) => (key in previous ? { ...previous, [key]: undefined } : previous));
  };

  const toggleServiceType = (type: ServiceType): void => {
    set(
      'serviceTypes',
      form.serviceTypes.includes(type)
        ? form.serviceTypes.filter((entry) => entry !== type)
        : [...form.serviceTypes, type],
    );
  };

  const patchArea = (key: string, patch: Partial<Omit<AreaFormState, 'key'>>): void => {
    setForm((previous) => ({
      ...previous,
      areas: previous.areas.map((area) => (area.key === key ? { ...area, ...patch } : area)),
    }));
    setAreaErrors((previous) => (key in previous ? { ...previous, [key]: {} } : previous));
    setErrors((previous) => ('areas' in previous ? { ...previous, areas: undefined } : previous));
  };

  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      // The logo goes up first because the profile records its URL. The
      // organization already exists, so unlike the vehicle and driver forms
      // there is nothing to wait for — and a logo left behind by a profile
      // that then fails validation is simply replaced by the next one.
      const organizationId = session?.organization?.id;
      const asset =
        logo && organizationId
          ? await uploadImageOrWarn(
              {
                ownerType: MediaOwnerType.ORGANIZATION,
                ownerId: organizationId,
                purpose: MediaPurpose.LOGO,
                file: logo,
              },
              'The profile was saved, but the logo could not be.',
            )
          : null;

      return api.put<ProviderSummary>('/travel/me/profile', {
        ...payload,
        ...(asset ? { logoUrl: asset.thumbnailUrl ?? asset.url } : {}),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Profile updated' : 'Provider profile created', {
        description: isEdit
          ? 'Customers will see the new details.'
          : 'You can publish packages now.',
      });
      // Every travel query hangs off this prefix — the profile itself, the
      // package list and the gate that hides it all move together.
      void queryClient.invalidateQueries({ queryKey: ['travel'] });
      setOpen(false);
    },
    onError: (error) =>
      toast.error(isEdit ? 'Could not save the profile' : 'Could not create the profile', {
        description: errorMessage(error),
      }),
  });

  const submit = (): void => {
    const email = form.contactEmail.trim();
    const whatsapp = normalizePhone(form.whatsappPhone);
    const registration = form.businessRegistrationNumber.trim();
    const years = form.yearsInBusiness.trim();

    save.mutate({
      displayName: form.displayName.trim(),
      serviceTypes: form.serviceTypes,
      contactPhone: normalizePhone(form.contactPhone),
      languages: form.languages,
      serviceAreas: form.areas.map((area) => ({
        city: area.city.trim(),
        state: area.state.trim(),
        latitude: Number(area.latitude),
        longitude: Number(area.longitude),
        radiusKm: Number(area.radiusKm || 150),
      })),
      status: statusFor(profile, form.accepting),
      ...(form.about.trim() ? { about: form.about.trim() } : {}),
      ...(email ? { contactEmail: email } : {}),
      ...(whatsapp ? { whatsappPhone: whatsapp } : {}),
      ...(registration ? { businessRegistrationNumber: registration } : {}),
      ...(years ? { yearsInBusiness: Number(years) } : {}),
    });
  };

  /** Mirrors `upsertProviderProfileSchema`, keyed by step id. */
  const validateStep = (step: WizardStep): boolean => {
    const found: FieldErrors = {};

    if (step.id === 'business') {
      if (form.displayName.trim().length < 3)
        found.displayName = 'Give customers a name of at least 3 characters.';
      if (form.serviceTypes.length === 0)
        found.serviceTypes = 'Choose at least one service you offer.';
    }

    if (step.id === 'contact') {
      if (!PHONE_PATTERN.test(normalizePhone(form.contactPhone)))
        found.contactPhone = 'Enter a valid 10-digit Indian mobile number.';
      const whatsapp = normalizePhone(form.whatsappPhone);
      if (whatsapp && !PHONE_PATTERN.test(whatsapp))
        found.whatsappPhone = 'Enter a valid 10-digit Indian mobile number.';
      const email = form.contactEmail.trim();
      if (email && !EMAIL_PATTERN.test(email)) found.contactEmail = 'Enter a valid email address.';
    }

    if (step.id === 'coverage') {
      const rows = Object.fromEntries(
        form.areas.map((area) => [area.key, validateArea(area)] as const),
      );
      if (form.areas.length === 0) found.areas = 'Add at least one city you operate from.';
      else if (Object.values(rows).some((row) => Object.keys(row).length > 0))
        found.areas = 'Complete every city below, or remove the ones you do not serve.';
      setAreaErrors(rows);
    }

    const ok = Object.keys(found).length === 0;
    setErrors(found);
    setErroredStepIds((previous) =>
      ok
        ? previous.filter((id) => id !== step.id)
        : previous.includes(step.id)
          ? previous
          : [...previous, step.id],
    );

    return ok;
  };

  const steps: WizardStep[] = [
    {
      id: 'business',
      title: 'Your business',
      description: 'Who customers are booking.',
      icon: Building2,
      content: (
        <>
          <ImageCircleField
            value={logo}
            onChange={setLogo}
            existing={
              profile?.logoUrl ? (
                <MediaImage
                  source={profile.logoUrl}
                  alt={`${profile.displayName} logo`}
                  variant="thumbnail"
                  className="size-full object-cover"
                  fallback={null}
                />
              ) : null
            }
            label="Business logo"
            hint={`Optional · JPEG, PNG, WebP or HEIC up to ${LOGO_MAX_SIZE_MB} MB`}
            accept={LOGO_ACCEPT}
            maxSizeMb={LOGO_MAX_SIZE_MB}
            icon={Building2}
            onReject={(reason) => toast.error(reason)}
            className="pb-1"
          />

          <WizardField
            label="Trading name"
            htmlFor="provider-name"
            required
            error={errors.displayName}
            hint="Shown on every package and in search results."
          >
            <Input
              id="provider-name"
              maxLength={160}
              value={form.displayName}
              aria-invalid={Boolean(errors.displayName) || undefined}
              onChange={(event) => set('displayName', event.target.value)}
              placeholder="Saarthi Tours & Travels"
            />
          </WizardField>

          <WizardField
            label="What you offer"
            required
            error={errors.serviceTypes}
            hint="Pick every service you run. You can change this later."
          >
            <div className="flex flex-wrap gap-2">
              {SERVICE_TYPES.map((type) => {
                const active = form.serviceTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleServiceType(type)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {humanizeEnum(type)}
                  </button>
                );
              })}
            </div>
          </WizardField>

          <WizardField label="About" htmlFor="provider-about">
            <Textarea
              id="provider-about"
              rows={4}
              maxLength={3000}
              value={form.about}
              onChange={(event) => set('about', event.target.value)}
              placeholder="How long you have run, the routes you know, what you are known for."
            />
          </WizardField>

          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField
              label="Years in business"
              htmlFor="provider-years"
              hint="A trust signal on your listing."
            >
              <Input
                id="provider-years"
                type="number"
                min={0}
                max={150}
                value={form.yearsInBusiness}
                onChange={(event) => set('yearsInBusiness', event.target.value)}
              />
            </WizardField>
            <WizardField label="GST or registration number" htmlFor="provider-registration">
              <Input
                id="provider-registration"
                maxLength={80}
                value={form.businessRegistrationNumber}
                onChange={(event) => set('businessRegistrationNumber', event.target.value)}
              />
            </WizardField>
          </div>
        </>
      ),
    },
    {
      id: 'contact',
      title: 'How to reach you',
      description: 'Where booking requests land.',
      icon: Phone,
      content: (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <WizardField
              label="Booking phone"
              htmlFor="provider-phone"
              required
              error={errors.contactPhone}
            >
              <Input
                id="provider-phone"
                inputMode="tel"
                value={form.contactPhone}
                aria-invalid={Boolean(errors.contactPhone) || undefined}
                onChange={(event) => set('contactPhone', event.target.value)}
                placeholder="9876543210"
              />
            </WizardField>
            <WizardField
              label="WhatsApp"
              htmlFor="provider-whatsapp"
              error={errors.whatsappPhone}
              hint="Leave blank to use the booking phone."
            >
              <Input
                id="provider-whatsapp"
                inputMode="tel"
                value={form.whatsappPhone}
                aria-invalid={Boolean(errors.whatsappPhone) || undefined}
                onChange={(event) => set('whatsappPhone', event.target.value)}
              />
            </WizardField>
          </div>

          <WizardField label="Email" htmlFor="provider-email" error={errors.contactEmail}>
            <Input
              id="provider-email"
              type="email"
              maxLength={254}
              value={form.contactEmail}
              aria-invalid={Boolean(errors.contactEmail) || undefined}
              onChange={(event) => set('contactEmail', event.target.value)}
            />
          </WizardField>

          <ChipInput
            id="provider-languages"
            label="Languages your drivers speak"
            placeholder="Hindi, then press Enter"
            maxLength={40}
            values={form.languages}
            onChange={(values) => set('languages', values.slice(0, 10))}
            hint="Customers look for this. Up to ten."
          />
        </>
      ),
    },
    {
      id: 'coverage',
      title: 'Where you work',
      description: 'The cities you operate from.',
      icon: MapPinned,
      content: (
        <>
          {errors.areas ? <p className="text-xs text-destructive">{errors.areas}</p> : null}

          <div className="space-y-3">
            {form.areas.map((area, index) => (
              <ServiceAreaFields
                key={area.key}
                area={area}
                index={index}
                errors={areaErrors[area.key]}
                canRemove={form.areas.length > 1}
                onChange={(patch) => patchArea(area.key, patch)}
                onRemove={() =>
                  setForm((previous) => ({
                    ...previous,
                    areas: previous.areas.filter((entry) => entry.key !== area.key),
                  }))
                }
              />
            ))}
          </div>

          {form.areas.length < 25 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setForm((previous) => ({ ...previous, areas: [...previous.areas, blankArea()] }))
              }
            >
              <Plus className="size-4" />
              Add another city
            </Button>
          ) : null}

          {profile?.status === ProviderStatus.SUSPENDED ? (
            <Alert variant="warning">
              <AlertTitle>This provider account is suspended</AlertTitle>
              <AlertDescription>
                You can keep the profile up to date, but bookings stay closed until Saarthi support
                lifts the suspension.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="glass-inset flex items-center justify-between gap-3 px-3 py-2.5">
              <div>
                <Label htmlFor="provider-accepting">Accepting bookings</Label>
                <p className="text-xs text-muted-foreground">
                  Turn this off to stay listed without taking new work.
                </p>
              </div>
              <Switch
                id="provider-accepting"
                checked={form.accepting}
                onCheckedChange={(checked) => set('accepting', checked)}
              />
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={isEdit ? 'outline' : 'default'}>
            {isEdit ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {isEdit ? 'Edit profile' : 'Set up provider profile'}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className={`${WIZARD_DIALOG_CONTENT} sm:max-w-3xl`}>
        <DialogHeader className={WIZARD_DIALOG_HEADER}>
          <DialogTitle>{isEdit ? 'Provider profile' : 'Set up your provider profile'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'What customers see, and where you are willing to work.'
              : 'This is what customers see. Your vehicles, drivers and account stay exactly as they are.'}
          </DialogDescription>
        </DialogHeader>

        <FormWizard
          steps={steps}
          className={WIZARD_IN_DIALOG}
          panelClassName={WIZARD_DIALOG_PANEL}
          resetKey={open}
          // Editing should not mean walking past two steps to change a phone
          // number. The wizard re-checks every step on submit.
          allowJumpAhead={isEdit}
          onValidateStep={validateStep}
          onSubmit={submit}
          submitting={save.isPending}
          submitLabel={isEdit ? 'Save profile' : 'Create profile'}
          erroredStepIds={erroredStepIds}
          footerStart={
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
