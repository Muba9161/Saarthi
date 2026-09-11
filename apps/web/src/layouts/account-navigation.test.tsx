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

    const { container, unmount } = renderSidebar();
    expect(destinations(container)).not.toContain('/settings/business-documents');
    unmount();
  });

  it('still gives that driver the rest of their account menu', () => {
    auth.session.organization.isPersonalSeat = true;
    auth.isDriver = true;

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

    const { container, unmount } = renderSidebar();
    expect(destinations(container)).toContain('/settings/business-documents');
    unmount();
  });
});
