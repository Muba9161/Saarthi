import * as React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Store,
  Building2,
  ChevronsUpDown,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Sun,
  User as UserIcon,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  OrganizationType,
  Permission,
  RealtimeEvent,
  initialsOf,
  type RoleName,
} from '@saarthi/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/features/theme/theme-context';
import { useRealtime, useRealtimeEvent } from '@/hooks/use-realtime';
import {
  ACCOUNT_NAVIGATION,
  ADMIN_NAVIGATION,
  ASSOCIATION_NAVIGATION,
  CUSTOMER_NAVIGATION,
  DRIVER_NAVIGATION,
  FLEET_NAVIGATION,
  MOBILITY_NAVIGATION,
  SUPPLIER_NAVIGATION,
  type NavItem,
  type NavSection,
} from '@/app/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LoadingState } from '@/components/common/states';
import { SaarthiLogo } from '@/components/common/logo';
import { AnimatePresence, PageTransition, motion } from '@/components/motion';

/**
 * The signed-in shell.
 *
 * Layout: a glass command rail on desktop (collapsible to icons), a frosted
 * top bar, and a bottom tab bar on mobile so the primary destinations stay
 * reachable with a thumb. Navigation is filtered by permission, plan feature
 * and role — the API enforces the same rules, so this is convenience, not
 * security.
 */

interface NavBadges {
  sos: number;
  verification: number;
  notifications: number;
  expiringDocuments: number;
}

const SIDEBAR_STORAGE_KEY = 'saarthi.sidebar.collapsed';

function navigationFor(
  organizationType: OrganizationType | undefined,
  isDriver: boolean,
  isPlatformAdmin: boolean,
): NavSection[] {
  if (isDriver) return DRIVER_NAVIGATION;

  const base = (() => {
    switch (organizationType) {
      case OrganizationType.SUPPLIER:
        return SUPPLIER_NAVIGATION;
      case OrganizationType.CUSTOMER:
        return CUSTOMER_NAVIGATION;
      case OrganizationType.TRUCK_ASSOCIATION:
        return ASSOCIATION_NAVIGATION;
      case OrganizationType.MOBILITY_PROVIDER:
        return MOBILITY_NAVIGATION;
      case OrganizationType.PLATFORM:
        return [];
      default:
        return FLEET_NAVIGATION;
    }
  })();

  return isPlatformAdmin ? [...base, ...ADMIN_NAVIGATION] : base;
}

function useNavBadges(): NavBadges {
  const { can, session } = useAuth();
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unreadCount: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const sos = useQuery({
    queryKey: ['sos', 'active-count'],
    queryFn: () =>
      api.get<{ pagination: { total: number } }>('/sos', { activeOnly: true, pageSize: 1 }),
    enabled: can('sos.read'),
    refetchInterval: 30_000,
  });

  const verification = useQuery({
    queryKey: ['verification', 'pending-count'],
    queryFn: () =>
      api.get<{ pagination: { total: number } }>('/verification', {
        status: 'SUBMITTED,UNDER_REVIEW',
        pageSize: 1,
      }),
    enabled: can('verification.review'),
    refetchInterval: 60_000,
  });

  const documents = useQuery({
    queryKey: ['documents', 'expiring-count'],
    queryFn: () => api.get<unknown[]>('/documents/expiring', { withinDays: 30 }),
    enabled: can('documents.read') && Boolean(session?.organization),
    refetchInterval: 5 * 60_000,
  });

  // A pushed event invalidates the badge immediately rather than waiting for
  // the next poll.
  useRealtimeEvent(RealtimeEvent.NOTIFICATION, () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });
  useRealtimeEvent(RealtimeEvent.SOS_TRIGGERED, () => {
    void queryClient.invalidateQueries({ queryKey: ['sos'] });
  });

  return {
    notifications: notifications.data?.unreadCount ?? 0,
    sos: sos.data?.pagination.total ?? 0,
    verification: verification.data?.pagination.total ?? 0,
    expiringDocuments: Array.isArray(documents.data) ? documents.data.length : 0,
  };
}

/** Navigation the signed-in user can actually reach. */
function useVisibleNavigation(): NavSection[] {
  const { session, can, hasFeature, isDriver, isPlatformAdmin } = useAuth();

  return React.useMemo(() => {
    const sections = navigationFor(session?.organization?.type, isDriver, isPlatformAdmin);

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (item.permissions && !can(...item.permissions)) return false;
          if (item.feature && !hasFeature(item.feature)) return false;
          if (
            item.roles &&
            !item.roles.some((role) => session?.user.roles.includes(role as RoleName))
          ) {
            return false;
          }
          // Simulator controls only exist while the server has demo mode on.
          if (item.to === '/simulator' && !session?.demoMode) return false;
          return true;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [session, can, hasFeature, isDriver, isPlatformAdmin]);
}

function NavLinkItem({
  item,
  badges,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  badges: NavBadges;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const count = item.badgeKey ? badges[item.badgeKey] : 0;
  const Icon = item.icon;

  const link = (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200',
          'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          collapsed && 'justify-center px-0',
          isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Active marker rides between items rather than popping in. */}
          {isActive ? (
            <motion.span
              layoutId="nav-active-rail"
              className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-sidebar-highlight"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          ) : null}

          <Icon
            className={cn(
              'size-4 shrink-0 transition-transform duration-200 group-hover:scale-110',
              isActive && 'text-sidebar-highlight',
            )}
          />

          {!collapsed ? <span className="truncate">{item.label}</span> : null}

          {count > 0 ? (
            collapsed ? (
              <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" />
            ) : (
              <Badge
                variant={item.badgeKey === 'sos' ? 'destructive' : 'default'}
                size="sm"
                className="ml-auto tabular"
              >
                {count > 99 ? '99+' : count}
              </Badge>
            )
          ) : null}
        </>
      )}
    </NavLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="font-medium">
        {item.label}
        {count > 0 ? ` (${count})` : ''}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarContent({
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const { session } = useAuth();
  const badges = useNavBadges();
  const sections = useVisibleNavigation();

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-sidebar">
      {/* Ambient wash so the glass elements above it have something to refract. */}
      <div
        className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-sidebar-highlight/20 blur-3xl"
        aria-hidden
      />

      <div
        className={cn(
          'relative flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <SaarthiLogo className="size-7 shrink-0" />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
              Saarthi
            </p>
            {/* The active organization, so a multi-org account always knows
                which tenant it is looking at. */}
            <p className="truncate text-2xs text-sidebar-muted">
              {session?.organization?.name ?? 'Fleet Operations'}
            </p>
          </div>
        ) : null}
        {onToggleCollapse && !collapsed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapse}
            className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Collapse navigation"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        ) : null}
      </div>

      <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 py-4 scrollbar-none">
        {sections.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed ? (
              <p className="px-3 pb-1 text-2xs font-semibold uppercase tracking-[0.08em] text-sidebar-muted">
                {section.title}
              </p>
            ) : (
              <Separator className="my-2 bg-sidebar-border" />
            )}
            {section.items.map((item) => (
              <NavLinkItem
                key={item.to}
                item={item}
                badges={badges}
                {...(collapsed ? { collapsed } : {})}
                {...(onNavigate ? { onNavigate } : {})}
              />
            ))}
          </div>
        ))}

        <Separator className="bg-sidebar-border" />

        <div className="space-y-1">
          {ACCOUNT_NAVIGATION.map((item) => (
            <NavLinkItem
              key={item.to}
              item={item}
              badges={badges}
              {...(collapsed ? { collapsed } : {})}
              {...(onNavigate ? { onNavigate } : {})}
            />
          ))}
        </div>
      </nav>

      {collapsed && onToggleCollapse ? (
        <div className="relative border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="w-full text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Expand navigation"
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        </div>
      ) : (
        <PlanFooter />
      )}
    </div>
  );
}

function PlanFooter() {
  const { session } = useAuth();
  const subscription = session?.subscription;
  if (!subscription) return null;

  return (
    <div className="relative shrink-0 border-t border-sidebar-border p-3">
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.04] p-3 backdrop-blur">
        <p className="text-2xs uppercase tracking-[0.08em] text-sidebar-muted">Current plan</p>
        <p className="truncate text-sm font-medium text-sidebar-foreground">
          {subscription.planName}
        </p>
        {session?.demoMode ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-accent">
            <Radio className="size-3" />
            Demo mode — simulated GPS
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OrganizationSwitcher() {
  const { session, switchOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [switching, setSwitching] = React.useState(false);

  const organizations = session?.organizations ?? [];

  if (!session?.organization) return null;

  if (organizations.length <= 1) {
    return (
      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{session.organization.name}</span>
      </div>
    );
  }

  const handleSwitch = async (organizationId: string): Promise<void> => {
    if (organizationId === session.organization?.id) return;
    setSwitching(true);
    try {
      await switchOrganization(organizationId);
      // The cache is tenant-scoped; drop it rather than risk showing stale data.
      queryClient.clear();
      toast.success('Switched organization');
    } catch {
      toast.error('Could not switch organization');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-40 gap-2 sm:max-w-56"
          disabled={switching}
        >
          <Building2 className="size-4 shrink-0" />
          <span className="truncate">{session.organization.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            onSelect={() => void handleSwitch(organization.id)}
            className={cn(organization.id === session.organization?.id && 'bg-secondary')}
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{organization.name}</p>
              <p className="truncate text-2xs text-muted-foreground">
                {organization.membershipRole.replace(/_/g, ' ').toLowerCase()}
              </p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionIndicator() {
  const { connected } = useRealtime();

  return (
    <span
      className={cn(
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors sm:inline-flex',
        connected
          ? 'border-success/25 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground',
      )}
      title={connected ? 'Live updates connected' : 'Reconnecting to live updates…'}
    >
      {connected ? (
        <>
          <span className="live-dot" />
          <Wifi className="size-3" />
          Live
        </>
      ) : (
        <>
          <WifiOff className="size-3" />
          Offline
        </>
      )}
    </span>
  );
}

function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { session, logout, isDriver, can } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const badges = useNavBadges();
  const user = session?.user;

  return (
    <header className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 px-4 shadow-none">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenNav}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <OrganizationSwitcher />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ConnectionIndicator />

        {/*
          The resale marketplace is a destination rather than a section of any
          one account's workspace — a fleet browses it to buy and to sell — so
          it sits in the top bar next to the live indicator instead of inside a
          navigation group.
        */}
        {can(Permission.RESALE_BROWSE) ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/marketplace/vehicles')}
            aria-label="Vehicle marketplace"
            title="Vehicles for sale"
          >
            <Store className="size-5" />
          </Button>
        ) : null}

        {isDriver ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() => navigate('/driver/sos')}
          >
            <LifeBuoy className="size-4" />
            SOS
          </Button>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/notifications')}
          aria-label={`Notifications${badges.notifications > 0 ? ` (${badges.notifications} unread)` : ''}`}
          className="relative"
        >
          <Bell className="size-5" />
          {badges.notifications > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
          ) : null}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={resolvedTheme}
              initial={{ opacity: 0, rotate: -80, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, rotate: 80, scale: 0.7 }}
              transition={{ duration: 0.22 }}
              className="flex"
            >
              {resolvedTheme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </motion.span>
          </AnimatePresence>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
              <Avatar className="size-8 ring-1 ring-border">
                <AvatarFallback>{initialsOf(user?.firstName, user?.lastName)}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium">{user?.fullName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/settings')}>
              <UserIcon className="size-4" />
              Profile &amp; settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => void logout()}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/** Thumb-reachable tabs on mobile — the five most-used destinations. */
function MobileTabBar() {
  const sections = useVisibleNavigation();
  const badges = useNavBadges();
  const { isDriver } = useAuth();

  const items = React.useMemo(
    () => sections.flatMap((section) => section.items).slice(0, isDriver ? 4 : 5),
    [sections, isDriver],
  );

  if (items.length === 0) return null;

  return (
    <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-30 flex rounded-none border-x-0 border-b-0 lg:hidden">
      {items.map((item) => {
        const count = item.badgeKey ? badges[item.badgeKey] : 0;
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end ?? false}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-1 py-2.5 text-2xs transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId="mobile-tab-active"
                    className="absolute inset-x-4 top-0 h-0.5 rounded-b-full bg-primary"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                ) : null}
                <span className="relative">
                  <Icon className="size-5" />
                  {count > 0 ? (
                    <span className="absolute -right-1.5 -top-1 size-2 rounded-full bg-destructive" />
                  ) : null}
                </span>
                <span className="max-w-full truncate px-1">{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Surfaces critical pushes wherever the user happens to be. */
function CriticalAlerts() {
  const navigate = useNavigate();

  useRealtimeEvent(RealtimeEvent.SOS_TRIGGERED, (message) => {
    toast.error('SOS raised', {
      description: message.payload.description ?? `${message.payload.type} emergency reported.`,
      duration: 30_000,
      action: { label: 'Open', onClick: () => navigate(`/sos/${message.payload.incidentId}`) },
    });
  });

  useRealtimeEvent(RealtimeEvent.SOS_RESPONDER_REQUEST, (message) => {
    toast.warning('A driver nearby needs help', {
      description: `${message.payload.distanceKm.toFixed(1)} km away — ${message.payload.incidentType.toLowerCase()}.`,
      duration: 60_000,
      action: {
        label: 'Respond',
        onClick: () => navigate(`/driver/sos/${message.payload.incidentId}`),
      },
    });
  });

  useRealtimeEvent(RealtimeEvent.NOTIFICATION, (message) => {
    if (message.payload.priority === 'CRITICAL' || message.payload.priority === 'HIGH') {
      toast(message.payload.title, { description: message.payload.body });
    }
  });

  return null;
}

export function AppShell() {
  const { status } = useAuth();
  const [navOpen, setNavOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(
    () => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true',
  );
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => setNavOpen(false), [location.pathname]);

  const toggleCollapse = React.useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  if (status === 'loading') {
    return <LoadingState label="Restoring your session…" className="min-h-screen" />;
  }

  return (
    <div className="relative flex h-full bg-canvas">
      <div className="glass-backdrop" aria-hidden />

      <motion.aside
        className="hidden shrink-0 border-r border-sidebar-border lg:block"
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <SidebarContent
          {...(collapsed ? { collapsed } : {})}
          onToggleCollapse={toggleCollapse}
        />
      </motion.aside>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-72 border-0 p-0">
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <CriticalAlerts />

        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
            <PageTransition key={location.pathname}>
              <Outlet />
            </PageTransition>
          </div>
        </main>

        <MobileTabBar />
      </div>
    </div>
  );
}
