import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
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

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

dismissBootSplash();
