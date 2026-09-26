// Proves #98: der HTTP-Layer des gpt-actions-Adapters — Auth-Middleware
// (Annahme/Ablehnung), Rate-Limit-Schwelle, Routing auf logic.ts-Funktionen.
// Die reine Logik selbst ist bereits in scripts/mcp.test.ts geprüft (aus
// apps/mcp/src/logic.ts wiederverwendet); hier nur der neue Transport
// (HTTP + Auth statt stdio). Kein Netz zum echten Server nötig (Fake-Backend).
// Run: npx tsx scripts/gpt-actions.test.ts
import assert from 'node:assert';
import type { Server } from 'node:http';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createAuthFailureLimiter, requireApiKey } from '../apps/gpt-actions/src/auth';
import { buildRouter, errorHandler } from '../apps/gpt-actions/src/routes';
import type { TaskApi } from '../apps/gpt-actions/src/api';
import type { ApiCategory, ApiProject, ApiTask } from '../apps/mcp/src/logic';

// ── Fake-Backend (kein Netz, kein echter TM_API_URL nötig) ──────────────────
class FakeApi implements TaskApi {
  readonly baseUrl = 'http://fake.local';
  tasks: ApiTask[] = [];
  projects: ApiProject[] = [{ id: 'p1', name: 'Projekt Eins', kind: 'project', active: true }];
  categories: ApiCategory[] = [{ id: 'c1', name: 'Büro' }];
  async health() { return { ok: true }; }
  async getTasks() { return this.tasks; }
  async getProjects() { return this.projects; }
  async getCategories() { return this.categories; }
  async createTask(task: Record<string, unknown>) {
    const t = task as unknown as ApiTask;
    this.tasks.push(t);
    return t;
  }
  async patchTask(id: string, patch: Record<string, unknown>) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Fake-Backend: Task „${id}" nicht gefunden.`);
    Object.assign(t, patch);
    return t;
  }
}

function buildApp(apiKey: string, api: TaskApi, limiter: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use('/v1', limiter, requireApiKey(apiKey), buildRouter(api));
  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Unbekannte Route.' }));
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorHandler(err, req, res, next));
  return app;
}

function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const closeServer = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

async function call(base: string, method: string, path: string, opts: { key?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.key !== null) headers.Authorization = `Bearer ${opts.key ?? 'unset'}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => undefined);
  return { status: res.status, data };
}

async function main() {
  // ── Auth-Middleware: annehmen/ablehnen (AC-2) ─────────────────────────────
  const api = new FakeApi();
  const { server, base } = await listen(buildApp('geheim-123', api, createAuthFailureLimiter(1000, 60_000)));
  try {
    const noKey = await call(base, 'GET', '/v1/health', { key: null });
    assert.equal(noKey.status, 401, 'fehlender Key -> 401');
    assert.match(noKey.data.error, /API-Key/);

    const wrongKey = await call(base, 'GET', '/v1/health', { key: 'falsch' });
    assert.equal(wrongKey.status, 401, 'falscher Key -> 401');

    const rightKey = await call(base, 'GET', '/v1/health', { key: 'geheim-123' });
    assert.equal(rightKey.status, 200, 'richtiger Key -> 200');

    // ── Kein DELETE auf irgendeiner Route registriert (AC-9) ─────────────────
    const del = await call(base, 'DELETE', '/v1/tasks/1', { key: 'geheim-123' });
    assert.equal(del.status, 404, 'DELETE ist auf keiner Route registriert (fällt auf 404-Fallback)');

    // ── Routing -> logic.ts-Verdrahtung (Wiederverwendung aus apps/mcp) ──────
    const created = await call(base, 'POST', '/v1/tasks', {
      key: 'geheim-123',
      body: { title: 'Testtask', projektId: 'p1', planenFuer: '2026-09-25' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.task.projectId, 'p1');
    assert.equal(created.data.task.starred, true, 'planenFuer ⇒ ★ (Planen-Invariante aus logic.ts)');
    assert.equal(created.data.task.number, 1, 'nextTaskNumber() bei leerer DB = 1');
    const taskId = api.tasks[0].id;

    const unknownProject = await call(base, 'GET', '/v1/projects/Gibtsnicht/tasks', { key: 'geheim-123' });
    assert.equal(unknownProject.status, 404, 'unbekanntes Projekt -> 404 (resolveProject aus logic.ts)');
    assert.match(unknownProject.data.error, /nicht gefunden/);

    const badBody = await call(base, 'POST', '/v1/tasks', { key: 'geheim-123', body: {} });
    assert.equal(badBody.status, 400, 'fehlender title -> 400 (Zod-Validierung)');
    assert.match(badBody.data.error, /Ungültige Eingabe/);

    const plan = await call(base, 'PATCH', `/v1/tasks/${taskId}/plan`, { key: 'geheim-123', body: { datum: null } });
    assert.equal(plan.status, 200);
    assert.equal(plan.data.task.todayDate, null);
    assert.equal(plan.data.task.starred, true, 'unplanPatch() entfernt nur todayDate, ★ bleibt (logic.ts)');

    const unknownTask = await call(base, 'PATCH', '/v1/tasks/%23999/star', { key: 'geheim-123', body: { stern: true } });
    assert.equal(unknownTask.status, 404, 'unbekannte Tasknummer #999 -> 404 (findTask aus logic.ts)');
    assert.match(unknownTask.data.error, /nicht gefunden/);

    console.log('Auth + Routing-Verdrahtung: alle Prüfungen bestanden ✔');
  } finally {
    await closeServer(server);
  }

  // ── Rate-Limit-Schwelle (AC-11) ───────────────────────────────────────────
  const limitedApi = new FakeApi();
  const { server: server2, base: base2 } = await listen(buildApp('geheim-123', limitedApi, createAuthFailureLimiter(3, 60_000)));
  try {
    const results: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      // Reihenfolge ist hier wichtig (Zähler pro Anfrage) — bewusst sequenziell, kein Promise.all.
      const r = await call(base2, 'GET', '/v1/health', { key: 'falsch' });
      results.push(r.status);
    }
    assert.deepEqual(results.slice(0, 3), [401, 401, 401], 'erste 3 Fehlversuche -> 401 (Limit noch nicht erreicht)');
    assert.ok(results.slice(3).every((s) => s === 429), `Versuch 4+ -> 429 (Limit erreicht): ${JSON.stringify(results)}`);

    console.log('Rate-Limit-Schwelle: alle Prüfungen bestanden ✔');
  } finally {
    await closeServer(server2);
  }
}

main()
  .then(() => console.log('gpt-actions.test.ts: alle Prüfungen bestanden ✔'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
