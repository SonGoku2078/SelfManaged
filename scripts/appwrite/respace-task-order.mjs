// One-time migration for #149: spread the manual order of top-level tasks out
// to sortOrder = index * 1024, keeping the exact current order. Afterwards a
// drag in the app writes one row instead of renumbering the whole list.
//
// Runs with the API key (server SDK) — not subject to the per-user write
// limit that made in-app renumbering take many minutes. Subtasks keep their
// own per-parent order and are not touched. Idempotent: rows that already
// have their target value are skipped.
//
//   node scripts/appwrite/respace-task-order.mjs                 # dry run
//   node scripts/appwrite/respace-task-order.mjs --apply
//   node scripts/appwrite/respace-task-order.mjs --order ids.json [--apply]
//
// --order: a JSON array of task ids (e.g. a pre-#149 reorder still queued on
// a device, which the new app drops) whose order wins over the server's.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Query, TablesDB } from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

const STEP = 1024;
const CONCURRENCY = 8;
const apply = process.argv.includes('--apply');
const orderArg = process.argv.indexOf('--order');
const orderFile = orderArg > 0 ? process.argv[orderArg + 1] : null;

const config = readLocalConfig(await fs.readFile(path.join(process.cwd(), '.appwrite.local'), 'utf8'));
const db = new TablesDB(
  new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY),
);
const databaseId = APPWRITE_IDS.database;

// Same order the app loads (apps/functions/api: sortOrder, then createdAt).
const { rows } = await db.listRows({
  databaseId,
  tableId: 'tasks',
  queries: [Query.select(['$id', 'sortOrder', 'parentId', 'createdAt']), Query.orderAsc('sortOrder'), Query.orderAsc('createdAt'), Query.limit(5000)],
  total: false,
});
let top = rows.filter((r) => !r.parentId).map((r) => r.$id);
console.log(`tasks: ${rows.length}, top level: ${top.length}`);

if (orderFile) {
  const wanted = JSON.parse(await fs.readFile(orderFile, 'utf8'));
  const isTop = new Set(top);
  const ordered = wanted.filter((id) => isTop.has(id));
  console.log(`order from ${orderFile}: ${wanted.length} ids, ${ordered.length} of them top-level tasks`);
  const inOrder = new Set(ordered);
  // Tasks the given order doesn't know (created later) stay behind the task
  // they follow on the server today.
  let prev = null;
  for (const id of top) {
    if (!inOrder.has(id)) {
      ordered.splice(prev === null ? 0 : ordered.indexOf(prev) + 1, 0, id);
      inOrder.add(id);
    }
    prev = id;
  }
  top = ordered;
}

const current = new Map(rows.map((r) => [r.$id, r.sortOrder]));
const changes = top.map((id, i) => [id, i * STEP]).filter(([id, v]) => current.get(id) !== v);
console.log(`rows to write: ${changes.length}${apply ? '' : '  (dry run — pass --apply to write)'}`);
if (!apply || !changes.length) process.exit(0);

let next = 0;
let done = 0;
const worker = async () => {
  while (next < changes.length) {
    const [rowId, sortOrder] = changes[next++];
    await db.updateRow({ databaseId, tableId: 'tasks', rowId, data: { sortOrder } });
    if (++done % 200 === 0) console.log(`  ${done}/${changes.length}`);
  }
};
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`done: ${done} rows written`);
