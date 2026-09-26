// Dünner HTTP-Client auf die bestehende REST-API von SelfManaged (#88).
// Seit #100: volles Task-CRUD (deleteTask) — Projekte/Kategorien bleiben
// weiterhin nur lesbar, kein neuer Schreib-Pfad dafür.
//
// Zwei Backends je Umgebungsvariable (Nachtrag 2026-09-26 zu #96/#98):
// Dev/Express (TM_API_URL) unveraendert seit #88, Prod/Appwrite
// (APPWRITE_MCP_EMAIL/-PASSWORD) neu ueber das geteilte Modul
// appwriteApi.ts. tools.ts kennt nur das TaskApi-Interface, nicht welches
// Backend dahintersteckt.
import type { ApiCategory, ApiProject, ApiTask } from './logic.js';
import { APPWRITE_PROD_SITE_URL, appwriteApiFetch } from './appwriteApi.js';

export class ApiError extends Error {}

export interface TaskApi {
  readonly baseUrl: string;
  health(): Promise<{ ok: boolean }>;
  getTasks(): Promise<ApiTask[]>;
  getProjects(): Promise<ApiProject[]>;
  getCategories(): Promise<ApiCategory[]>;
  createTask(task: Record<string, unknown>): Promise<ApiTask>;
  patchTask(id: string, patch: Record<string, unknown>): Promise<ApiTask>;
  deleteTask(id: string): Promise<void>;
}

export class TaskManagerApi implements TaskApi {
  constructor(readonly baseUrl: string, private readonly timeoutMs = 10_000) {}

  private async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new ApiError(`SelfManaged-Server unter ${this.baseUrl} nicht erreichbar (${why}). Läuft der Server?`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(`Server antwortete ${res.status} auf ${method} ${path}: ${text}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health() { return this.request<{ ok: boolean }>('GET', '/health'); }
  getTasks() { return this.request<ApiTask[]>('GET', '/api/tasks'); }
  getProjects() { return this.request<ApiProject[]>('GET', '/api/projects'); }
  getCategories() { return this.request<ApiCategory[]>('GET', '/api/categories'); }
  createTask(task: Record<string, unknown>) { return this.request<ApiTask>('POST', '/api/tasks', task); }
  patchTask(id: string, patch: Record<string, unknown>) {
    return this.request<ApiTask>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, patch);
  }
  deleteTask(id: string) { return this.request<void>('DELETE', `/api/tasks/${encodeURIComponent(id)}`); }
}

// Appwrite-PROD-Backend: gleiche REST-Pfade, aber ueber die Functions-
// Execution-API statt fetch() (siehe appwriteApi.ts). `baseUrl` ist die
// Appwrite-Site-Domain (fuer Deep-Links und envKind()-Erkennung „prod"),
// nicht die Function-Domain.
export class AppwriteTaskManagerApi implements TaskApi {
  readonly baseUrl = APPWRITE_PROD_SITE_URL;

  private async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    try {
      return await appwriteApiFetch<T>(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : String(e), { cause: e });
    }
  }

  health() { return this.request<{ ok: boolean }>('GET', '/health'); }
  getTasks() { return this.request<ApiTask[]>('GET', '/api/tasks'); }
  getProjects() { return this.request<ApiProject[]>('GET', '/api/projects'); }
  getCategories() { return this.request<ApiCategory[]>('GET', '/api/categories'); }
  createTask(task: Record<string, unknown>) { return this.request<ApiTask>('POST', '/api/tasks', task); }
  patchTask(id: string, patch: Record<string, unknown>) {
    return this.request<ApiTask>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, patch);
  }
  deleteTask(id: string) { return this.request<void>('DELETE', `/api/tasks/${encodeURIComponent(id)}`); }
}
