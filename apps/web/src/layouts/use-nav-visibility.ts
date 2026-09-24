import * as React from 'react';
import type { RoleName } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { ACCOUNT_NAVIGATION, type NavItem, type NavSection } from '@/app/navigation';

/**
 * Whether one navigation entry belongs in this user's menu.
 *
 * The single rule set for every menu in the shell — the sidebar, the mobile tab
 * bar and the account menu all run through it, so an entry's declared
 * permissions, plan feature and roles cannot be honoured in one place and
 * ignored in another. The API enforces the same rules; hiding here is a
 * courtesy, never the security boundary.
 */
export function useNavItemVisible(): (item: NavItem) => boolean {
  const { session, can, hasFeature } = useAuth();

  return React.useCallback(
    (item: NavItem) => {
      const roles = session?.user.roles ?? [];
      if (item.permissions && !can(...item.permissions)) return false;
      if (item.feature && !hasFeature(item.feature)) return false;
      if (item.roles && !item.roles.some((role) => roles.includes(role as RoleName))) {
        return false;
      }
      if (item.excludeRoles?.some((role) => roles.includes(role))) return false;
      /*
       * A personal seat is an organization, but not a business. Asking
       * `session.organization !== null` here would let every driver through,
       * because registration gives them one named after themselves.
       */
      if (item.requiresBusiness) {
        const organization = session?.organization;
        if (!organization || organization.isPersonalSeat) return false;
      }
      // And its mirror: an entry worded for one person is not for a business.
      if (item.personalOnly && !session?.organization?.isPersonalSeat) return false;
      // Simulator controls only exist while the server has demo mode on.
      if (item.to === '/simulator' && !session?.demoMode) return false;
      return true;
    },
    [session, can, hasFeature],
  );
}

/** Drop what the user cannot reach, then any section left empty by that. */
export function filterSections(
  sections: readonly NavSection[],
  isVisible: (item: NavItem) => boolean,
): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter(isVisible) }))
    .filter((section) => section.items.length > 0);
}

/** The account menu's groups, filtered like everything else. */
export function useVisibleAccountNavigation(): NavSection[] {
  const isVisible = useNavItemVisible();
  return React.useMemo(() => filterSections(ACCOUNT_NAVIGATION, isVisible), [isVisible]);
}
