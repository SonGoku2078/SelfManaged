// Next task number: the stored counter, but never at or below a number that
// already exists. The counter lives in the server settings and can be missing
// or stale (another device created tasks meanwhile) — new tasks then started
// at 1 again or reused numbers (#136: a mail task got #1).
export function safeNextNumber(stored: unknown, tasks: { number?: number }[]): number {
  let max = 0;
  for (const t of tasks) if (typeof t.number === 'number' && t.number > max) max = t.number;
  const n = typeof stored === 'number' && Number.isFinite(stored) ? stored : Number(stored);
  return Math.max(Number.isFinite(n) && n > 0 ? Math.floor(n) : 1, max + 1);
}

// Tasks that share their #N with an older task (left over from before the
// server enforced unique numbers, e.g. two tasks #1775). The oldest keeps the
// number; every other one is returned — in creation order — to get a new one.
export function duplicateNumberTasks<T extends { id: string; number?: number; createdAt?: Date | string }>(tasks: T[]): T[] {
  const byNumber = new Map<number, T[]>();
  for (const t of tasks) {
    if (typeof t.number !== 'number' || t.number <= 0) continue;
    const list = byNumber.get(t.number);
    if (list) list.push(t);
    else byNumber.set(t.number, [t]);
  }
  const created = (t: T) => (t.createdAt ? +new Date(t.createdAt) || 0 : 0);
  const order = (a: T, b: T) => created(a) - created(b) || a.id.localeCompare(b.id);
  const losers: T[] = [];
  for (const list of byNumber.values()) if (list.length > 1) losers.push(...[...list].sort(order).slice(1));
  return losers.sort(order);
}
