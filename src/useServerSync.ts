import { useCallback, useEffect, useRef, useState } from 'react';
import { flush as flushOutbox } from './api/outbox';
import { apiFetch } from './api/client';
import { IS_APPWRITE_PROD } from './appwrite/client';
import { useStore } from './store';

// Wie oft im Hintergrund frische Daten geholt werden, wenn das Fenster offen
// liegen bleibt. Fokuswechsel laedt unabhaengig davon sofort (#86).
const BACKGROUND_MS = 60_000;
// Gesundheitspruefung des Servers (Online/Offline-Hinweis). Auf Appwrite kostet
// jeder Check eine Function-Ausfuehrung, daher seltener.
const HEALTH_MS = IS_APPWRITE_PROD ? 30_000 : 15_000;
// Erst nach so vielen Fehlschlaegen in Folge gilt der Server als offline — ein
// einzelner langsamer Check (Cold Start, WLAN-Schluckauf) blendet nichts ein.
const OFFLINE_AFTER_FAILS = 2;

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

// Server-Sync fuer Desktop/Web (#86). Ersetzt die alte Schleife, die nach dem
// ersten loadAll nie wieder gepullt hat — dadurch blieben Aenderungen von
// anderen Geraeten unsichtbar bis zum Neustart.
export function useServerSync(): ServerSync {
  const loadAll = useStore((s) => s.loadAll);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  // Verhindert ueberlappende Ladevorgaenge (Button-Klick waehrend Auto-Load).
  const loading = useRef(false);

  // loadAll() flusht zuerst die Outbox (Push vor Pull), gespeicherte lokale
  // Aenderungen gehen also nie verloren (AC5). Gibt zurueck, ob geladen wurde.
  const pull = useCallback(async (): Promise<boolean> => {
    if (loading.current) return false;
    loading.current = true;
    try {
      await loadAll();
      return useStore.getState().dataLoaded;
    } finally {
      loading.current = false;
    }
  }, [loadAll]);

  const refresh = useCallback(async () => {
    setRefreshState('refreshing');
    const ok = await pull();
    setRefreshState(ok ? 'done' : 'error');
    window.setTimeout(() => setRefreshState('idle'), ok ? 1500 : 4000);
  }, [pull]);

  // --- Health-Poll + erster Load ---
  // Geprueft wird die API selbst (ueber apiFetch, also auf PROD durch die
  // Appwrite-Function). Frueher ging fetch('/health') an die statische Site,
  // die immer 200 liefert — sagte also nichts ueber die API aus und meldete bei
  // jedem langsamen Seitenabruf (>3 s) faelschlich "Server nicht erreichbar".
  useEffect(() => {
    let cancelled = false;
    let fails = 0;
    const check = () =>
      apiFetch('/health', { signal: AbortSignal.timeout(8000) })
        .then(() => {
          if (cancelled) return;
          fails = 0;
          setServerOnline(true);
          // Immer draenen, damit ein einmal fehlgeschlagener Schreibvorgang
          // weiter versucht wird; der allererste Load passiert hier.
          void flushOutbox();
          if (!useStore.getState().dataLoaded) void pull();
        })
        .catch(() => {
          if (cancelled) return;
          fails++;
          if (fails >= OFFLINE_AFTER_FAILS) setServerOnline(false);
        });
    check();
    const id = window.setInterval(check, HEALTH_MS);
    const onOnline = () => { void flushOutbox(); void pull(); };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', onOnline);
    };
  }, [pull]);

  // --- Hintergrund-Takt: frische Daten holen, wenn nicht getippt wird (AC3/AC4) ---
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return; // im Hintergrund unnoetig
      if (isEditing()) return;                             // Eingabe nicht stoeren
      if (!useStore.getState().dataLoaded) return;         // Health-Poll macht den ersten
      void pull();
    }, BACKGROUND_MS);
    return () => window.clearInterval(id);
  }, [pull]);

  // --- Fokus/Sichtbarkeit: sofort nachladen (AC2, der 'zurueck im Heimnetz'-Fall) ---
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void pull();
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [pull]);

  return { serverOnline, refreshState, refresh };
}
