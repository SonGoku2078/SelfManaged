// MCP-Zwischenspeicher (Appwrite-Verbrauch, 2026-11): Second Brain ruft
// Werkzeuge im Minutentakt auf. Vorher kostete jeder Aufruf die ganze Task-
// und Projekt-Tabelle; jetzt nur, was sich seit dem letzten Abgleich geändert hat.
// Run: npx tsx scripts/mcp-sync.test.ts
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError, SyncUnsupportedError, type SyncResponse, type TaskApi } from '../apps/mcp/src/api';
import { cacheFileFor, FALLBACK_TTL_MS, MIN_SYNC_MS, SyncedTaskApi } from '../apps/mcp/src/syncedApi';
import { tasksState, type ApiTask, type ApiProject, type ApiCategory } from '../apps/mcp/src/logic';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { handleRequest } from '../apps/functions/api/src/main.js';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { resetTombstoneProbe } from '../apps/functions/api/src/sync.js';
import { FakeTablesDb, fakeContext } from './fakeTablesDb';

const TABLES = ['tasks', 'projects', 'sections', 'blockers', 'categories', 'saved_views', 'members', 'settings', 'activity_log', 'deletions'];

// TaskApi on top of the real API function + an in-memory Appwrite.
class FunctionBackedApi implements TaskApi {
  readonly baseUrl = 'https://selfmanaged-prod-6aaa45fb.appwrite.network';
  calls = 0;
  constructor(private readonly db: FakeTablesDb) {}
  private async req<T>(method: string, url: string, body?: unknown): Promise<T> {
    this.calls++;
    const { ctx, out } = fakeContext(method, url, body);
    await handleRequest(ctx, () => this.db);
    if ((out.status ?? 200) >= 400) throw new ApiError(`Server antwortete ${out.status}`, { status: out.status });
    return out.body as T;
  }
  health() { return this.req<{ ok: boolean }>('GET', '/health'); }
  getTasks() { return this.req<ApiTask[]>('GET', '/api/tasks'); }
  getProjects() { return this.req<ApiProject[]>('GET', '/api/projects'); }
  getCategories() { return this.req<ApiCategory[]>('GET', '/api/categories'); }
  sync(since: string | null) {
    return this.req<SyncResponse>('GET', `/api/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) throw new SyncUnsupportedError(e.message);
      throw e;
    });
  }
  createTask(t: Record<string, unknown>) { return this.req<ApiTask>('POST', '/api/tasks', t); }
  patchTask(id: string, p: Record<string, unknown>) { return this.req<ApiTask>('PATCH', `/api/tasks/${id}`, p); }
  deleteTask(id: string) { return this.req<void>('DELETE', `/api/tasks/${id}`); }
}

const row = (i: number, extra: Record<string, unknown> = {}) => ({
  legacyId: `t${i}`, number: i, title: `Task ${i}`, description: '', projectId: 'p1', parentId: null, sortOrder: i,
  completed: false, starred: false, commentsJson: '[]', attachmentsJson: '[]', linksJson: '[]', createdAt: '2026-11-01T00:00:00.000Z', ...extra,
});

function setup(n = 1500) {
  resetTombstoneProbe();
  const db = new FakeTablesDb(TABLES);
  db.tick(-10 * 60_000);
  db.seed('tasks', Array.from({ length: n }, (_, i) => row(i + 1)));
  db.seed('tasks', [row(9001, { parentId: 't1' }), row(9002, { parentId: 't1', completed: true })]);
  db.seed('projects', Array.from({ length: 120 }, (_, i) => ({ legacyId: `p${i + 1}`, name: `Projekt ${i + 1}`, sortOrder: i, kind: 'project', active: true })));
  db.tick(10 * 60_000);
  return db;
}

// ── Second Brain, 10 Minuten: jede Minute 20 Verweise einzeln + Tagesplan ──
{
  const db = setup();
  let clock = Date.now();
  const api = new SyncedTaskApi(new FunctionBackedApi(db), { now: () => clock });
  db.reads = 0;
  await Promise.all([api.getTasks(), api.getProjects()]); // erster Aufruf: alles
  const firstLoad = db.reads;
  assert.ok(firstLoad >= 1500 && firstLoad < 1700, `first load reads everything once (${firstLoad})`);

  db.reads = 0;
  for (let minute = 0; minute < 10; minute++) {
    clock += 60_000;
    if (minute === 4) { db.tick(1000); await db.updateRow({ databaseId: 'x', tableId: 'tasks', rowId: 't5', data: { completed: true } }); }
    for (let ref = 0; ref < 20; ref++) await Promise.all([api.getTasks(), api.getProjects()]);
  }
  assert.ok(db.reads < 50, `200 tool calls in 10 min cost ${db.reads} reads (before: ~${200 * firstLoad})`);
  assert.strictEqual((await api.getTasks()).find((t) => t.id === 't5')?.completed, true, 'change from another device arrives');
  assert.strictEqual(api.stats.syncs, 11, 'one sync per minute, not per call');
}

// ── Aufrufe kurz hintereinander teilen sich einen Abgleich ──
{
  const db = setup(10);
  let clock = Date.now();
  const inner = new FunctionBackedApi(db);
  const api = new SyncedTaskApi(inner, { now: () => clock });
  await Promise.all(Array.from({ length: 8 }, () => api.getTasks()));
  assert.strictEqual(inner.calls, 1, 'parallel calls coalesce into one execution');
  clock += MIN_SYNC_MS - 1;
  await api.getProjects();
  assert.strictEqual(inner.calls, 1, 'within MIN_SYNC_MS: from memory');
  clock += 2;
  await api.getProjects();
  assert.strictEqual(inner.calls, 2, 'afterwards: one delta');
}

// ── Eigene Schreibvorgänge und Löschungen ──
{
  const db = setup(10);
  let clock = Date.now();
  const api = new SyncedTaskApi(new FunctionBackedApi(db), { now: () => clock });
  await api.getTasks();
  await api.patchTask('t3', { title: 'Geändert' });
  assert.strictEqual((await api.getTasks()).find((t) => t.id === 't3')?.title, 'Geändert', 'own write visible at once');
  await api.deleteTask('t1');
  const left = await api.getTasks();
  assert.ok(!left.some((t) => t.id === 't1' || t.parentId === 't1'), 'task and its subtasks gone locally');

  // Löschung auf einem anderen Gerät → kommt als Tombstone
  db.tick(2000);
  const other = new FunctionBackedApi(db);
  await other.deleteTask('t4');
  clock += MIN_SYNC_MS + 1;
  assert.ok(!(await api.getTasks()).some((t) => t.id === 't4'), 'remote delete arrives via tombstone');
}

// ── Server ohne /api/sync (Express, alte Function): voll, aber höchstens jede Minute ──
{
  let clock = 0;
  let full = 0;
  const legacy: TaskApi = {
    baseUrl: 'http://localhost:3002',
    health: async () => ({ ok: true }),
    getTasks: async () => { full++; return [row(1) as unknown as ApiTask]; },
    getProjects: async () => [],
    getCategories: async () => [],
    sync: async () => { throw new SyncUnsupportedError('404'); },
    createTask: async (t) => t as unknown as ApiTask,
    patchTask: async () => row(1) as unknown as ApiTask,
    deleteTask: async () => {},
  };
  const api = new SyncedTaskApi(legacy, { now: () => clock });
  for (let i = 0; i < 30; i++) { await api.getTasks(); clock += 1000; }
  assert.strictEqual(full, 1, '30 calls in 30 s → one full load');
  clock += FALLBACK_TTL_MS;
  await api.getTasks();
  assert.strictEqual(full, 2);
}

// ── Stand über Prozessgrenzen: ein neuer Prozess lädt nicht wieder alles ──
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-cache-'));
  try {
    const file = path.join(dir, 'cache.json');
    const db = setup(800);
    let clock = Date.now();
    const first = new SyncedTaskApi(new FunctionBackedApi(db), { now: () => clock, cacheFile: file });
    await first.getTasks();
    db.reads = 0;
    clock += 60_000;
    const second = new SyncedTaskApi(new FunctionBackedApi(db), { now: () => clock, cacheFile: file });
    assert.strictEqual((await second.getTasks()).length, 802, 'restored from file');
    assert.ok(db.reads < 10, `restart costs a delta, not a full load (${db.reads} reads)`);
    assert.strictEqual(second.stats.fullLoads, 0);
    // Anderer Server (baseUrl) → Datei wird nicht übernommen
    const otherInner = new FunctionBackedApi(db);
    Object.defineProperty(otherInner, 'baseUrl', { value: 'http://localhost:3002' });
    const third = new SyncedTaskApi(otherInner, { now: () => clock, cacheFile: file });
    await third.getTasks();
    assert.strictEqual(third.stats.fullLoads, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── cacheFileFor ──
assert.strictEqual(cacheFileFor('appwrite', { TM_MCP_CACHE: 'off' }), null);
assert.strictEqual(cacheFileFor('appwrite', { TM_MCP_CACHE: '/tmp/x.json' }), '/tmp/x.json');
assert.ok(cacheFileFor('appwrite', {})!.endsWith(path.join('.selfmanaged', 'mcp-cache-appwrite.json')));

// ── tasksState: Zustand mehrerer Nummern ──
{
  const t = (id: string, number: number, extra: Partial<ApiTask> = {}) => ({ id, number, title: id, completed: false, parentId: null, createdAt: '2026-11-01', ...extra }) as ApiTask;
  const tasks = [t('a', 1), t('b', 2, { parentId: 'a' }), t('c', 3, { parentId: 'a', completed: true }), t('d', 4, { completed: true }), t('dup', 1, { createdAt: '2026-11-02' })];
  const s = tasksState(tasks, [1, 2, 4, 99, 1], (x) => ({ number: x.number, title: x.title, completed: x.completed }));
  assert.deepStrictEqual(Object.keys(s.tasks).sort(), ['1', '2', '4']);
  assert.strictEqual(s.tasks[1].title, 'a', 'duplicate number: the older task');
  assert.strictEqual(s.tasks[1].openSubtasks, 1);
  assert.strictEqual(s.tasks[2].parentNumber, 1);
  assert.strictEqual(s.tasks[2].openSubtasks, null, 'subtasks have no subtasks');
  assert.strictEqual(s.tasks[4].completed, true);
  assert.deepStrictEqual(s.fehlend, [99]);
}

console.log('mcp-sync tests passed');
