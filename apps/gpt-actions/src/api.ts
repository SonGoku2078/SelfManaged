// Dünner HTTP-Client auf die bestehende REST-API von SelfManaged (#98).
// Eigene Kopie analog apps/mcp/src/api.ts (bewusst, siehe Architektur-Trade-off
// "Eigener Prozess statt Erweiterung von apps/mcp" — process-lokal, kein
// npm-Workspace-Umbau). Bewusst ohne DELETE — der Adapter darf nichts löschen (AC-9).
//
// Zwei Backends je Umgebungsvariable (Nachtrag 2026-09-26 zu #96/#98):
// Dev/Express (TM_API_URL) unveraendert, Prod/Appwrite (APPWRITE_MCP_EMAIL/
// -PASSWORD) ueber das mit apps/mcp geteilte Modul appwriteApi.ts (analog zur
// bestehenden Wiederverwendung von logic.ts) — keine zweite Appwrite-Auth-
// Implementierung.
import type { ApiCategory, ApiProject, ApiTask } from '../../mcp/src/logic.js';
import { APPWRITE_PROD_SITE_URL, appwriteApiFetch } from '../../mcp/src/appwriteApi.js';

export class ApiError extends Error {}

export interface TaskApi {
  readonly baseUrl: string;
  health(): Promise<{ ok: boolean }>;
  getTasks(): Promise<ApiTask[]>;
  getProjects(): Promise<ApiProject[]>;
  getCategories(): Promise<ApiCategory[]>;
  createTask(task: Record<string, unknown>): Promise<ApiTask>;
  patchTask(id: string, patch: Record<string, unknown>): Promise<ApiTask>;
}

export class TaskManagerApi implements TaskApi {
  constructor(readonly baseUrl: string, private readonly timeoutMs = 10_000) {}

  private async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
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
}

// Appwrite-PROD-Backend, eigene Kopie analog TaskManagerApi oben (bewusst,
// siehe Trade-off "Eigener Prozess") — nutzt aber den geteilten
// appwriteApiFetch aus apps/mcp/src/appwriteApi.ts, keine zweite
// Login-/Execution-Implementierung.
export class AppwriteTaskManagerApi implements TaskApi {
  readonly baseUrl = APPWRITE_PROD_SITE_URL;

  private async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
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
}
