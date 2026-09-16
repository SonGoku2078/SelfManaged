// Single point for the backend URL.
// Resolved per request so the native/mobile app can point at a LAN IP at runtime
// (in-app "Server-URL" setting, stored in localStorage) without a rebuild.
// Precedence: localStorage 'tm-api-url' > build-time VITE_API_URL > default.
// Fallback '' = same origin that served the app (#60): correct for the prod
// build on any host; dev/vite sets VITE_API_URL, mobile stores tm-api-url.
import { ExecutionMethod } from 'appwrite';
import { APPWRITE_API_FUNCTION_ID, functions, IS_APPWRITE_PROD } from '../appwrite/client';

const DEFAULT_BASE_URL = IS_APPWRITE_PROD
  ? ((import.meta.env.VITE_APPWRITE_API_URL as string | undefined) ?? '')
  : ((import.meta.env.VITE_API_URL as string | undefined) ?? '');

export function getBaseUrl(): string {
  if (IS_APPWRITE_PROD) return DEFAULT_BASE_URL.replace(/\/+$/, '');
  try {
    const override = localStorage.getItem('tm-api-url');
    if (override !== null && override.trim() !== '') return override.trim().replace(/\/+$/, '');
  } catch { /* ignore */ }
  return DEFAULT_BASE_URL;
}

// Normalize a user-typed backend URL: trim, strip trailing slashes, force an
// absolute http(s) URL — otherwise requests resolve relative to the app's own
// origin (e.g. Capacitor's localhost), which silently "works". Shared by
// setBaseUrl and the pure "Verbindung testen" check (which must not persist).
export function normalizeBaseUrl(url: string): string {
  let v = url.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
}

export function setBaseUrl(url: string): void {
  try {
    const v = normalizeBaseUrl(url);
    if (v) localStorage.setItem('tm-api-url', v);
    else localStorage.removeItem('tm-api-url');
  } catch { /* ignore */ }
}

// Back-compat export (initial value; prefer getBaseUrl() for live lookups).
export const BASE_URL = DEFAULT_BASE_URL;

// Date fields that must be revived from ISO strings to Date objects.
const DATE_KEYS = new Set([
  'dueDate', 'createdAt', 'updatedAt', 'recurrenceEnd', 'completedAt', 'at',
  'startDate', 'endDate',
]);

function reviveDates(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(reviveDates);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : reviveDates(v),
      ]),
    );
  }
  return obj;
}

// PROD backend calls MUST go through Appwrite's Functions Execution API, not
// a plain fetch() to the function's own HTTP domain. Appwrite's edge strips
// every x-appwrite-* header (including a client-supplied JWT) from requests
// made directly to a function's domain — only the Execution API resolves the
// calling SDK client's session/JWT into trusted identity headers the
// function can read. Confirmed against the live project on 2026-09-16.
//
// Do NOT pass a `headers` object containing an x-appwrite-* key here —
// createExecution() rejects the whole call with a 500 ("Invalid headers:
// ... cannot start with x-appwrite") if you do. Appwrite already resolves
// the caller's identity from the `functions` client's own session (cookie,
// or its localStorage fallback) and injects x-appwrite-user-id/-jwt into the
// function on its own; there is nothing for us to pass explicitly.
async function appwriteApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase() as ExecutionMethod;
  const body = typeof init?.body === 'string' ? init.body : '';
  const execution = await functions.createExecution({
    functionId: APPWRITE_API_FUNCTION_ID,
    body,
    async: false,
    xpath: path,
    method,
  });
  if (execution.responseStatusCode >= 400) {
    throw new Error(`API ${path}: ${execution.responseStatusCode} ${execution.responseBody || execution.errors || ''}`);
  }
  if (execution.responseStatusCode === 204 || !execution.responseBody) return undefined as T;
  return reviveDates(JSON.parse(execution.responseBody)) as T;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (IS_APPWRITE_PROD) return appwriteApiFetch<T>(path, init);
  // Always time out — a request that hangs (e.g. fired mid server-restart) must
  // not block the write queue forever. AbortError surfaces as a network error,
  // so the outbox keeps the op and retries it on the next tick.
  const res = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(10000),
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json().then(reviveDates) as T;
}
