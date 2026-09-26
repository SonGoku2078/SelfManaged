// Rauchtest (#88, TC-M67; seit #100 auch task_bearbeiten/task_loeschen):
// startet den gebauten MCP-Server per stdio, ruft alle Werkzeuge gegen den
// Server in TM_API_URL auf und prüft die Antworten.
// NUR gegen Dev ausführen (legt Tasks an, ändert und löscht sie):
//   TM_API_URL=http://localhost:3002 node apps/mcp/smoke.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = (process.env.TM_API_URL ?? '').trim();
if (!url) { console.error('TM_API_URL fehlt (Dev: http://localhost:3002)'); process.exit(1); }
if (/192\.168\.8\.50|:3001\b/.test(url)) { console.error('Rauchtest nie gegen Prod!'); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, 'dist', 'index.js')],
  env: { ...process.env, TM_API_URL: url },
  stderr: 'pipe',
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.map((c) => c.text).join('\n') ?? '';
  return { text, data: r.structuredContent, isError: !!r.isError };
};
const step = (label, ok, extra = '') => {
  console.log(`${ok ? '✔' : '✘'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { failures++; }
};
let failures = 0;

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
step('15 Werkzeuge registriert', names.length === 15, names.join(', '));
step('task_bearbeiten + task_loeschen registriert', names.includes('task_bearbeiten') && names.includes('task_loeschen'));

const env = await call('umgebung_info');
step('umgebung_info: dev + erreichbar', !env.isError && env.data.umgebung === 'dev' && env.data.erreichbar === true, env.text);
const heute = env.data.heute;
const morgen = (() => { const [y, m, d] = heute.split('-').map(Number); const t = new Date(y, m - 1, d + 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })();

const projekte = await call('projekte_auflisten');
step('projekte_auflisten', !projekte.isError && Array.isArray(projekte.data.projekte), `${projekte.data?.projekte?.length} Projekte`);
const projekt = projekte.data.projekte.find((p) => p.active) ?? projekte.data.projekte[0];
assert.ok(projekt, 'Dev-DB braucht mindestens ein Projekt (npm run db:seed-dev)');

const unknown = await call('tasks_auflisten', { projektName: 'Gibtsnicht-XYZ-' + Date.now() });
step('unbekanntes Projekt → Fehlertext', unknown.isError && /nicht gefunden/.test(unknown.text), unknown.text);

const stamp = new Date().toISOString().slice(11, 19);
const neu = await call('task_anlegen', { title: `MCP-Rauchtest ${stamp}`, projektName: projekt.name, faelligAm: morgen, prioritaet: 'high' });
step('task_anlegen im Projekt', !neu.isError && neu.data.task.projectId === projekt.id && neu.data.task.dueDate === morgen && neu.data.task.priority === 'high', neu.text);
const nr = neu.data.task.number;

const inboxNeu = await call('task_anlegen', { title: `MCP-Rauchtest Inbox ${stamp}` });
step('task_anlegen ohne Projekt → Inbox, Nummer max+1', !inboxNeu.isError && inboxNeu.data.task.projectId === null && inboxNeu.data.task.number === nr + 1, inboxNeu.text);
const inbox = await call('inbox');
step('inbox enthält neuen Task', !inbox.isError && inbox.data.tasks.some((t) => t.id === inboxNeu.data.task.id));

const liste = await call('tasks_auflisten', { projektId: projekt.id });
step('tasks_auflisten enthält neuen Task', !liste.isError && liste.data.tasks.some((t) => t.number === nr));

const plan = await call('task_planen', { taskNummer: nr, datum: morgen });
step('task_planen: todayDate + ★', !plan.isError && plan.data.task.todayDate === morgen && plan.data.task.starred === true, plan.text);

const next = await call('naechste_schritte', { projektName: projekt.name });
step('naechste_schritte zeigt ★-Task', !next.isError && next.data.naechsteSchritte.some((t) => t.number === nr), next.text.split('\n')[0]);

const planMorgen = await call('tagesplan', { datum: morgen });
step('tagesplan morgen: Task in „geplant", nicht doppelt in „faellig"', !planMorgen.isError && planMorgen.data.geplant.some((t) => t.number === nr) && !planMorgen.data.faellig.some((t) => t.number === nr));

const unplan = await call('task_planung_entfernen', { taskNummer: nr });
step('task_planung_entfernen: todayDate null, ★ bleibt', !unplan.isError && unplan.data.task.todayDate === null && unplan.data.task.starred === true);
const planMorgen2 = await call('tagesplan', { datum: morgen });
step('tagesplan morgen: Task jetzt in „faellig"', !planMorgen2.isError && planMorgen2.data.faellig.some((t) => t.number === nr));

const due = await call('task_faelligkeit_setzen', { taskNummer: nr, datum: null });
step('task_faelligkeit_setzen null', !due.isError && due.data.task.dueDate === null, due.text);
const due2 = await call('task_faelligkeit_setzen', { taskNummer: nr, datum: heute });
step('task_faelligkeit_setzen heute', !due2.isError && due2.data.task.dueDate === heute);
const planHeute = await call('tagesplan');
step('tagesplan heute: Task fällig heute', !planHeute.isError && planHeute.data.faellig.some((t) => t.number === nr));

const unstar = await call('task_stern', { taskNummer: nr, stern: false });
step('task_stern false', !unstar.isError && unstar.data.task.starred === false);
const next2 = await call('naechste_schritte', { projektId: projekt.id });
step('naechste_schritte ohne diesen Task', !next2.isError && !next2.data.naechsteSchritte.some((t) => t.number === nr));

const suche = await call('tasks_suchen', { suche: stamp });
step('tasks_suchen findet beide', !suche.isError && suche.data.treffer.length === 2, suche.text.split('\n')[0]);

const done = await call('task_abhaken', { taskNummer: nr });
step('task_abhaken', !done.isError && done.data.task.completed === true, done.text);
const suche2 = await call('tasks_suchen', { suche: stamp });
step('erledigter Task nicht mehr in Standard-Suche', !suche2.isError && suche2.data.treffer.length === 1);
const doneInbox = await call('task_abhaken', { taskId: inboxNeu.data.task.id });
step('task_abhaken (Inbox-Task per id)', !doneInbox.isError && doneInbox.data.task.completed === true);

const bad = await call('task_planen', { taskNummer: 99999999, datum: morgen });
step('unbekannte Nummer → Fehlertext', bad.isError && /nicht gefunden/.test(bad.text), bad.text);

// ── #100: task_bearbeiten + task_loeschen ────────────────────────────────
const editTarget = await call('task_anlegen', { title: `MCP-CRUD-Rauchtest ${stamp}` });
const editNr = editTarget.data.task.number;
const bearbeitet = await call('task_bearbeiten', { taskNummer: editNr, title: `MCP-CRUD-Rauchtest geändert ${stamp}`, prioritaet: 'low', projektId: projekt.id });
step('task_bearbeiten: Titel+Prioritaet+Projekt geändert', !bearbeitet.isError && bearbeitet.data.task.title === `MCP-CRUD-Rauchtest geändert ${stamp}` && bearbeitet.data.task.priority === 'low' && bearbeitet.data.task.projectId === projekt.id, bearbeitet.text);
const bearbeitetInbox = await call('task_bearbeiten', { taskNummer: editNr, inInboxVerschieben: true });
step('task_bearbeiten: inInboxVerschieben ⇒ projectId null', !bearbeitetInbox.isError && bearbeitetInbox.data.task.projectId === null, bearbeitetInbox.text);
const bearbeitetLeer = await call('task_bearbeiten', { taskNummer: editNr });
step('task_bearbeiten ohne Felder → Fehlertext', bearbeitetLeer.isError && /mindestens ein Feld/.test(bearbeitetLeer.text), bearbeitetLeer.text);

const geloescht = await call('task_loeschen', { taskNummer: editNr });
step('task_loeschen', !geloescht.isError && geloescht.data.geloescht.number === editNr, geloescht.text);
const nachLoeschen = await call('task_faelligkeit_setzen', { taskNummer: editNr, datum: heute });
step('gelöschter Task nicht mehr auffindbar', nachLoeschen.isError && /nicht gefunden/.test(nachLoeschen.text), nachLoeschen.text);

await client.close();
console.log(failures ? `\n${failures} Prüfung(en) FEHLGESCHLAGEN` : '\nRauchtest bestanden ✔');
process.exit(failures ? 1 : 0);
