// Manual task order (#149).
//
// A drag used to renumber the COMPLETE task list (0, 1, 2, …): moving one task
// shifted hundreds of rows. The API function writes with the user's session,
// which Appwrite limits to roughly 120 writes per minute — so one drag kept
// "Änderungen werden synchronisiert" on screen for many minutes.
//
// Positions are now spaced ORDER_STEP apart. A moved task takes a value
// between its two neighbours (one write); when that gap is used up, only a
// few neighbours around it are spread out again (a handful of writes). The
// complete level is renumbered only if the local order is inconsistent.

export const ORDER_STEP = 1024;
// Spread out a window around the drop point only if it leaves at least this
// much room between the tasks; otherwise widen the window.
const MIN_GAP = 16;
// Beyond this many writes a window is no cheaper than a full renumber.
const MAX_WINDOW = 50;

interface Ordered {
  sortOrder?: number;
}

const so = (t: Ordered): number => t.sortOrder ?? 0;

/** Is the list sorted by sortOrder once the item at `skip` is left out? */
function sortedExcept(list: readonly Ordered[], skip: number): boolean {
  let last = -Infinity;
  for (let i = 0; i < list.length; i++) {
    if (i === skip) continue;
    const v = so(list[i]);
    if (v < last) return false;
    last = v;
  }
  return true;
}

/**
 * New sortOrder for the item at `index` (already moved there) that keeps it
 * between its neighbours, or null when that is impossible: no integer gap, or
 * the rest of the list is not sorted by sortOrder (then a value between the
 * neighbours would not land the task at this position on the server).
 */
export function orderBetween(list: readonly Ordered[], index: number): number | null {
  if (!sortedExcept(list, index)) return null;
  const prev = index > 0 ? list[index - 1] : undefined;
  const next = index < list.length - 1 ? list[index + 1] : undefined;
  if (!prev && !next) return 0;
  if (!prev) return so(next!) - ORDER_STEP;
  if (!next) return so(prev) + ORDER_STEP;
  const lo = so(prev);
  const hi = so(next);
  if (hi - lo < 2) return null;
  return Math.floor((lo + hi) / 2);
}

/**
 * Spreads out the smallest window around `index` that has room again:
 * values for list[a..b], or null if that would take more than MAX_WINDOW
 * writes. Expects the rest of the list to be sorted.
 */
export function respaceWindow(list: readonly Ordered[], index: number): { from: number; values: number[] } | null {
  const n = list.length;
  for (let k = 1; 2 * k + 1 <= MAX_WINDOW || k === 1; k++) {
    const a = Math.max(0, index - k);
    const b = Math.min(n - 1, index + k);
    const count = b - a + 1;
    if (count > MAX_WINDOW) return null;
    const lo = a > 0 ? so(list[a - 1]) : null;
    const hi = b < n - 1 ? so(list[b + 1]) : null;
    const at = (j: number): number[] => Array.from({ length: count }, (_, i) => j + i);
    if (lo === null && hi === null) return { from: a, values: at(0).map((i) => i * ORDER_STEP) };
    if (lo === null) return { from: a, values: at(0).map((i) => hi! - (count - i) * ORDER_STEP) };
    if (hi === null) return { from: a, values: at(1).map((i) => lo + i * ORDER_STEP) };
    const gap = Math.floor((hi - lo) / (count + 1));
    if (gap >= MIN_GAP) return { from: a, values: at(1).map((i) => lo + i * gap) };
  }
  return null;
}

/** Renumbers the list with ORDER_STEP gaps (keeps unchanged items as-is). */
export function spacedOut<T extends Ordered>(list: readonly T[]): T[] {
  return list.map((t, i) => (t.sortOrder === i * ORDER_STEP ? t : { ...t, sortOrder: i * ORDER_STEP }));
}

/** sortOrder for a new top-level task added at the top or the bottom. */
export function edgeOrder(list: readonly (Ordered & { parentId?: string | null })[], top: boolean): number {
  let min = Infinity;
  let max = -Infinity;
  for (const t of list) {
    if (t.parentId) continue;
    min = Math.min(min, so(t));
    max = Math.max(max, so(t));
  }
  if (min === Infinity) return 0;
  return top ? min - ORDER_STEP : max + ORDER_STEP;
}

interface Movable extends Ordered {
  id: string;
  parentId?: string | null;
}

export interface Placement<T> {
  tasks: T[];
  /** New sortOrders to persist, one `task.update` each (the moved task first). */
  updates: Array<[id: string, sortOrder: number]>;
  /** Set instead when the level had to be renumbered: a full `task.reorder`. */
  reorderIds: string[] | null;
}

/**
 * Persistable placement of `movedId`, which already sits at its new spot in
 * `list`. Only tasks on the same level count (top level, or the siblings
 * under one parent): subtasks carry their own per-parent order. Pass
 * `forceRenumber` while an older full reorder is still queued — single
 * updates would be overwritten when that one is replayed.
 */
export function placeMoved<T extends Movable>(list: T[], movedId: string, forceRenumber = false): Placement<T> {
  const moved = list.find((t) => t.id === movedId);
  if (!moved) return { tasks: list, updates: [], reorderIds: null };
  const parent = moved.parentId ?? null;
  const peers = list.filter((t) => (t.parentId ?? null) === parent);
  const idx = peers.indexOf(moved);

  const apply = (updates: Array<[string, number]>): Placement<T> => {
    const byId = new Map(updates);
    return {
      tasks: list.map((t) => (byId.has(t.id) && byId.get(t.id) !== t.sortOrder ? { ...t, sortOrder: byId.get(t.id)! } : t)),
      updates,
      reorderIds: null,
    };
  };

  if (!forceRenumber && sortedExcept(peers, idx)) {
    const v = orderBetween(peers, idx);
    if (v !== null) return apply([[movedId, v]]);
    const w = respaceWindow(peers, idx);
    if (w) {
      const updates: Array<[string, number]> = w.values
        .map((v, i): [string, number] => [peers[w.from + i].id, v])
        .filter(([id, v]) => id === movedId || v !== so(peers.find((p) => p.id === id)!));
      updates.sort(([a], [b]) => Number(b === movedId) - Number(a === movedId));
      return apply(updates);
    }
  }
  const spaced = new Map(spacedOut(peers).map((t) => [t.id, t]));
  return {
    tasks: list.map((t) => spaced.get(t.id) ?? t),
    updates: [],
    reorderIds: peers.map((t) => t.id),
  };
}
