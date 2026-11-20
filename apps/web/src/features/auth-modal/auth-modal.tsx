import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/common/states';
import { AuthSurfaceContext } from '@/features/auth/auth-card';
import { FestiveBand, FestiveWish } from '@/features/festive';
import { LanguageMenu, useT } from '@/features/i18n';
import { cn } from '@/lib/utils';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/pages/lazy-pages';
import { AuthStage } from './auth-stage';
import type { AuthView } from './auth-views';
import './auth-modal.css';

/**
 * Sign in, create an account and reset a password, in one modal over the page
 * the visitor is on (approved design, 2026-11-20).
 *
 * Desktop: a two-pane dialog, the brand panel beside the form. Phone: a sheet
 * from the bottom with the form alone. Closing animates out (auth-modal.css);
 * the view it showed stays on screen while it does.
 *
 * The forms are the existing auth screens, unchanged in what they ask and
 * validate; `AuthSurfaceContext` tells them the modal is their surface.
 */

type Tab = 'sign-in' | 'create-account';

const TAB_OF: Readonly<Record<AuthView, Tab>> = {
  'sign-in': 'sign-in',
  'create-account': 'create-account',
  'forgot-password': 'sign-in',
  'reset-password': 'sign-in',
};

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'sign-in', label: 'Sign in' },
  { value: 'create-account', label: 'Create account' },
];

/** The dialog's accessible name, per view. */
const TITLES: Readonly<Record<AuthView, string>> = {
  'sign-in': 'Sign in to Saarthi',
  'create-account': 'Create your account',
  'forgot-password': 'Reset your password',
  'reset-password': 'Choose a new password',
};

const VIEWS: Readonly<Record<AuthView, React.ComponentType>> = {
  'sign-in': LoginPage,
  'create-account': RegisterPage,
  'forgot-password': ForgotPasswordPage,
  'reset-password': ResetPasswordPage,
};

export function AuthModal({
  view,
  onShow,
  onClose,
}: {
  /** The view to show, or null to close. */
  view: AuthView | null;
  onShow: (view: AuthView) => void;
  onClose: () => void;
}) {
  const t = useT();
  const tabsId = React.useId();

  // Held while the modal animates out, so the closing frame still shows the
  // form it closed on rather than going blank.
  const [shown, setShown] = React.useState<AuthView>(view ?? 'sign-in');
  React.useEffect(() => {
    if (view) setShown(view);
  }, [view]);

  React.useEffect(() => {
    if (!view) return;
    LoginPage.preload();
    RegisterPage.preload();
    ForgotPasswordPage.preload();
  }, [view]);

  const tab = TAB_OF[shown];
  const View = VIEWS[shown];

  return (
    <DialogPrimitive.Root
      open={view !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="auth-scrim fixed inset-0 z-50 bg-black/60 backdrop-blur-[6px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'auth-modal fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-2.5rem)] flex-col rounded-t-[22px] bg-card text-card-foreground shadow-overlay outline-none',
            'md:inset-0 md:m-auto md:h-[min(720px,calc(100dvh-3rem))] md:w-[min(1040px,calc(100vw-3rem))] md:rounded-[22px]',
            'ring-1 ring-foreground/[0.06] dark:ring-white/[0.09]',
            'lg:grid lg:grid-cols-[340px_minmax(0,1fr)]',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t(TITLES[shown])}</DialogPrimitive.Title>

          {/* On a festival day, the garland hangs across the top edge. */}
          <FestiveBand className="pointer-events-none absolute inset-x-5 -top-3.5 z-10 !w-auto drop-shadow-[0_6px_10px_rgba(0,0,0,0.35)]" />

          <AuthStage />

          <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <span
              aria-hidden
              className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border md:hidden"
            />

            <header className="flex items-center gap-1.5 px-4 pt-3 sm:px-8 sm:pt-6 [html[data-festive]_&]:pt-10">
              <div
                role="tablist"
                aria-label={t('Account')}
                className="inline-flex gap-1 rounded-xl bg-secondary p-1 ring-1 ring-border"
              >
                {TABS.map((option) => {
                  const selected = tab === option.value;
                  return (
                    <button
                      key={option.value}
                      id={`${tabsId}-${option.value}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`${tabsId}-panel`}
                      onClick={() => onShow(option.value)}
                      className={cn(
                        'h-9 rounded-lg px-3.5 text-sm transition-colors sm:px-4',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'bg-card font-semibold text-foreground shadow-sm ring-1 ring-border'
                          : 'font-medium text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t(option.label)}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1" />
              <LanguageMenu />
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t('Close')} title={t('Close')}>
                  <X className="size-5" />
                </Button>
              </DialogPrimitive.Close>
            </header>

            <div
              id={`${tabsId}-panel`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-${tab}`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 sm:px-8"
              data-lenis-prevent
            >
              {/* The phone and tablet have no brand panel, so the wish sits
                  above the form instead. */}
              <FestiveWish tone="light" size="sm" className="mb-5 lg:hidden" />

              <AuthSurfaceContext.Provider value="modal">
                <React.Suspense fallback={<LoadingState className="min-h-[320px]" />}>
                  <div
                    key={shown}
                    className={cn(
                      'auth-view mx-auto w-full',
                      shown === 'create-account' ? 'max-w-2xl' : 'max-w-md',
                    )}
                  >
                    <View />
                  </div>
                </React.Suspense>
              </AuthSurfaceContext.Provider>
            </div>
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
