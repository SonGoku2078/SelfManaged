// Appwrite-Variante des API-Clients (#98): ruft dieselbe selfmanaged-api
// Function auf wie die Web-App, ueber die offizielle Functions-Execution-API
// — ein direkter fetch() auf die Function-HTTP-Domain funktioniert nicht,
// Appwrites Edge streicht dabei jeden x-appwrite-*-Header (siehe
// docs/pipeline/appwrite-prod-test-migration.md). Der MCP-Server laeuft
// lokal ohne Browser/Cookies, meldet sich deshalb selbst per E-Mail/Passwort
// an und haelt ein kurzlebiges JWT im Speicher, genau wie AuthGate.tsx es
// fuer den Browser tut.
import { Client, Functions, ExecutionMethod } from 'node-appwrite';
import type { ApiCategory, ApiProject, ApiTask } from './logic.js';
import { ApiError, type TaskApi } from './api.js';

export interface AppwriteApiConfig {
  endpoint: string;
  projectId: string;
  functionId: string;
  email: string;
  password: string;
  siteUrl: string; // fuer Deep-Links (#/t/<nr>) und envKind() — NICHT die Function-Domain
  timeoutMs?: number;
}

// JWTs laufen bei Appwrite nach 15 Minuten ab; mit Sicherheitsabstand cachen,
// damit nicht bei jedem Tool-Aufruf neu eingeloggt wird.
const JWT_TTL_MS = 12 * 60_000;

export class AppwriteTaskManagerApi implements TaskApi {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private jwtCache: { value: string; expiresAt: number } | null = null;

  constructor(private readonly cfg: AppwriteApiConfig) {
    this.baseUrl = cfg.siteUrl;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  private async login(): Promise<string> {
    const endpoint = this.cfg.endpoint.replace(/\/+$/, '');
    let sessionRes: Response;
    try {
      sessionRes = await fetch(`${endpoint}/account/sessions/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-appwrite-project': this.cfg.projectId },
        body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new ApiError(`Appwrite unter ${endpoint} nicht erreichbar (${why}).`);
    }
    if (!sessionRes.ok) {
      const text = await sessionRes.text().catch(() => sessionRes.statusText);
      throw new ApiError(`Appwrite-Login fehlgeschlagen (${sessionRes.status}): ${text}`);
    }
    const cookieHeader = sessionRes.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');

    const jwtRes = await fetch(`${endpoint}/account/jwts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-appwrite-project': this.cfg.projectId, cookie: cookieHeader },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!jwtRes.ok) {
      const text = await jwtRes.text().catch(() => jwtRes.statusText);
      throw new ApiError(`Appwrite-JWT-Erstellung fehlgeschlagen (${jwtRes.status}): ${text}`);
    }
    const body = (await jwtRes.json()) as { jwt?: string };
    if (!body.jwt) throw new ApiError('Appwrite lieferte kein JWT zurueck.');
    return body.jwt;
  }

  private async getJwt(): Promise<string> {
    if (this.jwtCache && this.jwtCache.expiresAt > Date.now()) return this.jwtCache.value;
    const jwt = await this.login();
    this.jwtCache = { value: jwt, expiresAt: Date.now() + JWT_TTL_MS };
    return jwt;
  }

  private async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const jwt = await this.getJwt();
    const client = new Client().setEndpoint(this.cfg.endpoint).setProject(this.cfg.projectId).setJWT(jwt);
    const functions = new Functions(client);
    let exec;
    try {
      exec = await functions.createExecution({
        functionId: this.cfg.functionId,
        body: body === undefined ? '' : JSON.stringify(body),
        async: false,
        xpath: path,
        method: method as ExecutionMethod,
      });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new ApiError(`Appwrite-Function ${this.cfg.functionId} nicht erreichbar (${why}).`);
    }
    if (exec.responseStatusCode >= 400) {
      throw new ApiError(`Appwrite antwortete ${exec.responseStatusCode} auf ${method} ${path}: ${exec.responseBody || exec.errors || ''}`);
    }
    if (exec.responseStatusCode === 204 || !exec.responseBody) return undefined as T;
    return JSON.parse(exec.responseBody) as T;
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
