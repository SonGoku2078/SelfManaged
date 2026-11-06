import { useCallback, useEffect, useRef, useState } from 'react';
import { flush as flushOutbox, pendingCount, onChange as onOutboxChange } from './api/outbox';
import { apiFetch } from './api/client';
import { IS_APPWRITE_PROD } from './appwrite/client';
import { useStore } from './store';
import { onRemoteChange } from './windowSync';
import {
  backgroundPullDue, returnPullDue, EXPRESS_HEALTH_MS, OFFLINE_PROBE_MS, OUTBOX_RETRY_MS, TICK_MS,
} from './sync/cadence';

// Erst nach so vielen Fehlschlaegen in Folge gilt der Server als offline — ein
// einzelner langsamer Abruf (Cold Start, WLAN-Schluckauf) blendet nichts ein.
const OFFLINE_AFTER_FAILS = 2;
// Aenderung aus einem anderen Fenster: kurz sammeln, dann einmal nachladen.
const REMOTE_DEBOUNCE_MS = 1500;
const REMOTE_RETRY_MS = 3000;

export type RefreshState = 'idle' | 'refreshing' | 'done' | 'error';

export interface ServerSync {
  serverOnline: boolean | null;
  refreshState: RefreshState;
  /** Manueller Refresh (Button): Outbox leeren + neu laden. */
  refresh: () => Promise<void>;
}

// Tippt der Nutzer gerade irgendwo? Dann setzt der Hintergrund-Takt aus
// (AC4), damit ein Nachladen keine laufende Eingabe stoert. Der manuelle
// Button und der Fokus-Load ignorieren das bewusst.
function isEditing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const isVisible = () => document.visibilityState === 'visible';

// Server-Sync fuer Desktop, Web und Handy (#86, Appwrite-Verbrauch 2026-11).
// Ein Pull ist ein Delta (nur Geaendertes, siehe src/sync/delta.ts); wann
// gepullt wird, steht in src/sync/cadence.ts.
export function useServerSync(): ServerSync {
  const loadAll = useStore((s) => s.loadAll);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  // Verhindert ueberlappende Ladevorgaenge (Button-Klick waehrend Auto-Load).
  const loading = useRef(false);
  const lastPullAt = useRef(0);
  const fails = useRef(0);

  const markOnline = useCallback(() => { fails.current = 0; setServerOnline(true); }, []);
  const markFailed = useCallback(() => {
    fails.current++;
    if (fails.current >= OFFLINE_AFTER_FAILS) setServerOnline(false);
  }, []);

  // loadAll() flusht zuerst die Outbox (Push vor Pull), gespeicherte lokale
  // Aenderungen gehen also nie verloren (AC5). Gibt zurueck, ob geladen wurde.
  const pull = useCallback(async (): Promise<boolean> => {
    if (loading.current) return false;
    loading.current = true;
    lastPullAt.current = Date.now();
    try {
      await loadAll();
      const { dataLoaded } = useStore.getState();
      // dataLoaded=false nach loadAll(): Server nicht erreicht.
      if (dataLoaded) markOnline(); else markFailed();
      // Erfolg heisst: Server erreicht UND alles Lokale ist oben angekommen.
      return dataLoaded && pendingCount() === 0;
    } finally {
      loading.current = false;
    }
  }, [loadAll, markOnline, markFailed]);

  const refresh = useCallback(async () => {
    setRefreshState('refreshing');
    const ok = await pull();
    setRefreshState(ok ? 'done' : 'error');
    window.setTimeout(() => setRefreshState('idle'), ok ? 1500 : 4000);
  }, [pull]);

  // --- Erster Load + Erreichbarkeit ---
  // Appwrite: kein Health-Takt, solange der Server erreichbar ist — jeder
  // Pull beantwortet die Frage (und jeder /health-Aufruf war eine Function-
  // Ausfuehrung). Nur offline wird geprobt; fehlgeschlagene Anfragen erreichen
  // Appwrite nicht und kosten nichts. Express/LAN: Health wie bisher (gratis).
  useEffect(() => {
    let cancelled = false;
    let probing = false;
    const probe = () => {
      if (probing) return;
      probing = true;
      apiFetch('/health', { signal: AbortSignal.timeout(8000) })
        .then(() => {
          if (cancelled) return;
          const wasOffline = fails.current >= OFFLINE_AFTER_FAILS || !useStore.getState().dataLoaded;
          markOnline();
          // Zurueck online (oder noch nie geladen): einmal Outbox + Delta.
          if (wasOffline) void pull();
        })
        .catch((e) => {
          if (cancelled) return;
          // Eine HTTP-Antwort (z. B. 429 Rate-Limit, 401) heisst: Server
          // erreichbar. "Offline" nur ohne jede Antwort.
          if (e instanceof Error && e.message.startsWith('API ')) { markOnline(); return; }
          markFailed();
        })
        .finally(() => { probing = false; });
    };
    const tick = () => {
      if (!IS_APPWRITE_PROD) { probe(); return; }
      if (!useStore.getState().dataLoaded || fails.current > 0) probe();
    };
    // Erster Load (main.tsx hat ihn meist schon gestartet; loadAll buendelt).
    void pull();
    const id = window.setInterval(tick, IS_APPWRITE_PROD ? OFFLINE_PROBE_MS : EXPRESS_HEALTH_MS);
    const onOnline = () => { void pull(); };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
  }, [pull, markOnline, markFailed]);

  // --- Outbox: fehlgeschlagene Schreibvorgaenge erneut senden, nur solange welche warten ---
  useEffect(() => {
    let id: number | undefined;
    const update = (n: number) => {
      if (n > 0 && id === undefined) id = window.setInterval(() => { void flushOutbox(); }, OUTBOX_RETRY_MS);
      if (n === 0 && id !== undefined) { window.clearInterval(id); id = undefined; }
    };
    update(pendingCount());
    const off = onOutboxChange(update);
    return () => { off(); if (id !== undefined) window.clearInterval(id); };
  }, []);

  // --- Hintergrund-Takt: nur sichtbar, fokussiert alle 5 min, sonst alle 15 min (AC3/AC4) ---
  useEffect(() => {
    const id = window.setInterval(() => {
      const due = backgroundPullDue({
        now: Date.now(), lastPullAt: lastPullAt.current, visible: isVisible(),
        focused: document.hasFocus(), editing: isEditing(), dataLoaded: useStore.getState().dataLoaded,
      });
      if (due) void pull();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [pull]);

  // --- Zurueck im Vordergrund: nachladen (AC2, der 'zurueck im Heimnetz'-Fall) ---
  useEffect(() => {
    const onReturn = () => {
      if (returnPullDue({ now: Date.now(), lastPullAt: lastPullAt.current, visible: isVisible() })) void pull();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [pull]);

  // --- Andere Fenster (src/windows.ts) haben etwas gespeichert: nachladen ---
  // Entprellt, damit Tippen im anderen Fenster nicht jede Sekunde einen Pull
  // ausloest; laufende Eingaben hier warten, bis sie fertig sind.
  useEffect(() => {
    let timer: number | undefined;
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (isEditing()) schedule(REMOTE_RETRY_MS);
        else void pull();
      }, ms);
    };
    const off = onRemoteChange(() => schedule(REMOTE_DEBOUNCE_MS));
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [pull]);

  return { serverOnline, refreshState, refresh };
}
