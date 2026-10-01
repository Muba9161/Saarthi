/**
 * Recovery for a page whose code can no longer be downloaded.
 *
 * Every page is its own chunk, named by a hash of its content, and a deploy
 * replaces the whole set (deploy.sh syncs with --delete). A tab opened before
 * the deploy still asks for the old names, gets a 404, and the page fails to
 * load. Vite does the same in development whenever it re-bundles
 * dependencies. Either way the cure is the one users were finding by hand:
 * reload, and pick up the current build.
 */

const RELOADED_AT_KEY = 'saarthi:chunk-reload-at';

/** A second failure this soon after reloading is not stale code, so show it. */
const RELOAD_COOLDOWN_MS = 10_000;

const CHUNK_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

let reloadStarted = false;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_FAILURE.test(error.message);
}

/**
 * Reload onto the current build, unless that was just tried. Returns whether
 * a reload is under way, so the caller can show the error when it is not.
 */
export function reloadForCurrentBuild(): boolean {
  if (reloadStarted) return true;
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_AT_KEY));
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
  } catch {
    // Without storage there is no telling a loop from a first attempt.
    return false;
  }
  reloadStarted = true;
  window.location.reload();
  return true;
}
