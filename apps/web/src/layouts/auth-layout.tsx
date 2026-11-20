import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { AUTH_HIGHLIGHTS, BrandBackdrop, HighlightTile } from '@/features/auth/auth-brand';
import { SaarthiWordmark } from '@/components/common/logo';
import { SplashScreen } from '@/components/common/splash';
import { Button } from '@/components/ui/button';
import { AnimatePresence, Stagger, StaggerItem, motion } from '@/components/motion';
import { LanguageMenu, useT } from '@/features/i18n';
import { LEGAL_LINKS } from '@/features/legal/legal-links';
import { AppearanceMenu } from '@/features/theme/appearance-menu';
import { usePreloadWhenIdle } from '@/lib/lazy-with-preload';
import { LandingPage } from '@/pages/lazy-pages';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Where "Back to vorldxsaarthi.com" goes; fetched while the form is being filled. */
const NEXT_PAGES = [LandingPage];

/**
 * The full-page frame for flows that are not the sign-in modal: today, a
 * Saarthi Rahi joining with their GODID (`/sales/join`). Sign-in,
 * registration and password reset open as a modal over the page instead
 * (`features/auth-modal`); this keeps the same brand panel so the two read as
 * one product.
 */
export function AuthLayout() {
  const { status } = useAuth();
  const { pathname } = useLocation();
  const t = useT();
  usePreloadWhenIdle(NEXT_PAGES);

  if (status === 'loading') {
    return <SplashScreen label={t('Loading Saarthi…')} />;
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
      {/* --- Brand panel -----------------------------------------------------
          Hidden below `lg`, where the form needs every pixel; its job is done
          at those widths by the compact strip inside the form column.

          Sticky and exactly one viewport tall, so a form taller than the
          screen scrolls past a panel that stays put. */}
      <aside className="relative hidden overflow-hidden bg-sidebar p-10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col xl:p-14">
        <BrandBackdrop />

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
                {t('The operating system for everything you move.')}
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-sidebar-muted">
                {t(
                  'Saarthi connects fleet owners, drivers, sellers and customers on one platform - from posting a load to watching it arrive.',
                )}
              </p>
            </StaggerItem>

            {/* Two columns once there is room for them: four full-width rows
                read as a stack of grey bars, a 2×2 reads as a product. */}
            <ul className="grid gap-3 xl:grid-cols-2">
              {AUTH_HIGHLIGHTS.map((highlight) => (
                <StaggerItem as="li" key={highlight.title}>
                  <HighlightTile {...highlight} />
                </StaggerItem>
              ))}
            </ul>
          </Stagger>

          <div className="shrink-0 border-t border-white/[0.08] pt-5">
            <p className="text-2xs leading-relaxed text-sidebar-muted">
              {t('Local development build - simulated GPS, mock payments, local document storage.')}
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
          {/* A control, not a bare link: the same shape the secondary action
              at the foot of each form takes, so "leave" reads the same
              wherever it appears. */}
          <Button variant="outline" size="sm" className="hidden lg:inline-flex" asChild>
            <Link to="/">
              <ArrowLeft className="size-3.5" />
              {t('Back to vorldxsaarthi.com')}
            </Link>
          </Button>

          {/* Language before appearance, and on every screen: somebody who
              cannot read the form needs this control before they reach it. */}
          <div className="flex shrink-0 items-center gap-0.5">
            <LanguageMenu />
            <AppearanceMenu />
          </div>
        </header>

        <div className="relative px-5 pb-1 sm:px-8 lg:hidden">
          <p className="text-sm font-medium leading-snug">
            {t('The operating system for everything you move.')}
          </p>
          <ul className="fade-edge-r -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none">
            {AUTH_HIGHLIGHTS.map((highlight) => (
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="w-full max-w-md"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* The legal documents belong on this screen and not only in the
            marketing footer: joining is where somebody agrees to them. */}
        <footer className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-5 pb-6 text-center sm:px-8">
          <p className="text-2xs text-muted-foreground">
            © {new Date().getFullYear()} VorldX Saarthi
          </p>
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-2xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t(link.label)}
            </Link>
          ))}
        </footer>
      </main>
    </div>
  );
}
