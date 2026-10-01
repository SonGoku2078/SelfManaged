// Durable write queue ("outbox") — the core data-safety mechanism.
//
// Every mutation is recorded here and persisted to localStorage BEFORE it is
// sent to the server. Ops are replayed FIFO until the server confirms them, so
// edits made while the backend is unreachable are never lost. The server makes
// creates idempotent (INSERT OR REPLACE), so replaying a partially-applied op
// is safe.
//
// IMPORTANT: this uses its own localStorage key (`tm-outbox`) and must never be
// confused with the legacy `nozbe-clone-state` snapshot, which is dead.

import {
  tasksApi,
  projectsApi,
  categoriesApi,
  membersApi,
  sectionsApi,
  blockersApi,
  savedViewsApi,
  activityLogApi,
  settingsApi,
} from './index';

export interface Op {
  id: string;
  ts: number;
  kind: string;
  // Serialisable payload — Date fields survive as ISO strings (the server
  // reparses them), which is exactly what JSON.stringify produces anyway.
  payload: Record<string, unknown>;
  attempts?: number;
}

const KEY = 'tm-outbox';
const DEAD_KEY = 'tm-outbox-dead';
const MAX_ATTEMPTS = 5;

let queue: Op[] = load();
let listeners: Array<(n: number) => void> = [];

// Recover dead-lettered ops that failed for a TRANSIENT reason (server 5xx /
// network) — those may now succeed. Ops that failed permanently (4xx, e.g. a
// 404 update for a task that no longer exists on the server) stay dead so they
// don't cycle back into the queue on every reload.
(function recoverDeadLetters() {
  try {
    const raw = localStorage.getItem(DEAD_KEY);
    if (!raw) return;
    const dead = JSON.parse(raw) as Array<Op & { reason?: string }>;
    if (!Array.isArray(dead) || !dead.length) return;
    const is4xx = (o: { reason?: string }) => /:\s4\d\d\b/.test(o.reason ?? '');
    const permanent = dead.filter(is4xx);
    const recoverable = dead.filter((o) => !is4xx(o));
    if (recoverable.length) {
      queue = [...recoverable.map((o) => ({ ...o, attempts: 0 })), ...queue];
    }
    if (permanent.length) localStorage.setItem(DEAD_KEY, JSON.stringify(permanent));
    else localStorage.removeItem(DEAD_KEY);
    persist();
  } catch {
    /* ignore */
  }
})();

function load(): Op[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Op[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    /* storage full / unavailable — queue still lives in memory */
  }
  for (const l of listeners) l(queue.length);
}

function deadLetter(op: Op, reason: string): void {
  console.error(`Outbox: dropping op ${op.kind} to dead-letter:`, reason, op);
  try {
    const raw = localStorage.getItem(DEAD_KEY);
    const dead = raw ? (JSON.parse(raw) as unknown[]) : [];
    dead.push({ ...op, reason });
    localStorage.setItem(DEAD_KEY, JSON.stringify(dead));
  } catch {
    /* ignore */
  }
}

function uid(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Returns the HTTP status if the error came from an HTTP error response, or
// null for a connectivity/timeout failure. apiFetch throws
// `Error('API <path>: <status> <text>')` for HTTP errors.
function httpStatus(e: unknown): number | null {
  if (e instanceof Error && e.message.startsWith('API ')) {
    const m = e.message.match(/:\s(\d{3})\b/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// kind → API call. Payloads are plain objects pulled back out of localStorage.
/* eslint-disable @typescript-eslint/no-explicit-any */
const handlers: Record<string, (p: any) => Promise<unknown>> = {
  'task.create':      (p) => tasksApi.create(p.task),
  'task.update':      (p) => tasksApi.update(p.id, p.patch),
  'task.remove':      (p) => tasksApi.remove(p.id),
  'task.reorder':     (p) => tasksApi.reorder(p.ids),
  'project.create':   (p) => projectsApi.create(p.project),
  'project.update':   (p) => projectsApi.update(p.id, p.patch),
  'project.remove':   (p) => projectsApi.remove(p.id),
  'project.reorder':  (p) => projectsApi.reorder(p.ids),
  'category.create':  (p) => categoriesApi.create(p.category),
  'category.update':  (p) => categoriesApi.update(p.id, p.patch),
  'category.remove':  (p) => categoriesApi.remove(p.id),
  'member.create':    (p) => membersApi.create(p.member),
  'member.update':    (p) => membersApi.update(p.id, p.patch),
  'member.remove':    (p) => membersApi.remove(p.id),
  'section.create':   (p) => sectionsApi.create(p.section),
  'section.update':   (p) => sectionsApi.update(p.id, p.patch),
  'section.remove':   (p) => sectionsApi.remove(p.id),
  'section.reorder':  (p) => sectionsApi.reorder(p.ids),
  'blocker.create':   (p) => blockersApi.create(p.blocker),
  'blocker.update':   (p) => blockersApi.update(p.id, p.patch),
  'blocker.remove':   (p) => blockersApi.remove(p.id),
  'savedView.create': (p) => savedViewsApi.create(p.view),
  'savedView.remove': (p) => savedViewsApi.remove(p.id),
  'activityLog.append': (p) => activityLogApi.append(p.entry),
  'settings.patch':   (p) => settingsApi.patch(p.patch),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export function pendingCount(): number {
  return queue.length;
}

// Bumped on every enqueue. loadAll() compares it before/after its fetch: if the
// user changed anything meanwhile, the fetched server state is already stale
// and must not replace the local one (that made new tasks vanish for minutes).
let seq = 0;
export function writeSeq(): number {
  return seq;
}

export function onChange(fn: (n: number) => void): () => void {
  listeners.push(fn);
  fn(queue.length);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

// The op currently on the wire — must not be coalesced away under flush().
// If a newer reorder supersedes it, it is only flagged and dropped once its
// request has settled.
let inFlight: Op | null = null;
let inFlightSuperseded = false;

export function enqueue(kind: string, payload: Record<string, unknown>): void {
  seq++;
  // A reorder carries the COMPLETE order, so a newer one supersedes every
  // queued older one of the same kind — dragging 10× sends one order, not 10.
  if (kind.endsWith('.reorder')) {
    queue = queue.filter((o) => o.kind !== kind || o === inFlight);
    if (inFlight?.kind === kind) inFlightSuperseded = true;
  }
  queue.push({ id: uid(), ts: Date.now(), kind, payload });
  persist();
  void flush();
}

// 4xx that are about the session/rate, not the op itself — never dead-letter
// those (a dead-lettered edit is a lost edit); just retry later.
const TRANSIENT_4XX = new Set([401, 408, 425, 429]);
// Other 4xx are deterministic (validation, not found): retrying won't help.
const MAX_ATTEMPTS_4XX = 2;

let flushPromise: Promise<void> | null = null;

// Replay the queue FIFO. Resolves when the queue is drained or stalls (offline /
// a transient error). Concurrent callers share the running flush — awaiting
// flush() really waits for it (it used to return at once, so loadAll() could
// pull server state before the pending create had reached the server).
export function flush(): Promise<void> {
  if (!flushPromise) {
    flushPromise = drain().finally(() => { flushPromise = null; });
  }
  return flushPromise;
}

function drop(op: Op): void {
  queue = queue.filter((o) => o !== op);
  persist();
}

async function drain(): Promise<void> {
  while (queue.length) {
    const op = queue[0];
    const handler = handlers[op.kind];
    if (!handler) {
      deadLetter(op, 'unknown kind');
      drop(op);
      continue;
    }
    inFlight = op;
    inFlightSuperseded = false;
    try {
      await handler(op.payload);
      drop(op);
    } catch (e) {
      const status = httpStatus(e);
      if (inFlightSuperseded) {
        // A newer reorder is queued behind it — no point retrying this one.
        drop(op);
        if (status === null || TRANSIENT_4XX.has(status) || status >= 500) break;
        continue;
      }
      if (status === null || TRANSIENT_4XX.has(status)) {
        // Offline / timeout / session or rate limit — nothing else will
        // succeed right now either. Keep the whole queue, retry next tick.
        break;
      }
      // Real HTTP error for THIS op. Park it in the dead-letter list after a
      // few tries so one poison op can never block the user's other edits.
      // 5xx dead-letters are recovered and retried on the next app start.
      op.attempts = (op.attempts ?? 0) + 1;
      const max = status < 500 ? MAX_ATTEMPTS_4XX : MAX_ATTEMPTS;
      if (op.attempts >= max) {
        deadLetter(op, String(e));
        drop(op);
        continue;
      }
      persist();
      // 4xx: retry right away (cheap, deterministic); 5xx: back off to next tick.
      if (status >= 500) break;
    } finally {
      inFlight = null;
      inFlightSuperseded = false;
    }
  }
}
