import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUp, Instagram, Youtube } from 'lucide-react';
import { useInView } from 'framer-motion';
import { SaarthiLogo } from '@/components/common/logo';
import { motion, useReducedMotion } from '@/components/motion';
import { LEGAL_LINKS } from '@/features/legal/legal-links';
import { SITE } from '@/features/seo';
import { NAV_SECTIONS, SectionLink } from './marketing-chrome';
import { Reveal, useSpotlight } from './motion-extras';
import { STAGE } from './imagery';
import { EASE_OUT, STAGE_INK_CSS } from './design-system';
import { useLenis } from './scroll-context';
import { cn } from '@/lib/utils';

/**
 * The public-site footer.
 *
 * Sits on the same fixed near-black as the closing band above it, in both
 * themes, so the photograph runs straight into it with no seam. The page's
 * visual language carries through: a route that draws itself to its
 * destination, a faint coordinate grid, and the name set large at the foot of
 * the page, lit from under the cursor.
 */

/** Saarthi's official social accounts, shown as icons in the footer. */
const SOCIAL_LINKS = [
  { href: SITE.social.instagram, label: 'Instagram', Icon: Instagram },
  { href: SITE.social.youtube, label: 'YouTube', Icon: Youtube },
] as const;

/* `py-1` lifts each link to a ~28px tap target on phones, where the list
   spacing is tightened to match, so the column keeps the same rhythm. */
const LINK_CLASS =
  'group relative inline-flex items-center py-1 transition-colors duration-200 hover:text-white focus-visible:text-white focus-visible:outline-none';

/**
 * A link's label, with a saffron tick that draws in on hover or focus.
 * Transform-only, so hovering a column never reflows it.
 */
function LinkInk({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span
        className="absolute -left-4 top-1/2 h-px w-2.5 origin-left scale-x-0 bg-accent transition-transform duration-300 ease-smooth group-hover:scale-x-100 group-focus-visible:scale-x-100"
        aria-hidden
      />
      <span className="transition-transform duration-300 ease-smooth group-hover:translate-x-1 group-focus-visible:translate-x-1">
        {children}
      </span>
    </>
  );
}

function ColumnHeading({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <p className="flex items-baseline gap-2.5 text-2xs font-semibold uppercase tracking-[0.16em] text-white/55">
      <span className="font-mono font-normal text-white/30">{index}</span>
      {children}
    </p>
  );
}

/** Back to the start of the page, through Lenis when it is driving the scroll. */
function BackToTop() {
  const lenis = useLenis();
  const reduced = useReducedMotion();

  const onClick = (): void => {
    if (lenis) {
      lenis.scrollTo(0);
      return;
    }
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex shrink-0 items-center gap-2.5 text-2xs font-medium uppercase tracking-[0.16em] text-white/55 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none"
    >
      <span className="hidden sm:inline">Back to top</span>
      <span className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/5 transition-colors duration-200 group-hover:border-accent/60 group-hover:bg-accent/10 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <ArrowUp
          className="size-4 transition-transform duration-300 ease-smooth group-hover:-translate-y-0.5"
          aria-hidden
        />
      </span>
      <span className="sr-only sm:hidden">Back to top</span>
    </button>
  );
}

/**
 * The journey's last leg: a dashed road that fills with the logo's sweep, a
 * vehicle node riding its leading edge, arriving at the back-to-top control.
 *
 * Drawn once, the first time it is on screen. The fill and the node share one
 * translated layer, so the whole draw is a single transform. Under reduced
 * motion it renders already arrived.
 */
function RouteRule() {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const arrived = reduced || inView;

  return (
    <div className="flex items-center gap-3 sm:gap-5">
      <span
        className="size-2 shrink-0 rounded-full bg-white/40 ring-4 ring-white/[0.06]"
        aria-hidden
      />

      {/* Padded and clipped, so the node enters from off the road and its
          glow is never cut at the far end. */}
      <div ref={ref} className="relative h-6 flex-1 overflow-hidden px-3" aria-hidden>
        <div className="relative h-full">
          <span
            className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.18) 0 6px, transparent 6px 14px)',
            }}
          />
          <motion.div
            className="absolute inset-0"
            initial={{ x: reduced ? '0%' : '-100%' }}
            animate={{ x: arrived ? '0%' : '-100%' }}
            transition={{ duration: 1.8, ease: EASE_OUT }}
          >
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-logo-gradient" />
            <span className="absolute right-0 top-1/2 size-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent shadow-[0_0_0_4px_hsl(var(--accent)/0.18),0_0_18px_hsl(var(--accent)/0.55)]" />
          </motion.div>
        </div>
      </div>

      <BackToTop />
    </div>
  );
}

/**
 * The name, set at the scale of the page and lit from under the cursor.
 *
 * Two identical layers: a hairline outline that is always there, and the
 * logo's sweep masked to a pool of light that follows the pointer. At rest
 * the pool sits in the middle of the word, so touch screens and a still
 * mouse still see it lit. Decorative — the brand is already named above it.
 */
function Wordmark() {
  const { ref, onPointerMove } = useSpotlight<HTMLDivElement>();
  const type =
    'brand-logo-gradient-on-dark block text-center font-semibold leading-[0.9] tracking-[-0.06em] text-[clamp(4.5rem,20vw,18rem)]';

  return (
    <Reveal duration={0.9} amount={0.3}>
      <div
        ref={ref}
        onPointerMove={onPointerMove}
        className="group relative select-none"
        style={{ maskImage: 'linear-gradient(to bottom, black 45%, transparent 100%)' }}
        aria-hidden
      >
        <span
          className={cn(type, 'bg-none')}
          style={{ WebkitTextStroke: '1px rgb(255 255 255 / 0.14)' }}
        >
          Saarthi
        </span>
        <span
          className={cn(
            type,
            'absolute inset-0 opacity-30 transition-opacity duration-500 group-hover:opacity-100',
          )}
          style={{
            maskImage:
              'radial-gradient(280px circle at var(--spot-x, 50%) var(--spot-y, 40%), black, transparent 75%)',
          }}
        >
          Saarthi
        </span>
      </div>
    </Reveal>
  );
}

/** The static atmosphere: a coordinate grid, one low saffron light, grain. */
function FooterBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          // Faded from the top edge, so the grid never draws a seam against
          // the photograph above.
          maskImage: 'radial-gradient(ellipse 70% 55% at 50% 60%, black, transparent 80%)',
        }}
      />
      <div className="absolute -bottom-48 left-1/2 h-96 w-[56rem] max-w-full -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
      <div className="film-grain absolute inset-0 opacity-40" />
      {/* Pure stage ink along the top edge, over the grain and the grid, so the
          footer begins exactly where the photograph above ends and the
          texture only comes up once the seam is well behind. */}
      <div
        className="absolute inset-x-0 top-0 h-72"
        style={{ backgroundImage: `linear-gradient(to bottom, ${STAGE_INK_CSS} 0%, transparent 100%)` }}
      />
    </div>
  );
}

export function MarketingFooter() {
  const year = new Date().getFullYear();
  const { pathname } = useLocation();
  const onLanding = pathname === '/';

  return (
    /* Marked as a stage so the header keeps its light ink when scrolled over it. */
    <footer
      data-stage
      className={cn('relative isolate overflow-hidden px-5 pt-12 sm:px-8 sm:pt-16', STAGE)}
      style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <FooterBackdrop />

      <div className="mx-auto max-w-6xl">
        <RouteRule />

        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:mt-12 md:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <div className="flex items-center gap-2.5">
              {/* Navy on transparency — the chip keeps the V visible on the stage. */}
              <SaarthiLogo className="h-7" decorative onDark />
              <p className="text-sm font-semibold">VorldX Saarthi</p>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/55">
              One system for everyone in a haul - fleet owners, drivers, suppliers, customers,
              travel operators, and the associations that answer when something goes wrong.
            </p>
            <ul className="mt-6 flex items-center gap-2" aria-label="VorldX Saarthi on social media">
              {SOCIAL_LINKS.map(({ href, label, Icon }) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`VorldX Saarthi on ${label}`}
                    title={label}
                    className="flex size-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="size-[1.125rem]" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <ColumnHeading index="01">Product</ColumnHeading>
            <ul className="mt-4 space-y-1 text-sm text-white/55">
              {NAV_SECTIONS.map((section) => (
                <li key={section.id}>
                  <SectionLink id={section.id} onLanding={onLanding} className={LINK_CLASS}>
                    <LinkInk>{section.label}</LinkInk>
                  </SectionLink>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <ColumnHeading index="02">Get started</ColumnHeading>
            <ul className="mt-4 space-y-1 text-sm text-white/55">
              <li>
                <Link to="/register" className={LINK_CLASS}>
                  <LinkInk>Create an account</LinkInk>
                </Link>
              </li>
              <li>
                <Link to="/login" className={LINK_CLASS}>
                  <LinkInk>Sign in</LinkInk>
                </Link>
              </li>
              <li>
                <Link to="/login" className={LINK_CLASS}>
                  <LinkInk>Explore the demo fleet</LinkInk>
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <ColumnHeading index="03">Legal</ColumnHeading>
            <ul className="mt-4 space-y-1 text-sm text-white/55">
              {LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={LINK_CLASS}>
                    <LinkInk>{link.label}</LinkInk>
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/privacy#grievance" className={LINK_CLASS}>
                  <LinkInk>Grievance redressal</LinkInk>
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 sm:mt-16">
          <Wordmark />
        </div>

        <div className="border-t border-white/10 pt-6">
          <p className="mx-auto max-w-3xl text-balance text-center text-2xs leading-relaxed text-white/55">
            Saarthi&rsquo;s emergency network connects nearby drivers who may be able to help. It
            does not replace official emergency services - always call 112 first in a
            life-threatening situation.
          </p>
          <p className="mt-4 text-center text-2xs text-white/55">© {year} VorldX Saarthi</p>
        </div>
      </div>
    </footer>
  );
}
