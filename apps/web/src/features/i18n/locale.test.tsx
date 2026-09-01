import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, act, waitForElementToBeRemoved } from '@testing-library/react';
import { LANGUAGE_CATALOGUE, SUPPORTED_LOCALES, resolveLocale } from '@saarthi/shared';
import { LocaleProvider, useLocale } from './locale-context';
import { LocaleSplash } from './locale-splash';
import { CATALOGUES, en } from './translations';

/**
 * Translation lookup.
 *
 * The property that matters is that a miss is invisible: keys are the English
 * source, so an untranslated string must render as readable English rather
 * than as a key, a blank, or a crash. Everything here is a way of asserting
 * that from a different direction.
 */

function Probe({ source }: { source: string }) {
  const { locale, t, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="text">{t(source)}</span>
      <button type="button" onClick={() => setLocale('hi-IN')}>
        switch
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = '';
  document.documentElement.dir = '';
});

describe('translation catalogues', () => {
  it('only uses keys that exist in the English source', () => {
    // TypeScript enforces this at build time, but these files are hand-written
    // in scripts most reviewers cannot read — a typo is invisible on the page
    // because the fallback quietly serves English instead.
    const known = new Set(Object.keys(en));

    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const key of Object.keys(catalogue)) {
        expect(known.has(key), `${locale} has an unknown key: ${key}`).toBe(true);
      }
    }
  });

  it('never leaves a translated entry empty', () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const [key, value] of Object.entries(catalogue)) {
        expect(String(value).trim(), `${locale}.${key} is blank`).not.toBe('');
      }
    }
  });

  it('keeps every interpolation placeholder the English source declares', () => {
    const placeholders = (text: string): string[] => (text.match(/\{(\w+)\}/g) ?? []).sort();

    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const [key, value] of Object.entries(catalogue)) {
        const source = (en as Record<string, string>)[key];
        if (!source) continue;
        expect(placeholders(String(value)), `${locale}.${key} lost a placeholder`).toEqual(
          placeholders(source),
        );
      }
    }
  });

  it('only registers catalogues for languages the platform offers', () => {
    for (const locale of Object.keys(CATALOGUES)) {
      expect(SUPPORTED_LOCALES, `${locale} is not in the language catalogue`).toContain(locale);
    }
  });
});

describe('catalogue completeness', () => {
  /*
   * The failure this guards against is invisible in review.
   *
   * A string wrapped in t() looks handled in the source, but if no catalogue
   * defines it the fallback quietly serves English — so a screen reads half
   * translated and nothing anywhere reports a problem. Two keys reached a
   * screenshot that way. Asserting the key space is closed is the only way to
   * see it without opening every page in every language.
   */
  it('defines every key that a registered catalogue would need', () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const absent = Object.keys(en).filter(
        (key) => !(key in (catalogue as Record<string, string>)),
      );

      expect(
        absent,
        `${locale} is missing ${absent.length} of ${Object.keys(en).length} keys: ` +
          `${absent.slice(0, 5).join(' / ')}${absent.length > 5 ? ' …' : ''}`,
      ).toEqual([]);
    }
  });

  it('translates rather than echoing the English source', () => {
    // A handful of entries are legitimately identical — proper nouns, and
    // acronyms that are not localised. Everything else copying the English
    // verbatim means a row was filled in without being translated.
    const ALLOWED_IDENTICAL = new Set(['SOS', 'Saarthi@2026']);

    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      if (locale === 'en-IN') continue;

      const echoed = Object.entries(catalogue as Record<string, string>).filter(
        ([key, value]) =>
          value === (en as Record<string, string>)[key] && !ALLOWED_IDENTICAL.has(key),
      );

      expect(
        echoed.map(([key]) => key),
        `${locale} left ${echoed.length} entries in English`,
      ).toEqual([]);
    }
  });
});

describe('LocaleProvider', () => {
  it('falls back to the English source for an untranslated string', () => {
    render(
      <LocaleProvider accountLocale="hi-IN">
        <Probe source="A string no catalogue has ever contained" />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('text')).toHaveTextContent(
      'A string no catalogue has ever contained',
    );
  });

  it('translates a string the chosen language does have', () => {
    render(
      <LocaleProvider accountLocale="hi-IN">
        <Probe source="Save" />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('hi-IN');
    expect(screen.getByTestId('text')).toHaveTextContent('सहेजें');
  });

  it('renders English for a language that has no catalogue yet', () => {
    // Bodo is offered and selectable; no catalogue exists for it.
    render(
      <LocaleProvider accountLocale="brx-IN">
        <Probe source="Save" />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('brx-IN');
    expect(screen.getByTestId('text')).toHaveTextContent('Save');
  });

  it('marks the document with the language and its direction', () => {
    render(
      <LocaleProvider accountLocale="ur-IN">
        <Probe source="Save" />
      </LocaleProvider>,
    );

    expect(document.documentElement.lang).toBe('ur-IN');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('switches language on demand and remembers the choice', () => {
    render(
      <LocaleProvider>
        <Probe source="Cancel" />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('text')).toHaveTextContent('Cancel');

    act(() => screen.getByRole('button', { name: 'switch' }).click());

    expect(screen.getByTestId('text')).toHaveTextContent('रद्द करें');
    expect(window.localStorage.getItem('saarthi.locale')).toBe('hi-IN');
  });

  it('ignores a stored preference that is no longer offered', () => {
    window.localStorage.setItem('saarthi.locale', 'kl-GL');

    render(
      <LocaleProvider>
        <Probe source="Save" />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('en-IN');
  });
});

describe('the language switch splash', () => {
  function Switcher({ to }: { to: string }) {
    const { setLocale } = useLocale();
    return (
      <button type="button" onClick={() => setLocale(to)}>
        switch
      </button>
    );
  }

  function renderSplash(props: { accountLocale?: string; to: string }) {
    const { accountLocale, to } = props;
    return render(
      <LocaleProvider {...(accountLocale ? { accountLocale } : {})}>
        <LocaleSplash />
        <Switcher to={to} />
      </LocaleProvider>,
    );
  }

  it('says nothing until a language is actually chosen', () => {
    renderSplash({ to: 'hi-IN' });

    expect(screen.queryByText('हिन्दी')).toBeNull();
  });

  /*
   * Restoring a stored preference is not a moment worth celebrating — it
   * happens on every sign-in. Only a deliberate switch should flourish, which
   * is why the effect keys off the nonce and not off the locale.
   */
  it('stays quiet when a session merely restores a stored language', () => {
    renderSplash({ accountLocale: 'ta-IN', to: 'hi-IN' });

    expect(screen.queryByText('தமிழ்')).toBeNull();
  });

  it('greets in the new language, in its own script', () => {
    renderSplash({ to: 'hi-IN' });

    act(() => screen.getByRole('button', { name: 'switch' }).click());

    // The greeting is the hero; the endonym names the language beneath it.
    expect(screen.getByText('नमस्ते')).toBeInTheDocument();
    expect(screen.getByText('हिन्दी')).toBeInTheDocument();
  });

  it('greets rather than translating the word "Welcome"', () => {
    // Punjabi says "ਜੀ ਆਇਆਂ ਨੂੰ" — a real greeting, not a rendering of the
    // English noun. Guards the catalogue against being filled in mechanically.
    renderSplash({ to: 'pa-IN' });

    act(() => screen.getByRole('button', { name: 'switch' }).click());

    expect(screen.getByText('ਜੀ ਆਇਆਂ ਨੂੰ')).toBeInTheDocument();
  });

  it('can be dismissed before it finishes', async () => {
    renderSplash({ to: 'ta-IN' });

    act(() => screen.getByRole('button', { name: 'switch' }).click());
    expect(screen.getByText('வணக்கம்')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    // The node lingers for the length of the exit animation, so wait for it to
    // actually leave rather than asserting into the middle of the transition.
    await waitForElementToBeRemoved(() => screen.queryByText('வணக்கம்'), { timeout: 3000 });
  });

  it('announces the change for assistive technology', () => {
    renderSplash({ to: 'bn-IN' });

    act(() => screen.getByRole('button', { name: 'switch' }).click());

    // The pill is aria-hidden, so this live region is the only thing a screen
    // reader receives.
    const live = document.body.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('Bengali');
    expect(live?.textContent).toContain('স্বাগতম');
  });

  it('does not replay when the language already in use is picked again', () => {
    renderSplash({ to: 'en-IN' });

    act(() => screen.getByRole('button', { name: 'switch' }).click());

    // en-IN is already the default, so nothing changed and nothing should show.
    expect(screen.queryByText('English')).toBeNull();
  });
});

describe('the language catalogue', () => {
  it('offers English plus the twenty-two Eighth Schedule languages', () => {
    expect(LANGUAGE_CATALOGUE).toHaveLength(23);
  });

  it('gives every language a distinct code and a name in its own script', () => {
    const codes = new Set<string>();

    for (const language of LANGUAGE_CATALOGUE) {
      expect(codes.has(language.code), `${language.code} is listed twice`).toBe(false);
      codes.add(language.code);

      expect(language.endonym.trim(), `${language.code} has no endonym`).not.toBe('');
      expect(language.english.trim(), `${language.code} has no English name`).not.toBe('');
    }
  });

  it('resolves a bare or regional subtag onto an offered language', () => {
    expect(resolveLocale('hi')).toBe('hi-IN');
    expect(resolveLocale('ta-LK')).toBe('ta-IN');
    expect(resolveLocale('HI-in')).toBe('hi-IN');
    expect(resolveLocale('zz')).toBe('en-IN');
    expect(resolveLocale(null)).toBe('en-IN');
  });
});
