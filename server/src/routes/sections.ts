import { Router } from 'express';
import { db } from '../db';

const router = Router();

function rowToSection(r: Record<string, unknown>) {
  return { id: r.id, scope: r.scope, name: r.name, sortOrder: r.sort_order ?? 0 };
}

router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM sections ORDER BY sort_order ASC').all().map(r => rowToSection(r as Record<string, unknown>)));
});

router.post('/', (req, res) => {
  const { id, scope, name, sortOrder } = req.body;
  db.prepare('INSERT OR REPLACE INTO sections VALUES (@id,@scope,@name,@sort_order)').run({ id, scope, name, sort_order: sortOrder ?? 0 });
  res.status(201).json(rowToSection(db.prepare('SELECT * FROM sections WHERE id=?').get(id) as Record<string, unknown>));
});

// Persist a new section order (must be before /:id so it isn't captured by it).
router.patch('/reorder', (req, res) => {
  // offset: the client sends long lists in chunks — chunk k starts at sort_order offset.
  const { ids, offset = 0 } = req.body as { ids: string[]; offset?: number };
  const upd = db.prepare('UPDATE sections SET sort_order = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => upd.run(Number(offset) + i, id)))();
  res.status(204).end();
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM sections WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: 'Not found' });
  const upd = { ...rowToSection(row), ...req.body, id };
  db.prepare('UPDATE sections SET scope=@scope, name=@name, sort_order=@sortOrder WHERE id=@id').run(upd);
  return res.json(rowToSection(db.prepare('SELECT * FROM sections WHERE id=?').get(id) as Record<string, unknown>));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM sections WHERE id=?').run(req.params.id);
  res.status(204).end();
});

export default router;
