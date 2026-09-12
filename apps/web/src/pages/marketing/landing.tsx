import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { CapabilityMarquee, Hero, ProofStats } from '@/features/marketing/hero';
import { FeatureExplorer } from '@/features/marketing/feature-explorer';
import { RoleShowcaseSection } from '@/features/marketing/role-showcase';
import { FinalCta, HowItWorks, Pillars, SafetyBand } from '@/features/marketing/story-sections';
import { MarketingFooter, MarketingNav } from '@/features/marketing/marketing-chrome';
import { CoverageBand } from '@/features/marketing/coverage-band';
import { KnockoutBand } from '@/features/marketing/knockout-band';
import { Pricing } from '@/features/marketing/pricing';
import { CommandCentre } from '@/features/marketing/command-centre';
import { SmoothScroll, useScrollToSection } from '@/features/marketing/scroll-engine';
import { PointerHalo } from '@/features/marketing/magnetic';

/**
 * Public marketing site.
 *
 * Ordered as the questions a visitor actually asks: what is this (hero), how
 * much of it is there (marquee and counted facts), does it work where my loads
 * go (coverage), why is it different from what I already pay for (pillars),
 * what does operating it actually feel like (the command centre), what exactly
 * do I get (the capability explorer), what does it look like for someone like
 * me (roles), how does a job move through it (how it works), what happens when
 * something goes wrong (safety), and what does it cost (pricing).
 *
 * The command centre sits where it does for a structural reason as well as a
 * narrative one: `Pillars` and `FeatureExplorer` were the page's longest run
 * of consecutive token-driven bands, and a reader with nothing to look at for
 * that long stops scrolling.
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
 * The fourth is that the exhaustive parts - the explorer and the pricing
 * matrix - are generated from `FEATURE_CATALOGUE` and `PLAN_FEATURES` in
 * `@saarthi/shared`, the same data the running product gates itself on. A
 * hand-written feature list on a marketing page always ends up describing a
 * version that no longer exists.
 *
 * Composed from `@/features/marketing/*` rather than one file because the
 * sections are independently stateful - the explorer owns a search box, two
 * filters and a rail; pricing owns a billing toggle and a disclosure; roles
 * own a selector; the command centre owns a pinned timeline - and a single
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
        <FeatureExplorer />
        <KnockoutBand />
        <RoleShowcaseSection />
        <HowItWorks />
        <SafetyBand />
        <Pricing />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}

export function LandingPage() {
  return (
    <SmoothScroll>
      <LandingContent />
    </SmoothScroll>
  );
}

export default LandingPage;
