// The Appwrite ICS function (live calendar feed): timed tasks default to 30
// minutes, carry TZID=Europe/Zurich, and land on the Swiss calendar day no
// matter how the dueDate was stored or which TZ the function runs in.
// Run: npx tsx scripts/ics-appwrite.test.ts
import assert from 'node:assert';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { tasksToIcs, DEFAULT_DURATION_MIN } from '../apps/functions/ics/src/main.js';

const row = (p: Record<string, unknown>) => ({
  legacyId: 't1', title: 'Task', description: '', dueDate: '2026-10-05T00:00:00.000Z',
  startMinutes: null, durationMin: null, completed: false, recurrence: 'none',
  updatedAt: '2026-10-01T10:00:00.000Z', projectId: null, ...p,
});
const ics = (p: Record<string, unknown>) => tasksToIcs([row(p)], []) as string;

assert.strictEqual(DEFAULT_DURATION_MIN, 30);

// Timed, no duration → 30 minutes, Zurich wall clock.
const timed = ics({ startMinutes: 9 * 60 });
assert.ok(timed.includes('DTSTART;TZID=Europe/Zurich:20261005T090000'), timed);
assert.ok(timed.includes('DTEND;TZID=Europe/Zurich:20261005T093000'), 'default 30 min');
assert.ok(timed.includes('BEGIN:VTIMEZONE') && timed.includes('TZID:Europe/Zurich'), 'VTIMEZONE present');

// Explicit duration wins.
assert.ok(ics({ startMinutes: 14 * 60, durationMin: 90 }).includes('DTEND;TZID=Europe/Zurich:20261005T153000'));

// dueDate stored as Zurich midnight (22:00 UTC the day before) → still Oct 5.
const zurichMidnight = ics({ dueDate: '2026-10-04T22:00:00.000Z' });
assert.ok(zurichMidnight.includes('DTSTART;VALUE=DATE:20261005'), zurichMidnight);
assert.ok(zurichMidnight.includes('DTEND;VALUE=DATE:20261006'), 'all-day ends next day');

// Winter time (CET, UTC+1) midnight.
assert.ok(ics({ dueDate: '2026-12-31T23:00:00.000Z' }).includes('DTSTART;VALUE=DATE:20270101'));

// Late evening task crossing midnight.
const late = ics({ startMinutes: 23 * 60 + 45 });
assert.ok(late.includes('DTEND;TZID=Europe/Zurich:20261006T001500'), late);

// Recurring timed task: UNTIL in UTC (RFC 5545 with TZID start).
const rec = ics({ startMinutes: 8 * 60, recurrence: 'daily', recurrenceEnd: '2026-10-31T00:00:00.000Z' });
assert.ok(rec.includes('RRULE:FREQ=DAILY;UNTIL=20261031T235959Z'), rec);

console.log('✅ PASS — Appwrite ICS feed: 30-min default, Europe/Zurich, correct Swiss day.');
