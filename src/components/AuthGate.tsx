import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { account, clearUserJwt, IS_APPWRITE_PROD } from '../appwrite/client';
import { useStore } from '../store';
import './AuthGate.css';

type State = 'checking' | 'signed-out' | 'signed-in';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(IS_APPWRITE_PROD ? 'checking' : 'signed-in');
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
    account.get()
      .then(async () => {
        if (!active) return;
        setState('signed-in');
        await loadData();
      })
      .catch(() => { if (active) setState('signed-out'); });
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
