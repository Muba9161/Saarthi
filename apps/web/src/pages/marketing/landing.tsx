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

/**
 * Public marketing site.
 *
 * Ordered as the questions a visitor actually asks: what is this (hero), how
 * much of it is there (marquee and counted facts), does it work where my loads
 * go (coverage), why is it different from what I already pay for (pillars),
 * what exactly do I get (the capability explorer), what does it look like for
 * someone like me (roles), how does a job move through it (how it works), what
 * happens when something goes wrong (safety), and what does it cost (pricing).
 *
 * Three things hold the design together. The bands alternate ground — canvas,
 * raised, dark — so sections separate by tone rather than by yet another
 * border, and every band shares one vertical rhythm from `Section`. That
 * uniformity is what the previous version lacked, and most of why it read as
 * cluttered.
 *
 * The third is the photography, and where it is *not*. Five bands — the hero,
 * coverage, the brand knockout, safety and the closing call — are fixed near-black
 * stages that hold one image each and do not move when the theme does; see
 * `@/features/marketing/imagery`. Everything between them stays entirely
 * token-driven. Interleaving the two is the point: the picture bands are the
 * places a reader is allowed to stop, and they only feel like arrivals
 * because the working sections between them are quiet. Every one of them also
 * renders correctly with its image absent, so the layout does not depend on
 * the shoot being finished.
 *
 * The exhaustive parts — the explorer and the pricing matrix — are generated
 * from `FEATURE_CATALOGUE` and `PLAN_FEATURES` in `@saarthi/shared`, the same
 * data the running product gates itself on. A hand-written feature list on a
 * marketing page always ends up describing a version that no longer exists.
 *
 * Composed from `@/features/marketing/*` rather than one file because the
 * sections are independently stateful — the explorer owns a search box, two
 * filters and a rail; pricing owns a billing toggle and a disclosure; roles
 * own a selector — and a single component holding all of it would re-render
 * the whole page on every keystroke.
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
 */
function useHashTarget(hash: string): void {
  React.useEffect(() => {
    if (!hash) return undefined;

    const frame = requestAnimationFrame(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);
}

export function LandingPage() {
  useHashTarget(useLocation().hash);

  return (
    <div className="min-h-full bg-canvas">
      <MarketingNav />
      <main>
        <Hero />
        <CapabilityMarquee />
        <ProofStats />
        <CoverageBand />
        <Pillars />
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

export default LandingPage;
