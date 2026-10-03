import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AppwriteException } from 'appwrite';
import { account, clearUserJwt, IS_APPWRITE_PROD } from '../appwrite/client';
import { loadSnapshot } from '../api/cache';
import { pendingCount } from '../api/outbox';
import { useStore } from '../store';
import './AuthGate.css';

type State = 'checking' | 'signed-out' | 'signed-in';

// Local data present → this device was signed in before (logout wipes the
// cache). Start on it immediately and validate the session in the background:
// waiting for account.get() stalled every cold start (e.g. Android share →
// SelfManaged) for seconds on the "Session wird geprüft" screen.
const hasLocalData = () => !!loadSnapshot()?.tasks?.length;

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() =>
    !IS_APPWRITE_PROD || hasLocalData() ? 'signed-in' : 'checking'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const loadingStarted = useRef(false);

  const loadData = async () => {
    if (loadingStarted.current) return;
    loadingStarted.current = true;
    try {
      await useStore.getState().loadAll();
    } catch (e) {
      console.warn('initial Appwrite load failed', e);
    }
  };

  useEffect(() => {
    if (!IS_APPWRITE_PROD) return;
    let active = true;
    // Local-first: hydrate the cached tasks now; loadAll syncs once online.
    if (hasLocalData()) void loadData();
    account.get()
      .then(async () => {
        if (!active) return;
        setState('signed-in');
        await loadData();
      })
      .catch(async (e) => {
        if (!active) return;
        // Offline (no HTTP status) with local data → start local-first; the
        // session is re-validated by the next API call once we're back online.
        // Only a real "not signed in" answer from Appwrite shows the login.
        const offline = !(e instanceof AppwriteException && e.code > 0);
        if (offline && loadSnapshot()?.tasks?.length) {
          setState('signed-in');
          await loadData();
        } else {
          // The local-first load ran without a session — reload after login.
          loadingStarted.current = false;
          setState('signed-out');
        }
      });
    return () => { active = false; };
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await account.createEmailPasswordSession({ email: email.trim(), password });
      clearUserJwt();
      setState('signed-in');
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen.');
    }
  };

  const logout = async () => {
    // Logout clears the local outbox — unsynced edits would be lost.
    const pending = pendingCount();
    if (
      pending > 0 &&
      !window.confirm(`${pending} Änderung(en) sind noch nicht synchronisiert und gehen beim Abmelden verloren. Trotzdem abmelden?`)
    ) return;
    setError('');
    try {
      await account.deleteSession({ sessionId: 'current' });
    } finally {
      clearUserJwt();
      localStorage.removeItem('tm-cache');
      localStorage.removeItem('tm-outbox');
      localStorage.removeItem('tm-outbox-dead');
      window.location.reload();
    }
  };

  if (!IS_APPWRITE_PROD) return children;
  if (state === 'checking') return <main className="auth-screen"><p>Session wird geprüft …</p></main>;
  if (state === 'signed-out') {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={login}>
          <img src="/favicon.svg" alt="" className="auth-logo" />
          <h1>SelfManaged</h1>
          <p>Bei PROD anmelden</p>
          <label>E-Mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button type="submit">Anmelden</button>
        </form>
      </main>
    );
  }
  return (
    <div className="has-prod-logout">
      <button className="prod-logout" type="button" onClick={logout}>Abmelden</button>
      {children}
    </div>
  );
}
