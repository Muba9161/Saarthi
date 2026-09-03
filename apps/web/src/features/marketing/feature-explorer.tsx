import * as React from 'react';
import { ArrowRight, Search, SearchX, ShieldCheck, X } from 'lucide-react';
import {
  PLAN_TIERS,
  PlanTier,
  minimumTierFor,
  tierHasFeature,
  FEATURE_CATALOGUE,
  type Feature,
  type FeatureDefinition,
} from '@saarthi/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AnimatePresence, motion, useReducedMotion } from '@/components/motion';
import { Section, SectionHeading } from './marketing-chrome';
import {
  FEATURE_GROUPS,
  FEATURE_GROUP_OF,
  FEATURE_NOTES,
  type FeatureGroup,
  type FeatureGroupId,
} from './feature-catalogue';
import { cn } from '@/lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Short names for the badge — the catalogue's own are "Saarthi Pro" etc. */
const TIER_LABEL: Record<PlanTier, string> = {
  [PlanTier.BASIC]: 'Basic',
  [PlanTier.PRO]: 'Pro',
  [PlanTier.INTELLIGENCE]: 'Intelligence',
  [PlanTier.ENTERPRISE]: 'Enterprise',
};

/** Warmth rises with the tier, so the entry plan reads as the generous one. */
const TIER_BADGE: Record<PlanTier, 'success' | 'info' | 'default' | 'accent'> = {
  [PlanTier.BASIC]: 'success',
  [PlanTier.PRO]: 'info',
  [PlanTier.INTELLIGENCE]: 'default',
  [PlanTier.ENTERPRISE]: 'accent',
};

type TierFilter = PlanTier | 'any';

function matches(definition: FeatureDefinition, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const groupId = FEATURE_GROUP_OF[definition.key];
  const group = FEATURE_GROUPS.find((candidate) => candidate.id === groupId);

  return (
    definition.name.toLowerCase().includes(needle) ||
    definition.description.toLowerCase().includes(needle) ||
    (group?.label.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * One capability, as a row.
 *
 * Rows rather than cards, and this is the whole reason the section reads
 * calmly now: forty-eight bordered, shadowed, glowing cards is forty-eight
 * containers competing for attention. A row has one hairline and gets its
 * separation from whitespace, so the eye runs down the names and stops at the
 * one it wants.
 */
function FeatureRow({
  definition,
  showGroup = false,
}: {
  definition: FeatureDefinition;
  /** In search results the area is context the reader has lost. */
  showGroup?: boolean;
}) {
  const groupId = FEATURE_GROUP_OF[definition.key];
  const group = FEATURE_GROUPS.find((candidate) => candidate.id === groupId);
  const tier = minimumTierFor(definition.key);
  const note = FEATURE_NOTES[definition.key];
  const Icon = group?.icon;

  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
      }}
      className="group relative border-b border-border/50 last:border-0"
    >
      <div className="flex gap-4 py-4 transition-transform duration-300 ease-smooth group-hover:translate-x-1">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary/90 transition-colors duration-300 group-hover:bg-primary/15">
          {Icon ? <Icon className="size-4" aria-hidden /> : null}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h4 className="text-sm font-semibold">{definition.name}</h4>
            {tier ? (
              <Badge variant={TIER_BADGE[tier]} size="sm">
                {TIER_LABEL[tier]}
              </Badge>
            ) : null}
            {showGroup && group ? (
              <span className="text-2xs text-muted-foreground">{group.label}</span>
            ) : null}
          </div>

          <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
            {definition.description}
          </p>

          {note ? (
            <p className="mt-2 border-l-2 border-accent/40 pl-3 text-xs leading-relaxed text-muted-foreground/85">
              {note}
            </p>
          ) : null}
        </div>
      </div>
    </motion.li>
  );
}

/** The rail entry for one area. */
function GroupButton({
  group,
  count,
  active,
  onSelect,
  layout,
}: {
  group: FeatureGroup;
  count: number;
  active: boolean;
  onSelect: () => void;
  /** Shared `layoutId` namespace — the rail and the mobile strip differ. */
  layout: string;
}) {
  const empty = count === 0;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={empty && !active}
      onClick={onSelect}
      className={cn(
        'relative flex w-full shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left',
        'transition-colors duration-200',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        empty && !active && 'cursor-not-allowed opacity-35 hover:text-muted-foreground',
      )}
    >
      {active ? (
        <motion.span
          layoutId={layout}
          className="absolute inset-0 rounded-xl border border-primary/25 bg-primary/[0.07]"
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      ) : null}

      <group.icon
        className={cn('relative size-4 shrink-0', active ? 'text-primary' : 'opacity-70')}
        aria-hidden
      />
      <span className="relative min-w-0 flex-1 whitespace-nowrap text-sm font-medium">
        {group.label}
      </span>
      <span className="relative shrink-0 text-2xs tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/**
 * Every capability the platform has — one area at a time.
 *
 * The list is `FEATURE_CATALOGUE` itself, so the section is complete by
 * construction; there is no second list to keep in step. What changed is how
 * much of it is on screen at once. Showing all forty-eight simultaneously was
 * honest and unreadable. An area rail plus a row list shows one coherent group
 * of five to eight, and search reaches across all of them for anyone who
 * arrived looking for a specific thing.
 *
 * The plan filter answers the question the pricing table below otherwise gets
 * scrolled up and down to answer: is this in the plan I can afford?
 */
export function FeatureExplorer() {
  const reduced = useReducedMotion();
  const [query, setQuery] = React.useState('');
  const [tier, setTier] = React.useState<TierFilter>('any');
  const [requested, setRequested] = React.useState<FeatureGroupId>(
    FEATURE_GROUPS[0]?.id ?? 'tracking',
  );

  const searching = query.trim() !== '';

  /** Features in one area that survive the plan filter and the search. */
  const featuresIn = React.useCallback(
    (groupId: FeatureGroupId): FeatureDefinition[] =>
      FEATURE_CATALOGUE.filter(
        (definition) =>
          FEATURE_GROUP_OF[definition.key] === groupId &&
          (tier === 'any' || tierHasFeature(tier, definition.key as Feature)) &&
          matches(definition, query),
      ),
    [query, tier],
  );

  const counts = React.useMemo(
    () => FEATURE_GROUPS.map((group) => ({ group, count: featuresIn(group.id).length })),
    [featuresIn],
  );

  const totalShown = counts.reduce((sum, entry) => sum + entry.count, 0);

  /*
   * Derived, not stored: filtering to Basic can empty the area the reader was
   * looking at. Falling through to the first area that still has something in
   * it keeps the panel from going blank while the rail says there are matches
   * elsewhere.
   */
  const active =
    counts.find((entry) => entry.group.id === requested && entry.count > 0)?.group ??
    counts.find((entry) => entry.count > 0)?.group ??
    FEATURE_GROUPS[0];

  const results = React.useMemo(
    () =>
      searching
        ? FEATURE_CATALOGUE.filter(
            (definition) =>
              (tier === 'any' || tierHasFeature(tier, definition.key as Feature)) &&
              matches(definition, query),
          )
        : [],
    [query, searching, tier],
  );

  const shown = searching ? results : active ? featuresIn(active.id) : [];
  const filtered = searching || tier !== 'any';

  const reset = (): void => {
    setQuery('');
    setTier('any');
  };

  return (
    <Section id="features" width="wide">
      <SectionHeading
        eyebrow="The whole catalogue"
        title="Every capability, and which plan it is in"
        body="This is the entitlement catalogue the running product gates itself on — so nothing shipped is missing here, and nothing here has quietly been removed."
      />

      {/* --- Controls ---------------------------------------------------- */}
      <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all capabilities…"
            aria-label="Search capabilities"
            className="h-11 rounded-full pl-11 pr-11"
          />
          <AnimatePresence initial={false}>
            {query ? (
              <motion.button
                key="clear"
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                initial={reduced ? false : { opacity: 0, scale: 0.7 }}
                animate={reduced ? undefined : { opacity: 1, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.16 }}
                className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <X className="size-4" />
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Plan filter, as a segmented pill. Visible rather than collapsed
            into a select: the point is comparing plans, and a closed control
            hides four fifths of the comparison. */}
        <div
          role="radiogroup"
          aria-label="Filter by plan"
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-full border border-border/70 bg-card/60 p-1 backdrop-blur scrollbar-none"
        >
          {(['any', ...PLAN_TIERS] as TierFilter[]).map((candidate) => {
            const selected = tier === candidate;
            return (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTier(candidate)}
                className={cn(
                  'relative shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200',
                  selected
                    ? 'text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {selected ? (
                  <motion.span
                    layoutId="feature-tier-pill"
                    className="absolute inset-0 rounded-full bg-brand-gradient"
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  />
                ) : null}
                <span className="relative">
                  {candidate === 'any' ? 'Any plan' : TIER_LABEL[candidate]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* --- Rail + panel ------------------------------------------------- */}
      <div className="mt-12 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
        <div
          className="min-w-0"
          role="tablist"
          aria-label="Capability areas"
          aria-orientation="vertical"
        >
          {/* Vertical on desktop, a scrolling strip on phones — a nine-item
              rail above the content would push the list off the first screen. */}
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2 scrollbar-none lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {counts.map(({ group, count }) => (
              <GroupButton
                key={group.id}
                group={group}
                count={count}
                active={!searching && active?.id === group.id}
                onSelect={() => {
                  setQuery('');
                  setRequested(group.id);
                }}
                layout="feature-group-pill"
              />
            ))}
          </div>

          <div className="mt-6 hidden border-t border-border/60 pt-5 lg:block">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              Every gate is enforced on the server too, so a capability your plan does not include
              cannot be reached by editing the page.
            </p>
          </div>
        </div>

        <div className="min-w-0">
          {totalShown === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-20 text-center">
              <SearchX className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">Nothing matches that</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Try a broader search, or clear the plan filter — several capabilities only appear in
                the higher tiers.
              </p>
              <Button variant="outline" size="sm" onClick={reset} className="mt-1 rounded-full">
                Clear filters
              </Button>
            </div>
          ) : (
            /*
             * Keyed so React remounts on every change of area, replaying the
             * stagger. No exit animation, deliberately: an exit keeps the old
             * rows mounted for the length of the transition, so for a moment
             * the list still holds capabilities the reader just filtered away.
             */
            <motion.div
              key={searching ? `search:${query}:${tier}` : `${active?.id}:${tier}`}
              initial={reduced ? false : 'hidden'}
              animate={reduced ? undefined : 'visible'}
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.045 } },
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-border pb-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold tracking-tight">
                    {searching ? 'Search results' : active?.label}
                  </h3>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                    {searching ? `Matching “${query.trim()}” across every area.` : active?.summary}
                  </p>
                </div>
                <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
                  Showing{' '}
                  <span className="font-semibold tabular-nums text-foreground">{shown.length}</span>
                  {searching ? ` of ${FEATURE_CATALOGUE.length}` : ''}
                  {tier !== 'any' ? ` · in ${TIER_LABEL[tier]}` : ''}
                </p>
              </div>

              <ul>
                {shown.map((definition) => (
                  <FeatureRow key={definition.key} definition={definition} showGroup={searching} />
                ))}
              </ul>

              {filtered ? (
                <div className="pt-6">
                  <Button variant="ghost" size="sm" onClick={reset} className="rounded-full">
                    Clear filters
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </motion.div>
          )}
        </div>
      </div>
    </Section>
  );
}
