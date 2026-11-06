// GET /api/sync (Appwrite usage, 2026-11): a delta costs only the changed
// rows, deletions travel as tombstones, and the fallbacks (no cursor, expired
// cursor, deletions table not provisioned yet) return a full load.
// Run: npx tsx scripts/appwrite-sync.test.ts
import assert from 'node:assert';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { handleRequest } from '../apps/functions/api/src/main.js';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { resetTombstoneProbe, TOMBSTONE_RETENTION_MS } from '../apps/functions/api/src/sync.js';
import { FakeTablesDb, fakeContext } from './fakeTablesDb';

const TABLES = ['tasks', 'projects', 'sections', 'blockers', 'categories', 'saved_views', 'members', 'settings', 'activity_log', 'deletions'];
type Sync = { serverTime: string; full: boolean; tasks: Array<{ id: string; title: string }>; projects: Array<{ id: string }>; sections: unknown[]; settings: Record<string, unknown>; deleted: Record<string, string[]> };

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  legacyId: id, number: Number(id.replace(/\D/g, '')) || 1, title: `Task ${id}`, description: '', projectId: 'p1', parentId: null,
  sortOrder: 0, completed: false, commentsJson: '[]', attachmentsJson: '[]', linksJson: '[]', createdAt: '2026-11-01T00:00:00.000Z', ...extra,
});

async function call(db: FakeTablesDb, method: string, url: string, body?: unknown) {
  const { ctx, out, errors } = fakeContext(method, url, body);
  await handleRequest(ctx, () => db);
  assert.deepStrictEqual(errors, [], `${method} ${url}: no errors`);
  return out as { status: number; body: unknown };
}

function freshDb(taskCount = 50): FakeTablesDb {
  resetTombstoneProbe();
  const db = new FakeTablesDb(TABLES);
  db.tick(-5 * 60_000); // existing data is a few minutes old
  db.seed('tasks', Array.from({ length: taskCount }, (_, i) => task(`t${i + 1}`)));
  db.seed('tasks', [task('c1', { parentId: 't1' }), task('c2', { parentId: 't1' })]);
  db.seed('projects', [{ legacyId: 'p1', name: 'Eins', sortOrder: 0 }, { legacyId: 'p2', name: 'Zwei', sortOrder: 1 }]);
  db.seed('sections', [{ legacyId: 's1', scope: 'p1', name: 'A', sortOrder: 0 }]);
  db.seed('settings', [{ $id: 'theme', key: 'theme', valueJson: '"dark"' }]);
  db.tick(5 * 60_000);
  return db;
}

// ── Full load without cursor ──
{
  const db = freshDb(50);
  db.reads = 0;
  const r = (await call(db, 'GET', '/api/sync')).body as Sync;
  assert.strictEqual(r.full, true);
  assert.strictEqual(r.tasks.length, 52);
  assert.strictEqual(r.tasks[0].id !== undefined, true, 'tasks mapped to API shape (id)');
  assert.deepStrictEqual(r.settings, { theme: 'dark' });
  assert.ok(!('activity_log' in r), 'activity log is not part of the sync');
  assert.strictEqual(db.reads, 52 + 2 + 1 + 1, 'full = every row once (the deletions probe on an empty table costs nothing)');

  // ── Nothing changed: a delta reads (almost) nothing ──
  db.tick(60_000);
  db.reads = 0;
  const idle = (await call(db, 'GET', `/api/sync?since=${encodeURIComponent(r.serverTime)}`)).body as Sync;
  assert.strictEqual(idle.full, false);
  assert.strictEqual(idle.tasks.length, 0);
  assert.strictEqual(db.reads, 0, 'idle delta = 0 billed reads');

  // ── One edit → exactly that row ──
  db.tick(1000);
  await call(db, 'PATCH', '/api/tasks/t7', { title: 'Neu' });
  db.tick(1000);
  db.reads = 0;
  const one = (await call(db, 'GET', `/api/sync?since=${encodeURIComponent(idle.serverTime)}`)).body as Sync;
  assert.deepStrictEqual(one.tasks.map((t) => [t.id, t.title]), [['t7', 'Neu']]);
  assert.strictEqual(db.reads, 1, 'delta reads only the changed row');

  // ── Delete with children → tombstones for all of them ──
  db.tick(60_000);
  await call(db, 'DELETE', '/api/tasks/t1');
  db.tick(1000);
  const del = (await call(db, 'GET', `/api/sync?since=${encodeURIComponent(one.serverTime)}`)).body as Sync;
  assert.deepStrictEqual([...del.deleted.tasks].sort(), ['c1', 'c2', 't1']);
  assert.ok(!db.tables.get('tasks')!.has('t1') && !db.tables.get('tasks')!.has('c1'), 'rows really gone');

  // ── Project delete: tasks + sections + project tombstoned ──
  db.tick(60_000);
  await call(db, 'DELETE', '/api/projects/p1');
  db.tick(1000);
  const proj = (await call(db, 'GET', `/api/sync?since=${encodeURIComponent(del.serverTime)}`)).body as Sync;
  assert.deepStrictEqual(proj.deleted.projects, ['p1']);
  assert.deepStrictEqual(proj.deleted.sections, ['s1']);
  for (let i = 2; i <= 50; i++) assert.ok(proj.deleted.tasks.includes(`t${i}`), `tombstone for t${i}`); // repeats from the overlap window are harmless
  assert.strictEqual(db.tables.get('tasks')!.size, 0);

  // ── Cursor older than the tombstone retention → full load ──
  const old = new Date(Date.now() - TOMBSTONE_RETENTION_MS).toISOString();
  const expired = (await call(db, 'GET', `/api/sync?since=${encodeURIComponent(old)}`)).body as Sync;
  assert.strictEqual(expired.full, true);
  const garbage = (await call(db, 'GET', '/api/sync?since=quatsch')).body as Sync;
  assert.strictEqual(garbage.full, true, 'unparsable cursor → full');
}

// ── Large tables are paged, not truncated at 5000 ──
{
  const db = freshDb(2600);
  const r = (await call(db, 'GET', '/api/sync')).body as Sync;
  assert.strictEqual(r.tasks.length, 2602, 'all rows across pages');
}

// ── Deletions table not provisioned yet: deletes still work, sync is always full ──
{
  const db = freshDb(5);
  db.dropTable('deletions');
  resetTombstoneProbe();
  const first = (await call(db, 'GET', '/api/sync')).body as Sync;
  db.tick(60_000);
  assert.strictEqual((await call(db, 'DELETE', '/api/tasks/t3')).status, 204);
  const next = (await call(db, 'GET', `/api/sync?since=${encodeURIComponent(first.serverTime)}`)).body as Sync;
  assert.strictEqual(next.full, true, 'without tombstones a delta could miss deletions');
  assert.ok(!next.tasks.some((t) => t.id === 't3'));
}

// ── Activity log: newest first, capped at 500 even for old clients ──
{
  const db = freshDb(1);
  db.seed('activity_log', Array.from({ length: 800 }, (_, i) => ({ legacyId: `a${i}`, at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(), kind: 'created', actor: '', taskTitle: '' })));
  db.reads = 0;
  const all = (await call(db, 'GET', '/api/activity-log')).body as Array<{ id: string }>;
  assert.strictEqual(all.length, 500);
  assert.strictEqual(all[0].id, 'a799', 'newest first');
  assert.strictEqual(db.reads, 500);
  const few = (await call(db, 'GET', '/api/activity-log?limit=200')).body as unknown[];
  assert.strictEqual(few.length, 200);
}

// ── Settings PATCH answers with the patch, without listing the table ──
{
  const db = freshDb(1);
  db.reads = 0;
  const r = await call(db, 'PATCH', '/api/settings', { zoom: 2 });
  assert.deepStrictEqual(r.body, { zoom: 2 });
  assert.strictEqual(db.reads, 0);
}

console.log('appwrite-sync tests passed');
