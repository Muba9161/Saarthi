import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  BadgeIndianRupee,
  Briefcase,
  Building2,
  ExternalLink,
  IdCard,
  KeyRound,
  Languages,
  MailCheck,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  DEFAULT_TRACKER_PRODUCT,
  MediaOwnerType,
  MediaPurpose,
  ORGANIZATION_NAME_REQUIRED_ROLES,
  PlanTier,
  RoleName,
  registerSchema,
  registrationRole,
  type RegisterInput,
  type RegistrableRole,
  type SessionPayload,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  AccountTypeStep,
  PlanStep,
  PlanSummary,
  accountTypeChoiceFor,
  chosenPlan,
  planFromQuery,
  valuesForAccountType,
  valuesForPlan,
  type RegistrationChoice,
} from '@/features/auth/registration-plan';
import { LanguageGrid, useLocale } from '@/features/i18n';
import { LEGAL_LINKS } from '@/features/legal/legal-links';
import { forgetReferralCode, resolveReferralCode } from '@/features/sales/referral-code';
import { markFleetWelcomePending } from '@/features/fleet/fleet-welcome-dialog';
import { useAuth } from '@/features/auth/auth-context';
import { trackEvent } from '@/features/analytics';
import {
  EmailCodeStep,
  EmailVerificationHint,
  VERIFY_EMAIL_STEP_ID,
  useRegistrationEmailCode,
} from '@/features/auth/email-verification';
import { ApiError } from '@/lib/api-client';
import { uploadImageOrWarn } from '@/features/media/upload-image';
import { AnimatePresence, motion } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * Registration.
 *
 * The account type chosen here decides what Saarthi creates alongside the user
 * — a fleet, a seller's business, a customer account, a travel operator, a
 * truck association, or a driver profile inside an existing fleet.
 *
 * This choice is not cosmetic. Several surfaces belong to exactly one kind of
 * business: only a travel operator can publish tour packages, only an
 * association can run an emergency queue. The API enforces that by
 * organization type, so picking the wrong one here cannot be worked around
 * later from the UI — it has to be the right account from the start.
 *
 * It is asked as two short questions rather than one long list: the plan, then
 * the kind of account inside it, only for the plans that have more than one —
 * see `registration-plan`. The plan question is skipped when the pricing page
 * already answered it.
 */

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


/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const IMAGE_MAX_SIZE_MB = 5;
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

const PLAN_STEP_ID = 'plan';
const ACCOUNT_TYPE_STEP_ID = 'account-type';

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
   * The plan the visitor chose on the pricing card, from `?plan=`.
   *
   * Only the plan: vehicles and trackers are no longer part of signing up.
   * Somebody adds their vehicles once they are in, buys an extra vehicle slot
   * when they add the second one, and buys a tracker from the vehicle's
   * telemetry screen — so nobody is asked to buy anything before they have
   * seen the product.
   */
  const linkedPlan = React.useMemo(
    () => planFromQuery(searchParams.get('plan')),
    [searchParams],
  );

  /**
   * Whether the plan is asked here.
   *
   * Not when the pricing page already chose it — the registrant has answered
   * that once. "Change plan" beside the steps brings the question back.
   */
  const [askPlan, setAskPlan] = React.useState(!linkedPlan);

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

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      // Asked for on the last step, once the code has been emailed.
      emailCode: '',
      phone: '',
      password: '',
      // Only what the pricing page already settled. A plan with a second
      // question leaves the role for it, so no pre-filled fleet owner stands in
      // for an answer nobody gave.
      ...(linkedPlan ? valuesForPlan(linkedPlan) : {}),
      // Nothing is ordered at signup: the plan's included vehicle, no trackers.
      planVehicles: 1,
      planTrackers: 0,
      planTrackerProduct: DEFAULT_TRACKER_PRODUCT,
      organizationName: '',
      // Whatever the browser or a previous visit already settled on, so the
      // first step opens on the answer rather than on a blank.
      preferredLanguage: locale,
      /*
       * The Saarthi Rahi to credit this signup to, if the visitor arrived
       * through a referral link or QR.
       *
       * Read from `?ref=` and, failing that, from what the referral landing
       * page remembered — somebody may open the link on Tuesday and finish
       * signing up on Thursday. Never shown as a field: it is not a question
       * the registrant should have to answer, and it is not trusted either.
       * The API re-resolves it against a verified Saarthi Rahi profile and ignores
       * anything it cannot stand behind, so an invented code credits nobody.
       */
      referralCode: referralCode ?? undefined,
      acceptedTerms: false as unknown as true,
    },
  });

  const role = form.watch('role');
  const planTier = form.watch('planTier');
  /** Held here so the wizard and the guided tutorial share one live code. */
  const emailCode = useRegistrationEmailCode(form);

  const isPersonal = planTier === PlanTier.PERSONAL;
  const isBusiness = planTier === PlanTier.BUSINESS;
  const isDriver = role === RoleName.DRIVER;

  /** The plan as the registrant chose it — Free for a driver, who takes none. */
  const plan = chosenPlan({ planTier, role });
  /** The second question, for the plans that ask one. */
  const accountTypeChoice = accountTypeChoiceFor(plan);
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

  const applyChoice = (choice: RegistrationChoice): void => {
    form.setValue('planTier', choice.planTier, { shouldValidate: false });
    form.setValue('role', choice.role, { shouldValidate: false });
    form.clearErrors(['planTier', 'role']);
  };

  // Choosing the plan already chosen keeps the type answered under it.
  const choosePlan = (tier: PlanTier): void => {
    if (tier !== plan) applyChoice(valuesForPlan(tier));
  };

  const chooseAccountType = (next: RegistrableRole): void => {
    if (plan) applyChoice(valuesForAccountType(plan, next));
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
      const createdRole = registrationRole(values);
      const tier = session.subscription?.planTier;
      // The marketing site's conversion. Sent before the next await: the new
      // session switches analytics off as soon as React re-renders with it.
      trackEvent('sign_up', { account_type: createdRole, ...(tier ? { plan: tier } : {}) });
      // Whatever the API decided about the referral, this browser is done with
      // it: the account now exists and its attribution is settled server-side.
      forgetReferralCode();
      if (image) await uploadImage(session, image);
      // An owner who employs drivers is greeted with their joining code.
      if (createdRole === RoleName.FLEET_OWNER || createdRole === RoleName.MOBILITY_PROVIDER) {
        markFleetWelcomePending();
      }
      // A paid plan goes on to activation: pay for any extras ordered here and
      // approve autopay for when the trial ends — both through Cashfree.
      const paidPlan =
        tier === PlanTier.PERSONAL || tier === PlanTier.BUSINESS || tier === PlanTier.SUPPLIER;
      navigate(paidPlan ? '/activate' : '/', { replace: true });
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

  /**
   * What only this kind of account is asked: a driver their licence and
   * joining code, a business its name. Shown inside "Your details" so every
   * registration is the same four steps.
   *
   * A Personal owner is asked nothing more. Whether they drive is asked when
   * they assign a vehicle — "Assign to yourself" or "Assign to a driver" —
   * which is where the answer belongs, on Personal and Business alike.
   */
  const typeStep: WizardStep | null = isPersonal
      ? null
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
                    <FormLabel>{t('Fleet joining code (optional)')}</FormLabel>
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
                      {t('Have a code from a fleet owner? Enter it to work under their fleet.')}{' '}
                      {t('Looking for work? Leave it blank - you can enter a code later, whenever a fleet takes you on.')}
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
    /*
     * The decision the rest of the form depends on, as two short questions.
     *
     * After the language only because a question has to be readable before it
     * can be answered. Everything later branches on these: a Personal customer
     * is never asked what kind of business they are, and a driver is never
     * asked to pay.
     */
    askPlan
      ? {
          id: PLAN_STEP_ID,
          title: t('Your plan'),
          description: t('Pick what fits you.'),
          icon: BadgeIndianRupee,
          fields: ['planTier'],
          content: <PlanStep form={form} plan={plan} onChoose={choosePlan} />,
        }
      : null,
    accountTypeChoice
      ? {
          id: ACCOUNT_TYPE_STEP_ID,
          title: t('Account type'),
          description: t(accountTypeChoice.summary),
          icon: Briefcase,
          fields: ['role'],
          content: (
            <AccountTypeStep form={form} choice={accountTypeChoice} onChoose={chooseAccountType} />
          ),
        }
      : null,
    {
      id: 'your-details',
      title: t('Your details'),
      description: t('Who we should reach.'),
      icon: UserRound,
      // Plus whatever this kind of account also needs — see `typeStep`.
      fields: ['firstName', 'lastName', 'email', 'phone', ...(typeStep?.fields ?? [])],
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
                <EmailVerificationHint />
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

          {/* The questions only this kind of account is asked, on the same
              step rather than a screen of their own. */}
          {typeStep ? (
            <section className="space-y-3 border-t border-border/50 pt-4">
              <div>
                <p className="text-sm font-medium">{typeStep.title}</p>
                {typeStep.description ? (
                  <p className="text-xs text-muted-foreground">{typeStep.description}</p>
                ) : null}
              </div>
              {typeStep.content}
            </section>
          ) : null}
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
    {
      id: VERIFY_EMAIL_STEP_ID,
      title: t('Verify email'),
      description: t('The code we emailed you.'),
      icon: MailCheck,
      fields: ['emailCode'],
      content: <EmailCodeStep form={form} controller={emailCode} />,
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
  const validateStep = async (step: WizardStep, index: number): Promise<boolean> => {
    if (step.fields?.length) {
      const ok = await form.trigger(step.fields as (keyof RegisterInput)[], { shouldFocus: true });
      if (!ok) return false;
    }
    // The schema lets a Free registration through without a role — it means a
    // customer — but this step is where they say customer or driver, so an
    // unanswered one is stopped here rather than guessed.
    if (step.id === ACCOUNT_TYPE_STEP_ID && !form.getValues('role')) {
      form.setError('role', { message: t('Choose one to continue.') });
      return false;
    }
    // Leaving the step before verification is what emails the code.
    if (steps[index + 1]?.id === VERIFY_EMAIL_STEP_ID) return emailCode.ensureSent();
    return true;
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
        emailCode={emailCode}
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
          // "Change plan" brings the plan step back and opens it.
          resetKey={askPlan}
          initialStepId={askPlan && linkedPlan ? PLAN_STEP_ID : undefined}
          aside={
            !askPlan && plan ? (
              <PlanSummary tier={plan} onChange={() => setAskPlan(true)} />
            ) : undefined
          }
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
