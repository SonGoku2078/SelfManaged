// Incremental sync for the Appwrite API function (Appwrite usage, 2026-11).
//
// Appwrite bills every row a list call returns as one database read. The app,
// the MCP server and Second Brain used to fetch whole tables on every refresh
// (tasks alone ~1'700 rows), which used up the plan's monthly reads within a
// day. GET /api/sync?since=<serverTime> returns only rows changed since the
// caller's last sync, across all synced tables, in ONE function execution.
//
// Deletions: a deleted row cannot show up in an "$updatedAt > since" query,
// so every delete also writes a tombstone row into `deletions`. An ID diff
// would work without a new table, but Query.select does not make reads
// cheaper — comparing all IDs costs one read per row, i.e. a full load.
// Tombstones expire after TOMBSTONE_RETENTION_MS; a caller whose cursor is
// older than that (or a deployment without the table yet) gets a full load.
import { Query } from 'node-appwrite';

export const SYNC_TABLES = ['tasks', 'projects', 'sections', 'blockers', 'categories', 'saved_views', 'members', 'settings'];
export const TOMBSTONE_TABLE = 'deletions';
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Rows written while the previous sync was running can carry an $updatedAt
// just before its serverTime. Re-reading this window costs a few rows and
// makes such races harmless (rows are applied by id, so repeats are no-ops).
export const OVERLAP_MS = 30_000;
const PAGE_SIZE = 1000;

// All rows matching `queries`, page by page (cursor paging — a single
// Query.limit(5000) silently truncated larger tables).
export async function listPaged(db, databaseId, tableId, queries = [], pageSize = PAGE_SIZE) {
  const out = [];
  let cursor = null;
  for (;;) {
    const page = [...queries, Query.limit(pageSize)];
    if (cursor) page.push(Query.cursorAfter(cursor));
    const { rows } = await db.listRows({ databaseId, tableId, queries: page, total: false });
    out.push(...rows);
    if (rows.length < pageSize) return out;
    cursor = rows[rows.length - 1].$id;
  }
}

// Whether the `deletions` table exists (provisioned by scripts/appwrite).
// Checked once per warm container; the probe returns at most one row.
let tombstoneTable = null;
export async function hasTombstoneTable(db, databaseId) {
  if (tombstoneTable !== null) return tombstoneTable;
  try {
    await db.listRows({ databaseId, tableId: TOMBSTONE_TABLE, queries: [Query.limit(1)], total: false });
    tombstoneTable = true;
  } catch (e) {
    if (Number(e?.code) !== 404) throw e;
    tombstoneTable = false;
  }
  return tombstoneTable;
}
export function resetTombstoneProbe(value = null) { tombstoneTable = value; }

export const tombstoneData = (tableId, legacyId) => ({ tableId, legacyId: String(legacyId) });

function parseSince(value, now) {
  if (!value) return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) return null;
  // Older than the tombstone retention: deletions may have been pruned.
  if (now.getTime() - t > TOMBSTONE_RETENTION_MS - 24 * 60 * 60 * 1000) return null;
  return new Date(t - OVERLAP_MS);
}

/**
 * Changed rows since `since` (ISO string from a previous response's
 * serverTime) or everything when a delta is not possible.
 * fromRow(table, row) maps a stored row to the API shape.
 * Returns { serverTime, full, tasks: [...], projects: [...], …,
 *           settings: { key: value }, deleted: { tasks: [ids], … } }.
 */
export async function syncChanges({ db, databaseId, since, fromRow, now = new Date(), tables = SYNC_TABLES }) {
  // Taken BEFORE reading: a row written during the reads is either in this
  // response or newer than serverTime (and comes with the next sync).
  const serverTime = now.toISOString();
  const tombstones = await hasTombstoneTable(db, databaseId);
  const from = tombstones ? parseSince(since, now) : null;
  const full = from === null;
  const changed = full ? [] : [Query.greaterThan('$updatedAt', from.toISOString())];

  const result = { serverTime, full, deleted: {} };
  await Promise.all(tables.map(async (table) => {
    const rows = await listPaged(db, databaseId, table, changed);
    if (table === 'settings') {
      result.settings = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.valueJson)]));
    } else {
      result[table] = rows.map((row) => fromRow(table, row));
    }
  }));

  if (!full) {
    const gone = await listPaged(db, databaseId, TOMBSTONE_TABLE, [Query.greaterThan('$createdAt', from.toISOString())]);
    for (const t of gone) {
      if (!tables.includes(t.tableId)) continue;
      (result.deleted[t.tableId] ??= []).push(t.legacyId);
    }
  }
  return result;
}

// Prune expired tombstones, one small batch per call (run after deletes, so
// the table stays small without a scheduled job). No reads when none expired.
export async function pruneTombstones(db, databaseId, now = new Date(), batch = 45) {
  const cutoff = new Date(now.getTime() - TOMBSTONE_RETENTION_MS).toISOString();
  const { rows } = await db.listRows({ databaseId, tableId: TOMBSTONE_TABLE, queries: [Query.lessThan('$createdAt', cutoff), Query.limit(batch)], total: false });
  for (const row of rows) await db.deleteRow({ databaseId, tableId: TOMBSTONE_TABLE, rowId: row.$id });
  return rows.length;
}
