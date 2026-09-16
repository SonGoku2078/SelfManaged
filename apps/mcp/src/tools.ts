// Die 13 Werkzeuge des MCP-Servers (#88). Verdrahtet api.ts + logic.ts.
// Jede Antwort: vorlesbarer deutscher Text + structuredContent; Fehler als
// isError mit Klartext (AC-18) — nie ein Prozessabsturz.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ApiError, type TaskApi } from './api.js';
import {
  LogicError,
  buildNewTask,
  completePatch,
  dateKey,
  duePatch,
  envKind,
  findTask,
  formatTaskLine,
  groupDayPlan,
  inboxTasks,
  nextSteps,
  nextTaskNumber,
  planPatch,
  resolveCategories,
  resolveProject,
  searchTasks,
  starPatch,
  taskSummary,
  tasksOfProject,
  unplanPatch,
  visibleProjects,
  type ApiProject,
  type ApiTask,
} from './logic.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (text: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(structured ? { structuredContent: structured } : {}),
});

const fail = (e: unknown): ToolResult => {
  const msg =
    e instanceof LogicError || e instanceof ApiError
      ? e.message
      : `Unerwarteter Fehler: ${e instanceof Error ? e.message : String(e)}`;
  return { content: [{ type: 'text', text: `Fehler: ${msg}` }], isError: true };
};

// Ein Handler = eine async-Funktion; Fehler werden hier zentral eingefangen.
const guard = <A>(fn: (args: A) => Promise<ToolResult>) => async (args: A): Promise<ToolResult> => {
  try {
    return await fn(args);
  } catch (e) {
    return fail(e);
  }
};

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format YYYY-MM-DD').describe('Datum im Format YYYY-MM-DD');
const PRIORITY = z.enum(['low', 'medium', 'high']);

// Adressierung eines Tasks (AC-16).
const TASK_REF = {
  taskId: z.string().optional().describe('Task-id (z. B. task-abc-123)'),
  taskNummer: z.number().int().positive().optional().describe('Task-Nummer #N (wie in der App angezeigt)'),
};
// Adressierung eines Projekts.
const PROJECT_REF = {
  projektId: z.string().optional().describe('Projekt-id'),
  projektName: z.string().optional().describe('Projektname (unscharf, Groß-/Kleinschreibung egal); mehrdeutig → Fehler mit Kandidaten'),
};

const GTD_HINWEIS =
  'Begriffe: ★ = „Nächste Aktion" (vom Nutzer markiert). „Für Tag planen" (Heute-Marker) ist NICHT dasselbe wie „fällig am" (Termin/Deadline). ' +
  'Fehlt ein Projekt oder Datum, frag nach statt zu raten. Relative Angaben wie „morgen" selbst in YYYY-MM-DD umrechnen (heute siehe umgebung_info).';

export function registerTools(server: McpServer, api: TaskApi): void {
  const projectName = (projects: ApiProject[], id: string | null) => projects.find((p) => p.id === id)?.name ?? null;
  const lines = (tasks: ApiTask[], projects: ApiProject[], todayKey: string) =>
    tasks.map((t) => `- ${formatTaskLine(t, projectName(projects, t.projectId), todayKey, api.baseUrl)}`).join('\n');
  const summaries = (tasks: ApiTask[], projects: ApiProject[]) => tasks.map((t) => taskSummary(t, projectName(projects, t.projectId), api.baseUrl));

  // Gemeinsamer Abschluss der Schreibwerkzeuge: Task per Referenz finden, PATCH, Antwort.
  const patchByRef = async (ref: { taskId?: string; taskNummer?: number }, patch: Record<string, unknown>, verb: string) => {
    const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
    const task = findTask(tasks, { id: ref.taskId, number: ref.taskNummer });
    const updated = await api.patchTask(task.id, patch);
    const pn = projectName(projects, updated.projectId);
    return { updated, text: `${verb}: ${formatTaskLine(updated, pn, dateKey(new Date()), api.baseUrl)}`, summary: taskSummary(updated, pn, api.baseUrl) };
  };

  // ── Info ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'umgebung_info',
    {
      title: 'Umgebung',
      description: `Zeigt, mit welchem Task-Manager-Server dieser MCP-Server verbunden ist (dev/prod), ob er erreichbar ist, und das heutige Datum. Jede Task-Zeile in den Antworten endet mit einem Link (→ http://…/#/t/<nummer>), der den Task in der Web-App öffnet — gib ihn dem Nutzer mit, wenn er mehr sehen will. ${GTD_HINWEIS}`,
      inputSchema: {},
    },
    guard(async () => {
      const heute = dateKey(new Date());
      const kind = envKind(api.baseUrl);
      let erreichbar = false;
      let fehler: string | null = null;
      try {
        erreichbar = (await api.health()).ok === true;
      } catch (e) {
        fehler = e instanceof Error ? e.message : String(e);
      }
      const text = `Server: ${api.baseUrl} (${kind}) — ${erreichbar ? 'erreichbar' : `NICHT erreichbar: ${fehler}`}. Heute ist ${heute}.`;
      return ok(text, { baseUrl: api.baseUrl, umgebung: kind, erreichbar, fehler, heute });
    }),
  );

  // ── Lesen ─────────────────────────────────────────────────────────────────
  server.registerTool(
    'projekte_auflisten',
    {
      title: 'Projekte auflisten',
      description: 'Listet alle Projekte und Areas (nicht archiviert) mit Anzahl offener Tasks. Someday-Projekte sind inaktiv (active=false). Nutze das, um ein vom Nutzer genanntes Projekt zu finden oder Rückfragen zu stellen.',
      inputSchema: { nurAktive: z.boolean().optional().describe('true = nur aktive Projekte (kein Someday)') },
    },
    guard(async ({ nurAktive }) => {
      const [projects, tasks] = await Promise.all([api.getProjects(), api.getTasks()]);
      const list = visibleProjects(projects).filter((p) => !nurAktive || p.active);
      const rows = list.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        active: p.active,
        offen: tasks.filter((t) => t.projectId === p.id && !t.completed).length,
      }));
      const text = rows.length
        ? rows.map((r) => `- ${r.name} (${r.kind === 'area' ? 'Area' : 'Projekt'}${r.active ? '' : ', Someday'}, ${r.offen} offen)`).join('\n')
        : 'Keine Projekte vorhanden.';
      return ok(text, { projekte: rows });
    }),
  );

  server.registerTool(
    'tasks_auflisten',
    {
      title: 'Tasks eines Projekts',
      description: 'Alle offenen Tasks eines Projekts in App-Reihenfolge, mit Kennzeichen (★, geplant, fällig, Priorität, Someday, wartet). Projekt per projektId oder projektName.',
      inputSchema: { ...PROJECT_REF, inklusiveErledigte: z.boolean().optional().describe('true = erledigte Tasks mit auflisten') },
    },
    guard(async ({ projektId, projektName: name, inklusiveErledigte }) => {
      const [projects, tasks] = await Promise.all([api.getProjects(), api.getTasks()]);
      const project = resolveProject(projects, { id: projektId, name });
      const list = tasksOfProject(tasks, project.id, !!inklusiveErledigte);
      const todayKey = dateKey(new Date());
      const text = list.length
        ? `Projekt „${project.name}" (${list.length} Tasks):\n${lines(list, projects, todayKey)}`
        : `Projekt „${project.name}" hat keine ${inklusiveErledigte ? '' : 'offenen '}Tasks.`;
      return ok(text, { projekt: { id: project.id, name: project.name }, tasks: summaries(list, projects) });
    }),
  );

  server.registerTool(
    'naechste_schritte',
    {
      title: 'Nächste Schritte eines Projekts',
      description: 'Was steht als Nächstes an? Liefert NUR die mit ★ markierten offenen Tasks (Nächste Aktion) eines Projekts. Ist nichts markiert, sag das dem Nutzer und biete an, einen Task zu sternen (task_stern).',
      inputSchema: { ...PROJECT_REF },
    },
    guard(async ({ projektId, projektName: name }) => {
      const [projects, tasks] = await Promise.all([api.getProjects(), api.getTasks()]);
      const project = resolveProject(projects, { id: projektId, name });
      const steps = nextSteps(tasks, project.id);
      const offen = tasksOfProject(tasks, project.id).length;
      const todayKey = dateKey(new Date());
      const text = steps.length
        ? `Nächste Schritte in „${project.name}":\n${lines(steps, projects, todayKey)}`
        : `In „${project.name}" ist keine Nächste Aktion (★) markiert. Es gibt ${offen} offene Tasks.`;
      return ok(text, { projekt: { id: project.id, name: project.name }, naechsteSchritte: summaries(steps, projects), offenGesamt: offen });
    }),
  );

  server.registerTool(
    'tagesplan',
    {
      title: 'Tagesplan',
      description: 'Der Plan für einen Tag (Standard: heute) in drei Gruppen: geplant (Heute-Marker auf dem Datum), fällig (Termin an dem Tag), überfällig (Termin davor, nur bei heute/vergangen). Für „Plan für morgen" das morgige Datum übergeben.',
      inputSchema: { datum: DATE.optional() },
    },
    guard(async ({ datum }) => {
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      const todayKey = dateKey(new Date());
      const plan = groupDayPlan(tasks, datum ?? todayKey, todayKey);
      const parts: string[] = [];
      if (plan.geplant.length) parts.push(`Geplant für ${plan.datum}:\n${lines(plan.geplant, projects, todayKey)}`);
      if (plan.faellig.length) parts.push(`Fällig am ${plan.datum}:\n${lines(plan.faellig, projects, todayKey)}`);
      if (plan.ueberfaellig.length) parts.push(`Überfällig:\n${lines(plan.ueberfaellig, projects, todayKey)}`);
      const text = parts.length ? parts.join('\n\n') : `Für ${plan.datum} ist nichts geplant, nichts fällig und nichts überfällig.`;
      return ok(text, {
        datum: plan.datum,
        geplant: summaries(plan.geplant, projects),
        faellig: summaries(plan.faellig, projects),
        ueberfaellig: summaries(plan.ueberfaellig, projects),
      });
    }),
  );

  server.registerTool(
    'inbox',
    {
      title: 'Inbox',
      description: 'Offene Tasks ohne Projekt (GTD-Inbox, noch nicht einsortiert).',
      inputSchema: {},
    },
    guard(async () => {
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      const list = inboxTasks(tasks);
      const text = list.length ? `Inbox (${list.length}):\n${lines(list, projects, dateKey(new Date()))}` : 'Die Inbox ist leer.';
      return ok(text, { tasks: summaries(list, projects) });
    }),
  );

  server.registerTool(
    'tasks_suchen',
    {
      title: 'Tasks suchen',
      description: 'Volltextsuche in Titel und Beschreibung (max. 50 Treffer, Standard nur offene Tasks).',
      inputSchema: { suche: z.string().min(1).describe('Suchbegriff'), inklusiveErledigte: z.boolean().optional() },
    },
    guard(async ({ suche, inklusiveErledigte }) => {
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      const hits = searchTasks(tasks, suche, !!inklusiveErledigte);
      const text = hits.length ? `${hits.length} Treffer für „${suche}":\n${lines(hits, projects, dateKey(new Date()))}` : `Keine Treffer für „${suche}".`;
      return ok(text, { treffer: summaries(hits, projects) });
    }),
  );

  // ── Schreiben ─────────────────────────────────────────────────────────────
  server.registerTool(
    'task_anlegen',
    {
      title: 'Task anlegen',
      description: 'Legt einen neuen Task an. Ohne Projekt landet er in der Inbox — frag den Nutzer vorher, in welches Projekt er soll, wenn er es nicht gesagt hat. faelligAm = Termin, planenFuer = Tagesplan-Marker (setzt automatisch ★).',
      inputSchema: {
        title: z.string().min(1).describe('Titel des Tasks'),
        ...PROJECT_REF,
        beschreibung: z.string().optional(),
        faelligAm: DATE.optional().describe('Termin/Deadline'),
        prioritaet: PRIORITY.optional().describe('low | medium | high (Standard medium)'),
        kategorien: z.array(z.string()).optional().describe('Kategorienamen (müssen existieren)'),
        planenFuer: DATE.optional().describe('Tagesplan-Marker für dieses Datum (z. B. morgen)'),
      },
    },
    guard(async ({ title, projektId, projektName: name, beschreibung, faelligAm, prioritaet, kategorien, planenFuer }) => {
      const [projects, tasks, cats] = await Promise.all([api.getProjects(), api.getTasks(), api.getCategories()]);
      const project = projektId || name ? resolveProject(projects, { id: projektId, name }) : null;
      const categoryIds = kategorien?.length ? resolveCategories(cats, kategorien) : [];
      const task = buildNewTask(
        { title, projectId: project?.id ?? null, description: beschreibung, dueKey: faelligAm ?? null, priority: prioritaet, categoryIds, planKey: planenFuer ?? null },
        { number: nextTaskNumber(tasks) },
      );
      const created = await api.createTask(task);
      const pn = project?.name ?? null;
      const text = `Angelegt: ${formatTaskLine(created, pn, dateKey(new Date()), api.baseUrl)}${pn ? '' : ' — in der Inbox (kein Projekt)'}`;
      return ok(text, { task: taskSummary(created, pn, api.baseUrl) });
    }),
  );

  server.registerTool(
    'task_planen',
    {
      title: 'Task für einen Tag planen',
      description: 'Setzt den Tagesplan-Marker eines Tasks auf ein Datum (heute, morgen, …). Der Task wird dadurch auch ★ (Nächste Aktion) und verlässt Someday. Ändert NICHT das Fälligkeitsdatum.',
      inputSchema: { ...TASK_REF, datum: DATE },
    },
    guard(async ({ taskId, taskNummer, datum }) => {
      const r = await patchByRef({ taskId, taskNummer }, planPatch(datum), `Geplant für ${datum}`);
      return ok(r.text, { task: r.summary });
    }),
  );

  server.registerTool(
    'task_planung_entfernen',
    {
      title: 'Tagesplanung entfernen',
      description: 'Nimmt den Tagesplan-Marker vom Task (★ bleibt erhalten).',
      inputSchema: { ...TASK_REF },
    },
    guard(async ({ taskId, taskNummer }) => {
      const r = await patchByRef({ taskId, taskNummer }, unplanPatch(), 'Planung entfernt');
      return ok(r.text, { task: r.summary });
    }),
  );

  server.registerTool(
    'task_faelligkeit_setzen',
    {
      title: 'Fälligkeit setzen',
      description: 'Setzt den Termin (Deadline) eines Tasks auf ein Datum, oder entfernt ihn mit datum=null. Das ist NICHT der Tagesplan (dafür task_planen).',
      inputSchema: { ...TASK_REF, datum: DATE.nullable().describe('YYYY-MM-DD oder null zum Entfernen') },
    },
    guard(async ({ taskId, taskNummer, datum }) => {
      const r = await patchByRef({ taskId, taskNummer }, duePatch(datum), datum ? `Fällig am ${datum}` : 'Fälligkeit entfernt');
      return ok(r.text, { task: r.summary });
    }),
  );

  server.registerTool(
    'task_stern',
    {
      title: 'Nächste Aktion (★) setzen/entfernen',
      description: 'Markiert einen Task als Nächste Aktion (★) oder entfernt die Markierung.',
      inputSchema: { ...TASK_REF, stern: z.boolean().describe('true = ★ setzen, false = entfernen') },
    },
    guard(async ({ taskId, taskNummer, stern }) => {
      const r = await patchByRef({ taskId, taskNummer }, starPatch(stern), stern ? '★ gesetzt' : '★ entfernt');
      return ok(r.text, { task: r.summary });
    }),
  );

  server.registerTool(
    'task_abhaken',
    {
      title: 'Task abhaken',
      description: 'Markiert einen Task als erledigt (erledigt=false macht es rückgängig). Bei wiederkehrenden Tasks wird KEIN Folgetermin erzeugt — das macht nur die App; sag das dem Nutzer.',
      inputSchema: { ...TASK_REF, erledigt: z.boolean().optional().describe('Standard true') },
    },
    guard(async ({ taskId, taskNummer, erledigt }) => {
      const done = erledigt ?? true;
      const r = await patchByRef({ taskId, taskNummer }, completePatch(done), done ? 'Erledigt' : 'Wieder offen');
      const recurring = r.updated.recurrence && r.updated.recurrence !== 'none';
      const hint = done && recurring ? ' — Hinweis: wiederkehrender Task, der nächste Termin wird erst in der App erzeugt.' : '';
      return ok(r.text + hint, { task: r.summary, wiederkehrend: !!recurring });
    }),
  );
}
