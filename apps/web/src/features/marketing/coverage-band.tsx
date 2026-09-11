import { Languages, MapPinned, RefreshCw, ShieldAlert, Waypoints } from 'lucide-react';
import { FEATURE_CATALOGUE, Feature, LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { Section } from './marketing-chrome';
import { Reveal, RevealGroup, RevealItem, WordsReveal } from './motion-extras';
import { Backdrop, MARKETING_IMAGE, STAGE } from './imagery';
import { cn } from '@/lib/utils';

/**
 * How far the platform actually reaches.
 *
 * Sits between the counted facts and the pillars, answering the question they
 * leave open: the visitor has just been told how much product there is, and
 * the next thing they want to know is whether it works where their loads go.
 *
 * It is also the page's structural fix for its longest weak run. Between the
 * hero and the brand knockout there were four consecutive token-driven bands -
 * marquee, stats, pillars, explorer - and a reader with nothing to look at for
 * that long stops scrolling. This is a dark photographic stage dropped into
 * the middle of it.
 *
 * **There is no percentage here, and that is deliberate.** The obvious version
 * of this band is a large "on-time delivery" figure over a map, which is what
 * the freight industry puts on its posters. This codebase cannot substantiate
 * one: there is no coverage table, no completed-trip aggregate and no on-time
 * measure anywhere in `packages/shared`, and `ProofStats` already refuses to
 * print a customer count or an uptime number for exactly that reason. So the
 * band claims what is true and checkable instead - that the product models the
 * country's road rules, not just its roads - and every item below is read out
 * of `FEATURE_CATALOGUE` by key rather than typed here, so none of it can
 * describe a version that no longer ships.
 *
 * If a real figure ever exists, it goes in the slot above the heading where
 * `LANGUAGE_CATALOGUE.length` currently sits, and it comes from the API.
 */

/**
 * The capabilities that are about reach rather than about the load.
 *
 * Held as keys and resolved against the catalogue, so renaming a feature in
 * `packages/shared` renames it here, and deleting one removes it from the band
 * rather than leaving a dead card behind.
 */
const COVERAGE_FEATURES = [
  { key: Feature.CITY_ACCESS_INTELLIGENCE, icon: ShieldAlert },
  { key: Feature.LAST_MILE_RELAY, icon: Waypoints },
  { key: Feature.ROUTE_INTELLIGENCE, icon: MapPinned },
  { key: Feature.RETURN_LOADS, icon: RefreshCw },
] as const;

const CATALOGUE_BY_KEY = new Map(FEATURE_CATALOGUE.map((entry) => [entry.key, entry]));

export function CoverageBand() {
  const items = COVERAGE_FEATURES.flatMap(({ key, icon }) => {
    const definition = CATALOGUE_BY_KEY.get(key);
    return definition ? [{ ...definition, icon }] : [];
  });

  return (
    <Section
      id="coverage"
      width="wide"
      stage
      /*
       * `isolate` so the backdrop's negative z-index resolves against this
       * band rather than punching through to the page, and `overflow-hidden`
       * because the backdrop overscans itself for the parallax travel.
       *
       * Taller than the default rhythm: this band is mostly photograph, and at
       * the standard padding the map is cropped to a letterbox strip that
       * reads as a texture instead of a country.
       */
      className={cn('relative isolate overflow-hidden py-24 sm:py-28 lg:py-36', STAGE)}
    >
      {/*
       * Cropped to hold the truck, not the centre of the file.
       *
       * The frame is 16:9 and this band is wider than that at desktop widths,
       * so `cover` scales by width and crops top and bottom. The truck sits
       * just below the middle of the source and the map's mass is right of
       * centre, which is where those two figures come from.
       *
       * The default `both` scrim is correct in both orientations: the leftward
       * wash protects the copy column on the landscape cut, and on the portrait
       * cut the copy sits over sky that is already near-black, with the bottom
       * fade handing the band off to the pillars below without a seam.
       */}
      <Backdrop
        src={MARKETING_IMAGE.coverage}
        portraitSrc={MARKETING_IMAGE.coveragePortrait}
        objectPosition="68% 56%"
      />

      {/*
       * A second wash, on small screens only.
       *
       * The scrim above is directional, and on a phone neither direction is
       * the one that matters: the copy is a single full-width column, so it
       * runs straight over the middle of the portrait cut where the landmass
       * is at its brightest and the coastline glow is strongest. The feature
       * descriptions are the smallest type in the band and they were the ones
       * paying for it.
       *
       * Flat rather than another gradient, because the column has no safe
       * side to fall off towards. Above `sm` the copy is back in the left half
       * with the map beside it rather than under it, and the directional scrim
       * is enough, so this lifts off entirely.
       *
       * The colour is an inline style and not `bg-[hsl(240_6%_7%)]/45`, which
       * is what this was first written as and which Tailwind silently declined
       * to emit - an opacity modifier on an arbitrary space-separated colour
       * produced no rule at all, so the class existed in the markup and the
       * wash did not. `SCRIM` in `./imagery` was moved inline after the same
       * failure. A declared colour cannot be dropped on the floor.
       */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 sm:hidden"
        style={{ backgroundColor: 'hsl(240 6% 7% / 0.45)' }}
        aria-hidden
      />

      {/*
       * A single left column, with the right half left empty on purpose - that
       * is where the map is, and the frame was composed with this column in
       * mind. On a phone the portrait cut puts the map below the fold of the
       * copy instead, so nothing has to move.
       */}
      <div className="relative max-w-xl">
        <Reveal direction="none" duration={0.5}>
          <p className="flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-[0.16em] text-accent">
            <span className="h-px w-6 bg-accent/50" aria-hidden />
            Wherever the load is going
          </p>
        </Reveal>

        <WordsReveal
          text="The whole country, and the rules on it"
          className="mt-5 text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.025em] text-white sm:text-4xl lg:text-[2.75rem]"
        />

        <Reveal delay={0.12}>
          <p className="mt-5 text-pretty text-base leading-relaxed text-white/70 sm:text-lg">
            A national run is not one road. It is a no-entry board at the city limit, a permit
            somebody forgot, a hub where the load has to change vehicle, and an empty truck coming
            home. Saarthi holds all of that on the trip record, before the driver is standing at the
            barrier.
          </p>
        </Reveal>

        <RevealGroup as="ul" className="mt-12 grid gap-8 sm:grid-cols-2" stagger={0.1}>
          {items.map((item) => (
            <RevealItem as="li" key={item.key}>
              <item.icon className="size-5 text-accent" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-white">{item.name}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/60">{item.description}</p>
            </RevealItem>
          ))}
        </RevealGroup>

        {/*
         * The one counted fact the band is entitled to.
         *
         * Derived rather than typed, like every other figure on the page. It
         * is also the honest version of a reach claim: what the platform can
         * prove about covering India is that it speaks to the people driving
         * it, in their own script.
         */}
        <Reveal delay={0.2}>
          <p className="mt-12 flex items-center gap-2.5 border-l-2 border-accent/40 pl-4 text-xs leading-relaxed text-white/60">
            <Languages className="size-4 shrink-0 text-accent" aria-hidden />
            Read out in {LANGUAGE_CATALOGUE.length} languages, on the phone the driver already owns.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
