// Offline display cache. A snapshot of the loaded data is kept in localStorage so
// the app (especially the native/mobile build) shows last-known tasks when the
// backend is unreachable, and survives a relaunch.
//
// SAFETY: this is DISPLAY-ONLY. The server is the source of truth; all writes go
// through the outbox (never bulk-pushed from here); a successful fetch always
// overwrites this cache. So a stale cache can never overwrite the server.
import type {
  Task, Project, Section, ProjectBlocker, Category, SavedView, ActivityEntry, Member, Settings,
} from '../types';

const KEY = 'tm-cache';

export interface Snapshot {
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
  /** serverTime of the sync this data reflects (GET /api/sync); absent = full load next. */
  syncCursor?: string | null;
  /** When the last full load happened (ms). */
  fullSyncAt?: number;
}

const DATE_KEYS = new Set([
  'dueDate', 'createdAt', 'updatedAt', 'recurrenceEnd', 'completedAt', 'at',
  'startDate', 'endDate',
]);

function reviveDates(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(reviveDates);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : reviveDates(v),
      ]),
    );
  }
  return obj;
}

export function saveSnapshot(s: Snapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

export function loadSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return reviveDates(JSON.parse(raw)) as Snapshot;
  } catch {
    return null;
  }
}
