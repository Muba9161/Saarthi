import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganizationType } from '@saarthi/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/features/i18n/locale-context';

/**
 * The account block at the foot of the sidebar.
 *
 * It used to be rendered straight from `ACCOUNT_NAVIGATION`, bypassing the
 * filter every other menu entry goes through — so the permissions those
 * entries declared were never evaluated and every account saw all four. The
 * visible symptom was a driver being offered "Business documents" and asked
 * for a GST number and a registration certificate against their own name.
 *
 * The gate that fixes it cannot be "does this account have an organization?",
 * because a driver always does: signing up without an employer's invite code
 * creates a single-member one named after them to hang their membership,
 * documents and QR badge on. These tests pin the distinction that actually
 * matters — a seat is not a business.
 */

vi.mock('@/hooks/use-realtime', () => ({
  useRealtime: () => ({ status: 'connected' }),
  useRealtimeEvent: () => undefined,
}));

vi.mock('@/lib/api-client', () => ({
  api: { get: vi.fn().mockResolvedValue({ unreadCount: 0, pagination: { total: 0 } }) },
}));

/** Mutable so each case can describe a different kind of account. */
const auth = {
  session: {
    user: { id: 'user-1', name: 'Cullen Yates', email: 'cullen@example.com', roles: ['DRIVER'] },
    organization: {
      id: 'org-1',
      name: 'Cullen Yates',
      type: OrganizationType.FLEET_OWNER as OrganizationType,
      isPersonalSeat: true,
    },
    subscription: { planName: 'Development' },
    demoMode: true,
  },
  isDriver: true,
  hasDriverProfile: true,
};

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    session: auth.session,
    status: 'authenticated',
    // Deliberately permissive: a driver really does hold DOCUMENTS_READ, for
    // their own licence and PAN. If the gate were a permission check this
    // would let it through, which is exactly the bug.
    can: () => true,
    canAll: () => true,
    hasFeature: () => true,
    hasRole: (...roles: string[]) => roles.includes('DRIVER'),
    isPlatformAdmin: false,
    isDriver: auth.isDriver,
    hasDriverProfile: auth.hasDriverProfile,
  }),
  useSession: () => auth.session,
}));

const { SidebarContent } = await import('./app-shell');

function destinations(container: HTMLElement): string[] {
  return [...container.querySelectorAll('nav a[href]')].map((a) => a.getAttribute('href')!);
}

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/driver']}>
        <LocaleProvider>
          <TooltipProvider>
            <SidebarContent onToggleCollapse={() => undefined} />
          </TooltipProvider>
        </LocaleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('business destinations and personal seats', () => {
  it('keeps business documents away from a driver on a personal seat', () => {
    auth.session.organization.isPersonalSeat = true;
    auth.isDriver = true;
    auth.hasDriverProfile = true;

    const { container, unmount } = renderSidebar();
    expect(destinations(container)).not.toContain('/settings/business-documents');
    unmount();
  });

  it('still gives that driver the rest of their account menu', () => {
    auth.session.organization.isPersonalSeat = true;
    auth.isDriver = true;
    auth.hasDriverProfile = true;

    const { container, unmount } = renderSidebar();
    const targets = destinations(container);
    // Filtering the block must not empty it — these three carry no business
    // requirement and a driver needs all of them.
    expect(targets).toContain('/notifications');
    expect(targets).toContain('/settings/profile');
    expect(targets).toContain('/verification');
    unmount();
  });

  it('offers business documents once the organization is a real business', () => {
    auth.session.organization.isPersonalSeat = false;
    auth.isDriver = true;
    auth.hasDriverProfile = true;

    const { container, unmount } = renderSidebar();
    expect(destinations(container)).toContain('/settings/business-documents');
    unmount();
  });
});

/**
 * The same distinction, one level up: what the fleet menu is called.
 *
 * A Personal subscription is seated in a FLEET_OWNER organization named after
 * the person, so the organization type alone puts them on the freight menu —
 * headed "Trucks", beside a business documents entry wanting a GSTIN. Neither
 * describes somebody who signed up for their own two cars. `/fleet/vehicles`
 * is the whole-fleet view of the very same rows, so this is one destination
 * worded for the account reading it rather than a second table.
 */
describe('the fleet roster a personal seat is offered', () => {
  it('sends a personal seat to Vehicles and not to Trucks', () => {
    auth.session.organization.isPersonalSeat = true;
    auth.isDriver = false;
    auth.hasDriverProfile = false;

    const { container, unmount } = renderSidebar();
    const targets = destinations(container);
    expect(targets).toContain('/fleet/vehicles');
    expect(targets).not.toContain('/fleet/trucks');
    // And the business paperwork goes with it: a person has no registration
    // certificate, GSTIN or bank mandate to file.
    expect(targets).not.toContain('/settings/business-documents');
    unmount();
  });

  it('leaves a real fleet on Trucks', () => {
    auth.session.organization.isPersonalSeat = false;
    auth.isDriver = false;
    auth.hasDriverProfile = false;

    const { container, unmount } = renderSidebar();
    const targets = destinations(container);
    expect(targets).toContain('/fleet/trucks');
    // Unchanged for a freight operator: two links to the same table under
    // different names only asks which one is authoritative.
    expect(targets).not.toContain('/fleet/vehicles');
    expect(targets).toContain('/settings/business-documents');
    unmount();
  });
});

/**
 * The owner who also drives.
 *
 * The case: a Personal customer with a car of his own who ticked "I drive one
 * of my vehicles myself" during registration. That creates a driver profile
 * against his own user — the feature working as intended — and for a while it
 * cost him the entire product.
 *
 * `isDriver` asked only whether a driver profile existed, so from his first
 * sign-in the app treated him as somebody's employee: redirected to the driver
 * app, handed the driver menu, and left with no Vehicles, no Drivers and no
 * Subscription. He had bought a plan to put his own cars on the road and been
 * given no way to add one.
 *
 * Both halves are pinned here, because fixing either one alone breaks the
 * other: he keeps the account he owns, *and* he keeps the driving screens he
 * needs because he drives.
 */
describe('a personal owner who also drives', () => {
  function asOwnerDriver(): void {
    auth.session.organization.isPersonalSeat = true;
    auth.session.organization.type = OrganizationType.FLEET_OWNER;
    // Has a driver profile, but is not an employed driver — his membership
    // role is FLEET_OWNER, because he owns the vehicles and also drives them.
    auth.isDriver = false;
    auth.hasDriverProfile = true;
  }

  it('keeps the account he owns, including how to add a vehicle and a driver', () => {
    asOwnerDriver();

    const { container, unmount } = renderSidebar();
    const targets = destinations(container);

    // The two the bug report named: there was no way to add either.
    expect(targets).toContain('/fleet/vehicles');
    expect(targets).toContain('/fleet/drivers');
    unmount();
  });

  it('still gives him his own driving screens', () => {
    asOwnerDriver();

    const { container, unmount } = renderSidebar();
    const targets = destinations(container);

    // Not taken away by the fix: he drives, so his own trip and his own score
    // are his.
    expect(targets).toContain('/driver');
    expect(targets).toContain('/driver/score');
    unmount();
  });

  it('gives an employed driver the driver app and nothing else', () => {
    // The other side of the same line. Someone whose membership role is DRIVER
    // is an employee, and the fleet roster is not theirs.
    auth.session.organization.isPersonalSeat = true;
    auth.isDriver = true;
    auth.hasDriverProfile = true;

    const { container, unmount } = renderSidebar();
    const targets = destinations(container);

    expect(targets).toContain('/driver');
    expect(targets).not.toContain('/fleet/vehicles');
    expect(targets).not.toContain('/fleet/drivers');
    unmount();
  });
});
