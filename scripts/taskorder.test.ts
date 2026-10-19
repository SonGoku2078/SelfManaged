// Proves a drag persists with ONE write (a few at most) (#149): one moved task
// used to renumber all ~1900 tasks — 700+ row writes against Appwrite's
// ~120 writes/minute per user, so "Änderungen werden synchronisiert" stayed
// on screen for many minutes.
// Run: npx tsx scripts/taskorder.test.ts
import assert from 'node:assert';
import { ORDER_STEP, edgeOrder, orderBetween, placeMoved, respaceWindow, spacedOut } from '../src/taskOrder';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { forEachLimited } from '../apps/functions/api/src/main.js';

type T = { id: string; sortOrder?: number; parentId?: string | null };
const t = (id: string, sortOrder?: number, parentId: string | null = null): T => ({ id, sortOrder, parentId });
const move = (list: T[], id: string, before: string): T[] => {
  const out = list.filter((x) => x.id !== id);
  out.splice(out.findIndex((x) => x.id === before), 0, list.find((x) => x.id === id)!);
  return out;
};
const increasing = (list: T[]) => list.every((x, k) => k === 0 || x.sortOrder! > list[k - 1].sortOrder!);

// ── orderBetween ──
assert.strictEqual(orderBetween([t('a', 0), t('m', 9999), t('b', 1024)], 1), 512, 'midpoint between neighbours');
assert.strictEqual(orderBetween([t('m', 5), t('a', 0)], 0), -ORDER_STEP, 'top: one step above the first');
assert.strictEqual(orderBetween([t('a', 0), t('m', 5)], 1), ORDER_STEP, 'bottom: one step below the last');
assert.strictEqual(orderBetween([t('m', 5)], 0), 0, 'alone');
assert.strictEqual(orderBetween([t('a', 0), t('m', 9), t('b', 1)], 1), null, 'no integer gap');
assert.strictEqual(orderBetween([t('a', 4096), t('m', 9), t('b', 5000), t('c', 0)], 1), null, 'rest unsorted');
assert.strictEqual(orderBetween([t('a'), t('m', 9), t('b', 2)], 1), 1, 'missing sortOrder counts as 0');

// ── After the one-time spacing (migration): every drag = 1 write ──
const N = 1900;
let list: T[] = spacedOut(Array.from({ length: N }, (_, i) => t(`t${i}`, i)));
for (let i = 0; i < 9; i++) {
  const p = placeMoved(move(list, `t${1000 + i}`, 't2'), `t${1000 + i}`);
  assert.deepStrictEqual(p.updates.map(([id]) => id), [`t${1000 + i}`], `drag ${i + 1}: exactly one write`);
  assert.strictEqual(p.reorderIds, null, 'no full reorder');
  list = p.tasks;
  assert.ok(increasing(list), 'order stays strictly increasing');
}
// Keep dropping into the same spot: the gap runs out, then only neighbours move.
let maxWrites = 0;
for (let i = 0; i < 40; i++) {
  const p = placeMoved(move(list, `t${1100 + i}`, 't2'), `t${1100 + i}`);
  assert.strictEqual(p.reorderIds, null, 'never a full reorder');
  assert.strictEqual(p.updates[0][0], `t${1100 + i}`, 'moved task is written first');
  maxWrites = Math.max(maxWrites, p.updates.length);
  list = p.tasks;
  assert.ok(increasing(list), `order stays strictly increasing (drop ${i})`);
}
assert.ok(maxWrites <= 10, `exhausted gap costs only a few writes (max ${maxWrites})`);
const at2 = list.findIndex((x) => x.id === 't2');
assert.strictEqual(list[at2 - 1].id, 't1139', 'last drop sits right before t2');
assert.deepStrictEqual(list.slice(0, 3).map((x) => x.id), ['t0', 't1', 't1000'], 'earlier drops keep their order');

// ── Before the migration (dense 0..n): bounded window or one reorder, never 700 single writes ──
const dense = Array.from({ length: N }, (_, i) => t(`t${i}`, i));
const nearTop = placeMoved(move(dense, 't1500', 't3'), 't1500');
assert.ok(nearTop.updates.length <= 50 || nearTop.reorderIds, 'dense list: bounded');
const middle = placeMoved(move(dense, 't10', 't950'), 't10');
assert.ok(middle.updates.length <= 50, 'middle of a dense list: at most a window');
assert.ok(increasing(middle.tasks) || middle.reorderIds, 'consistent');
assert.deepStrictEqual(respaceWindow([t('a', 0), t('m', 0), t('b', 1)], 1), { from: 0, values: [0, 1024, 2048] }, 'tiny list: whole window');
assert.deepStrictEqual(respaceWindow([t('a', 0), t('m', 0), t('b', 1), t('c', 5000)], 1), { from: 0, values: [1928, 2952, 3976] }, 'open top end: steps below the next task');

// A queued full reorder would overwrite single updates → renumber instead.
const forced = placeMoved(spacedOut(dense), 't5', true);
assert.strictEqual(forced.updates.length, 0, 'forceRenumber: no single updates');
assert.strictEqual(forced.reorderIds!.length, N, 'forceRenumber: full level');

// Subtasks keep their own per-parent order and don't count for top-level moves.
const pm = placeMoved([t('a', 0), t('s1', 0, 'a'), t('s2', 1, 'a'), t('m', 99), t('b', 2048)], 'm');
assert.deepStrictEqual(pm.updates, [['m', 1024]], 'subtask values ignored for a top-level move');
const ps = placeMoved([t('a', 0), t('s1', 0, 'a'), t('s3', 2, 'a'), t('s2', 1, 'a')], 's3');
assert.ok(ps.updates.every(([id]) => id.startsWith('s')), 'subtask move only touches siblings');
assert.strictEqual(ps.tasks[0].sortOrder, 0, 'top level untouched');

// New tasks land where they are shown (top/bottom), so the next drag still finds sorted neighbours.
const three = spacedOut(dense.slice(0, 3));
assert.strictEqual(edgeOrder(three, true), -ORDER_STEP, 'add to top');
assert.strictEqual(edgeOrder([...three, t('s', 99999, 'p')], false), 3 * ORDER_STEP, 'add to bottom, subtasks ignored');
assert.strictEqual(edgeOrder([], true), 0, 'empty list');
const withNew = [...three, t('n', edgeOrder(three, false))];
assert.strictEqual(placeMoved(move(withNew, 'n', 't1'), 'n').updates.length, 1, 'drag right after creating: one write');

// ── Server: a big renumber stops at the time budget instead of the function timeout ──
const items = Array.from({ length: 100 }, (_, i) => i);
const done: number[] = [];
const n = await forEachLimited(items, 4, async (i: number) => { done.push(i); await new Promise((r) => setTimeout(r, 20)); }, Date.now() + 60);
assert.ok(n < items.length && n === done.length, `budget stops early (${n} of ${items.length})`);
assert.strictEqual(await forEachLimited(items, 4, async () => {}), items.length, 'no deadline → all');

console.log('✅ PASS — task order: a drag writes one row (a few at most), never the whole list.');
