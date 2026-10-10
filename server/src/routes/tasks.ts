import { Router } from 'express';
import { db } from '../db';

const router = Router();

// ── Serialisation helpers ──────────────────────────────────────────────────

function rowToTask(r: Record<string, unknown>) {
  return {
    id:           r.id,
    number:       r.number,
    title:        r.title ?? '',
    description:  r.description ?? '',
    projectId:    r.project_id ?? null,
    parentId:     r.parent_id ?? null,
    sectionId:    r.section_id ?? null,
    dueDate:      r.due_date ? new Date(r.due_date as string) : null,
    startMinutes: r.start_minutes ?? null,
    durationMin:  r.duration_min ?? null,
    priority:     r.priority,
    completed:    !!(r.completed as number),
    starred:      !!(r.starred as number),
    someday:      !!(r.someday as number),
    thisWeek:     !!(r.this_week as number),
    waiting:      !!(r.waiting as number),
    waitingFor:   r.waiting_for ?? null,
    todayDate:    r.today_date ?? null,
    recurrence:   r.recurrence,
    recurrenceEnd: r.recurrence_end ? new Date(r.recurrence_end as string) : null,
    recurInterval: r.recur_interval ?? null,
    recurUnit:    r.recur_unit ?? null,
    recurMonthDay: r.recur_month_day ?? null,
    completedAt:  r.completed_at ? new Date(r.completed_at as string) : null,
    createdAt:    new Date(r.created_at as string),
    updatedAt:    new Date(r.updated_at as string),
    nozbeId:      r.nozbe_id ?? null,
    sortOrder:    r.sort_order ?? 0,
    categoryIds:  JSON.parse(r.category_ids as string ?? '[]'),
    assigneeIds:  JSON.parse(r.assignee_ids as string ?? '[]'),
    comments:     parseJsonDates(r.comments as string ?? '[]', ['createdAt']),
    attachments:  JSON.parse(r.attachments as string ?? '[]'),
    links:             JSON.parse(r.links as string ?? '[]'),
    linkedProjectId:   r.linked_project_id ?? null,
    focusSeconds:      r.focus_seconds ?? 0,
  };
}

function parseJsonDates(json: string, dateKeys: string[]) {
  const arr = JSON.parse(json ?? '[]') as Record<string, unknown>[];
  return arr.map(item => {
    const out = { ...item };
    for (const k of dateKeys) {
      if (typeof out[k] === 'string') out[k] = new Date(out[k] as string);
    }
    return out;
  });
}

function taskToRow(t: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id:             t.id,
    number:         t.number,
    title:          t.title ?? '',
    description:    t.description ?? '',
    project_id:     t.projectId ?? null,
    parent_id:      t.parentId ?? null,
    section_id:     t.sectionId ?? null,
    due_date:       t.dueDate ? new Date(t.dueDate as string).toISOString() : null,
    start_minutes:  t.startMinutes ?? null,
    duration_min:   t.durationMin ?? null,
    priority:       t.priority ?? 'medium',
    completed:      t.completed ? 1 : 0,
    starred:        t.starred ? 1 : 0,
    someday:        t.someday ? 1 : 0,
    this_week:      t.thisWeek ? 1 : 0,
    waiting:        t.waiting ? 1 : 0,
    waiting_for:    t.waitingFor ?? null,
    today_date:     t.todayDate ?? null,
    recurrence:     t.recurrence ?? 'none',
    recurrence_end: t.recurrenceEnd ? new Date(t.recurrenceEnd as string).toISOString() : null,
    recur_interval: t.recurInterval ?? null,
    recur_unit:     t.recurUnit ?? null,
    recur_month_day: t.recurMonthDay ?? null,
    completed_at:   t.completedAt ? new Date(t.completedAt as string).toISOString() : null,
    created_at:     t.createdAt ? new Date(t.createdAt as string).toISOString() : now,
    updated_at:     now,
    nozbe_id:       t.nozbeId ?? null,
    sort_order:     t.sortOrder ?? 0,
    category_ids:   JSON.stringify(t.categoryIds ?? []),
    assignee_ids:   JSON.stringify(t.assigneeIds ?? []),
    comments:       JSON.stringify(t.comments ?? []),
    attachments:    JSON.stringify(t.attachments ?? []),
    links:              JSON.stringify(t.links ?? []),
    linked_project_id:  t.linkedProjectId ?? null,
    focus_seconds:      Math.max(0, Math.round(Number(t.focusSeconds ?? 0)) || 0),
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/tasks
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY sort_order ASC, created_at ASC').all();
  res.json(rows.map(r => rowToTask(r as Record<string, unknown>)));
});

// Clients pick #N from their own (possibly stale) view, so two devices can
// send the same number. The server has the last word: a number used by
// another task becomes max+1; the client adopts it from the reply.
function freeNumber(id: string, requested: unknown): number {
  const n = Number(requested);
  if (Number.isInteger(n) && n > 0 && !db.prepare('SELECT 1 FROM tasks WHERE number = ? AND id <> ?').get([n, id])) return n;
  const { max } = db.prepare('SELECT COALESCE(MAX(number), 0) AS max FROM tasks').get() as { max: number };
  return max + 1;
}

// POST /api/tasks/renumber-duplicates — one-shot repair of numbers shared by
// several tasks: the oldest keeps it, the rest get max+1, … (same as Appwrite).
router.post('/renumber-duplicates', (_req, res) => {
  const rows = db.prepare('SELECT id, number, created_at FROM tasks ORDER BY created_at ASC, id ASC').all() as { id: string; number: number }[];
  const seen = new Set<number>();
  let max = rows.reduce((m, r) => Math.max(m, Number(r.number) || 0), 0);
  const upd = db.prepare('UPDATE tasks SET number = ? WHERE id = ?');
  let renumbered = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (!(r.number > 0)) continue;
      if (!seen.has(r.number)) { seen.add(r.number); continue; }
      upd.run(++max, r.id);
      renumbered++;
    }
  })();
  res.json({ renumbered });
});

// POST /api/tasks
router.post('/', (req, res) => {
  const row = taskToRow(req.body);
  // A replayed create keeps the number it already got.
  const before = db.prepare('SELECT number FROM tasks WHERE id = ?').get(row.id as string) as { number: number } | undefined;
  row.number = before ? before.number : freeNumber(row.id as string, row.number);
  // Explicit column list (NOT positional VALUES) so a column added later via
  // ALTER TABLE — which SQLite appends at the end — can't shift the mapping.
  // INSERT OR REPLACE so a replayed offline-queue create is idempotent.
  db.prepare(`INSERT OR REPLACE INTO tasks
    (id,number,title,description,project_id,parent_id,section_id,
     due_date,start_minutes,duration_min,priority,completed,starred,
     someday,this_week,waiting,waiting_for,today_date,recurrence,recurrence_end,
     recur_interval,recur_unit,recur_month_day,completed_at,created_at,updated_at,
     nozbe_id,sort_order,category_ids,assignee_ids,comments,attachments,links,linked_project_id,focus_seconds)
    VALUES (
    @id,@number,@title,@description,@project_id,@parent_id,@section_id,
    @due_date,@start_minutes,@duration_min,@priority,@completed,@starred,
    @someday,@this_week,@waiting,@waiting_for,@today_date,@recurrence,@recurrence_end,
    @recur_interval,@recur_unit,@recur_month_day,@completed_at,@created_at,@updated_at,
    @nozbe_id,@sort_order,@category_ids,@assignee_ids,@comments,@attachments,@links,@linked_project_id,@focus_seconds
  )`).run(row);
  const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id as string);
  res.status(201).json(rowToTask(created as Record<string, unknown>));
});

// PATCH /api/tasks/reorder  (must be before /:id)
router.patch('/reorder', (req, res) => {
  // offset: the client sends long lists in chunks — chunk k starts at sort_order offset.
  const { ids, offset = 0 } = req.body as { ids: string[]; offset?: number };
  const upd = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(Number(offset) + i, id)))();
  res.status(204).end();
});

// PATCH /api/tasks/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const merged = taskToRow({ ...rowToTask(existing), ...req.body, id, updatedAt: new Date() });
  if (req.body.number !== undefined && Number(req.body.number) !== existing.number) {
    merged.number = freeNumber(id, req.body.number);
  }
  db.prepare(`UPDATE tasks SET
    number=@number, title=@title, description=@description, project_id=@project_id,
    parent_id=@parent_id, section_id=@section_id, due_date=@due_date,
    start_minutes=@start_minutes, duration_min=@duration_min, priority=@priority,
    completed=@completed, starred=@starred, someday=@someday, this_week=@this_week,
    waiting=@waiting, waiting_for=@waiting_for, today_date=@today_date, recurrence=@recurrence,
    recurrence_end=@recurrence_end, recur_interval=@recur_interval,
    recur_unit=@recur_unit, recur_month_day=@recur_month_day, updated_at=@updated_at,
    nozbe_id=@nozbe_id, sort_order=@sort_order, category_ids=@category_ids,
    assignee_ids=@assignee_ids, comments=@comments, attachments=@attachments, links=@links,
    linked_project_id=@linked_project_id, completed_at=@completed_at, focus_seconds=@focus_seconds
    WHERE id=@id`).run(merged);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return res.json(rowToTask(updated as Record<string, unknown>));
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE parent_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  })();
  res.status(204).end();
});

export default router;
