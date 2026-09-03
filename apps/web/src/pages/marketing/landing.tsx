import { CapabilityMarquee, Hero, ProofStats } from '@/features/marketing/hero';
import { FeatureExplorer } from '@/features/marketing/feature-explorer';
import { RoleShowcaseSection } from '@/features/marketing/role-showcase';
import { FinalCta, HowItWorks, Pillars, SafetyBand } from '@/features/marketing/story-sections';
import { MarketingFooter, MarketingNav } from '@/features/marketing/marketing-chrome';
import { Pricing } from '@/features/marketing/pricing';

/**
 * Public marketing site.
 *
 * Ordered as the questions a visitor actually asks: what is this (hero), how
 * much of it is there (marquee and counted facts), why is it different from
 * what I already pay for (pillars), what exactly do I get (the capability
 * explorer), what does it look like for someone like me (roles), how does a
 * job move through it (how it works), what happens when something goes wrong
 * (safety), and what does it cost (pricing).
 *
 * Two things hold the design together. The bands alternate ground — canvas,
 * raised, dark — so sections separate by tone rather than by yet another
 * border, and every band shares one vertical rhythm from `Section`. That
 * uniformity is what the previous version lacked, and most of why it read as
 * cluttered.
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
export function LandingPage() {
  return (
    <div className="min-h-full bg-canvas">
      <MarketingNav />
      <main>
        <Hero />
        <CapabilityMarquee />
        <ProofStats />
        <Pillars />
        <FeatureExplorer />
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
