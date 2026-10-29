// ★ Next Actions filter: only starred root tasks — plus a parent whose open
// subtask is starred (subtasks only show nested under it). Off = unchanged.
// Run: npx tsx scripts/starredfilter.test.ts
import assert from 'node:assert';
import { selectVisibleTasks } from '../src/selectors';
import type { Task, UIState } from '../src/types';

const now = new Date();
const base: Task = {
  id: 'x', number: 0, title: '', description: '', projectId: 'p1', dueDate: null,
  priority: 'medium', categoryIds: [], completed: false, createdAt: now,
  updatedAt: now, starred: false, recurrence: 'none',
};
const task = (p: Partial<Task>): Task => ({ ...base, ...p });

const tasks = [
  task({ id: 'star', number: 1, starred: true, sectionId: 's1' }),
  task({ id: 'plain', number: 2, sectionId: 's1' }),
  task({ id: 'parent', number: 3, sectionId: 's2' }),
  task({ id: 'child', number: 4, parentId: 'parent', starred: true }),
  task({ id: 'parent2', number: 5 }),
  task({ id: 'doneChild', number: 6, parentId: 'parent2', starred: true, completed: true }),
  task({ id: 'other', number: 7, projectId: 'p2', starred: true }),
];

const ui = (starred: boolean) => ({
  currentView: 'projects',
  selectedProjectId: 'p1',
  selectedProjectIds: ['p1'],
  searchQuery: '',
  filters: { projectId: null, categoryId: null, priority: null, completed: null, dueFrom: null, dueTo: null, assigneeId: null, starred },
  sortField: 'manual',
  sortDir: 'asc',
}) as unknown as UIState;

const ids = (starred: boolean) => selectVisibleTasks(tasks, ui(starred)).map((t) => t.id).sort();

assert.deepStrictEqual(ids(false), ['parent', 'parent2', 'plain', 'star'], 'filter off: all root tasks of the project');
assert.deepStrictEqual(ids(true), ['parent', 'star'], 'filter on: starred + parent of a starred open subtask');

console.log('✅ PASS — ★ Next Actions filter: starred roots + parents of starred open subtasks.');
