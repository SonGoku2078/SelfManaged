// Runs the automated test suites + builds and records each result in the
// central test-case database (docs/testcases.json), which the 🧪 Testreport
// view renders as the pre-deploy approval page.
// Usage: node scripts/run-tests.mjs [--skip-builds]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'docs', 'testcases.json');
const skipBuilds = process.argv.includes('--skip-builds');

const AUTO_CASES = [
  { id: 'TC-A01', cmd: 'npx tsx scripts/recurrence.test.ts' },
  { id: 'TC-A02', cmd: 'npx tsx scripts/todayflag.test.ts' },
  { id: 'TC-A03', cmd: 'npx tsx scripts/ics.test.ts' },
  { id: 'TC-A06', cmd: 'npx tsx scripts/widgetmeta.test.ts' },
  { id: 'TC-A07', cmd: 'npx tsx scripts/sharefields.test.ts' },
  { id: 'TC-A08', cmd: 'npx tsx scripts/pomodoro.test.ts' },
  { id: 'TC-A09', cmd: 'npx tsx scripts/evernote.test.ts' },
  { id: 'TC-A11', cmd: 'npx tsx scripts/mcp.test.ts' },
  { id: 'TC-A04', cmd: 'npm run build', build: true },
  { id: 'TC-A05', cmd: 'npm run build:mobile', build: true },
];

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const db = JSON.parse(readFileSync(dbFile, 'utf8'));
let failed = 0;

for (const { id, cmd, build } of AUTO_CASES) {
  const testCase = db.cases.find((c) => c.id === id);
  if (!testCase) {
    console.warn(`⚠ ${id} nicht in testcases.json — übersprungen`);
    continue;
  }
  if (build && skipBuilds) {
    console.log(`↷ ${id} übersprungen (--skip-builds): ${cmd}`);
    continue;
  }
  process.stdout.write(`▶ ${id}: ${cmd} … `);
  const res = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8' });
  const pass = res.status === 0;
  if (!pass) failed++;
  console.log(pass ? '✅ pass' : '❌ FAIL');
  if (!pass) {
    const tail = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n');
    console.error(tail);
  }
  testCase.laeufe.push({
    datum: today,
    ergebnis: pass ? 'pass' : 'fail',
    bemerkung: pass ? '' : 'siehe Konsole/CI-Log',
  });
  // Keep the history short — the report shows only the latest run anyway.
  if (testCase.laeufe.length > 10) testCase.laeufe = testCase.laeufe.slice(-10);
}

db.updated = today;
writeFileSync(dbFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
console.log(`\n${failed === 0 ? '✅ Alle Auto-Tests pass' : `❌ ${failed} Auto-Test(s) FAIL`} — Ergebnisse in docs/testcases.json`);
process.exit(failed === 0 ? 0 : 1);
