// Proves the fix for #20: completing a recurring task spawns a next occurrence
// that KEEPS its subtasks (fresh / reparented / reopened). Run: npx tsx scripts/recurrence.test.ts
import assert from 'node:assert';
import { buildOccurrence } from '../src/recurrence';
import type { Task } from '../src/types';

const d = (s: string) => new Date(s);
const base: Task = {
  id: 'x', number: 0, title: '', description: '', projectId: 'proj-health', dueDate: null,
  priority: 'medium', categoryIds: [], completed: false, createdAt: d('2026-06-01'),
  updatedAt: d('2026-06-01'), starred: false, recurrence: 'none',
};
const task = (p: Partial<Task>): Task => ({ ...base, ...p });

// A weekly recurring parent, completed, WITH 3 subtasks (like "Osteopatie v2.0").
// thisWeek/todayDate set to prove the next occurrence does NOT inherit them (#18).
const parent = task({
  id: 'p1', number: 1, title: 'Osteopatie training v2.0', recurrence: 'weekly',
  dueDate: d('2026-06-30'), completed: true, completedAt: d('2026-06-30'),
  thisWeek: true, todayDate: '2026-06-30',
  comments: [{ id: 'c1', text: 'note', author: 'me', createdAt: d('2026-06-10') }],
});
const subtasks: Task[] = [
  task({ id: 's1', number: 2, title: 'Aufwärmen', parentId: 'p1', sortOrder: 0, completed: true,  completedAt: d('2026-06-30') }),
  task({ id: 's2', number: 3, title: 'Übung A',   parentId: 'p1', sortOrder: 1, completed: true,  completedAt: d('2026-06-30') }),
  task({ id: 's3', number: 4, title: 'Dehnen',    parentId: 'p1', sortOrder: 2, completed: false }),
];

let n = 0;
const makeId = () => `new-${++n}`;
const { parent: np, subs } = buildOccurrence(parent, subtasks, 100, d('2026-07-07'), d('2026-07-01'), makeId);

assert.strictEqual(subs.length, 3, 'next occurrence must carry all 3 subtasks');
assert.ok(subs.every((s) => s.parentId === np.id), 'subtasks reparented to the new occurrence');
assert.ok(subs.every((s) => s.completed === false && s.completedAt === null), 'subtasks reset to "to do"');
assert.ok(np.completed === false && np.dueDate?.toISOString() === d('2026-07-07').toISOString(), 'parent open + advanced due date');
assert.deepStrictEqual(subs.map((s) => s.title), ['Aufwärmen', 'Übung A', 'Dehnen'], 'entry order preserved');
assert.deepStrictEqual(subs.map((s) => s.number), [101, 102, 103], 'numbered after the parent');
assert.ok(subs.every((s) => s.id.startsWith('new-') && s.id !== np.id), 'fresh unique ids');
assert.deepStrictEqual(np.comments?.map((c) => c.text), ['note'], 'comments carried over like in Nozbe');
assert.ok(np.comments !== parent.comments, 'comments copied, not shared by reference');
assert.ok(np.thisWeek === false && np.todayDate === null, 'week/day commitments not inherited (#18)');

console.log(`✅ PASS — next occurrence "${np.title}" (due ${np.dueDate?.toDateString()}) keeps ${subs.length} subtasks:`);
subs.forEach((s) => console.log(`   ↳ #${s.number} ${s.title}  (parentId=${s.parentId}, completed=${s.completed})`));
