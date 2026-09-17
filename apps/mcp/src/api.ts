// Dünner HTTP-Client auf die bestehende REST-API von SelfManaged (#88).
// Bewusst ohne DELETE — der Adapter darf nichts löschen (AC-17).
import type { ApiCategory, ApiProject, ApiTask } from './logic.js';

export class ApiError extends Error {}

// Gemeinsame Form fuer beide Backends (klassischer Express-Server und
// Appwrite-PROD via AppwriteTaskManagerApi in appwriteApi.ts) — tools.ts
// kennt nur dieses Interface, nicht welches Backend dahintersteckt.
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
