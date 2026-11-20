import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { AnimatePresence, motion } from '@/components/motion';
import { useAuth } from '@/features/auth/auth-context';
import { FestiveWish, setFestiveLooks, useFestive } from '@/features/festive';
import { useLocale } from '@/features/i18n/locale-context';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useTheme } from './theme-context';

/**
 * Appearance: light, dark or the device's choice, and Festive looks.
 *
 * The one theme control there already was (a sun/moon button in each header)
 * grown into a small panel, rather than a second control beside it. The same
 * component serves the app header, the public site and the sign-in screens.
 *
 * Festive looks changes at once and is remembered on this device. Signed in,
 * it is also written to the account, so the web and the apps agree; if that
 * write fails the switch goes back, as in the apps, because the account's
 * value would otherwise quietly undo it at the next sign-in.
 */

type ThemeChoice = 'light' | 'dark' | 'system';

const THEMES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function AppearanceMenu({
  triggerClassName,
  align = 'end',
}: {
  triggerClassName?: string;
  align?: 'start' | 'center' | 'end';
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { status } = useAuth();
  const { t, locale } = useLocale();
  const festive = useFestive();
  const switchId = React.useId();

  const changeFestive = (on: boolean) => {
    setFestiveLooks(on);
    if (status !== 'authenticated') return;
    api.patch('/profile/me', { preferences: { festiveLooks: on } }).catch(() => {
      setFestiveLooks(!on);
      toast.error(t('Festive looks could not be saved to your account. Try again.'));
    });
  };

  const until =
    festive.active && festive.window
      ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
          new Date(`${festive.window.end}T12:00:00`),
        )
      : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('Appearance')}
          title={t('Appearance')}
          className={triggerClassName}
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
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 space-y-4">
        <div className="space-y-2.5">
          <p className="section-label text-muted-foreground">{t('Appearance')}</p>
          <div
            role="radiogroup"
            aria-label={t('Theme')}
            className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1"
          >
            {THEMES.map((option) => {
              const selected = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'h-9 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
        </div>

        <div className="flex items-start gap-3 border-t border-border pt-4">
          <div className="min-w-0 flex-1">
            <label htmlFor={switchId} className="text-sm font-semibold">
              {t('Festive looks')}
            </label>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('Garland, greeting and colours on festival days.')}
            </p>
          </div>
          <Switch id={switchId} checked={festive.on} onCheckedChange={changeFestive} />
        </div>

        {festive.active ? (
          <div className="flex items-center gap-2 rounded-lg bg-secondary/70 px-3 py-2">
            <FestiveWish
              tone="light"
              size="sm"
              signature={false}
              className="min-w-0 flex-1 truncate"
            />
            {until ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('until {date}', { date: until })}
              </span>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
