import type { ViewType } from './types';

// Extra windows: a view (Heute, Next Week, …) or a single project opened in
// its own window via right-click → "In neuem Fenster öffnen". The window is
// the normal app, booted from `?fenster=<view>` / `?fenster=project&id=<id>`,
// with the sidebar hidden so it stays on that one list.

// Views that make sense on their own — task lists, not tools like Settings.
export const WINDOW_VIEWS: ReadonlySet<ViewType> = new Set<ViewType>([
  'priority', 'inbox', 'today', 'nextweek', 'someday', 'projects', 'categories',
  'calendar', 'search', 'completed', 'recurring',
]);

export type WindowTarget =
  | { kind: 'view'; view: ViewType }
  | { kind: 'project'; projectId: string };

export function windowQuery(target: WindowTarget): string {
  const p = new URLSearchParams();
  if (target.kind === 'project') {
    p.set('fenster', 'project');
    p.set('id', target.projectId);
  } else {
    p.set('fenster', target.view);
  }
  return `?${p.toString()}`;
}

export function parseWindowQuery(search: string): WindowTarget | null {
  const p = new URLSearchParams(search);
  const v = p.get('fenster');
  if (!v) return null;
  if (v === 'project') {
    const id = p.get('id');
    return id ? { kind: 'project', projectId: id } : null;
  }
  return WINDOW_VIEWS.has(v as ViewType) ? { kind: 'view', view: v as ViewType } : null;
}

const read = (): WindowTarget | null =>
  typeof window === 'undefined' ? null : parseWindowQuery(window.location.search);

// Fixed for the lifetime of the page: this window was opened as an extra window.
export const WINDOW_TARGET: WindowTarget | null = read();
export const IS_EXTRA_WINDOW = WINDOW_TARGET !== null;

export function openInNewWindow(target: WindowTarget): void {
  const url = `${window.location.origin}${window.location.pathname}${windowQuery(target)}`;
  // Unique name → every click opens a fresh window instead of reusing one.
  window.open(url, `tm-${Date.now().toString(36)}`, 'popup,width=1100,height=800');
}
