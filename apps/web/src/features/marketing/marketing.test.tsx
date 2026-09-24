import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LANGUAGE_CATALOGUE } from '@saarthi/shared';
import { ThemeProvider } from '@/features/theme/theme-context';
import { ROLE_SHOWCASE } from './feature-catalogue';
import { RoleShowcaseSection } from './role-showcase';
import { WordsReveal } from './motion-extras';
import { SAARTHI_IN_SCRIPT } from './knockout-band';

/**
 * The public site drifts from the product silently — a capability ships and
 * nobody updates the copy, or one is withdrawn and the page keeps selling it.
 * These tests hold the parts generated from shared data to that data.
 */

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>,
  );
}

describe('role showcase', () => {
  const panel = () => screen.getByRole('region', { name: 'Selected account type' });

  it('opens on the first role and lists its real navigation destinations', () => {
    renderWithProviders(<RoleShowcaseSection />);

    const first = ROLE_SHOWCASE[0];
    expect(first, 'no roles are configured').toBeDefined();
    if (!first) return;

    for (const section of first.navigation) {
      for (const item of section.items) {
        expect(
          within(panel()).getAllByText(item.label).length,
          `${first.label} is missing "${item.label}"`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('offers a step for every kind of account the product supports', () => {
    renderWithProviders(<RoleShowcaseSection />);

    const rail = screen.getByRole('navigation', { name: 'Account types' });
    for (const role of ROLE_SHOWCASE) {
      expect(within(rail).getByRole('button', { name: new RegExp(role.label) })).toBeInTheDocument();
    }
  });

  it('does not show the platform admin', () => {
    renderWithProviders(<RoleShowcaseSection />);
    expect(screen.queryByText('Platform admin')).toBeNull();
  });

  it('steps forward to the next role', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoleShowcaseSection />);

    const second = ROLE_SHOWCASE[1];
    expect(second, 'there is no second role').toBeDefined();
    if (!second) return;

    await user.click(screen.getByRole('button', { name: `Next: ${second.label}` }));

    // The quote is rendered with typographic quotes around it, so match on the
    // sentence rather than on exact node text.
    expect(within(panel()).getByText(second.quote, { exact: false })).toBeInTheDocument();
    const firstItem = second.navigation[0]?.items[0];
    if (firstItem) {
      expect(within(panel()).getAllByText(firstItem.label).length).toBeGreaterThan(0);
    }
  });

  it('jumps straight to a role chosen on the rail', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoleShowcaseSection />);

    const driver = ROLE_SHOWCASE.find((role) => role.id === 'driver');
    expect(driver, 'the driver role has gone').toBeDefined();
    if (!driver) return;

    const rail = screen.getByRole('navigation', { name: 'Account types' });
    await user.click(within(rail).getByRole('button', { name: new RegExp(driver.label) }));

    expect(within(panel()).getByText(driver.quote, { exact: false })).toBeInTheDocument();
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

describe('brand band', () => {
  /*
   * The band writes "Saarthi" out in each catalogue's own script. Nothing at
   * runtime notices a missing one — the rotation falls back to the Latin
   * spelling — so without this, adding a 24th language would quietly show
   * English to its speakers on the one part of the page whose entire point is
   * that it does not.
   */
  it('writes the name in every language the product offers', () => {
    for (const language of LANGUAGE_CATALOGUE) {
      expect(
        SAARTHI_IN_SCRIPT[language.code],
        `${language.code} (${language.english}) has no rendering of "Saarthi"`,
      ).toBeTruthy();
    }
  });

  it('renders each one in its own script, not transliterated to Latin', () => {
    // English aside, a rendering still in ASCII means the entry was stubbed
    // with the Latin spelling and never actually translated.
    for (const language of LANGUAGE_CATALOGUE) {
      if (language.code === 'en-IN') continue;
      expect(
        /^[\x20-\x7E]+$/.test(SAARTHI_IN_SCRIPT[language.code] ?? ''),
        `${language.code} (${language.english}) is still the Latin spelling`,
      ).toBe(false);
    }
  });
});
