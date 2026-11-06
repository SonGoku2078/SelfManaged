// ICS feeds read only what ends up in the calendar (Appwrite usage, 2026-11).
// Run: npx tsx scripts/ics-reads.test.ts
import assert from 'node:assert';
// @ts-expect-error — plain JS Appwrite function, no type declarations
import { taskFeedRows, blockerFeedRows, blockersToIcs, COMPLETED_DAYS } from '../apps/functions/ics/src/main.js';
import { FakeTablesDb } from './fakeTablesDb';

const now = new Date('2026-11-04T12:00:00.000Z'); // Wednesday; week = Nov 2–8
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString();
const t = (id: string, p: Record<string, unknown>) => ({ legacyId: id, title: id, projectId: 'p1', parentId: null, completed: false, thisWeek: false, dueDate: null, starred: false, ...p });

const db = new FakeTablesDb(['tasks', 'projects', 'blockers']);
db.seed('projects', Array.from({ length: 150 }, (_, i) => ({ legacyId: `p${i + 1}`, name: `Projekt ${i + 1}` })));
db.seed('blockers', [{ legacyId: 'b1', projectId: 'p1', weekdays: [0, 2], startMinutes: 480, durationMin: 120 }]);
db.seed('tasks', [
  t('open-old', { dueDate: day(-400) }),
  t('open-future', { dueDate: day(30), projectId: 'p2' }),
  t('done-recent', { dueDate: day(-10), completed: true }),
  t('done-old', { dueDate: day(-(COMPLETED_DAYS + 5)), completed: true }),
  t('no-due', {}),
  t('week-due', { dueDate: day(1) }),
  t('week-flag', { thisWeek: true }),
  t('week-sub', { dueDate: day(1), parentId: 'week-due' }),
  t('next-week', { dueDate: day(8) }),
  t('other-project', { dueDate: day(1), projectId: 'p3' }),
  ...Array.from({ length: 1500 }, (_, i) => t(`filler${i}`, { completed: true, dueDate: null })),
]);

// ── Aufgaben-Feed ──
db.reads = 0;
const feed = await taskFeedRows(db, now);
const ids = feed.tasks.map((x: { legacyId: string }) => x.legacyId).sort();
assert.deepStrictEqual(ids, ['done-recent', 'next-week', 'open-future', 'open-old', 'other-project', 'week-due', 'week-sub'].sort());
assert.deepStrictEqual(feed.projects.map((p: { legacyId: string }) => p.legacyId).sort(), ['p1', 'p2', 'p3'], 'only referenced projects');
assert.strictEqual(db.reads, 7 + 3, `reads = rows in the calendar (${db.reads}), not 1'660 + 150`);

// ── Projektblocker-Feed ──
db.reads = 0;
const bl = await blockerFeedRows(db, now);
assert.deepStrictEqual(bl.tasks.map((x: { legacyId: string }) => x.legacyId).sort(), ['week-due', 'week-flag'], 'open top-level tasks of blocked projects in this week (+1 day slack)');
assert.ok(db.reads <= 1 + 1 + 3, `blocker feed reads ${db.reads}`);
const ics = blockersToIcs(bl.blockers, bl.projects, bl.tasks, now) as string;
assert.ok(ics.includes('week-due') && ics.includes('week-flag'), 'this week listed');
assert.ok(!ics.includes('next-week'), 'exact week filter still applied');

console.log('ics-reads tests passed');
