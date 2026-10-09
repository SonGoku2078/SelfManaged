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

// Deep link used by external integrations (e.g. the Proton Mail extension) to
// create tasks: "#/add?title=…&note=…" for one, "#/add?tasks=[{title,note}]"
// for several (one per ticked mail). Optional: project=<id> (default: Inbox,
// i.e. no project — GTD), heute=1 plans them for today (☀️).
export interface AddTaskLink {
  tasks: { title: string; note?: string }[];
  projectId: string | null;
  today: boolean;
}
export const addTaskHash = (link: AddTaskLink) => {
  const q = new URLSearchParams();
  if (link.tasks.length === 1) {
    q.set('title', link.tasks[0].title);
    if (link.tasks[0].note) q.set('note', link.tasks[0].note);
  } else {
    q.set('tasks', JSON.stringify(link.tasks));
  }
  if (link.projectId) q.set('project', link.projectId);
  if (link.today) q.set('heute', '1');
  return `#/add?${q.toString()}`;
};
const MAX_LINK_TASKS = 200;
export const parseAddTaskHash = (hash: string): AddTaskLink | null => {
  const prefix = '#/add?';
  if (!hash.startsWith(prefix)) return null;
  const q = new URLSearchParams(hash.slice(prefix.length));
  let tasks: AddTaskLink['tasks'] = [];
  const many = q.get('tasks');
  if (many) {
    try {
      const raw: unknown = JSON.parse(many);
      if (Array.isArray(raw)) {
        tasks = raw
          .filter((t): t is { title: unknown; note?: unknown } => !!t && typeof t === 'object')
          .map((t) => ({
            title: typeof t.title === 'string' ? t.title.trim() : '',
            note: typeof t.note === 'string' && t.note ? t.note : undefined,
          }))
          .filter((t) => t.title)
          .slice(0, MAX_LINK_TASKS);
      }
    } catch {
      /* malformed list → nothing */
    }
  } else {
    const title = q.get('title')?.trim();
    if (title) tasks = [{ title, note: q.get('note') ?? undefined }];
  }
  if (!tasks.length) return null;
  return { tasks, projectId: q.get('project') || null, today: q.get('heute') === '1' };
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
