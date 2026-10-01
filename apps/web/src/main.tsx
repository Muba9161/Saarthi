import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { releaseBootSplash } from './components/common/boot-splash';
import { preloadStoredCatalogue } from './features/i18n';
import { reloadForCurrentBuild } from './lib/chunk-reload';
import './styles/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

/*
 * A production build preloads a page's chunks before importing it, and reports
 * a failed preload here first. Reloading now, before the failure reaches the
 * page's error boundary, means a tab left open across a deploy never shows an
 * error at all. The boundary still catches whatever this does not.
 */
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForCurrentBuild()) event.preventDefault();
});

/*
 * Mount once the chosen language is in hand.
 *
 * Translation catalogues are fetched per language rather than bundled
 * together, so for anyone not using English there is a moment where the app
 * could render in English and then re-render translated. The boot splash is
 * already on screen, so the wait is invisible and the flash never happens.
 * `preloadStoredCatalogue` gives up after a short timeout, so a stalled
 * connection starts the app in English instead of holding the splash.
 */
const root = ReactDOM.createRoot(container);

function mount(): void {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  // Lifts after the first paint, or later if a loading screen is holding it.
  releaseBootSplash();
}

void preloadStoredCatalogue().then(mount, mount);
