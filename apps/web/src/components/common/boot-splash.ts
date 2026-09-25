/**
 * The boot splash inlined in `index.html`, and when it is allowed to leave.
 *
 * It goes once the app has painted — unless something in the app is itself a
 * loading screen, in which case it stays until that is done. Handing over to a
 * React-rendered splash instead would put two splash screens back to back, and
 * restart the logo's drawing halfway through.
 */

const ID = 'boot-splash';

let holds = 0;
let appMounted = false;

function bootSplash(): HTMLElement | null {
  const splash = document.getElementById(ID);
  return splash && splash.dataset.leaving !== 'true' ? splash : null;
}

/**
 * Fade the splash out and remove it. The node goes on transition end rather
 * than staying in the tree, where a fixed full-screen element would keep
 * swallowing clicks.
 */
function dismiss(): void {
  const splash = bootSplash();
  if (!splash) return;
  splash.dataset.leaving = 'true';
  const remove = () => splash.remove();
  splash.addEventListener('transitionend', remove, { once: true });
  // A dropped transitionend must not strand the overlay over the app.
  window.setTimeout(remove, 900);
}

/**
 * Dismiss once nothing holds the splash. It waits two frames, so the splash
 * does not lift on an empty root and flash white before React's first paint,
 * and so a hold released and retaken in the same commit (StrictMode remounts
 * every effect) does not let it slip away.
 */
function settle(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (holds === 0) dismiss();
    });
  });
}

/** Called once, after the app's first render. */
export function releaseBootSplash(): void {
  appMounted = true;
  settle();
}

/** Whether the boot splash is still on screen to be held. */
export function isBootSplashShowing(): boolean {
  return typeof document !== 'undefined' && bootSplash() !== null;
}

/**
 * Keep the boot splash up while the caller is mounted. Returns the release, for
 * use as an effect cleanup.
 */
export function holdBootSplash(): () => void {
  holds += 1;
  return () => {
    holds -= 1;
    if (appMounted && holds === 0) settle();
  };
}
