// Proves #24: the server ICS generator emits valid RFC 5545 output — all-day
// vs timed events, RRULE mapping (incl. the no-RRULE-on-completed rule),
// escaping, octet-aware folding. Run: npx tsx scripts/ics.test.ts
import assert from 'node:assert';
import { tasksToICS, type IcsTask } from '../server/src/ics';

const d = (s: string) => new Date(s);
const base: IcsTask = {
  id: 'x', title: 'Task', description: '', dueDate: d('2026-07-04T00:00:00'),
  startMinutes: null, durationMin: null, completed: false,
  updatedAt: d('2026-07-01T10:00:00Z'), recurrence: 'none', recurrenceEnd: null,
  recurInterval: null, recurUnit: null, recurMonthDay: null,
};
const task = (p: Partial<IcsTask>): IcsTask => ({ ...base, ...p });
const ics = (p: Partial<IcsTask>) => tasksToICS([task(p)]);

// Unfold continuation lines to inspect logical lines.
const unfold = (s: string) => s.replace(/\r\n /g, '');

// Escaping: ; , and newlines are escaped in SUMMARY.
assert.ok(unfold(ics({ title: 'a;b,c\nd' })).includes('SUMMARY:a\\;b\\,c\\nd'), 'escaping');

// All-day event: DATE values, DTEND is the next day.
const allDay = ics({});
assert.ok(allDay.includes('DTSTART;VALUE=DATE:20260704'), 'all-day DTSTART');
assert.ok(allDay.includes('DTEND;VALUE=DATE:20260705'), 'all-day DTEND next day');

// Timed event: 09:30 + 90 min → 09:30–11:00 local floating.
const timed = ics({ startMinutes: 570, durationMin: 90 });
assert.ok(timed.includes('DTSTART:20260704T093000'), 'timed DTSTART');
assert.ok(timed.includes('DTEND:20260704T110000'), 'timed DTEND');
// Default duration 30 min (Nozbe default).
assert.ok(ics({ startMinutes: 570 }).includes('DTEND:20260704T100000'), 'default 30min');

// RRULE mapping.
assert.ok(ics({ recurrence: 'weekly' }).includes('RRULE:FREQ=WEEKLY\r\n'), 'weekly');
assert.ok(
  ics({ recurrence: 'custom', recurUnit: 'week', recurInterval: 2 }).includes('RRULE:FREQ=WEEKLY;INTERVAL=2'),
  'custom 2 weeks'
);
assert.ok(
  ics({ recurrence: 'monthly', recurMonthDay: 'last' }).includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'),
  'monthly last day'
);
assert.ok(
  ics({ recurrence: 'monthly', recurMonthDay: 'first' }).includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=1'),
  'monthly first day'
);
// UNTIL: floating datetime on timed events, date-only on all-day.
assert.ok(
  ics({ recurrence: 'daily', recurrenceEnd: d('2026-12-31T00:00:00'), startMinutes: 570 })
    .includes('UNTIL=20261231T235959'),
  'UNTIL timed'
);
assert.ok(
  ics({ recurrence: 'daily', recurrenceEnd: d('2026-12-31T00:00:00') }).includes('UNTIL=20261231\r\n'),
  'UNTIL all-day'
);

// Completed: ✓ prefix, and NO RRULE even if recurrence is set — completing a
// recurring task spawns the next occurrence as its own row.
const done = ics({ completed: true, recurrence: 'weekly', title: 'Fertig' });
assert.ok(unfold(done).includes('SUMMARY:✓ Fertig'), 'completed prefix');
assert.ok(!done.includes('RRULE'), 'no RRULE on completed');

// CATEGORIES from project name.
assert.ok(unfold(ics({ projectName: 'Haushalt' })).includes('CATEGORIES:Haushalt'), 'categories');

// Folding: every physical line ≤ 75 octets even with multi-byte chars, and
// unfolding restores the original text.
const long = 'Ärger über die Prüfung — ✓✓✓ '.repeat(10);
const folded = ics({ title: long });
for (const line of folded.split('\r\n')) {
  assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line ≤75 octets: ${Buffer.byteLength(line, 'utf8')}`);
}
assert.ok(unfold(folded).includes(`SUMMARY:${long.replace(/,/g, '\\,')}`), 'unfold restores text');

// Wrapper + UID + CRLF discipline.
assert.ok(folded.startsWith('BEGIN:VCALENDAR\r\n'), 'calendar begin');
assert.ok(folded.trimEnd().endsWith('END:VCALENDAR'), 'calendar end');
assert.ok(folded.includes('UID:x@selfmanaged'), 'stable UID');
assert.ok(!folded.replace(/\r\n/g, '').includes('\n'), 'CRLF only');

// Tasks without dueDate are excluded.
assert.ok(!tasksToICS([task({ dueDate: null })]).includes('BEGIN:VEVENT'), 'no dueDate → no event');

console.log('✅ PASS — ICS feed: all-day/timed, RRULE (incl. completed rule), escaping, 75-octet folding.');
