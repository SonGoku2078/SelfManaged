// Pure merge of sync results into the store's tables (no I/O, testable
// without a browser). See delta.ts for fetching.
import type { ActivityEntry, Category, Member, Project, ProjectBlocker, SavedView, Section, Settings, Task } from '../types';

/** Tables the sync carries (activity log: loaded on demand, see loadActivityLog). */
export interface SyncData {
  tasks: Task[];
  projects: Project[];
  sections: Section[];
  blockers: ProjectBlocker[];
  categories: Category[];
  savedViews: SavedView[];
  members: Member[];
}

export type SettingsData = Partial<Settings> & { nextTaskNumber?: number };

export interface SyncResult extends Partial<SyncData> {
  /** Cursor for the next call; null = the server cannot do deltas. */
  serverTime: string | null;
  /** true: complete tables (replace), false: only changes (merge). */
  full: boolean;
  settings: SettingsData;
  deleted: Partial<Record<keyof SyncData, string[]>>;
}

// Server table names → store keys.
export const TABLE_KEYS: Record<string, keyof SyncData> = {
  tasks: 'tasks', projects: 'projects', sections: 'sections', blockers: 'blockers',
  categories: 'categories', saved_views: 'savedViews', members: 'members',
};

function mergeById<T extends { id: string }>(current: T[], changed: T[] = [], deleted: string[] = []): T[] {
  if (!changed.length && !deleted.length) return current;
  const gone = new Set(deleted);
  const byId = new Map(changed.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const x of current) {
    if (gone.has(x.id)) continue;
    const next = byId.get(x.id);
    out.push(next ?? x);
    byId.delete(x.id);
  }
  for (const x of byId.values()) if (!gone.has(x.id)) out.push(x);
  return out;
}

/**
 * New table contents after applying a sync result to the current state.
 * Full results replace, deltas merge by id (changed rows win, tombstones
 * remove). Pure — the caller decides whether it may apply it at all (outbox).
 */
export function applySync(current: SyncData & { settings: Settings }, r: SyncResult, defaults: Settings): SyncData & { settings: Settings; nextTaskNumber?: number } {
  const { nextTaskNumber, ...rawSettings } = r.settings;
  const keys = Object.values(TABLE_KEYS);
  const tables = Object.fromEntries(keys.map((k) => [
    k,
    r.full ? (r[k] ?? []) : mergeById(current[k] as Array<{ id: string }>, r[k] as Array<{ id: string }> | undefined, r.deleted[k]),
  ])) as unknown as SyncData;
  const settings = r.full ? { ...defaults, ...rawSettings } : { ...current.settings, ...rawSettings };
  // Defensive: numeric settings must be numbers (a stale string value would
  // break numeric math, e.g. WeekView hour labels / zoom).
  for (const k of ['calendarStartHour', 'calendarEndHour', 'calendarMonthCount', 'calendarHourHeight', 'projectsPanelWidth', 'detailPanelWidth'] as const) {
    const v = (settings as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim() !== '') (settings as Record<string, unknown>)[k] = Number(v);
  }
  return { ...tables, settings, ...(nextTaskNumber !== undefined ? { nextTaskNumber } : {}) };
}

/** Server activity log merged with local entries (newest first, capped). */
export function mergeActivity(local: ActivityEntry[], server: ActivityEntry[], cap: number): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  for (const e of [...server, ...local]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, cap);
}
