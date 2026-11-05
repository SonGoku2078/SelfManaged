// One-time repair: completing a recurring task used to spawn the next
// occurrence with comments/attachments cleared, so notes imported from Nozbe
// (e.g. a URL) only lived on a completed predecessor. This copies the comments
// and attachments of every completed occurrence of a series into its one open
// occurrence. Predecessors are not touched. Idempotent: entries already present
// (same id, or same text/name) are skipped.
//
// A series = top-level recurring tasks with the same title + project.
//
//   node scripts/appwrite/carry-recurring-comments.mjs                       # dry run
//   node scripts/appwrite/carry-recurring-comments.mjs --skip "Keep Focus" --apply
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Query, TablesDB } from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

const apply = process.argv.includes('--apply');
const skip = new Set(
  process.argv.flatMap((arg, i) => (process.argv[i - 1] === '--skip' ? [arg.trim().toLowerCase()] : [])),
);

const config = readLocalConfig(await fs.readFile(path.join(process.cwd(), '.appwrite.local'), 'utf8'));
const db = new TablesDB(
  new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY),
);
const databaseId = APPWRITE_IDS.database;

const { rows } = await db.listRows({
  databaseId,
  tableId: 'tasks',
  queries: [
    Query.select(['$id', 'number', 'title', 'projectId', 'parentId', 'recurrence', 'completed', 'dueDate', 'createdAt', 'commentsJson', 'attachmentsJson']),
    Query.isNull('parentId'),
    Query.notEqual('recurrence', 'none'),
    Query.limit(5000),
  ],
  total: false,
});

const parse = (json) => {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const series = new Map();
for (const r of rows) {
  const key = `${(r.title ?? '').trim().toLowerCase()}\u0000${r.projectId ?? ''}`;
  if (!series.has(key)) series.set(key, []);
  series.get(key).push(r);
}

const changes = [];
for (const group of series.values()) {
  const title = group[0].title;
  if (skip.has(title.trim().toLowerCase())) continue;
  const open = group.filter((r) => !r.completed);
  const done = group
    .filter((r) => r.completed)
    .sort((a, b) => String(a.dueDate ?? a.createdAt).localeCompare(String(b.dueDate ?? b.createdAt)));
  if (!done.length) continue;
  if (open.length !== 1) {
    if (done.some((r) => parse(r.commentsJson).length || parse(r.attachmentsJson).length))
      console.log(`⚠ übersprungen (${open.length} offene Instanzen): "${title}"`);
    continue;
  }
  const target = open[0];
  const comments = parse(target.commentsJson);
  const attachments = parse(target.attachmentsJson);
  const commentKeys = new Set(comments.flatMap((c) => [c.id, (c.text ?? '').trim()]));
  const attachmentKeys = new Set(attachments.flatMap((a) => [a.id, a.url || a.name]));
  // Oldest first, ahead of the target's own (newer) entries.
  const addC = [];
  const addA = [];
  for (const r of done) {
    for (const c of parse(r.commentsJson)) {
      if (commentKeys.has(c.id) || commentKeys.has((c.text ?? '').trim())) continue;
      commentKeys.add(c.id).add((c.text ?? '').trim());
      addC.push(c);
    }
    for (const a of parse(r.attachmentsJson)) {
      if (attachmentKeys.has(a.id) || attachmentKeys.has(a.url || a.name)) continue;
      attachmentKeys.add(a.id).add(a.url || a.name);
      addA.push(a);
    }
  }
  if (!addC.length && !addA.length) continue;
  changes.push({ target, addC, addA, comments: [...addC, ...comments], attachments: [...addA, ...attachments] });
}

for (const { target, addC, addA } of changes) {
  console.log(`#${target.number} "${target.title}"  +${addC.length} Kommentar(e), +${addA.length} Anhang/Anhänge`);
  for (const c of addC) console.log(`    💬 ${String(c.text ?? '').replace(/\s+/g, ' ').slice(0, 90)}`);
  for (const a of addA) console.log(`    📎 ${a.name}${a.url ? ` (${a.url})` : ''}`);
}
console.log(`\nTasks zu aktualisieren: ${changes.length}${apply ? '' : '  (Probelauf — mit --apply schreiben)'}`);
if (!apply) process.exit(0);

for (const { target, comments, attachments } of changes) {
  await db.updateRow({
    databaseId,
    tableId: 'tasks',
    rowId: target.$id,
    data: { commentsJson: JSON.stringify(comments), attachmentsJson: JSON.stringify(attachments), updatedAt: new Date().toISOString() },
  });
}
console.log(`✅ ${changes.length} Tasks aktualisiert.`);
