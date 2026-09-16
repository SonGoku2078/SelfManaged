import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useStore, DEFAULT_PALETTE } from '../store';
import type { MemberRole } from '../types';
import { importFromNozbeApi, mapNozbe, loginNozbe, type NozbeExport } from '../nozbe';
import { playAlarm, startFocusSound, stopFocusSound, unlockAudio } from '../pomodoroSound';
import { APP_VERSION, BUILD_TIME, apiEnvironment, fetchReleasedVersions, type ReleasedVersions } from '../version';
import { getBaseUrl } from '../api/client';
import { copyToClipboard } from '../clipboard';
import { account, IS_APPWRITE_PROD } from '../appwrite/client';
import './SettingsView.css';

const POMO_ALARM_OPTIONS = [
  { value: 'bell', label: 'Glocke' },
  { value: 'kitchen', label: 'Küchenwecker' },
  { value: 'digital', label: 'Digital' },
  { value: 'chime', label: 'Chime' },
  { value: 'wood', label: 'Holzblock' },
];
const POMO_FOCUS_OPTIONS = [
  { value: 'none', label: 'Keiner' },
  { value: 'ticking-slow', label: 'Ticken langsam' },
  { value: 'ticking-fast', label: 'Ticken schnell' },
  { value: 'white-noise', label: 'Weißes Rauschen' },
  { value: 'brown-noise', label: 'Braunes Rauschen' },
];

const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'Admin (alle Rechte)',
  editor: 'Editor (bearbeiten)',
  viewer: 'Betrachter (nur lesen)',
};

export default function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setUserName = useStore((s) => s.setUserName);
  const setTheme = useStore((s) => s.setTheme);
  const members = useStore((s) => s.members);
  const addMember = useStore((s) => s.addMember);
  const updateMember = useStore((s) => s.updateMember);
  const deleteMember = useStore((s) => s.deleteMember);
  const addTask = useStore((s) => s.addTask);
  const setView = useStore((s) => s.setView);
  const replaceWithNozbe = useStore((s) => s.replaceWithNozbe);
  const connectNozbe = useStore((s) => s.connectNozbe);
  const disconnectNozbe = useStore((s) => s.disconnectNozbe);
  const setNozbeSync = useStore((s) => s.setNozbeSync);
  const clearAll = useStore((s) => s.clearAll);

  const [migrateStatus, setMigrateStatus] = useState('');
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [emailText, setEmailText] = useState('');
  const [importInfo, setImportInfo] = useState('');

  const [nzToken, setNzToken] = useState(settings.nozbe?.token ?? '');
  const [nzClientId, setNzClientId] = useState(settings.nozbe?.clientId ?? '');
  const [nzBusy, setNzBusy] = useState(false);
  const [nzStatus, setNzStatus] = useState('');

  const [nzEmail, setNzEmail] = useState('');
  const [nzPassword, setNzPassword] = useState('');
  const [nzLoginBusy, setNzLoginBusy] = useState(false);

  const connected = !!settings.nozbe;

  const doLogin = async () => {
    if (!nzEmail.trim() || !nzPassword) {
      setNzStatus('Bitte E-Mail und Passwort eingeben.');
      return;
    }
    if (!nzToken.trim()) {
      setNzStatus('Bitte deinen API-Schlüssel eingeben (Nozbe → Einstellungen → API-Schlüssel).');
      return;
    }
    setNzLoginBusy(true);
    setNzStatus('Melde bei Nozbe an…');
    try {
      const auth = await loginNozbe(nzEmail.trim(), nzPassword, nzToken.trim());
      setNzToken(auth.token);
      setNzClientId(auth.clientId);
      connectNozbe(auth.token, auth.clientId);
      setNzPassword('');
      setNzStatus('✅ Eingeloggt & verbunden. Client-ID automatisch ermittelt, Token lokal gespeichert.');
    } catch (err) {
      setNzStatus(
        `❌ ${err instanceof Error ? err.message : String(err)} (Login funktioniert nur unter "npm run dev").`
      );
    } finally {
      setNzLoginBusy(false);
    }
  };

  const inboxAddress = 'inbox@nozbe-clone.local';

  const applyImport = (data: ReturnType<typeof mapNozbe>) => {
    if (
      !window.confirm(
        `${data.tasks.length} Aufgaben, ${data.projects.length} Projekte, ${data.categories.length} Kategorien importieren?\n\nACHTUNG: Bestehende lokale Aufgaben/Projekte/Kategorien werden ERSETZT.`
      )
    ) {
      setNzStatus('Abgebrochen.');
      return;
    }
    const r = replaceWithNozbe(data);
    setNzStatus(
      `✅ Importiert: ${r.tasks} Aufgaben, ${r.projects} Projekte, ${r.categories} Kategorien.`
    );
  };

  const importDirect = async () => {
    if (!nzToken.trim() || !nzClientId.trim()) {
      setNzStatus('Bitte Access Token und Client-ID eingeben.');
      return;
    }
    setNzBusy(true);
    setNzStatus('Lade aus Nozbe…');
    try {
      const data = await importFromNozbeApi(nzToken.trim(), nzClientId.trim());
      applyImport(data);
    } catch (err) {
      setNzStatus(
        `❌ Fehler: ${err instanceof Error ? err.message : String(err)} (Direkt-Import funktioniert nur unter "npm run dev").`
      );
    } finally {
      setNzBusy(false);
    }
  };

  const importJsonFile = (file: File | undefined) => {
    if (!file) return;
    setNzStatus('Lese Datei…');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        // Accept {tasks,projects,contexts} or a bare task array.
        const raw: NozbeExport = Array.isArray(parsed) ? { tasks: parsed } : parsed;
        applyImport(mapNozbe(raw));
      } catch (err) {
        setNzStatus(
          `❌ Ungültige JSON-Datei: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    };
    reader.readAsText(file);
  };

  const importEmail = () => {
    const raw = emailText.trim();
    if (!raw) return;
    const lines = raw.split('\n');
    const subjectLine = lines.find((l) => /^subject:/i.test(l.trim()));
    const title = subjectLine
      ? subjectLine.replace(/^subject:/i, '').trim()
      : lines[0].trim();
    const body = subjectLine
      ? raw
      : lines.slice(1).join('\n').trim();
    addTask({ title: title || 'E-Mail-Aufgabe', description: body, projectId: null });
    setEmailText('');
    setImportInfo(`Aufgabe „${title || 'E-Mail-Aufgabe'}" in der Inbox angelegt.`);
  };

  const submitMember = () => {
    const name = memberName.trim();
    if (name) addMember(name);
    setMemberName('');
  };

  const env = apiEnvironment(getBaseUrl(), window.location.origin);

  return (
    <div className="settings-view">
      <VersionSection env={env} />

      <section className="settings-section">
        <h3 className="settings-heading">Profil</h3>
        <label className="settings-label">Dein Name</label>
        <input
          className="settings-input"
          value={settings.userName}
          onChange={(e) => setUserName(e.target.value || 'Du')}
        />
        <p className="settings-hint">
          Wird als Autor von Kommentaren und in der Aktivität verwendet.
        </p>
      </section>

      <AccountSection />

      <MobileAccessSection />

      <CalendarFeedSection />

      <PomodoroSection />

      <ProdImportSection />

      <section className="settings-section">
        <h3 className="settings-heading">Darstellung</h3>
        <div className="theme-toggle">
          <button
            className={`theme-btn ${settings.theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
          >
            ☀️ Hell
          </button>
          <button
            className={`theme-btn ${settings.theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
          >
            🌙 Dunkel
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Team (lokal)</h3>
        <p className="settings-hint">
          Lokale Mitglieder & Rollen. Hinweis: In diesem MVP ohne Backend gibt es
          keine echte Synchronisation oder Rechte-Durchsetzung — die Rollen sind
          organisatorisch.
        </p>
        <div className="member-list">
          {members.length === 0 && (
            <p className="settings-hint">Noch keine Mitglieder hinzugefügt.</p>
          )}
          {members.map((m) => (
            <div className="member-row" key={m.id}>
              <span className="member-avatar" style={{ background: m.color }}>
                {m.name.charAt(0).toUpperCase()}
              </span>
              <span className="member-name">{m.name}</span>
              <select
                className="member-role"
                value={m.role}
                onChange={(e) =>
                  updateMember(m.id, { role: e.target.value as MemberRole })
                }
              >
                {(Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <button
                className="member-del"
                title="Entfernen"
                onClick={() => deleteMember(m.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="member-add">
          <input
            className="settings-input"
            placeholder="Name des Mitglieds…"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitMember();
            }}
          />
          <button className="btn btn-primary" onClick={submitMember}>
            Einladen
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">
          Nozbe-Verbindung {connected && <span className="nz-badge">verbunden</span>}
        </h3>
        <p className="settings-hint">
          Verbinde dein Nozbe-Classic-Konto, um Aufgaben zu importieren und den Erledigt-Status
          live zurück zu Nozbe zu synchronisieren. <strong>Hinweis:</strong> Der Token wird beim
          Verbinden lokal (im Browser) gespeichert; mit „Trennen" wird er gelöscht. Sync läuft
          über einen Dev-Proxy und funktioniert nur unter
          <code className="settings-code"> npm run dev</code>.
        </p>

        <div className="nz-login">
          <h4 className="nz-subhead">Anmelden & verbinden</h4>
          <label className="settings-label">Nozbe E-Mail</label>
          <input
            className="settings-input"
            type="email"
            value={nzEmail}
            onChange={(e) => setNzEmail(e.target.value)}
            placeholder="du@example.com"
            autoComplete="off"
          />
          <label className="settings-label" style={{ marginTop: 10 }}>
            Nozbe Passwort
          </label>
          <input
            className="settings-input"
            type="password"
            value={nzPassword}
            onChange={(e) => setNzPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') doLogin();
            }}
          />
          <label className="settings-label" style={{ marginTop: 10 }}>
            API-Schlüssel
          </label>
          <input
            className="settings-input"
            type="password"
            value={nzToken}
            onChange={(e) => setNzToken(e.target.value)}
            placeholder="API-Schlüssel (Nozbe → Einstellungen → API-Schlüssel)"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') doLogin();
            }}
          />
          <div className="email-import-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={doLogin} disabled={nzLoginBusy}>
              {nzLoginBusy ? 'Melde an…' : 'Einloggen & verbinden'}
            </button>
          </div>
          <p className="settings-hint">
            E-Mail + Passwort ermitteln deine <strong>Client-ID</strong> automatisch; der
            API-Schlüssel ist dein Access Token. Das Passwort wird nur an Nozbe gesendet (über
            den Dev-Proxy) und <strong>nicht gespeichert</strong>.
          </p>
        </div>

        <label className="settings-label">Client-ID (automatisch ermittelt)</label>
        <input
          className="settings-input"
          value={nzClientId}
          onChange={(e) => setNzClientId(e.target.value)}
          placeholder="wird beim Einloggen automatisch gesetzt"
          autoComplete="off"
        />

        <div className="email-import-actions" style={{ marginTop: 12 }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (nzToken.trim() && nzClientId.trim()) {
                connectNozbe(nzToken.trim(), nzClientId.trim());
                setNzStatus('✅ Verbunden. Token lokal gespeichert.');
              } else {
                setNzStatus('Bitte Access Token und Client-ID eingeben.');
              }
            }}
          >
            {connected ? 'Verbindung aktualisieren' : 'Verbinden & speichern'}
          </button>
          {connected && (
            <button
              className="btn btn-danger"
              onClick={() => {
                disconnectNozbe();
                setNzStatus('Verbindung getrennt, Token gelöscht.');
              }}
            >
              Trennen
            </button>
          )}
        </div>

        {connected && (
          <label className="nz-sync-toggle">
            <input
              type="checkbox"
              checked={settings.nozbe?.syncCompleted ?? false}
              onChange={(e) => setNozbeSync(e.target.checked)}
            />
            Erledigt-Status live zu Nozbe synchronisieren (Abhaken hier → erledigt in Nozbe)
          </label>
        )}

        <h3 className="settings-heading" style={{ marginTop: 20 }}>
          Import
        </h3>
        <p className="settings-hint">
          Importiert Projekte, Kontexte (→ Kategorien) und Aufgaben.{' '}
          <strong>Achtung:</strong> ersetzt die bestehenden lokalen Daten.
        </p>
        <div className="email-import-actions">
          <button className="btn btn-primary" onClick={importDirect} disabled={nzBusy}>
            {nzBusy ? 'Importiere…' : 'Aus Nozbe importieren'}
          </button>
          <label className="btn btn-secondary nz-file-btn">
            JSON-Datei importieren
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                importJsonFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="settings-hint">
          Direkt-Import nur unter <code className="settings-code">npm run dev</code> (Dev-Proxy).
          Alternativ per <code className="settings-code">scripts/nozbe-export.ps1</code> exportieren
          und die JSON-Datei hochladen.
        </p>
        {nzStatus && <p className="settings-hint">{nzStatus}</p>}
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Daten zurücksetzen</h3>
        <p className="settings-hint">
          Löscht <strong>alle</strong> lokalen Aufgaben, Projekte und Kategorien — z. B.
          um vor einem frischen Nozbe-Import sauber zu starten. Die Nozbe-Verbindung
          bleibt bestehen. <strong>Kann nicht rückgängig gemacht werden.</strong>
        </p>
        <div className="email-import-actions" style={{ marginBottom: 16 }}>
          <button
            className="btn btn-primary"
            disabled={migrateBusy}
            onClick={async () => {
              const raw = localStorage.getItem('nozbe-clone-state');
              if (!raw) {
                setMigrateStatus('Keine localStorage-Daten gefunden. Möglicherweise bereits migriert.');
                return;
              }
              if (!window.confirm('LocalStorage-Daten einmalig in die SQLite-Datenbank übertragen?\n\nBestehende Serverdaten werden dabei ÜBERSCHRIEBEN.')) return;
              setMigrateBusy(true);
              setMigrateStatus('Übertrage…');
              try {
                const res = await fetch('/api/migrate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: raw,
                });
                const json = await res.json() as { tasks?: number; error?: string };
                if (!res.ok) throw new Error(json.error ?? String(res.status));
                setMigrateStatus(`Migration erfolgreich: ${json.tasks ?? '?'} Aufgaben übertragen. Seite wird neu geladen…`);
                setTimeout(() => window.location.reload(), 2000);
              } catch (e) {
                setMigrateStatus(`Fehler: ${(e as Error).message}`);
              } finally {
                setMigrateBusy(false);
              }
            }}
          >
            {migrateBusy ? 'Wird übertragen…' : 'LocalStorage → SQLite migrieren'}
          </button>
        </div>
        {migrateStatus && <p className="settings-hint">{migrateStatus}</p>}

        <div className="email-import-actions">
          <button
            className="btn btn-danger"
            onClick={() => {
              if (
                window.confirm(
                  'Wirklich ALLE Aufgaben, Projekte und Kategorien löschen? Das kann nicht rückgängig gemacht werden.'
                )
              ) {
                clearAll();
                setNzStatus('🗑️ Alle Aufgaben, Projekte und Kategorien gelöscht.');
              }
            }}
          >
            Alle Aufgaben & Projekte löschen
          </button>
        </div>
        {nzStatus && <p className="settings-hint">{nzStatus}</p>}
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">E-Mail zu Aufgabe</h3>
        <p className="settings-hint">
          Demo ohne echten Mailserver: Deine (fiktive) Inbox-Adresse lautet{' '}
          <code className="settings-code">{inboxAddress}</code>. Füge unten eine
          E-Mail ein (optional mit „Subject:"-Zeile) — daraus wird eine Aufgabe in
          deiner Inbox.
        </p>
        <textarea
          className="settings-input settings-textarea"
          placeholder={'Subject: Angebot prüfen\n\nBitte das Angebot von Firma X bis Freitag prüfen.'}
          value={emailText}
          onChange={(e) => setEmailText(e.target.value)}
        />
        <div className="email-import-actions">
          <button className="btn btn-primary" onClick={importEmail}>
            Als Aufgabe anlegen
          </button>
          {importInfo && (
            <button
              className="btn btn-secondary"
              onClick={() => setView('inbox')}
            >
              Zur Inbox
            </button>
          )}
        </div>
        {importInfo && <p className="settings-hint">✅ {importInfo}</p>}
      </section>

      <ColorPaletteSection />
    </div>
  );
}

const EMPTY_COLOR_LABELS: Record<string, string> = {};

// Shows this PC's current LAN address(es) so you can type them into the mobile
// app (⚙ Server-URL). The IP can change (DHCP) — this always reflects the current one.
// #56/#84: Was laeuft hier, gegen welche Umgebung — und was ist auf den
// anderen Plattformen zuletzt veroeffentlicht worden?
function VersionSection({ env }: { env: ReturnType<typeof apiEnvironment> }) {
  const [released, setReleased] = useState<ReleasedVersions | null>(null);
  const [releasedLoaded, setReleasedLoaded] = useState(false);
  // Version der Desktop-App, falls die Seite dort laeuft (Bridge aus #62/#84).
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    fetchReleasedVersions().then((r) => { if (on) { setReleased(r); setReleasedLoaded(true); } });
    // window.tm existiert nur in der Desktop-App; getAppVersion erst ab 1.4.0,
    // deshalb defensiv (aeltere EXE zeigt einfach nichts an).
    const tm = (window as unknown as { tm?: { getAppVersion?: () => Promise<string> } }).tm;
    tm?.getAppVersion?.().then((v) => { if (on) setDesktopVersion(v); }).catch(() => {});
    return () => { on = false; };
  }, []);

  const pub = (v: string | null) =>
    !releasedLoaded ? '…' : (v ?? 'nicht abrufbar');

  return (
    <section className="settings-section">
      <h3 className="settings-heading">ℹ️ Version & Umgebung</h3>
      <div className="settings-version">
        <div className="version-row">
          <span className="version-key">Diese App</span>
          <code>{APP_VERSION}</code>
          <span className="version-note">Web{desktopVersion ? ` · Desktop ${desktopVersion}` : ''}</span>
        </div>
        <div className="version-row">
          <span className="version-key">Build</span>
          <code>{BUILD_TIME ? new Date(BUILD_TIME).toLocaleString('de-DE') : '—'}</code>
        </div>
        <div className="version-row">
          <span className="version-key">Profil</span>
          <code>{(import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE}</code>
        </div>
        <div className="version-row">
          <span className="version-key">Server</span>
          <code>{env.url}</code>
          <span className={`env-badge env-${env.kind}`}>{env.label}</span>
        </div>
      </div>

      <h4 className="settings-subheading">Zuletzt veröffentlicht</h4>
      <div className="settings-version">
        <div className="version-row">
          <span className="version-key">Desktop</span>
          <code>{pub(released?.desktop ?? null)}</code>
          {desktopVersion && released?.desktop && !released.desktop.endsWith(desktopVersion) && (
            <span className="env-badge env-custom">Update verfügbar</span>
          )}
        </div>
        <div className="version-row">
          <span className="version-key">Android</span>
          <code>{pub(released?.mobile ?? null)}</code>
          <span className="version-note">installierte Version siehe Handy-Einstellungen</span>
        </div>
      </div>
    </section>
  );
}

// Appwrite-PROD only (#98): self-service E-Mail-/Passwort-Änderung für den
// eingeloggten Benutzer. Ohne Appwrite gibt es keinen eigenen Login (die
// klassische Express/SQLite-Instanz kennt keine Benutzerkonten), daher
// rendert diese Sektion außerhalb von IS_APPWRITE_PROD nichts.
function AccountSection() {
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [emailPassword, setEmailPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordRepeat, setNewPasswordRepeat] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    if (!IS_APPWRITE_PROD) return;
    let on = true;
    account.get()
      .then((a) => { if (on) { setEmail(a.email); setLoaded(true); } })
      .catch(() => { if (on) setLoaded(true); });
    return () => { on = false; };
  }, []);

  if (!IS_APPWRITE_PROD) return null;

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setEmailStatus('');
    const trimmed = newEmail.trim();
    if (!trimmed) { setEmailStatus('Neue E-Mail-Adresse eingeben.'); return; }
    if (!emailPassword) { setEmailStatus('Aktuelles Passwort zur Bestätigung eingeben.'); return; }
    setEmailBusy(true);
    try {
      await account.updateEmail({ email: trimmed, password: emailPassword });
      setEmail(trimmed);
      setNewEmail('');
      setEmailPassword('');
      setEmailStatus('✓ E-Mail-Adresse geändert.');
    } catch (err) {
      setEmailStatus(err instanceof Error ? err.message : 'Ändern fehlgeschlagen.');
    } finally {
      setEmailBusy(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordStatus('');
    if (newPassword.length < 8) { setPasswordStatus('Neues Passwort braucht mindestens 8 Zeichen.'); return; }
    if (newPassword !== newPasswordRepeat) { setPasswordStatus('Die beiden neuen Passwörter stimmen nicht überein.'); return; }
    if (!oldPassword) { setPasswordStatus('Aktuelles Passwort eingeben.'); return; }
    setPasswordBusy(true);
    try {
      await account.updatePassword({ password: newPassword, oldPassword });
      setOldPassword('');
      setNewPassword('');
      setNewPasswordRepeat('');
      setPasswordStatus('✓ Passwort geändert.');
    } catch (err) {
      setPasswordStatus(err instanceof Error ? err.message : 'Ändern fehlgeschlagen.');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <h3 className="settings-heading">🔐 Konto</h3>
      <p className="settings-hint">
        Angemeldet als <strong>{loaded ? email : '…'}</strong>. Weitere Login-Konten (für andere
        Personen oder Geräte) werden derzeit noch in der Appwrite-Konsole angelegt, nicht hier.
      </p>

      <form onSubmit={submitEmail} className="settings-account-form">
        <label className="settings-label">Neue E-Mail-Adresse</label>
        <input
          className="settings-input"
          type="email"
          autoComplete="username"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <label className="settings-label">Aktuelles Passwort (zur Bestätigung)</label>
        <input
          className="settings-input"
          type="password"
          autoComplete="current-password"
          value={emailPassword}
          onChange={(e) => setEmailPassword(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={emailBusy}>
          E-Mail-Adresse ändern
        </button>
        {emailStatus && <p className="settings-hint">{emailStatus}</p>}
      </form>

      <form onSubmit={submitPassword} className="settings-account-form">
        <label className="settings-label">Aktuelles Passwort</label>
        <input
          className="settings-input"
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
        <label className="settings-label">Neues Passwort</label>
        <input
          className="settings-input"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <label className="settings-label">Neues Passwort wiederholen</label>
        <input
          className="settings-input"
          type="password"
          autoComplete="new-password"
          value={newPasswordRepeat}
          onChange={(e) => setNewPasswordRepeat(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={passwordBusy}>
          Passwort ändern
        </button>
        {passwordStatus && <p className="settings-hint">{passwordStatus}</p>}
      </form>
    </section>
  );
}

function MobileAccessSection() {
  const [ips, setIps] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let on = true;
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d) => {
        if (!on) return;
        // `host` kommt aus der Anfrage und ist damit erreichbar; die rohen
        // `ips` sind im Docker-Betrieb Container-Adressen (#79). Deshalb den
        // Anfrage-Host zuerst und Doppelungen vermeiden.
        const list: string[] = [];
        if (typeof d.host === 'string' && d.host && d.host !== 'localhost') list.push(d.host);
        for (const ip of Array.isArray(d.ips) ? d.ips : []) if (!list.includes(ip)) list.push(ip);
        setIps(list);
        setLoaded(true);
      })
      .catch(() => { if (on) setLoaded(true); });
    return () => { on = false; };
  }, []);
  return (
    <section className="settings-section">
      <h3 className="settings-heading">📱 Mobile-Zugriff (WLAN)</h3>
      <p className="settings-hint">
        Diese Adresse im Handy unter ⚙ „Server-URL" eintragen (Handy im selben WLAN).
      </p>
      {!loaded ? (
        <p className="settings-hint">…</p>
      ) : ips.length === 0 ? (
        <p className="settings-hint">Keine LAN-Adresse gefunden (evtl. nicht im WLAN).</p>
      ) : (
        <ul className="settings-lan-list">
          {ips.map((ip) => (
            <li key={ip}>
              <code>http://{ip}:3002</code> <span className="settings-lan-tag dev">DEV/TEST</span><br />
              <code>http://{ip}:3001</code> <span className="settings-lan-tag prod">PROD</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Subscribable ICS feed (issue #24): shows the token-secured calendar URLs so
// an external calendar (Proton, Thunderbird — same LAN) can subscribe.
function CalendarFeedSection() {
  const [urls, setUrls] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    fetch('/api/calendar-feed')
      .then((r) => r.json())
      .then((d) => { if (on) { setUrls(Array.isArray(d.urls) ? d.urls : []); setLoaded(true); } })
      .catch(() => { if (on) setLoaded(true); });
    return () => { on = false; };
  }, []);
  const copy = async (u: string) => {
    const ok = await copyToClipboard(u);
    // Erfolg nur melden, wenn wirklich kopiert wurde (#80): frueher lief
    // setCopied auch im Fehlerfall und die Schaltflaeche log.
    setCopied(ok ? u : null);
    setCopyFailed(ok ? null : u);
    window.setTimeout(() => { setCopied(null); setCopyFailed(null); }, ok ? 1500 : 4000);
  };
  return (
    <section className="settings-section">
      <h3 className="settings-heading">📆 Kalender-Feed (ICS)</h3>
      <p className="settings-hint">
        Diese URL in Proton Kalender / Thunderbird als Abonnement eintragen („Kalender
        abonnieren" / „Im Netzwerk"). Das Aktualisierungs-Intervall bestimmt die Kalender-App.
        Der Link enthält ein geheimes Token — nicht öffentlich teilen.
      </p>
      {!loaded ? (
        <p className="settings-hint">…</p>
      ) : urls.length === 0 ? (
        <p className="settings-hint">Feed nicht verfügbar (Server offline?).</p>
      ) : (
        <ul className="settings-lan-list">
          {urls.map((u) => (
            <li key={u}>
              <code>{u}</code>{' '}
              <button className="theme-btn" onClick={() => copy(u)}>
                {copied === u ? '✓ kopiert' : copyFailed === u ? '✕ nicht kopiert' : '📋 Kopieren'}
              </button>
              {copyFailed === u && (
                <p className="settings-hint settings-copy-failed">
                  Kopieren nicht möglich — URL markieren und Strg+C drücken.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// DEV only (#29): replace the dev database with a snapshot of production.
// Renders nothing unless the backend reports the dev port; the server refuses
// the request on prod anyway (403).
function ProdImportSection() {
  const [port, setPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let on = true;
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d) => { if (on) setPort(d.port); })
      .catch(() => {});
    return () => { on = false; };
  }, []);
  if (port !== 3002) return null;
  const run = async () => {
    if (!window.confirm('PROD-Daten in die DEV-Datenbank importieren? ALLE DEV-Daten werden ersetzt.')) return;
    if (!window.confirm('Wirklich sicher? Ein Backup der dev.db wird automatisch angelegt, aber der aktuelle DEV-Stand geht verloren.')) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/admin/import-prod', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      await useStore.getState().loadAll();
      setMsg(`✓ Import erfolgreich: ${d.counts.tasks} Aufgaben, ${d.counts.projects} Projekte, ${d.counts.categories} Kategorien, ${d.counts.activity_log} Aktivitäten.`);
    } catch (e) {
      setMsg(`✕ Fehler: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section">
      <h3 className="settings-heading">🧪 DEV: Produktionsdaten importieren</h3>
      <p className="settings-hint">
        Ersetzt ALLE Daten der DEV-Datenbank (dev.db) durch eine Kopie der Produktion.
        Die Produktion wird dabei nur gelesen; vorher wird automatisch ein Backup der
        dev.db angelegt (~/.task-manager/backups). Hinweis: Auch Einstellungen inkl.
        Kalender-Feed-Token werden übernommen. Am besten ausführen, wenn in PROD gerade
        nicht gearbeitet wird.
      </p>
      <button className="settings-danger-btn" disabled={busy} onClick={run}>
        {busy ? '… importiere' : '⬇ PROD → DEV importieren'}
      </button>
      {msg && <p className="settings-hint">{msg}</p>}
    </section>
  );
}

// Pomodoro interval settings (#3); the timer itself lives in the header.
function PomodoroSection() {
  const settings = useStore((s) => s.settings);
  const setPomodoroSettings = useStore((s) => s.patchSettings);
  const fields: { key: 'pomodoroFocusMin' | 'pomodoroBreakMin' | 'pomodoroLongBreakMin' | 'pomodoroRounds'; label: string; def: number; min: number; max: number }[] = [
    { key: 'pomodoroFocusMin', label: 'Fokus (Minuten)', def: 25, min: 1, max: 120 },
    { key: 'pomodoroBreakMin', label: 'Pause (Minuten)', def: 5, min: 1, max: 60 },
    { key: 'pomodoroLongBreakMin', label: 'Lange Pause (Minuten)', def: 15, min: 5, max: 90 },
    { key: 'pomodoroRounds', label: 'Runden bis zur langen Pause', def: 4, min: 1, max: 12 },
  ];
  const toggles: { key: 'pomodoroAutoStartBreaks' | 'pomodoroAutoStartPomodoros'; label: string; def: number }[] = [
    { key: 'pomodoroAutoStartBreaks', label: 'Pausen automatisch starten', def: 0 },
    { key: 'pomodoroAutoStartPomodoros', label: 'Nächsten Fokus automatisch starten', def: 0 },
  ];
  const alarmSound = settings.pomodoroAlarmSound ?? 'bell';
  const alarmVolume = settings.pomodoroAlarmVolume ?? 50;
  const alarmRepeat = settings.pomodoroAlarmRepeat ?? 1;
  const focusSound = settings.pomodoroFocusSound ?? 'none';
  const focusVolume = settings.pomodoroFocusVolume ?? 50;
  const testFocus = () => {
    unlockAudio();
    if (focusSound === 'none') return;
    startFocusSound(focusSound, focusVolume);
    window.setTimeout(stopFocusSound, 2500);
  };
  return (
    <section className="settings-section">
      <h3 className="settings-heading">🍅 Pomodoro-Timer</h3>
      <p className="settings-hint">
        Der Mini-Timer sitzt oben rechts (▶ startet); ein Klick auf die Zeit öffnet das
        Pomodoro-Fenster. In „Heute"/„Next Week" startet 🍅 an einer Aufgabe den Timer dafür.
      </p>
      <div className="settings-pomodoro-grid">
        {fields.map((f) => (
          <label key={f.key} className="settings-label settings-pomodoro-field">
            {f.label}
            <input
              className="settings-input"
              type="number"
              min={f.min}
              max={f.max}
              value={settings[f.key] ?? f.def}
              onChange={(e) => {
                const v = Math.max(f.min, Math.min(f.max, Number(e.target.value) || f.def));
                setPomodoroSettings({ [f.key]: v });
              }}
            />
          </label>
        ))}
      </div>

      <h4 className="settings-subheading">🔊 Sound</h4>
      <div className="settings-sound">
        <div className="settings-sound-row">
          <span className="settings-sound-label">Alarm-Ton</span>
          <select
            className="settings-input settings-sound-select"
            value={alarmSound}
            onChange={(e) => setPomodoroSettings({ pomodoroAlarmSound: e.target.value })}
          >
            {POMO_ALARM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            className="settings-sound-vol"
            type="range" min={0} max={100}
            value={alarmVolume}
            title={`Lautstärke ${alarmVolume}`}
            onChange={(e) => setPomodoroSettings({ pomodoroAlarmVolume: Number(e.target.value) })}
          />
          <label className="settings-sound-repeat">
            Wdh.
            <input
              type="number" min={1} max={5}
              value={alarmRepeat}
              onChange={(e) => setPomodoroSettings({ pomodoroAlarmRepeat: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
            />
          </label>
          <button
            className="settings-sound-test"
            type="button"
            onClick={() => { unlockAudio(); playAlarm(alarmSound, alarmVolume, alarmRepeat); }}
          >▶ Test</button>
        </div>
        <div className="settings-sound-row">
          <span className="settings-sound-label">Fokus-Sound</span>
          <select
            className="settings-input settings-sound-select"
            value={focusSound}
            onChange={(e) => setPomodoroSettings({ pomodoroFocusSound: e.target.value })}
          >
            {POMO_FOCUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            className="settings-sound-vol"
            type="range" min={0} max={100}
            value={focusVolume}
            title={`Lautstärke ${focusVolume}`}
            onChange={(e) => setPomodoroSettings({ pomodoroFocusVolume: Number(e.target.value) })}
          />
          <button className="settings-sound-test" type="button" onClick={testFocus} disabled={focusSound === 'none'}>▶ Test</button>
        </div>
      </div>

      <div className="settings-pomodoro-toggles">
        {toggles.map((t) => (
          <label key={t.key} className="settings-check">
            <input
              type="checkbox"
              checked={(settings[t.key] ?? t.def) === 1}
              onChange={(e) => setPomodoroSettings({ [t.key]: e.target.checked ? 1 : 0 })}
            />
            {t.label}
          </label>
        ))}
      </div>
    </section>
  );
}

function ColorPaletteSection() {
  const colorPalette = useStore((s) => s.settings.colorPalette ?? DEFAULT_PALETTE);
  const colorLabels = useStore((s) => s.settings.colorLabels && typeof s.settings.colorLabels === 'object' ? s.settings.colorLabels : EMPTY_COLOR_LABELS);
  const addPaletteColor = useStore((s) => s.addPaletteColor);
  const removePaletteColor = useStore((s) => s.removePaletteColor);
  const setColorLabel = useStore((s) => s.setColorLabel);
  const [newColor, setNewColor] = useState('#888888');
  const [newLabel, setNewLabel] = useState('');

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Projektfarben</h2>
      <p className="settings-hint">
        Jeder Farbe kann eine Bedeutung zugewiesen werden. Die Bezeichnung erscheint im Farb-Picker der Projekte.
      </p>

      <div className="color-palette-list">
        {colorPalette.map((c) => (
          <div key={c} className="color-palette-row">
            <span className="color-palette-dot" style={{ background: c }} />
            <input
              className="settings-input color-label-input"
              value={colorLabels[c] ?? ''}
              placeholder="Bezeichnung (z.B. Lifestyle)"
              onChange={(e) => setColorLabel(c, e.target.value)}
            />
            <span className="color-palette-hex">{c}</span>
            <button
              className="color-palette-del"
              title="Farbe entfernen"
              onClick={() => removePaletteColor(c)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="color-palette-add">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="color-palette-picker"
          title="Farbe wählen"
        />
        <input
          className="settings-input color-label-input"
          value={newLabel}
          placeholder="Bezeichnung (optional)"
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              addPaletteColor(newColor);
              if (newLabel.trim()) setColorLabel(newColor, newLabel.trim());
              setNewLabel('');
            }
          }}
        />
        <button
          className="btn btn-primary"
          onClick={() => {
            addPaletteColor(newColor);
            if (newLabel.trim()) setColorLabel(newColor, newLabel.trim());
            setNewLabel('');
          }}
        >
          + Hinzufügen
        </button>
      </div>
    </section>
  );
}
