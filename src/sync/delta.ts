// Incremental sync for the app (Appwrite usage, 2026-11).
//
// loadAll() used to fetch all nine tables every minute per open window —
// on Appwrite every returned row is a billed read (~7'000 per load). Now one
// GET /api/sync?since=<cursor> returns only what changed since the last sync
// (plus tombstones for deletions), see apps/functions/api/src/sync.js.
// Servers without the endpoint (Express dev server, an older function) get
// the old full load, assembled from the per-table GETs.
import { TABLE_KEYS, type SettingsData, type SyncResult } from './merge';
import { apiFetch } from '../api/client';
import { blockersApi, categoriesApi, membersApi, projectsApi, savedViewsApi, sectionsApi, settingsApi, tasksApi } from '../api';

interface RawSync {
  serverTime: string;
  full: boolean;
  settings?: SettingsData;
  deleted?: Record<string, string[]>;
  [table: string]: unknown;
}

const isMissingEndpoint = (e: unknown) => e instanceof Error && /^API \/api\/sync[^:]*: 404\b/.test(e.message);

/** Full load the old way (9 → 8 calls; the activity log is no longer part of it). */
export async function fetchFullLegacy(): Promise<SyncResult> {
  const [tasks, projects, sections, blockers, categories, savedViews, members, settings] = await Promise.all([
    tasksApi.getAll(), projectsApi.getAll(), sectionsApi.getAll(), blockersApi.getAll(),
    categoriesApi.getAll(), savedViewsApi.getAll(), membersApi.getAll(), settingsApi.getAll(),
  ]);
  return { serverTime: null, full: true, tasks, projects, sections, blockers, categories, savedViews, members, settings, deleted: {} };
}

/** Changes since `cursor` (null → everything). */
export async function fetchSync(cursor: string | null): Promise<SyncResult> {
  let raw: RawSync;
  try {
    raw = await apiFetch<RawSync>(`/api/sync${cursor ? `?since=${encodeURIComponent(cursor)}` : ''}`);
  } catch (e) {
    if (isMissingEndpoint(e)) return fetchFullLegacy();
    throw e;
  }
  const out: SyncResult = { serverTime: raw.serverTime, full: !!raw.full, settings: raw.settings ?? {}, deleted: {} };
  for (const [table, key] of Object.entries(TABLE_KEYS)) {
    if (Array.isArray(raw[table])) (out as unknown as Record<string, unknown>)[key] = raw[table];
    if (raw.deleted?.[table]?.length) out.deleted[key] = raw.deleted[table];
  }
  return out;
}

export { applySync, mergeActivity, type SyncData, type SyncResult } from './merge';
