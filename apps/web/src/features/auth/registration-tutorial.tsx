import * as React from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Clock3,
  GraduationCap,
  Info,
  Languages,
  ListChecks,
  Pencil,
  ShieldCheck,
  Sparkles,
  SkipForward,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  ORGANIZATION_NAME_REQUIRED_ROLES,
  RoleName,
  languageByCode,
  type RegisterInput,
  type RegistrableRole,
} from '@saarthi/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StepStrip, type StepDescriptor, type StepStatus } from '@/components/ui/stepper';
import { WIZARD_DIALOG_HEADER, WIZARD_DIALOG_PANEL } from '@/components/common/form-wizard';
import { ImageCircleField } from '@/components/common/file-dropzone';
import { PasswordStrength } from '@/components/common/password-strength';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { LanguageGrid, useLocale } from '@/features/i18n';
import { cn } from '@/lib/utils';
import {
  ACCOUNT_GUIDES,
  guideForRole,
  type AccountGuide,
  type GuidedQuestion,
} from './registration-guide';

/**
 * Guided registration — one question at a time.
 *
 * The form next door asks eleven things across five steps, which is the right
 * shape for somebody who already knows what Saarthi is. It is the wrong shape
 * for somebody who does not: the account type alone decides what gets created,
 * which half of the product they can reach and what the remaining questions
 * even are, and the API enforces that by organization type — so a wrong answer
 * there is a second account, not a setting to change.
 *
 * So this asks one thing per screen, in its own words, with the rule stated
 * before it can be broken, and refuses to move on until that one thing is
 * answered. Nothing is described in the abstract: every screen carries the
 * real control, and the answer goes straight into the real form.
 *
 * That last part is the whole design. This does not keep a copy of anything —
 * it writes into the same `useForm` instance the page's wizard is bound to, so
 * the two are always the same registration. Somebody who gets three questions
 * in and closes the dialog finds those three answers already filled in behind
 * it; somebody who finishes here creates the account from here.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

/** Remembers that the guided flow has been offered, so it opens itself once. */
const SEEN_KEY = 'saarthi.register.tutorial.seen';

export function hasSeenRegistrationTutorial(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'true';
  } catch {
    // Private browsing, a locked-down profile, an embedded webview. Treating
    // that as "already seen" is the quiet failure: no auto-open, and the
    // launcher on the page still works.
    return true;
  }
}

export function markRegistrationTutorialSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, 'true');
  } catch {
    /* Ignored — see hasSeenRegistrationTutorial. */
  }
}

/** Mirrors MEDIA_MAX_FILE_SIZE on the API, so a rejection happens here first. */
const IMAGE_MAX_SIZE_MB = 5;
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

/*
 * Why this dialog does not use `WIZARD_DIALOG_CONTENT`.
 *
 * That surface is 75% white over a 2px-blurred scrim, and it looks right over
 * the app shell, where whatever sits behind a dialog is one even tone. The
 * auth layout is not: a navy brand panel fills the left of the screen and a
 * near-white form column the right, and a dialog centred over the seam picks
 * up both — its left half goes grey, its right half stays white, and no amount
 * of blur removes the difference because blurring averages a region, it does
 * not level two regions against each other.
 *
 * So the scrim does the blurring, heavily enough that nothing behind reads as
 * an edge, and the panel itself stops being see-through. What made the pane
 * look like glass then has to be painted on rather than refracted — which
 * `wizard-shell` already does: it carries the brand wash and the top highlight
 * as pseudo-elements, both of which it defines per theme. Borrowing the class
 * and overriding its fill is why those two layers are not hand-rolled here.
 */
const TUTORIAL_OVERLAY = 'bg-slate-950/60 backdrop-blur-lg';

const TUTORIAL_DIALOG_CONTENT = [
  // For the wash, the highlight, and the z-index it puts on its children so
  // they paint above both. Utilities beat the component layer, so everything
  // below still displaces what the class itself sets.
  'wizard-shell',
  // A column capped to the viewport, so the footer cannot be pushed off the
  // bottom of a short screen: the question panel is the only part that scrolls.
  'flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:p-0',
  'w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-3xl',
  // A shade off white, so the white cards and inputs inside have something to
  // sit on — pure white would swallow them. Opaque, so `wizard-shell`'s own
  // backdrop blur has nothing left to do and is switched off.
  'border-border bg-background shadow-overlay backdrop-blur-none',
  'dark:border-white/[0.09] dark:bg-card',
].join(' ');

/**
 * A bordered group inside this dialog.
 *
 * `glass-inset` fills with `bg-white/40` behind a `border-white/50` hairline,
 * which reads as a card only when there is something tinted behind it for it
 * to be lighter than. This panel is opaque, so that treatment would be white
 * on white — the cards in here take a real border and the card fill instead.
 */
const INSET =
  'rounded-xl border border-border bg-card dark:border-white/[0.08] dark:bg-white/[0.04]';

/** The same card, offered to the pointer. */
const INSET_HOVER =
  'hover:border-border-strong hover:bg-secondary/50 dark:hover:border-white/20 dark:hover:bg-white/[0.07]';

/** A panel that is a note rather than a control — no hover, quieter fill. */
const INSET_QUIET =
  'rounded-xl border border-border bg-muted/50 dark:border-white/[0.07] dark:bg-white/[0.03]';

/* ---------------------------------------------------------------------------
 * The launcher on the registration page
 * ------------------------------------------------------------------------ */

/**
 * The way in.
 *
 * Deliberately a banner rather than a link in small print: somebody who does
 * not know which of six account types they are is precisely the person who
 * will not go looking for help, and the cost of them guessing wrong is an
 * account that cannot do what they came for.
 */
export function RegistrationTutorialLauncher({ onOpen }: { onOpen: () => void }) {
  const { t } = useLocale();

  return (
    <div
      className={cn(
        'glass-panel edge-accent flex flex-col gap-3 rounded-2xl p-4',
        'sm:flex-row sm:items-center sm:justify-between sm:gap-4',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <GraduationCap className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold leading-snug">
            {t('New here? Let Saarthi walk you through it.')}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              'One question at a time, in plain words, with the answer checked as you go. Everything you enter fills in the form below.',
            )}
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="gradient"
        size="sm"
        onClick={onOpen}
        className="shrink-0 self-start sm:self-auto"
      >
        <Sparkles className="size-4" />
        {t('Guide me')}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Small pieces
 * ------------------------------------------------------------------------ */

/** An aside on a question — advice, or the thing that stops the form dead. */
function Callout({ tone, children }: { tone: 'tip' | 'warning'; children: React.ReactNode }) {
  const warning = tone === 'warning';
  const Icon = warning ? CircleAlert : Info;

  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-xl border p-3',
        warning ? 'border-warning/35 bg-warning/[0.08]' : 'border-info/30 bg-info/[0.07]',
      )}
    >
      <Icon
        className={cn('mt-0.5 size-4 shrink-0', warning ? 'text-warning' : 'text-info')}
        aria-hidden
      />
      <p className="text-xs leading-relaxed text-foreground/85">{children}</p>
    </div>
  );
}

/**
 * The heading, help and asides wrapped around whatever control the screen
 * needs — so every question in the flow is laid out identically and only the
 * answer changes.
 */
function QuestionFrame({
  icon: Icon,
  question,
  help,
  rule,
  example,
  tip,
  warning,
  optional,
  children,
}: {
  icon: LucideIcon;
  question: string;
  help?: string;
  rule?: string;
  example?: string;
  tip?: string;
  warning?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useLocale();

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">{t(question)}</h2>
            {optional ? (
              <Badge variant="muted" size="sm">
                {t('Optional')}
              </Badge>
            ) : (
              <Badge variant="default" size="sm">
                {t('Required')}
              </Badge>
            )}
          </div>
          {help ? (
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{t(help)}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">{children}</div>

      {rule || example ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {rule ? (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/75">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              {t(rule)}
            </p>
          ) : null}
          {example ? (
            <p className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-2xs uppercase tracking-wider text-muted-foreground">
                {t('Example')}
              </span>
              <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs dark:border-white/[0.08] dark:bg-white/[0.05]">
                {example}
              </code>
            </p>
          ) : null}
        </div>
      ) : null}

      {tip ? <Callout tone="tip">{t(tip)}</Callout> : null}
      {warning ? <Callout tone="warning">{t(warning)}</Callout> : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The flow
 * ------------------------------------------------------------------------ */

/**
 * One screen.
 *
 * Extends the stepper's own descriptor so the rail across the top is the same
 * component the registration wizard uses — the guided route and the direct one
 * then mark progress identically rather than inventing two vocabularies for
 * "you are here".
 */
interface FlowStep extends StepDescriptor {
  /** Validated with `form.trigger` before the screen will let anybody past. */
  fields: readonly (keyof RegisterInput)[];
  /** Absent on the language, account-type, ready-check and review screens. */
  question?: GuidedQuestion;
}

export interface RegistrationTutorialProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The page's own form. Shared rather than mirrored: answers given here are
   * the registration, not a copy of it that has to be handed over later.
   */
  form: UseFormReturn<RegisterInput>;
  /** Held on the page, because the upload needs a session that does not exist yet. */
  image: File | null;
  onImageChange: (file: File | null) => void;
  /** The page's `form.handleSubmit(onSubmit)`. */
  onSubmit: () => void | Promise<void>;
  submitting: boolean;
  /** Whatever the last submit failed with — the page's alert is behind this. */
  formError: string | null;
}

export function RegistrationTutorial({
  open,
  onOpenChange,
  form,
  image,
  onImageChange,
  onSubmit,
  submitting,
  formError,
}: RegistrationTutorialProps) {
  const { locale, setLocale, t } = useLocale();
  const reduced = useReducedMotion();

  const [index, setIndex] = React.useState(0);
  const [direction, setDirection] = React.useState(1);
  const [checking, setChecking] = React.useState(false);
  /** Screens cleared at least once — these stay reachable from the rail. */
  const [visited, setVisited] = React.useState<ReadonlySet<string>>(() => new Set());
  /** Ticked on the ready check. A reading aid; nothing is saved. */
  const [ready, setReady] = React.useState<ReadonlySet<string>>(() => new Set());

  const values = form.watch();
  /*
   * The account type the guided route narrates.
   *
   * `role` is unanswered until the account-type screen, because the form no
   * longer pre-fills it — a Personal registration is never asked it at all.
   * The walkthrough is per role and has to show something before that screen,
   * so it opens on the fleet owner's script, which is the commonest arrival
   * and the one the account-type screen itself defaults to explaining.
   */
  const role: RegistrableRole = values.role ?? RoleName.FLEET_OWNER;
  const guide = guideForRole(role);
  const wantsLogo = ORGANIZATION_NAME_REQUIRED_ROLES.includes(role);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const steps: FlowStep[] = React.useMemo(
    () => [
      /*
       * Language first, before anything is asked. Every screen after it is a
       * question, and a question is useless to somebody who cannot read it.
       */
      {
        id: 'language',
        title: t('Language'),
        icon: Languages,
        fields: ['preferredLanguage'],
      },
      { id: 'account-type', title: t('Account type'), icon: Users, fields: ['role'] },
      { id: 'ready', title: t('Ready check'), icon: ListChecks, fields: [], optional: true },
      ...guide.questions.map((question) => ({
        id: question.id,
        title: t(question.label),
        icon: question.icon,
        fields: question.fields,
        ...(question.optional ? { optional: true } : {}),
        question,
      })),
      { id: 'review', title: t('Review'), icon: ShieldCheck, fields: ['acceptedTerms'] },
    ],
    [guide, t],
  );

  // The question list changes with the account type, so an index held while
  // somebody goes back and switches could land on a different screen entirely.
  const safeIndex = Math.min(index, steps.length - 1);
  const step = steps[safeIndex];
  const isReview = step?.id === 'review';

  React.useEffect(() => {
    if (safeIndex !== index) setIndex(safeIndex);
  }, [safeIndex, index]);

  /*
   * Reopening starts at the beginning. The answers do not: they live on the
   * page's form, so closing at question four and reopening shows those four
   * already filled in — which is the behaviour that makes leaving safe.
   */
  React.useEffect(() => {
    if (!open) return;
    setIndex(0);
    setDirection(1);
    setVisited(new Set());
  }, [open]);

  const scrollToTop = (): void => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

  const moveTo = (position: number): void => {
    setDirection(position > safeIndex ? 1 : -1);
    setIndex(position);
    scrollToTop();
  };

  /**
   * One path for the Continue button and the Enter key, so the two can never
   * disagree about what pressing Enter on question four ought to do.
   */
  const advance = async (): Promise<void> => {
    if (!step || submitting || checking) return;

    if (step.fields.length) {
      setChecking(true);
      try {
        /*
         * `registerSchema` is a `ZodEffects` — its cross-field rules live in a
         * `superRefine`, so it cannot be picked apart per screen. `trigger`
         * runs the whole resolver and reports only the named fields, which is
         * exactly right: the driver rules fire against the full object and
         * surface on the screen that owns the field.
         */
        const ok = await form.trigger(step.fields, { shouldFocus: true });
        if (!ok) return;
      } finally {
        setChecking(false);
      }
    }

    setVisited((previous) => new Set(previous).add(step.id));

    if (safeIndex < steps.length - 1) {
      moveTo(safeIndex + 1);
      return;
    }

    await onSubmit();
  };

  /** For the screens that may be passed with nothing entered. */
  const skip = (): void => {
    if (!step) return;
    setVisited((previous) => new Set(previous).add(step.id));
    if (safeIndex < steps.length - 1) moveTo(safeIndex + 1);
  };

  const goBack = (): void => {
    if (safeIndex > 0) moveTo(safeIndex - 1);
  };

  const statusOf = (position: number): StepStatus => {
    const candidate = steps[position];
    if (!candidate) return 'upcoming';
    if (candidate.fields.some((field) => field in form.formState.errors)) return 'error';
    if (position === safeIndex) return 'current';
    if (position < safeIndex || visited.has(candidate.id)) return 'complete';
    return 'upcoming';
  };

  // Backwards always; forwards only onto a screen already cleared once, so the
  // per-question check cannot be walked around.
  const canSelect = (position: number): boolean => {
    if (submitting || checking || position === safeIndex) return false;
    if (position < safeIndex) return true;
    const candidate = steps[position];
    return Boolean(candidate && visited.has(candidate.id));
  };

  /*
   * Writes straight onto the shared form, which is also what drops a picked
   * image when the type changes: the page watches `role`, and a company logo
   * carried across to a driver's profile photo would publish it as their
   * face. Repeating that rule here would be a second copy of it to keep
   * right.
   */
  const selectRole = (next: RegistrableRole): void =>
    form.setValue('role', next, { shouldValidate: true, shouldDirty: true });

  /** What the review screen shows against each question already answered. */
  const answerFor = (candidate: FlowStep): string => {
    switch (candidate.id) {
      case 'language':
        return languageByCode(values.preferredLanguage).endonym;
      case 'account-type':
        return t(guide.title);
      case 'name':
        return [values.firstName, values.lastName].filter(Boolean).join(' ');
      case 'email':
        return values.email;
      case 'phone':
        return values.phone;
      case 'image':
        return image?.name ?? t('Not added');
      case 'organization':
        return values.organizationName || t('Left blank - the account will carry your own name');
      case 'fleet-code':
        return (
          values.fleetInviteCode || t('Skipped - you can join your fleet from your home screen')
        );
      case 'licence':
        return values.licenseNumber ?? '';
      case 'password':
        return values.password ? '••••••••••' : '';
      default:
        return '';
    }
  };

  if (!step) return null;

  const optional = Boolean(step.question?.optional);
  const percent = steps.length > 1 ? (safeIndex / (steps.length - 1)) * 100 : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={TUTORIAL_DIALOG_CONTENT} overlayClassName={TUTORIAL_OVERLAY}>
        {/* The page renders its own provider around the wizard; this one is
            outside it in the DOM, because Radix portals the dialog to <body>.
            Same form instance, so the two stay one registration. */}
        <Form {...form}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void advance();
            }}
            noValidate
            className="relative z-[1] flex min-h-0 flex-auto flex-col"
          >
            <DialogHeader
              className={cn(WIZARD_DIALOG_HEADER, 'border-border dark:border-white/[0.07]')}
            >
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <GraduationCap className="size-5 shrink-0 text-primary" aria-hidden />
                {t('Let us set up your account')}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed sm:text-sm">
                {t(
                  'One question at a time. Everything you enter is saved into the form behind - nothing is submitted until the last screen.',
                )}
              </DialogDescription>

              {/* Where you are, what it is called, and how far along — the
                  same rail the registration wizard uses, so the guided route
                  and the direct one mark progress identically. */}
              <div
                className="pt-2"
                style={{ '--wizard-progress': `${percent}%` } as React.CSSProperties}
              >
                <StepStrip
                  steps={steps}
                  current={safeIndex}
                  statusOf={statusOf}
                  onSelect={moveTo}
                  canSelect={canSelect}
                />
              </div>
            </DialogHeader>

            <div ref={scrollRef} className={cn(WIZARD_DIALOG_PANEL, 'p-5 sm:p-6')}>
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={step.id}
                  custom={direction}
                  initial={reduced ? false : 'enter'}
                  animate="center"
                  exit="exit"
                  variants={{
                    enter: (towards: number) => ({ opacity: 0, x: towards * 26 }),
                    center: { opacity: 1, x: 0 },
                    exit: (towards: number) => ({ opacity: 0, x: towards * -26 }),
                  }}
                  transition={{ duration: 0.26, ease: EASE }}
                >
                  {step.id === 'language' ? (
                    <LanguageScreen form={form} locale={locale} onLocale={setLocale} />
                  ) : step.id === 'account-type' ? (
                    <AccountTypeScreen selected={role} onSelect={selectRole} />
                  ) : step.id === 'ready' ? (
                    <ReadyScreen
                      guide={guide}
                      ready={ready}
                      onToggle={(label) =>
                        setReady((previous) => {
                          const next = new Set(previous);
                          if (next.has(label)) next.delete(label);
                          else next.add(label);
                          return next;
                        })
                      }
                    />
                  ) : step.id === 'review' ? (
                    <ReviewScreen
                      steps={steps}
                      answerFor={answerFor}
                      onEdit={moveTo}
                      form={form}
                      formError={formError}
                    />
                  ) : step.question ? (
                    <QuestionScreen
                      question={step.question}
                      form={form}
                      image={image}
                      onImageChange={onImageChange}
                      wantsLogo={wantsLogo}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border p-4 dark:border-white/[0.07] sm:px-6">
              <div className="flex items-center gap-2">
                {safeIndex > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={goBack}
                    disabled={submitting || checking}
                  >
                    <ArrowLeft className="size-4" />
                    {t('Back')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={submitting}
                  >
                    {t('I will fill it in myself')}
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {optional ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={skip}
                    disabled={submitting || checking}
                  >
                    <SkipForward className="size-4" />
                    {t('Skip')}
                  </Button>
                ) : null}

                <Button
                  type="submit"
                  variant="gradient"
                  loading={submitting || checking}
                  className="min-w-36"
                >
                  {isReview ? (
                    <>
                      <ShieldCheck className="size-4" />
                      {t('Create account')}
                    </>
                  ) : (
                    <>
                      {t('Continue')}
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * The screens
 * ------------------------------------------------------------------------ */

function LanguageScreen({
  form,
  locale,
  onLocale,
}: {
  form: UseFormReturn<RegisterInput>;
  locale: string;
  onLocale: (next: string) => void;
}) {
  const { t } = useLocale();

  return (
    <QuestionFrame
      icon={Languages}
      question="Which language should Saarthi use?"
      help="Everything from here on is a question, and a question is only useful in a language you read comfortably. Pick yours and the rest of this changes to it straight away."
      tip="A language marked as not translated still works - those screens stay in English until their translation lands. You can change this later from your profile."
    >
      <FormField
        control={form.control}
        name="preferredLanguage"
        render={({ field }) => (
          <FormItem>
            <div className={cn(INSET_QUIET, 'p-3')}>
              <LanguageGrid
                value={field.value ?? locale}
                onChange={(next) => {
                  field.onChange(next);
                  // Applied at once rather than on submit: the next question
                  // should already be in the language just chosen.
                  onLocale(next);
                }}
              />
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <p className="sr-only">{t('Choose a language to continue.')}</p>
    </QuestionFrame>
  );
}

function AccountTypeScreen({
  selected,
  onSelect,
}: {
  selected: RegistrableRole;
  onSelect: (role: RegistrableRole) => void;
}) {
  const { t } = useLocale();
  const guide = guideForRole(selected);

  return (
    <QuestionFrame
      icon={Users}
      question="Which of these is you?"
      help="This is the decision everything else hangs off. It sets up a different account for each answer, and it cannot be changed from the app afterwards - so pick the one that describes the business you actually run."
    >
      <div
        role="radiogroup"
        aria-label={t('Which of these is you?')}
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
      >
        {ACCOUNT_GUIDES.map((option, position) => {
          const active = option.role === selected;

          return (
            <motion.button
              key={option.role}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(option.role)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: position * 0.035, ease: EASE }}
              whileTap={{ scale: 0.985 }}
              className={cn(
                INSET,
                'relative flex items-start gap-3 p-3 pr-8 text-left',
                'transition-[background-color,border-color,box-shadow,transform] duration-200 ease-smooth',
                active ? 'glass-choice-selected' : cn('hover:-translate-y-0.5', INSET_HOVER),
              )}
            >
              <span
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted/60 text-muted-foreground dark:bg-white/[0.06]',
                )}
              >
                <option.icon className="size-4" aria-hidden />
              </span>

              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(option.title)}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {t(option.tagline)}
                </span>
              </span>

              {/* Same tick, same corner as the account-type step of the form
                  behind, so the choice made here is recognisable there. */}
              <AnimatePresence initial={false}>
                {active ? (
                  <motion.span
                    key="tick"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.18, ease: EASE }}
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

      {/* The consequence of the answer, restated as it changes. Without it the
          grid is six labels and no answer to "what do I actually get?". */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={selected}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: EASE }}
          className={cn(INSET_QUIET, 'space-y-2.5 border-primary/30 p-3.5 dark:border-primary/25')}
        >
          <p className="section-label text-primary/80">{t('What this creates')}</p>
          <p className="text-sm leading-relaxed">{t(guide.creates)}</p>

          <ul className="space-y-1.5">
            {guide.chooseIf.map((line) => (
              <li key={line} className="flex items-start gap-2 text-xs leading-relaxed">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                <span className="text-foreground/85">{t(line)}</span>
              </li>
            ))}
          </ul>

          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            {t('About {minutes} minutes from here.', { minutes: guide.minutes })}
          </p>
        </motion.div>
      </AnimatePresence>
    </QuestionFrame>
  );
}

function ReadyScreen({
  guide,
  ready,
  onToggle,
}: {
  guide: AccountGuide;
  ready: ReadonlySet<string>;
  onToggle: (label: string) => void;
}) {
  const { t } = useLocale();

  return (
    <QuestionFrame
      icon={ListChecks}
      question="Do you have these to hand?"
      help="Tick off what you have. This is only a check - nothing here is saved, and you can carry on either way. It exists so you find out now rather than four questions in."
      optional
    >
      <ul className="space-y-2">
        {guide.prepare.map((item) => {
          const checked = ready.has(item.label);

          return (
            <li key={item.label}>
              {/* The whole row is the control, and the box inside it is drawn
                  rather than rendered as a real checkbox: Radix renders one as
                  a <button>, and an interactive element inside another one is
                  both invalid and — as the terms row on this form found — a
                  double-fired toggle in some browsers. */}
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => onToggle(item.label)}
                className={cn(
                  INSET,
                  'flex w-full items-start gap-3 p-3 text-left transition-colors duration-200',
                  checked ? 'glass-choice-selected' : INSET_HOVER,
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors duration-200',
                    checked
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border-strong bg-card dark:border-white/25 dark:bg-white/[0.06]',
                  )}
                  aria-hidden
                >
                  {checked ? <Check className="size-3" strokeWidth={3.5} /> : null}
                </span>

                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-medium transition-colors',
                        checked ? 'text-muted-foreground line-through' : null,
                      )}
                    >
                      {t(item.label)}
                    </span>
                    <Badge variant={item.required ? 'warning' : 'muted'} size="sm">
                      {item.required ? t('Needed to finish') : t('Optional')}
                    </Badge>
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {t(item.detail)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className={cn(INSET_QUIET, 'space-y-2 p-3.5')}>
        <p className="section-label text-primary/80">{t('What you get at the end')}</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {guide.unlocks.map((line) => (
            <li key={line} className="flex items-start gap-2 text-xs leading-relaxed">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="text-foreground/85">{t(line)}</span>
            </li>
          ))}
        </ul>
      </div>
    </QuestionFrame>
  );
}

/** Every screen that asks for a real field. One control, or two for a name. */
function QuestionScreen({
  question,
  form,
  image,
  onImageChange,
  wantsLogo,
}: {
  question: GuidedQuestion;
  form: UseFormReturn<RegisterInput>;
  image: File | null;
  onImageChange: (file: File | null) => void;
  wantsLogo: boolean;
}) {
  const { t } = useLocale();

  return (
    <QuestionFrame
      icon={question.icon}
      question={question.question}
      help={question.help}
      {...(question.rule ? { rule: question.rule } : {})}
      {...(question.example ? { example: question.example } : {})}
      {...(question.tip ? { tip: question.tip } : {})}
      {...(question.warning ? { warning: question.warning } : {})}
      {...(question.optional ? { optional: true } : {})}
    >
      {question.id === 'name' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t('First name')}</FormLabel>
                <FormControl>
                  <Input {...field} autoComplete="given-name" autoFocus className="h-11" />
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
                  <Input {...field} autoComplete="family-name" className="h-11" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ) : null}

      {question.id === 'email' ? (
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
                  autoFocus
                  placeholder="you@company.com"
                  className="h-11"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {question.id === 'phone' ? (
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
                  autoFocus
                  placeholder="9876543210"
                  className="h-11"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {question.id === 'image' ? (
        // Not a form field: it is not part of `registerSchema` and does not
        // travel with the registration — the page uploads it afterwards, once
        // there is a session to address it to.
        <ImageCircleField
          value={image}
          onChange={onImageChange}
          label={wantsLogo ? t('Company logo') : t('Profile photo')}
          hint={t('JPEG, PNG, WebP or HEIC up to {size} MB', { size: IMAGE_MAX_SIZE_MB })}
          accept={IMAGE_ACCEPT}
          maxSizeMb={IMAGE_MAX_SIZE_MB}
          icon={wantsLogo ? Building2 : UserRound}
          onReject={(reason) => toast.error(reason)}
        />
      ) : null}

      {question.id === 'organization' ? (
        <FormField
          control={form.control}
          name="organizationName"
          render={({ field }) => (
            <FormItem>
              <FormLabel required={!question.optional}>{t(question.label)}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ''}
                  autoComplete="organization"
                  autoFocus
                  placeholder={question.example ?? ''}
                  className="h-11"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {question.id === 'fleet-code' ? (
        <FormField
          control={form.control}
          name="fleetInviteCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel required={!question.optional}>{t('Fleet invite code')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  value={field.value ?? ''}
                  autoFocus
                  placeholder="SR-XXXXXX"
                  className="h-11 font-mono uppercase tracking-wider"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {question.id === 'licence' ? (
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
                  autoFocus
                  placeholder="DL-1420-20100000000"
                  className="h-11"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {question.id === 'password' ? (
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
                  autoFocus
                  placeholder="••••••••••"
                  className="h-11"
                />
              </FormControl>
              {/* The rules as a live checklist rather than as a sentence read
                  once and then failed four times. */}
              <PasswordStrength value={field.value ?? ''} className="pt-1" />
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
    </QuestionFrame>
  );
}

/**
 * The last screen: every answer, an edit button beside each, and the terms.
 *
 * Worth its own screen rather than simply submitting from the password box.
 * Somebody who has answered ten questions one at a time has never seen them
 * together, and the account type — the answer that cannot be corrected
 * afterwards — is nine screens behind them by then.
 */
function ReviewScreen({
  steps,
  answerFor,
  onEdit,
  form,
  formError,
}: {
  steps: FlowStep[];
  answerFor: (step: FlowStep) => string;
  onEdit: (index: number) => void;
  form: UseFormReturn<RegisterInput>;
  formError: string | null;
}) {
  const { t } = useLocale();

  /*
   * A rejected registration comes back two ways. A message with no field
   * attached is `formError`; anything the API could pin to a field is set on
   * that field instead — and every one of those fields lives on a screen this
   * reader walked past several questions ago. The rows below turn red on
   * their own, but naming the screens is what makes the failure actionable
   * without scrolling a list looking for the red one.
   */
  const broken = steps.filter(
    (step) => step.id !== 'review' && step.fields.some((field) => field in form.formState.errors),
  );

  return (
    <QuestionFrame
      icon={ShieldCheck}
      question="Does this all look right?"
      help="Nothing has been saved yet. Check each answer, change anything that is wrong, then create the account."
    >
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      {broken.length ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('Fix these before creating the account: {list}.', {
              list: broken.map((step) => step.title).join(', '),
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <ul className={cn(INSET, 'divide-y divide-border overflow-hidden dark:divide-white/[0.07]')}>
        {steps.map((step, position) => {
          if (step.id === 'ready' || step.id === 'review') return null;
          const answer = answerFor(step);
          const errored = step.fields.some((field) => field in form.formState.errors);
          // Optional on the stepper's descriptor; every screen in this flow
          // sets one, and the fallback keeps the rows aligned if one ever does
          // not rather than collapsing the column.
          const Icon = step.icon ?? Pencil;

          return (
            <li key={step.id} className="flex items-center gap-3 p-3">
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  errored ? 'text-destructive' : 'text-muted-foreground',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {step.title}
                </p>
                <p
                  className={cn(
                    'truncate text-sm',
                    answer ? 'font-medium' : 'italic text-muted-foreground',
                    errored ? 'text-destructive' : null,
                  )}
                >
                  {answer || t('Not answered')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEdit(position)}
                aria-label={t('Change {label}', { label: step.title })}
              >
                <Pencil className="size-3.5" />
                {t('Change')}
              </Button>
            </li>
          );
        })}
      </ul>

      <FormField
        control={form.control}
        name="acceptedTerms"
        render={({ field }) => (
          <FormItem>
            {/* A div rather than a <label> wrapping the control: Radix renders
                the checkbox as a <button>, and a label around it double-fires
                the toggle in some browsers. `FormLabel` already points at it
                via htmlFor. */}
            <div
              className={cn(
                INSET,
                'flex items-start gap-3 p-3 transition-colors duration-200',
                field.value ? 'glass-choice-selected' : INSET_HOVER,
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
    </QuestionFrame>
  );
}
