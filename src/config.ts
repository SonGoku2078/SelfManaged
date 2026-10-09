// Central place for the deployment base URL. Empty = use the current origin
// (local / static hosting). When moving to a real server, set BASE_URL to the
// server domain (e.g. "https://tasks.example.com") — this is the only swap point
// needed for share links to keep working.
export const BASE_URL = '';

// Hash fragment that references a task by its human-friendly number, e.g. "#/t/42".
export const taskHash = (taskNumber: number) => `#/t/${taskNumber}`;

// Parse a task number out of a hash like "#/t/42". Returns null if it doesn't match.
export const parseTaskHash = (hash: string): number | null => {
  const m = hash.match(/^#\/t\/(\d+)$/);
  return m ? Number(m[1]) : null;
};

// Deep link used by external integrations (e.g. the Brave/Protonmail extension)
// to create a task: "#/add?title=…&note=…&heute=1". Note is optional
// (URL-encoded); heute=1 plans it for today (☀️) instead of only the Inbox.
export interface AddTaskLink {
  title: string;
  note?: string;
  today?: boolean;
}
export const addTaskHash = (link: AddTaskLink) => {
  const q = new URLSearchParams({ title: link.title });
  if (link.note) q.set('note', link.note);
  if (link.today) q.set('heute', '1');
  return `#/add?${q.toString()}`;
};
export const parseAddTaskHash = (hash: string): AddTaskLink | null => {
  const prefix = '#/add?';
  if (!hash.startsWith(prefix)) return null;
  const q = new URLSearchParams(hash.slice(prefix.length));
  const title = q.get('title')?.trim();
  if (!title) return null;
  return { title, note: q.get('note') ?? undefined, today: q.get('heute') === '1' };
};

// Base for Nozbe Classic API calls. In dev this is the Vite proxy path (`/nozbe-api`,
// see vite.config.ts) which forwards to https://api.nozbe.com:3000 and dodges CORS.
// After a backend exists, point this at the server endpoint that proxies/holds credentials.
export const NOZBE_API_BASE = '/nozbe-api';
export const NOZBE_WEB_URL = 'https://app.nozbe.com';

// Full shareable URL for a task. Local: current page + hash. Server: BASE_URL + hash.
export const taskShareUrl = (taskNumber: number) => {
  const base =
    BASE_URL ||
    (typeof window !== 'undefined'
      ? window.location.origin + window.location.pathname
      : '');
  return `${base}${taskHash(taskNumber)}`;
};
