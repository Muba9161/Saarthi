import type * as React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, Bot, MapPin, Moon, ShieldCheck, Sun, Truck } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { SaarthiWordmark } from '@/components/common/logo';
import { LoadingState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import {
  AnimatePresence,
  Stagger,
  StaggerItem,
  motion,
  useReducedMotion,
} from '@/components/motion';
import { LanguageMenu, useT } from '@/features/i18n';
import { useTheme } from '@/features/theme/theme-context';
import { cn } from '@/lib/utils';

const HIGHLIGHTS = [
  {
    icon: Truck,
    title: 'One fleet command centre',
    body: 'Trucks, drivers, documents, orders and trips in a single operational view.',
  },
  {
    icon: MapPin,
    title: 'Live tracking that actually moves',
    body: 'Realtime positions, ETAs and route deviation alerts as they happen.',
  },
  {
    icon: ShieldCheck,
    title: 'Driver safety network',
    body: 'One-tap SOS reaches nearby Saarthi trucks in expanding rings.',
  },
  {
    icon: Bot,
    title: 'AI grounded in your data',
    body: 'Answers built only from records your role is allowed to see.',
  },
] as const;

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The theme control, repeated here rather than lifted out of the app shell.
 *
 * Nobody has signed in yet, so the shell — and its header — does not exist.
 * Someone arriving on a phone at night still has to be able to turn the lights
 * down before reading a form, and the choice carries into the session they are
 * about to start.
 */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label={t('Switch theme')}
      title={t('Switch theme')}
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
  );
}

/**
 * What sits behind the brand panel.
 *
 * Three layers, in the order a scene is lit: a faint dot field for texture,
 * two slow-drifting colour washes so the frosted tiles have something to
 * refract, and a route line — the one piece of decoration that says what this
 * product is for rather than simply being pretty.
 *
 * Everything here stops moving under `prefers-reduced-motion`; none of it
 * carries information, so freezing it costs nothing.
 */
function BrandBackdrop() {
  const reduced = useReducedMotion();

  const washes = [
    {
      key: 'primary',
      className: '-left-40 top-0 size-[38rem] bg-primary/35',
      animate: { x: [0, 50, 0], y: [0, -36, 0] },
      duration: 19,
    },
    {
      key: 'accent',
      className: '-bottom-48 -right-24 size-[30rem] bg-accent/25',
      animate: { x: [0, -36, 0], y: [0, 28, 0] },
      duration: 25,
    },
  ];

  return (
    <>
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px)',
          backgroundSize: '48px 48px, 64px 64px',
        }}
        aria-hidden
      />

      {washes.map((wash) => (
        <motion.div
          key={wash.key}
          className={cn('pointer-events-none absolute rounded-full blur-[140px]', wash.className)}
          aria-hidden
          {...(reduced
            ? {}
            : {
                animate: wash.animate,
                transition: { duration: wash.duration, repeat: Infinity, ease: 'easeInOut' },
              })}
        />
      ))}

      {/* The route. A dashed line whose dashes travel, so it reads as a road
          being covered rather than as a squiggle. */}
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        viewBox="0 0 600 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="auth-route" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="35%" stopColor="hsl(var(--sidebar-highlight))" stopOpacity="0.55" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <motion.path
          d="M-40 760 C 130 700, 150 520, 300 470 S 470 380, 520 190 S 560 60, 660 -20"
          stroke="url(#auth-route)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="5 11"
          {...(reduced
            ? {}
            : {
                animate: { strokeDashoffset: [0, -64] },
                transition: { duration: 3.6, repeat: Infinity, ease: 'linear' },
              })}
        />
      </svg>

      {/* Grounds the panel so the washes do not wander into the bottom edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-sidebar to-transparent"
        aria-hidden
      />
    </>
  );
}

/** One feature. Icon left, so four of them scan as a list rather than a wall. */
function HighlightTile({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  const t = useT();

  return (
    <div
      className={cn(
        'group relative h-full overflow-hidden rounded-2xl p-4',
        'border border-white/[0.09] bg-gradient-to-br from-white/[0.08] to-white/[0.02]',
        'backdrop-blur-md transition-all duration-300 ease-smooth',
        'hover:-translate-y-0.5 hover:border-white/20 hover:from-white/[0.13] hover:to-white/[0.04]',
      )}
    >
      {/* Corner light, brightening on hover. */}
      <span
        className="pointer-events-none absolute -left-8 -top-8 size-24 rounded-full bg-sidebar-highlight/20 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden
      />

      <div className="relative flex gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] ring-1 ring-inset ring-white/10 transition-colors duration-300 group-hover:bg-white/[0.14]">
          <Icon className="size-4 text-accent" />
        </span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold leading-snug text-sidebar-foreground">{t(title)}</p>
          <p className="text-xs leading-relaxed text-sidebar-muted">{t(body)}</p>
        </div>
      </div>
    </div>
  );
}

export function AuthLayout() {
  const { status } = useAuth();
  const { pathname } = useLocation();
  const t = useT();

  /**
   * Sign-in is two fields and reads best in a narrow column. Registration is a
   * step wizard whose rail needs room beside the fields, so that one route
   * gets a wider column rather than squeezing the rail into 24rem.
   */
  const wide = pathname.startsWith('/register');

  if (status === 'loading') {
    return <LoadingState label={t('Loading Saarthi…')} className="min-h-screen" />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <div
      className={cn(
        'grid min-h-dvh grid-cols-1 bg-background',
        wide
          ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,46rem)]'
          : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]',
      )}
    >
      {/* --- Brand panel -----------------------------------------------------
          Hidden below `lg`, where the form needs every pixel; its job is done
          at those widths by the compact strip inside the form column.

          Sticky and exactly one viewport tall, so the registration wizard —
          which is taller than the screen — scrolls past a panel that stays
          put instead of dragging a half-metre of empty navy along with it. */}
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col xl:p-14">
        <BrandBackdrop />

        {/* One centred column at every width. Without it the copy stretches to
            whatever the viewport allows and the panel reads as three
            unrelated things pinned to a dark rectangle. */}
        <div className="relative z-[1] mx-auto flex w-full max-w-xl flex-1 flex-col">
          <div className="shrink-0">
            <Link
              to="/"
              className="inline-block rounded-lg transition-opacity duration-200 hover:opacity-90"
            >
              <SaarthiWordmark
                onDark
                className="[&_p:first-child]:text-sidebar-foreground [&_p:last-child]:text-sidebar-muted"
              />
            </Link>
          </div>

          <Stagger className="flex flex-1 flex-col justify-center gap-8 py-10">
            <StaggerItem className="space-y-4">
              <h2 className="max-w-lg text-[1.75rem] font-semibold leading-[1.15] tracking-tight text-sidebar-foreground xl:text-4xl">
                {t('The operating system for your trucking business.')}
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-sidebar-muted">
                {t(
                  'Saarthi connects fleet owners, drivers, suppliers and customers on one platform — from posting a load to watching it arrive.',
                )}
              </p>
            </StaggerItem>

            {/* Two columns once there is room for them: four full-width rows
                read as a stack of grey bars, a 2×2 reads as a product. */}
            <ul className="grid gap-3 xl:grid-cols-2">
              {HIGHLIGHTS.map((highlight) => (
                <StaggerItem as="li" key={highlight.title}>
                  <HighlightTile {...highlight} />
                </StaggerItem>
              ))}
            </ul>
          </Stagger>

          <div className="shrink-0 border-t border-white/[0.08] pt-5">
            <p className="text-2xs leading-relaxed text-sidebar-muted">
              {t('Local development build — simulated GPS, mock payments, local document storage.')}
            </p>
          </div>
        </div>
      </aside>

      {/* --- Form column ------------------------------------------------------ */}
      <main className="relative flex min-h-dvh flex-col overflow-hidden">
        <div className="glass-backdrop" aria-hidden />

        <header className="relative flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="rounded-lg transition-opacity duration-200 hover:opacity-80 lg:hidden"
          >
            <SaarthiWordmark className="[&_p:first-child]:text-base" />
          </Link>
          {/* A control, not a bare link — the same shape the secondary action
              at the foot of each form takes, so "leave" reads the same
              wherever it appears. */}
          <Button variant="outline" size="sm" className="hidden lg:inline-flex" asChild>
            <Link to="/">
              <ArrowLeft className="size-3.5" />
              {t('Back to saarthi.com')}
            </Link>
          </Button>

          {/* Language before theme, and on every screen: the first step of
              registration is choosing a language, and somebody who cannot read
              the form needs this control before they reach it. */}
          <div className="flex shrink-0 items-center gap-0.5">
            <LanguageMenu />
            <ThemeToggle />
          </div>
        </header>

        <div className="relative px-5 pb-1 sm:px-8 lg:hidden">
          <p className="text-sm font-medium leading-snug">
            {t('The operating system for your trucking business.')}
          </p>
          <ul className="fade-edge-r -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none">
            {HIGHLIGHTS.map((highlight) => (
              <li
                key={highlight.title}
                className="glass flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1"
              >
                <highlight.icon className="size-3 text-primary" aria-hidden />
                <span className="whitespace-nowrap text-2xs font-medium">{t(highlight.title)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex flex-1 items-center justify-center px-5 py-6 sm:px-8 sm:py-8">
          {/* Keyed on the route so moving between sign-in, registration and
              password reset animates rather than snapping. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE }}
              className={cn('w-full', wide ? 'max-w-3xl' : 'max-w-md')}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>

        <footer className="relative px-5 pb-6 text-center sm:px-8">
          <p className="text-2xs text-muted-foreground">
            © {new Date().getFullYear()} VorldX Saarthi
          </p>
        </footer>
      </main>
    </div>
  );
}
