import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  FEATURE_CATALOGUE,
  PLAN_CATALOGUE,
  PLAN_TIERS,
  PlanTier,
  tierHasFeature,
  type Feature,
} from '@saarthi/shared';
import { ThemeProvider } from '@/features/theme/theme-context';
import { FeatureExplorer } from './feature-explorer';
import { FEATURE_GROUPS, FEATURE_GROUP_OF, ROLE_SHOWCASE } from './feature-catalogue';
import { RoleShowcaseSection } from './role-showcase';
import { WordsReveal } from './motion-extras';

/**
 * The public site's one hard promise: it lists everything.
 *
 * A marketing page drifts from the product silently — a capability ships and
 * nobody updates the copy, or one is withdrawn and the page keeps selling it.
 * These tests are why the explorer reads `FEATURE_CATALOGUE` directly instead
 * of keeping its own list, and they fail the moment that stops being true.
 *
 * The explorer shows one area at a time, so "lists everything" is now a claim
 * about reachability rather than about a single render. Walking the rail is
 * exactly how a visitor would check it, so that is how these tests check it.
 */

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>,
  );
}

/** Capability names currently on screen. Feature rows are the only h4s. */
function shownNames(): string[] {
  return screen.queryAllByRole('heading', { level: 4 }).map((heading) => heading.textContent ?? '');
}

/** Clicks through every selectable area and gathers what each one showed. */
async function walkAreas(user: UserEvent): Promise<Set<string>> {
  const found = new Set<string>();
  const rail = screen.getByRole('tablist', { name: 'Capability areas' });

  for (const tab of within(rail).getAllByRole('tab')) {
    if (tab instanceof HTMLButtonElement && tab.disabled) continue;
    // The rail is sequential by nature, so the awaits are deliberate.
    await user.click(tab);
    shownNames().forEach((name) => found.add(name));
  }

  return found;
}

describe('feature explorer', () => {
  it('reaches every capability in the platform catalogue', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureExplorer />);

    const found = await walkAreas(user);

    for (const definition of FEATURE_CATALOGUE) {
      expect(
        found.has(definition.name),
        `${definition.key} (${definition.name}) cannot be reached from the public site`,
      ).toBe(true);
    }
    expect(found.size).toBe(FEATURE_CATALOGUE.length);
  });

  it('places every capability in exactly one known area', () => {
    // The grouping is what the rail and the pricing matrix iterate, so a
    // feature with no area would be invisible in both.
    const ids = new Set(FEATURE_GROUPS.map((group) => group.id));

    for (const definition of FEATURE_CATALOGUE) {
      const group = FEATURE_GROUP_OF[definition.key];
      expect(group, `${definition.key} has no feature group`).toBeDefined();
      expect(ids.has(group), `${definition.key} is in unknown group "${group}"`).toBe(true);
    }
  });

  it('opens on the first area rather than on an empty panel', () => {
    renderWithProviders(<FeatureExplorer />);

    const first = FEATURE_GROUPS[0];
    expect(first).toBeDefined();
    if (!first) return;

    expect(screen.getByRole('heading', { name: first.label, level: 3 })).toBeInTheDocument();
    expect(shownNames().length).toBeGreaterThan(0);
  });

  it('searches across every area, not just the open one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureExplorer />);

    // "Copilot" lives in Intelligence, which is not the area on screen first.
    await user.type(screen.getByLabelText('Search capabilities'), 'Copilot');

    expect(screen.getByRole('heading', { name: 'AI Fleet Copilot', level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Live tracking', level: 4 })).toBeNull();
  });

  it('reports how many of the catalogue a search matched', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureExplorer />);

    await user.type(screen.getByLabelText('Search capabilities'), 'telemetry');

    expect(screen.getByText(/^Showing/)).toHaveTextContent(
      new RegExp(`of ${FEATURE_CATALOGUE.length}`),
    );
  });

  it('says so plainly when nothing matches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureExplorer />);

    await user.type(screen.getByLabelText('Search capabilities'), 'zzzznotacapability');

    expect(screen.getByText('Nothing matches that')).toBeInTheDocument();
    expect(shownNames()).toHaveLength(0);
  });

  it('shows exactly what a plan includes when filtered to that plan', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FeatureExplorer />);

    await user.click(screen.getByRole('radio', { name: 'Basic' }));
    const found = await walkAreas(user);

    for (const definition of FEATURE_CATALOGUE) {
      const included = tierHasFeature(PlanTier.BASIC, definition.key);
      expect(
        found.has(definition.name),
        included
          ? `${definition.name} is in Basic but could not be reached`
          : `${definition.name} is not in Basic but was still listed`,
      ).toBe(included);
    }
  });

  it('agrees with the entitlement functions the app itself gates on', () => {
    // Guards the assumption the pricing matrix renders: a capability is in a
    // tier if and only if `tierHasFeature` says so, for every pair.
    for (const definition of FEATURE_CATALOGUE) {
      for (const tier of PLAN_TIERS) {
        const plan = PLAN_CATALOGUE.find((candidate) => candidate.tier === tier);
        expect(
          tierHasFeature(tier, definition.key as Feature),
          `${tier} disagrees with its own plan definition about ${definition.key}`,
        ).toBe(plan?.features.includes(definition.key) ?? false);
      }
    }
  });
});

describe('role showcase', () => {
  it('opens on the first role and lists its real navigation destinations', () => {
    renderWithProviders(<RoleShowcaseSection />);

    const first = ROLE_SHOWCASE[0];
    expect(first, 'no roles are configured').toBeDefined();
    if (!first) return;

    const panel = screen.getByRole('tabpanel');
    for (const section of first.navigation) {
      for (const item of section.items) {
        expect(
          within(panel).getAllByText(item.label).length,
          `${first.label} is missing "${item.label}"`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('offers a tab for every kind of account the product supports', () => {
    renderWithProviders(<RoleShowcaseSection />);

    for (const role of ROLE_SHOWCASE) {
      expect(screen.getByRole('tab', { name: new RegExp(role.label) })).toBeInTheDocument();
    }
  });

  it('replaces the listed destinations when another role is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoleShowcaseSection />);

    const driver = ROLE_SHOWCASE.find((role) => role.id === 'driver');
    expect(driver, 'the driver role has gone').toBeDefined();
    if (!driver) return;

    await user.click(screen.getByRole('tab', { name: new RegExp(driver.label) }));

    const panel = screen.getByRole('tabpanel');
    // The quote is rendered with typographic quotes around it, so match on the
    // sentence rather than on exact node text.
    expect(within(panel).getByText(driver.quote, { exact: false })).toBeInTheDocument();

    const firstItem = driver.navigation[0]?.items[0];
    if (firstItem) {
      expect(within(panel).getAllByText(firstItem.label).length).toBeGreaterThan(0);
    }
  });
});

describe('animated headings', () => {
  it('leaves the line breaker somewhere to break', () => {
    /*
     * The regression this exists for.
     *
     * Each word is wrapped in an `inline-block` so its own overflow can clip
     * the slide-up. Adjacent inline-blocks with no text node between them give
     * the line breaker nowhere to break, so a heading becomes one unbreakable
     * line — and because the document clips horizontal overflow rather than
     * scrolling it, that does not just look wrong on a phone, it cuts off
     * every section beside it.
     *
     * jsdom has no line breaker, so the property under test is structural:
     * there must be a whitespace text node between consecutive words.
     */
    render(<WordsReveal text="one two three four" />);

    const heading = screen.getByRole('heading');
    const spaces = Array.from(heading.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent === ' ',
    );

    expect(spaces).toHaveLength(3);
    expect(heading).toHaveTextContent('one two three four');
  });
});
