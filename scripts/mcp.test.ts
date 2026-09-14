// Proves #88 (TC-A11): die reine Logik des MCP-Servers — Tagesplan-Gruppierung,
// Nummernvergabe, Projektnamen-Auflösung, Planen ⇒ Stern, Task-Adressierung,
// Umgebungs-Erkennung. Kein Netz, kein Server.
// Run: npx tsx scripts/mcp.test.ts
import assert from 'node:assert';
import {
  buildNewTask, completePatch, dateKey, dateKeyToIso, envKind, findTask, formatTaskLine,
  groupDayPlan, inboxTasks, LogicError, nextSteps, nextTaskNumber, newTaskId, planPatch,
  resolveCategories, resolveProject, searchTasks, tasksOfProject, unplanPatch,
  type ApiProject, type ApiTask,
} from '../apps/mcp/src/logic';

const iso = (key: string) => dateKeyToIso(key);
const base: ApiTask = {
  id: 'x', number: 0, title: '', description: '', projectId: null, dueDate: null,
  priority: 'medium', categoryIds: [], completed: false, starred: false, createdAt: '2026-01-01T00:00:00.000Z',
};
const task = (p: Partial<ApiTask>): ApiTask => ({ ...base, ...p });

const projects: ApiProject[] = [
  { id: 'p-web', name: 'Website Relaunch', kind: 'project', active: true },
  { id: 'p-web2', name: 'Website Wartung', kind: 'project', active: false },
  { id: 'p-fin', name: 'Finanzen', kind: 'area', active: true },
  { id: 'p-old', name: 'Altes Projekt', kind: 'project', active: true, archived: true },
];

// ── Projektnamen-Auflösung ────────────────────────────────────────────────
assert.equal(resolveProject(projects, { name: 'finanzen' }).id, 'p-fin', 'exakt, case-insensitiv');
assert.equal(resolveProject(projects, { name: 'Relaunch' }).id, 'p-web', 'Teiltreffer eindeutig');
assert.equal(resolveProject(projects, { id: 'p-web2' }).id, 'p-web2', 'per id');
assert.throws(() => resolveProject(projects, { name: 'Website' }), (e: unknown) => e instanceof LogicError && /mehrdeutig/.test((e as Error).message) && /Website Relaunch/.test((e as Error).message), 'mehrdeutig → Kandidaten');
assert.throws(() => resolveProject(projects, { name: 'Gibtsnicht' }), /nicht gefunden/, 'unbekannt');
assert.throws(() => resolveProject(projects, { name: 'Altes Projekt' }), /nicht gefunden/, 'archiviert ist unsichtbar');
assert.throws(() => resolveProject(projects, {}), /projektId oder projektName/, 'keine Referenz');

// ── Kategorien ────────────────────────────────────────────────────────────
const cats = [{ id: 'c1', name: 'Büro' }, { id: 'c2', name: 'Telefon' }];
assert.deepEqual(resolveCategories(cats, ['büro', 'Telefon']), ['c1', 'c2']);
assert.throws(() => resolveCategories(cats, ['Auto']), /Kategorie „Auto" nicht gefunden/);

// ── Nummernvergabe & Task-Objekt ──────────────────────────────────────────
assert.equal(nextTaskNumber([]), 1, 'leere DB → 1');
assert.equal(nextTaskNumber([task({ number: 7 }), task({ number: 42 }), task({ number: 3 })]), 43, 'max+1');
assert.match(newTaskId(1_000_000, 0.5), /^task-[0-9a-z]+-[0-9a-z]+$/, 'id im Store-Format');

const now = new Date(2026, 8, 14, 10, 0, 0);
const created = buildNewTask(
  { title: '  Angebot schreiben ', projectId: 'p-web', dueKey: '2026-09-16', priority: 'high', categoryIds: ['c1'], planKey: '2026-09-15' },
  { number: 43, id: 'task-fix', now },
);
assert.equal(created.title, 'Angebot schreiben', 'Titel getrimmt');
assert.equal(created.number, 43);
assert.equal(created.projectId, 'p-web');
assert.equal(created.dueDate, iso('2026-09-16'), 'Fälligkeit = lokale Mitternacht als ISO');
assert.equal(created.todayDate, '2026-09-15');
assert.equal(created.starred, true, 'planenFuer ⇒ ★ (App-Invariante)');
assert.equal(created.someday, false);
assert.deepEqual(created.assigneeIds, ['u-me']);
assert.equal(created.recurrence, 'none');
assert.equal(created.completed, false);
const plain = buildNewTask({ title: 'Ohne alles' }, { number: 1, id: 't', now });
assert.equal(plain.starred, false, 'ohne Planung kein Stern');
assert.equal(plain.projectId, null, 'ohne Projekt → Inbox');
assert.equal(plain.priority, 'medium');
assert.throws(() => buildNewTask({ title: '   ' }, { number: 1 }), /Titel darf nicht leer/);
assert.throws(() => buildNewTask({ title: 'x', planKey: 'morgen' }, { number: 1 }), /Ungültiges Datum/);
assert.throws(() => buildNewTask({ title: 'x', dueKey: '2026-02-30' }, { number: 1 }), /Ungültiges Datum/, 'Kalender-Plausibilität');

// ── Patches ───────────────────────────────────────────────────────────────
assert.deepEqual(planPatch('2026-09-15'), { todayDate: '2026-09-15', starred: true, someday: false }, 'planen ⇒ ★, kein Someday');
assert.throws(() => planPatch('15.09.2026'), /Ungültiges Datum/);
assert.deepEqual(unplanPatch(), { todayDate: null });
const done = completePatch(true, now);
assert.equal(done.completed, true);
assert.equal(done.completedAt, now.toISOString());
assert.deepEqual(completePatch(false), { completed: false, completedAt: null });

// ── Tagesplan ─────────────────────────────────────────────────────────────
const today = '2026-09-14';
const tomorrow = '2026-09-15';
const tasks: ApiTask[] = [
  task({ id: 'a', number: 1, title: 'Geplant heute', todayDate: today, starred: true }),
  task({ id: 'b', number: 2, title: 'Fällig heute', dueDate: iso(today) }),
  task({ id: 'c', number: 3, title: 'Geplant + fällig heute', todayDate: today, dueDate: iso(today) }),
  task({ id: 'd', number: 4, title: 'Überfällig', dueDate: iso('2026-09-10') }),
  task({ id: 'e', number: 5, title: 'Geplant morgen', todayDate: tomorrow }),
  task({ id: 'f', number: 6, title: 'Fällig morgen', dueDate: iso(tomorrow) }),
  task({ id: 'g', number: 7, title: 'Erledigt, wäre überfällig', dueDate: iso('2026-09-01'), completed: true }),
  task({ id: 'h', number: 8, title: 'Nichts' }),
];
const planToday = groupDayPlan(tasks, today, today);
assert.deepEqual(planToday.geplant.map((t) => t.id), ['a', 'c']);
assert.deepEqual(planToday.faellig.map((t) => t.id), ['b'], 'c ist schon in geplant (jeder Task genau einmal)');
assert.deepEqual(planToday.ueberfaellig.map((t) => t.id), ['d'], 'erledigte zählen nicht');
const planTomorrow = groupDayPlan(tasks, tomorrow, today);
assert.deepEqual(planTomorrow.geplant.map((t) => t.id), ['e']);
assert.deepEqual(planTomorrow.faellig.map((t) => t.id), ['f']);
assert.deepEqual(planTomorrow.ueberfaellig, [], 'Zukunft: keine Überfällig-Gruppe');
assert.throws(() => groupDayPlan(tasks, 'morgen', today), /Ungültiges Datum/);

// ── Projekt-Tasks, Nächste Schritte, Inbox, Suche ─────────────────────────
const pt: ApiTask[] = [
  task({ id: 'p1', number: 10, title: 'Zweiter', projectId: 'p-web', sortOrder: 2 }),
  task({ id: 'p2', number: 11, title: 'Erster ★', projectId: 'p-web', sortOrder: 1, starred: true }),
  task({ id: 'p3', number: 12, title: 'Someday ★', projectId: 'p-web', sortOrder: 3, starred: true, someday: true }),
  task({ id: 'p4', number: 13, title: 'Erledigt', projectId: 'p-web', completed: true }),
  task({ id: 'p5', number: 14, title: 'Anderes Projekt', projectId: 'p-fin', starred: true }),
  task({ id: 'i1', number: 15, title: 'Inbox-Sache mit Rechnung', description: '' }),
  task({ id: 'i2', number: 16, title: 'Geparkt', someday: true }),
  task({ id: 'i3', number: 17, title: 'Beschreibungstreffer', description: 'Rechnung prüfen', projectId: 'p-fin' }),
];
assert.deepEqual(tasksOfProject(pt, 'p-web').map((t) => t.id), ['p2', 'p1', 'p3'], 'App-Reihenfolge, offen');
assert.deepEqual(tasksOfProject(pt, 'p-web', true).map((t) => t.id), ['p4', 'p2', 'p1', 'p3'], 'inkl. erledigte');
assert.deepEqual(nextSteps(pt, 'p-web').map((t) => t.id), ['p2'], 'nur ★, nicht Someday, nur dieses Projekt');
assert.deepEqual(nextSteps(pt, 'p-old'), [], 'leer ohne ★');
assert.deepEqual(inboxTasks(pt).map((t) => t.id), ['i1'], 'ohne Projekt, nicht Someday');
assert.deepEqual(searchTasks(pt, 'rechnung').map((t) => t.id).sort(), ['i1', 'i3'], 'Titel + Beschreibung, case-insensitiv');
assert.deepEqual(searchTasks(pt, 'Erledigt'), [], 'Standard nur offene');
assert.equal(searchTasks(pt, 'Erledigt', true).length, 1);
assert.throws(() => searchTasks(pt, '  '), /Suchbegriff/);

// ── Task-Adressierung ─────────────────────────────────────────────────────
assert.equal(findTask(pt, { number: 11 }).id, 'p2');
assert.equal(findTask(pt, { id: 'p1' }).id, 'p1');
assert.throws(() => findTask(pt, { number: 999 }), /Task #999 nicht gefunden/);
assert.throws(() => findTask(pt, {}), /taskId oder taskNummer/);

// ── Umgebung & Darstellung ────────────────────────────────────────────────
assert.equal(envKind('http://localhost:3002'), 'dev');
assert.equal(envKind('http://192.168.8.50:3001'), 'prod');
assert.equal(envKind('http://example.org'), 'unbekannt');
assert.equal(envKind('kaputt'), 'unbekannt');
assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05');
const line = formatTaskLine(task({ number: 42, title: 'Angebot', starred: true, priority: 'high', dueDate: iso('2026-09-10') }), 'Website', today);
assert.equal(line, '★ #42 Angebot (Website, fällig 10.09.2026 (überfällig), hoch)');

console.log('mcp.test.ts: alle Prüfungen bestanden ✔');
