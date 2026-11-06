// Zwischenspeicher vor dem TaskApi (Appwrite-Verbrauch, 2026-11).
//
// Jedes Werkzeug holte bisher die komplette Task- und Projekt-Tabelle — bei
// ~1'700 Tasks ~1'850 abgerechnete Appwrite-Lesezugriffe pro Aufruf. Second
// Brain ruft task_holen pro Verweis jede Minute auf: ~32 Mio. Lesezugriffe pro
// Tag, das Projekt wurde gesperrt.
//
// Jetzt: einmal alles laden, danach nur noch Änderungen über GET /api/sync
// (eine Function-Ausführung, Lesezugriffe = geänderte Zeilen). Aufrufe kurz
// hintereinander teilen sich einen Abgleich (MIN_SYNC_MS). Eigene
// Schreibvorgänge landen direkt im Speicher. Der Stand wird in eine Datei
// geschrieben, damit ein neu gestarteter Prozess (Second Brain beendet den
// MCP nach 10 min Leerlauf) nicht wieder alles lädt.
//
// Ohne /api/sync (Express-Dev-Server, ältere Function): volles Laden wie
// bisher, aber höchstens alle FALLBACK_TTL_MS.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskApi, SyncResponse } from './api.js';
import { SyncUnsupportedError } from './api.js';
import type { ApiCategory, ApiProject, ApiTask } from './logic.js';

// Zwischenspeicher-Datei (Appwrite-Verbrauch, 2026-11): TM_MCP_CACHE=<pfad>
// oder TM_MCP_CACHE=off. Standard ~/.selfmanaged/mcp-cache-<modus>.json.
export function cacheFileFor(kind: 'express' | 'appwrite', env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.TM_MCP_CACHE ?? '').trim();
  if (v.toLowerCase() === 'off') return null;
  return v || path.join(os.homedir(), '.selfmanaged', `mcp-cache-${kind}.json`);
}

export const MIN_SYNC_MS = 10_000;
export const FALLBACK_TTL_MS = 60_000;
// Server-Tombstones leben 30 Tage; ein älterer Stand wird verworfen.
const CACHE_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000;

interface CacheFile {
  version: 1;
  baseUrl: string;
  cursor: string;
  savedAt: number;
  tasks: ApiTask[];
  projects: ApiProject[];
  categories: ApiCategory[];
}

export interface SyncedOptions {
  /** Datei für den Stand zwischen Prozessen; null = nur im Speicher. */
  cacheFile?: string | null;
  now?: () => number;
  minSyncMs?: number;
}

type Byid<T> = Map<string, T>;
const byId = <T extends { id: string }>(list: T[]): Byid<T> => new Map(list.map((x) => [x.id, x]));

// Gleiche Reihenfolge wie GET /api/tasks (sortOrder, dann createdAt).
const taskOrder = (a: ApiTask, b: ApiTask) =>
  (Number((a as { sortOrder?: number }).sortOrder ?? 0) - Number((b as { sortOrder?: number }).sortOrder ?? 0)) ||
  String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
const projectOrder = (a: ApiProject, b: ApiProject) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

export class SyncedTaskApi implements TaskApi {
  readonly baseUrl: string;
  private tasks: Byid<ApiTask> = new Map();
  private projects: Byid<ApiProject> = new Map();
  private categories: Byid<ApiCategory> = new Map();
  private cursor: string | null = null;
  private loaded = false;
  private syncedAt = -Infinity;
  private inflight: Promise<void> | null = null;
  private deltaSupported = true;
  private readonly now: () => number;
  private readonly minSyncMs: number;
  private readonly cacheFile: string | null;
  /** Für Tests/Diagnose: wie oft der Server gefragt wurde. */
  stats = { syncs: 0, fullLoads: 0 };

  constructor(private readonly inner: TaskApi, opts: SyncedOptions = {}) {
    this.baseUrl = inner.baseUrl;
    this.now = opts.now ?? Date.now;
    this.minSyncMs = opts.minSyncMs ?? MIN_SYNC_MS;
    this.cacheFile = opts.cacheFile ?? null;
    this.restore();
  }

  health() { return this.inner.health(); }

  async getTasks(): Promise<ApiTask[]> { await this.fresh(); return [...this.tasks.values()].sort(taskOrder); }
  async getProjects(): Promise<ApiProject[]> { await this.fresh(); return [...this.projects.values()].sort(projectOrder); }
  async getCategories(): Promise<ApiCategory[]> { await this.fresh(); return [...this.categories.values()]; }

  async createTask(task: Record<string, unknown>): Promise<ApiTask> {
    const t = await this.inner.createTask(task);
    if (t?.id) this.tasks.set(t.id, t);
    return t;
  }

  async patchTask(id: string, patch: Record<string, unknown>): Promise<ApiTask> {
    const t = await this.inner.patchTask(id, patch);
    if (t?.id) this.tasks.set(t.id, t);
    return t;
  }

  async deleteTask(id: string): Promise<void> {
    await this.inner.deleteTask(id);
    // Der Server löscht die Subtasks mit.
    for (const t of [...this.tasks.values()]) if (t.id === id || t.parentId === id) this.tasks.delete(t.id);
  }

  /** Frisch genug? Sonst einen (gemeinsamen) Abgleich abwarten. */
  private fresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    const ttl = this.deltaSupported ? this.minSyncMs : FALLBACK_TTL_MS;
    if (this.loaded && this.now() - this.syncedAt < ttl) return Promise.resolve();
    this.inflight = this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(): Promise<void> {
    if (this.deltaSupported && this.inner.sync) {
      try {
        const r = await this.inner.sync(this.loaded ? this.cursor : null);
        this.apply(r);
        return;
      } catch (e) {
        if (!(e instanceof SyncUnsupportedError)) throw e;
        this.deltaSupported = false;
      }
    }
    // Fallback: alles wie bisher, aber höchstens alle FALLBACK_TTL_MS.
    const [tasks, projects, categories] = await Promise.all([this.inner.getTasks(), this.inner.getProjects(), this.inner.getCategories()]);
    this.tasks = byId(tasks);
    this.projects = byId(projects);
    this.categories = byId(categories);
    this.cursor = null;
    this.loaded = true;
    this.syncedAt = this.now();
    this.stats.fullLoads++;
  }

  private apply(r: SyncResponse): void {
    this.stats.syncs++;
    if (r.full) {
      this.stats.fullLoads++;
      this.tasks = byId(r.tasks ?? []);
      this.projects = byId(r.projects ?? []);
      this.categories = byId(r.categories ?? []);
    } else {
      for (const t of r.tasks ?? []) this.tasks.set(t.id, t);
      for (const p of r.projects ?? []) this.projects.set(p.id, p);
      for (const c of r.categories ?? []) this.categories.set(c.id, c);
      for (const id of r.deleted?.tasks ?? []) this.tasks.delete(id);
      for (const id of r.deleted?.projects ?? []) this.projects.delete(id);
      for (const id of r.deleted?.categories ?? []) this.categories.delete(id);
    }
    this.cursor = r.serverTime;
    this.loaded = true;
    this.syncedAt = this.now();
    this.persist();
  }

  private restore(): void {
    if (!this.cacheFile) return;
    try {
      const c = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as CacheFile;
      if (c.version !== 1 || c.baseUrl !== this.baseUrl || !c.cursor) return;
      if (this.now() - c.savedAt > CACHE_MAX_AGE_MS) return;
      this.tasks = byId(c.tasks);
      this.projects = byId(c.projects);
      this.categories = byId(c.categories);
      this.cursor = c.cursor;
      this.loaded = true; // syncedAt bleibt -Infinity: der erste Aufruf holt die Änderungen
    } catch { /* keine oder kaputte Datei: einmal voll laden */ }
  }

  private persist(): void {
    if (!this.cacheFile || !this.cursor) return;
    const data: CacheFile = {
      version: 1, baseUrl: this.baseUrl, cursor: this.cursor, savedAt: this.now(),
      tasks: [...this.tasks.values()], projects: [...this.projects.values()], categories: [...this.categories.values()],
    };
    try {
      mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.cacheFile);
    } catch (e) {
      console.error(`MCP-Zwischenspeicher nicht geschrieben (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}
