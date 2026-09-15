import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { applyCompletionHold, dateKey, selectVisibleTasks, selectTaskTotals, weekViewDays } from './selectors';
import { fmtFocus } from './pomodoro';
import { parseQuickAdd } from './quickParse';
import type { ViewType } from './types';
import './App.css';
import Sidebar from './components/Sidebar';
import CalendarPanel from './components/CalendarPanel';
import WeekView from './components/WeekView';
import ProjectsPanel from './components/ProjectsPanel';
import TaskList from './components/TaskList';
import TaskDetailPanel from './components/TaskDetailPanel';
import ProjectDetailPanel from './components/ProjectDetailPanel';
import CategoryBar from './components/CategoryBar';
import FilterBar from './components/FilterBar';
import ViewSearch from './components/ViewSearch';
import BulkActionBar from './components/BulkActionBar';
import TemplatesGallery from './components/TemplatesGallery';
import ActivityLog from './components/ActivityLog';
import ReportsView from './components/ReportsView';
import TestReportView from './components/TestReportView';
import PomodoroWidget from './components/PomodoroWidget';
import PomodoroPanel from './components/PomodoroPanel';
import MembersView from './components/MembersView';
import SettingsView from './components/SettingsView';
import ClearableInput from './components/ClearableInput';
import BulkAddTasks from './components/BulkAddTasks';
import ConfirmDialog from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import CompletionCalendar from './components/CompletionCalendar';
import { parseTaskHash, parseAddTaskHash } from './config';
import { onChange as outboxOnChange } from './api/outbox';
import { useServerSync } from './useServerSync';

const VIEW_TITLES: Record<ViewType, string> = {
  inbox: 'Inbox',
  priority: 'Nächste Aktion',
  projects: 'Projekt',
  categories: 'Kategorien',
  calendar: 'Kalender',
  today: 'Heute',
  week: 'Diese Woche',
  someday: 'Someday',
  nextweek: 'Next Week',
  search: 'Suche',
  custom: 'Gespeicherte Ansicht',
  templates: 'Vorlagen',
  activity: 'Aktivität',
  completed: 'Erledigt',
  reports: 'Berichte',
  testreport: 'Testreport',
  members: 'Benutzer',
  settings: 'Einstellungen',
};

// Views whose header pill shows the effort totals (#47) — planning views plus
// the single-project list; everywhere else the pill stays a plain task count.
// Die Wochenansicht ist KEIN eigener ViewType (calendar + calendarMode week/
// rolling) und wird separat über weekGridActive abgedeckt.
const TOTALS_VIEWS: ReadonlySet<ViewType> = new Set([
  'inbox',
  'today',
  'priority',
  'nextweek',
  'projects',
]);

function App() {
  const tasks = useStore((s) => s.tasks);
  const completionHold = useStore((s) => s.completionHold);
  const ui = useStore((s) => s.ui);
  const projects = useStore((s) => s.projects);
  const savedViews = useStore((s) => s.savedViews);
  const theme = useStore((s) => s.settings.theme);

  // Apply the selected theme to the document root.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Re-render when the calendar day changes so the Heute view rolls over at
  // midnight (due-today membership + ☀️ Heute flag expiry). setState with the
  // identical string bails out, so this only re-renders on an actual day flip.
  const [, setDayKey] = useState(() => dateKey(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setDayKey(dateKey(new Date())), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Server connectivity + write-queue status. The offline banner reflects both:
  // it warns when the backend is unreachable and shows how many edits are still
  // queued for sync. Sync loop lives in useServerSync (#86): it now RE-PULLS
  // fresh data (background tick + on window focus + manual refresh), not only on
  // the very first load — otherwise changes from other devices stayed invisible
  // until an app restart.
  const dataLoaded = useStore((s) => s.dataLoaded);
  const { serverOnline, refreshState, refresh } = useServerSync();
  const [pendingWrites, setPendingWrites] = useState(0);
  useEffect(() => outboxOnChange(setPendingWrites), []);
  // Runtime-DEV-Erkennung wie beim Testreport-Menü (#31): der Dev-Server :3002
  // liefert dasselbe production-Bundle aus wie Prod (:3001) — das Env-Banner
  // muss deshalb am gemeldeten Server-Port hängen, nicht nur an VITE_APP_ENV.
  const [serverIsDev, setServerIsDev] = useState(false);
  useEffect(() => {
    let on = true;
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d) => { if (on) setServerIsDev(d.port === 3002); })
      .catch(() => {});
    return () => { on = false; };
  }, []);
  // Only show the sync banner once writes have been pending for a moment. Quick
  // saves (e.g. one keystroke) drain in well under this delay, so the banner
  // never flashes — which previously caused a layout jump on every keypress.
  const [syncVisible, setSyncVisible] = useState(false);
  useEffect(() => {
    if (pendingWrites > 0) {
      const id = window.setTimeout(() => setSyncVisible(true), 800);
      return () => window.clearTimeout(id);
    }
    setSyncVisible(false);
  }, [pendingWrites]);

  // Deep-link support: open the task referenced by #/t/<number> in the URL.
  useEffect(() => {
    const openFromHash = () => {
      // External integrations (Brave/Protonmail extension) create a task via
      // "#/add?title=…&note=…". Land it in the Inbox, open it, then clear the hash.
      const add = parseAddTaskHash(window.location.hash);
      if (add) {
        const state = useStore.getState();
        const created = state.addTask({
          title: add.title,
          description: add.note,
          projectId: null,
        });
        state.selectTask(created.id);
        history.replaceState(null, '', window.location.pathname + window.location.search);
        return;
      }
      const n = parseTaskHash(window.location.hash);
      if (n == null) return;
      const state = useStore.getState();
      const task = state.tasks.find((t) => t.number === n);
      if (task) state.selectTask(task.id);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);
  const addTask = useStore((s) => s.addTask);
  const selectTask = useStore((s) => s.selectTask);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const toggleProjectPinned = useStore((s) => s.toggleProjectPinned);
  const toggleProjectActive = useStore((s) => s.toggleProjectActive);
  const archiveProject = useStore((s) => s.archiveProject);
  const reopenProject = useStore((s) => s.reopenProject);
  const addProject = useStore((s) => s.addProject);
  const addCategory = useStore((s) => s.addCategory);
  const categories = useStore((s) => s.categories);
  const setView = useStore((s) => s.setView);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const members = useStore((s) => s.members);
  const addSavedView = useStore((s) => s.addSavedView);
  const applySavedView = useStore((s) => s.applySavedView);
  const deleteTask = useStore((s) => s.deleteTask);
  const addToTop = useStore((s) => s.settings.addToTop ?? false);
  const setAddToTop = useStore((s) => s.setAddToTop);
  const calendarMode = useStore((s) => s.settings.calendarMode ?? 'list');
  const setCalendarMode = useStore((s) => s.setCalendarMode);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const quickAddRef = useRef<HTMLInputElement>(null);
  // Focus target for `/` (#92 AC8). Only one search field exists at a time —
  // either the FilterBar's, ViewSearch's, or the global search view's — so a
  // single ref can serve all of them. Stays null in views without one, which
  // is what makes the fallback to the global search view work.
  const localSearchRef = useRef<HTMLInputElement>(null);
  const [projRefPickerOpen, setProjRefPickerOpen] = useState(false);
  const [projRefQuery, setProjRefQuery] = useState('');

  const [projectDetailOpen, setProjectDetailOpen] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [confirmPending, setConfirmPending] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Calendar dock between projects panel and task list — collapsed by default
  // and remembered across reloads (#33). Stored as a numeric setting (1/0).
  const projCalShown = useStore((s) => s.settings.projectCalendarShown === 1);
  const patchSettings = useStore((s) => s.patchSettings);
  const toggleProjCal = () => patchSettings({ projectCalendarShown: projCalShown ? 0 : 1 });
  // Inbox project-assign panel (#32): shown by default, remembered.
  const inboxPanelShown = useStore((s) => (s.settings.inboxProjectPanel ?? 1) === 1);

  const toggleSelect = (id: string) => {
    selectAnchor.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitBulk = () => {
    setBulkMode(false);
    setSelectedIds(new Set());
  };

  // Anchor for shift-range selection (the last task clicked).
  const selectAnchor = useRef<string | null>(null);
  // Keep the anchor in sync with the task opened in the detail panel, so a plain
  // click followed by a shift+click always has a valid range start.
  useEffect(() => {
    if (ui.selectedTaskId) selectAnchor.current = ui.selectedTaskId;
  }, [ui.selectedTaskId]);

  // Clicking a task closes the project detail panel; they share the right slot.
  useEffect(() => {
    if (ui.selectedTaskId) setProjectDetailOpen(false);
  }, [ui.selectedTaskId]);

  // When a ctrl/shift selection drops back to empty, leave selection mode so the
  // (green) bulk bar doesn't linger showing "0 ausgewählt".
  useEffect(() => {
    if (bulkMode && selectedIds.size === 0) setBulkMode(false);
  }, [bulkMode, selectedIds]);

  // Ctrl/Cmd+click on any task starts (or extends) a multi-selection anywhere.
  const ctrlSelect = (id: string) => {
    setBulkMode(true);
    toggleSelect(id);
    selectAnchor.current = id;
  };

  // Shift+click selects the range between the anchor and the clicked task
  // (following the current visible order).
  const shiftSelect = (id: string) => {
    setBulkMode(true);
    const order = visibleTasks.map((t) => t.id);
    // Anchor = last multi-select click, else the task currently open in the detail panel.
    const anchor = selectAnchor.current ?? ui.selectedTaskId;
    const from = anchor ? order.indexOf(anchor) : -1;
    const to = order.indexOf(id);
    if (from === -1 || to === -1) {
      toggleSelect(id);
      selectAnchor.current = id;
      return;
    }
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(order[i]);
      return next;
    });
  };

  // Global keyboard shortcuts: n = new task, / = search, Esc = close, Del = delete.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);

      if (e.key === 'Escape') {
        if (typing) el?.blur();
        // Clear a multi-selection first, then the open detail task.
        else if (bulkMode || selectedIds.size > 0) exitBulk();
        else if (useStore.getState().ui.selectedTaskId) selectTask(null);
        return;
      }
      if (typing) return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        quickAddRef.current?.focus();
      } else if (e.key === '/') {
        e.preventDefault();
        // Search where you are; fall back to the global view where the
        // current view has no search field of its own (#92 AC8).
        if (localSearchRef.current) localSearchRef.current.focus();
        else setView('search');
      } else if (e.key === 'Delete') {
        const id = useStore.getState().ui.selectedTaskId;
        if (id) {
          e.preventDefault();
          deleteTask(id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectTask, setView, deleteTask, bulkMode, selectedIds]);

  // Tasks mid completion-hold stay "virtually open" so they keep their list
  // position during the grey phase of the check-off animation (#53).
  const visibleTasks = selectVisibleTasks(
    applyCompletionHold(tasks, completionHold),
    ui,
    projects,
    members
  );
  // Das Wochenraster zeigt die Tasks der sichtbaren Tage, nicht visibleTasks
  // (calendar scopt auf den ausgewählten Tag) — Totals folgen dem Raster (#47).
  const weekGridActive = ui.currentView === 'calendar' && calendarMode !== 'list';
  let totalsTasks = visibleTasks;
  if (weekGridActive) {
    const dayKeys = new Set(
      weekViewDays(calendarMode, ui.currentDate, ui.selectedDates).map(dateKey)
    );
    totalsTasks = tasks.filter((t) => t.dueDate && dayKeys.has(dateKey(t.dueDate)));
  }
  const totals = selectTaskTotals(totalsTasks);
  const showTotalsPill = weekGridActive || TOTALS_VIEWS.has(ui.currentView);
  const selectedTask = ui.selectedTaskId
    ? tasks.find((t) => t.id === ui.selectedTaskId) ?? null
    : null;

  const multiProject =
    ui.currentView === 'projects' && ui.selectedProjectIds.length > 1;

  const currentProject =
    !multiProject &&
    (ui.currentView === 'projects' || ui.currentView === 'someday') &&
    ui.selectedProjectId
      ? projects.find((p) => p.id === ui.selectedProjectId)
      : null;

  const activeSavedView =
    ui.currentView === 'custom' && ui.activeSavedViewId
      ? savedViews.find((v) => v.id === ui.activeSavedViewId)
      : null;

  const headerTitle = currentProject
    ? `${currentProject.icon} ${currentProject.name}`
    : multiProject
      ? `${ui.selectedProjectIds.length} Projekte ausgewählt`
    : activeSavedView
      ? `🔎 ${activeSavedView.name}`
      : ui.currentView === 'calendar'
      ? ui.selectedDates.length > 1
        ? `${ui.selectedDates.length} Tage ausgewählt`
        : ui.currentDate.toLocaleDateString('de-DE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })
      : VIEW_TITLES[ui.currentView];

  const handleAddTask = () => {
    if (!newTaskTitle.trim()) return;
    const parsed = parseQuickAdd(newTaskTitle);
    const title = parsed.title || newTaskTitle.trim();

    // Resolve #project token: match existing (case-insensitive) or create.
    let projectId: string | null = currentProject ? currentProject.id : null;
    if (parsed.projectName) {
      const existing = projects.find(
        (p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase()
      );
      projectId = existing ? existing.id : addProject(parsed.projectName).id;
    }

    // Resolve @category tokens: match existing or create.
    const categoryIds = parsed.categoryNames.map((name) => {
      const existing = categories.find(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      return existing ? existing.id : addCategory(name).id;
    });

    const created = addTask({
      title,
      projectId,
      categoryIds,
      dueDate:
        ui.currentView === 'calendar'
          ? new Date(ui.currentDate)
          : ui.currentView === 'today'
            ? new Date()
            : null,
      // Flag the task so it shows up in the view it was created in.
      someday: ui.currentView === 'someday',
      thisWeek: ui.currentView === 'nextweek',
      starred: ui.currentView === 'priority',
    });
    setNewTaskTitle('');
    selectTask(created.id);
  };

  // Views that render the FilterBar; there the FilterBar owns the
  // Gruppen/Sektionen toggle, so TaskList must not render its own.
  const isFilterView = ['inbox', 'priority', 'projects', 'today', 'search', 'categories', 'custom', 'completed'].includes(
    ui.currentView
  );

  // Views that carry a task list but no FilterBar get a search-only bar (#92).
  // Search only — these views stay out of FILTERABLE_VIEWS, so the remaining
  // filter controls would be switches without effect. The week/rolling grid is
  // excluded on purpose: it bypasses selectVisibleTasks entirely (see #93).
  const showViewSearch =
    !isFilterView &&
    (ui.currentView === 'nextweek' ||
      ui.currentView === 'someday' ||
      (ui.currentView === 'calendar' && !weekGridActive));

  const appEnv = (import.meta.env.VITE_APP_ENV as string | undefined) ?? 'development';

  return (
    <div className="app-container">
      {(appEnv !== 'production' || serverIsDev) && (
        <div className="env-banner" title={`Umgebung: ${serverIsDev ? 'development (Server :3002)' : appEnv}`}>
          🚧 ENTWICKLUNG &amp; TEST — getrennte Datenbank, keine Produktionsdaten
        </div>
      )}
      {serverOnline === false ? (
        <div className="server-offline-banner">
          ⚠ Server nicht erreichbar — Bitte <code>npm run dev</code> im <code>server/</code>-Verzeichnis starten.
          {pendingWrites > 0
            ? ` Deine ${pendingWrites} Änderung(en) sind sicher gespeichert und werden synchronisiert, sobald der Server läuft.`
            : ' Deine Änderungen werden zwischengespeichert und synchronisiert, sobald der Server läuft.'}
        </div>
      ) : syncVisible && pendingWrites > 0 ? (
        <div className="server-sync-banner">
          ⟳ {pendingWrites} Änderung(en) werden synchronisiert…
        </div>
      ) : !dataLoaded ? (
        <div className="server-offline-banner">
          ⚠ Daten konnten nicht geladen werden — Verbindung zum Server wird hergestellt…
        </div>
      ) : null}
      <div className="app-row">
      <Sidebar />
      {ui.sidePanel === 'projects' && (
        <ErrorBoundary>
          <ProjectsPanel
            calendarShown={projCalShown}
            onToggleCalendar={toggleProjCal}
            onOpenDetail={() => { selectTask(null); setProjectDetailOpen(true); }}
          />
        </ErrorBoundary>
      )}
      {ui.sidePanel === 'someday' && (
        <ErrorBoundary>
          <ProjectsPanel mode="someday" />
        </ErrorBoundary>
      )}
      {ui.sidePanel === 'calendar' && <CalendarPanel />}
      {ui.sidePanel === 'pomodoro' && (
        <ErrorBoundary>
          <PomodoroPanel />
        </ErrorBoundary>
      )}
      {/* Inbox: project-assign panel on the left — drag a task onto a project
          to move it there (with its subtasks). Shows all projects incl. Someday (#32). */}
      {ui.currentView === 'inbox' && ui.sidePanel === 'none' && inboxPanelShown && (
        <ErrorBoundary>
          <ProjectsPanel mode="all" onClose={() => patchSettings({ inboxProjectPanel: 0 })} />
        </ErrorBoundary>
      )}
      {ui.currentView === 'projects' && projCalShown && (
        <div className="calendar-mid-dock">
          <CalendarPanel />
        </div>
      )}
      <div className="main-content">
        <div className="task-header">
          {currentProject ? (
            <div className="project-title-group">
              {currentProject.kind !== 'area' && (
                <button
                  role="switch"
                  aria-checked={currentProject.active === true}
                  className={`project-active-switch ${currentProject.active === true ? 'on' : ''}`}
                  title={
                    currentProject.active === true
                      ? 'Aktiv — klicken für Someday (inaktiv)'
                      : 'Someday (inaktiv) — klicken zum Aktivieren'
                  }
                  onClick={() => toggleProjectActive(currentProject.id)}
                >
                  <span className="project-active-knob" />
                </button>
              )}
              {editingProjectName ? (
                <input
                  autoFocus
                  className="project-title-input"
                  value={currentProject.name}
                  onChange={(e) => updateProject(currentProject.id, { name: e.target.value })}
                  onBlur={() => setEditingProjectName(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingProjectName(false); }}
                />
              ) : (
                <span
                  className="project-title-input project-title-label"
                  title="Klick: Details · Doppelklick: umbenennen"
                  onClick={() => { selectTask(null); setProjectDetailOpen(true); }}
                  onDoubleClick={(e) => { e.stopPropagation(); setProjectDetailOpen(false); setEditingProjectName(true); }}
                >
                  {currentProject.name}
                </span>
              )}
              {currentProject.kind !== 'area' && (
                <button
                  className={`project-pin-btn ${currentProject.pinned ? 'on' : ''}`}
                  title={currentProject.pinned ? 'Angepinnt (oben) — lösen' : 'Anpinnen (nach oben)'}
                  onClick={() => toggleProjectPinned(currentProject.id)}
                >
                  📌
                </button>
              )}
              <button
                className={`project-pin-btn ${projectDetailOpen ? 'on' : ''}`}
                title="Projektdetails anzeigen"
                onClick={() => {
                  const opening = !projectDetailOpen;
                  setProjectDetailOpen(opening);
                  if (opening) selectTask(null);
                }}
              >
                📋
              </button>
            </div>
          ) : (
            <h2>{headerTitle}</h2>
          )}
          <div className="task-header-right">
            {/* #86: manueller Refresh — holt sofort frische Daten vom Server. */}
            <button
              className={`header-icon-btn refresh-btn refresh-${refreshState}`}
              disabled={refreshState === 'refreshing'}
              title={
                refreshState === 'refreshing'
                  ? 'Aktualisiere…'
                  : refreshState === 'done'
                    ? 'Aktualisiert'
                    : refreshState === 'error'
                      ? 'Server nicht erreichbar'
                      : 'Daten aktualisieren'
              }
              onClick={() => void refresh()}
            >
              {refreshState === 'done' ? '✓' : refreshState === 'error' ? '✕' : '↻'}
            </button>
            <PomodoroWidget />
            {showTotalsPill ? (
              <span
                className="task-count task-count-totals"
                title={`${totals.count} Tasks · Geplant: ${
                  totals.plannedMin > 0 ? fmtFocus(totals.plannedMin * 60) : '—'
                } · Gearbeitet: ${
                  totals.actualMin > 0 ? fmtFocus(totals.actualMin * 60) : '—'
                }`}
              >
                {totals.count}
                {totals.plannedMin > 0 && ` · ⏱ ${fmtFocus(totals.plannedMin * 60)}`}
                {/* ⏳ statt 🍅: die Tomate direkt neben dem Pomodoro-Widget war doppeldeutig. */}
                {totals.actualMin > 0 && ` · ⏳ ${fmtFocus(totals.actualMin * 60)}`}
              </span>
            ) : (
              <span className="task-count">{visibleTasks.length}</span>
            )}
            {ui.currentView === 'inbox' && (
              <button
                className={`header-icon-btn ${inboxPanelShown ? 'on' : ''}`}
                title={inboxPanelShown ? 'Projekt-Panel ausblenden' : 'Projekt-Panel einblenden (Task per Ziehen zuweisen)'}
                onClick={() => patchSettings({ inboxProjectPanel: inboxPanelShown ? 0 : 1 })}
              >
                📂
              </button>
            )}
            <button
              className="header-icon-btn"
              title="Drucken / als PDF speichern"
              onClick={() => window.print()}
            >
              🖨
            </button>
            <button
              className="header-icon-btn"
              title={bulkMode ? 'Auswahl beenden' : 'Mehrere auswählen (alle sichtbaren)'}
              onClick={() => {
                if (bulkMode) {
                  exitBulk();
                } else {
                  setBulkMode(true);
                  setSelectedIds(new Set(visibleTasks.map((t) => t.id)));
                }
              }}
            >
              {bulkMode ? '✕' : '☑'}
            </button>
            {currentProject && (
              <button
                className="header-icon-btn"
                title="Mehrere Tasks anlegen"
                onClick={() => setBulkAddOpen(true)}
              >
                ⊞
              </button>
            )}
            {currentProject && currentProject.kind !== 'area' && (
              currentProject.archived ? (
                <button
                  className="header-icon-btn"
                  title="Projekt wieder öffnen"
                  onClick={() => reopenProject(currentProject.id)}
                >
                  ↩
                </button>
              ) : (
                <button
                  className="header-icon-btn"
                  title="Projekt abschliessen (alle offenen Aufgaben werden erledigt)"
                  onClick={() => {
                    setConfirmPending({
                      message: `Projekt „${currentProject.name}" abschliessen? Alle offenen Aufgaben werden als erledigt markiert und das Projekt wandert ins Archiv.`,
                      onConfirm: () => {
                        archiveProject(currentProject.id);
                        // Stay in Someday when archiving from there (#15) —
                        // only jump to Projekte from other contexts.
                        if (ui.currentView !== 'someday') {
                          setSidePanel('projects');
                          setView('projects');
                        }
                        setConfirmPending(null);
                      },
                    });
                  }}
                >
                  ✅
                </button>
              )
            )}
            {currentProject && (
              <button
                className="header-icon-btn"
                title="Projekt löschen"
                onClick={() => {
                  setConfirmPending({
                    message: `Projekt „${currentProject.name}" und alle seine Aufgaben löschen?`,
                    onConfirm: () => {
                      const backView = ui.currentView === 'someday' ? 'someday' : 'projects';
                      deleteProject(currentProject.id);
                      setSidePanel(backView);
                      setView(backView);
                      setConfirmPending(null);
                    },
                  });
                }}
              >
                🗑️
              </button>
            )}
          </div>
        </div>

        <div className="print-meta">
          SelfManaged · {headerTitle} · {new Date().toLocaleDateString('de-DE')}
        </div>

        {ui.currentView === 'templates' ? (
          <TemplatesGallery />
        ) : ui.currentView === 'activity' ? (
          <ActivityLog />
        ) : ui.currentView === 'reports' ? (
          <ReportsView />
        ) : ui.currentView === 'testreport' ? (
          <TestReportView />
        ) : ui.currentView === 'members' ? (
          <MembersView />
        ) : ui.currentView === 'settings' ? (
          <ErrorBoundary><SettingsView /></ErrorBoundary>
        ) : (
        <>
        {ui.currentView === 'calendar' && (
          <div className="calendar-mode-toggle">
            {(['list', 'week', 'rolling'] as const).map((m) => (
              <button
                key={m}
                className={`cal-mode-btn ${calendarMode === m ? 'active' : ''}`}
                onClick={() => setCalendarMode(m)}
              >
                {m === 'list'
                  ? '📋 Tag / Liste'
                  : m === 'week'
                    ? '🗓 Woche (Mo–So)'
                    : '↻ Rollierend (7 Tage)'}
              </button>
            ))}
          </div>
        )}
        {ui.currentView === 'calendar' && calendarMode !== 'list' ? (
          <WeekView mode={calendarMode} />
        ) : (
        <>
        {/* No quick-add on Erledigt and Suche — search is for finding, not creating (#19). */}
        {ui.currentView !== 'completed' && ui.currentView !== 'search' && (
        <div className="quick-add">
          <button
            className="quick-add-dir"
            title={
              addToTop
                ? 'Neue Aufgaben oben einfügen (klicken: nach unten)'
                : 'Neue Aufgaben unten anhängen (klicken: nach oben)'
            }
            onClick={() => setAddToTop(!addToTop)}
          >
            {addToTop ? '↥' : '↧'}
          </button>
          <ClearableInput
            ref={quickAddRef}
            wrapperClassName="grow"
            type="text"
            className="quick-add-input"
            placeholder={'+ Aufgabe…  #Projekt @Kategorie  (Taste n)'}
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onClear={() => setNewTaskTitle('')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTask();
              if (e.key === 'Escape') setNewTaskTitle('');
            }}
          />
          <button className="btn btn-primary" onClick={handleAddTask}>
            Hinzufügen
          </button>
          {currentProject && (
            <div className="projref-picker-wrap">
              <button
                className="btn"
                title="Anderes Projekt als Abhängigkeit verknüpfen"
                onClick={() => { setProjRefPickerOpen((v) => !v); setProjRefQuery(''); }}
              >
                🔗
              </button>
              {projRefPickerOpen && (
                <div className="projref-dropdown">
                  <input
                    autoFocus
                    className="projref-search"
                    placeholder="Projekt suchen…"
                    value={projRefQuery}
                    onChange={(e) => setProjRefQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setProjRefPickerOpen(false)}
                  />
                  <div className="projref-list">
                    {projects
                      .filter((p) =>
                        p.id !== currentProject.id &&
                        p.id !== 'p-single' &&
                        (p.name ?? '').toLowerCase().includes(projRefQuery.toLowerCase())
                      )
                      .map((p) => (
                        <button
                          key={p.id}
                          className="projref-option"
                          onClick={() => {
                            addTask({
                              title: p.name,
                              projectId: currentProject.id,
                              linkedProjectId: p.id,
                            });
                            setProjRefPickerOpen(false);
                          }}
                        >
                          <span className="task-project-dot" style={{ background: p.color }} />
                          {p.name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {ui.currentView === 'search' && (
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input
              ref={localSearchRef}
              autoFocus
              type="text"
              className="search-input"
              placeholder="Suchen: Titel, Beschreibung, Person, Status (z.B. warten, next week)..."
              value={ui.searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {ui.searchQuery && (
              <>
                <button
                  className="search-save"
                  title="Diese Suche speichern"
                  onClick={() => {
                    const name = window.prompt(
                      'Name der gespeicherten Suche:',
                      ui.searchQuery
                    );
                    if (name && name.trim()) {
                      const view = addSavedView(name.trim());
                      applySavedView(view.id);
                    }
                  }}
                >
                  💾 Suche speichern
                </button>
                <button
                  className="search-clear"
                  onClick={() => setSearchQuery('')}
                  title="Löschen"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        )}

        {ui.currentView === 'categories' && <CategoryBar />}

        {isFilterView && <FilterBar searchRef={localSearchRef} />}

        {showViewSearch && <ViewSearch ref={localSearchRef} />}

        {bulkMode && (
          <BulkActionBar
            selectedIds={[...selectedIds]}
            totalVisible={visibleTasks.length}
            onSelectAll={() => setSelectedIds(new Set(visibleTasks.map((t) => t.id)))}
            onClear={exitBulk}
          />
        )}

        {ui.currentView === 'priority' && (
          <div className="view-hint">
            Überfällige und mit ★ markierte Aufgaben — alles, was deine Aufmerksamkeit braucht.
          </div>
        )}

        {ui.currentView === 'completed' && (
          <ErrorBoundary>
            <CompletionCalendar tasks={tasks} />
          </ErrorBoundary>
        )}

        <ErrorBoundary>
          <TaskList
            tasks={visibleTasks}
            emptyHint={
              // An active search explains the empty list better than the
              // view's own hint would — and naming the view hints at the
              // classic dead end: the task sits in a different one (#92 AC7).
              ui.searchQuery.trim() && ui.currentView !== 'search'
                ? `Keine Treffer für „${ui.searchQuery}" in dieser Ansicht. 🔍 Suchen in der Seitenleiste durchsucht alle Aufgaben.`
                : ui.currentView === 'priority'
                  ? 'Keine offenen Aufgaben — markiere welche mit ★ oder setze Priorität Hoch.'
                  : ui.currentView === 'completed'
                    ? 'Noch nichts erledigt (oder Filter zu eng). Hake Aufgaben ab — sie erscheinen hier.'
                    : undefined
            }
            selectionMode={bulkMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onCtrlSelect={ctrlSelect}
            onShiftSelect={shiftSelect}
            showSectionToggle={!isFilterView}
          />
        </ErrorBoundary>
        </>
        )}
        </>
        )}
      </div>

      {projectDetailOpen && currentProject ? (
        <ProjectDetailPanel project={currentProject} onClose={() => setProjectDetailOpen(false)} />
      ) : (
        selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            // Flags im Panel wirken auf die ganze Auswahl, wenn die offene
            // Task Teil der aktiven Mehrfachauswahl ist (#13).
            bulkSelectedIds={
              bulkMode && selectedIds.has(selectedTask.id) && selectedIds.size > 1
                ? [...selectedIds]
                : undefined
            }
          />
        )
      )}

      {bulkAddOpen && currentProject && (
        <BulkAddTasks
          projectId={currentProject.id}
          projectName={currentProject.name}
          onClose={() => setBulkAddOpen(false)}
        />
      )}
      {confirmPending && (
        <ConfirmDialog
          message={confirmPending.message}
          onConfirm={confirmPending.onConfirm}
          onCancel={() => setConfirmPending(null)}
        />
      )}
      </div>
    </div>
  );
}

export default App;
