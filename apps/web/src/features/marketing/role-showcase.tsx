import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from './marketing-chrome';
import { ROLE_PORTRAIT } from './imagery';
import { ROLE_SHOWCASE, type RoleShowcase } from './feature-catalogue';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * What one kind of account actually opens to.
 *
 * The destination list is the role's real navigation tree, imported from
 * `@/app/navigation` — the same data the signed-in shell renders. So this is
 * not a promise about the product, it is its table of contents. Items still
 * carry their own permission and plan gates inside the app; what is listed
 * here is the full surface the account type can reach.
 *
 * Destinations are one grid of cards, each tagged with its sidebar group,
 * rather than a column per group. A role with a single group — a supplier —
 * would otherwise be one narrow list beside a wide empty space; as cards it
 * fills the row like every other role does.
 */
function RolePanel({ role }: { role: RoleShowcase }) {
  const reduced = useReducedMotion();
  const destinations = role.navigation.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <motion.div
      // Keyed by the caller so React remounts and replays the stagger on every
      // role change; no exit, so the previous role's screens never linger.
      initial={reduced ? false : 'hidden'}
      animate={reduced ? undefined : 'visible'}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
      className="min-w-0"
    >
      <motion.div
        variants={{
          hidden: { opacity: 0, y: 16 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
        }}
      >
        <blockquote className="text-balance text-xl font-medium leading-snug tracking-[-0.01em] sm:text-2xl">
          <span className="text-accent" aria-hidden>
            “
          </span>
          {role.quote}
          <span className="text-accent" aria-hidden>
            ”
          </span>
        </blockquote>

        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {role.blurb}
        </p>

        <p className="mt-5 text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{destinations}</span>{' '}
          destinations in this account&rsquo;s sidebar
        </p>
      </motion.div>

      <motion.div
        variants={{
          hidden: { opacity: 0, y: 16 },
          visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
        }}
        className="mt-10 border-t border-border/60 pt-8"
      >
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
          {role.navigation.flatMap((section) =>
            section.items.map((item) => (
              <li
                key={`${section.title}-${item.to}-${item.label}`}
                className={cn(
                  'group flex min-w-0 items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-3.5',
                  'transition-[transform,border-color,background-color] duration-300 ease-smooth',
                  'hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card',
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary/70 transition-colors duration-300 group-hover:bg-primary/[0.14] group-hover:text-primary">
                  <item.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  <span className="block truncate text-2xs uppercase tracking-[0.14em] text-muted-foreground">
                    {section.title}
                  </span>
                </span>
              </li>
            )),
          )}
        </ul>
      </motion.div>
    </motion.div>
  );
}

/**
 * The person behind the account type, framed on the right of the wizard.
 *
 * Crossfades on each step, and removes itself if the file is missing, so the
 * copy column simply takes the width and the band still looks finished.
 */
function RolePortrait({ role, className }: { role: RoleShowcase; className?: string }) {
  const reduced = useReducedMotion();
  const [missing, setMissing] = React.useState<Set<string>>(() => new Set());
  const src = ROLE_PORTRAIT[role.id];
  if (!src || missing.has(role.id)) return null;

  return (
    <div
      className={cn(
        'relative aspect-[4/5] overflow-hidden rounded-2xl border border-border/60 bg-muted/40 shadow-lifted',
        className,
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.img
          key={role.id}
          src={src}
          alt={role.label}
          loading="lazy"
          decoding="async"
          onError={() => setMissing((held) => new Set(held).add(role.id))}
          initial={reduced ? false : { opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </AnimatePresence>
      {/* A low scrim so the label stays legible on any photograph. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
      <p className="absolute bottom-4 left-4 flex items-center gap-2 text-sm font-medium text-white">
        <role.icon className="size-4" aria-hidden />
        {role.label}
      </p>
    </div>
  );
}

/** "six" rather than "6" in the heading, for as many kinds as there are. */
const COUNT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * The kinds of account, walked through one at a time.
 *
 * A wizard rather than a tab list: the roles are a sequence a haul actually
 * passes through — the fleet, its driver, the customer, the supplier — so
 * stepping forward reads as the story of one job, and the reader always knows
 * how many are left.
 */
export function RoleShowcaseSection() {
  const [index, setIndex] = React.useState(0);
  const reduced = useReducedMotion();
  const total = ROLE_SHOWCASE.length;
  const active = ROLE_SHOWCASE[index];
  const next = ROLE_SHOWCASE[index + 1];
  const previous = ROLE_SHOWCASE[index - 1];

  React.useEffect(() => {
    const upcoming = next ? ROLE_PORTRAIT[next.id] : undefined;
    if (!upcoming) return;
    const image = new Image();
    image.src = upcoming;
  }, [next]);

  return (
    <Section id="roles" width="wide" tone="raised" className="relative isolate overflow-hidden">

      <SectionHeading
        eyebrow="Who it is for"
        title={`One platform, ${COUNT_WORD[total] ?? total} points of view`}
        body="A haul touches a fleet owner, a driver, a supplier and a customer - and often an association too. Each opens their own screens over the same record, so nobody re-enters what somebody else already typed."
      />

      {/* The step rail. Scrolls sideways on a phone rather than wrapping, so
          the order of the steps is never broken across lines. */}
      <nav aria-label="Account types" className="mt-14">
        <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 scrollbar-none lg:justify-between lg:overflow-visible">
          {ROLE_SHOWCASE.map((role, at) => {
            const current = at === index;
            const done = at < index;
            return (
              <li key={role.id} className="relative flex min-w-0 shrink-0 items-center lg:flex-1">
                <button
                  type="button"
                  aria-current={current ? 'step' : undefined}
                  onClick={() => setIndex(at)}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {current ? (
                    <motion.span
                      layoutId="role-step"
                      className="absolute inset-0 rounded-xl border border-primary/25 bg-primary/[0.07]"
                      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      'relative flex size-7 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold tabular-nums transition-colors duration-200',
                      current
                        ? 'border-primary bg-primary text-primary-foreground'
                        : done
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground',
                    )}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : String(at + 1).padStart(2, '0')}
                  </span>
                  <span className="relative whitespace-nowrap text-sm font-medium">{role.label}</span>
                </button>
                {/* The connector to the next step, filled once it is passed. */}
                {at < total - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      'mx-1 hidden h-px flex-1 transition-colors duration-300 lg:block',
                      done ? 'bg-primary/40' : 'bg-border',
                    )}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Copy on the left, the person on the right. Below `lg` the portrait
          would push the copy off the first screen, so it shrinks to a small
          round photo beside the step label instead. */}
      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-14">
        <div className="min-w-0" role="region" aria-label="Selected account type" aria-live="polite">
          {active ? (
            <div className="flex items-center gap-3">
              {ROLE_PORTRAIT[active.id] ? (
                <img
                  src={ROLE_PORTRAIT[active.id]}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-11 shrink-0 rounded-full border border-border/60 object-cover object-top lg:hidden"
                />
              ) : null}
              <active.icon className="hidden size-5 text-primary lg:block" aria-hidden />
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Step {index + 1} of {total} · {active.label}
              </p>
            </div>
          ) : null}
          <div className="mt-6">{active ? <RolePanel key={active.id} role={active} /> : null}</div>
        </div>

        {active ? <RolePortrait role={active} className="hidden self-start lg:block" /> : null}
      </div>

      <div className="mt-12 flex items-center justify-between gap-3 border-t border-border/60 pt-6">
        <Button
          variant="ghost"
          className="rounded-full"
          disabled={!previous}
          onClick={() => setIndex((at) => Math.max(0, at - 1))}
        >
          <ArrowLeft className="size-4" />
          {previous ? previous.label : 'Back'}
        </Button>
        {next ? (
          <Button className="group rounded-full" onClick={() => setIndex((at) => Math.min(total - 1, at + 1))}>
            Next: {next.label}
            <ArrowRight
              className={cn('size-4', !reduced && 'transition-transform duration-200 group-hover:translate-x-0.5')}
            />
          </Button>
        ) : (
          <Button variant="gradient" asChild className="group rounded-full">
            <Link to="/register">
              Pick your account type
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </Button>
        )}
      </div>

      <p className="mx-auto mt-8 max-w-lg text-center text-sm text-muted-foreground">
        Registration asks which of these you are, because it decides what Saarthi builds for you - a
        fleet, a yard, a customer account, or a driver profile inside an existing fleet.
      </p>
    </Section>
  );
}
