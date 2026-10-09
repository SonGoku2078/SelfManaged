// #131: (1) Ein offener wiederkehrender Task, dessen Serie heute einen Termin hat,
// gehört in Heute — so wie der ICS-Kalender ihn zeigt —, auch wenn das
// gespeicherte Fälligkeitsdatum schon zurückliegt (Weekly Review seit 28.08.
// offen: Proton zeigte ihn jeden Freitag, Heute nie).
// (2) Ansicht „Wiederkehrend" (Daueraufträge): jede Serie genau einmal.
// Run: npx tsx scripts/recurstoday.test.ts
import assert from 'node:assert';
import { recursOn } from '../src/recurrence';
import { countsAsToday, isDueOn, isImplicitToday, recurrenceLabel, selectRecurringSeries, selectVisibleTasks } from '../src/selectors';
import type { Task, UIState } from '../src/types';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
let n = 0;
const task = (over: Partial<Task> = {}): Task =>
  ({
    id: `t${++n}`, number: n, title: `T${n}`, description: '', projectId: null, categoryIds: [],
    priority: 'medium', dueDate: null, completed: false, starred: false, recurrence: 'none',
    createdAt: new Date(2026, 0, 1), updatedAt: new Date(2026, 0, 1), ...over,
  }) as Task;

// ── Weekly (der gemeldete Fall) ─────────────────────────────────────────────
const weekly = task({ title: 'Weekly Review Tasks', recurrence: 'weekly', dueDate: new Date(2026, 7, 28) }); // Fr 28.08.
assert.equal(recursOn(weekly, at(2026, 10, 9)), true, 'Fr 09.10. ist ein Serientermin (6 Wochen später)');
assert.equal(recursOn(weekly, at(2026, 10, 8)), false, 'Donnerstag nicht');
assert.equal(recursOn(weekly, at(2026, 8, 28)), false, 'gespeichertes Datum selbst entscheidet isSameDay, nicht recursOn');
assert.equal(recursOn(weekly, at(2026, 8, 21)), false, 'vor dem Start nie');
assert.equal(recursOn({ ...weekly, completed: true }, at(2026, 10, 9)), false, 'erledigt → nie');
assert.equal(recursOn({ ...weekly, recurrenceEnd: new Date(2026, 9, 1) }, at(2026, 10, 9)), false, 'nach Serienende nie');
assert.equal(recursOn(task({ dueDate: new Date(2026, 7, 28) }), at(2026, 10, 9)), false, 'nicht wiederkehrend → nie');

// ── Andere Rhythmen ─────────────────────────────────────────────────────────
const daily = task({ recurrence: 'daily', dueDate: new Date(2026, 9, 1) });
assert.equal(recursOn(daily, at(2026, 10, 9)), true, 'täglich');
const every3 = task({ recurrence: 'custom', recurUnit: 'day', recurInterval: 3, dueDate: new Date(2026, 9, 1) });
assert.equal(recursOn(every3, at(2026, 10, 7)), true, 'alle 3 Tage: +6');
assert.equal(recursOn(every3, at(2026, 10, 8)), false, 'alle 3 Tage: +7 nicht');
const biweekly = task({ recurrence: 'custom', recurUnit: 'week', recurInterval: 2, dueDate: new Date(2026, 8, 25) });
assert.equal(recursOn(biweekly, at(2026, 10, 9)), true, 'alle 2 Wochen: +14');
assert.equal(recursOn(biweekly, at(2026, 10, 2)), false, 'alle 2 Wochen: +7 nicht');
const monthly = task({ recurrence: 'monthly', dueDate: new Date(2026, 6, 9) });
assert.equal(recursOn(monthly, at(2026, 10, 9)), true, 'monatlich am 9.');
assert.equal(recursOn(monthly, at(2026, 10, 10)), false);
const on31 = task({ recurrence: 'monthly', dueDate: new Date(2026, 0, 31) });
assert.equal(recursOn(on31, at(2026, 2, 28)), false, 'RRULE überspringt Monate ohne den 31.');
assert.equal(recursOn(on31, at(2026, 3, 31)), true);
const last = task({ recurrence: 'custom', recurUnit: 'month', recurInterval: 1, recurMonthDay: 'last', dueDate: new Date(2026, 0, 31) });
assert.equal(recursOn(last, at(2026, 2, 28)), true, 'letzter Tag des Monats');
const first = task({ recurrence: 'custom', recurUnit: 'month', recurInterval: 1, recurMonthDay: 'first', dueDate: new Date(2026, 0, 1) });
assert.equal(recursOn(first, at(2026, 10, 1)), true, 'erster Tag des Monats');
const yearly = task({ recurrence: 'yearly', dueDate: new Date(2025, 9, 9) });
assert.equal(recursOn(yearly, at(2026, 10, 9)), true, 'jährlich');
assert.equal(recursOn(yearly, at(2026, 11, 9)), false);
// Sommerzeit-Wechsel (25.10.2026) verschiebt keine Wochentage.
const acrossDst = task({ recurrence: 'weekly', dueDate: new Date(2026, 9, 23) });
assert.equal(recursOn(acrossDst, at(2026, 10, 30)), true, 'über die Zeitumstellung');

// ── Heute-Ansicht & ☀️-Anzeige ──────────────────────────────────────────────
const today = new Date();
const weeksAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 42);
const overdueWeekly = task({ title: 'Weekly', recurrence: 'weekly', dueDate: weeksAgo });
const overdueOnce = task({ title: 'Einmalig überfällig', dueDate: weeksAgo });
const oddWeekly = task({ title: 'Anderer Wochentag', recurrence: 'weekly', dueDate: new Date(weeksAgo.getTime() - 86_400_000) });
assert.equal(isDueOn(overdueWeekly, today), true);
assert.equal(countsAsToday(overdueWeekly), true, '☀️ wird angezeigt');
assert.equal(isImplicitToday(overdueWeekly), true, 'implizit — nicht umschaltbar');

const ui = {
  currentView: 'today', selectedProjectId: null, selectedProjectIds: [], searchQuery: '',
  filters: { projectId: null, categoryId: null, priority: null, completed: null, assigneeId: null, dueFrom: null, dueTo: null },
  sortField: 'manual', sortDir: 'asc',
} as unknown as UIState;
const visible = selectVisibleTasks([overdueWeekly, overdueOnce, oddWeekly], ui).map((t) => t.title);
assert.deepEqual(visible, ['Weekly'], 'Heute: wiederkehrender Serientermin ja; einmalig überfällig + anderer Wochentag nein');

// ── Ansicht „Wiederkehrend" (Daueraufträge) ────────────────────────────────
const wrDone1 = task({ title: 'Weekly Review', projectId: 'm', recurrence: 'weekly', dueDate: new Date(2026, 7, 14), completed: true, completedAt: new Date(2026, 7, 14) });
const wrDone2 = task({ title: 'Weekly Review', projectId: 'm', recurrence: 'weekly', dueDate: new Date(2026, 7, 21), completed: true, completedAt: new Date(2026, 7, 21) });
const wrOpen = task({ title: 'Weekly Review', projectId: 'm', recurrence: 'weekly', dueDate: new Date(2026, 7, 28) });
const rent = task({ title: 'Miete', recurrence: 'monthly', dueDate: new Date(2026, 9, 1) });
const endedA = task({ title: 'Kurs', recurrence: 'weekly', dueDate: new Date(2026, 4, 1), completed: true, completedAt: new Date(2026, 4, 1) });
const endedB = task({ title: 'Kurs', recurrence: 'weekly', dueDate: new Date(2026, 4, 8), completed: true, completedAt: new Date(2026, 4, 8) });
const sameTitleOtherProject = task({ title: 'Weekly Review', projectId: 'x', recurrence: 'weekly', dueDate: new Date(2026, 9, 2) });
const sub = task({ title: 'Sub', recurrence: 'weekly', parentId: 'p', dueDate: new Date(2026, 9, 1) });
const once = task({ title: 'Einmalig', dueDate: new Date(2026, 9, 1) });
const series = selectRecurringSeries([wrDone1, wrDone2, wrOpen, rent, endedA, endedB, sameTitleOtherProject, sub, once]);
assert.deepEqual(series.map((t) => t.id), [endedB.id, wrOpen.id, rent.id, sameTitleOtherProject.id],
  'eine Zeile pro Serie: offene Instanz bzw. zuletzt erledigte; keine Subtasks, keine Einmal-Tasks; nach Termin');
const inView = selectVisibleTasks([wrDone1, wrDone2, wrOpen, rent, endedA, endedB], { ...ui, currentView: 'recurring' } as UIState);
assert.deepEqual(inView.map((t) => t.id), [wrOpen.id, rent.id, endedB.id], 'laufende oben, beendete Serie unten');

assert.equal(recurrenceLabel(weekly), 'wöchentlich');
assert.equal(recurrenceLabel(biweekly), 'alle 2 Wochen');
assert.equal(recurrenceLabel(last), 'monatlich (letzter Tag)');
assert.equal(recurrenceLabel(yearly), 'jährlich');
assert.equal(recurrenceLabel(task()), null);

console.log('recurstoday.test.ts: alle Prüfungen bestanden ✔');
