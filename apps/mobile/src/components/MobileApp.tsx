import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useStore } from '../store';
import { outboxOnChange, getBaseUrl, flushOutbox } from '../api';
import { IS_APPWRITE_PROD } from '../../../../src/appwrite/client';
import { useAutoSync } from '../useAutoSync';
import { useNavHistory } from '../useNavHistory';
import { useHorizontalSwipe, usePullToRefresh } from '../gestures';
import Navigation from './Navigation';
import QuickAdd from './QuickAdd';
import Projects from './Projects';
import Inbox from './Inbox';
import Today from './Today';
import NextWeek from './NextWeek';
import NextAction from './NextAction';
import Calendar from './Calendar';
import TaskDetailModal from './TaskDetailModal';
import Settings from './Settings';
import ShareCapture from './ShareCapture';
import Search from './Search';
import { checkForUpdate, openApk, type UpdateInfo } from '../update';
import { consumeSharedIntent, onShareReceived, type SharedPayload } from '../shareTarget';
import { ensureNotificationPermission, scheduleReminders, onReminderTap } from '../notifications';
import { publishWidgetData } from '../widgetBridge';

const TAB_TITLE: Record<string, string> = {
  projekte: 'Projekte',
  inbox: 'Inbox',
  today: 'Heute',
  nextweek: 'Next Week',
  nextaction: 'Next Action',
  calendar: 'Kalender',
};

export default function MobileApp() {
  const theme = useStore((s) => s.settings.theme);
  const dataLoaded = useStore((s) => s.dataLoaded);
  const loadAll = useStore((s) => s.loadAll);
  const [pending, setPending] = useState(0);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [share, setShare] = useState<SharedPayload | null>(null);
  const serverOnline = useAutoSync();

  // All navigable UI (tab, project drill-down, task detail, settings/search
  // overlays) lives in a history stack so back/forward (swipe + hardware back)
  // work like a browser. `share` stays outside — it's a transient capture flow.
  const nav = useNavHistory();
  const { tab, projectId, taskId, overlay } = nav.state;
  const openTask = (id: string) => nav.navigate({ taskId: id, overlay: null });
  const openProject = (id: string) => nav.navigate({ tab: 'projekte', projectId: id, taskId: null, overlay: null });
  const changeTab = (t: typeof tab) => nav.navigate({ tab: t, projectId: null, taskId: null, overlay: null });

  const syncNow = () => { flushOutbox(); loadAll(); };
  const swipe = useHorizontalSwipe(nav.back, nav.forward);
  // Pull-to-refresh (#63). loadAll() already drains the outbox first and never
  // rejects — on an unreachable server it keeps the local state and flags
  // dataLoaded=false, so that is what decides success vs. the error hint.
  const refresh = usePullToRefresh(async () => {
    await loadAll();
    if (!useStore.getState().dataLoaded) throw new Error('server unreachable');
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => outboxOnChange(setPending), []);
  useEffect(() => {
    checkForUpdate().then((u) => { if (u?.available && u.apkUrl) setUpdate(u); });
  }, []);
  // Reminder + Widget-Daten (#30): einmalig Berechtigung anfragen; nach jeder
  // Task-Änderung (debounced) Erinnerungen neu planen + Widget-Snapshot
  // veröffentlichen. Im Browser sind beide Aufrufe stille No-ops.
  const allTasks = useStore((s) => s.tasks);
  const reminderLeadMin = useStore((s) => s.settings.reminderLeadMin ?? 0);
  const reminderSound = useStore((s) => (s.settings.reminderSound ?? 1) !== 0);
  const reminderVibrate = useStore((s) => (s.settings.reminderVibrate ?? 1) !== 0);
  const reminderSoundUri = useStore((s) => s.settings.reminderSoundUri || null);
  useEffect(() => { ensureNotificationPermission(); }, []);
  // Tap on a reminder → open that task. Registered once.
  useEffect(() => { onReminderTap((taskId) => openTask(taskId)); }, []);
  useEffect(() => {
    if (!dataLoaded) return;
    const id = window.setTimeout(() => {
      scheduleReminders(allTasks, {
        leadMin: reminderLeadMin, sound: reminderSound, vibrate: reminderVibrate, soundUri: reminderSoundUri,
      });
      publishWidgetData(allTasks);
    }, 3000);
    return () => window.clearTimeout(id);
  }, [allTasks, dataLoaded, reminderLeadMin, reminderSound, reminderVibrate, reminderSoundUri]);
  // Pick up shared content (Android "Share → SelfManaged") on launch + resume + ping.
  useEffect(() => {
    let active = true;
    const pull = async () => {
      const p = await consumeSharedIntent();
      if (active && (p.text || p.subject)) setShare(p);
    };
    pull();
    const onVis = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onVis);
    const off = onShareReceived(pull);
    return () => { active = false; document.removeEventListener('visibilitychange', onVis); off(); };
  }, []);
  // Android hardware back: go back through nav history, else leave the app.
  const navRef = useRef(nav);
  navRef.current = nav;
  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    try {
      CapacitorApp.addListener('backButton', () => {
        const n = navRef.current;
        if (n.canBack) n.back();
        else CapacitorApp.exitApp();
      }).then((s) => { sub = s; }).catch(() => {});
    } catch { /* not on native */ }
    return () => { sub?.remove?.(); };
  }, []);

  // Environment indicator: Appwrite-PROD builds have a fixed HTTPS Function
  // URL with no port at all, so the old port-based guess (":3001"/":3002")
  // always fell through to "other" ("Kein Server gewählt") for them, even
  // though the app was correctly connected the whole time.
  const apiUrl = getBaseUrl();
  const port = apiUrl.match(/:(\d+)(?:\/|$)/)?.[1] ?? '';
  const envKind = IS_APPWRITE_PROD ? 'prod' : port === '3001' ? 'prod' : port === '3002' ? 'dev' : 'other';

  return (
    <div className="m-app">
      {update?.apkUrl && (
        <button className="m-update-banner" onClick={() => openApk(update.apkUrl!)}>
          ⬆ Update {update.latest.replace(/^mobile-v/, 'v')} verfügbar — tippen zum Installieren
        </button>
      )}
      {envKind === 'prod' ? (
        <div className="m-env-prod">🔴 PRODUKTION — echte Daten</div>
      ) : envKind === 'dev' ? (
        <div className="m-env-dev">🟡 DEV / TEST — getrennte Datenbank</div>
      ) : (
        <div className="m-env-other">⚙ Kein Server gewählt — in ⚙ Einstellungen eintragen</div>
      )}
      {pending > 0 ? (
        serverOnline ? (
          <button className="m-sync-banner" onClick={syncNow}>
            ↻ {pending} Änderung(en) werden synchronisiert…
          </button>
        ) : (
          <button className="m-pending-offline" onClick={syncNow}>
            ⏳ {pending} lokale Änderung(en) — offline, wird automatisch synchronisiert
          </button>
        )
      ) : !serverOnline && !dataLoaded ? (
        <div className="m-offline-banner">⚠ Offline — lokaler Stand.</div>
      ) : null}

      <header className="m-header">
        <span className="m-title">{TAB_TITLE[tab]}</span>
        <div className="m-header-actions">
          <button className="m-header-gear" title="Suchen" onClick={() => nav.navigate({ overlay: 'search' })}>🔍</button>
          <button className="m-header-gear" title="Einstellungen" onClick={() => nav.navigate({ overlay: 'settings' })}>⚙️</button>
        </div>
      </header>

      {tab !== 'calendar' && tab !== 'projekte' && <QuickAdd tab={tab} />}

      <main
        className="m-main"
        onTouchStart={(e) => { swipe.onTouchStart(e); refresh.handlers.onTouchStart(e); }}
        onTouchMove={refresh.handlers.onTouchMove}
        onTouchEnd={(e) => { swipe.onTouchEnd(e); refresh.handlers.onTouchEnd(); }}
      >
        {/* #63: Indikator sitzt im Fluss ueber der Liste und wird vom Zug
            mitgeschoben; bei 'idle' ist er 0 Pixel hoch. */}
        <div
          className={`m-pull ${refresh.state !== 'idle' ? 'is-active' : ''} m-pull-${refresh.state}`}
          style={{ height: refresh.state === 'idle' ? 0 : Math.max(refresh.pull, 34) }}
          aria-live="polite"
        >
          {refresh.state === 'refreshing' && <span className="m-pull-spinner" aria-hidden="true" />}
          <span className="m-pull-text">
            {refresh.state === 'pulling' && 'Zum Aktualisieren ziehen'}
            {refresh.state === 'ready' && 'Loslassen zum Aktualisieren'}
            {refresh.state === 'refreshing' && 'Aktualisiere…'}
            {refresh.state === 'done' && '✓ Aktualisiert'}
            {refresh.state === 'error' && '✕ Server nicht erreichbar'}
          </span>
        </div>
        <div style={refresh.style}>
        {tab === 'projekte' && (
          <Projects
            openProjectId={projectId}
            onOpenProject={openProject}
            onBack={nav.back}
            onOpenTask={openTask}
          />
        )}
        {tab === 'inbox' && <Inbox onOpenTask={openTask} />}
        {tab === 'today' && <Today onOpenTask={openTask} />}
        {tab === 'nextweek' && <NextWeek onOpenTask={openTask} />}
        {tab === 'nextaction' && <NextAction onOpenTask={openTask} />}
        {tab === 'calendar' && <Calendar onOpenTask={openTask} />}
        </div>
      </main>

      <Navigation tab={tab} onChange={changeTab} />

      {taskId && (
        <TaskDetailModal
          taskId={taskId}
          onClose={nav.back}
          onOpenTask={openTask}
          onOpenProject={openProject}
        />
      )}
      {overlay === 'settings' && <Settings onClose={nav.back} />}
      {overlay === 'search' && <Search onOpenTask={openTask} onClose={nav.back} />}
      {share && <ShareCapture payload={share} onClose={() => setShare(null)} />}
    </div>
  );
}
