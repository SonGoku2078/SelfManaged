// When the app pulls from the server (Appwrite usage, 2026-11; #86).
//
// Before: a full load every 60 s per visible window, another on every focus
// change (≥30 s apart) and a /health function execution every 15–30 s, even
// with the window hidden. Now a pull is a cheap delta (GET /api/sync), and it
// happens when it is useful:
// - back in the foreground (visibility/focus), at most every RETURN_MIN_MS,
// - in the background only while visible: focused window every FOCUSED_MS,
//   visible but unfocused (second monitor, extra window) every UNFOCUSED_MS,
// - hidden/minimised windows never poll.
// Reachability is not polled on Appwrite: every pull answers that question.
// Only while offline a probe runs (failed requests never reach Appwrite).

export const FOCUSED_MS = 5 * 60_000;
export const UNFOCUSED_MS = 15 * 60_000;
export const RETURN_MIN_MS = 2 * 60_000;
/** Local timer that checks whether a pull is due — sends nothing by itself. */
export const TICK_MS = 30_000;
/** Probe while offline (Appwrite: only the successful one is an execution). */
export const OFFLINE_PROBE_MS = 30_000;
/** Express/LAN server: health checks cost nothing there, keep them frequent. */
export const EXPRESS_HEALTH_MS = 15_000;
/** Retry queued writes this often while any are pending. */
export const OUTBOX_RETRY_MS = 30_000;

export interface PullContext {
  now: number;
  lastPullAt: number;
  visible: boolean;
  focused: boolean;
  editing: boolean;
  dataLoaded: boolean;
}

/** Timer tick: pull in the background? */
export function backgroundPullDue(c: PullContext): boolean {
  if (!c.visible || c.editing || !c.dataLoaded) return false;
  return c.now - c.lastPullAt >= (c.focused ? FOCUSED_MS : UNFOCUSED_MS);
}

/** Window came back (visibilitychange/focus): pull now? */
export function returnPullDue(c: Pick<PullContext, 'now' | 'lastPullAt' | 'visible'>): boolean {
  return c.visible && c.now - c.lastPullAt >= RETURN_MIN_MS;
}
