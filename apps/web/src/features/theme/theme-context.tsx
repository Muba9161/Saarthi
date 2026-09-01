import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'saarthi.theme';

/**
 * Light, on every device, until somebody says otherwise.
 *
 * Not `system`. A fleet office is usually a bright room and the operational
 * screens — dense tables, map overlays, document scans — were designed light
 * first. Following the OS meant a phone on its night schedule opened Saarthi
 * in a theme nobody had chosen for it. "Match my device" is still there for
 * anyone who wants it; it is just no longer assumed.
 *
 * The pre-paint script in `index.html` resolves the same key by the same rule,
 * so the boot splash and the app never disagree.
 */
const DEFAULT_THEME: Theme = 'light';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === 'light' || stored === 'dark' || stored === 'system'
        ? stored
        : DEFAULT_THEME;
    } catch {
      // Blocked storage is survivable; the default stands.
      return DEFAULT_THEME;
    }
  });

  const [resolvedTheme, setResolvedTheme] = React.useState<'light' | 'dark'>(() =>
    theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme,
  );

  React.useEffect(() => {
    const resolve = (): 'light' | 'dark' =>
      theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;

    const apply = (): void => {
      const next = resolve();
      setResolvedTheme(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.style.colorScheme = next;
    };

    apply();

    // Follow the OS while the user has not made an explicit choice.
    if (theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // As above — the choice still applies for this session.
    }
    setThemeState(next);
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
