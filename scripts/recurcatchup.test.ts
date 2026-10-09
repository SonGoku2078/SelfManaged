// Completing an overdue recurring task skips the missed occurrences: the next
// one is the first date after today, not one step after the old due date.
// Run: npx tsx scripts/recurcatchup.test.ts
import assert from 'node:assert';
import { nextDueAfterCompletion } from '../src/recurrence';

const day = (s: string) => new Date(`${s}T18:00:00`);
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const weekly = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; };
const daily = (d: Date) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; };
const monthly = (d: Date) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; };
const now = new Date('2026-10-09T10:00:00'); // Friday

// Weekly, six weeks missed (due Fri 28.08.) → next Friday after today, once.
assert.strictEqual(key(nextDueAfterCompletion(day('2026-08-28'), now, weekly)), '2026-10-16');
// "Essen mit Liam": due Fri 02.10., checked off Fri 09.10. → 16.10., not 09.10.
assert.strictEqual(key(nextDueAfterCompletion(day('2026-10-02'), now, weekly)), '2026-10-16');
// On time (due today) and early (due next week): plain one step, as before.
assert.strictEqual(key(nextDueAfterCompletion(day('2026-10-09'), now, weekly)), '2026-10-16');
assert.strictEqual(key(nextDueAfterCompletion(day('2026-10-14'), now, weekly)), '2026-10-21');
// The weekday of the series is kept (Monday series stays on Mondays).
const mon = nextDueAfterCompletion(day('2026-09-07'), now, weekly);
assert.strictEqual(key(mon), '2026-10-12');
assert.strictEqual(mon.getHours(), 18, 'time of day kept');
// Daily, ten days overdue → tomorrow. Monthly, three months overdue → next month.
assert.strictEqual(key(nextDueAfterCompletion(day('2026-09-29'), now, daily)), '2026-10-10');
assert.strictEqual(key(nextDueAfterCompletion(day('2026-07-05'), now, monthly)), '2026-11-05');
// A step that does not advance never hangs.
assert.strictEqual(key(nextDueAfterCompletion(day('2026-01-01'), now, (d) => new Date(d))), '2026-01-01');

console.log('✅ PASS — overdue recurring task: next occurrence after today, missed weeks skipped.');
