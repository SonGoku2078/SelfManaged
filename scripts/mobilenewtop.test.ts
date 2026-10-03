// A task created on mobile lands on TOP of its list (Heute, Inbox, Next Week
// group) — independent of the store's array order, which follows the desktop
// "add to top" setting and the server reload order.
// Run: npx tsx scripts/mobilenewtop.test.ts
import assert from 'node:assert';
import { mobileToday, mobileInbox, mobileNextWeek, dateKey } from '../apps/mobile/src/selectors';
import type { Task } from '../src/types';

const now = new Date();
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const todayKey = dateKey(now);

const base: Task = {
  id: 'x', number: 0, title: '', description: '', projectId: null, dueDate: null,
  priority: 'medium', categoryIds: [], completed: false, createdAt: now,
  updatedAt: now, starred: false, recurrence: 'none',
};
const task = (p: Partial<Task>): Task => ({ ...base, ...p });

// Array order = oldest first, as after "add to bottom" or a server reload.
const heute = [
  task({ id: 'h-old-due', dueDate: now, createdAt: ago(600) }),
  task({ id: 'h-old-pin', todayDate: todayKey, createdAt: ago(300) }),
  task({ id: 'h-new', todayDate: todayKey, createdAt: ago(0) }),
];
assert.deepStrictEqual(mobileToday(heute).map((t) => t.id), ['h-new', 'h-old-pin', 'h-old-due'],
  'Heute: newest task on top, even before an older task due today');

const inbox = [
  task({ id: 'i-old', createdAt: ago(60) }),
  task({ id: 'i-mid', createdAt: ago(10) }),
  task({ id: 'i-new', createdAt: ago(0) }),
];
assert.deepStrictEqual(mobileInbox(inbox).map((t) => t.id), ['i-new', 'i-mid', 'i-old'],
  'Inbox: newest task on top');

const week = [
  task({ id: 'w-old', thisWeek: true, createdAt: ago(60) }),
  task({ id: 'w-new', thisWeek: true, createdAt: ago(0) }),
];
const undated = mobileNextWeek(week).find((g) => g.key === 'future');
assert.deepStrictEqual(undated?.tasks.map((t) => t.id), ['w-new', 'w-old'],
  'Next Week: same (no) due date → newest on top within the group');

console.log('✅ PASS — new mobile tasks sort to the top of Heute, Inbox and Next Week groups.');
