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
