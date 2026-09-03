import * as React from 'react';
import { Link } from 'react-router-dom';
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
function useActiveSection(ids: readonly string[]): string | null {
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

function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 24, restDelta: 0.001 });

  return (
    <motion.div
      className="absolute inset-x-0 bottom-0 h-px origin-left bg-brand-gradient"
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

export function MarketingNav() {
  const ids = React.useMemo(() => NAV_SECTIONS.map((section) => section.id), []);
  const active = useActiveSection(ids);
  const [scrolled, setScrolled] = React.useState(false);

  // Transparent over the hero, glass once the page moves: the first screen
  // should be the product, not the chrome around it.
  React.useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-colors duration-500',
        scrolled
          ? 'border-b border-border/60 bg-background/70 backdrop-blur-xl backdrop-saturate-150'
          : 'border-b border-transparent',
      )}
    >
      {scrolled ? <ScrollProgress /> : null}

      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center gap-4 px-5 sm:px-8">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 transition-opacity duration-200 hover:opacity-80"
        >
          <SaarthiLogo className="h-8" decorative />
          <span className="text-base font-semibold tracking-tight sm:text-lg">VorldX Saarthi</span>
        </Link>

        <nav className="ml-6 hidden items-center lg:flex" aria-label="Sections">
          {NAV_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active === section.id ? 'true' : undefined}
              className={cn(
                'relative rounded-full px-3.5 py-2 text-sm transition-colors duration-200',
                active === section.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="relative z-[1]">{section.label}</span>
              {active === section.id ? (
                <motion.span
                  layoutId="marketing-nav-pill"
                  className="absolute inset-0 rounded-full bg-secondary"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              ) : null}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle className="hidden sm:inline-flex" />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
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
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
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
                    <a
                      href={`#${section.id}`}
                      className="rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-secondary"
                    >
                      {section.label}
                    </a>
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
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  width?: 'narrow' | 'default' | 'wide';
  /** Alternating grounds are what separate the bands, in place of borders. */
  tone?: 'canvas' | 'raised' | 'dark';
}) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-24 px-5 py-24 sm:px-8 sm:py-32',
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

  return (
    <footer className="border-t border-border/60 px-5 py-14 sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2.5">
            <SaarthiLogo className="h-7" decorative />
            <p className="text-sm font-semibold">VorldX Saarthi</p>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            One system for everyone in a haul — fleet owners, drivers, suppliers, customers, travel
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
                <a href={`#${section.id}`} className="transition-colors hover:text-foreground">
                  {section.label}
                </a>
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
      </div>

      <div className="mx-auto mt-12 max-w-6xl border-t border-border/60 pt-6">
        <p className="max-w-3xl text-2xs leading-relaxed text-muted-foreground">
          Saarthi&rsquo;s emergency network connects nearby drivers who may be able to help. It does
          not replace official emergency services — always call 112 first in a life-threatening
          situation.
        </p>
        <p className="mt-3 text-2xs text-muted-foreground">© {year} VorldX Saarthi</p>
      </div>
    </footer>
  );
}
