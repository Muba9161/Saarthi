import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Menu, Moon, Sun } from 'lucide-react';
// `useScroll`/`useSpring` are not in the curated product motion vocabulary —
// nothing behind the sign-in wall needs a scroll-linked value. Imported here
// rather than widening that module for one page.
import { useScroll, useSpring } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { SaarthiLogo } from '@/components/common/logo';
import { AnimatePresence, motion } from '@/components/motion';
import { useTheme } from '@/features/theme/theme-context';
import { LEGAL_LINKS } from '@/features/legal/legal-links';
import { Reveal, WordsReveal } from './motion-extras';
import { cn } from '@/lib/utils';

/**
 * Public-site chrome.
 *
 * The marketing site is deliberately untranslated, unlike the app behind it.
 * Every product string goes through `t()` against catalogues that 18 languages
 * must keep complete; sales copy churns weekly and would either break that
 * guarantee or ship half-translated. The language a visitor needs is chosen on
 * the first step of registration, where it applies to what they are about to
 * use.
 */

export const NAV_SECTIONS = [
  { id: 'platform', label: 'Platform' },
  { id: 'features', label: 'Features' },
  { id: 'roles', label: 'Who it is for' },
  { id: 'how', label: 'How it works' },
  { id: 'pricing', label: 'Pricing' },
] as const;

/**
 * Which section the reader is in.
 *
 * The `rootMargin` pulls the top edge below the sticky header and the bottom
 * edge most of the way up, so exactly one section is ever active — the one
 * occupying the upper half of the viewport, which is the one a reader would
 * say they are looking at.
 */
export function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-76px 0px -55% 0px', threshold: 0 },
    );

    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node !== null);
    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/** The header's own height, in px. Must track `h-[4.5rem]` below. */
const HEADER_HEIGHT = 72;

/**
 * Whether the header is currently sitting on top of a dark band.
 *
 * This replaced `!scrolled`, which was wrong in a way that only showed up
 * once the photography landed. The header goes transparent-to-glass at 16px
 * of scroll, but the hero is nine hundred pixels tall — so for the rest of
 * that first screen the chrome was rendering in light-theme ink on a
 * light-tinted glass bar, over a near-black photograph. Readable by luck,
 * murky in practice, and completely wrong on the other dark bands further
 * down.
 *
 * Every fixed-dark band carries `data-stage`, and this asks the far simpler
 * question: does any of them overlap the strip the header occupies? Measured
 * from layout rather than from a scroll offset, so it stays correct when a
 * band changes height, when the viewport resizes, and on the dark bands in
 * the middle and at the foot of the page.
 */
function useOverStage(): boolean {
  const [over, setOver] = React.useState(true);

  React.useEffect(() => {
    const check = (): void => {
      const stages = document.querySelectorAll<HTMLElement>('[data-stage]');
      let covering = false;
      for (const stage of stages) {
        const rect = stage.getBoundingClientRect();
        if (rect.top < HEADER_HEIGHT && rect.bottom > 0) {
          covering = true;
          break;
        }
      }
      setOver(covering);
    };

    check();
    /*
     * Re-checked once after paint and again on load, because the answer
     * depends on where the bands actually are. This runs on mount, before
     * the hero photograph has decoded — and every band below the fold moves
     * when it does. Without these, a visitor who never scrolls keeps whatever
     * answer the first frame happened to give.
     */
    const frame = requestAnimationFrame(check);
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    window.addEventListener('load', check);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      window.removeEventListener('load', check);
    };
  }, []);

  return over;
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 24, restDelta: 0.001 });

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 h-px origin-left bg-logo-gradient"
      style={{ scaleX }}
      aria-hidden
    />
  );
}

function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label="Switch theme"
      title="Switch theme"
      className={className}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={resolvedTheme}
          initial={{ opacity: 0, rotate: -80, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 80, scale: 0.7 }}
          transition={{ duration: 0.22 }}
          className="flex"
        >
          {resolvedTheme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

/**
 * A link to one of the landing page's bands.
 *
 * On the landing page it stays a bare fragment, which is what lets the browser
 * do the scrolling natively against each band's `scroll-mt`. The same header is
 * now rendered on the Terms and Privacy pages, where `#pricing` names nothing
 * on screen and a bare fragment would simply do nothing; from there it becomes
 * a route change to `/#pricing`, and the landing page finds the band on
 * arrival — see `useHashTarget` in `pages/marketing/landing`.
 */
function SectionLink({
  id,
  onLanding,
  className,
  children,
  ...rest
}: {
  id: string;
  onLanding: boolean;
  className?: string;
  children: React.ReactNode;
} & Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'aria-current'>) {
  if (onLanding) {
    return (
      <a href={`#${id}`} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link to={`/#${id}`} className={className} {...rest}>
      {children}
    </Link>
  );
}

export function MarketingNav() {
  const ids = React.useMemo(() => NAV_SECTIONS.map((section) => section.id), []);
  const active = useActiveSection(ids);
  const [scrolled, setScrolled] = React.useState(false);
  const { resolvedTheme } = useTheme();
  const { pathname } = useLocation();
  const onLanding = pathname === '/';

  // Transparent over the hero, glass once the page moves: the first screen
  // should be the product, not the chrome around it.
  React.useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /*
   * Two independent questions, and conflating them was the bug.
   *
   * `scrolled` decides whether the header has a ground at all — transparent
   * on arrival, glass once the page moves. `overStage` decides what colour
   * that ground and its ink should be, and depends on what is *behind* the
   * header rather than on how far the page has travelled.
   */
  const overStage = useOverStage();

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-colors duration-500',
        /*
         * No `border-b` anywhere, and that is a layout constraint rather than
         * a style choice.
         *
         * The hero slides under this header with `-mt-[4.5rem]`, matching the
         * 4.5rem row below. A bottom border — even the transparent one that
         * used to hold the height steady between states — made the header's
         * border box 73px against a 72px pull, and the page's canvas showed
         * through the leftover pixel as a hairline across the very top of the
         * screen. The divider is drawn as an absolutely positioned rule
         * instead, which is outside the box model and cannot reintroduce it.
         */
        scrolled &&
          (overStage
            ? 'backdrop-blur-xl'
            : 'bg-background/70 backdrop-blur-xl backdrop-saturate-150'),
      )}
      /*
       * The stage tint is an inline colour, not `bg-[hsl(...)]/75`.
       *
       * An opacity modifier on an arbitrary colour is the one Tailwind form
       * that can quietly produce nothing, and a header with no ground over a
       * photograph is unreadable rather than merely wrong. Nothing else on
       * this page is worth that risk.
       */
      style={scrolled && overStage ? { backgroundColor: 'hsl(240 6% 7% / 0.75)' } : undefined}
    >
      {scrolled ? (
        <>
          {/* The divider the border used to draw, without its 1px of height. */}
          <span
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 h-px',
              overStage ? 'bg-white/10' : 'bg-border/60',
            )}
            aria-hidden
          />
          <ScrollProgress />
        </>
      ) : null}

      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-4 px-5 sm:px-8">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 transition-opacity duration-200 hover:opacity-80"
        >
          {/* The mark is navy on transparency, so it needs its white chip on
              the stage — and in the dark theme once the glass ground is up. */}
          <SaarthiLogo className="h-8" decorative onDark={overStage || resolvedTheme === 'dark'} />
          <span
            className={cn(
              'text-base font-semibold tracking-tight sm:text-lg',
              overStage && 'text-white',
            )}
          >
            VorldX Saarthi
          </span>
        </Link>

        <nav className="ml-6 hidden items-center lg:flex" aria-label="Sections">
          {NAV_SECTIONS.map((section) => (
            <SectionLink
              key={section.id}
              id={section.id}
              onLanding={onLanding}
              aria-current={active === section.id ? 'true' : undefined}
              className={cn(
                'relative rounded-full px-3.5 py-2 text-sm transition-colors duration-200',
                active === section.id
                  ? overStage
                    ? 'text-white'
                    : 'text-foreground'
                  : overStage
                    ? 'text-white/65 hover:text-white'
                    : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="relative z-[1]">{section.label}</span>
              {active === section.id ? (
                <motion.span
                  layoutId="marketing-nav-pill"
                  className={cn(
                    'absolute inset-0 rounded-full',
                    overStage ? 'bg-white/10' : 'bg-secondary',
                  )}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              ) : null}
            </SectionLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle
            className={cn(
              'hidden sm:inline-flex',
              overStage && 'text-white hover:bg-white/10 hover:text-white',
            )}
          />
          <Button
            variant="ghost"
            size="sm"
            asChild
            className={cn(
              'hidden sm:inline-flex',
              overStage && 'text-white hover:bg-white/10 hover:text-white',
            )}
          >
            <Link to="/login">Sign in</Link>
          </Button>
          <Button variant="gradient" size="sm" asChild className="group rounded-full">
            <Link to="/register">
              Start free
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'lg:hidden',
                  overStage && 'text-white hover:bg-white/10 hover:text-white',
                )}
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              {/* SheetContent supplies its own close button — `pr-12` keeps
                  this label clear of it. */}
              <div className="border-b border-border px-5 py-4 pr-12">
                <span className="text-sm font-semibold">Menu</span>
              </div>

              <nav className="flex flex-col gap-0.5 p-3" aria-label="Sections">
                {NAV_SECTIONS.map((section) => (
                  <SheetClose asChild key={section.id}>
                    <SectionLink
                      id={section.id}
                      onLanding={onLanding}
                      className="rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-secondary"
                    >
                      {section.label}
                    </SectionLink>
                  </SheetClose>
                ))}
              </nav>

              <div className="space-y-2 border-t border-border p-4">
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button variant="gradient" className="w-full" asChild>
                  <Link to="/register">Start free</Link>
                </Button>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">Appearance</span>
                  <ThemeToggle />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------
 * Section shell
 *
 * One place decides the page's vertical rhythm and how wide a band's content
 * runs. The old page set padding per section and drifted — some bands breathed
 * and some did not, which is most of what made it read as cluttered.
 * ---------------------------------------------------------------------- */

export function Section({
  id,
  className,
  children,
  width = 'default',
  tone = 'canvas',
  stage = false,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  width?: 'narrow' | 'default' | 'wide';
  /** Alternating grounds are what separate the bands, in place of borders. */
  tone?: 'canvas' | 'raised' | 'dark';
  /**
   * Marks the band as dark enough that the header must go light over it.
   *
   * Read by `useOverStage` rather than inferred from `tone`, because the two
   * are not the same question: `tone="dark"` is a theme token, while the
   * photographic bands are hard-coded near-black and are not a tone at all.
   */
  stage?: boolean;
}) {
  return (
    <section
      id={id}
      data-stage={stage ? '' : undefined}
      className={cn(
        /*
         * Down from py-24/py-32, then again to py-16/py-20.
         *
         * The old figures were set when the bands were pure text and needed
         * air to separate. Two adjacent sections each contributed their own
         * padding, so a boundary was 256px of nothing at desktop width — the
         * page read as sparse rather than calm, and the gap was the loudest
         * thing between two sections. Alternating grounds already do the
         * separating; this only has to keep a band off its own edges.
         */
        'scroll-mt-24 px-5 py-16 sm:px-8 sm:py-20',
        tone === 'raised' && 'bg-secondary/30',
        tone === 'dark' && 'bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto',
          width === 'narrow' && 'max-w-3xl',
          width === 'default' && 'max-w-6xl',
          width === 'wide' && 'max-w-7xl',
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * A band's heading.
 *
 * The title animates word by word as it scrolls in, which is the page's one
 * recurring motion signature — enough to make each band feel like an arrival,
 * cheap enough to repeat seven times.
 */
export function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
  onDark = false,
  className,
}: {
  eyebrow?: string;
  title: string;
  body?: React.ReactNode;
  align?: 'center' | 'start';
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl', className)}
    >
      {eyebrow ? (
        <Reveal direction="none" duration={0.5}>
          <p
            className={cn(
              'flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-[0.16em]',
              align === 'center' && 'justify-center',
              onDark ? 'text-accent' : 'text-primary',
            )}
          >
            <span
              className={cn('h-px w-6', onDark ? 'bg-accent/50' : 'bg-primary/40')}
              aria-hidden
            />
            {eyebrow}
          </p>
        </Reveal>
      ) : null}

      <WordsReveal
        text={title}
        className="mt-5 text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]"
      />

      {body ? (
        <Reveal delay={0.12}>
          <p
            className={cn(
              'mt-5 text-pretty text-base leading-relaxed sm:text-lg',
              onDark ? 'text-sidebar-muted' : 'text-muted-foreground',
            )}
          >
            {body}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}

export function MarketingFooter() {
  const year = new Date().getFullYear();
  const { resolvedTheme } = useTheme();
  const { pathname } = useLocation();
  const onLanding = pathname === '/';

  return (
    <footer className="border-t border-border/60 px-5 py-14 sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5">
            {/* Navy on transparency — without the chip the V is simply gone in
                the dark theme. */}
            <SaarthiLogo className="h-7" decorative onDark={resolvedTheme === 'dark'} />
            <p className="text-sm font-semibold">VorldX Saarthi</p>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            One system for everyone in a haul - fleet owners, drivers, suppliers, customers, travel
            operators, and the associations that answer when something goes wrong.
          </p>
        </div>

        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Product
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            {NAV_SECTIONS.map((section) => (
              <li key={section.id}>
                <SectionLink
                  id={section.id}
                  onLanding={onLanding}
                  className="transition-colors hover:text-foreground"
                >
                  {section.label}
                </SectionLink>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Get started
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            <li>
              <Link to="/register" className="transition-colors hover:text-foreground">
                Create an account
              </Link>
            </li>
            <li>
              <Link to="/login" className="transition-colors hover:text-foreground">
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/login" className="transition-colors hover:text-foreground">
                Explore the demo fleet
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Legal
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
            {LEGAL_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="transition-colors hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/privacy#grievance" className="transition-colors hover:text-foreground">
                Grievance redressal
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-6xl border-t border-border/60 pt-6">
        <p className="max-w-3xl text-2xs leading-relaxed text-muted-foreground">
          Saarthi&rsquo;s emergency network connects nearby drivers who may be able to help. It does
          not replace official emergency services - always call 112 first in a life-threatening
          situation.
        </p>
        <p className="mt-3 text-2xs text-muted-foreground">© {year} VorldX Saarthi</p>
      </div>
    </footer>
  );
}
