import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Briefcase,
  Building2,
  Car,
  Check,
  ExternalLink,
  HandshakeIcon,
  IdCard,
  KeyRound,
  Languages,
  Minus,
  Package,
  Plane,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import {
  MediaOwnerType,
  MediaPurpose,
  ORGANIZATION_NAME_REQUIRED_ROLES,
  PLAN_CATALOGUE,
  PLAN_LIMITS,
  PlanTier,
  RoleName,
  VEHICLE_TOPUP,
  VEHICLE_TRACKER,
  formatCurrency,
  quoteSubscription,
  registerSchema,
  type RegisterInput,
  type SessionPayload,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FormWizard, type WizardStep } from '@/components/common/form-wizard';
import { ImageCircleField } from '@/components/common/file-dropzone';
import { PasswordStrength } from '@/components/common/password-strength';
import { AuthDivider, AuthHeading } from '@/features/auth/auth-card';
import {
  RegistrationTutorial,
  RegistrationTutorialLauncher,
  hasSeenRegistrationTutorial,
  markRegistrationTutorialSeen,
} from '@/features/auth/registration-tutorial';
import { LanguageGrid, useLocale } from '@/features/i18n';
import { LEGAL_LINKS } from '@/features/legal/legal-links';
import { forgetReferralCode, resolveReferralCode } from '@/features/sales/referral-code';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { uploadImageOrWarn } from '@/features/media/upload-image';
import { AnimatePresence, motion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Registration.
 *
 * The account type chosen here decides what Saarthi creates alongside the user
 * — a fleet, a supplier yard, a customer account, a travel operator, a truck
 * association, or a driver profile inside an existing fleet.
 *
 * This choice is not cosmetic. Several surfaces belong to exactly one kind of
 * business: only a travel operator can publish tour packages, only an
 * association can run an emergency queue. The API enforces that by
 * organization type, so picking the wrong one here cannot be worked around
 * later from the UI — it has to be the right account from the start.
 *
 * That is also why the account type is a step of its own rather than one field
 * among eleven: it is the decision the rest of the form depends on, and the
 * fourth step asks entirely different questions once a driver has picked it.
 */
const ACCOUNT_TYPES = [
  {
    role: RoleName.FLEET_OWNER,
    icon: Truck,
    title: 'Fleet owner',
    description: 'I own trucks and want to manage my fleet and win loads.',
  },
  {
    role: RoleName.CUSTOMER,
    icon: ShoppingCart,
    title: 'Customer',
    description: 'I need materials, transport, a cab or a tour, and want offers to compare.',
  },
  {
    role: RoleName.SUPPLIER,
    icon: Package,
    title: 'Supplier',
    description: 'I sell materials and arrange dispatch from my yard.',
  },
  {
    role: RoleName.MOBILITY_PROVIDER,
    icon: Plane,
    title: 'Travel & tour operator',
    description: 'I run taxis, buses or tour packages and sell passenger journeys.',
  },
  {
    role: RoleName.ASSOCIATION_ADMIN,
    icon: HandshakeIcon,
    title: 'Truck association',
    description: 'I represent a district association coordinating roadside help.',
  },
  {
    role: RoleName.DRIVER,
    icon: Building2,
    title: 'Driver',
    description: 'I drive for a fleet that already uses Saarthi.',
  },
] as const;

/**
 * The first question, and the one that decides the shape of the rest.
 *
 * Three answers rather than a plan grid, because the three are not the same
 * kind of thing: two are subscriptions and one is somebody joining an employer
 * who already pays. Asking "which plan?" would have forced a driver to price
 * a product they are not buying.
 *
 * Choosing Personal ends the questions about *what kind of business you are* —
 * a person with three cars is not a business, and being asked to declare
 * themselves a fleet owner, a supplier or a customer was the single most
 * confusing moment on this form. Only Business goes on to `ACCOUNT_TYPES`.
 */
const ACCOUNT_INTENTS = [
  {
    id: 'personal' as const,
    planTier: PlanTier.PERSONAL,
    role: RoleName.FLEET_OWNER,
    icon: Car,
    title: 'The vehicles are mine',
    description:
      'A car, a tempo or a few of each. Track them, keep their papers, watch the EMI and the toll.',
  },
  {
    id: 'business' as const,
    planTier: PlanTier.BUSINESS,
    role: null,
    icon: Briefcase,
    title: 'I run a transport business',
    description:
      'A fleet, a supply yard, a travel business, an association - or you buy transport. Bid, dispatch and invoice.',
  },
  {
    id: 'driver' as const,
    planTier: null,
    role: RoleName.DRIVER,
    icon: IdCard,
    title: 'I drive for a fleet',
    description: 'Your employer already uses Saarthi. Nothing to pay - they cover you.',
  },
] as const;

type AccountIntent = (typeof ACCOUNT_INTENTS)[number]['id'];

/** The price line under each answer, from the catalogue rather than from copy. */
function intentPrice(id: AccountIntent): string | null {
  if (id === 'driver') return null;
  const tier = id === 'personal' ? PlanTier.PERSONAL : PlanTier.BUSINESS;
  const plan = PLAN_CATALOGUE.find((candidate) => candidate.tier === tier);
  return plan?.priceMonthly === null || plan?.priceMonthly === undefined
    ? null
    : `${formatCurrency(plan.priceMonthly)}/month`;
}

/** What the organization is called depends on what kind of business it is. */
const ORGANIZATION_LABEL: Partial<Record<RoleName, string>> = {
  [RoleName.SUPPLIER]: 'Business name',
  [RoleName.ASSOCIATION_ADMIN]: 'Association name',
  [RoleName.MOBILITY_PROVIDER]: 'Travel business name',
};

/**
 * An example of the kind of name we mean.
 *
 * Worth getting right per role: the placeholder is the first thing that tells
 * somebody whether this product is meant for their business, and a travel
 * operator being shown a construction company read as a form built for
 * somebody else.
 */
const ORGANIZATION_PLACEHOLDER: Partial<Record<RoleName, string>> = {
  [RoleName.FLEET_OWNER]: 'Sharma Transport Company',
  [RoleName.MOBILITY_PROVIDER]: 'Sharma Travels & Tours',
  [RoleName.ASSOCIATION_ADMIN]: 'Jaipur District Truck Association',
  [RoleName.SUPPLIER]: 'Kumar Building Materials',
};

/**
 * Days of free trial, mirroring `SUBSCRIPTION_TRIAL_DAYS` on the API.
 *
 * From the build config rather than written into the copy: a summary that says
 * "free for 30 days" against a server that grants 14 is a summary that
 * mis-sells. Falls back to 0, which presents the price as due now — the safe
 * direction to be wrong in.
 */
const REGISTRATION_TRIAL_DAYS = (() => {
  const parsed = Number.parseInt(
    (import.meta.env.VITE_SUBSCRIPTION_TRIAL_DAYS as string | undefined) ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

/**
 * A stepper for one line of the order.
 *
 * Typeable as well as steppable: somebody with nine trucks should not press a
 * button nine times, and somebody with three should not have to open a
 * keyboard to say so.
 */
function OrderCount({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>

      <div className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-background/60 p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`One fewer - ${label}`}
        >
          <Minus className="size-3.5" aria-hidden />
        </Button>

        <label>
          <span className="sr-only">{label}</span>
          <input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              // A cleared or half-typed field must not blank the total, so
              // anything unparseable holds the last good number.
              if (Number.isFinite(next)) onChange(clamp(next));
            }}
            className="w-9 border-0 bg-transparent p-0 text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-full"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`One more - ${label}`}
        >
          <Plus className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * What is being subscribed to, itemised.
 *
 * The same `quoteSubscription` the pricing card uses, so the figure somebody
 * clicked Subscribe on is the figure they see here and the figure the API
 * charges. Three surfaces doing the arithmetic separately is how a customer
 * ends up quoted one number and billed another.
 */
function OrderSummary({
  tier,
  billing,
  vehicles,
  trackers,
  onVehicles,
  onTrackers,
}: {
  tier: PlanTier;
  billing: 'monthly' | 'yearly';
  vehicles: number;
  trackers: number;
  onVehicles: (next: number) => void;
  onTrackers: (next: number) => void;
}) {
  const { t } = useLocale();

  const quote = quoteSubscription({ tier, vehicles, trackers, billing });
  const limits = PLAN_LIMITS[tier];

  const vehicleMax =
    limits.maxTrucks === null ? 500 : limits.maxTrucks + limits.maxVehicleTopUps;
  const trackerMax =
    limits.maxTrackers === null ? vehicles : Math.min(limits.maxTrackers, vehicles);

  return (
    <div className="glass-inset mt-3 p-3.5">
      <p className="text-sm font-medium">{t('What you are subscribing to')}</p>

      <div className="mt-1 divide-y divide-border/50">
        <OrderCount
          label={t('Vehicles')}
          hint={t('1 included, then {price} a month each', {
            price: formatCurrency(VEHICLE_TOPUP.priceMonthly),
          })}
          value={vehicles}
          min={1}
          max={vehicleMax}
          onChange={onVehicles}
        />
        <OrderCount
          label={t('Trackers')}
          hint={t('{price} each, charged once. Optional.', {
            price: formatCurrency(VEHICLE_TRACKER.priceOneTime),
          })}
          value={Math.min(trackers, trackerMax)}
          min={0}
          max={trackerMax}
          onChange={onTrackers}
        />
      </div>

      {/* Itemised, because a total somebody cannot reconstruct is a total they
          do not trust — and because the hardware has to read as separate from
          what renews. */}
      <dl className="mt-3 space-y-1 border-t border-border/50 pt-3">
        {quote.lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="min-w-0 truncate text-muted-foreground">
              {line.label}
              {line.cadence === 'once' ? (
                <span className="ml-1.5 text-2xs uppercase tracking-wide">{t('once')}</span>
              ) : null}
            </dt>
            <dd className="shrink-0 tabular-nums">{formatCurrency(line.amount)}</dd>
          </div>
        ))}

        <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-2 text-xs">
          <dt className="text-muted-foreground">{t('Subtotal')}</dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.subtotal)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <dt className="text-muted-foreground">
            {t('GST {percent}%', { percent: Math.round(quote.gstRate * 100) })}
          </dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.gst)}</dd>
        </div>

        {/* The number somebody checks before they commit. Given its own rule
            and its own weight, because everything above it is working towards
            it. */}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>{t('Total to pay')}</dt>
          <dd className="tabular-nums">{formatCurrency(quote.dueNow.total)}</dd>
        </div>
      </dl>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {REGISTRATION_TRIAL_DAYS > 0
          ? t('Free for {days} days - nothing is charged today. Cancel before then and you pay nothing.', {
              days: REGISTRATION_TRIAL_DAYS,
            })
          : ''}{' '}
        {trackers > 0
          ? t('Trackers arrive unfitted - add your vehicles, then assign each one.')
          : ''}
      </p>
    </div>
  );
}

/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const IMAGE_MAX_SIZE_MB = 5;
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

export function RegisterPage() {
  const { register, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formError, setFormError] = React.useState<string | null>(null);
  /**
   * Held locally rather than uploaded as it is picked: media uploads are
   * authenticated and addressed to an owner id, and neither the session nor
   * the organization exists until the account is created a few steps later.
   */
  const [image, setImage] = React.useState<File | null>(null);
  /**
   * The guided walkthrough.
   *
   * Opened by hand from the launcher, and once by itself for somebody who has
   * never seen this page — the account type is the one decision on this form
   * that cannot be corrected afterwards, so the first visit is the only moment
   * where explaining it costs nothing. Never again after that: the flag is
   * written the moment it closes, however it closes.
   */
  const [tutorialOpen, setTutorialOpen] = React.useState(false);

  const { locale, setLocale, t } = useLocale();

  /**
   * What the visitor configured on the pricing card, from the query string.
   *
   * Honoured rather than ignored because somebody who has just set their fleet
   * size, added two trackers and clicked Subscribe has already answered these
   * questions; asking again reads as though the click did nothing — and worse,
   * would quietly sign them up for one vehicle after they priced nine.
   *
   * Every value is clamped here rather than trusted. The API re-prices the
   * order from its own catalogue regardless, so a hand-edited link cannot buy
   * anything cheaply; this only keeps the form from rendering nonsense.
   */
  const linked = React.useMemo(() => {
    const requestedPlan = searchParams.get('plan')?.toLowerCase();
    const plan: AccountIntent | null =
      requestedPlan === 'personal' ? 'personal' : requestedPlan === 'business' ? 'business' : null;

    const count = (key: string, min: number, max: number, fallback: number): number => {
      const parsed = Number.parseInt(searchParams.get(key) ?? '', 10);
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
    };

    const vehicles = count('vehicles', 1, 500, 1);

    return {
      plan,
      vehicles,
      // A tracker is fitted to a vehicle, so the fleet size is its ceiling.
      trackers: Math.min(count('trackers', 0, 500, 0), vehicles),
      billing: searchParams.get('billing') === 'yearly' ? ('yearly' as const) : ('monthly' as const),
    };
  }, [searchParams]);

  const linkedPlan = linked.plan;

  /**
   * The referral this registration arrived through.
   *
   * Resolved once, from the query string first and the remembered value
   * second — see `resolveReferralCode`. Held outside the form's own state so a
   * step change cannot drop it.
   */
  const referralCode = React.useMemo(
    () => resolveReferralCode(window.location.search),
    [],
  );

  const [intent, setIntent] = React.useState<AccountIntent | null>(linkedPlan);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      // Left unset until the first step is answered: the account type is what
      // that step decides, and a pre-filled fleet owner would have quietly
      // stood in for an answer nobody gave.
      role: linkedPlan === 'personal' ? RoleName.FLEET_OWNER : undefined,
      planTier: linkedPlan === 'personal' ? PlanTier.PERSONAL : linkedPlan === 'business' ? PlanTier.BUSINESS : undefined,
      planBilling: linked.billing,
      planVehicles: linked.vehicles,
      planTrackers: linked.trackers,
      driveMyself: false,
      organizationName: '',
      // Whatever the browser or a previous visit already settled on, so the
      // first step opens on the answer rather than on a blank.
      preferredLanguage: locale,
      /*
       * The salesperson to credit this signup to, if the visitor arrived
       * through a referral link or QR.
       *
       * Read from `?ref=` and, failing that, from what the referral landing
       * page remembered — somebody may open the link on Tuesday and finish
       * signing up on Thursday. Never shown as a field: it is not a question
       * the registrant should have to answer, and it is not trusted either.
       * The API re-resolves it against a verified salesman profile and ignores
       * anything it cannot stand behind, so an invented code credits nobody.
       */
      referralCode: referralCode ?? undefined,
      acceptedTerms: false as unknown as true,
    },
  });

  const role = form.watch('role');
  const planTier = form.watch('planTier');
  const billing = form.watch('planBilling');
  const planVehicles = form.watch('planVehicles');
  const planTrackers = form.watch('planTrackers');
  const driveMyself = form.watch('driveMyself');

  const isPersonal = planTier === PlanTier.PERSONAL;
  const isBusiness = planTier === PlanTier.BUSINESS;
  const isDriver = role === RoleName.DRIVER;
  // A customer may be one person with no company at all — the API names the
  // organization after them when this is left blank.
  const isCustomer = role === RoleName.CUSTOMER;
  /**
   * An account that must name a business is a business, and what belongs on
   * its orders, listings and invoices is its logo — not the face of whoever
   * happened to sign up. The individual accounts are the other way round.
   *
   * A Personal account holder is seated as the owner of an organization named
   * after them, so their role is FLEET_OWNER — but they are a person, and what
   * belongs on their profile is their face.
   */
  const wantsLogo = !isPersonal && Boolean(role) && ORGANIZATION_NAME_REQUIRED_ROLES.includes(role as never);

  /**
   * Answering the first question sets the plan and, for the two answers that
   * imply one, the role as well.
   *
   * Business is the only answer that leaves the role open, because it is the
   * only one where the kind of business still matters — a supplier and an
   * association get different halves of the product.
   */
  const chooseIntent = (next: AccountIntent): void => {
    const definition = ACCOUNT_INTENTS.find((candidate) => candidate.id === next);
    if (!definition) return;

    setIntent(next);
    form.setValue('planTier', definition.planTier ?? undefined, { shouldValidate: false });
    form.setValue('role', definition.role ?? undefined, { shouldValidate: false });

    // Only a Personal account holder can mark themselves a driver, so moving
    // off Personal must clear it rather than submit a flag the API rejects.
    if (definition.planTier !== PlanTier.PERSONAL) {
      form.setValue('driveMyself', false, { shouldValidate: false });
    }
  };

  // Switching account type changes what the image *means*. Carrying a company
  // logo across to a driver's profile photo would publish it as their face.
  React.useEffect(() => setImage(null), [wantsLogo]);

  /*
   * Opened once, by itself, for a first-time Business registrant.
   *
   * Gated on Business because that is what it explains: six kinds of business
   * that create six different things, a choice the API enforces by
   * organization type and which therefore cannot be corrected from the UI
   * later. It used to open the instant the page loaded, before the reader had
   * said anything — so a person signing up for their own two cars was walked
   * through a decision they were never going to be asked to make.
   *
   * A Personal registration is four short steps and needs no walkthrough; a
   * driver's is three.
   */
  React.useEffect(() => {
    if (!isBusiness) return;
    if (hasSeenRegistrationTutorial()) return;
    setTutorialOpen(true);
  }, [isBusiness]);

  /**
   * Closing the guided flow is not abandoning the registration.
   *
   * It writes into this same form as it goes, so whatever was answered is
   * already in the wizard below — which is why leaving says so rather than
   * warning about losing anything.
   */
  const closeTutorial = (open: boolean): void => {
    setTutorialOpen(open);
    if (open) return;

    markRegistrationTutorialSeen();
    if (form.formState.isDirty && !form.formState.isSubmitSuccessful) {
      toast.info(t('Your answers are saved in the form below - carry on from there.'));
    }
  };

  /**
   * The image goes up on the session the registration just returned — onto
   * the new organization for a business, onto the new user for a person.
   *
   * A failure here is not a failed registration — the account exists, and the
   * image can be added from the profile — so it is reported and stepped over
   * rather than thrown, which would strand somebody who is already signed in
   * on the sign-up form.
   */
  const uploadImage = async (session: SessionPayload, file: File): Promise<void> => {
    // Nullable on the session at large — a platform admin operates outside a
    // tenant — though a freshly registered account always has one.
    const organizationId = session.organization?.id;

    const attached = await uploadImageOrWarn(
      wantsLogo && organizationId
        ? {
            ownerType: MediaOwnerType.ORGANIZATION,
            ownerId: organizationId,
            purpose: MediaPurpose.LOGO,
            file,
          }
        : {
            ownerType: MediaOwnerType.USER,
            ownerId: session.user.id,
            purpose: MediaPurpose.AVATAR,
            file,
          },
      t('Your account is ready, but the image could not be saved.'),
    );

    // The API mirrors these onto `User.avatarUrl` and `Organization.logoUrl`;
    // without this the shell shows the placeholder until the next reload.
    if (attached) await refreshSession();
  };

  const onSubmit = async (values: RegisterInput): Promise<void> => {
    setFormError(null);
    try {
      const session = await register(values as unknown as Record<string, unknown>);
      // Whatever the API decided about the referral, this browser is done with
      // it: the account now exists and its attribution is settled server-side.
      forgetReferralCode();
      if (image) await uploadImage(session, image);
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        // Re-attach server-side field errors to the matching inputs.
        const fields = error.fieldErrors;
        let attached = false;
        for (const [field, messages] of Object.entries(fields)) {
          if (field in values && messages[0]) {
            form.setError(field as keyof RegisterInput, { message: messages[0] });
            attached = true;
          }
        }
        if (!attached) setFormError(error.message);
      } else {
        setFormError('Unable to create your account right now. Please try again.');
      }
    }
  };

  const stepCandidates: (WizardStep | null)[] = [
    {
      /*
       * First, before anything else is asked.
       *
       * Every later step is a question, and a question is useless to someone
       * who cannot read it. Choosing the language applies it immediately —
       * the rest of this wizard re-renders in it — so the form the person
       * fills in is one they can actually read.
       */
      id: 'language',
      title: t('Your language'),
      description: t('How Saarthi speaks to you.'),
      icon: Languages,
      fields: ['preferredLanguage'],
      content: (
        <FormField
          control={form.control}
          name="preferredLanguage"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t('Which language should Saarthi use?')}</FormLabel>
              <FormDescription>{t('You can change this later from your profile.')}</FormDescription>
              <div className="pt-1">
                <LanguageGrid
                  value={field.value ?? locale}
                  onChange={(next) => {
                    field.onChange(next);
                    // Apply at once rather than on submit: the remaining steps
                    // should already be in the language just chosen.
                    setLocale(next);
                  }}
                />
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ),
    },
    {
      /*
       * The decision the rest of the form depends on.
       *
       * Second rather than first only because a question has to be readable
       * before it can be answered. Everything after this branches on it: a
       * Personal customer is never asked what kind of business they are, and a
       * driver is never asked to pay.
       */
      id: 'plan',
      title: t('What brings you here'),
      description: t('This decides what we set up.'),
      icon: Briefcase,
      fields: ['planTier', 'planVehicles', 'planTrackers'],
      content: (
        <FormField
          control={form.control}
          name="planTier"
          render={() => (
            <FormItem>
              <FormLabel required>{t('Which of these is you?')}</FormLabel>
              <FormDescription>
                {t('Both plans cover one vehicle. Extra vehicles are {price} a month each.', {
                  price: formatCurrency(VEHICLE_TOPUP.priceMonthly),
                })}
              </FormDescription>

              <div
                role="radiogroup"
                aria-label={t('Which of these is you?')}
                className="grid grid-cols-1 gap-2.5 pt-1"
              >
                {ACCOUNT_INTENTS.map((option, index) => {
                  const selected = intent === option.id;
                  const price = intentPrice(option.id);
                  return (
                    <motion.button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseIntent(option.id)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      whileTap={{ scale: 0.985 }}
                      className={cn(
                        'glass-inset relative flex items-start gap-3 p-3.5 pr-9 text-left',
                        'transition-[background-color,border-color,box-shadow,transform] duration-200 ease-smooth',
                        selected
                          ? 'glass-choice-selected'
                          : 'hover:-translate-y-0.5 hover:border-white/70 hover:bg-white/60 dark:hover:bg-white/[0.06]',
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

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-sm font-medium">{t(option.title)}</span>
                          <span className="text-xs font-medium tabular-nums text-muted-foreground">
                            {price ?? t('No charge')}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {t(option.description)}
                        </span>
                      </span>

                      <AnimatePresence initial={false}>
                        {selected ? (
                          <motion.span
                            key="tick"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            className="absolute right-3 top-3 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            aria-hidden
                          >
                            <Check className="size-2.5" strokeWidth={4} />
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>

              {/* Only shown once there is a plan to bill. A driver has nothing
                  to choose a billing period for. */}
              <AnimatePresence initial={false}>
                {planTier ? (
                  <motion.div
                    key="billing"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="glass-inset mt-3 flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t('How would you like to pay?')}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('Yearly costs ten months instead of twelve.')}
                        </p>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={t('How would you like to pay?')}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-card/60 p-1"
                      >
                        {(['monthly', 'yearly'] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={billing === option}
                            onClick={() => form.setValue('planBilling', option)}
                            className={cn(
                              'rounded-full px-3.5 py-1 text-xs font-medium transition-colors duration-200',
                              billing === option
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {option === 'monthly' ? t('Monthly') : t('Yearly')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* The order, priced and adjustable.
                  Shown here because this is where the money is decided: a
                  reader who arrived from the pricing card sees the same total
                  they clicked on, and one who came straight to /register can
                  still say how many vehicles they run without going back. */}
              <AnimatePresence initial={false}>
                {planTier ? (
                  <motion.div
                    key="order"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <OrderSummary
                      tier={planTier}
                      billing={billing}
                      vehicles={planVehicles}
                      trackers={planTrackers}
                      onVehicles={(next) => {
                        form.setValue('planVehicles', next, { shouldValidate: false });
                        // Trackers are fitted to vehicles, so shrinking the
                        // fleet has to release the surplus hardware.
                        if (planTrackers > next) {
                          form.setValue('planTrackers', next, { shouldValidate: false });
                        }
                      }}
                      onTrackers={(next) =>
                        form.setValue('planTrackers', next, { shouldValidate: false })
                      }
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <FormMessage />
            </FormItem>
          )}
        />
      ),
    },
    /*
     * Which kind of business — and only for a business.
     *
     * A supplier, a travel operator and an association get different halves of
     * the product, and the API enforces that by organization type, so this
     * cannot be corrected from the UI afterwards. A Personal customer never
     * sees it: they are not choosing between kinds of business, and being made
     * to declare themselves one was the most confusing moment on this form.
     */
    isBusiness
      ? {
      id: 'account-type',
      title: t('Account type'),
      description: t('What kind of business.'),
      icon: Users,
      fields: ['role'],
      content: (
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t('I am a…')}</FormLabel>
              <FormDescription>
                {t(
                  'This decides what Saarthi sets up for you. It cannot be changed later from here.',
                )}
              </FormDescription>
              <div
                role="radiogroup"
                aria-label={t('I am a…')}
                className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2"
              >
                {ACCOUNT_TYPES.map((type, index) => {
                  const selected = field.value === type.role;
                  return (
                    <motion.button
                      key={type.role}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => field.onChange(type.role)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.035,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      whileTap={{ scale: 0.985 }}
                      className={cn(
                        'glass-inset relative flex items-start gap-3 p-3 pr-8 text-left',
                        'transition-[background-color,border-color,box-shadow,transform] duration-200 ease-smooth',
                        selected
                          ? 'glass-choice-selected'
                          : 'hover:-translate-y-0.5 hover:border-white/70 hover:bg-white/60 dark:hover:bg-white/[0.06]',
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
                        <type.icon className="size-4" aria-hidden />
                      </span>

                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t(type.title)}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                          {t(type.description)}
                        </span>
                      </span>

                      {/* A tick, not just a tint: the selected card has to be
                          obvious to someone reading the labels in a script
                          they know and the colours in bright sunlight. */}
                      <AnimatePresence initial={false}>
                        {selected ? (
                          <motion.span
                            key="tick"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.5 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            className="absolute right-2.5 top-2.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
                            aria-hidden
                          >
                            <Check className="size-2.5" strokeWidth={4} />
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ),
        }
      : null,
    {
      id: 'your-details',
      title: t('Your details'),
      description: t('Who we should reach.'),
      icon: UserRound,
      fields: ['firstName', 'lastName', 'email', 'phone'],
      content: (
        <>
          {/* Not a form field: it is not part of `registerSchema` and does not
              travel with the registration — see `uploadImage`. */}
          {!wantsLogo ? (
            <ImageCircleField
              value={image}
              onChange={setImage}
              label={t('Profile photo')}
              hint={t('Optional · JPEG, PNG, WebP or HEIC up to {size} MB', {
                size: IMAGE_MAX_SIZE_MB,
              })}
              accept={IMAGE_ACCEPT}
              maxSizeMb={IMAGE_MAX_SIZE_MB}
              icon={UserRound}
              onReject={(reason) => toast.error(reason)}
              className="pb-1"
            />
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t('First name')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="given-name" className="h-10" />
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
                  <FormLabel required>{t('Last name')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="family-name" className="h-10" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Email address')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    className="h-10"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Mobile number')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="9876543210"
                    className="h-10"
                  />
                </FormControl>
                <FormDescription>{t('Indian mobile number, with or without +91.')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ),
    },
    isPersonal
      ? {
          /*
           * The switch a Personal customer needs and nobody else does.
           *
           * The case: three cars, two driven by the drivers he employs and one
           * by him. Without this he is the only person on his own fleet who
           * cannot be assigned to a vehicle, and the workaround was to invent a
           * second account for himself — which then owns his trips, his duty
           * hours and his driving score under a different name.
           *
           * Off by default, because plenty of owners never drive. Turning it on
           * asks for the one thing a driver record cannot exist without.
           */
          id: 'driving',
          title: t('Do you drive?'),
          description: t('Only if one of them is yours to drive.'),
          icon: Car,
          fields: ['driveMyself', 'licenseNumber'],
          content: (
            <>
              <FormField
                control={form.control}
                name="driveMyself"
                render={({ field }) => (
                  <FormItem>
                    <div
                      className={cn(
                        'glass-inset flex items-start gap-3 p-3.5 transition-colors duration-200',
                        field.value
                          ? 'glass-choice-selected'
                          : 'hover:border-white/70 hover:bg-white/60 dark:hover:bg-white/[0.06]',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <FormLabel className="cursor-pointer text-sm font-medium">
                          {t('I drive one of my vehicles myself')}
                        </FormLabel>
                        <p className="mt-1 text-xs leading-snug text-muted-foreground">
                          {t(
                            'Adds you to your own driver list, so you can be assigned to a vehicle alongside the drivers you employ. Your trips, duty hours and expenses stay on your own account.',
                          )}
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={Boolean(field.value)}
                          onCheckedChange={(checked) => field.onChange(checked)}
                          aria-label={t('I drive one of my vehicles myself')}
                          className="mt-0.5 shrink-0"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Asked only once the switch is on: a licence number is the one
                  thing a driver record cannot be created without, and asking
                  for it unprompted would look like a requirement. */}
              <AnimatePresence initial={false}>
                {driveMyself ? (
                  <motion.div
                    key="self-licence"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <FormField
                      control={form.control}
                      name="licenseNumber"
                      render={({ field }) => (
                        <FormItem className="pt-3">
                          <FormLabel required>{t('Your driving licence number')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value ?? ''}
                              placeholder="DL-1420-20100000000"
                              className="h-10"
                            />
                          </FormControl>
                          <FormDescription>
                            {t('Exactly as printed on the licence, including the dashes.')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>
          ),
        }
      : isDriver
      ? {
          // A distinct id from the business step on purpose: switching account
          // type mid-form must re-open this step rather than let a cleared
          // company name stand in for an unfilled licence.
          id: 'driver-details',
          title: t('Driver details'),
          description: t('Your fleet and licence.'),
          icon: IdCard,
          fields: ['fleetInviteCode', 'licenseNumber'],
          content: (
            <>
              {/* Optional: a driver who has not been given a code yet still
                  gets an account, and enters one later from their own home
                  screen. Only the licence is actually required here. */}
              <FormField
                control={form.control}
                name="fleetInviteCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Fleet invite code')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="SR-XXXXXX"
                        className="h-10 font-mono uppercase tracking-wider"
                      />
                    </FormControl>
                    {/* Two sentences, two keys: the first is already
                        translated in every language, and rewording it to carry
                        the second would have orphaned all eighteen. */}
                    <FormDescription>
                      {t('Ask your truck owner for this code.')}{' '}
                      {t('No code yet? Leave it blank and join your fleet later.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="licenseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('Driving licence number')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="DL-1420-20100000000"
                        className="h-10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ),
        }
      : {
          id: 'business',
          title: isCustomer ? t('Your organization') : t('Your business'),
          description: isCustomer
            ? t('Only if you buy for a company.')
            : t('The organization we create for you.'),
          icon: Building2,
          fields: ['organizationName'],
          content: (
            <>
              {wantsLogo ? (
                <ImageCircleField
                  value={image}
                  onChange={setImage}
                  label={t('Company logo')}
                  hint={t('Optional · shown on your listings, orders and invoices')}
                  accept={IMAGE_ACCEPT}
                  maxSizeMb={IMAGE_MAX_SIZE_MB}
                  icon={Building2}
                  onReject={(reason) => toast.error(reason)}
                  className="pb-1"
                />
              ) : null}

              <FormField
                control={form.control}
                name="organizationName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required={!isCustomer}>
                      {t((role && ORGANIZATION_LABEL[role]) || 'Company name')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        autoComplete="organization"
                        className="h-10"
                        placeholder={(role && ORGANIZATION_PLACEHOLDER[role]) || 'Kumar Constructions'}
                      />
                    </FormControl>
                    <FormDescription>
                      {isCustomer
                        ? t(
                            'Leave this blank if you are booking for yourself - your account will simply carry your own name.',
                          )
                        : t('Saarthi creates this organization and makes you its administrator.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          ),
        },
    {
      id: 'security',
      title: t('Security'),
      description: t('Password and terms.'),
      icon: KeyRound,
      fields: ['password', 'acceptedTerms'],
      content: (
        <>
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('Password')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete="new-password"
                    placeholder="••••••••••"
                    className="h-10"
                  />
                </FormControl>
                {/* The rules as a live checklist rather than as a sentence the
                    person reads once and then fails four times. */}
                <PasswordStrength value={field.value ?? ''} className="pt-1" />
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="acceptedTerms"
            render={({ field }) => (
              <FormItem>
                {/* A div rather than a <label> wrapping the control: Radix
                    renders the checkbox as a <button>, and a label around it
                    double-fires the toggle in some browsers. `FormLabel`
                    already points at it via htmlFor, so the text is clickable
                    without that risk. */}
                <div
                  className={cn(
                    'glass-inset flex items-start gap-3 p-3',
                    'transition-colors duration-200',
                    field.value
                      ? 'glass-choice-selected'
                      : 'hover:border-white/70 hover:bg-white/60 dark:hover:bg-white/[0.06]',
                  )}
                >
                  <FormControl>
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                      className="mt-0.5"
                    />
                  </FormControl>
                  {/* The documents, beside the sentence that agrees to them.
                      Consent to something the person cannot read is not
                      consent, and this is the last step before the account is
                      created.

                      They open in a new tab on purpose: this is a wizard
                      holding several steps of unsaved answers, and navigating
                      away from it to read a legal document would discard
                      them. */}
                  <div className="min-w-0 space-y-1.5">
                    <FormLabel className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground">
                      {t('I agree to the VorldX Saarthi terms of service and privacy policy.')}
                    </FormLabel>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {LEGAL_LINKS.map((link) => (
                        <Link
                          key={link.to}
                          to={link.to}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-2xs font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {t(link.label)}
                          <ExternalLink className="size-3" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ),
    },
  ];

  /*
   * The steps that actually apply to this registration.
   *
   * A branch that does not apply is absent rather than empty: the wizard
   * numbers what it is given, so leaving a blank step in would have counted a
   * question nobody is asked.
   */
  const steps: WizardStep[] = stepCandidates.filter(
    (step): step is WizardStep => step !== null,
  );

  /**
   * `registerSchema` is a `ZodEffects` — its cross-field rules live in a
   * `superRefine`, so it cannot be `.pick()`ed apart into per-step schemas.
   * `trigger` runs the whole resolver and reports only the named fields, which
   * is exactly right here: the driver rules fire against the full object and
   * surface on the step that owns the field.
   */
  const validateStep = async (step: WizardStep): Promise<boolean> => {
    if (!step.fields?.length) return true;
    return form.trigger(step.fields as (keyof RegisterInput)[], { shouldFocus: true });
  };

  // After a rejected submit the offending field may sit on a step that is no
  // longer showing. Marking its step on the rail is what makes that findable.
  const erroredStepIds = steps
    .filter((step) => step.fields?.some((field) => field in form.formState.errors))
    .map((step) => step.id);

  return (
    <div className="space-y-5">
      <AuthHeading
        eyebrow={t('Getting set up')}
        title={t('Create your account')}
        description={t('Set up Saarthi for how you actually work.')}
      />

      {/* Offered once the reader has said they run a business, which is the
          question this walkthrough answers — "which of these six am I?".
          Before that there is nothing for it to explain. */}
      {isBusiness ? (
        <RegistrationTutorialLauncher onOpen={() => setTutorialOpen(true)} />
      ) : null}

      {/* Handed the page's own form rather than one of its own: the guided
          route and the wizard below are the same registration, so answering a
          question in one fills it in on the other. */}
      <RegistrationTutorial
        open={tutorialOpen}
        onOpenChange={closeTutorial}
        form={form}
        image={image}
        onImageChange={setImage}
        onSubmit={form.handleSubmit(onSubmit)}
        submitting={form.formState.isSubmitting}
        formError={formError}
      />

      <AnimatePresence initial={false}>
        {formError ? (
          <motion.div
            key="form-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Form {...form}>
        <FormWizard
          steps={steps}
          title={t('Getting set up')}
          // Counted from the steps themselves — the driver branch swaps a step
          // rather than adding one, but a future branch that does add one must
          // not leave this sentence lying.
          description={t('{count} short steps. Nothing is saved until the last one.', {
            count: steps.length,
          })}
          onValidateStep={validateStep}
          onSubmit={form.handleSubmit(onSubmit)}
          submitting={form.formState.isSubmitting}
          submitLabel={
            <>
              <ShieldCheck className="size-4" />
              {t('Create account')}
            </>
          }
          erroredStepIds={erroredStepIds}
        />
      </Form>

      {/* The same divider-and-button shape sign-in uses for its route out, so
          the two screens offer each other in one recognisable form. Held to
          the width of a form column rather than the wizard's, which would
          stretch a secondary action across the whole shell. */}
      <div className="mx-auto w-full max-w-md space-y-4 pt-1">
        <AuthDivider>{t('Already have an account?')}</AuthDivider>
        <Button variant="outline" size="lg" className="w-full" asChild>
          <Link to="/login">{t('Sign in')}</Link>
        </Button>
      </div>
    </div>
  );
}

export default RegisterPage;
