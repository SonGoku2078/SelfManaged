import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getBaseUrl, setBaseUrl, normalizeBaseUrl, flushOutbox } from '../api';
import { IS_APPWRITE_PROD } from '../../../../src/appwrite/client';
import { checkForUpdate, openApk, APP_VERSION } from '../update';
import { notificationStatus, sendTestNotification } from '../notifications';
import { Ringtone } from '../ringtone';
import { useSwipeDown } from '../gestures';

export default function Settings({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.settings.theme);
  const setTheme = useStore((s) => s.setTheme);
  const loadAll = useStore((s) => s.loadAll);
  const reminderLeadMin = useStore((s) => s.settings.reminderLeadMin ?? 0);
  const reminderSound = useStore((s) => (s.settings.reminderSound ?? 1) !== 0);
  const reminderVibrate = useStore((s) => (s.settings.reminderVibrate ?? 1) !== 0);
  const reminderSoundUri = useStore((s) => s.settings.reminderSoundUri || '');
  const reminderSoundName = useStore((s) => s.settings.reminderSoundName || 'Standard-Ton');
  const patchSettings = useStore((s) => s.patchSettings);
  const taskCount = useStore((s) => s.tasks.length);

  // Pre-fill with a sensible default so nothing must be typed from scratch
  // (editable — change the IP/port as needed).
  const [url, setUrl] = useState(getBaseUrl() || 'http://192.168.8.50:3001');
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<string>('');
  const [testing, setTesting] = useState(false);
  const swipe = useSwipeDown(onClose);
  const [updateMsg, setUpdateMsg] = useState<string>('');
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);
  const [notifMsg, setNotifMsg] = useState<string>('');
  useEffect(() => {
    notificationStatus().then((s) => {
      setNotifMsg(
        s === 'granted' ? '✓ Benachrichtigungen erlaubt'
          : s === 'denied' ? '✕ Benachrichtigungen blockiert — in den Android-Einstellungen erlauben'
          : s === 'unavailable' ? '(nur in der App, nicht im Browser)'
          : 'noch nicht erlaubt — unten testen'
      );
    });
  }, []);
  const testNotif = async () => {
    setNotifMsg('… plane Test');
    setNotifMsg(await sendTestNotification({ sound: reminderSound, vibrate: reminderVibrate, soundUri: reminderSoundUri || null }));
  };
  const pickTone = async () => {
    try {
      const r = await Ringtone.pick({ current: reminderSoundUri || null });
      if (r.uri) patchSettings({ reminderSoundUri: r.uri, reminderSoundName: r.title ?? 'Ton' });
    } catch {
      setNotifMsg('Ton-Auswahl nur in der App verfügbar.');
    }
  };

  const checkUpdate = async () => {
    setUpdateMsg('… suche');
    setUpdateUrl(null);
    const u = await checkForUpdate();
    if (!u) { setUpdateMsg('✕ Update-Prüfung fehlgeschlagen (kein Internet?)'); return; }
    if (u.available && u.apkUrl) {
      setUpdateUrl(u.apkUrl);
      setUpdateMsg(`⬆ Update ${u.latest.replace(/^mobile-v/, 'v')} verfügbar`);
    } else {
      setUpdateMsg(`✓ Aktuell (${u.current === 'dev' ? 'Entwicklungs-Build' : 'v' + u.current})`);
    }
  };

  // Pure reachability check on the URL as typed — saves nothing, loads nothing.
  // Same normalization as setBaseUrl, but WITHOUT persisting.
  const testConnection = async () => {
    const target = normalizeBaseUrl(url);
    if (!target) { setTestStatus('✕ Keine URL eingegeben'); return; }
    setTesting(true);
    setTestStatus('… teste');
    const t0 = performance.now();
    try {
      const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(5000) });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) { setTestStatus(`✕ Erreichbar, aber HTTP ${res.status} (${ms} ms)`); return; }
      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) { setTestStatus(`✕ Erreichbar, aber kein SelfManaged-Server (${ms} ms)`); return; }
      setTestStatus(`✓ Server erreichbar (${ms} ms)`);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
      setTestStatus(timedOut
        ? `✕ Zeitüberschreitung (${ms} ms) — Server nicht erreichbar`
        : `✕ Nicht erreichbar (${e instanceof Error ? e.message : 'Netzwerkfehler'})`);
    } finally {
      setTesting(false);
    }
  };

  // Test connects, SAVES the URL, and actually loads data — so "ok" means the
  // app is really talking to the backend (not just /health reachable).
  const testAndConnect = async () => {
    setBusy(true);
    setStatus('… verbinde');
    // setBaseUrl forces an absolute http(s):// URL; read it back normalized.
    setBaseUrl(url);
    const base = getBaseUrl();
    setUrl(base);
    try {
      // Verify it's really OUR backend: /health must return JSON {ok:true}.
      // (A wrong URL can resolve to the app's own localhost server and return
      // the SPA HTML with status 200 — that must NOT count as connected.)
      const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      const healthData = await health.json().catch(() => null);
      if (!health.ok || !healthData || healthData.ok !== true) {
        setStatus('✕ Kein SelfManaged-Server unter dieser URL');
        return;
      }
      const tasks = await (await fetch(`${base}/api/tasks`, { signal: AbortSignal.timeout(8000) })).json();
      if (!Array.isArray(tasks)) {
        setStatus('✕ Unerwartete Antwort von /api/tasks');
        return;
      }
      await loadAll();
      setStatus(`✓ Verbunden — ${tasks.length} Aufgaben geladen`);
    } catch (e) {
      setStatus(`✕ nicht erreichbar (${e instanceof Error ? e.message : 'Fehler'})`);
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try { await flushOutbox(); await loadAll(); } finally { setBusy(false); }
  };

  // ICS calendar feed URL (issue #24) — token-secured, for subscribing from an
  // external calendar app on the same network.
  const [feedUrl, setFeedUrl] = useState('');
  const [feedCopied, setFeedCopied] = useState(false);
  useEffect(() => {
    const base = getBaseUrl();
    if (!base) return;
    fetch(`${base}/api/calendar-feed`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((d) => { if (d?.token) setFeedUrl(`${base}/calendar/${d.token}.ics`); })
      .catch(() => {});
  }, []);
  const copyFeed = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 1500);
    } catch {
      /* WebView clipboard blocked — the code block stays selectable */
    }
  };

  return (
    <div className="m-modal-backdrop" onClick={onClose}>
      <div className="m-modal" onClick={(e) => e.stopPropagation()} style={swipe.style} {...swipe.handlers}>
        <div className="m-modal-head">
          <span className="m-title">Einstellungen</span>
          <button className="m-modal-x" onClick={onClose}>✕</button>
        </div>

        {IS_APPWRITE_PROD ? (
          // Appwrite-PROD: die Server-Adresse ist fest im Build verdrahtet
          // (kein manuell einzugebender LAN-Server mehr) und wird ueber die
          // Functions-Execution-API angesprochen, nicht per direktem fetch()
          // — ein Verbindungstest per rohem fetch() auf /health bzw.
          // /api/tasks schlaegt daher immer fehl (Appwrite verwirft dabei
          // still die Auth-Header), obwohl die App laengst verbunden ist und
          // Daten laedt. Diese ganze Sektion ist fuer Appwrite-Builds also
          // nur verwirrend, nicht funktional — durch eine reine Statusanzeige
          // ersetzt.
          <div className="m-settings-info">
            🟢 Appwrite-PROD verbunden<br />
            Geladene Aufgaben: <strong>{taskCount}</strong>
          </div>
        ) : (
          <>
            <label className="m-field">
              <span>Server-URL (Dev-Backend im WLAN)</span>
              <input
                value={url}
                placeholder="http://192.168.1.193:3002"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => { setUrl(e.target.value); setStatus(''); setTestStatus(''); }}
              />
            </label>

            <div className="m-settings-row">
              <button className="m-btn-ghost" style={{ flex: 1 }} onClick={testConnection} disabled={testing || !url.trim()}>
                {testing ? '… teste' : 'Verbindung testen'}
              </button>
              <button className="m-btn-ghost" style={{ flex: 1 }} onClick={testAndConnect} disabled={busy || !url.trim()}>
                {busy ? '… verbinde' : 'Verbinden & Daten laden'}
              </button>
            </div>
            {testStatus && (
              <div className={testStatus.startsWith('✓') ? 'm-ok' : testStatus.startsWith('✕') ? 'm-fail' : ''}>
                {testStatus}
              </div>
            )}
            {status && (
              <div className={status.startsWith('✓') ? 'm-ok' : status.startsWith('✕') ? 'm-fail' : ''}>
                {status}
              </div>
            )}

            <div className="m-settings-info">
              Aktive URL: <code>{getBaseUrl() || '(keine — Server-URL eingeben)'}</code><br />
              Geladene Aufgaben: <strong>{taskCount}</strong>
              {taskCount > 0 && ' — Daten sind da. Tabs sind gefiltert (Inbox = projektlos, Woche = bald fällig, Aktion = ★).'}
            </div>
          </>
        )}

        {/* Update near the top so the install button is easy to reach (#30). */}
        <button className="m-btn-ghost" onClick={checkUpdate}>⬆ Nach Updates suchen</button>
        {updateMsg && (
          <div className={updateMsg.startsWith('✓') ? 'm-ok' : updateMsg.startsWith('✕') ? 'm-fail' : ''}>
            {updateUrl ? (
              <button className="m-update-banner" onClick={() => openApk(updateUrl)}>
                {updateMsg} — tippen zum Installieren
              </button>
            ) : updateMsg}
          </div>
        )}
        <div className="m-settings-info">
          App-Version: <code>{APP_VERSION === 'dev' ? 'Entwicklungs-Build' : 'v' + APP_VERSION}</code>
        </div>

        {feedUrl && (
          <div className="m-settings-info">
            Kalender-Feed (ICS) — in Proton/Thunderbird abonnieren:<br />
            <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{feedUrl}</code>
            <button className="m-btn-ghost" onClick={copyFeed}>
              {feedCopied ? '✓ kopiert' : '📋 Link kopieren'}
            </button>
          </div>
        )}

        <div className="m-settings-info">
          🔔 Erinnerungen (fällige Aufgaben mit Uhrzeit)<br />
          <span className={notifMsg.startsWith('✓') ? 'm-ok' : notifMsg.startsWith('✕') ? 'm-fail' : ''}>{notifMsg}</span>
        </div>
        <label className="m-field">
          <span>Vorlaufzeit — wie lange vorher erinnern?</span>
          <select
            value={reminderLeadMin}
            onChange={(e) => patchSettings({ reminderLeadMin: Number(e.target.value) })}
          >
            <option value={0}>Zur Startzeit</option>
            <option value={5}>5 Minuten vorher</option>
            <option value={10}>10 Minuten vorher</option>
            <option value={15}>15 Minuten vorher</option>
            <option value={30}>30 Minuten vorher</option>
            <option value={60}>1 Stunde vorher</option>
          </select>
        </label>
        <label className="m-toggle">
          <input
            type="checkbox"
            checked={reminderSound}
            onChange={() => patchSettings({ reminderSound: reminderSound ? 0 : 1 })}
          />
          <span>Ton bei Erinnerung</span>
        </label>
        {reminderSound && (
          <div className="m-settings-info">
            Klingelton: <strong>{reminderSoundName}</strong>
            <button className="m-btn-ghost" onClick={pickTone}>🎵 Klingelton wählen</button>
          </div>
        )}
        <label className="m-toggle">
          <input
            type="checkbox"
            checked={reminderVibrate}
            onChange={() => patchSettings({ reminderVibrate: reminderVibrate ? 0 : 1 })}
          />
          <span>Vibration bei Erinnerung</span>
        </label>
        <button className="m-btn-ghost" onClick={testNotif}>🔔 Benachrichtigung testen (mit aktuellem Klang)</button>
        <div className="m-settings-hint">
          Erinnerungen gibt es für Aufgaben mit gesetzter Uhrzeit; die Vorlaufzeit
          gilt für alle. Änderungen wirken nach dem nächsten Sync (oder App-Neustart).
        </div>

        <button className="m-btn-ghost" onClick={syncNow} disabled={busy}>↻ Jetzt synchronisieren</button>
        <div className="m-settings-hint">
          Läuft automatisch, sobald wieder eine Verbindung besteht — dieser Knopf erzwingt es sofort.
        </div>

        <label className="m-toggle">
          <input
            type="checkbox"
            checked={theme === 'dark'}
            onChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          />
          <span>Dark Mode</span>
        </label>

        <div className="m-modal-foot">
          <button className="m-btn-save" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
