import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useStore } from './store.ts'
import AuthGate from './components/AuthGate.tsx'
import { IS_APPWRITE_PROD } from './appwrite/client.ts'

// Kick off the initial load BEFORE render, but never await it: loadAll()
// hydrates the offline snapshot synchronously up to its first await, so the
// first paint already shows cached data. Blocking here stalled startup for the
// full fetch timeout when the server was unreachable; App shows its
// "Verbindung wird hergestellt…" banner until dataLoaded flips.
if (!IS_APPWRITE_PROD) {
  useStore.getState().loadAll().catch((e) => console.warn('initial loadAll failed', e));
}

// App-shell cache (public/sw.js): lets the app — incl. the desktop thin
// client — start without a connection. Production builds on a secure origin
// only (the Appwrite site); plain-http LAN servers can't register one anyway.
if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate><App /></AuthGate>
  </StrictMode>,
)
