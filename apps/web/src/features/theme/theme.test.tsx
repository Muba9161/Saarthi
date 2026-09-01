import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './theme-context';

/**
 * Which theme a device gets.
 *
 * Saarthi is light on every device unless somebody chose otherwise. That is a
 * product decision rather than a technical one, so it is pinned here — the
 * one-word change from 'light' back to 'system' would otherwise be invisible
 * in review and only show up on a reviewer's machine set to dark.
 */

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        go dark
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        follow device
      </button>
    </div>
  );
}

/** Pretend the operating system is set to dark. */
function osPrefersDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  osPrefersDark(false);
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

describe('the default theme', () => {
  it('is light on a fresh device', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('stays light even when the operating system asks for dark', () => {
    // The whole point of the change: the OS no longer decides on its own.
    osPrefersDark(true);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores a stored value it does not recognise', () => {
    window.localStorage.setItem('saarthi.theme', 'sepia');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});

describe('choosing a theme', () => {
  it('honours an explicit choice and remembers it', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    act(() => screen.getByRole('button', { name: 'go dark' }).click());

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem('saarthi.theme')).toBe('dark');
  });

  it('follows the device once that is asked for explicitly', () => {
    osPrefersDark(true);

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    act(() => screen.getByRole('button', { name: 'follow device' }).click());

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('restores a previously stored choice', () => {
    window.localStorage.setItem('saarthi.theme', 'dark');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });
});
