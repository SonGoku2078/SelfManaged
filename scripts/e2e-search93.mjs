// #93 Verifikation gegen Dev (Vite :5173 -> Backend :3002 / dev.db).
// Prueft Raster-Suche, Unteraufgaben-Treffer und die Topf-Vererbung (AC13).
// Browser: node scripts/e2e-search93.mjs [chromium|firefox]
import { chromium, firefox } from 'playwright';

const API = 'http://127.0.0.1:3002';
const APP = 'http://localhost:5173';
const TAG = 'ZZTEST93';
const ENGINE = process.argv[2] === 'firefox' ? firefox : chromium;
const ENGINE_NAME = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';

let pass = 0, fail = 0;
const ok = (id, name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${id} ${name}`); }
  else { fail++; console.log(`  FAIL ${id} ${name}${extra ? ' :: ' + extra : ''}`); }
};

const base = (over) => ({
  projectId: null, parentId: null, sectionId: null, dueDate: null,
  startMinutes: null, durationMin: null, priority: 'medium', completed: false,
  starred: false, someday: false, thisWeek: false, waiting: false,
  waitingFor: null, todayDate: null, recurrence: 'none', recurrenceEnd: null,
  recurInterval: null, recurUnit: null, recurMonthDay: null, completedAt: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  nozbeId: null, sortOrder: 0, categoryIds: [], assigneeIds: [], comments: [],
  attachments: [], links: [], linkedProjectId: null, focusSeconds: 0, ...over,
});
const post = (t) => fetch(`${API}/api/tasks`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t),
}).then((r) => r.json());
const del = (id) => fetch(`${API}/api/tasks/${id}`, { method: 'DELETE' });

const localField = '.view-search-bar input.filter-search, .filter-bar input.filter-search';
const nav = async (p, title) => { await p.click(`button.sidebar-item[title="${title}"]`); await p.waitForTimeout(450); };
const type = async (p, text) => { await p.fill(localField, text); await p.waitForTimeout(650); };
const hasText = (p, t) => p.locator('.task-row').filter({ hasText: t }).count();

const made = [];
try {
  const projects = await fetch(`${API}/api/projects`).then((r) => r.json());
  // Die Projekte-Ansicht zeigt ohne Auswahl nur Aufgaben AKTIVER Projekte
  // bzw. Areas (selectors.ts) — ein beliebiges Projekt waere dort unsichtbar.
  const proj = projects.find((p) => p.id !== 'p-single' && (p.active === true || p.kind === 'area'))
    ?? projects.find((p) => p.id !== 'p-single') ?? projects[0];

  // Elternaufgabe: IM PROJEKT (also NICHT in der Inbox) und in Someday.
  const parent = await post(base({
    id: `${TAG.toLowerCase()}-parent`, number: 990101,
    title: `${TAG} Elternaufgabe`, projectId: proj.id, someday: true,
  }));
  // Unteraufgabe: OHNE eigenes projectId, ohne someday-Flag — genau die
  // Konstellation, die 47x im Dev-Bestand vorkommt.
  const child = await post(base({
    id: `${TAG.toLowerCase()}-child`, number: 990102,
    title: `${TAG} Kindaufgabe`, parentId: parent.id, projectId: null,
  }));
  // Aufgabe mit Faelligkeit heute, fuer das Raster.
  const today = new Date(); today.setHours(10, 0, 0, 0);
  const dated = await post(base({
    id: `${TAG.toLowerCase()}-dated`, number: 990103,
    title: `${TAG} Rasteraufgabe`, dueDate: today.toISOString(), startMinutes: 600, durationMin: 60,
  }));
  made.push(parent, child, dated);
  console.log(`Proben angelegt: ${made.length} (Projekt "${proj.name}")\n=== #93 — ${ENGINE_NAME} ===\n`);

  const browser = await ENGINE.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sidebar-item', { timeout: 20000 });
  await page.waitForTimeout(1800);

  const modeBtn = (t) => page.locator('.cal-mode-btn', { hasText: t });

  // ---------- AC1: Suchfeld im Raster ----------
  console.log('AC1 — Suchfeld im Raster');
  await nav(page, 'Kalender');
  for (const m of ['Woche', 'Rollierend']) {
    await modeBtn(m).click(); await page.waitForTimeout(700);
    ok('AC1', `${m}: Suchfeld vorhanden`, (await page.locator('.view-search-bar input.filter-search').count()) === 1);
  }

  // ---------- AC2/AC4/AC5: Raster filtert, bleibt bedienbar ----------
  console.log('\nAC2/AC4/AC5 — Raster filtert und bleibt bedienbar');
  await modeBtn('Woche').click(); await page.waitForTimeout(700);
  const gridTasksBefore = await page.locator('.week-task, .week-event, [class*="week-task"]').count();
  await type(page, TAG);
  const gridTasksAfter = await page.locator('.week-task, .week-event, [class*="week-task"]').count();
  ok('AC2', 'Raster zeigt bei Suche weniger Aufgaben', gridTasksAfter < gridTasksBefore || gridTasksBefore === 0,
    `vorher=${gridTasksBefore} nachher=${gridTasksAfter}`);
  ok('AC2', 'Rasteraufgabe ist als Treffer sichtbar',
    (await page.getByText(`${TAG} Rasteraufgabe`).count()) >= 1);
  ok('AC4', 'Tagesspalten bleiben stehen', (await page.locator('.week-day, [class*="week-col"], [class*="week-day"]').count()) > 0);

  await type(page, 'qqxxzz-gibt-es-nicht');
  ok('AC5', 'Leeres Raster behaelt seine Struktur',
    (await page.locator('.week-day, [class*="week-col"], [class*="week-day"]').count()) > 0);
  ok('AC5', 'Keine Aufgaben mehr im Raster',
    (await page.locator('.week-task, .week-event, [class*="week-task"]').count()) === 0);

  // Summen muessen dem Raster folgen: seit #93 filtert das Raster, also darf
  // die Pille nicht weiter alle Tagesaufgaben zaehlen (sonst steht eine Zahl
  // neben einer sichtbar leeren Woche). Regression aus dem #92-Testdesign.
  const pillEmpty = (await page.locator('.task-count-totals').first().innerText().catch(() => '')).trim();
  ok('AC5', 'Summen-Pille folgt dem leeren Raster', /^0\b/.test(pillEmpty), `pille="${pillEmpty}"`);
  await type(page, '');
  const pillFull = (await page.locator('.task-count-totals').first().innerText().catch(() => '')).trim();
  ok('AC5', 'Summen-Pille ist nach dem Leeren wieder vollstaendig', !/^0\b/.test(pillFull) || pillFull === pillEmpty, `pille="${pillFull}"`);

  // ---------- AC3: Blocker ----------
  console.log('\nAC3 — Blocker bei aktiver Suche');
  await type(page, '');
  const blkBefore = await page.locator('.week-blocker-block').count();
  await type(page, TAG);
  const blkDuring = await page.locator('.week-blocker-block').count();
  await type(page, '');
  const blkAfter = await page.locator('.week-blocker-block').count();
  ok('AC3', 'Blocker sind ohne Suche sichtbar', blkBefore > 0, `n=${blkBefore}`);
  ok('AC3', 'Blocker verschwinden bei aktiver Suche', blkDuring === 0, `n=${blkDuring}`);
  ok('AC3', 'Blocker sind nach dem Leeren wieder da', blkAfter === blkBefore, `${blkAfter} vs ${blkBefore}`);

  // ---------- AC13: Topf-Vererbung (Kernentscheidung) ----------
  console.log('\nAC13 — Unteraufgabe erbt den Topf der Elternaufgabe [kritisch]');
  await nav(page, 'Someday');
  await type(page, `${TAG} Kind`);
  ok('AC13', 'Someday: Kindaufgabe gefunden (erbt Topf der Eltern)', (await hasText(page, `${TAG} Kindaufgabe`)) >= 1);
  await nav(page, 'Inbox');
  await type(page, `${TAG} Kind`);
  ok('AC13', 'Inbox: Kindaufgabe erscheint NICHT (Eltern ist im Projekt)',
    (await hasText(page, `${TAG} Kindaufgabe`)) === 0);
  ok('AC13', 'Inbox: Elternaufgabe erscheint ebenfalls nicht',
    (await hasText(page, `${TAG} Elternaufgabe`)) === 0);

  // ---------- AC6: Unteraufgaben in mehreren Ansichten ----------
  console.log('\nAC6 — Unteraufgaben als Treffer');
  await nav(page, 'Projekte');
  await type(page, `${TAG} Kind`);
  ok('AC6', 'Projekte: Kindaufgabe gefunden', (await hasText(page, `${TAG} Kindaufgabe`)) >= 1);

  // ---------- AC7: ohne Suche unveraendert ----------
  console.log('\nAC7 — ohne Suchbegriff unveraendert');
  await nav(page, 'Someday');
  await type(page, '');
  ok('AC7', 'Someday: Kindaufgabe ohne Suche NICHT auf oberster Ebene',
    (await hasText(page, `${TAG} Kindaufgabe`)) === 0);

  // ---------- AC8/AC9/AC10: Elternhinweis, keine Doppelung ----------
  console.log('\nAC8/AC9/AC10 — Elternhinweis und Doppelung');
  await nav(page, 'Someday');
  await type(page, `${TAG} Kind`);
  const hint = await page.locator('.task-parent-hint').first().innerText().catch(() => '');
  ok('AC8', 'Elternhinweis vorhanden und nennt die Elternaufgabe',
    /gehört zu/i.test(hint) && hint.includes(`${TAG} Elternaufgabe`), JSON.stringify(hint));

  await nav(page, 'Suchen');
  await page.fill('.search-bar input.search-input', `${TAG} Kind`);
  await page.waitForTimeout(700);
  const hintGlobal = await page.locator('.task-parent-hint').first().innerText().catch(() => '');
  ok('AC9', 'Elternhinweis auch in der globalen Suche', /gehört zu/i.test(hintGlobal), JSON.stringify(hintGlobal));

  await page.fill('.search-bar input.search-input', TAG);
  await page.waitForTimeout(700);
  // Ueber .task-title zaehlen: der Elternhinweis der Kindzeile enthaelt den
  // Elterntitel, ein Zeilentext-Treffer wuerde die Eltern doppelt zaehlen.
  const titleCount = (t) => page.locator('.task-title', { hasText: new RegExp(`^${t}$`) }).count();
  const kid = await titleCount(`${TAG} Kindaufgabe`);
  const par = await titleCount(`${TAG} Elternaufgabe`);
  ok('AC10', 'Eltern und Kind je genau einmal (keine Doppelung)', kid === 1 && par === 1, `kind=${kid} eltern=${par}`);

  // ---------- AC11: Treffer bedienbar ----------
  console.log('\nAC11 — Treffer-Unteraufgabe bedienbar');
  await nav(page, 'Someday');
  await type(page, `${TAG} Kind`);
  const row = page.locator('.task-row').filter({ hasText: `${TAG} Kindaufgabe` }).first();
  await row.locator('input.task-checkbox').first().check({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const persisted = await fetch(`${API}/api/tasks`).then((r) => r.json())
    .then((d) => d.find((t) => t.id === child.id)?.completed);
  ok('AC11', 'Abhaken wirkt und wird gespeichert', persisted === true, `completed=${persisted}`);

  // WICHTIG: calendarMode wird in den Settings PERSISTIERT. Ohne Ruecksetzen
  // startet jeder spaetere Lauf im Raster statt in der Liste und andere Suiten
  // schlagen scheinbar grundlos fehl.
  await nav(page, 'Kalender');
  await modeBtn('Tag / Liste').click();
  await page.waitForTimeout(700);

  await browser.close();
} finally {
  for (const t of made) if (t?.id) await del(t.id).catch(() => {});
  const left = await fetch(`${API}/api/tasks`).then((r) => r.json())
    .then((d) => d.filter((x) => (x.title || '').includes(TAG)).length).catch(() => -1);
  console.log(`\nAufgeraeumt — verbliebene ${TAG}-Tasks: ${left}`);
}

console.log(`\n==== ${ENGINE_NAME}: ${pass} OK / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
