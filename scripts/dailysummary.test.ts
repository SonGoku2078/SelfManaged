// #116: the 08:00 summary lists the day's task NAMES (due that day or ☀️-pinned)
// and each upcoming morning gets its own content — not yesterday's count.
// Run: npx tsx scripts/dailysummary.test.ts
import assert from 'node:assert';
import { buildDailySummaries, SUMMARY_DAYS } from '../apps/mobile/src/dailySummary';
import { dateKey, addDays } from '../src/selectors';
import type { Task } from '../src/types';

const base: Task = {
  id: 'x', number: 0, title: '', description: '', projectId: null, dueDate: null,
  priority: 'medium', categoryIds: [], completed: false, createdAt: new Date(),
  updatedAt: new Date(), starred: false, recurrence: 'none',
};
let n = 0;
const task = (p: Partial<Task>): Task => ({ ...base, id: `t${++n}`, number: n, ...p });
const at = (d: Date, h: number, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);

const evening = at(new Date(2026, 9, 1), 21); // Do 1.10. 21:00 — last sync of the day
const tomorrow = addDays(at(evening, 0), 1);
const tasks = [
  task({ title: 'Wohnung aufräumen', todayDate: dateKey(evening) }), // ☀️ von heute → morgen weiter
  task({ title: 'Arzt', dueDate: at(tomorrow, 9, 30), startMinutes: 9 * 60 + 30 }),
  task({ title: 'Weekly schauen', dueDate: at(tomorrow, 0) }),
  task({ title: 'Erledigt', dueDate: at(tomorrow, 0), completed: true }),
  task({ title: 'Unteraufgabe', dueDate: at(tomorrow, 0), parentId: 't1' }),
  task({ title: 'Übermorgen', dueDate: addDays(tomorrow, 1) }),
];

const s = buildDailySummaries(tasks, evening);
assert.equal(s.length, SUMMARY_DAYS, 'one notification per upcoming morning');
assert.equal(new Set(s.map((x) => x.id)).size, SUMMARY_DAYS, 'distinct ids');
assert.equal(+s[0].at, +at(tomorrow, 8), 'first = tomorrow 08:00 (today 08:00 passed)');

// Morgen: 3 Aufgaben mit Namen; Uhrzeit-Task zuerst; Erledigte/Unteraufgaben nicht.
assert.equal(s[0].title, '📋 Heute: 3 Aufgaben');
assert.ok(s[0].body.includes('Arzt') && s[0].body.includes('Wohnung aufräumen') && s[0].body.includes('Weekly schauen'), s[0].body);
assert.equal(s[0].largeBody, '• 09:30  Arzt\n• Weekly schauen\n• Wohnung aufräumen', 'Uhrzeit zuerst, dann wie im Heute-Tab (datiert vor ☀️)');
assert.ok(!s[0].body.includes('Erledigt') && !s[0].body.includes('Unteraufgabe'));

// Übermorgen: eigener Inhalt (☀️ trägt weiter + der dann fällige Task).
assert.ok(s[1].body.includes('Übermorgen') && s[1].body.includes('Wohnung aufräumen') && !s[1].body.includes('Arzt'), s[1].body);

// Genau 1 Task → Name als Titel + Deeplink; 0 Tasks → Hinweis.
const one = buildDailySummaries([task({ title: 'Nur einer', dueDate: at(tomorrow, 0) })], evening)[0];
assert.equal(one.title, '📋 Nur einer'); assert.ok(one.taskId);
const none = buildDailySummaries([], evening)[0];
assert.ok(!none.taskId && /Keine Aufgaben/.test(none.body));

// Vor 08:00 → die erste Meldung ist heute.
const early = at(new Date(2026, 9, 2), 6);
assert.equal(+buildDailySummaries(tasks, early)[0].at, +at(early, 8));

// Viele Tasks → auf 8 Zeilen gekürzt.
const many = Array.from({ length: 11 }, (_, i) => task({ title: `T${i}`, dueDate: at(tomorrow, 0) }));
const big = buildDailySummaries(many, evening)[0];
assert.equal(big.largeBody!.split('\n').length, 9); assert.ok(big.largeBody!.endsWith('… und 3 weitere'));

console.log('✅ PASS — 08:00-Übersicht: Namen statt Zähler, je Morgen eigener Inhalt, ☀️ zählt mit.');

// ── #118: Erinnerung zur Startzeit, Vorlaufzeit zusätzlich, auch für Folgetage ──
import { buildTaskReminders } from '../apps/mobile/src/dailySummary';
{
  const morning = at(new Date(2026, 9, 2), 8); // Fr 2.10. 08:00
  const nextDay = addDays(morning, 1);
  const rem = [
    task({ title: 'Call', dueDate: at(morning, 0), startMinutes: 9 * 60 + 7 }), // heute 09:07
    task({ title: 'Morgen', dueDate: at(nextDay, 0), startMinutes: 9 * 60 + 7 }), // morgen 09:07
    task({ title: 'Vorbei', dueDate: at(morning, 0), startMinutes: 7 * 60 }), // heute 07:00 — vorbei
    task({ title: 'Ohne Zeit', dueDate: at(morning, 0) }),
    task({ title: 'Erledigt', dueDate: at(morning, 0), startMinutes: 10 * 60, completed: true }),
    task({ title: 'Weit weg', dueDate: addDays(morning, 30), startMinutes: 10 * 60 }),
  ];
  const noLead = buildTaskReminders(rem, 0, morning);
  assert.deepEqual(noLead.map((r) => [r.title, r.at.getHours(), r.at.getMinutes(), r.at.getDate()]),
    [['⏰ Call', 9, 7, 2], ['⏰ Morgen', 9, 7, 3]], 'zur Startzeit 09:07, heute + morgen; vergangene/ohne Zeit/erledigte/ferne nicht');
  assert.ok(noLead.every((r) => r.body.startsWith('Jetzt fällig')));

  const lead = buildTaskReminders(rem, 15, morning);
  const call = lead.filter((r) => r.title === '⏰ Call').map((r) => `${r.at.getHours()}:${r.at.getMinutes()}`);
  assert.deepEqual(call.sort(), ['8:52', '9:7'], 'Vorlaufzeit 15 Min: 08:52 ZUSÄTZLICH zu 09:07');
  assert.equal(new Set(lead.map((r) => r.id)).size, lead.length, 'eindeutige IDs');
  // Startzeit in < Vorlaufzeit: frühe Erinnerung entfällt, die zur Startzeit bleibt.
  const soon = buildTaskReminders([task({ title: 'Gleich', dueDate: at(morning, 0), startMinutes: 8 * 60 + 5 })], 15, morning);
  assert.deepEqual(soon.map((r) => r.body), ['Jetzt fällig (08:05)']);
  console.log('✅ PASS — Erinnerungen: zur Startzeit immer, Vorlaufzeit zusätzlich, Folgetage vorgeplant.');
}
