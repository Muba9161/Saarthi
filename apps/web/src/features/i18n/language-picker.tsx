import * as React from 'react';
import { Check, Globe, Search } from 'lucide-react';
import { LANGUAGE_CATALOGUE, languageByCode } from '@saarthi/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocale } from './locale-context';
import { hasTranslations } from './translations';
import { cn } from '@/lib/utils';

/**
 * Choosing a language.
 *
 * Two presentations of one list. The grid is for the registration step, where
 * the choice is the only thing on screen and deserves room; the menu is for
 * the header, where it sits beside the theme toggle.
 *
 * Both label every option in its own script first. Someone who needs this
 * control is, by definition, someone who may not be able to read the word
 * "Marathi" — but they can read "मराठी".
 *
 * Where no catalogue exists yet the option still selects and says so, rather
 * than being hidden. Hiding it would misrepresent what the platform supports,
 * and the fallback to English is exactly what the person would have got anyway.
 */

/** Match on either name, so both "Tamil" and "தமிழ்" find the same row. */
function matches(query: string, code: string): boolean {
  if (!query.trim()) return true;
  const language = languageByCode(code);
  const needle = query.trim().toLowerCase();
  return (
    language.english.toLowerCase().includes(needle) ||
    language.endonym.toLowerCase().includes(needle) ||
    language.code.toLowerCase().includes(needle)
  );
}

/** The full grid, for the registration step. */
export function LanguageGrid({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (locale: string) => void;
  className?: string;
}) {
  const { t } = useLocale();
  const [query, setQuery] = React.useState('');

  const shown = LANGUAGE_CATALOGUE.filter((language) => matches(query, language.code));

  return (
    <div className={cn('space-y-3', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Search')}
          aria-label={t('Search')}
          className="pl-9"
        />
      </div>

      <div
        role="radiogroup"
        aria-label={t('Choose your language')}
        className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3"
      >
        {shown.map((language) => {
          const selected = language.code === value;
          const translated = hasTranslations(language.code);

          return (
            <button
              key={language.code}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(language.code)}
              lang={language.code}
              dir={language.direction}
              className={cn(
                'glass-inset relative flex flex-col items-start gap-0.5 p-3 text-left',
                'transition-all duration-200 ease-smooth',
                selected
                  ? 'glass-choice-selected'
                  : 'hover:-translate-y-0.5 hover:border-white/70 hover:bg-white/60 dark:hover:bg-white/[0.06]',
              )}
            >
              {selected ? (
                <Check className="absolute right-2 top-2 size-4 text-primary" aria-hidden />
              ) : null}
              <span className="text-sm font-medium">{language.endonym}</span>
              <span className="text-2xs text-muted-foreground" dir="ltr">
                {language.english}
              </span>
              {!translated ? (
                <span className="mt-0.5 text-2xs leading-snug text-warning" dir="ltr">
                  {t('Not translated yet — shows in English')}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('No results')}</p>
      ) : null}
    </div>
  );
}

/** The header control, beside the theme toggle. */
export function LanguageMenu() {
  const { locale, setLocale, t } = useLocale();
  const active = languageByCode(locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('Language')} title={active.endonym}>
          <Globe className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-60 overflow-y-auto">
        <DropdownMenuLabel>{t('Choose your language')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGE_CATALOGUE.map((language) => (
          <DropdownMenuItem
            key={language.code}
            onSelect={() => setLocale(language.code)}
            className="gap-2"
          >
            <Check
              className={cn(
                'size-4 shrink-0',
                language.code === locale ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-sm"
                lang={language.code}
                dir={language.direction}
              >
                {language.endonym}
              </span>
              <span className="block truncate text-2xs text-muted-foreground">
                {language.english}
                {hasTranslations(language.code) ? '' : ' · English fallback'}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
