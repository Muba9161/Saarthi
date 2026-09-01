import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationType } from '@saarthi/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/features/i18n/locale-context';

/**
 * The collapsed navigation rail.
 *
 * Collapsing the sidebar swaps every label for an icon and wraps each link in a
 * tooltip — the one code path where a nav item can vanish while the expanded
 * sidebar still looks perfect. These tests hold the rail to the only promise
 * that matters: whatever the expanded sidebar can reach, the rail can reach
 * too, and every icon in it is labelled for anyone who cannot see it.
 */

// The rail's data comes from the session; the network does not belong in here.
vi.mock('@/hooks/use-realtime', () => ({
  useRealtime: () => ({ status: 'connected' }),
  useRealtimeEvent: () => undefined,
}));

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn().mockResolvedValue({ unreadCount: 0, pagination: { total: 0 } }) },
}));

const session = {
  user: {
    id: 'user-1',
    name: 'Ravi Sharma',
    email: 'ravi@sharmatransport.in',
    roles: ['FLEET_OWNER'],
  },
  organization: {
    id: 'org-1',
    name: 'Sharma Transport Company',
    // Widened, not narrowed to the literal: one test swaps the account type to
    // reach a menu where a parent and its child are both destinations.
    type: OrganizationType.FLEET_OWNER as OrganizationType,
  },
  subscription: { planName: 'Growth' },
  demoMode: true,
};

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    session,
    status: 'authenticated',
    can: () => true,
    canAll: () => true,
    hasFeature: () => true,
    hasRole: (...roles: string[]) => roles.includes('FLEET_OWNER'),
    isPlatformAdmin: false,
    isDriver: false,
  }),
  useSession: () => session,
}));

// Imported after the mocks so the module graph picks them up.
const { SidebarContent } = await import('./app-shell');

function renderSidebar(collapsed: boolean, at = '/fleet/trucks') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <LocaleProvider>
          <TooltipProvider>
            {collapsed ? (
              <SidebarContent collapsed onToggleCollapse={() => undefined} />
            ) : (
              <SidebarContent onToggleCollapse={() => undefined} />
            )}
          </TooltipProvider>
        </LocaleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every navigation link, by destination. */
function destinations(container: HTMLElement): string[] {
  return [...container.querySelectorAll('nav a[href]')].map((anchor) =>
    anchor.getAttribute('href')!,
  );
}

describe('collapsed navigation rail', () => {
  it('reaches every destination the expanded sidebar reaches', () => {
    const expanded = renderSidebar(false);
    const expandedTargets = destinations(expanded.container);
    expanded.unmount();

    const collapsed = renderSidebar(true);
    const collapsedTargets = destinations(collapsed.container);

    expect(expandedTargets.length).toBeGreaterThan(5);
    expect(collapsedTargets).toEqual(expandedTargets);
  });

  it('renders an icon inside every link', () => {
    const { container } = renderSidebar(true);
    const links = [...container.querySelectorAll('nav a[href]')];

    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(link.querySelector('svg'), `${link.getAttribute('href')} has no icon`).not.toBeNull();
    }
  });

  it('keeps every icon-only link labelled for assistive technology', () => {
    const { container } = renderSidebar(true);
    const links = [...container.querySelectorAll('nav a[href]')];

    for (const link of links) {
      const name = (link.getAttribute('aria-label') ?? link.textContent ?? '').trim();
      expect(name, `${link.getAttribute('href')} is an unlabelled icon`).not.toBe('');
    }
  });

  it('drops the text labels that the rail has no room for', () => {
    const { container } = renderSidebar(true);
    expect(within(container).queryByText('Command centre')).toBeNull();
  });

  it('still offers a way back out', () => {
    renderSidebar(true);
    expect(screen.getByLabelText('Expand navigation')).toBeInTheDocument();
  });

  /*
   * The regression this file was written for.
   *
   * Radix's `asChild` merges className by joining the two values as strings.
   * Given NavLink's render-prop form it stringified the function's source into
   * the class attribute, so the link kept none of its real classes and the icons
   * inherited the page's dark foreground — invisible on the dark rail. Asserting
   * on the classes themselves is the only way to see it: the markup is present
   * and correct either way, which is exactly why it went unnoticed.
   */
  it('puts real classes on every link, not a stringified function', () => {
    const { container } = renderSidebar(true);
    const links = [...container.querySelectorAll('nav a[href]')];

    for (const link of links) {
      const className = link.getAttribute('class') ?? '';
      expect(className, `${link.getAttribute('href')} has JavaScript in its class`).not.toMatch(
        /=>|&&|\{|\}|\(/,
      );
      // The active link resolves to full opacity, so match either form — what
      // matters is that a sidebar colour survived onto the element at all.
      expect(className.split(/\s+/), `${link.getAttribute('href')} lost its colour`).toEqual(
        expect.arrayContaining([expect.stringMatching(/^text-sidebar-foreground(\/75)?$/)]),
      );
    }
  });

  it('centres the icon-only links and drops their horizontal padding', () => {
    const { container } = renderSidebar(true);
    const classes = (container.querySelector('nav a[href]')?.getAttribute('class') ?? '').split(
      /\s+/,
    );

    expect(classes).toContain('justify-center');
    expect(classes).toContain('px-0');
    expect(classes).not.toContain('px-3');
  });

  it('marks the link for the current route as active', () => {
    const { container } = renderSidebar(true);
    const trucks = container.querySelector('nav a[href="/fleet/trucks"]');

    expect(trucks?.getAttribute('class')).toContain('bg-sidebar-accent');
    expect(trucks?.querySelector('svg')?.getAttribute('class')).toContain('text-sidebar-highlight');
  });

  /*
   * Router-side matching marks a link active for its whole subtree, so a parent
   * destination lit up at the same time as its child — "/settings" alongside
   * "/settings/profile". Two highlighted entries tell the user they are in two
   * places at once, so the rule is that the most specific destination wins and
   * exactly one entry is ever active.
   */
  it('highlights exactly one destination, however deep the route', () => {
    // Walk the real menu rather than a hand-picked list, so this keeps holding
    // as destinations are added — including any new parent/child pair.
    const probe = renderSidebar(false);
    const targets = destinations(probe.container);
    probe.unmount();

    expect(targets.length).toBeGreaterThan(5);

    for (const at of targets) {
      const { container, unmount } = renderSidebar(false, at);
      const active = [...container.querySelectorAll('nav a[aria-current="page"]')];

      expect(active.map((link) => link.getAttribute('href')), `at ${at}`).toEqual([at]);
      unmount();
    }
  });

  it('keeps the parent destination active on a route that is not in the menu', () => {
    const { container } = renderSidebar(false, '/fleet/trucks/truck-1');
    const active = [...container.querySelectorAll('nav a[aria-current="page"]')];

    expect(active.map((link) => link.getAttribute('href'))).toEqual(['/fleet/trucks']);
  });

  /*
   * The customer menu is where a parent and its child are both destinations —
   * "Find travel" at /travel and "My bookings" at /travel/bookings. It is the
   * one menu that reproduces the original fault, so the rule is pinned here
   * against a pair that actually exists rather than a hypothetical one.
   */
  it('leaves the parent destination unlit when its child is the current route', () => {
    const previous = session.organization.type;
    session.organization.type = OrganizationType.CUSTOMER;

    try {
      const { container } = renderSidebar(false, '/travel/bookings');

      // Both are in this menu — otherwise the assertion below proves nothing.
      expect(container.querySelector('nav a[href="/travel"]')).not.toBeNull();
      expect(container.querySelector('nav a[href="/travel/bookings"]')).not.toBeNull();

      const active = [...container.querySelectorAll('nav a[aria-current="page"]')];
      expect(active.map((link) => link.getAttribute('href'))).toEqual(['/travel/bookings']);
    } finally {
      session.organization.type = previous;
    }
  });
});
