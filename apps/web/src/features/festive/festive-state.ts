import {
  FESTIVE_KITS,
  activeWindowOn,
  festiveRgba,
  isFestivalKey,
  localYmd,
  type FestivalKey,
  type FestiveWindow,
} from '@saarthi/shared';

/**
 * The festive layer's state in the browser: which festival shows today and
 * whether this visitor wants it.
 *
 * Today's festival comes from the shared calendar and the visitor's own local
 * date, nothing else; there is no admin switch. Whether they want it:
 * - signed in, the account's "Festive looks" (on the session) wins once known;
 * - this device remembers the choice, so the public site and the sign-in modal
 *   respect it before anybody signs in.
 *
 * Every festive part (the garland, the greeting, the festival colours on the
 * calls to action, the boot splash's glow) reads `<html data-festive>` and the
 * `--festive-*` custom properties painted here, or `useFestive()`. Painting
 * happens on import, before React's first render, so the boot splash already
 * wears the festival's light.
 *
 * Framework-free on purpose; `use-festive.ts` is the React binding.
 */

export const FESTIVE_OFF_STORAGE_KEY = 'saarthi.festive-off';

/** `?festival=<key>` forces a festival on, in development builds only. */
const PREVIEW_PARAM = 'festival';

export interface FestiveState {
  /** The festival showing today (or previewed), whether or not it is wanted. */
  key: FestivalKey | null;
  /** Its window, for "showing until …". Null for a preview. */
  window: FestiveWindow | null;
  /** The visitor wants festive looks. */
  on: boolean;
}

type Listener = (state: FestiveState) => void;

let state: FestiveState | null = null;
const listeners = new Set<Listener>();

function deviceSaysOff(): boolean {
  try {
    return window.localStorage.getItem(FESTIVE_OFF_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberOnDevice(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(FESTIVE_OFF_STORAGE_KEY);
    else window.localStorage.setItem(FESTIVE_OFF_STORAGE_KEY, '1');
  } catch {
    // Private mode: the choice still applies for this page.
  }
}

function previewKey(): FestivalKey | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(PREVIEW_PARAM);
  return isFestivalKey(value) ? value : null;
}

function todays(): Pick<FestiveState, 'key' | 'window'> {
  const preview = previewKey();
  if (preview) return { key: preview, window: null };
  const window = activeWindowOn(localYmd());
  return { key: window?.key ?? null, window };
}

const CUSTOM_PROPERTIES = [
  '--festive-cta-from',
  '--festive-cta-to',
  '--festive-cta-ink',
  '--festive-glow-a',
  '--festive-glow-b',
  '--festive-wish-dark',
  '--festive-wish-light',
] as const;

function paint(next: FestiveState): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const showing = next.on ? next.key : null;
  if (!showing) {
    root.removeAttribute('data-festive');
    for (const property of CUSTOM_PROPERTIES) root.style.removeProperty(property);
    return;
  }
  const kit = FESTIVE_KITS[showing];
  root.setAttribute('data-festive', showing);
  root.style.setProperty('--festive-cta-from', kit.cta.from);
  root.style.setProperty('--festive-cta-to', kit.cta.to);
  root.style.setProperty('--festive-cta-ink', kit.cta.ink);
  root.style.setProperty('--festive-glow-a', festiveRgba(kit.glow[0].color, kit.glow[0].alpha));
  root.style.setProperty('--festive-glow-b', festiveRgba(kit.glow[1].color, kit.glow[1].alpha));
  root.style.setProperty('--festive-wish-dark', kit.wishOnDark);
  root.style.setProperty('--festive-wish-light', kit.wishOnLight);
}

function current(): FestiveState {
  if (!state) {
    state = { ...todays(), on: !deviceSaysOff() };
    paint(state);
  }
  return state;
}

function commit(next: FestiveState): void {
  const before = current();
  state = next;
  paint(next);
  if (before.key === next.key && before.on === next.on && before.window?.day === next.window?.day)
    return;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // One festive part failing must not stop the others.
    }
  }
}

export function getFestiveState(): FestiveState {
  return current();
}

/** The festival on screen right now, or null (none today, or turned off). */
export function activeFestival(): FestivalKey | null {
  const value = current();
  return value.on ? value.key : null;
}

export function subscribeFestive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Turn festive looks on or off for this visitor (remembered on this device). */
export function setFestiveLooks(on: boolean): void {
  rememberOnDevice(on);
  commit({ ...current(), on });
}

/** The account's "Festive looks", once the session is known. Anything but a boolean is ignored. */
export function syncFestiveAccount(value: unknown): void {
  if (typeof value !== 'boolean') return;
  if (value === current().on && value === !deviceSaysOff()) return;
  setFestiveLooks(value);
}

/** Check the calendar again (local midnight, or the tab coming back). */
export function refreshFestiveDay(): void {
  commit({ ...todays(), on: current().on });
}

/** Test seam: forget everything. */
export function resetFestiveForTests(): void {
  state = null;
  listeners.clear();
}
