// The Appwrite ICS function (live calendar feed): timed tasks default to 30
// minutes, carry TZID=Europe/Zurich, and land on the Swiss calendar day no
// matter how the dueDate was stored or which TZ the function runs in.
// Run: npx tsx scripts/ics-appwrite.test.ts
import assert from 'node:assert';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { tasksToIcs, blockersToIcs, DEFAULT_DURATION_MIN } from '../apps/functions/ics/src/main.js';

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

// ── Project blocker feed (second calendar) ──────────────────────────────────
const projects = [{ legacyId: 'p1', name: 'SM Plattform' }, { legacyId: 'p2', name: 'Andere' }];
const blocker = (p: Record<string, unknown>) => ({
  legacyId: 'b1', projectId: 'p1', weekdays: [2, 0], startMinutes: 8 * 60, durationMin: 210,
  $createdAt: '2026-10-28T09:00:00.000Z', $updatedAt: '2026-10-28T09:00:00.000Z', ...p,
});
const now = new Date('2026-10-28T12:00:00.000Z'); // Wednesday; week = Oct 26–Nov 1
const weekTasks = [
  row({ legacyId: 'a', title: 'Normal', projectId: 'p1', thisWeek: true, dueDate: null }),
  row({ legacyId: 'b', title: 'Wichtig', projectId: 'p1', starred: true, dueDate: '2026-10-29T00:00:00.000Z' }),
  row({ legacyId: 'c', title: 'Nächste Woche', projectId: 'p1', dueDate: '2026-11-03T00:00:00.000Z' }),
  row({ legacyId: 'd', title: 'Subtask', projectId: 'p1', thisWeek: true, parentId: 'a' }),
  row({ legacyId: 'e', title: 'Fremd', projectId: 'p2', thisWeek: true }),
];
const blk = blockersToIcs([blocker({})], projects, weekTasks, now) as string;
assert.ok(blk.includes('X-WR-CALNAME:SelfManaged Projektblocker'), 'own calendar name');
assert.ok(blk.includes('UID:blocker-b1@selfmanaged'), 'stable UID, distinct from task UIDs');
// Series starts on the first weekday (Monday) of the creation week, Zurich clock.
assert.ok(blk.includes('DTSTART;TZID=Europe/Zurich:20261026T080000'), blk);
assert.ok(blk.includes('DTEND;TZID=Europe/Zurich:20261026T113000'), '210 min');
assert.ok(blk.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,WE'), 'weekly on the blocker weekdays');
assert.ok(blk.includes('SUMMARY:SM Plattform'), 'titled with the project name');
// Description: this week's open root tasks of the project, starred first.
assert.ok(blk.includes('DESCRIPTION:★ Wichtig\\n• Normal'), blk);
assert.ok(!blk.includes('Nächste Woche') && !blk.includes('Subtask') && !blk.includes('Fremd'), 'only this week, root, own project');
// Blockers of deleted projects or without weekdays are skipped.
const none = blockersToIcs([blocker({ projectId: 'gone' }), blocker({ legacyId: 'b2', weekdays: [] })], projects, [], now) as string;
assert.ok(!none.includes('BEGIN:VEVENT'), none);
// Sunday-only blocker created mid-week anchors to that week's Sunday.
assert.ok((blockersToIcs([blocker({ weekdays: [6] })], projects, [], now) as string).includes('DTSTART;TZID=Europe/Zurich:20261101T080000'));

console.log('✅ PASS — Appwrite ICS feed: 30-min default, Europe/Zurich, correct Swiss day; blocker calendar.');
