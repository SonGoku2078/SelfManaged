// Reine Logik des MCP-Servers (#88) — keine I/O, damit sie in
// scripts/mcp.test.ts ohne laufenden Server getestet werden kann.

export type Priority = 'low' | 'medium' | 'high';

// Teilmenge der Task-Felder, die der Adapter liest (Server liefert mehr).
export interface ApiTask {
  id: string;
  number: number;
  title: string;
  description: string;
  projectId: string | null;
  dueDate: string | null; // ISO-String (Server-JSON)
  priority: Priority;
  categoryIds: string[];
  completed: boolean;
  completedAt?: string | null;
  starred: boolean;
  someday?: boolean;
  thisWeek?: boolean;
  waiting?: boolean;
  waitingFor?: string | null;
  todayDate?: string | null;
  recurrence?: string;
  sortOrder?: number;
  createdAt: string;
  [extra: string]: unknown;
}

export interface ApiProject {
  id: string;
  name: string;
  kind: 'project' | 'area';
  active: boolean;
  archived?: boolean;
  sortOrder?: number;
}

export interface ApiCategory {
  id: string;
  name: string;
}

export class LogicError extends Error {}

// ── Datum ───────────────────────────────────────────────────────────────────

// Lokaler Datums-Key YYYY-MM-DD (identisch zu src/selectors.ts dateKey).
export const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isDateKey = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Lokale Mitternacht des Datums als ISO-String (so speichert die App dueDate).
export function dateKeyToIso(key: string): string {
  if (!isDateKey(key)) throw new LogicError(`Ungültiges Datum „${key}" — erwartet YYYY-MM-DD.`);
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime()) || dt.getDate() !== d) throw new LogicError(`Ungültiges Datum „${key}".`);
  return dt.toISOString();
}

export const dueKey = (t: ApiTask): string | null => (t.dueDate ? dateKey(new Date(t.dueDate)) : null);

// ── Projekte ────────────────────────────────────────────────────────────────

export const visibleProjects = (projects: ApiProject[]): ApiProject[] =>
  projects.filter((p) => !p.archived);

// Auflösung per id oder Name: exakt (case-insensitiv) → „enthält".
// Mehrdeutig/unbekannt → LogicError mit Klartext (die KI fragt dann nach).
export function resolveProject(
  projects: ApiProject[],
  ref: { id?: string; name?: string },
): ApiProject {
  const list = visibleProjects(projects);
  if (ref.id) {
    const p = list.find((x) => x.id === ref.id);
    if (!p) throw new LogicError(`Projekt mit id „${ref.id}" nicht gefunden.`);
    return p;
  }
  const q = (ref.name ?? '').trim().toLowerCase();
  if (!q) throw new LogicError('Bitte projektId oder projektName angeben.');
  const exact = list.filter((p) => p.name.trim().toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = exact.length > 1 ? exact : list.filter((p) => p.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) throw new LogicError(`Projekt „${ref.name}" nicht gefunden.`);
  throw new LogicError(
    `Projekt „${ref.name}" ist mehrdeutig: ${partial.map((p) => `${p.name} (${p.id})`).join(', ')}. Bitte genauer angeben.`,
  );
}

export function resolveCategories(cats: ApiCategory[], names: string[]): string[] {
  return names.map((n) => {
    const q = n.trim().toLowerCase();
    const hit = cats.find((c) => c.name.trim().toLowerCase() === q);
    if (!hit) throw new LogicError(`Kategorie „${n}" nicht gefunden. Vorhanden: ${cats.map((c) => c.name).join(', ') || '–'}.`);
    return hit.id;
  });
}

// ── Tasks: Auswahl ──────────────────────────────────────────────────────────

const byAppOrder = (a: ApiTask, b: ApiTask) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.createdAt.localeCompare(b.createdAt);

export const openTasks = (tasks: ApiTask[]): ApiTask[] => tasks.filter((t) => !t.completed);

export function tasksOfProject(tasks: ApiTask[], projectId: string, includeDone = false): ApiTask[] {
  return tasks
    .filter((t) => t.projectId === projectId && (includeDone || !t.completed))
    .sort(byAppOrder);
}

// „Nächste Schritte" = ★-Tasks des Projekts (offen, nicht Someday) — Entscheidung 8.
export function nextSteps(tasks: ApiTask[], projectId: string): ApiTask[] {
  return tasksOfProject(tasks, projectId).filter((t) => t.starred && !t.someday);
}

export function inboxTasks(tasks: ApiTask[]): ApiTask[] {
  return openTasks(tasks).filter((t) => !t.projectId && !t.someday).sort(byAppOrder);
}

export function searchTasks(tasks: ApiTask[], query: string, includeDone = false, limit = 50): ApiTask[] {
  const q = query.trim().toLowerCase();
  if (!q) throw new LogicError('Bitte einen Suchbegriff angeben.');
  return tasks
    .filter((t) => (includeDone || !t.completed) && (t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)))
    .sort(byAppOrder)
    .slice(0, limit);
}

export interface DayPlan {
  datum: string;
  geplant: ApiTask[];
  faellig: ApiTask[];
  ueberfaellig: ApiTask[];
}

// Tagesplan: geplant (todayDate = Datum) > fällig (dueDate = Datum) > überfällig
// (dueDate < Datum, nur wenn Datum <= heute). Jeder Task genau einmal.
export function groupDayPlan(tasks: ApiTask[], datum: string, todayKey: string): DayPlan {
  if (!isDateKey(datum)) throw new LogicError(`Ungültiges Datum „${datum}" — erwartet YYYY-MM-DD.`);
  const open = openTasks(tasks).sort(byAppOrder);
  const geplant = open.filter((t) => t.todayDate === datum);
  const seen = new Set(geplant.map((t) => t.id));
  const faellig = open.filter((t) => !seen.has(t.id) && dueKey(t) === datum);
  faellig.forEach((t) => seen.add(t.id));
  const ueberfaellig =
    datum <= todayKey
      ? open.filter((t) => {
          const k = dueKey(t);
          return !seen.has(t.id) && k !== null && k < datum;
        })
      : [];
  return { datum, geplant, faellig, ueberfaellig };
}

export function findTask(tasks: ApiTask[], ref: { id?: string; number?: number }): ApiTask {
  if (ref.id) {
    const t = tasks.find((x) => x.id === ref.id);
    if (!t) throw new LogicError(`Task mit id „${ref.id}" nicht gefunden.`);
    return t;
  }
  if (ref.number !== undefined && ref.number !== null) {
    const t = tasks.find((x) => x.number === ref.number);
    if (!t) throw new LogicError(`Task #${ref.number} nicht gefunden.`);
    return t;
  }
  throw new LogicError('Bitte taskId oder taskNummer angeben.');
}

// ── Tasks: Anlegen & Ändern ─────────────────────────────────────────────────

// Der Server vergibt keine Nummer — Konvention des Stores: fortlaufend.
export const nextTaskNumber = (tasks: ApiTask[]): number =>
  tasks.reduce((m, t) => Math.max(m, Number(t.number) || 0), 0) + 1;

// Gleiches Format wie uid('task') im Store.
export const newTaskId = (now = Date.now(), rnd = Math.random()): string =>
  `task-${now.toString(36)}-${Math.floor(rnd * 1e6).toString(36)}`;

export interface NewTaskInput {
  title: string;
  projectId?: string | null;
  description?: string;
  dueKey?: string | null;
  priority?: Priority;
  categoryIds?: string[];
  planKey?: string | null;
}

export function buildNewTask(input: NewTaskInput, ctx: { number: number; id?: string; now?: Date }): Record<string, unknown> {
  const title = input.title.trim();
  if (!title) throw new LogicError('Der Titel darf nicht leer sein.');
  const now = (ctx.now ?? new Date()).toISOString();
  const planKey = input.planKey ?? null;
  if (planKey && !isDateKey(planKey)) throw new LogicError(`Ungültiges Datum „${planKey}" für planenFuer — erwartet YYYY-MM-DD.`);
  return {
    id: ctx.id ?? newTaskId(),
    number: ctx.number,
    title,
    description: input.description ?? '',
    projectId: input.projectId ?? null,
    parentId: null,
    sectionId: null,
    dueDate: input.dueKey ? dateKeyToIso(input.dueKey) : null,
    priority: input.priority ?? 'medium',
    categoryIds: input.categoryIds ?? [],
    completed: false,
    // Invariante der App: Tagesplan ⇒ Nächste Aktion.
    starred: !!planKey,
    someday: false,
    thisWeek: false,
    todayDate: planKey,
    assigneeIds: ['u-me'],
    recurrence: 'none',
    recurrenceEnd: null,
    linkedProjectId: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// PATCH-Bodies (Server merged partiell).
export function planPatch(datum: string): Record<string, unknown> {
  if (!isDateKey(datum)) throw new LogicError(`Ungültiges Datum „${datum}" — erwartet YYYY-MM-DD.`);
  return { todayDate: datum, starred: true, someday: false };
}
export const unplanPatch = (): Record<string, unknown> => ({ todayDate: null });
export const duePatch = (datum: string | null): Record<string, unknown> => ({ dueDate: datum ? dateKeyToIso(datum) : null });
export const starPatch = (starred: boolean): Record<string, unknown> => ({ starred });
export function completePatch(done: boolean, now = new Date()): Record<string, unknown> {
  return done ? { completed: true, completedAt: now.toISOString() } : { completed: false, completedAt: null };
}

// ── Umgebung & Darstellung ──────────────────────────────────────────────────

export function envKind(url: string): 'dev' | 'prod' | 'unbekannt' {
  try {
    const u = new URL(url);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.port === '3002') return 'dev';
    // Prod = der LAN-Server auf :3001; die IP kommt per DHCP und kann wechseln.
    if (u.port === '3001' && !local) return 'prod';
    return 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

const PRIO_DE: Record<Priority, string> = { low: 'niedrig', medium: 'mittel', high: 'hoch' };

const fmtDate = (key: string): string => {
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}`;
};

// Kompakte, vorlesbare Zeile: „★ #142 Angebot schreiben (Projekt X, fällig 16.09.2026, hoch)".
export function formatTaskLine(t: ApiTask, projectName?: string | null, todayKey?: string): string {
  const flags: string[] = [];
  if (projectName) flags.push(projectName);
  const dk = dueKey(t);
  if (dk) flags.push(`fällig ${fmtDate(dk)}${todayKey && dk < todayKey ? ' (überfällig)' : ''}`);
  if (t.todayDate) flags.push(`geplant für ${fmtDate(t.todayDate)}`);
  if (t.thisWeek) flags.push('diese Woche');
  if (t.priority && t.priority !== 'medium') flags.push(PRIO_DE[t.priority]);
  if (t.someday) flags.push('Someday');
  if (t.waiting) flags.push(`wartet${t.waitingFor ? ` auf ${t.waitingFor}` : ''}`);
  if (t.completed) flags.push('erledigt');
  const star = t.starred ? '★ ' : '';
  return `${star}#${t.number} ${t.title}${flags.length ? ` (${flags.join(', ')})` : ''}`;
}

// Schlanke Struktur für structuredContent.
export function taskSummary(t: ApiTask, projectName?: string | null) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    projectId: t.projectId,
    projectName: projectName ?? null,
    starred: !!t.starred,
    todayDate: t.todayDate ?? null,
    thisWeek: !!t.thisWeek,
    dueDate: dueKey(t),
    priority: t.priority,
    completed: !!t.completed,
    someday: !!t.someday,
    waiting: !!t.waiting,
  };
}
