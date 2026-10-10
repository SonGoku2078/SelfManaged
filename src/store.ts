import { create } from 'zustand';
import type {
  Task,
  TaskLink,
  Project,
  Category,
  UIState,
  Filters,
  SortField,
  ViewType,
  SidePanel,
  SavedView,
  ActivityEntry,
  ActivityKind,
  Member,
  MemberRole,
  Settings,
  Theme,
  Attachment,
  ProjectSort,
  CalendarMode,
  Section,
  ProjectBlocker,
  ProjectKind,
} from './types';
import {
  SINGLE_TASKS_PROJECT,
} from './dummyData';
import type { ProjectTemplate } from './templates';
import { pushNozbeCompleted, type MappedImport } from './nozbe';
import {
  tasksApi, projectsApi, categoriesApi, membersApi,
  sectionsApi, blockersApi, savedViewsApi, activityLogApi, settingsApi,
} from './api';
import { enqueue, flush as flushOutbox, pendingCount, writeSeq, onTaskRenumbered } from './api/outbox';
import { saveSnapshot, loadSnapshot } from './api/cache';
import { buildOccurrence, nextDueAfterCompletion } from './recurrence';
import { safeNextNumber, duplicateNumberTasks } from './taskNumber';
import { IS_EXTRA_WINDOW } from './windows';
import { orderSections } from './selectors';
import { nextPomodoroPhase, pomodoroDayKey } from './pomodoro';

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

// Debounce a full settings save: rapid typing (e.g. a color label) coalesces
// into one settings.patch shortly after typing stops, instead of one per key.
let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
const debouncedSettingsSave = (settings: Settings, delay = 500) => {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null;
    enqueue('settings.patch', { patch: settings });
  }, delay);
};

const ACTIVITY_CAP = 500;

// Parse recurrence strings (DE + EN) → RecurrenceType.
function parseRecurrence(raw: string | undefined): import('./types').RecurrenceType {
  if (!raw) return 'none';
  const s = raw.trim().toLowerCase();
  if (['täglich', 'daily', 'jeden tag', 'every day'].includes(s)) return 'daily';
  if (['wöchentlich', 'weekly', 'jede woche', 'every week'].includes(s)) return 'weekly';
  if (['monatlich', 'monthly', 'jeden monat', 'every month'].includes(s)) return 'monthly';
  if (['jährlich', 'yearly', 'annually', 'jedes jahr', 'every year'].includes(s)) return 'yearly';
  return 'none';
}

// Parse duration strings like "30m", "1h", "1h30m", "90" → minutes.
function parseDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const hm = s.match(/^(\d+)h(\d+)m?$/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const h = s.match(/^(\d+)h$/);
  if (h) return parseInt(h[1]) * 60;
  const m = s.match(/^(\d+)m?$/);
  if (m) return parseInt(m[1]);
  return null;
}

export const DEFAULT_PALETTE = [
  '#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#e91e63', '#00bcd4',
  '#f44336', '#8bc34a', '#009688', '#3f51b5', '#795548', '#607d8b',
];

// Build a task-related activity entry (created/updated/completed/comment/…).
const taskEntry = (
  kind: ActivityKind,
  task: Pick<Task, 'id' | 'number' | 'title'>,
  actor: string,
  extra: { field?: string; from?: string; to?: string } = {}
): ActivityEntry => ({
  id: uid('act'),
  at: new Date(),
  actor,
  kind,
  taskId: task.id,
  taskNumber: task.number,
  taskTitle: task.title,
  ...extra,
});

// Build a non-task entry (e.g. project-created).
const plainEntry = (
  kind: ActivityKind,
  subject: string,
  actor: string
): ActivityEntry => ({
  id: uid('act'),
  at: new Date(),
  actor,
  kind,
  taskTitle: subject,
});

// Append an entry, keeping only the most recent ACTIVITY_CAP.
const pushLog = (log: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] =>
  [entry, ...log].slice(0, ACTIVITY_CAP);

// Coalesce consecutive edits of the SAME field on the SAME task into one entry
// (keeping the original `from`, updating `to`) so a burst of keystrokes shows up
// as a single net change instead of one entry per keystroke.
const mergeOrPush = (
  log: ActivityEntry[],
  entry: ActivityEntry
): ActivityEntry[] => {
  const top = log[0];
  if (
    entry.kind === 'updated' &&
    top &&
    top.kind === 'updated' &&
    top.taskId === entry.taskId &&
    top.field === entry.field
  ) {
    return [{ ...top, to: entry.to, at: entry.at }, ...log.slice(1)];
  }
  return pushLog(log, entry);
};

// Human-readable representation of a field value for the change log.
const fmtVal = (
  field: string,
  value: unknown,
  ctx: { projects: Project[]; categories: Category[]; members: Member[] }
): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'dueDate' || field === 'recurrenceEnd') {
    const d = value as Date;
    return d instanceof Date && !isNaN(d.getTime())
      ? d.toLocaleDateString('de-DE')
      : '—';
  }
  if (field === 'projectId') {
    return ctx.projects.find((p) => p.id === value)?.name ?? '—';
  }
  if (field === 'assigneeId') {
    return ctx.members.find((m) => m.id === value)?.name ?? '—';
  }
  if (field === 'assigneeIds') {
    const ids = (value as string[]) ?? [];
    if (!ids.length) return '—';
    return ids
      .map((id) => ctx.members.find((m) => m.id === id)?.name ?? id)
      .join(', ');
  }
  if (field === 'categoryIds') {
    const ids = value as string[];
    if (!ids.length) return '—';
    return ids
      .map((id) => ctx.categories.find((c) => c.id === id)?.name ?? id)
      .join(', ');
  }
  if (field === 'priority') {
    return { low: 'Niedrig', medium: 'Mittel', high: 'Hoch' }[value as string] ?? String(value);
  }
  if (field === 'completed') return value ? 'erledigt' : 'offen';
  if (field === 'todayDate') {
    return typeof value === 'string' && value
      ? new Date(`${value}T00:00:00`).toLocaleDateString('de-DE')
      : '—';
  }
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  return String(value);
};

// Fields whose changes are recorded in the activity log, with German labels.
const TRACKED_FIELDS: { key: keyof Task; label: string }[] = [
  { key: 'title', label: 'Titel' },
  { key: 'description', label: 'Beschreibung' },
  { key: 'dueDate', label: 'Fälligkeit' },
  { key: 'priority', label: 'Priorität' },
  { key: 'projectId', label: 'Projekt' },
  { key: 'categoryIds', label: 'Kategorien' },
  { key: 'starred', label: 'Markierung' },
  { key: 'someday', label: 'Someday' },
  { key: 'thisWeek', label: 'Next Week' },
  { key: 'todayDate', label: 'Heute' },
  { key: 'waiting', label: 'Warten auf' },
  { key: 'waitingFor', label: 'Warten auf (Person)' },
  { key: 'completed', label: 'Status' },
  { key: 'recurrence', label: 'Wiederholung' },
  { key: 'assigneeIds', label: 'Zuweisung' },
];

// GTD invariants: extend a task patch so the Someday/Next-Week/Heute flow stays valid.
// - thisWeek or an active todayDate implies not someday (no parked "today" tasks)
// - someday implies not thisWeek and clears the Heute pin
// - unparking a *loose* task (no project) commits it to the Single-Tasks bucket
const gtdInvariants = (
  before: Task,
  patch: Partial<Task>
): Partial<Task> => {
  const next = { ...patch };
  const settingToday = typeof next.todayDate === 'string' && next.todayDate !== '';
  if (next.thisWeek === true || settingToday) next.someday = false;
  // Committing to this week / today also makes it a next action.
  if (next.thisWeek === true || settingToday) next.starred = true;
  if (next.someday === true) {
    next.thisWeek = false;
    next.todayDate = null;
  }
  const after = { ...before, ...next };
  const leavingSomeday =
    (patch.someday === false && before.someday) ||
    (patch.thisWeek === true && before.someday) ||
    (settingToday && before.someday);
  if (leavingSomeday && !after.projectId) {
    next.projectId = 'p-single';
  }
  return next;
};

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
};

// Advance a date by one recurrence step, honouring custom intervals + month modes.
const nextRecurrence = (date: Date, task: Task): Date => {
  const d = new Date(date);
  const interval = Math.max(1, task.recurInterval ?? 1);
  // Resolve the effective unit + step count.
  let unit: 'day' | 'week' | 'month' | 'year';
  let step = interval;
  switch (task.recurrence) {
    case 'daily':
      unit = 'day';
      step = 1;
      break;
    case 'weekly':
      unit = 'week';
      step = 1;
      break;
    case 'monthly':
      unit = 'month';
      step = 1;
      break;
    case 'yearly':
      unit = 'year';
      step = 1;
      break;
    case 'custom':
      unit = task.recurUnit ?? 'day';
      break;
    default:
      return d;
  }

  if (unit === 'day') d.setDate(d.getDate() + step);
  else if (unit === 'week') d.setDate(d.getDate() + step * 7);
  else if (unit === 'year') d.setFullYear(d.getFullYear() + step);
  else {
    // month
    d.setMonth(d.getMonth() + step);
    const mode = task.recurMonthDay ?? 'date';
    if (mode === 'first') d.setDate(1);
    else if (mode === 'last') d.setDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
  }
  return d;
};

const defaultUIState: UIState = {
  selectedTaskId: null,
  editTitleTaskId: null,
  selectedProjectId: null,
  selectedProjectIds: [],
  currentView: 'inbox',
  currentDate: new Date(),
  selectedDates: [],
  searchQuery: '',
  filters: {
    projectId: null,
    categoryId: null,
    priority: null,
    completed: null,
    dueFrom: null,
    dueTo: null,
    assigneeId: null,
  },
  sortField: 'manual',
  sortDir: 'asc',
  activeSavedViewId: null,
  sidePanel: 'none',
};

const defaultSettings: Settings = {
  userName: 'Du',
  theme: 'light',
  calendarMode: 'list',
  calendarStartHour: 6,
  calendarEndHour: 22,
  calendarMonthCount: 1,
  calendarHourHeight: 48,
};

// Pomodoro timer (#3). While running, `endsAt` (epoch ms) is authoritative —
// the widget derives the countdown from it, so ticks never drift. While
// paused, `remainingMs` holds the frozen rest.
export type PomodoroPhase = 'focus' | 'break' | 'long';
export interface PomodoroState {
  phase: PomodoroPhase;
  running: boolean;
  endsAt: number | null;
  remainingMs: number;
  round: number; // 1-based focus round; long break after every `pomodoroRounds`
  currentTaskId?: string | null; // the task this Pomodoro is focused on (#39)
  // Epoch when the current focus-attribution segment began; only set while a
  // FOCUS phase is running. Elapsed since then is billed to currentTaskId (#39).
  focusSegmentStart?: number | null;
}

// Per-day, per-task focus seconds — feeds the panel's "worked today" list (#39).
export type PomodoroTaskLog = Record<string, Record<string, number>>;

// Persist the live timer + the daily rounds tally + the per-task time log per
// device (#39). localStorage (not the server) — a running timer is device-local,
// and endsAt (epoch) lets a reload resume drift-free.
const POMO_KEY = 'pomodoro:v1';
interface PomoPersist {
  state: PomodoroState;
  log: Record<string, number>; // day → focus rounds completed
  taskLog?: PomodoroTaskLog;   // day → { taskId → seconds }
}

function savePomodoro(state: PomodoroState, log: Record<string, number>, taskLog: PomodoroTaskLog): void {
  try { localStorage.setItem(POMO_KEY, JSON.stringify({ state, log, taskLog })); } catch { /* ignore */ }
}

function loadPomodoro(): Required<PomoPersist> | null {
  try {
    const raw = localStorage.getItem(POMO_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as PomoPersist;
    const p = d.state;
    // Finished while the tab was closed → come back paused at 0 (no surprise
    // alarm, since the phase-end sound only fires while running).
    if (p && p.running && typeof p.endsAt === 'number' && p.endsAt <= Date.now()) {
      p.running = false; p.remainingMs = 0; p.endsAt = null;
    }
    // A resumed segment can't be trusted after a reload gap; re-anchor if running.
    if (p) p.focusSegmentStart = p.running && p.phase === 'focus' ? Date.now() : null;
    return { state: p, log: d.log ?? {}, taskLog: d.taskLog ?? {} };
  } catch { return null; }
}

// Read the persisted timer once at startup so a reload resumes it (#39).
const pomoInit = loadPomodoro();

// Focus seconds owed to the current task at `now`, if an attribution segment is
// open (only during a running focus phase). Rounded to whole seconds.
function pendingFocus(p: PomodoroState, now: number): { taskId: string; delta: number } | null {
  if (p.focusSegmentStart != null && p.currentTaskId) {
    const delta = Math.round((now - p.focusSegmentStart) / 1000);
    if (delta > 0) return { taskId: p.currentTaskId, delta };
  }
  return null;
}

// Add owed focus seconds to today's per-task log (immutably).
function withAccrual(taskLog: PomodoroTaskLog, acc: { taskId: string; delta: number } | null): PomodoroTaskLog {
  if (!acc) return taskLog;
  const key = pomodoroDayKey(new Date());
  const day = { ...(taskLog[key] ?? {}) };
  day[acc.taskId] = (day[acc.taskId] ?? 0) + acc.delta;
  return { ...taskLog, [key]: day };
}

export const pomodoroPhaseMs = (phase: PomodoroPhase, s: Settings): number =>
  60_000 *
  (phase === 'focus'
    ? s.pomodoroFocusMin ?? 25
    : phase === 'break'
      ? s.pomodoroBreakMin ?? 5
      : s.pomodoroLongBreakMin ?? 15);

export interface NewTaskInput {
  title: string;
  description?: string;
  projectId?: string | null;
  parentId?: string | null;
  dueDate?: Date | null;
  startMinutes?: number | null;
  durationMin?: number | null;
  priority?: Task['priority'];
  categoryIds?: string[];
  starred?: boolean;
  recurrence?: Task['recurrence'];
  sectionId?: string | null;
  someday?: boolean;
  thisWeek?: boolean;
  todayDate?: string | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
  linkedProjectId?: string | null;
  sortOrder?: number;
}

interface AppState {
  tasks: Task[];
  projects: Project[];
  sections: Section[];
  blockers: ProjectBlocker[];
  categories: Category[];
  savedViews: SavedView[];
  activityLog: ActivityEntry[];
  members: Member[];
  settings: Settings;
  nextTaskNumber: number;
  ui: UIState;
  // True once data has been loaded from the backend at least once. False while
  // the server is unreachable so the UI can avoid implying the (empty) memory
  // state is real.
  dataLoaded: boolean;

  // Two-phase completion animation (#53). UI-only, never persisted: tasks in
  // here are completed in the store but still shown "virtually open" at their
  // old list position ('hold' = grey in place, 'exit' = collapsing out of a
  // view that hides completed tasks).
  completionHold: Record<string, 'hold' | 'exit'>;
  // Incremented when a hold releases into the completed block — the FLIP hook
  // listens to this to animate the position change.
  completionPulse: number;

  // Pomodoro timer (#3): runtime state lives in the store so the countdown
  // survives view changes; it also persists to localStorage so a page reload
  // resumes it (#39). Interval settings persist to the server.
  pomodoro: PomodoroState;
  pomodoroLog: Record<string, number>; // local day → focus rounds completed (#39)
  pomodoroTaskLog: PomodoroTaskLog; // local day → { taskId → focus seconds } (#39)
  pomodoroStart: () => void;
  pomodoroPause: () => void;
  pomodoroReset: () => void;
  // Move to the next phase (timer hit 0 or user skipped). Honors auto-start
  // settings and tallies a completed focus into pomodoroLog.
  pomodoroAdvance: () => void;
  // Jump straight to a phase (the pomofocus-style tabs); stops the timer.
  pomodoroSetPhase: (phase: PomodoroPhase) => void;
  // Focus the timer on a specific task. When a focus is already running this
  // SWITCHES the current task without resetting the timer; otherwise it starts a
  // fresh focus for the task (from Heute/Next Week, #39).
  pomodoroStartForTask: (taskId: string) => void;
  // Set/clear the current task; switches attribution mid-slot if focus runs.
  pomodoroSetTask: (taskId: string | null) => void;
  // Add focus seconds to a task's lifetime total (persisted to the server).
  addTaskFocusTime: (taskId: string, seconds: number) => void;
  // Merge a partial settings patch (Pomodoro, reminders, …) + sync it.
  patchSettings: (patch: Partial<Settings>) => void;

  loadAll: () => Promise<void>;

  // Task CRUD
  addTask: (input: NewTaskInput) => Task;
  addSubtask: (parentId: string, title: string) => Task | null;
  reorderSubtask: (draggedId: string, targetId: string) => void;
  setTaskParent: (id: string, parentId: string | null) => void;
  bulkCreateTasks: (
    projectId: string | null,
    rows: { section?: string; title: string; description?: string; duration?: string; recurrence?: string }[]
  ) => number;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  restoreTask: (entryId: string) => void;
  toggleTask: (id: string) => void;
  // #53: completes via toggleTask (persistence/recurring run immediately) but
  // holds the row visually in place for COMPLETION_HOLD_MS before it moves to
  // the completed block ('move') or collapses out ('exit').
  completeTaskAnimated: (id: string, releaseMode: 'move' | 'exit') => void;
  toggleStar: (id: string) => void;
  addComment: (taskId: string, text: string) => void;
  deleteComment: (taskId: string, commentId: string) => void;
  updateComment: (taskId: string, commentId: string, text: string) => void;
  addTaskLink: (taskId: string, link: TaskLink) => void;
  removeTaskLink: (taskId: string, link: TaskLink) => void;
  openTaskLink: (link: TaskLink) => void;
  addAttachment: (taskId: string, attachment: Attachment) => void;
  deleteAttachment: (taskId: string, attachmentId: string) => void;

  // Bulk operations
  bulkUpdate: (ids: string[], updates: Partial<Task>) => void;
  bulkDelete: (ids: string[]) => void;

  // Manual ordering (drag & drop)
  reorderTasks: (draggedId: string, targetId: string) => void;
  reorderProjects: (draggedId: string, targetId: string) => void;

  // Project sections (groups)
  addSection: (scope: string, name: string) => Section;
  renameSection: (id: string, name: string) => void;
  deleteSection: (id: string) => void;
  reorderSections: (draggedId: string, targetId: string) => void;
  // Drop a task onto another task: adopt its section + order before it.
  dropTaskOnTask: (draggedId: string, targetId: string) => void;
  // Assign a task to a section (or null to ungroup); moves it to the end of that group.
  assignTaskSection: (taskId: string, sectionId: string | null) => void;

  // Wipe all local tasks + projects + categories (fresh start / clean re-import).
  clearAll: () => void;

  // Import: replace tasks/projects/categories with mapped Nozbe data.
  replaceWithNozbe: (data: MappedImport) => {
    projects: number;
    categories: number;
    tasks: number;
  };

  // Project CRUD
  addProject: (
    name: string,
    color?: string,
    icon?: string,
    opts?: { active?: boolean; kind?: ProjectKind }
  ) => Project;
  toggleProjectActive: (id: string) => void;
  archiveProject: (id: string) => void;
  reopenProject: (id: string) => void;
  reorderNav: (draggedId: string, targetId: string) => void;
  addBlocker: (blocker: Omit<ProjectBlocker, 'id'>) => void;
  updateBlocker: (id: string, updates: Partial<ProjectBlocker>) => void;
  deleteBlocker: (id: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  toggleProjectPinned: (id: string) => void;

  createProjectFromTemplate: (template: ProjectTemplate) => Project;

  // Category CRUD
  addCategory: (name: string, color?: string) => Category;
  updateCategory: (id: string, updates: Partial<Category>) => void;
  deleteCategory: (id: string) => void;

  // UI
  selectTask: (id: string | null) => void;
  selectProject: (id: string | null) => void;
  toggleProjectSelected: (id: string) => void;
  selectTaskForEdit: (id: string) => void;
  clearEditTitle: () => void;
  setView: (view: ViewType) => void;
  setSidePanel: (panel: SidePanel) => void;
  setCurrentDate: (date: Date) => void;
  setSelectedDates: (dates: string[]) => void;
  setSearchQuery: (q: string) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  resetFilters: () => void;
  setSort: (field: SortField, dir?: UIState['sortDir']) => void;

  // Saved (custom) views
  addSavedView: (name: string) => SavedView;
  deleteSavedView: (id: string) => void;
  applySavedView: (id: string) => void;

  // Team (local) + settings
  addMember: (name: string, role?: MemberRole) => Member;
  updateMember: (id: string, updates: Partial<Member>) => void;
  deleteMember: (id: string) => void;
  toggleTaskAssignee: (taskId: string, memberId: string) => void;
  setUserName: (name: string) => void;
  setTheme: (theme: Theme) => void;
  setAddToTop: (v: boolean) => void;
  setFiltersCollapsed: (v: boolean) => void;
  setSectionsCollapsed: (v: boolean) => void;
  setProjectSort: (sort: ProjectSort) => void;
  setProjectsPanelWidth: (px: number) => void;
  setDetailPanelWidth: (px: number) => void;
  setCalendarMode: (mode: CalendarMode) => void;
  setCalendarHours: (startHour: number, endHour: number) => void;
  setCalendarMonthCount: (count: number) => void;
  setCalendarHourHeight: (px: number) => void;
  addPaletteColor: (color: string) => void;
  removePaletteColor: (color: string) => void;
  setColorLabel: (color: string, label: string) => void;

  // Nozbe connection + live sync
  connectNozbe: (token: string, clientId: string) => void;
  disconnectNozbe: () => void;
  setNozbeSync: (enabled: boolean) => void;
}

// Fire-and-forget: push a completion change to Nozbe if connected + sync enabled.
const syncCompletion = (state: AppState, task: Task, completed: boolean) => {
  const nz = state.settings.nozbe;
  if (nz?.syncCompleted && nz.token && nz.clientId && task.nozbeId) {
    void pushNozbeCompleted(nz.token, nz.clientId, task.nozbeId, completed).catch(
      (e) => console.warn('Nozbe-Sync fehlgeschlagen:', e)
    );
  }
};

const PROJECT_COLORS = ['#4caf50', '#2196f3', '#ff9800', '#9c27b0', '#e91e63', '#00bcd4'];

// The current user as a member, so every task has a responsible person with an
// avatar by default. Always present (seeded + ensured on migrate).
export const SELF_MEMBER_ID = 'u-me';
const SELF_MEMBER: Member = {
  id: SELF_MEMBER_ID,
  name: 'Ich',
  role: 'admin',
  color: '#2b8a3e',
};

// Default order of the main sidebar menus (user can reorder via drag & drop).
export const DEFAULT_NAV_ORDER: ViewType[] = [
  'priority',
  'inbox',
  'today',
  'nextweek',
  'someday',
  'projects',
  'categories',
  'calendar',
  'templates',
  'members',
];

// Coalesce concurrent loadAll() calls: since boot no longer awaits the initial
// load, the auto-sync retry (and manual "Jetzt synchronisieren") can fire while
// it is still in flight. A second run would fetch server state from BEFORE the
// outbox flush and clobber newer optimistic edits.
let loadAllInFlight: Promise<void> | null = null;
// Duplicate task numbers are repaired at most once per session (see loadAll).
let renumberRequested = false;

// #53: two-phase completion timing — grey hold in place, then slide/collapse.
export const COMPLETION_HOLD_MS = 500;
export const COMPLETION_ANIM_MS = 400;
// Pending hold timers by task id (module-level: timer handles are not state).
const holdTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useStore = create<AppState>()((set, get) => ({
  tasks: [],
  projects: [],
  sections: [],
  blockers: [],
  categories: [],
  savedViews: [],
  activityLog: [],
  members: [SELF_MEMBER],
  settings: defaultSettings,
  nextTaskNumber: 1,
  ui: defaultUIState,
  dataLoaded: false,
  completionHold: {},
  completionPulse: 0,
  pomodoro: pomoInit?.state ?? { phase: 'focus', running: false, endsAt: null, remainingMs: 25 * 60_000, round: 1, currentTaskId: null, focusSegmentStart: null },
  pomodoroLog: pomoInit?.log ?? {},
  pomodoroTaskLog: pomoInit?.taskLog ?? {},

  addTaskFocusTime: (taskId, seconds) => {
    if (!seconds || seconds <= 0) return;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, focusSeconds: (t.focusSeconds ?? 0) + seconds, updatedAt: new Date() } : t
      ),
    }));
    const t = get().tasks.find((x) => x.id === taskId);
    if (t) enqueue('task.update', { id: taskId, patch: { focusSeconds: t.focusSeconds } });
  },

  pomodoroStart: () =>
    set((state) => {
      const now = Date.now();
      const pomodoro: PomodoroState = {
        ...state.pomodoro,
        running: true,
        endsAt: now + state.pomodoro.remainingMs,
        focusSegmentStart: state.pomodoro.phase === 'focus' ? now : null,
      };
      savePomodoro(pomodoro, state.pomodoroLog, state.pomodoroTaskLog);
      return { pomodoro };
    }),

  pomodoroPause: () => {
    const now = Date.now();
    const acc = pendingFocus(get().pomodoro, now);
    set((state) => {
      const taskLog = withAccrual(state.pomodoroTaskLog, acc);
      const pomodoro: PomodoroState = {
        ...state.pomodoro,
        running: false,
        remainingMs: Math.max(0, (state.pomodoro.endsAt ?? now) - now),
        endsAt: null,
        focusSegmentStart: null,
      };
      savePomodoro(pomodoro, state.pomodoroLog, taskLog);
      return { pomodoro, pomodoroTaskLog: taskLog };
    });
    if (acc) get().addTaskFocusTime(acc.taskId, acc.delta);
  },

  pomodoroReset: () => {
    const now = Date.now();
    const acc = pendingFocus(get().pomodoro, now);
    set((state) => {
      const taskLog = withAccrual(state.pomodoroTaskLog, acc);
      const pomodoro: PomodoroState = {
        phase: 'focus',
        running: false,
        endsAt: null,
        remainingMs: pomodoroPhaseMs('focus', state.settings),
        round: 1,
        currentTaskId: state.pomodoro.currentTaskId ?? null,
        focusSegmentStart: null,
      };
      savePomodoro(pomodoro, state.pomodoroLog, taskLog);
      return { pomodoro, pomodoroTaskLog: taskLog };
    });
    if (acc) get().addTaskFocusTime(acc.taskId, acc.delta);
  },

  pomodoroSetPhase: (phase) => {
    const now = Date.now();
    const acc = pendingFocus(get().pomodoro, now);
    set((state) => {
      const taskLog = withAccrual(state.pomodoroTaskLog, acc);
      const pomodoro: PomodoroState = {
        ...state.pomodoro,
        phase,
        running: false,
        endsAt: null,
        remainingMs: pomodoroPhaseMs(phase, state.settings),
        focusSegmentStart: null,
      };
      savePomodoro(pomodoro, state.pomodoroLog, taskLog);
      return { pomodoro, pomodoroTaskLog: taskLog };
    });
    if (acc) get().addTaskFocusTime(acc.taskId, acc.delta);
  },

  pomodoroStartForTask: (taskId) => {
    const now = Date.now();
    const cur = get().pomodoro;
    // A running focus → SWITCH the task, keep the slot. Otherwise start fresh.
    const switching = cur.running && cur.phase === 'focus';
    const acc = switching ? pendingFocus(cur, now) : null;
    set((state) => {
      const taskLog = withAccrual(state.pomodoroTaskLog, acc);
      const pomodoro: PomodoroState = switching
        ? { ...state.pomodoro, currentTaskId: taskId, focusSegmentStart: now }
        : (() => {
            const ms = pomodoroPhaseMs('focus', state.settings);
            return {
              phase: 'focus' as const,
              running: true,
              endsAt: now + ms,
              remainingMs: ms,
              round: state.pomodoro.round,
              currentTaskId: taskId,
              focusSegmentStart: now,
            };
          })();
      savePomodoro(pomodoro, state.pomodoroLog, taskLog);
      return { pomodoro, pomodoroTaskLog: taskLog };
    });
    if (acc) get().addTaskFocusTime(acc.taskId, acc.delta);
  },

  pomodoroSetTask: (taskId) => {
    const now = Date.now();
    const cur = get().pomodoro;
    const active = cur.running && cur.phase === 'focus';
    const acc = active ? pendingFocus(cur, now) : null;
    set((state) => {
      const taskLog = withAccrual(state.pomodoroTaskLog, acc);
      const pomodoro: PomodoroState = {
        ...state.pomodoro,
        currentTaskId: taskId,
        focusSegmentStart: active ? now : state.pomodoro.focusSegmentStart ?? null,
      };
      savePomodoro(pomodoro, state.pomodoroLog, taskLog);
      return { pomodoro, pomodoroTaskLog: taskLog };
    });
    if (acc) get().addTaskFocusTime(acc.taskId, acc.delta);
  },

  pomodoroAdvance: () => {
    const now = Date.now();
    const acc = pendingFocus(get().pomodoro, now); // open only during a focus phase
    set((state) => {
      const p = state.pomodoro;
      const rounds = state.settings.pomodoroRounds ?? 4;
      const { phase: nextPhase, round: nextRound, focusCompleted } = nextPomodoroPhase(p.phase, p.round, rounds);
      const ms = pomodoroPhaseMs(nextPhase, state.settings);
      // Auto-start the next phase only if enabled (pomofocus-style, default off).
      const autoStart = p.phase === 'focus'
        ? (state.settings.pomodoroAutoStartBreaks ?? 0) === 1
        : (state.settings.pomodoroAutoStartPomodoros ?? 0) === 1;
      const running = p.running && autoStart;
      // Tally a completed focus into today's rounds (#39 daily summary).
      let log = state.pomodoroLog;
      if (focusCompleted) {
        const key = pomodoroDayKey(new Date());
        log = { ...log, [key]: (log[key] ?? 0) + 1 };
      }
      const taskLog = withAccrual(state.pomodoroTaskLog, acc);
      const pomodoro: PomodoroState = {
        phase: nextPhase,
        round: nextRound,
        running,
        remainingMs: ms,
        endsAt: running ? now + ms : null,
        currentTaskId: p.currentTaskId ?? null,
        focusSegmentStart: running && nextPhase === 'focus' ? now : null,
      };
      savePomodoro(pomodoro, log, taskLog);
      return { pomodoro, pomodoroLog: log, pomodoroTaskLog: taskLog };
    });
    if (acc) get().addTaskFocusTime(acc.taskId, acc.delta);
  },

  patchSettings: (patch) => {
    set((state) => ({ settings: { ...state.settings, ...patch } }));
    enqueue('settings.patch', { patch });
  },

  loadAll: () => {
    if (loadAllInFlight) return loadAllInFlight;
    loadAllInFlight = (async () => {
    // SQLite is the single source of truth. We NEVER fall back to the legacy
    // `nozbe-clone-state` localStorage snapshot — doing so resurrected stale
    // data and could overwrite the real DB. Any unsynced edits live in the
    // durable outbox; flush them first so the server is up to date, then load.
    // Offline display: if memory is still empty, hydrate from the local snapshot
    // first so the app shows last-known data instantly (and works fully offline).
    // A successful fetch below overwrites it; the cache is never pushed to the server.
    if (get().tasks.length === 0) {
      const snap = loadSnapshot();
      if (snap?.tasks?.length) {
        set({
          tasks: snap.tasks, projects: snap.projects ?? [], sections: snap.sections ?? [],
          blockers: snap.blockers ?? [], categories: snap.categories ?? [],
          savedViews: snap.savedViews ?? [], activityLog: snap.activityLog ?? [],
          members: snap.members?.length ? snap.members : [SELF_MEMBER],
          settings: { ...defaultSettings, ...(snap.settings ?? {}) },
          nextTaskNumber: safeNextNumber(snap.nextTaskNumber, snap.tasks),
        });
      }
    }

    // Local-first: remember the write counter, push pending edits, then pull.
    const seqBefore = writeSeq();
    try {
      await flushOutbox();
    } catch { /* offline — the load below will fail and we stay in offline mode */ }

    // Edits still queued → the fetched data would be discarded anyway (see the
    // guard below). Skip the 9 calls: on Appwrite each one is a function
    // execution counted against the per-user rate limit (#108).
    if (pendingCount() > 0) return;

    try {
      const [tasks, projects, sections, blockers, categories, savedViews, activityLog, members, settingsData] = await Promise.all([
        tasksApi.getAll(),
        projectsApi.getAll(),
        sectionsApi.getAll(),
        blockersApi.getAll(),
        categoriesApi.getAll(),
        savedViewsApi.getAll(),
        activityLogApi.getAll(),
        membersApi.getAll(),
        settingsApi.getAll(),
      ]);
      const { nextTaskNumber, ...rawSettings } = settingsData;
      const settings = { ...defaultSettings, ...rawSettings };
      // Defensive: ensure numeric settings are numbers (a stale string value
      // would break numeric math, e.g. WeekView hour labels / zoom).
      for (const k of ['calendarStartHour', 'calendarEndHour', 'calendarMonthCount', 'calendarHourHeight', 'projectsPanelWidth', 'detailPanelWidth'] as const) {
        const v = (settings as Record<string, unknown>)[k];
        if (typeof v === 'string' && v.trim() !== '') (settings as Record<string, unknown>)[k] = Number(v);
      }
      const safeMembers = members.length ? members : [SELF_MEMBER];

      // Local edits the server has not confirmed yet (still queued, or made
      // while this fetch was running) are missing from the fetched data.
      // Applying it would make e.g. a just-added task vanish until a later
      // pull — so keep the local state; the next pull after the outbox has
      // drained brings in remote changes.
      if (pendingCount() > 0 || writeSeq() !== seqBefore) {
        set({ dataLoaded: true });
        return;
      }

      // Trust the server completely — an empty DB is legitimately empty.
      const nextNumber = safeNextNumber(nextTaskNumber, tasks);
      set({ tasks, projects, sections, blockers, categories, savedViews, activityLog, members: safeMembers, settings, nextTaskNumber: nextNumber, dataLoaded: true });
      // Refresh the offline display cache with server truth.
      saveSnapshot({ tasks, projects, sections, blockers, categories, savedViews, activityLog, members: safeMembers, settings, nextTaskNumber: nextNumber });
      // Old duplicate numbers (two tasks #1775): the server repairs them all in
      // one call, then we pull again. Once per session — never a retry loop.
      if (!IS_EXTRA_WINDOW && !renumberRequested && duplicateNumberTasks(tasks).length) {
        renumberRequested = true;
        void tasksApi.renumberDuplicates()
          .then((r) => { if (r?.renumbered) void get().loadAll(); })
          .catch((err) => console.warn('Renumbering duplicate task numbers failed', err));
      }
    } catch (e) {
      // Backend unreachable. Do NOT load or overwrite anything — keep whatever
      // is already in memory and let the offline banner inform the user. The
      // app will retry loadAll() automatically once the server is back.
      console.warn('Server not reachable; staying in offline mode (no data touched)', e);
      set({ dataLoaded: false });
    }
    })().finally(() => { loadAllInFlight = null; });
    return loadAllInFlight;
  },

  addTask: (input) => {
        const now = new Date();
        const number = get().nextTaskNumber;
        const task: Task = {
          id: uid('task'),
          number,
          title: input.title,
          description: input.description ?? '',
          projectId: input.projectId ?? null,
          parentId: input.parentId ?? null,
          dueDate: input.dueDate ?? null,
          startMinutes: input.startMinutes ?? null,
          durationMin: input.durationMin ?? null,
          sectionId: input.sectionId ?? null,
          priority: input.priority ?? 'medium',
          categoryIds: input.categoryIds ?? [],
          completed: false,
          createdAt: now,
          updatedAt: now,
          // Next Week / Heute implies Next Action (same rule as gtdInvariants).
          starred: input.starred ?? (input.thisWeek === true || !!input.todayDate),
          someday: input.someday ?? false,
          thisWeek: input.thisWeek ?? false,
          todayDate: input.todayDate ?? null,
          // Every task gets responsible person(s); default to the current user.
          assigneeIds:
            input.assigneeIds ??
            (input.assigneeId ? [input.assigneeId] : [SELF_MEMBER_ID]),
          recurrence: input.recurrence ?? 'none',
          recurrenceEnd: null,
          linkedProjectId: input.linkedProjectId ?? null,
          sortOrder: input.sortOrder ?? 0,
        };
        set((state) => ({
          // Honour the quick-add direction toggle: prepend or append.
          tasks: state.settings.addToTop
            ? [task, ...state.tasks]
            : [...state.tasks, task],
          nextTaskNumber: state.nextTaskNumber + 1,
          activityLog: pushLog(
            state.activityLog,
            taskEntry('created', task, state.settings.userName)
          ),
        }));
        enqueue('task.create', { task });
        return task;
      },

      // Create many tasks at once (pasted table). All land in `projectId`; a
      // per-row section name creates/reuses a section in that project's scope.
      bulkCreateTasks: (projectId, rows) => {
        const scope = projectId;
        // Pass 1: create sections in forward order so they appear top-to-bottom.
        const sectionIdMap = new Map<string, string>();
        if (scope) {
          for (const r of rows) {
            const secName = r.section?.trim();
            if (!secName || sectionIdMap.has(secName.toLowerCase())) continue;
            const existing = get().sections.find(
              (s) => s.scope === scope && s.name.trim().toLowerCase() === secName.toLowerCase()
            );
            sectionIdMap.set(secName.toLowerCase(), existing ? existing.id : get().addSection(scope, secName).id);
          }
        }
        // Pass 2: insert tasks. Reverse when addToTop so row 1 ends up on top.
        const ordered = get().settings.addToTop ? [...rows].reverse() : rows;
        let count = 0;
        for (const r of ordered) {
          const title = r.title.trim();
          if (!title) continue;
          const secName = r.section?.trim();
          const sectionId = secName ? (sectionIdMap.get(secName.toLowerCase()) ?? null) : null;
          get().addTask({
            title,
            description: r.description?.trim() || undefined,
            projectId,
            sectionId,
            durationMin: parseDuration(r.duration),
            recurrence: parseRecurrence(r.recurrence),
          });
          count++;
        }
        return count;
      },

      addSubtask: (parentId, title) => {
        const parent = get().tasks.find((t) => t.id === parentId);
        if (!parent) return null;
        // Append after existing siblings so subtasks keep their entry order.
        const siblingMax = get().tasks
          .filter((t) => t.parentId === parentId)
          .reduce((m, t) => Math.max(m, t.sortOrder ?? 0), -1);
        const task = get().addTask({
          title,
          parentId,
          projectId: parent.projectId,
          sortOrder: siblingMax + 1,
        });
        set((state) => ({
          activityLog: pushLog(
            state.activityLog,
            taskEntry('subtask', parent, state.settings.userName, { to: title })
          ),
        }));
        return task;
      },

      // Reorder a subtask within its parent: move `draggedId` to just before
      // `targetId` among its siblings, then renumber their sortOrder.
      reorderSubtask: (draggedId, targetId) => {
        if (draggedId === targetId) return;
        const tasks = get().tasks;
        const dragged = tasks.find((t) => t.id === draggedId);
        const target = tasks.find((t) => t.id === targetId);
        if (!dragged || !target) return;
        const parentId = dragged.parentId ?? null;
        if ((target.parentId ?? null) !== parentId || parentId === null) return;
        const siblings = tasks
          .filter((t) => t.parentId === parentId)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || +a.createdAt - +b.createdAt);
        const without = siblings.filter((t) => t.id !== draggedId);
        const at = without.findIndex((t) => t.id === targetId);
        without.splice(at < 0 ? without.length : at, 0, dragged);
        const orderById = new Map(without.map((t, i) => [t.id, i]));
        const now = new Date();
        set((state) => ({
          tasks: state.tasks.map((t) =>
            orderById.has(t.id) ? { ...t, sortOrder: orderById.get(t.id)!, updatedAt: now } : t
          ),
        }));
        enqueue('task.reorder', { ids: without.map((t) => t.id) });
      },

      // Convert a task into a subtask of `parentId`, or promote it back to a
      // root task with `parentId = null`. Guards against cycles and enforces a
      // single nesting level (the chosen parent must itself be a root task).
      setTaskParent: (id, parentId) => {
        const state = get();
        const task = state.tasks.find((t) => t.id === id);
        if (!task) return;
        if (id === parentId) return; // can't parent to self
        if ((task.parentId ?? null) === (parentId ?? null)) return; // no-op

        if (parentId !== null) {
          const parent = state.tasks.find((t) => t.id === parentId);
          if (!parent) return;
          // The target must be a root task (no nesting beyond one level).
          if (parent.parentId) return;
          // The dragged task must not currently have its own children, else
          // moving it under a parent would create a 2-level chain.
          if (state.tasks.some((t) => t.parentId === id)) return;
        }

        const now = new Date();
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, parentId, updatedAt: now } : t
          ),
          activityLog: pushLog(
            s.activityLog,
            taskEntry('updated', task, s.settings.userName, {
              field: 'Unteraufgabe',
              from: task.parentId ? 'Unteraufgabe' : 'Hauptaufgabe',
              to: parentId ? 'Unteraufgabe' : 'Hauptaufgabe',
            })
          ),
        }));
        enqueue('task.update', { id, patch: { parentId } });
      },

      updateTask: (id, rawUpdates) => {
        // Enforce GTD invariants (Someday/Next Week/Heute + auto Single-Tasks).
        // Computed up front so the outbox receives the same adjusted patch as
        // local state — enqueueing rawUpdates would let the server keep stale
        // flags (e.g. someday=1) that the next loadAll() resurrects.
        const before = get().tasks.find((t) => t.id === id);
        const updates = before ? gtdInvariants(before, rawUpdates) : rawUpdates;
        set((state) => {
          const tasks = state.tasks.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: new Date() } : t
          );
          let activityLog = state.activityLog;
          if (before) {
            const after = { ...before, ...updates };
            const ctx = {
              projects: state.projects,
              categories: state.categories,
              members: state.members,
            };
            const entries = TRACKED_FIELDS.filter(
              (f) => f.key in updates && !sameValue(before[f.key], after[f.key])
            ).map((f) =>
              taskEntry('updated', after, state.settings.userName, {
                field: f.label,
                from: fmtVal(f.key, before[f.key], ctx),
                to: fmtVal(f.key, after[f.key], ctx),
              })
            );
            for (const e of entries) activityLog = mergeOrPush(activityLog, e);
          }
          return { tasks, activityLog };
        });
        enqueue('task.update', { id, patch: updates });

        // Subtasks belong to their parent's project — when a root task is moved
        // to another project, its subtasks must move with it (#35). They were
        // being left behind (e.g. in the Inbox) after a project change.
        if ('projectId' in updates && !before?.parentId) {
          const childIds = get().tasks
            .filter((t) => t.parentId === id && t.projectId !== updates.projectId)
            .map((t) => t.id);
          for (const cid of childIds) {
            set((state) => ({
              tasks: state.tasks.map((t) =>
                t.id === cid ? { ...t, projectId: updates.projectId ?? null, updatedAt: new Date() } : t
              ),
            }));
            enqueue('task.update', { id: cid, patch: { projectId: updates.projectId ?? null } });
          }
        }
      },

      deleteTask: (id) => {
        set((state) => {
          // Cascade: remove the task and all of its descendant subtasks.
          const toRemove = new Set<string>();
          const collect = (pid: string) => {
            toRemove.add(pid);
            state.tasks
              .filter((t) => t.parentId === pid)
              .forEach((c) => collect(c.id));
          };
          collect(id);
          const removed = state.tasks.find((t) => t.id === id);
          // Snapshot the deleted task + its subtasks so it can be restored later.
          const subtasks = state.tasks.filter(
            (t) => toRemove.has(t.id) && t.id !== id
          );
          const entry = removed
            ? {
                ...taskEntry('deleted', removed, state.settings.userName),
                payload: { task: removed, subtasks },
              }
            : null;
          return {
            tasks: state.tasks.filter((t) => !toRemove.has(t.id)),
            activityLog: entry ? pushLog(state.activityLog, entry) : state.activityLog,
            ui:
              state.ui.selectedTaskId && toRemove.has(state.ui.selectedTaskId)
                ? { ...state.ui, selectedTaskId: null }
                : state.ui,
          };
        });
        enqueue('task.remove', { id });
      },

      restoreTask: (entryId) =>
        set((state) => {
          const entry = state.activityLog.find((e) => e.id === entryId);
          if (!entry?.payload) return {};
          const existing = new Set(state.tasks.map((t) => t.id));
          // Normalise date fields (the persist reviver doesn't reach nested payloads).
          const fix = (t: Task): Task => ({
            ...t,
            dueDate: t.dueDate ? new Date(t.dueDate) : t.dueDate,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
            recurrenceEnd: t.recurrenceEnd ? new Date(t.recurrenceEnd) : t.recurrenceEnd,
          });
          const toAdd = [entry.payload.task, ...entry.payload.subtasks]
            .filter((t) => !existing.has(t.id))
            .map(fix);
          if (!toAdd.length) return {};
          return { tasks: [...state.tasks, ...toAdd] };
        }),

      toggleTask: (id) => {
        // Toggling a task that is mid completion-hold cancels the animation
        // (#53 AC3): the row never moved, so it just returns to normal.
        const pendingTimer = holdTimers.get(id);
        if (pendingTimer != null) {
          clearTimeout(pendingTimer);
          holdTimers.delete(id);
          set((state) => {
            const completionHold = { ...state.completionHold };
            delete completionHold[id];
            return { completionHold };
          });
        }

        const before = get().tasks.find((t) => t.id === id);
        const completing = before ? !before.completed : false;

        // Pre-compute the next recurring occurrence (if any) so we can both add
        // it to state AND persist it via the outbox (otherwise it lives only in
        // memory and is lost on the next load). The occurrence also carries over
        // the task's subtasks (fresh/uncompleted) — they must not be lost.
        let spawned: Task | null = null;
        let spawnedSubs: Task[] = [];
        if (before && completing && before.recurrence !== 'none' && before.dueDate) {
          // Missed occurrences are skipped, not replayed one by one.
          const nextDue = nextDueAfterCompletion(before.dueDate, new Date(), (d) => nextRecurrence(d, before));
          if (!before.recurrenceEnd || nextDue <= before.recurrenceEnd) {
            // Carry the subtasks into the new occurrence (fix #20).
            const subs = get().tasks.filter((x) => x.parentId === before.id);
            const occ = buildOccurrence(before, subs, get().nextTaskNumber, nextDue, new Date(), () => uid('task'));
            spawned = occ.parent;
            spawnedSubs = occ.subs;
          }
        }

        set((state) => {
          const target = state.tasks.find((t) => t.id === id);
          if (!target) return {};
          const now = new Date();
          const tasks = state.tasks.map((t) => {
            if (t.id === id) return { ...t, completed: completing, completedAt: completing ? now : null, updatedAt: now };
            // When completing a parent, close all its subtasks too.
            if (completing && t.parentId === id && !t.completed)
              return { ...t, completed: true, completedAt: now, updatedAt: now };
            return t;
          });
          if (spawned) tasks.push(spawned, ...spawnedSubs);
          const activityLog = pushLog(
            state.activityLog,
            taskEntry(
              completing ? 'completed' : 'reopened',
              target,
              state.settings.userName
            )
          );
          return { tasks, activityLog, nextTaskNumber: state.nextTaskNumber + (spawned ? 1 + spawnedSubs.length : 0) };
        });
        const t = get().tasks.find(x => x.id === id);
        if (t) {
          enqueue('task.update', { id, patch: { completed: t.completed, completedAt: t.completedAt } });
          // Persist subtask completions too.
          if (t.completed) {
            get().tasks.filter(x => x.parentId === id && x.completed).forEach(sub =>
              enqueue('task.update', { id: sub.id, patch: { completed: true, completedAt: sub.completedAt } })
            );
          }
        }
        // Persist the spawned recurring occurrence + its subtasks (parent first,
        // so the server has it before the children reference it) + the counter.
        if (spawned) {
          enqueue('task.create', { task: spawned });
          spawnedSubs.forEach((s) => enqueue('task.create', { task: s }));
          enqueue('settings.patch', { patch: { nextTaskNumber: get().nextTaskNumber } });
        }
        // Write the completion change back to Nozbe (if connected + enabled).
        if (before) syncCompletion(get(), before, !before.completed);
      },

      completeTaskAnimated: (id, releaseMode) => {
        const before = get().tasks.find((t) => t.id === id);
        if (!before || before.completed) return;
        // Store flips (and persists) immediately — only the visuals are staged.
        get().toggleTask(id);
        set((state) => ({ completionHold: { ...state.completionHold, [id]: 'hold' as const } }));
        holdTimers.set(
          id,
          setTimeout(() => {
            if (!get().completionHold[id]) return; // cancelled meanwhile
            if (releaseMode === 'exit') {
              // Keep the row rendered while it collapses, then let it unmount.
              set((state) => ({ completionHold: { ...state.completionHold, [id]: 'exit' as const } }));
              holdTimers.set(
                id,
                setTimeout(() => {
                  holdTimers.delete(id);
                  set((state) => {
                    const completionHold = { ...state.completionHold };
                    delete completionHold[id];
                    return { completionHold };
                  });
                }, COMPLETION_ANIM_MS)
              );
            } else {
              holdTimers.delete(id);
              set((state) => {
                const completionHold = { ...state.completionHold };
                delete completionHold[id];
                // Pulse triggers the FLIP glide into the completed block.
                return { completionHold, completionPulse: state.completionPulse + 1 };
              });
            }
          }, COMPLETION_HOLD_MS)
        );
      },

      toggleStar: (id) => {
        const t = get().tasks.find((x) => x.id === id);
        if (t) get().updateTask(id, { starred: !t.starred });
      },

      addComment: (taskId, text) => {
        set((state) => {
          const target = state.tasks.find((t) => t.id === taskId);
          return {
            tasks: state.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    comments: [
                      ...(t.comments ?? []),
                      {
                        id: uid('cmt'),
                        text,
                        author: state.settings.userName,
                        createdAt: new Date(),
                      },
                    ],
                  }
                : t
            ),
            activityLog: target
              ? pushLog(
                  state.activityLog,
                  taskEntry('comment', target, state.settings.userName, { to: text })
                )
              : state.activityLog,
          };
        });
        const t = get().tasks.find(x => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { comments: t.comments } });
      },

      updateComment: (taskId, commentId, text) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  comments: (t.comments ?? []).map((c) =>
                    c.id === commentId ? { ...c, text } : c
                  ),
                }
              : t
          ),
        }));
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { comments: t.comments ?? [] } });
      },

      deleteComment: (taskId, commentId) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? { ...t, comments: (t.comments ?? []).filter((c) => c.id !== commentId) }
              : t
          ),
        }));
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { comments: t.comments ?? [] } });
      },

      addTaskLink: (taskId, link) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const links = t.links ?? [];
            if (links.some((l) => l.type === link.type && l.id === link.id)) return t;
            return { ...t, links: [...links, link] };
          }),
        }));
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { links: t.links ?? [] } });
      },

      removeTaskLink: (taskId, link) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  links: (t.links ?? []).filter(
                    (l) => !(l.type === link.type && l.id === link.id)
                  ),
                }
              : t
          ),
        }));
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { links: t.links ?? [] } });
      },

      // Navigate to whatever a link points at (a task's detail, or a project view).
      openTaskLink: (link) =>
        set((state) => {
          if (link.type === 'task') {
            return { ui: { ...state.ui, selectedTaskId: link.id } };
          }
          return {
            ui: {
              ...state.ui,
              currentView: 'projects',
              sidePanel: 'projects',
              selectedProjectId: link.id,
              selectedProjectIds: [link.id],
              selectedTaskId: null,
            },
          };
        }),

      addAttachment: (taskId, attachment) => {
        set((state) => {
          const target = state.tasks.find((t) => t.id === taskId);
          return {
            tasks: state.tasks.map((t) =>
              t.id === taskId
                ? { ...t, attachments: [...(t.attachments ?? []), attachment] }
                : t
            ),
            activityLog: target
              ? pushLog(
                  state.activityLog,
                  taskEntry('attachment', target, state.settings.userName, {
                    to: attachment.name,
                  })
                )
              : state.activityLog,
          };
        });
        // Persist — attachments used to be memory-only and vanished on reload.
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { attachments: t.attachments ?? [] } });
      },

      deleteAttachment: (taskId, attachmentId) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  attachments: (t.attachments ?? []).filter(
                    (a) => a.id !== attachmentId
                  ),
                }
              : t
          ),
        }));
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { attachments: t.attachments ?? [] } });
      },

      bulkUpdate: (ids, updates) => {
        const idSet = new Set(ids);
        // Queue each task's invariant-adjusted patch for the server — without
        // this, bulk edits only lived in memory and vanished on the next load.
        for (const t of get().tasks) {
          if (idSet.has(t.id)) {
            enqueue('task.update', { id: t.id, patch: gtdInvariants(t, updates) });
          }
        }
        set((state) => {
          const ctx = {
            projects: state.projects,
            categories: state.categories,
            members: state.members,
          };
          let activityLog = state.activityLog;
          const tasks = state.tasks.map((t) => {
            if (!idSet.has(t.id)) return t;
            // Apply the same GTD invariants as single edits.
            const patch = gtdInvariants(t, updates);
            const after = { ...t, ...patch, updatedAt: new Date() };
            // Log every changed tracked field, per task.
            for (const f of TRACKED_FIELDS) {
              if (f.key in patch && !sameValue(t[f.key], after[f.key])) {
                activityLog = mergeOrPush(
                  activityLog,
                  taskEntry('updated', after, state.settings.userName, {
                    field: f.label,
                    from: fmtVal(f.key, t[f.key], ctx),
                    to: fmtVal(f.key, after[f.key], ctx),
                  })
                );
              }
            }
            return after;
          });
          return { tasks, activityLog };
        });
        // Sync bulk completion changes to Nozbe.
        if (updates.completed !== undefined) {
          const s = get();
          s.tasks
            .filter((t) => idSet.has(t.id) && t.nozbeId)
            .forEach((t) => syncCompletion(s, t, updates.completed as boolean));
        }
      },

      bulkDelete: (ids) => {
        // Queue the removals for the server (cascades subtasks server-side) —
        // without this, bulk-deleted tasks reappeared on the next load.
        for (const id of ids) enqueue('task.remove', { id });
        set((state) => {
          const idSet = new Set(ids);
          // Log each deleted task individually so it can be restored later.
          const newEntries: ActivityEntry[] = state.tasks
            .filter((t) => idSet.has(t.id))
            .map((t) => ({
              ...taskEntry('deleted', t, state.settings.userName),
              payload: {
                task: t,
                subtasks: state.tasks.filter(
                  (s) => s.parentId === t.id && !idSet.has(s.id)
                ),
              },
            }));
          let log = state.activityLog;
          for (const e of newEntries) log = pushLog(log, e);
          return {
            tasks: state.tasks.filter((t) => !idSet.has(t.id)),
            activityLog: log,
            ui:
              state.ui.selectedTaskId && idSet.has(state.ui.selectedTaskId)
                ? { ...state.ui, selectedTaskId: null }
                : state.ui,
          };
        });
      },

      // Move dragged task to the position of target (drop-before). Forces manual sort
      // so the new order is actually shown.
      reorderTasks: (draggedId, targetId) => {
        set((state) => {
          if (draggedId === targetId) return {};
          const list = [...state.tasks];
          const from = list.findIndex((t) => t.id === draggedId);
          const to = list.findIndex((t) => t.id === targetId);
          if (from === -1 || to === -1) return {};
          const [moved] = list.splice(from, 1);
          const insertAt = list.findIndex((t) => t.id === targetId);
          list.splice(insertAt, 0, moved);
          return {
            tasks: list,
            ui: { ...state.ui, sortField: 'manual' as SortField },
          };
        });
        const ids = get().tasks.map(t => t.id);
        enqueue('task.reorder', { ids });
      },

      addSection: (scope, name) => {
        // Append after existing siblings in this scope so new sections don't all
        // collide at sortOrder 0 (which would make their order arbitrary).
        const maxOrder = get().sections
          .filter((s) => s.scope === scope)
          .reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
        const section: Section = { id: uid('sec'), scope, name, sortOrder: maxOrder + 1 };
        set((state) => ({ sections: [...state.sections, section] }));
        enqueue('section.create', { section });
        return section;
      },

      renameSection: (id, name) => {
        set((state) => ({
          sections: state.sections.map((s) => (s.id === id ? { ...s, name } : s)),
        }));
        enqueue('section.update', { id, patch: { name } });
      },

      deleteSection: (id) => {
        set((state) => ({
          sections: state.sections.filter((s) => s.id !== id),
          // Tasks of a removed section fall back to ungrouped.
          tasks: state.tasks.map((t) =>
            t.sectionId === id ? { ...t, sectionId: null } : t
          ),
        }));
        enqueue('section.remove', { id });
      },

      reorderSections: (draggedId, targetId) => {
        const st = get();
        const dragged = st.sections.find((s) => s.id === draggedId);
        const target = st.sections.find((s) => s.id === targetId);
        if (!dragged || !target || draggedId === targetId || dragged.scope !== target.scope) return;
        // Reorder ONLY within the dragged section's scope, starting from what's
        // actually displayed (orderSections), then renumber that scope 0..n so it
        // becomes a clean explicit order (and stays honoured). Other scopes are
        // untouched — no more global renumber that scrambled cross-scope order.
        const ordered = orderSections(st.sections.filter((s) => s.scope === dragged.scope));
        const from = ordered.findIndex((s) => s.id === draggedId);
        const [moved] = ordered.splice(from, 1);
        const at = ordered.findIndex((s) => s.id === targetId);
        ordered.splice(at < 0 ? ordered.length : at, 0, moved);
        const orderById = new Map(ordered.map((s, i) => [s.id, i]));
        set((state) => ({
          sections: state.sections.map((s) =>
            orderById.has(s.id) ? { ...s, sortOrder: orderById.get(s.id) } : s
          ),
        }));
        enqueue('section.reorder', { ids: ordered.map((s) => s.id) });
      },

      dropTaskOnTask: (draggedId, targetId) => {
        if (draggedId === targetId) return;
        let sectionId: string | null | undefined;
        set((state) => {
          const list = [...state.tasks];
          const from = list.findIndex((t) => t.id === draggedId);
          const target = list.find((t) => t.id === targetId);
          if (from === -1 || !target) return {};
          const [moved] = list.splice(from, 1);
          moved.sectionId = target.sectionId ?? null;
          sectionId = moved.sectionId;
          const insertAt = list.findIndex((t) => t.id === targetId);
          list.splice(insertAt, 0, moved);
          return { tasks: list, ui: { ...state.ui, sortField: 'manual' as SortField } };
        });
        // Persist section membership + new order — previously local-only, so the
        // task fell out of its section on reload (#21).
        if (sectionId !== undefined) {
          enqueue('task.update', { id: draggedId, patch: { sectionId } });
          enqueue('task.reorder', { ids: get().tasks.map((t) => t.id) });
        }
      },

      assignTaskSection: (taskId, sectionId) => {
        let ok = false;
        set((state) => {
          const list = [...state.tasks];
          const from = list.findIndex((t) => t.id === taskId);
          if (from === -1) return {};
          const [moved] = list.splice(from, 1);
          moved.sectionId = sectionId;
          // Insert after the last task already in that section, else at the end.
          let insertAt = list.length;
          for (let i = list.length - 1; i >= 0; i--) {
            if ((list[i].sectionId ?? null) === sectionId) {
              insertAt = i + 1;
              break;
            }
          }
          list.splice(insertAt, 0, moved);
          ok = true;
          return { tasks: list, ui: { ...state.ui, sortField: 'manual' as SortField } };
        });
        // Persist section membership + new order — previously local-only, so the
        // task fell out of its section on reload (#21).
        if (ok) {
          enqueue('task.update', { id: taskId, patch: { sectionId } });
          enqueue('task.reorder', { ids: get().tasks.map((t) => t.id) });
        }
      },

      reorderProjects: (draggedId, targetId) => {
        set((state) => {
          if (draggedId === targetId) return {};
          const list = [...state.projects];
          const from = list.findIndex((p) => p.id === draggedId);
          const to = list.findIndex((p) => p.id === targetId);
          if (from === -1 || to === -1) return {};
          const [moved] = list.splice(from, 1);
          const insertAt = list.findIndex((p) => p.id === targetId);
          list.splice(insertAt, 0, moved);
          return {
            projects: list,
            settings: { ...state.settings, projectSort: 'manual' as ProjectSort },
          };
        });
        const ids = get().projects.map(p => p.id);
        enqueue('project.reorder', { ids });
      },

      clearAll: () =>
        set((state) => ({
          tasks: [],
          projects: [],
          sections: [],
          blockers: [],
          categories: [],
          nextTaskNumber: 1,
          activityLog: [
            plainEntry(
              'deleted',
              'Alle Aufgaben, Projekte und Kategorien gelöscht',
              state.settings.userName
            ),
          ],
          ui: {
            ...state.ui,
            selectedTaskId: null,
            selectedProjectId: null,
            sidePanel: 'none',
            currentView: 'inbox',
          },
        })),

      replaceWithNozbe: (data) => {
        const tasks = data.tasks.map((t, i) => ({ ...t, number: i + 1 }));
        set((state) => ({
          tasks,
          // Keep the Single-Tasks bucket available after a Nozbe import.
          projects: [...data.projects, SINGLE_TASKS_PROJECT],
          sections: [],
          blockers: [],
          categories: data.categories,
          nextTaskNumber: tasks.length + 1,
          activityLog: [
            plainEntry(
              'created',
              `Nozbe-Import: ${tasks.length} Aufgaben, ${data.projects.length} Projekte, ${data.categories.length} Kategorien`,
              state.settings.userName
            ),
          ],
          ui: {
            ...state.ui,
            selectedTaskId: null,
            selectedProjectId: null,
            sidePanel: 'none',
            currentView: 'inbox',
          },
        }));
        return {
          projects: data.projects.length,
          categories: data.categories.length,
          tasks: tasks.length,
        };
      },

      addProject: (name, color, icon, opts) => {
        const project: Project = {
          id: uid('proj'),
          name,
          color: color ?? PROJECT_COLORS[get().projects.length % PROJECT_COLORS.length],
          icon: icon ?? (opts?.kind === 'area' ? '🔁' : '📁'),
          active: opts?.active ?? true,
          kind: opts?.kind ?? 'project',
        };
        set((state) => ({
          // New projects appear at the top of the list.
          projects: [project, ...state.projects],
          activityLog: pushLog(
            state.activityLog,
            plainEntry('project-created', project.name, state.settings.userName)
          ),
        }));
        enqueue('project.create', { project });
        return project;
      },

      updateProject: (id, updates) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
        enqueue('project.update', { id, patch: updates });
      },

      toggleProjectPinned: (id) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, pinned: !p.pinned } : p
          ),
        }));
        const p = get().projects.find(x => x.id === id);
        if (p) enqueue('project.update', { id, patch: { pinned: p.pinned } });
      },

      // Active (under Projekte) ↔ inactive/someday. Areas stay always active.
      toggleProjectActive: (id) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id && p.kind !== 'area'
              ? { ...p, active: p.active === true ? false : true }
              : p
          ),
        }));
        const p = get().projects.find(x => x.id === id);
        if (p) enqueue('project.update', { id, patch: { active: p.active } });
      },

      // Close a finished project: archive it (hidden from active + someday, shown
      // in Archiv) and mark all its still-open tasks as completed.
      archiveProject: (id) => {
        const now = new Date();
        const changedIds = get().tasks
          .filter((t) => t.projectId === id && !t.completed)
          .map((t) => t.id);
        const changed = new Set(changedIds);
        set((state) => ({
          tasks: state.tasks.map((t) =>
            changed.has(t.id)
              ? { ...t, completed: true, completedAt: now, updatedAt: now }
              : t
          ),
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, archived: true, active: false } : p
          ),
        }));
        enqueue('project.update', { id, patch: { archived: true, active: false } });
        for (const tid of changedIds) {
          enqueue('task.update', { id: tid, patch: { completed: true, completedAt: now } });
        }
      },

      // Reopen an archived project → back to active.
      reopenProject: (id) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === id ? { ...p, archived: false, active: true } : p
          ),
        }));
        enqueue('project.update', { id, patch: { archived: false, active: true } });
      },

      addBlocker: (blocker) => {
        const b = { ...blocker, id: uid('blk') };
        set((state) => ({ blockers: [...state.blockers, b] }));
        enqueue('blocker.create', { blocker: b });
      },

      updateBlocker: (id, updates) => {
        set((state) => ({
          blockers: state.blockers.map((b) =>
            b.id === id ? { ...b, ...updates } : b
          ),
        }));
        enqueue('blocker.update', { id, patch: updates });
      },

      deleteBlocker: (id) => {
        set((state) => ({
          blockers: state.blockers.filter((b) => b.id !== id),
        }));
        enqueue('blocker.remove', { id });
      },

      reorderNav: (draggedId, targetId) =>
        set((state) => {
          if (draggedId === targetId) return {};
          const order = [...(state.settings.navOrder ?? DEFAULT_NAV_ORDER)];
          const from = order.indexOf(draggedId as ViewType);
          if (from === -1) return {};
          const [moved] = order.splice(from, 1);
          const insertAt = order.indexOf(targetId as ViewType);
          if (insertAt === -1) return {};
          order.splice(insertAt, 0, moved);
          return { settings: { ...state.settings, navOrder: order } };
        }),

      deleteProject: (id) => {
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
          // Delete all tasks belonging to this project (including subtasks).
          tasks: state.tasks.filter((t) => t.projectId !== id),
          sections: state.sections.filter((s) => s.scope !== id),
          ui:
            state.ui.selectedProjectId === id
              ? { ...state.ui, selectedProjectId: null }
              : state.ui,
        }));
        enqueue('project.remove', { id });
      },

      createProjectFromTemplate: (template) => {
        const project: Project = {
          id: uid('proj'),
          name: template.name,
          color: template.color,
          icon: template.icon,
        };
        const now = new Date();
        const startNumber = get().nextTaskNumber;
        const tasks: Task[] = template.tasks.map((t, i) => ({
          id: uid('task'),
          number: startNumber + i,
          title: t.title,
          description: '',
          projectId: project.id,
          parentId: null,
          dueDate: null,
          priority: t.priority ?? 'medium',
          categoryIds: [],
          completed: false,
          // Stagger createdAt so template order is preserved under createdAt sort.
          createdAt: new Date(now.getTime() + i),
          updatedAt: now,
          starred: false,
          recurrence: 'none',
          recurrenceEnd: null,
        }));
        set((state) => ({
          projects: [...state.projects, project],
          tasks: [...state.tasks, ...tasks],
          nextTaskNumber: state.nextTaskNumber + tasks.length,
          activityLog: pushLog(
            state.activityLog,
            plainEntry('project-created', project.name, state.settings.userName)
          ),
        }));
        return project;
      },

      addCategory: (name, color) => {
        const category: Category = {
          id: uid('cat'),
          name,
          color: color ?? PROJECT_COLORS[get().categories.length % PROJECT_COLORS.length],
        };
        set((state) => ({ categories: [...state.categories, category] }));
        enqueue('category.create', { category });
        return category;
      },

      updateCategory: (id, updates) => {
        set((state) => ({
          categories: state.categories.map((c) =>
            c.id === id ? { ...c, ...updates } : c
          ),
        }));
        enqueue('category.update', { id, patch: updates });
      },

      deleteCategory: (id) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
          tasks: state.tasks.map((t) =>
            t.categoryIds.includes(id)
              ? { ...t, categoryIds: t.categoryIds.filter((c) => c !== id) }
              : t
          ),
        }));
        enqueue('category.remove', { id });
      },

      selectTask: (id) =>
        set((state) => ({ ui: { ...state.ui, selectedTaskId: id } })),

      // Open a task and flag its title for immediate editing (e.g. after creating
      // it via double-click in the calendar).
      selectTaskForEdit: (id) =>
        set((state) => ({
          ui: { ...state.ui, selectedTaskId: id, editTitleTaskId: id },
        })),

      clearEditTitle: () =>
        set((state) => ({ ui: { ...state.ui, editTitleTaskId: null } })),

      selectProject: (id) =>
        set((state) => {
          // When selecting a project, also navigate to the correct view/panel.
          // A someday (inactive) project lives in the someday panel; active ones in projects.
          const proj = id ? state.projects.find((p) => p.id === id) : null;
          const isSomeday = proj && proj.active !== true && proj.kind !== 'area';
          const targetView = isSomeday ? 'someday' : 'projects';
          return {
            ui: {
              ...state.ui,
              selectedProjectId: id,
              selectedProjectIds: id ? [id] : [],
              currentView: id ? targetView : state.ui.currentView,
              sidePanel: id ? targetView : state.ui.sidePanel,
            },
          };
        }),

      // Ctrl/Cmd-click: add/remove a project from the combined multi-selection.
      toggleProjectSelected: (id) =>
        set((state) => {
          const cur = state.ui.selectedProjectIds.length
            ? state.ui.selectedProjectIds
            : state.ui.selectedProjectId
              ? [state.ui.selectedProjectId]
              : [];
          const next = cur.includes(id)
            ? cur.filter((p) => p !== id)
            : [...cur, id];
          return {
            ui: {
              ...state.ui,
              selectedProjectIds: next,
              selectedProjectId: next[0] ?? null,
            },
          };
        }),

      setView: (view) =>
        set((state) => ({
          ui: {
            ...state.ui,
            currentView: view,
            // Search query is scoped to the search view.
            searchQuery: view === 'search' ? state.ui.searchQuery : '',
            // Leaving a saved view clears the active marker.
            activeSavedViewId: view === 'custom' ? state.ui.activeSavedViewId : null,
          },
        })),

      setSidePanel: (panel) =>
        set((state) => ({ ui: { ...state.ui, sidePanel: panel } })),

      setCurrentDate: (date) =>
        set((state) => ({ ui: { ...state.ui, currentDate: date } })),

      setSelectedDates: (dates) =>
        set((state) => ({ ui: { ...state.ui, selectedDates: dates } })),

      setSearchQuery: (q) => set((state) => ({ ui: { ...state.ui, searchQuery: q } })),

      setFilter: (key, value) =>
        set((state) => ({
          ui: { ...state.ui, filters: { ...state.ui.filters, [key]: value } },
        })),

      resetFilters: () =>
        set((state) => ({
          ui: { ...state.ui, filters: { ...defaultUIState.filters } },
        })),

      setSort: (field, dir) =>
        set((state) => ({
          ui: {
            ...state.ui,
            sortField: field,
            sortDir:
              dir ??
              (state.ui.sortField === field && state.ui.sortDir === 'asc'
                ? 'desc'
                : 'asc'),
          },
        })),

      addSavedView: (name) => {
        const ui = get().ui;
        const view: SavedView = {
          id: uid('view'),
          name,
          filters: { ...ui.filters },
          sortField: ui.sortField,
          sortDir: ui.sortDir,
          searchQuery: ui.searchQuery,
        };
        set((state) => ({ savedViews: [...state.savedViews, view] }));
        enqueue('savedView.create', { view });
        return view;
      },

      deleteSavedView: (id) => {
        set((state) => ({
          savedViews: state.savedViews.filter((v) => v.id !== id),
          ui:
            state.ui.activeSavedViewId === id
              ? { ...state.ui, activeSavedViewId: null, currentView: 'inbox' }
              : state.ui,
        }));
        enqueue('savedView.remove', { id });
      },

      applySavedView: (id) =>
        set((state) => {
          const view = state.savedViews.find((v) => v.id === id);
          if (!view) return {};
          return {
            ui: {
              ...state.ui,
              currentView: 'custom',
              activeSavedViewId: id,
              filters: { ...view.filters },
              sortField: view.sortField,
              sortDir: view.sortDir,
              searchQuery: view.searchQuery,
              selectedProjectId: null,
            },
          };
        }),

      addMember: (name, role = 'editor') => {
        const member: Member = {
          id: uid('mbr'),
          name,
          role,
          color: PROJECT_COLORS[get().members.length % PROJECT_COLORS.length],
        };
        set((state) => ({ members: [...state.members, member] }));
        enqueue('member.create', { member });
        return member;
      },

      updateMember: (id, updates) => {
        set((state) => ({
          members: state.members.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        }));
        enqueue('member.update', { id, patch: updates });
      },

      deleteMember: (id) => {
        set((state) => ({
          members: state.members.filter((m) => m.id !== id),
          // Unassign tasks that pointed at this member.
          tasks: state.tasks.map((t) => {
            const ids = t.assigneeIds ?? (t.assigneeId ? [t.assigneeId] : []);
            return ids.includes(id)
              ? { ...t, assigneeIds: ids.filter((x) => x !== id) }
              : t;
          }),
        }));
        enqueue('member.remove', { id });
      },

      // Add/remove a responsible member on a task (multi-assignee).
      toggleTaskAssignee: (taskId, memberId) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const ids = t.assigneeIds ?? (t.assigneeId ? [t.assigneeId] : []);
            return {
              ...t,
              assigneeIds: ids.includes(memberId)
                ? ids.filter((x) => x !== memberId)
                : [...ids, memberId],
            };
          }),
        }));
        const t = get().tasks.find((x) => x.id === taskId);
        if (t) enqueue('task.update', { id: taskId, patch: { assigneeIds: t.assigneeIds ?? [] } });
      },

      setUserName: (name) => {
        set((state) => ({ settings: { ...state.settings, userName: name } }));
        enqueue('settings.patch', { patch: { userName: name } });
      },

      setTheme: (theme) => {
        set((state) => ({ settings: { ...state.settings, theme } }));
        enqueue('settings.patch', { patch: { theme } });
      },

      setAddToTop: (v) => {
        set((state) => ({ settings: { ...state.settings, addToTop: v } }));
        enqueue('settings.patch', { patch: { addToTop: v } });
      },

      setFiltersCollapsed: (v) => {
        set((state) => ({ settings: { ...state.settings, filtersCollapsed: v } }));
        enqueue('settings.patch', { patch: { filtersCollapsed: v } });
      },

      setSectionsCollapsed: (v) => {
        set((state) => ({ settings: { ...state.settings, sectionsCollapsed: v } }));
        enqueue('settings.patch', { patch: { sectionsCollapsed: v } });
      },

      setProjectSort: (sort) => {
        set((state) => ({ settings: { ...state.settings, projectSort: sort } }));
        enqueue('settings.patch', { patch: { projectSort: sort } });
      },

      setCalendarMode: (mode) => {
        set((state) => ({ settings: { ...state.settings, calendarMode: mode } }));
        enqueue('settings.patch', { patch: { calendarMode: mode } });
      },

      setCalendarHours: (startHour, endHour) => {
        set((state) => {
          const s = Math.max(0, Math.min(23, Math.round(startHour)));
          const e = Math.max(s + 1, Math.min(24, Math.round(endHour)));
          return {
            settings: { ...state.settings, calendarStartHour: s, calendarEndHour: e },
          };
        });
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      setCalendarMonthCount: (count) => {
        set((state) => ({
          settings: {
            ...state.settings,
            calendarMonthCount: Math.max(1, Math.min(2, Math.round(count))),
          },
        }));
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      setCalendarHourHeight: (px) => {
        set((state) => ({
          settings: {
            ...state.settings,
            calendarHourHeight: Math.max(24, Math.min(160, Math.round(px))),
          },
        }));
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      setProjectsPanelWidth: (px) => {
        set((state) => ({
          settings: {
            ...state.settings,
            projectsPanelWidth: Math.max(200, Math.min(560, Math.round(px))),
          },
        }));
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      addPaletteColor: (color) => {
        set((state) => {
          const palette = state.settings.colorPalette ?? DEFAULT_PALETTE;
          if (palette.includes(color.toLowerCase())) return {};
          return { settings: { ...state.settings, colorPalette: [...palette, color.toLowerCase()] } };
        });
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      removePaletteColor: (color) => {
        set((state) => {
          const palette = state.settings.colorPalette ?? DEFAULT_PALETTE;
          const labels = { ...(state.settings.colorLabels ?? {}) };
          delete labels[color.toLowerCase()];
          return {
            settings: {
              ...state.settings,
              colorPalette: palette.filter((c) => c !== color.toLowerCase()),
              colorLabels: labels,
            },
          };
        });
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      setColorLabel: (color, label) => {
        set((state) => ({
          settings: {
            ...state.settings,
            colorLabels: {
              ...(state.settings.colorLabels ?? {}),
              [color.toLowerCase()]: label,
            },
          },
        }));
        // Debounced so a burst of keystrokes produces one save, not one per key.
        debouncedSettingsSave(get().settings);
      },

      setDetailPanelWidth: (px) => {
        set((state) => ({
          settings: {
            ...state.settings,
            detailPanelWidth: Math.max(320, Math.min(720, Math.round(px))),
          },
        }));
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      connectNozbe: (token, clientId) => {
        set((state) => ({
          settings: {
            ...state.settings,
            nozbe: {
              token,
              clientId,
              syncCompleted: state.settings.nozbe?.syncCompleted ?? true,
            },
          },
        }));
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      disconnectNozbe: () => {
        set((state) => {
          const { nozbe: _omit, ...rest } = state.settings;
          void _omit;
          return { settings: rest };
        });
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },

      setNozbeSync: (enabled) => {
        set((state) =>
          state.settings.nozbe
            ? {
                settings: {
                  ...state.settings,
                  nozbe: { ...state.settings.nozbe, syncCompleted: enabled },
                },
              }
            : {}
        );
        const s = get().settings;
        enqueue('settings.patch', { patch: s });
      },
}));

// The server gave a new task another #N (the picked one was taken) → adopt it.
onTaskRenumbered((id, number) => {
  useStore.setState((state) => ({
    tasks: state.tasks.map((t) => (t.id === id ? { ...t, number } : t)),
    nextTaskNumber: Math.max(state.nextTaskNumber, number + 1),
  }));
});

// Keep the offline display cache in sync with optimistic in-memory changes so a
// relaunch (or offline launch) shows the latest local state. Debounced; display-only.
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
useStore.subscribe((state) => {
  if (!state.dataLoaded && state.tasks.length === 0) return; // nothing meaningful yet
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    saveSnapshot({
      tasks: state.tasks, projects: state.projects, sections: state.sections,
      blockers: state.blockers, categories: state.categories, savedViews: state.savedViews,
      activityLog: state.activityLog, members: state.members, settings: state.settings,
      nextTaskNumber: state.nextTaskNumber,
    });
  }, 800);
});
