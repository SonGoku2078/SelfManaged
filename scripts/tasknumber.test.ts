// Proves task numbers (#N) stay unique: two devices creating a task at the
// same time used to store the same number (two tasks #1775). The server now
// has the last word, and old duplicates are repaired once.
// Run: npx tsx scripts/tasknumber.test.ts
import assert from 'node:assert';
import { safeNextNumber, duplicateNumberTasks } from '../src/taskNumber';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { freeTaskNumber, settleTaskNumber, renumberDuplicateTasks } from '../apps/functions/api/src/main.js';

// ── Client helpers ──
assert.strictEqual(safeNextNumber(5, [{ number: 9 }]), 10, 'counter never below max+1');
const d = (id: string, number: number, createdAt: string) => ({ id, number, createdAt });
const losers = duplicateNumberTasks([
  d('newer', 1775, '2026-10-10T10:05:00Z'),
  d('older', 1775, '2026-10-10T10:00:00Z'),
  d('solo', 1776, '2026-10-10T10:06:00Z'),
  d('b', 1454, '2026-01-02T00:00:00Z'), d('a', 1454, '2026-01-01T00:00:00Z'), d('c', 1454, '2026-01-03T00:00:00Z'),
]);
assert.deepStrictEqual(losers.map((t) => t.id), ['b', 'c', 'newer'], 'oldest keeps #N, others in creation order');
assert.deepStrictEqual(duplicateNumberTasks([d('x', 1, '2026-01-01'), d('y', 2, '2026-01-01')]), [], 'no duplicates → nothing');

// ── Appwrite function against an in-memory TablesDB ──
type Row = { $id: string; $createdAt: string; number: number };
function fakeDb(rows: Row[]) {
  const q = (queries: string[]) => queries.map((s) => JSON.parse(s) as { method: string; attribute?: string; values?: unknown[] });
  return {
    rows,
    async listRows({ queries }: { queries: string[] }) {
      let out = [...rows];
      let limit = Infinity;
      for (const { method, attribute, values } of q(queries)) {
        if (method === 'equal') out = out.filter((r) => (values ?? []).includes((r as Record<string, unknown>)[attribute!]));
        if (method === 'orderDesc') out.sort((a, b) => Number((b as Record<string, unknown>)[attribute!]) - Number((a as Record<string, unknown>)[attribute!]));
        if (method === 'limit') limit = Number(values?.[0]);
      }
      return { rows: out.slice(0, limit).map((r) => ({ ...r })) };
    },
    async updateRow({ rowId, data }: { rowId: string; data: Partial<Row> }) {
      const r = rows.find((x) => x.$id === rowId)!;
      Object.assign(r, data);
      return { ...r };
    },
  };
}

const db = fakeDb([
  { $id: 'old', $createdAt: '2026-10-10T10:00:00Z', number: 1775 },
  { $id: 'other', $createdAt: '2026-10-09T10:00:00Z', number: 1770 },
]);
assert.strictEqual(await freeTaskNumber(db, 'new', 1775), 1776, 'taken number → max+1');
assert.strictEqual(await freeTaskNumber(db, 'new', 1800), 1800, 'free number is kept');
assert.strictEqual(await freeTaskNumber(db, 'old', 1775), 1775, 'own number is not a clash');
assert.strictEqual(await freeTaskNumber(db, 'new', undefined), 1776, 'missing number → max+1');

// Race: both creates passed the check and wrote #1777 — the newer one moves.
db.rows.push({ $id: 'raceA', $createdAt: '2026-10-10T11:00:00Z', number: 1777 });
db.rows.push({ $id: 'raceB', $createdAt: '2026-10-10T11:00:01Z', number: 1777 });
const a = await settleTaskNumber(db, { ...db.rows.find((r) => r.$id === 'raceA')! });
const b = await settleTaskNumber(db, { ...db.rows.find((r) => r.$id === 'raceB')! });
assert.strictEqual(a.number, 1777, 'older racer keeps its number');
assert.strictEqual(b.number, 1778, 'newer racer gets max+1');

// Old duplicates repaired in one call; nothing left afterwards.
const legacy = fakeDb([
  { $id: 't1', $createdAt: '2026-01-01T00:00:00Z', number: 1454 },
  { $id: 't2', $createdAt: '2026-01-02T00:00:00Z', number: 1454 },
  { $id: 't3', $createdAt: '2026-01-03T00:00:00Z', number: 1454 },
  { $id: 't4', $createdAt: '2026-10-10T10:00:00Z', number: 1775 },
  { $id: 't5', $createdAt: '2026-10-10T10:05:00Z', number: 1775 },
]);
assert.strictEqual(await renumberDuplicateTasks(legacy), 3, 'three tasks renumbered');
assert.deepStrictEqual(legacy.rows.map((r) => r.number), [1454, 1776, 1777, 1775, 1778], 'oldest keeps, rest max+1… in creation order');
assert.strictEqual(await renumberDuplicateTasks(legacy), 0, 'idempotent');

console.log('✅ PASS — task numbers: server enforces unique #N, old duplicates repaired.');
