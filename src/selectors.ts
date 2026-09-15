import type { Task, UIState, Priority, Project, Member, Section } from './types';
import { taskAssigneeIds } from './members';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

// Sections that belong to the current view's scope (a single project, or the
// per-view bucket for the GTD list views). Mirrors TaskList's grouping logic so
// FilterBar and TaskList agree on whether a Gruppen/Sektionen bar applies.
// Sections of one scope in DISPLAY order. Honour an explicit manual order only
// when it is CLEAN (every sortOrder distinct); otherwise fall back to a
// numeric-aware NAME order. This keeps number-prefixed sections (04 … 18, 99)
// sensible even when sortOrder is inconsistent (e.g. some 0, some set — the
// result of older global reorders/imports), while a user's drag order — which
// renumbers a scope to a clean 0..n — is preserved.
export function orderSections<T extends { sortOrder?: number; name: string }>(list: T[]): T[] {
  const orders = list.map((s) => s.sortOrder ?? 0);
  const allDistinct = list.length > 0 && new Set(orders).size === orders.length;
  return [...list].sort((a, b) =>
    allDistinct
      ? (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      : a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

export const selectScopeSections = (ui: UIState, sections: Section[]): Section[] => {
  const singleProject =
    (ui.currentView === 'projects' || ui.currentView === 'someday') &&
    !!ui.selectedProjectId &&
    (ui.selectedProjectIds?.length ?? 0) <= 1;
  const VIEW_GROUPABLE = ['priority', 'today', 'nextweek', 'someday'];
  const grouped = singleProject || (VIEW_GROUPABLE.includes(ui.currentView) && !singleProject);
  if (!grouped) return [];
  const scopeKey = singleProject ? ui.selectedProjectId! : `view:${ui.currentView}`;
  return orderSections(sections.filter((s) => s.scope === scopeKey));
};

// Views that render the FilterBar — only there do ui.filters apply (see App.tsx).
const FILTERABLE_VIEWS = new Set<UIState['currentView']>([
  'inbox',
  'priority',
  'projects',
  'today',
  'search',
  'categories',
  'custom',
  'completed',
]);

const startOfDay = (d: Date) => {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
};

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Stable day key (YYYY-MM-DD) for set membership / multi-day selection.
export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

// Manual "Heute" flag: only counts on the day it was set (expires overnight).
export const isTodayFlagActive = (task: Task, now = new Date()): boolean =>
  task.todayDate != null && task.todayDate === dateKey(now);

export const isOverdue = (task: Task) =>
  !!task.dueDate && !task.completed && task.dueDate < startOfDay(new Date());

// Gilt der Task heute als "Heute" — egal ob manuell markiert oder heute
// faellig? (#81) Die Heute-Ansicht zeigt beide Faelle; die Markierung soll das
// widerspiegeln. Bewusst getrennt von isTodayFlagActive, das weiterhin NUR das
// manuell gesetzte Flag meint (Umschalten, Ablauf ueber Nacht).
export const countsAsToday = (task: Task, now = new Date()): boolean =>
  isTodayFlagActive(task, now) || (!!task.dueDate && isSameDay(task.dueDate, now));

// Nur wegen der Faelligkeit "heute" — dann ist das Flag implizit und darf nicht
// umgeschaltet werden (der Task bliebe ohnehin in der Heute-Ansicht).
export const isImplicitToday = (task: Task, now = new Date()): boolean =>
  !isTodayFlagActive(task, now) && !!task.dueDate && isSameDay(task.dueDate, now);

// Searchable status keywords (German + English) per active GTD flag.
const statusKeywords = (task: Task): string[] => {
  const k: string[] = [];
  if (task.starred) k.push('nächste aktion', 'next action', 'naechste aktion');
  if (task.thisWeek) k.push('next week', 'nextweek', 'diese woche');
  if (isTodayFlagActive(task)) k.push('heute', 'today');
  if (task.someday) k.push('someday', 'irgendwann');
  if (task.waiting) k.push('warten', 'warten auf', 'waiting', 'waiting on someone else');
  if (task.completed) k.push('erledigt', 'completed', 'done');
  return k;
};

export const matchesSearch = (task: Task, query: string, members: Member[] = []) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Search by task number, with or without a leading "#".
  const numQ = q.replace(/^#/, '');
  if (/^\d+$/.test(numQ) && String(task.number) === numQ) return true;
  // Free-text haystack: title, description, assignee, waiting person, statuses.
  const assignee = taskAssigneeIds(task)
    .map((id) => members.find((m) => m.id === id)?.name ?? '')
    .join(' ');
  const haystack = [
    task.title,
    task.description,
    assignee,
    task.waitingFor ?? '',
    ...statusKeywords(task),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
};

// #93: which tasks the week/rolling grid keeps while a search is active. A
// root task survives when it matches OR one of its subtasks matches — subtasks
// are only ever rendered nested under their parent, so dropping a non-matching
// parent would hide the very subtask that was searched for.
//
// Shared by WeekView and the header totals (App.tsx) on purpose: the grid
// filtering while the totals pill kept counting everything would put a number
// next to an empty week.
export const gridSearchTasks = (
  tasks: Task[],
  query: string,
  members: Member[] = []
): Task[] => {
  if (query.trim() === '') return tasks;
  const hit = (t: Task) => matchesSearch(t, query, members);
  return tasks.filter((t) => hit(t) || tasks.some((c) => c.parentId === t.id && hit(c)));
};

const matchesFilters = (task: Task, ui: UIState) => {
  const f = ui.filters;
  if (f.projectId && task.projectId !== f.projectId) return false;
  if (f.categoryId && !task.categoryIds.includes(f.categoryId)) return false;
  if (f.priority && task.priority !== f.priority) return false;
  if (f.completed !== null && task.completed !== f.completed) return false;
  if (f.assigneeId && !taskAssigneeIds(task).includes(f.assigneeId)) return false;
  if (f.dueFrom || f.dueTo) {
    if (!task.dueDate) return false;
    const k = dateKey(task.dueDate);
    if (f.dueFrom && k < f.dueFrom) return false;
    if (f.dueTo && k > f.dueTo) return false;
  }
  return true;
};

// --- #53: two-phase completion (grey hold in place, then move/collapse) ---

export type CompletionHoldMap = Record<string, 'hold' | 'exit'>;

// While a just-completed task is in its hold/exit phase it stays "virtually
// open" for every filter/sort/grouping — it keeps its old list position and
// only the row styling shows the completion.
export const applyCompletionHold = (tasks: Task[], hold: CompletionHoldMap): Task[] => {
  let any = false;
  for (const t of tasks) {
    if (hold[t.id]) {
      any = true;
      break;
    }
  }
  if (!any) return tasks;
  return tasks.map((t) => (hold[t.id] ? { ...t, completed: false } : t));
};

// Newest completion first; tasks without a completion date sink to the end.
export const byCompletedAtDesc = (a: Task, b: Task): number =>
  (b.completedAt ? b.completedAt.getTime() : 0) - (a.completedAt ? a.completedAt.getTime() : 0);

// Views whose lists hide completed tasks entirely — checking a task there
// collapses the row out ('exit') instead of gliding it into the ✓ Erledigt
// block ('move').
export const viewShowsCompleted = (view: UIState['currentView']): boolean =>
  view !== 'priority';

export const sortTasks = (tasks: Task[], ui: UIState): Task[] => {
  const { sortField, sortDir } = ui;
  if (sortField === 'manual') return tasks;
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...tasks].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'number':
        cmp = a.number - b.number;
        break;
      case 'priority':
        cmp = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        break;
      case 'dueDate': {
        const av = a.dueDate ? a.dueDate.getTime() : Infinity;
        const bv = b.dueDate ? b.dueDate.getTime() : Infinity;
        cmp = av - bv;
        break;
      }
      case 'title':
        cmp = (a.title ?? '').localeCompare(b.title ?? '');
        break;
      case 'createdAt':
        cmp = a.createdAt.getTime() - b.createdAt.getTime();
        break;
    }
    return cmp * dir;
  });
};

// Is the task's project active? Tasks without a project (Inbox/Single-Tasks) count
// as active. Inactive projects = Someday.
const isActiveProjectTask = (task: Task, projects: Project[]): boolean => {
  if (!task.projectId) return true;
  const p = projects.find((x) => x.id === task.projectId);
  return !p || p.active === true;
};

// Next-week window: open tasks due within the *current* week (Mon–Sun of today).
// Only tasks scheduled for this week appear automatically; everything else is
// added manually (drag onto the menu or the thisWeek flag).
export const isInNextWeekWindow = (task: Task): boolean => {
  if (!task.dueDate || task.completed) return false;
  const start = startOfWeek(new Date());
  const end = addDays(start, 7);
  return task.dueDate >= start && task.dueDate < end;
};

// Tasks visible in the current main view, after view scoping + filters + search + sort.
export const selectVisibleTasks = (
  tasks: Task[],
  ui: UIState,
  projects: Project[] = [],
  members: Member[] = []
): Task[] => {
  // Subtasks are managed under their parent and hidden from flat lists —
  // except in search, where they must be findable.
  let result =
    ui.currentView === 'search' ? tasks : tasks.filter((t) => !t.parentId);

  switch (ui.currentView) {
    case 'inbox':
      // Inbox = tasks not assigned to any project.
      result = result.filter((t) => !t.projectId);
      break;
    case 'completed':
      result = result.filter((t) => t.completed);
      break;
    case 'someday': {
      // A selected Someday project shows its tasks; otherwise the Someday
      // overview (parked tasks + tasks in inactive projects).
      const ids = ui.selectedProjectIds?.length
        ? ui.selectedProjectIds
        : ui.selectedProjectId
          ? [ui.selectedProjectId]
          : [];
      if (ids.length) {
        const set = new Set(ids);
        result = result.filter((t) => t.projectId && set.has(t.projectId));
      } else {
        result = result.filter(
          (t) => t.someday || !isActiveProjectTask(t, projects)
        );
      }
      break;
    }
    case 'nextweek': {
      // Open tasks committed/due this week + completed tasks from this week.
      const weekStart = startOfWeek(new Date());
      const weekEnd = addDays(weekStart, 7);
      result = result.filter((t) => {
        if (!t.completed) return t.thisWeek || isInNextWeekWindow(t);
        // Completed this week: show so the week stays visible as a summary.
        return t.completedAt && t.completedAt >= weekStart && t.completedAt < weekEnd;
      });
      break;
    }
    case 'priority':
      // Next actions: open starred/overdue tasks from active projects/areas
      // (and Single-Tasks/Inbox); exclude Someday + inactive-project tasks.
      result = result
        .filter(
          (t) =>
            !t.completed &&
            !t.someday &&
            isActiveProjectTask(t, projects) &&
            (t.starred || isOverdue(t))
        )
        .sort((a, b) => {
          const ao = isOverdue(a) ? 0 : 1;
          const bo = isOverdue(b) ? 0 : 1;
          if (ao !== bo) return ao - bo;
          if (a.starred !== b.starred) return a.starred ? -1 : 1;
          const ad = a.dueDate ? a.dueDate.getTime() : Infinity;
          const bd = b.dueDate ? b.dueDate.getTime() : Infinity;
          return ad - bd;
        });
      break;
    case 'projects': {
      const ids = ui.selectedProjectIds?.length
        ? ui.selectedProjectIds
        : ui.selectedProjectId
          ? [ui.selectedProjectId]
          : [];
      if (ids.length) {
        const set = new Set(ids);
        result = result.filter((t) => t.projectId && set.has(t.projectId));
      } else {
        // No specific project selected: show only tasks of the projects visible
        // in the Projekte panel (active projects + areas) — not every project.
        const visible = new Set(
          projects.filter((p) => p.kind === 'area' || p.active === true).map((p) => p.id)
        );
        result = result.filter((t) => t.projectId && visible.has(t.projectId));
      }
      break;
    }
    case 'today': {
      const now = new Date();
      // Today = the day's agenda: due today OR manually pinned via the ☀️ Heute
      // flag (expires overnight). Overdue lives in Priorität.
      result = result.filter(
        (t) => (t.dueDate && isSameDay(t.dueDate, now)) || isTodayFlagActive(t, now)
      );
      break;
    }
    case 'search':
      // handled by search query below
      break;
    case 'calendar': {
      // Show tasks for all selected days (fallback to the anchor day).
      const keys = new Set(
        ui.selectedDates.length ? ui.selectedDates : [dateKey(ui.currentDate)]
      );
      result = result.filter((t) => t.dueDate && keys.has(dateKey(t.dueDate)));
      break;
    }
  }

  // #93: while searching, subtasks become findable in the plain views too.
  // They are added AFTER the view scoping above and keyed off their parent, so
  // they inherit the parent's bucket instead of being sorted by their own
  // fields. That ordering matters: many subtasks carry no projectId even
  // though their parent does, and almost none carry someday/thisWeek — scoping
  // them on their own would drop them into the Inbox and leave Someday and
  // Next Week without any hits at all.
  if (ui.currentView !== 'search' && ui.searchQuery.trim() !== '') {
    const scopedIds = new Set(result.map((t) => t.id));
    result = [...result, ...tasks.filter((t) => t.parentId && scopedIds.has(t.parentId))];
  }

  // The FilterBar (project/category/priority/status/date filters) is only shown
  // in these views, so its filters must only apply there — otherwise a leftover
  // project filter silently shrinks Next Week / Someday / Calendar etc.
  if (FILTERABLE_VIEWS.has(ui.currentView)) {
    result = result.filter((t) => matchesFilters(t, ui));
  }
  result = result.filter((t) => matchesSearch(t, ui.searchQuery, members));

  const sorted = sortTasks(result, ui);
  // Completed tasks always sink to the bottom, newest completion first (#53).
  return [
    ...sorted.filter((t) => !t.completed),
    ...sorted.filter((t) => t.completed).sort(byCompletedAtDesc),
  ];
};

// Header totals over the currently visible tasks (#47): planned = entered
// durations, actual = Pomodoro-booked focus time, rounded to whole minutes.
export interface TaskTotals {
  count: number;
  plannedMin: number;
  actualMin: number;
}

export const selectTaskTotals = (tasks: Task[]): TaskTotals => ({
  count: tasks.length,
  plannedMin: tasks.reduce((sum, t) => sum + (t.durationMin ?? 0), 0),
  actualMin: Math.round(tasks.reduce((sum, t) => sum + (t.focusSeconds ?? 0), 0) / 60),
});

// Top non-completed tasks for the Priority list (starred & high priority first).
export const selectPriorityTasks = (tasks: Task[], limit = 5): Task[] => {
  return [...tasks]
    .filter((t) => !t.completed && !t.parentId)
    .sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      if (a.priority !== b.priority)
        return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      const av = a.dueDate ? a.dueDate.getTime() : Infinity;
      const bv = b.dueDate ? b.dueDate.getTime() : Infinity;
      return av - bv;
    })
    .slice(0, limit);
};

export const tasksOnDate = (tasks: Task[], date: Date): Task[] =>
  tasks.filter((t) => t.dueDate && isSameDay(t.dueDate, date));

// --- Week / calendar grid helpers ---------------------------------------

export const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  r.setHours(0, 0, 0, 0);
  return r;
};

// Monday-based start of the week containing `d`.
export const startOfWeek = (d: Date): Date => {
  const r = startOfDay(d);
  const offset = (r.getDay() + 6) % 7; // 0 = Monday
  return addDays(r, -offset);
};

// Seven consecutive days starting at `start`.
export const weekDays7 = (start: Date): Date[] =>
  Array.from({ length: 7 }, (_, i) => addDays(start, i));

// Local date from a YYYY-MM-DD key (midnight local time).
export const parseDateKey = (k: string): Date => new Date(`${k}T00:00:00`);

// The day columns the calendar week grid shows (#47): rolling = 7 days from
// today, an explicit multi-day selection wins, otherwise the Monday week of
// the anchor date. Shared by WeekView and the header totals so both agree.
export const weekViewDays = (
  mode: 'week' | 'rolling',
  currentDate: Date,
  selectedDates: string[],
  now: Date = new Date()
): Date[] => {
  if (mode === 'rolling') return weekDays7(now);
  if (selectedDates.length > 1) return [...selectedDates].sort().slice(0, 14).map(parseDateKey);
  return weekDays7(startOfWeek(currentDate));
};

// ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday).
export const isoWeek = (d: Date): number => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = Monday
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 864e5));
};
