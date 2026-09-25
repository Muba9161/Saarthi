import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, LogOut, User as UserIcon, Wallet } from 'lucide-react';
import { canJoinReferralProgram, formatCurrency, humanizeEnum } from '@saarthi/shared';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/features/i18n';
import { MediaImage } from '@/features/media/media-image';
import { useWallet } from '@/features/wallet/use-wallet';
import { AnimatedNumber } from '@/components/motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useVisibleAccountNavigation } from './use-nav-visibility';

/**
 * The profile photograph, or a person glyph.
 *
 * Media like any other: fetched with the session token rather than referenced
 * by address, so it cannot be an `<img src>`. No `variant` is asked for — the
 * URL mirrored onto the user already names the rendition it wants.
 */
function UserAvatar({ className, iconClassName }: { className: string; iconClassName: string }) {
  const { session } = useAuth();
  const t = useT();
  const user = session?.user;

  return (
    <Avatar className={className}>
      <MediaImage
        source={user?.avatarUrl}
        alt={user?.fullName ?? t('Your profile photo')}
        className="aspect-square size-full object-cover"
        fallback={
          <AvatarFallback>
            <UserIcon className={iconClassName} aria-hidden />
          </AvatarFallback>
        }
      />
    </Avatar>
  );
}

/** Who is signed in, and as what: the person, their organization and role, and the plan. */
function ProfileCard() {
  const { session } = useAuth();
  const user = session?.user;
  const organization = session?.organization;
  const planName = session?.subscription?.planName;

  return (
    <div className="flex items-center gap-3 rounded-lg bg-gradient-to-br from-primary/10 via-primary/[0.04] to-transparent p-3 ring-1 ring-primary/10">
      <UserAvatar className="size-12 shrink-0 ring-2 ring-background" iconClassName="size-5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{user?.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        {organization && !organization.isPersonalSeat ? (
          <p className="truncate text-2xs text-muted-foreground">
            {organization.name} · {humanizeEnum(organization.membershipRole)}
          </p>
        ) : null}
        {planName ? (
          <Badge variant="secondary" size="sm" className="mt-1.5">
            {planName}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The wallet at a glance, linking to where its rewards come from — Refer & earn,
 * or a salesperson's Earnings.
 *
 * Rendered inside the open menu only, so the wallet is fetched when the menu
 * is opened rather than on every screen. A real menu item, so it is reachable
 * with the arrow keys like the rest.
 */
function WalletStrip({ to }: { to: string }) {
  const wallet = useWallet();
  const data = wallet.data;

  return (
    <DropdownMenuItem
      asChild
      // Radix highlights an item on hover as well as on keyboard focus, and the
      // shared item style turns it muted with dark text. On this brand card that
      // read as washed out, so the highlight is restyled for the card instead:
      // white text kept, a touch brighter, lifted, with a thin inner edge.
      className="mt-2 p-0 transition-[filter,box-shadow] duration-200 focus:bg-transparent focus:text-white data-[highlighted]:shadow-md data-[highlighted]:ring-1 data-[highlighted]:ring-inset data-[highlighted]:ring-white/40 data-[highlighted]:brightness-110"
    >
      <Link
        to={to}
        className="group relative flex items-center gap-3 overflow-hidden rounded-lg bg-brand-gradient p-3 text-white shadow-sm"
      >
        <span
          className="pointer-events-none absolute -right-6 -top-8 size-24 rounded-full bg-white/15 blur-2xl"
          aria-hidden
        />
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Wallet className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-2xs font-medium uppercase tracking-wider opacity-80">
            Wallet balance
          </span>
          {data ? (
            <>
              <AnimatedNumber
                value={data.available}
                format={(value) => formatCurrency(Math.round(value))}
                className="block text-lg font-semibold tabular-nums leading-tight"
              />
              {data.held > 0 ? (
                <span className="block text-2xs opacity-80">
                  +{formatCurrency(data.held)} unlocking soon
                </span>
              ) : null}
            </>
          ) : wallet.isLoading ? (
            <Skeleton className="mt-1 h-5 w-20 bg-white/25" />
          ) : (
            <span className="block text-sm opacity-90">Open your wallet</span>
          )}
        </span>
        <ChevronRight
          className="size-4 shrink-0 opacity-70 transition-transform duration-200 group-hover:translate-x-0.5 group-focus:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </DropdownMenuItem>
  );
}

/**
 * The profile menu in the top bar — the one home of account navigation.
 *
 * Opens on a profile card and the wallet balance; then the groups — Account, Business, Security and Legal — each shown
 * only when it has something this user can open. Items are real links, so they
 * can be opened in a new tab and read as links to assistive technology, and
 * Radix supplies the keyboard model (arrow keys, type-ahead, Escape).
 *
 * The content scrolls within the space Radix measures below the trigger, so on
 * a short phone screen the lower groups and Sign out stay reachable.
 */
export function AccountMenu(): React.ReactElement {
  const { session, logout } = useAuth();
  const sections = useVisibleAccountNavigation();
  const t = useT();
  // Everybody has a wallet: Refer & Earn pays into it, and so does a
  // salesperson's every successful referral.
  const walletHome = canJoinReferralProgram(session?.user.roles ?? [])
    ? '/referrals'
    : '/sales/earnings';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t('Account menu')}>
          <UserAvatar className="size-8 ring-1 ring-border" iconClassName="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 overflow-y-auto"
      >
        <div className="p-1">
          <ProfileCard />
          <WalletStrip to={walletHome} />
        </div>

        {sections.map((section) => (
          <React.Fragment key={section.title}>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label={t(section.title)}>
              <DropdownMenuLabel className="pb-1 pt-2 text-2xs">{t(section.title)}</DropdownMenuLabel>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem key={item.to} asChild>
                    <Link to={item.to}>
                      <Icon className="size-4" aria-hidden />
                      <span className="truncate">{t(item.label)}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void logout()}>
          <LogOut className="size-4" aria-hidden />
          {t('Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
