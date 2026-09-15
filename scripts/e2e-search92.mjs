// #92 Verifikation gegen Dev (Vite :5173 -> Backend :3002 / dev.db).
// Legt zwei eindeutig benannte Proben-Tasks an, prueft die ACs und raeumt auf.
import { chromium, firefox } from 'playwright';

const API = 'http://127.0.0.1:3002';
const APP = 'http://localhost:5173';
const TAG = 'ZZTEST92';
const ENGINE = process.argv[2] === 'firefox' ? firefox : chromium;
const ENGINE_NAME = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' :: ' + extra : ''}`); }
};

const base = (over) => ({
  projectId: null, parentId: null, sectionId: null, dueDate: null,
  startMinutes: null, durationMin: null, priority: 'medium', completed: false,
  starred: false, someday: false, thisWeek: false, waiting: false,
  waitingFor: null, todayDate: null, recurrence: 'none', recurrenceEnd: null,
  recurInterval: null, recurUnit: null, recurMonthDay: null, completedAt: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  nozbeId: null, sortOrder: 0, categoryIds: [], assigneeIds: [], comments: [],
  attachments: [], links: [], linkedProjectId: null, focusSeconds: 0,
  ...over,
});

const post = (t) => fetch(`${API}/api/tasks`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t),
}).then((r) => r.json());
const del = (id) => fetch(`${API}/api/tasks/${id}`, { method: 'DELETE' });

const nav = async (page, title) => {
  await page.click(`button.sidebar-item[title="${title}"]`);
  await page.waitForTimeout(400);
  if (title === 'Kalender') await ensureCalendarList(page);
};
const localField = '.view-search-bar input.filter-search, .filter-bar input.filter-search';

// calendarMode ist persistent — diese Suite prueft den Listenmodus und muss
// ihn daher aktiv herstellen, statt auf den zuletzt gespeicherten zu vertrauen.
const ensureCalendarList = async (page) => {
  const btn = page.locator('.cal-mode-btn', { hasText: 'Tag / Liste' });
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(700); }
};

const made = [];
try {
  made.push(await post(base({
    id: `${TAG.toLowerCase()}-someday`, number: 990001,
    title: `${TAG} Someday Suchprobe`, description: 'beschreibungstreffer-xyz', someday: true,
  })));
  made.push(await post(base({
    id: `${TAG.toLowerCase()}-inbox`, number: 990002,
    title: `${TAG} Inbox Suchprobe`, description: '',
  })));
  console.log(`Proben angelegt: ${made.length}\n`);

  const browser = await ENGINE.launch();
  console.log(`Engine: ${ENGINE_NAME}`);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sidebar-item', { timeout: 15000 });
  await page.waitForTimeout(1500); // erster Datenload

  // ---- AC1: Feld vorhanden in den drei Ansichten
  console.log('AC1 — Suchfeld vorhanden');
  for (const v of ['Next Week', 'Someday', 'Kalender']) {
    await nav(page, v);
    ok(`${v}: .view-search-bar vorhanden`, await page.locator('.view-search-bar input.filter-search').count() === 1);
  }

  // ---- AC2: Position identisch (direkt nach .quick-add)
  console.log('\nAC2 — Position unter Quick-Add');
  for (const v of ['Next Week', 'Someday', 'Kalender']) {
    await nav(page, v);
    ok(`${v}: quick-add + view-search-bar sind Nachbarn`,
      await page.locator('.quick-add + .view-search-bar').count() === 1);
  }
  await nav(page, 'Inbox');
  ok('Inbox: quick-add + filter-bar sind Nachbarn (Referenz)',
    await page.locator('.quick-add + .filter-bar').count() === 1);

  // ---- AC3: keine Filter-Controls
  console.log('\nAC3 — keine Filter-Controls');
  for (const v of ['Next Week', 'Someday', 'Kalender']) {
    await nav(page, v);
    const selects = await page.locator('.filter-select').count();
    const badge = await page.locator('.filter-active-badge').count();
    const toggle = await page.locator('.filter-toggle').count();
    ok(`${v}: keine .filter-select/.filter-active-badge/.filter-toggle`,
      selects === 0 && badge === 0 && toggle === 0, `select=${selects} badge=${badge} toggle=${toggle}`);
  }

  // ---- AC10: Platzhalter identisch
  console.log('\nAC10 — Platzhalter identisch und ehrlich');
  const ph = {};
  for (const v of ['Someday', 'Next Week', 'Kalender', 'Inbox', 'Heute']) {
    await nav(page, v);
    ph[v] = await page.locator(localField).first().getAttribute('placeholder');
  }
  const vals = [...new Set(Object.values(ph))];
  ok('Platzhalter in allen 5 Ansichten identisch', vals.length === 1, JSON.stringify(ph));
  ok('Platzhalter nennt Beschreibung/Person/Status', /Beschreibung/.test(vals[0] ?? '') && /Status/.test(vals[0] ?? ''), vals[0] ?? '');

  // ---- AC4 + AC5: topf-lokal + Suchumfang
  console.log('\nAC4/AC5 — topf-lokal + Suchumfang');
  await nav(page, 'Someday');
  await page.fill(localField, TAG);
  await page.waitForTimeout(600);
  let rows = await page.locator('.task-row, .task-item').filter({ hasText: TAG }).count();
  ok('Someday: findet die Someday-Probe', rows >= 1, `rows=${rows}`);
  const sawInbox = await page.locator('.task-row, .task-item').filter({ hasText: `${TAG} Inbox` }).count();
  ok('Someday: zeigt die Inbox-Probe NICHT (topf-lokal)', sawInbox === 0, `rows=${sawInbox}`);

  await nav(page, 'Someday');
  await page.fill(localField, 'beschreibungstreffer-xyz');
  await page.waitForTimeout(600);
  ok('AC5: Treffer ueber die Beschreibung',
    await page.locator('.task-row, .task-item').filter({ hasText: TAG }).count() >= 1);

  await nav(page, 'Someday');
  await page.fill(localField, '#990001');
  await page.waitForTimeout(600);
  ok('AC5: Treffer ueber die #Nummer',
    await page.locator('.task-row, .task-item').filter({ hasText: TAG }).count() >= 1);

  // ---- AC6: Reset beim Ansichtswechsel
  console.log('\nAC6 — Reset beim Wechsel');
  await nav(page, 'Someday');
  await page.fill(localField, TAG);
  await page.waitForTimeout(400);
  await nav(page, 'Next Week');
  ok('Next Week: Feld nach Wechsel leer', (await page.locator(localField).first().inputValue()) === '');
  await nav(page, 'Someday');
  ok('Someday: Feld nach Rueckwechsel leer', (await page.locator(localField).first().inputValue()) === '');

  // ---- AC7: Leerzustand
  console.log('\nAC7 — Leerzustand');
  await nav(page, 'Someday');
  await page.fill(localField, 'qqxxzz-gibt-es-nicht');
  await page.waitForTimeout(700);
  // Gruppierbare Ansichten (someday/nextweek) rendern den Hinweis als
  // .section-empty-hint, ungruppierte (Kalender) als .task-list-empty —
  // emptyHint speist beide Zweige (TaskList.tsx:169 bzw. :713).
  const emptySel = '.task-list-empty, .section-empty-hint';
  const emptyTxt = await page.locator(emptySel).first().innerText().catch(() => '');
  ok('Someday: Leer-Hinweis nennt "Keine Treffer"', /Keine Treffer/i.test(emptyTxt), JSON.stringify(emptyTxt.slice(0, 120)));
  ok('Someday: Leer-Hinweis nennt "in dieser Ansicht"', /in dieser Ansicht/i.test(emptyTxt));

  // Auch im ungruppierten Zweig pruefen (Kalender).
  await nav(page, 'Kalender');
  await page.fill(localField, 'qqxxzz-gibt-es-nicht');
  await page.waitForTimeout(700);
  const emptyCal = await page.locator(emptySel).first().innerText().catch(() => '');
  ok('Kalender: Leer-Hinweis nennt "Keine Treffer"', /Keine Treffer/i.test(emptyCal), JSON.stringify(emptyCal.slice(0, 120)));

  // ---- AC8: / fokussiert lokal
  console.log('\nAC8 — / fokussiert lokal');
  for (const v of ['Someday', 'Next Week', 'Kalender', 'Inbox']) {
    await nav(page, v);
    await page.locator('body').click({ position: { x: 700, y: 12 } });
    await page.keyboard.press('/');
    await page.waitForTimeout(250);
    const cls = await page.evaluate(() => document.activeElement?.className ?? '');
    ok(`${v}: Fokus im lokalen Suchfeld`, String(cls).includes('filter-search'), `activeElement=${cls}`);
  }
  await nav(page, 'Einstellungen');
  await page.keyboard.press('/');
  await page.waitForTimeout(500);
  ok('Einstellungen: / faellt auf globale Such-View zurueck',
    await page.locator('.search-bar input.search-input').count() === 1);

  // ---- AC9: kein Fokusdiebstahl
  console.log('\nAC9 — kein Fokusdiebstahl');
  await nav(page, 'Someday');
  const qa = page.locator('.quick-add input').first();
  await qa.click();
  await qa.type('abc/def');
  await page.waitForTimeout(250);
  const qaVal = await qa.inputValue();
  const stillQa = await page.evaluate(() => (document.activeElement?.closest('.quick-add') ? 'quick-add' : 'woanders'));
  ok('Fokus bleibt in Quick-Add', stillQa === 'quick-add', stillQa);
  ok('"/" landet als Zeichen im Feld', qaVal.includes('/'), qaVal);
  await qa.fill('');

  await browser.close();
} finally {
  for (const t of made) if (t?.id) await del(t.id).catch(() => {});
  const left = await fetch(`${API}/api/tasks`).then((r) => r.json())
    .then((d) => d.filter((x) => (x.title || '').includes(TAG)).length).catch(() => -1);
  console.log(`\nAufgeraeumt — verbliebene ${TAG}-Tasks: ${left}`);
}

console.log(`\n==== ERGEBNIS: ${pass} OK / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
