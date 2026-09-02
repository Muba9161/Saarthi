import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Building2,
  Check,
  HandshakeIcon,
  IdCard,
  KeyRound,
  Languages,
  Package,
  Plane,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import { RoleName, registerSchema, type RegisterInput } from '@saarthi/shared';
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
import { PasswordStrength } from '@/components/common/password-strength';
import { AuthDivider, AuthHeading } from '@/features/auth/auth-card';
import { LanguageGrid, useLocale } from '@/features/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
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
    description: 'I need materials moved and want to track the delivery.',
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

/** What the organization is called depends on what kind of business it is. */
const ORGANIZATION_LABEL: Partial<Record<RoleName, string>> = {
  [RoleName.SUPPLIER]: 'Business name',
  [RoleName.ASSOCIATION_ADMIN]: 'Association name',
  [RoleName.MOBILITY_PROVIDER]: 'Travel business name',
};

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = React.useState<string | null>(null);

  const { locale, setLocale, t } = useLocale();

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      role: RoleName.FLEET_OWNER,
      organizationName: '',
      // Whatever the browser or a previous visit already settled on, so the
      // first step opens on the answer rather than on a blank.
      preferredLanguage: locale,
      acceptedTerms: false as unknown as true,
    },
  });

  const role = form.watch('role');
  const isDriver = role === RoleName.DRIVER;

  const onSubmit = async (values: RegisterInput): Promise<void> => {
    setFormError(null);
    try {
      await register(values as unknown as Record<string, unknown>);
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

  const steps: WizardStep[] = [
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
      id: 'account-type',
      title: t('Account type'),
      description: t('How you will use Saarthi.'),
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
    },
    {
      id: 'your-details',
      title: t('Your details'),
      description: t('Who we should reach.'),
      icon: UserRound,
      fields: ['firstName', 'lastName', 'email', 'phone'],
      content: (
        <>
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
    isDriver
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
              <FormField
                control={form.control}
                name="fleetInviteCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('Fleet invite code')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="SR-XXXXXX"
                        className="h-10 font-mono uppercase tracking-wider"
                      />
                    </FormControl>
                    <FormDescription>{t('Ask your truck owner for this code.')}</FormDescription>
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
          title: t('Your business'),
          description: t('The organization we create for you.'),
          icon: Building2,
          fields: ['organizationName'],
          content: (
            <FormField
              control={form.control}
              name="organizationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t(ORGANIZATION_LABEL[role] ?? 'Company name')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ''}
                      autoComplete="organization"
                      className="h-10"
                      placeholder={
                        role === RoleName.FLEET_OWNER
                          ? 'Sharma Transport Company'
                          : 'Kumar Constructions'
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Saarthi creates this organization and makes you its administrator.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                  <FormLabel className="cursor-pointer text-sm font-normal leading-snug text-muted-foreground">
                    {t('I agree to the VorldX Saarthi terms of service and privacy policy.')}
                  </FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ),
    },
  ];

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
