// Die REST-Routen des ChatGPT-Adapters (#98) — 1:1 auf die MCP-Tools aus
// #88 gemappt (siehe docs/pipeline/chatgpt-api-access.md, Abschnitt 2
// "Endpunkt-Mapping"). Verdrahtet api.ts (HTTP-Client) + logic.ts (reine
// Logik aus apps/mcp, wiederverwendet — keine Duplizierung).
// Seit #100: volles Task-CRUD (PATCH /tasks/:ref, DELETE /tasks/:ref) —
// Projekte/Kategorien bleiben weiterhin nur lesbar, kein neuer Schreib-Pfad.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { ApiError, type TaskApi } from './api.js';
import {
  LogicError,
  buildNewTask,
  completePatch,
  dateKey,
  duePatch,
  editPatch,
  envKind,
  findTask,
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
} from '../../mcp/src/logic.js';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format YYYY-MM-DD');
const PRIORITY = z.enum(['low', 'medium', 'high']);

// Projekt-Referenz in der URL (:ref): exakte Projekt-id oder -Name (unscharf,
// über resolveProject aufgelöst — siehe #88).
function resolveProjectRef(projects: ApiProject[], ref: string): ApiProject {
  const decoded = decodeURIComponent(ref);
  const byId = visibleProjects(projects).find((p) => p.id === decoded);
  return byId ?? resolveProject(projects, { name: decoded });
}

// Task-Referenz in der URL (:ref, AC-8): taskId oder #Tasknummer.
// Akzeptiert sowohl "#142" (falls der Client "#" percent-encoded mitschickt)
// als auch reine Ziffern ("142") als Tasknummer; alles andere als taskId.
function resolveTaskRef(tasks: ApiTask[], ref: string): ApiTask {
  const decoded = decodeURIComponent(ref);
  if (decoded.startsWith('#')) {
    const n = Number(decoded.slice(1));
    if (Number.isFinite(n)) return findTask(tasks, { number: n });
  }
  if (/^\d+$/.test(decoded)) return findTask(tasks, { number: Number(decoded) });
  return findTask(tasks, { id: decoded });
}

function wrap(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

const isTrue = (v: unknown): boolean => v === 'true' || v === true;

// Zentrale Fehlerantwort (AC-10): HTTP-Status + {"error": "<deutscher Text>"}
// — nie ein Stacktrace nach außen, nie ein Prozessabsturz.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express erkennt Error-Middleware nur an Arity 4.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: `Ungültige Eingabe: ${err.issues.map((i) => i.message).join('; ')}` });
    return;
  }
  if (err instanceof LogicError) {
    // "Task … nicht gefunden" / "Projekt … nicht gefunden" -> 404; alles
    // andere aus logic.ts (Validierung, mehrdeutig, unbekannte Kategorie) -> 400.
    const notFound = /^(Task|Projekt)\b.*nicht gefunden/.test(err.message);
    res.status(notFound ? 404 : 400).json({ error: err.message });
    return;
  }
  if (err instanceof ApiError) {
    res.status(502).json({ error: err.message });
    return;
  }
  console.error('Unerwarteter Fehler:', err);
  res.status(500).json({ error: 'Unerwarteter Serverfehler.' });
}

export function buildRouter(api: TaskApi): Router {
  const router = Router();
  const projectName = (projects: ApiProject[], id: string | null) => projects.find((p) => p.id === id)?.name ?? null;
  const summaries = (tasks: ApiTask[], projects: ApiProject[]) =>
    tasks.map((t) => taskSummary(t, projectName(projects, t.projectId), api.baseUrl));

  const patchByRef = async (ref: string, patch: Record<string, unknown>) => {
    const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
    const task = resolveTaskRef(tasks, ref);
    const updated = await api.patchTask(task.id, patch);
    return taskSummary(updated, projectName(projects, updated.projectId), api.baseUrl);
  };

  // ── Lesen ─────────────────────────────────────────────────────────────────
  router.get(
    '/health',
    wrap(async (_req, res) => {
      const heute = dateKey(new Date());
      const umgebung = envKind(api.baseUrl);
      let erreichbar = false;
      let fehler: string | null = null;
      try {
        erreichbar = (await api.health()).ok === true;
      } catch (e) {
        fehler = e instanceof Error ? e.message : String(e);
      }
      res.json({ baseUrl: api.baseUrl, umgebung, erreichbar, fehler, heute });
    }),
  );

  router.get(
    '/projects',
    wrap(async (req, res) => {
      const nurAktive = isTrue(req.query.nurAktive);
      const [projects, tasks] = await Promise.all([api.getProjects(), api.getTasks()]);
      const list = visibleProjects(projects).filter((p) => !nurAktive || p.active);
      const projekte = list.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        active: p.active,
        offen: tasks.filter((t) => t.projectId === p.id && !t.completed).length,
      }));
      res.json({ projekte });
    }),
  );

  router.get(
    '/projects/:ref/tasks',
    wrap(async (req, res) => {
      const inklusiveErledigte = isTrue(req.query.inklusiveErledigte);
      const [projects, tasks] = await Promise.all([api.getProjects(), api.getTasks()]);
      const project = resolveProjectRef(projects, req.params.ref);
      const list = tasksOfProject(tasks, project.id, inklusiveErledigte);
      res.json({ projekt: { id: project.id, name: project.name }, tasks: summaries(list, projects) });
    }),
  );

  router.get(
    '/projects/:ref/next-steps',
    wrap(async (req, res) => {
      const [projects, tasks] = await Promise.all([api.getProjects(), api.getTasks()]);
      const project = resolveProjectRef(projects, req.params.ref);
      const steps = nextSteps(tasks, project.id);
      const offenGesamt = tasksOfProject(tasks, project.id).length;
      const hinweis = steps.length ? null : `In „${project.name}" ist keine Nächste Aktion (★) markiert.`;
      res.json({ projekt: { id: project.id, name: project.name }, naechsteSchritte: summaries(steps, projects), offenGesamt, hinweis });
    }),
  );

  router.get(
    '/day-plan',
    wrap(async (req, res) => {
      const heute = dateKey(new Date());
      const datum = req.query.date !== undefined ? DATE.parse(req.query.date) : heute;
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      const plan = groupDayPlan(tasks, datum, heute);
      res.json({
        datum: plan.datum,
        geplant: summaries(plan.geplant, projects),
        faellig: summaries(plan.faellig, projects),
        ueberfaellig: summaries(plan.ueberfaellig, projects),
      });
    }),
  );

  router.get(
    '/inbox',
    wrap(async (_req, res) => {
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      res.json({ tasks: summaries(inboxTasks(tasks), projects) });
    }),
  );

  router.get(
    '/tasks/search',
    wrap(async (req, res) => {
      const suche = z.string().min(1, 'Bitte einen Suchbegriff angeben (Query-Parameter q).').parse(req.query.q);
      const inklusiveErledigte = isTrue(req.query.inklusiveErledigte);
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      const treffer = searchTasks(tasks, suche, inklusiveErledigte);
      res.json({ treffer: summaries(treffer, projects) });
    }),
  );

  // ── Schreiben ─────────────────────────────────────────────────────────────
  const CreateTaskBody = z.object({
    title: z.string().min(1, 'Der Titel darf nicht leer sein.'),
    projektId: z.string().optional(),
    projektName: z.string().optional(),
    beschreibung: z.string().optional(),
    faelligAm: DATE.optional(),
    prioritaet: PRIORITY.optional(),
    kategorien: z.array(z.string()).optional(),
    planenFuer: DATE.optional(),
  });

  router.post(
    '/tasks',
    wrap(async (req, res) => {
      const body = CreateTaskBody.parse(req.body ?? {});
      const [projects, tasks, cats] = await Promise.all([api.getProjects(), api.getTasks(), api.getCategories()]);
      const project = body.projektId || body.projektName ? resolveProject(projects, { id: body.projektId, name: body.projektName }) : null;
      const categoryIds = body.kategorien?.length ? resolveCategories(cats, body.kategorien) : [];
      const newTask = buildNewTask(
        {
          title: body.title,
          projectId: project?.id ?? null,
          description: body.beschreibung,
          dueKey: body.faelligAm ?? null,
          priority: body.prioritaet,
          categoryIds,
          planKey: body.planenFuer ?? null,
        },
        { number: nextTaskNumber(tasks) },
      );
      const created = await api.createTask(newTask);
      res.status(201).json({ task: taskSummary(created, project?.name ?? null, api.baseUrl) });
    }),
  );

  const NullableDateBody = z.object({ datum: DATE.nullable() });

  router.patch(
    '/tasks/:ref/plan',
    wrap(async (req, res) => {
      const { datum } = NullableDateBody.parse(req.body ?? {});
      const patch = datum === null ? unplanPatch() : planPatch(datum);
      res.json({ task: await patchByRef(req.params.ref, patch) });
    }),
  );

  router.patch(
    '/tasks/:ref/due-date',
    wrap(async (req, res) => {
      const { datum } = NullableDateBody.parse(req.body ?? {});
      res.json({ task: await patchByRef(req.params.ref, duePatch(datum)) });
    }),
  );

  const StarBody = z.object({ stern: z.boolean() });

  router.patch(
    '/tasks/:ref/star',
    wrap(async (req, res) => {
      const { stern } = StarBody.parse(req.body ?? {});
      res.json({ task: await patchByRef(req.params.ref, starPatch(stern)) });
    }),
  );

  const CompleteBody = z.object({ erledigt: z.boolean().optional() });

  router.patch(
    '/tasks/:ref/complete',
    wrap(async (req, res) => {
      const { erledigt } = CompleteBody.parse(req.body ?? {});
      const done = erledigt ?? true;
      const [tasks, projects] = await Promise.all([api.getTasks(), api.getProjects()]);
      const task = resolveTaskRef(tasks, req.params.ref);
      const updated = await api.patchTask(task.id, completePatch(done));
      const wiederkehrend = !!(updated.recurrence && updated.recurrence !== 'none');
      res.json({ task: taskSummary(updated, projectName(projects, updated.projectId), api.baseUrl), wiederkehrend });
    }),
  );

  const EditTaskBody = z.object({
    title: z.string().min(1).optional(),
    beschreibung: z.string().optional(),
    projektId: z.string().optional(),
    projektName: z.string().optional(),
    inInboxVerschieben: z.boolean().optional(),
    prioritaet: PRIORITY.optional(),
    kategorien: z.array(z.string()).optional(),
  });

  router.patch(
    '/tasks/:ref',
    wrap(async (req, res) => {
      const body = EditTaskBody.parse(req.body ?? {});
      const [tasks, projects, cats] = await Promise.all([api.getTasks(), api.getProjects(), api.getCategories()]);
      const task = resolveTaskRef(tasks, req.params.ref);
      const projekt = body.inInboxVerschieben ? null : body.projektId || body.projektName ? { id: body.projektId, name: body.projektName } : undefined;
      const patch = editPatch(
        { title: body.title, beschreibung: body.beschreibung, projekt, prioritaet: body.prioritaet, kategorien: body.kategorien },
        { projects, categories: cats },
      );
      const updated = await api.patchTask(task.id, patch);
      res.json({ task: taskSummary(updated, projectName(projects, updated.projectId), api.baseUrl) });
    }),
  );

  router.delete(
    '/tasks/:ref',
    wrap(async (req, res) => {
      const tasks = await api.getTasks();
      const task = resolveTaskRef(tasks, req.params.ref);
      await api.deleteTask(task.id);
      res.json({ geloescht: { id: task.id, number: task.number, title: task.title } });
    }),
  );

  return router;
}
