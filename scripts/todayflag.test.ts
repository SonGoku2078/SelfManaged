// Proves #23/#112: the manual ☀️ Heute flag (todayDate) shows a task in the
// Today view alongside due-today tasks and CARRIES OVER midnight until done or
// removed (#112 — it used to expire overnight). A future-dated flag is not yet active.
// Run: npx tsx scripts/todayflag.test.ts
import assert from 'node:assert';
import { selectVisibleTasks, isTodayFlagActive, dateKey, addDays } from '../src/selectors';
import { mobileToday } from '../apps/mobile/src/selectors';
import type { Task, UIState } from '../src/types';

const now = new Date();
const todayKey = dateKey(now);
const yesterdayKey = dateKey(addDays(now, -1));
const tomorrowKey = dateKey(addDays(now, 1));

const base: Task = {
  id: 'x', number: 0, title: '', description: '', projectId: null, dueDate: null,
  priority: 'medium', categoryIds: [], completed: false, createdAt: now,
  updatedAt: now, starred: false, recurrence: 'none',
};
const task = (p: Partial<Task>): Task => ({ ...base, ...p });

const dueToday = task({ id: 'due', number: 1, title: 'Fällig heute', dueDate: now });
const pinnedToday = task({ id: 'pin', number: 2, title: 'Heute gepinnt', todayDate: todayKey });
const pinnedYesterday = task({ id: 'stale', number: 3, title: 'Gestern gepinnt', todayDate: yesterdayKey });
const plain = task({ id: 'plain', number: 4, title: 'Ohne alles' });
const pinnedTomorrow = task({ id: 'future', number: 5, title: 'Für morgen geplant', todayDate: tomorrowKey });
const pinnedDone = task({ id: 'done', number: 6, title: 'Gestern gepinnt, erledigt', todayDate: yesterdayKey, completed: true });

// isTodayFlagActive: only today's key counts.
assert.ok(isTodayFlagActive(pinnedToday), 'flag with today key is active');
assert.ok(isTodayFlagActive(pinnedYesterday), 'flag from yesterday carries over (#112)');
assert.ok(!isTodayFlagActive(pinnedTomorrow), 'flag planned for tomorrow is not active yet');
assert.ok(!isTodayFlagActive(plain), 'no todayDate → not active');

// Today view: union of due-today and actively pinned; stale pin stays out.
const ui = {
  currentView: 'today',
  selectedProjectId: null,
  selectedProjectIds: [],
  searchQuery: '',
  filters: { projectId: null, categoryId: null, priority: null, completed: null, assigneeId: null, dueFrom: null, dueTo: null },
  sortField: 'manual',
  sortDir: 'asc',
} as unknown as UIState;
const all = [dueToday, pinnedToday, pinnedYesterday, plain, pinnedTomorrow, pinnedDone];
const doneToday = task({ id: 'doneToday', number: 7, title: 'Gestern gepinnt, heute erledigt', todayDate: yesterdayKey, completed: true, completedAt: now });
const visible = selectVisibleTasks([...all, doneToday], ui).map((t) => t.id);
assert.deepStrictEqual(visible.sort(), ['doneToday', 'due', 'pin', 'stale'],
  'Heute = due today ∪ open pins (today or earlier) ∪ pins finished today — old finished pins stay out');

// Mobile Heute tab uses the same rules (open root tasks only).
const mobile = mobileToday(all).map((t) => t.id);
assert.deepStrictEqual(mobile.sort(), ['due', 'pin', 'stale'], 'mobileToday matches the web rule');

console.log(`✅ PASS — Heute view shows [${visible.join(', ')}]; yesterday's pin (${yesterdayKey}) carried over, tomorrow's not yet active.`);
