import { Link, Outlet, useLocation } from 'react-router-dom';
import { Banknote, FileText, Fuel, Receipt } from 'lucide-react';
import { Feature, Permission } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/features/i18n';
import { cn } from '@/lib/utils';

/**
 * One destination for the four fleet-wide roll-ups.
 *
 * Documents, fuel, EMIs and toll each had a row of their own in the sidebar,
 * which put four entries there for records that are also on every vehicle's own
 * page. They are still four separate screens — each answers a different
 * question, and none of them can be assembled from a single vehicle — so
 * nothing was merged or deleted. What changed is that the menu now offers them
 * as one entry and the switch between them happens here.
 *
 * These are real routes, not tab state: `/fleet/fuel` still opens fuel
 * directly, so the dashboard's links, the API's notification `actionUrl`s and
 * anything a user has bookmarked keep working untouched. The strip is built
 * from `Link`s for the same reason.
 *
 * Each tab is gated on exactly what its sidebar entry used to require, so a
 * plan or a role that could not reach a screen is not offered a tab that lands
 * on a locked one. A viewer with only one of the four sees no strip at all —
 * there is nothing to switch between.
 */

interface CostTab {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

export function RunningCostsTabs() {
  const { can, hasFeature } = useAuth();
  const { pathname } = useLocation();
  const t = useT();

  const tabs: CostTab[] = [
    {
      label: 'Documents',
      to: '/fleet/documents',
      icon: FileText,
      visible: can(Permission.DOCUMENTS_READ),
    },
    {
      label: 'Fuel',
      to: '/fleet/fuel',
      icon: Fuel,
      visible: can(Permission.FUEL_READ),
    },
    {
      label: 'Loans & EMI',
      to: '/fleet/loans',
      icon: Banknote,
      visible: can(Permission.LOANS_READ) && hasFeature(Feature.FINANCE_LOANS),
    },
    {
      label: 'Toll & FASTag',
      to: '/fleet/toll',
      icon: Receipt,
      visible: can(Permission.TOLL_READ) && hasFeature(Feature.TOLL_FASTAG),
    },
  ];

  const available = tabs.filter((tab) => tab.visible);

  return (
    <div className="space-y-5">
      {available.length > 1 ? (
        // Same visual language as the Radix strip used on the vehicle passport,
        // built from links rather than triggers so each tab keeps its own URL.
        <div
          className={cn(
            'inline-flex h-9 max-w-full items-center justify-start gap-1 rounded-lg bg-muted p-1',
            'overflow-x-auto text-muted-foreground scrollbar-none',
          )}
        >
          {available.map((tab) => {
            const isActive = pathname === tab.to;
            const Icon = tab.icon;

            return (
              <Link
                key={tab.to}
                to={tab.to}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1',
                  'text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  '[&_svg]:size-4',
                  isActive
                    ? 'bg-card text-foreground shadow-sm'
                    : 'hover:text-foreground',
                )}
              >
                <Icon />
                {t(tab.label)}
              </Link>
            );
          })}
        </div>
      ) : null}

      <Outlet />
    </div>
  );
}

export default RunningCostsTabs;
