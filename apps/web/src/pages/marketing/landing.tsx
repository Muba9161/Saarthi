import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { CapabilityMarquee, Hero, ProofStats } from '@/features/marketing/hero';
import { RoleShowcaseSection } from '@/features/marketing/role-showcase';
import { FinalCta, HowItWorks, Pillars, SafetyBand } from '@/features/marketing/story-sections';
import { MarketingFooter, MarketingNav } from '@/features/marketing/marketing-chrome';
import { CoverageBand } from '@/features/marketing/coverage-band';
import { KnockoutBand } from '@/features/marketing/knockout-band';
import { Pricing } from '@/features/marketing/pricing';
import { TrackersSection } from '@/features/marketing/trackers-section';
import { CommandCentre } from '@/features/marketing/command-centre';
import { SmoothScroll, useScrollToSection } from '@/features/marketing/scroll-engine';
import { PointerHalo } from '@/features/marketing/magnetic';
import { usePreloadWhenIdle } from '@/lib/lazy-with-preload';
import { LoginPage, RegisterPage } from '@/pages/lazy-pages';

/** Where "Sign in" and "Start free" go; fetched once the page has settled. */
const NEXT_PAGES = [LoginPage, RegisterPage];

/**
 * Public marketing site.
 *
 * Ordered as the questions a visitor actually asks: what is this (hero), how
 * much of it is there (marquee and counted facts), does it work where my loads
 * go (coverage), why is it different from what I already pay for (pillars),
 * what does operating it actually feel like (the command centre), what does it
 * look like for someone like me (roles), how does a job move through it (how
 * it works), what happens when something goes wrong (safety), what does it
 * cost (pricing), and what does a tracker add (trackers).
 *
 * The capability catalogue that once sat after the command centre is gone:
 * every paid plan carries every capability for its account type, so a list of
 * which plan holds which feature no longer answered a real question.
 *
 * Four things hold the design together. The bands alternate ground - canvas,
 * raised, dark - so sections separate by tone rather than by yet another
 * border, and every band shares one vertical rhythm from `Section`.
 *
 * The second is the photography, and where it is *not*. Five bands - the hero,
 * coverage, the brand knockout, safety and the closing call - are fixed
 * near-black stages that hold one image each and do not move when the theme
 * does; see `@/features/marketing/imagery`. Everything between them stays
 * entirely token-driven. Interleaving the two is the point: the picture bands
 * are the places a reader is allowed to stop, and they only feel like arrivals
 * because the working sections between them are quiet. Every one of them also
 * renders correctly with its image absent, so the layout does not depend on
 * the shoot being finished.
 *
 * The third is motion, and it is deliberately layered rather than uniform. The
 * page has exactly two scroll-linked set pieces - the hero's network and the
 * pinned command centre - and everything between them uses the quiet reveal
 * vocabulary in `motion-extras`. A page where every band performs has no
 * emphasis left to spend; see `scroll-engine.tsx` for why the two libraries
 * both exist and where the line between them falls.
 *
 * The fourth is that prices and the role screens are generated from shared
 * data - `PLAN_CATALOGUE`, `TRACKER_PRODUCTS` and the app's own navigation
 * trees - so the page cannot quote a price or a screen the product does not
 * have.
 *
 * Composed from `@/features/marketing/*` rather than one file because the
 * sections are independently stateful - pricing owns a fleet-size control;
 * roles own a step-through; the command centre owns a pinned timeline - and a single
 * component holding all of it would re-render the whole page on every
 * keystroke.
 */

/**
 * Honours a fragment the reader arrived with, rather than only one they click.
 *
 * A bare `#pricing` on this page is handled by the browser, but a fragment
 * that comes in with the navigation is not: on a cold load the band does not
 * exist yet when the browser looks for it, and on a route change from the
 * Terms or Privacy page there is no document load to trigger a look at all.
 * Both cases land the reader at the top of the hero wondering what happened.
 *
 * `requestAnimationFrame` waits for the bands to be laid out before asking for
 * one, which is the whole reason the native attempt fails.
 *
 * It goes through `useScrollToSection` rather than calling `scrollIntoView`
 * itself, because Lenis is driving the page: a native jump sets the scroll
 * position out from under it and Lenis snaps back on its next frame. See the
 * note on that hook.
 */
function useHashTarget(hash: string): void {
  const scrollToSection = useScrollToSection();

  React.useEffect(() => {
    if (!hash) return undefined;

    const frame = requestAnimationFrame(() => scrollToSection(hash.slice(1)));
    return () => cancelAnimationFrame(frame);
  }, [hash, scrollToSection]);
}

/**
 * The page's content, inside the scroll engine.
 *
 * Split from `LandingPage` because `useHashTarget` reads the Lenis instance
 * out of context, and a component cannot consume a provider it renders itself.
 */
function LandingContent() {
  useHashTarget(useLocation().hash);

  return (
    <div className="min-h-full bg-canvas">
      <PointerHalo />
      <MarketingNav />
      <main>
        <Hero />
        <CapabilityMarquee />
        <ProofStats />
        <CoverageBand />
        <Pillars />
        <CommandCentre />
        <KnockoutBand />
        <RoleShowcaseSection />
        <HowItWorks />
        <SafetyBand />
        <Pricing />
        <TrackersSection />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}

export function LandingPage() {
  usePreloadWhenIdle(NEXT_PAGES);

  return (
    <SmoothScroll>
      <LandingContent />
    </SmoothScroll>
  );
}

export default LandingPage;
