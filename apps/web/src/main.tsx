import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { preloadStoredCatalogue } from './features/i18n';
import './styles/globals.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

/**
 * Retire the boot splash once the app has actually painted.
 *
 * Two details matter. It waits for a frame *after* mount, so the splash does
 * not lift on an empty root and flash white before React's first paint. And it
 * removes the node on transition end rather than leaving it in the tree, where
 * a fixed full-screen element would keep swallowing clicks.
 */
function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.dataset.leaving = 'true';
      const remove = () => splash.remove();
      splash.addEventListener('transitionend', remove, { once: true });
      // A dropped transitionend must not strand the overlay over the app.
      window.setTimeout(remove, 900);
    });
  });
}

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

  dismissBootSplash();
}

void preloadStoredCatalogue().then(mount, mount);
