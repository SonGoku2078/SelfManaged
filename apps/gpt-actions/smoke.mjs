// Rauchtest (#98): startet den gebauten gpt-actions-Server als Kindprozess,
// ruft alle 12 REST-Routen per fetch auf (mit/ohne/falschem Key), prüft
// Statuscodes und dass kein Endpunkt DELETE annimmt.
// NUR gegen Dev ausführen (legt Tasks an und ändert sie):
//   TM_API_URL=http://localhost:3002 node apps/gpt-actions/smoke.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = (process.env.TM_API_URL ?? '').trim();
if (!url) { console.error('TM_API_URL fehlt (Dev: http://localhost:3002)'); process.exit(1); }
if (/192\.168\.8\.187|:3001\b/.test(url)) { console.error('Rauchtest nie gegen Prod!'); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.GPT_ACTIONS_PORT ?? 3003);
const base = `http://localhost:${port}`;
const apiKey = `smoke-test-key-${Date.now()}`;

const child = spawn(process.execPath, [path.join(here, 'dist', 'gpt-actions', 'src', 'index.js')], {
  env: { ...process.env, TM_API_URL: url, GPT_ACTIONS_API_KEY: apiKey, GPT_ACTIONS_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (d) => { childOutput += d.toString(); });
child.stderr.on('data', (d) => { childOutput += d.toString(); });

let failures = 0;
const step = (label, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const call = async (method, path_, { key = apiKey, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (key !== null) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${base}${path_}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

const waitReady = async (timeoutMs = 10_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await call('GET', '/v1/health');
      if (r.status === 200) return;
    } catch {
      // Server noch nicht bereit.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server nicht bereit nach ${timeoutMs}ms.\n${childOutput}`);
};

try {
  await waitReady();

  // ── Auth (AC-2/AC-10) ───────────────────────────────────────────────────
  const noKey = await call('GET', '/v1/health', { key: null });
  step('ohne Key -> 401', noKey.status === 401 && typeof noKey.data.error === 'string', JSON.stringify(noKey.data));
  const wrongKey = await call('GET', '/v1/health', { key: 'definitiv-falsch' });
  step('falscher Key -> 401', wrongKey.status === 401, JSON.stringify(wrongKey.data));
  const rightKey = await call('GET', '/v1/health');
  step('richtiger Key -> 200 + umgebung dev', rightKey.status === 200 && rightKey.data.umgebung === 'dev' && rightKey.data.erreichbar === true, JSON.stringify(rightKey.data));

  // ── Kein DELETE auf irgendeiner Route (AC-9) ────────────────────────────
  const routesToProbe = ['/v1/tasks/1', '/v1/projects', '/v1/inbox', '/v1/tasks/search?q=x', '/v1/day-plan'];
  let anyDeleteAllowed = false;
  for (const r of routesToProbe) {
    const res = await call('DELETE', r);
    if (res.status !== 404) anyDeleteAllowed = true;
  }
  step('kein Endpunkt akzeptiert DELETE (alle -> 404 Unbekannte Route)', !anyDeleteAllowed);

  // ── Lesen ────────────────────────────────────────────────────────────────
  const projekte = await call('GET', '/v1/projects');
  step('GET /v1/projects', projekte.status === 200 && Array.isArray(projekte.data.projekte), `${projekte.data?.projekte?.length} Projekte`);
  const projekt = projekte.data.projekte.find((p) => p.active) ?? projekte.data.projekte[0];
  if (!projekt) throw new Error('Dev-DB braucht mindestens ein Projekt (npm run db:seed-dev)');

  const unknownProject = await call('GET', `/v1/projects/${encodeURIComponent('Gibtsnicht-XYZ-' + Date.now())}/tasks`);
  step('unbekanntes Projekt -> 404 mit Fehlertext', unknownProject.status === 404 && /nicht gefunden/.test(unknownProject.data.error), JSON.stringify(unknownProject.data));

  const heute = rightKey.data.heute;
  const morgen = (() => {
    const [y, m, d] = heute.split('-').map(Number);
    const t = new Date(y, m - 1, d + 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  })();

  // ── Schreiben ────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().slice(11, 19);
  const neu = await call('POST', '/v1/tasks', { body: { title: `GPT-Actions-Rauchtest ${stamp}`, projektId: projekt.id, faelligAm: morgen, prioritaet: 'high' } });
  step('POST /v1/tasks im Projekt -> 201', neu.status === 201 && neu.data.task.projectId === projekt.id && neu.data.task.dueDate === morgen && neu.data.task.priority === 'high', JSON.stringify(neu.data));
  const nr = neu.data.task.number;

  const inboxNeu = await call('POST', '/v1/tasks', { body: { title: `GPT-Actions-Rauchtest Inbox ${stamp}` } });
  step('POST /v1/tasks ohne Projekt -> Inbox, Nummer max+1', inboxNeu.status === 201 && inboxNeu.data.task.projectId === null && inboxNeu.data.task.number === nr + 1, JSON.stringify(inboxNeu.data));

  const inbox = await call('GET', '/v1/inbox');
  step('GET /v1/inbox enthält neuen Task', inbox.status === 200 && inbox.data.tasks.some((t) => t.number === nr + 1));

  const liste = await call('GET', `/v1/projects/${encodeURIComponent(projekt.id)}/tasks`);
  step('GET /v1/projects/:ref/tasks enthält neuen Task', liste.status === 200 && liste.data.tasks.some((t) => t.number === nr));

  const plan = await call('PATCH', `/v1/tasks/${nr}/plan`, { body: { datum: morgen } });
  step('PATCH .../plan setzt todayDate + ★', plan.status === 200 && plan.data.task.todayDate === morgen && plan.data.task.starred === true, JSON.stringify(plan.data));

  const next = await call('GET', `/v1/projects/${encodeURIComponent(projekt.id)}/next-steps`);
  step('GET .../next-steps zeigt ★-Task', next.status === 200 && next.data.naechsteSchritte.some((t) => t.number === nr));

  const planMorgen = await call('GET', `/v1/day-plan?date=${morgen}`);
  step('GET /v1/day-plan morgen: Task in geplant, nicht doppelt in faellig', planMorgen.status === 200 && planMorgen.data.geplant.some((t) => t.number === nr) && !planMorgen.data.faellig.some((t) => t.number === nr));

  const unplan = await call('PATCH', `/v1/tasks/%23${nr}/plan`, { body: { datum: null } });
  step('PATCH .../plan mit datum=null entfernt Marker, ★ bleibt (Ref per #Nummer)', unplan.status === 200 && unplan.data.task.todayDate === null && unplan.data.task.starred === true, JSON.stringify(unplan.data));

  const due0 = await call('PATCH', `/v1/tasks/${nr}/due-date`, { body: { datum: null } });
  step('PATCH .../due-date null entfernt Termin', due0.status === 200 && due0.data.task.dueDate === null);
  const due1 = await call('PATCH', `/v1/tasks/${nr}/due-date`, { body: { datum: heute } });
  step('PATCH .../due-date setzt Termin', due1.status === 200 && due1.data.task.dueDate === heute);

  const unstar = await call('PATCH', `/v1/tasks/${nr}/star`, { body: { stern: false } });
  step('PATCH .../star false', unstar.status === 200 && unstar.data.task.starred === false);

  const suche = await call('GET', `/v1/tasks/search?q=${encodeURIComponent(stamp)}`);
  step('GET /v1/tasks/search findet beide', suche.status === 200 && suche.data.treffer.length === 2, `${suche.data.treffer?.length} Treffer`);

  const done = await call('PATCH', `/v1/tasks/${nr}/complete`, { body: {} });
  step('PATCH .../complete markiert erledigt', done.status === 200 && done.data.task.completed === true, JSON.stringify(done.data));
  const sucheAfter = await call('GET', `/v1/tasks/search?q=${encodeURIComponent(stamp)}`);
  step('erledigter Task nicht mehr in Standard-Suche', sucheAfter.status === 200 && sucheAfter.data.treffer.length === 1);
  const doneInbox = await call('PATCH', `/v1/tasks/${inboxNeu.data.task.id}/complete`, { body: {} });
  step('PATCH .../complete per taskId (Inbox-Task)', doneInbox.status === 200 && doneInbox.data.task.completed === true);

  const bad = await call('PATCH', '/v1/tasks/999999999/plan', { body: { datum: morgen } });
  step('unbekannte Tasknummer -> 404 Fehlertext', bad.status === 404 && /nicht gefunden/.test(bad.data.error), JSON.stringify(bad.data));

  const badBody = await call('POST', '/v1/tasks', { body: {} });
  step('ungültiger Body (kein title) -> 400', badBody.status === 400 && /Ungültige Eingabe/.test(badBody.data.error), JSON.stringify(badBody.data));
} finally {
  child.kill();
}

console.log(failures ? `\n${failures} Prüfung(en) FEHLGESCHLAGEN` : '\nRauchtest bestanden ✔');
process.exit(failures ? 1 : 0);
