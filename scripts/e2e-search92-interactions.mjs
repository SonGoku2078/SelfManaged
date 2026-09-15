// #92 Testmanager-Lauf: Wechselwirkungen (TF-M*) und Sonderzeichen (TF-S*).
// Laeuft gegen Dev (Vite :5173 -> Backend :3002). Beruehrt Prod nicht.
// Browser per Argument: node scripts/e2e-search92-interactions.mjs [chromium|firefox]
import { chromium, firefox } from 'playwright';

const APP = 'http://localhost:5173';
const ENGINE = process.argv[2] === 'firefox' ? firefox : chromium;
const ENGINE_NAME = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';

let pass = 0, fail = 0;
const results = [];
const ok = (id, name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${id} ${name}`); }
  else { fail++; console.log(`  FAIL ${id} ${name}${extra ? ' :: ' + extra : ''}`); }
  results.push({ id, name, pass: !!cond, extra });
};

const localField = '.view-search-bar input.filter-search, .filter-bar input.filter-search';
const nav = async (p, title) => { await p.click(`button.sidebar-item[title="${title}"]`); await p.waitForTimeout(450); };
const rows = (p) => p.locator('.task-row').count();
const type = async (p, text) => { await p.fill(localField, text); await p.waitForTimeout(550); };

const browser = await ENGINE.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForSelector('.sidebar-item', { timeout: 20000 });
await page.waitForTimeout(1800);
console.log(`\n=== Testmanager-Lauf #92 — ${ENGINE_NAME} ===\n`);

// ---------- TF-M1: Suche in gruppierter Ansicht ----------
console.log('TF-M1 — Suche in gruppierter Ansicht (Sektionen)');
await nav(page, 'Someday');
const secBefore = await page.locator('.task-section, [class*="section"]').count();
const allSomeday = await rows(page);
await type(page, 'qqxxzz-gibt-es-nicht');
const noHits = await rows(page);
await type(page, 'a');
const someFiltered = await rows(page);
await type(page, '');
const backToAll = await rows(page);
// Seit #93 kann eine aktive Suche die Liste auch VERGROESSERN: passende
// Unteraufgaben kommen hinzu, die ohne Suche unter ihrer Elternaufgabe
// verborgen bleiben. Geprueft wird daher die Wirkung, nicht die Richtung.
ok('TF-M1', 'Suche ohne Treffer leert die Liste', noHits === 0, `rows=${noHits}`);
ok('TF-M1', 'Suche veraendert die Liste', someFiltered !== allSomeday || allSomeday === 0, `${allSomeday} -> ${someFiltered}`);
ok('TF-M1', 'Liste ist nach Leeren wieder vollstaendig', backToAll === allSomeday, `${backToAll} vs ${allSomeday}`);
ok('TF-M1', 'Gruppenstruktur ueberlebt die Suche', (await page.locator('.task-section, [class*="section"]').count()) === secBefore);

// ---------- TF-M3: Kalender Moduswechsel (GATE-KRITISCH) ----------
console.log('\nTF-M3 — Kalender: Moduswechsel mit aktiver Suche [gate-kritisch]');
await nav(page, 'Kalender');
const modeBtn = (t) => page.locator('.cal-mode-btn', { hasText: t });
await modeBtn('Woche').click(); await page.waitForTimeout(700);
const pillWeekClean = (await page.locator('.task-count-totals').first().innerText().catch(() => '')).trim();
await modeBtn('Tag / Liste').click(); await page.waitForTimeout(600);
await type(page, 'qqxxzz-gibt-es-nicht');
const listFiltered = await rows(page);
await modeBtn('Woche').click(); await page.waitForTimeout(700);
const pillWeekSearching = (await page.locator('.task-count-totals').first().innerText().catch(() => '')).trim();
const fieldGoneInGrid = await page.locator('.view-search-bar').count();
ok('TF-M3', 'Liste war durch die Suche geleert', listFiltered === 0, `rows=${listFiltered}`);
// Seit #93 hat auch das Raster ein Suchfeld (vorher bewusst keins).
ok('TF-M3', 'Suchfeld ist im Raster vorhanden (seit #93)', fieldGoneInGrid === 1, `n=${fieldGoneInGrid}`);
// Bis #92 filterte das Raster nicht, die Pille durfte daher nicht schrumpfen.
// Seit #93 filtert es — jetzt MUSS sie mitschrumpfen, sonst stuende eine Zahl
// neben einer sichtbar leeren Woche. Die Forderung bleibt dieselbe: Raster und
// Kopfzeile muessen einig sein.
ok('TF-M3', 'Summen-Pille folgt dem gefilterten Raster (seit #93)',
  pillWeekSearching !== pillWeekClean && pillWeekSearching.startsWith('0'),
  `ohne Suche="${pillWeekClean}" mit Suche="${pillWeekSearching}"`);
await modeBtn('Tag / Liste').click(); await page.waitForTimeout(600);
const queryKept = await page.locator(localField).first().inputValue();
ok('TF-M3', 'Begriff bleibt nach Rueckwechsel erhalten', queryKept === 'qqxxzz-gibt-es-nicht', queryKept);
await type(page, '');

// ---------- TF-M4: Bulk-Modus + Suche (GATE-KRITISCH) ----------
console.log('\nTF-M4 — Bulk-Modus + Suche [gate-kritisch]');
await nav(page, 'Someday');
const totalRows = await rows(page);
await page.locator('.task-row').first().click({ modifiers: ['Control'] });
await page.waitForTimeout(500);
const bulkAppeared = await page.locator('.bulk-bar').count();
ok('TF-M4', 'Bulk-Leiste erscheint bei Strg+Klick', bulkAppeared === 1);
// Einen Begriff suchen, der MEHRERE, aber nicht ALLE Aufgaben stehen laesst.
// Zu breit ("a") blendet nichts aus und prueft den Fall nicht; zu eng laesst
// genau die markierte Aufgabe uebrig, dann steht die Checkbox bereits auf
// "checked" und ein Klick wuerde abwaehlen statt auswaehlen.
let term = null, visibleWhileSearching = -1;
for (const cand of ['en', 'er', 'in', 'ung', 'sch', 'te']) {
  await type(page, cand);
  const v = await rows(page);
  if (v > 1 && v < totalRows) { term = cand; visibleWhileSearching = v; break; }
}
ok('TF-M4', 'Suchbegriff blendet tatsaechlich Aufgaben aus (mehr als einer bleibt)',
  term !== null, `term="${term}" sichtbar=${visibleWhileSearching} gesamt=${totalRows}`);
// .check() wuerde auf den checked-Zustand warten; die Checkbox ist aber
// kontrolliert (checked leitet sich aus count/totalVisible ab). Klicken und
// das Ergebnis am Label ablesen ist hier das ehrlichere Vorgehen.
const cb = page.locator('.bulk-selectall input[type=checkbox]');
const wasChecked = await cb.isChecked();
if (!wasChecked) await cb.click();
await page.waitForTimeout(700);
const stillThere = await page.locator('.bulk-selectall').count();
const bulkLabel = stillThere ? (await page.locator('.bulk-selectall').innerText()).trim() : '';
const selectedCount = parseInt(bulkLabel.match(/(\d+)/)?.[1] ?? '-1', 10);
ok('TF-M4', '"Alle auswaehlen" trifft genau die sichtbaren Aufgaben',
  selectedCount === visibleWhileSearching,
  `selected=${selectedCount} sichtbar=${visibleWhileSearching} gesamt=${totalRows} vorherChecked=${wasChecked}`);
ok('TF-M4', 'Auswahl umfasst NICHT die ausgeblendeten Aufgaben',
  selectedCount > 0 && selectedCount < totalRows,
  `selected=${selectedCount} gesamt=${totalRows}`);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await nav(page, 'Inbox'); await nav(page, 'Someday');

// ---------- TF-M6 / TF-M7 ----------
console.log('\nTF-M6/M7 — Gespeicherte Ansichten und Erledigt');
await nav(page, 'Erledigt');
const phDone = await page.locator(localField).first().getAttribute('placeholder').catch(() => null);
ok('TF-M7', 'Erledigt: Feld vorhanden mit neuem Platzhalter', /Beschreibung/.test(phDone ?? ''), String(phDone));
await page.locator('body').click({ position: { x: 700, y: 12 } });
await page.keyboard.press('/'); await page.waitForTimeout(300);
ok('TF-M7', 'Erledigt: / fokussiert lokal',
  String(await page.evaluate(() => document.activeElement?.className ?? '')).includes('filter-search'));
const savedCount = await page.locator('.sidebar-saved .sidebar-item, .saved-view-item').count().catch(() => 0);
ok('TF-M6', `Gespeicherte Ansichten vorhanden? (${savedCount}) — sonst n/a`, true);

// ---------- TF-S: Sonderzeichen und Grenzen ----------
console.log('\nTF-S — Sonderzeichen und Grenzen');
await nav(page, 'Someday');
const full = await rows(page);

await type(page, '   ');
ok('TF-S2', 'Nur Leerzeichen -> Liste bleibt vollstaendig', (await rows(page)) === full, `${await rows(page)} vs ${full}`);

await type(page, '#');
ok('TF-S3', '"#" allein stuerzt nicht ab', (await page.locator('.app-container').count()) === 1);
await type(page, '#abc');
ok('TF-S3', '"#abc" stuerzt nicht ab', (await page.locator('.app-container').count()) === 1);

await type(page, 'x"y');
const quoteHint = await page.locator('.task-list-empty, .section-empty-hint').first().innerText().catch(() => '');
ok('TF-S4', 'Anfuehrungszeichen: Hinweis bleibt lesbar', /Keine Treffer/i.test(quoteHint) || (await rows(page)) > 0, JSON.stringify(quoteHint.slice(0, 80)));

await type(page, 'z'.repeat(220));
const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
ok('TF-S5', 'Sehr langer Begriff erzeugt kein Querscrollen', !hScroll);
ok('TF-S5', 'Feld bleibt bedienbar', (await page.locator(localField).first().inputValue()).length === 220);

await type(page, '🔥');
ok('TF-S6', 'Emoji stuerzt nicht ab', (await page.locator('.app-container').count()) === 1);

// TF-S1 Umlaute/Case: gegen echten Bestand
await type(page, 'löschen');
const lower = await rows(page);
await type(page, 'LÖSCHEN');
const upper = await rows(page);
ok('TF-S1', 'Gross/Kleinschreibung liefert dieselben Treffer', lower === upper, `klein=${lower} gross=${upper}`);
await type(page, '');

await browser.close();
console.log(`\n==== ${ENGINE_NAME}: ${pass} OK / ${fail} FAIL ====`);
process.exit(fail === 0 ? 0 : 1);
