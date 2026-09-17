import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Query, Storage, TablesDB } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';
import { REQUIRED_DEFAULTS } from './schema.mjs';

const input = process.argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.json'));
if (!input) throw new Error('Aufruf: node scripts/appwrite/import-export.mjs <export.json> [--replace]');
const replace = process.argv.includes('--replace');
const config = readLocalConfig(await fs.readFile(path.join(process.cwd(), '.appwrite.local'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(input, 'utf8'));
if (manifest.format !== 'selfmanaged-appwrite-migration' || manifest.version !== 1) throw new Error('Unbekanntes Exportformat');

const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const db = new TablesDB(client);
const storage = new Storage(client);

function stableRowId(value) {
  const id = String(value ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(id) ? id : crypto.createHash('sha256').update(id).digest('hex').slice(0, 36);
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function taskData(task, attachments) {
  const now = new Date().toISOString();
  return withoutUndefined({
    legacyId: String(task.id), number: Number(task.number), title: task.title ?? '', description: task.description ?? '',
    projectId: task.projectId ?? null, parentId: task.parentId ?? null, sectionId: task.sectionId ?? null,
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null, startMinutes: task.startMinutes ?? null, durationMin: task.durationMin ?? null,
    priority: task.priority ?? 'medium', completed: Boolean(task.completed), starred: Boolean(task.starred), someday: Boolean(task.someday),
    thisWeek: Boolean(task.thisWeek), waiting: Boolean(task.waiting), waitingFor: task.waitingFor ?? null, todayDate: task.todayDate ?? null,
    recurrence: task.recurrence ?? 'none', recurrenceEnd: task.recurrenceEnd ? new Date(task.recurrenceEnd).toISOString() : null,
    recurInterval: task.recurInterval ?? null, recurUnit: task.recurUnit ?? null, recurMonthDay: task.recurMonthDay ?? null,
    completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
    createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : now, updatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : now,
    nozbeId: task.nozbeId ?? null, sortOrder: Number(task.sortOrder ?? 0), categoryIds: task.categoryIds ?? [], assigneeIds: task.assigneeIds ?? [],
    commentsJson: JSON.stringify(task.comments ?? []), attachmentsJson: JSON.stringify(attachments), linksJson: JSON.stringify(task.links ?? []),
    linkedProjectId: task.linkedProjectId ?? null, focusSeconds: Math.max(0, Math.round(Number(task.focusSeconds ?? 0)) || 0),
  });
}

// Fehlende Pflichtfelder auffüllen. Die alte SQLite-API liefert nicht für jede
// Ressource jede Spalte (z. B. categories ohne sortOrder) — Appwrite lehnt eine
// Pflichtspalte ohne Wert mit 400 ab. `index` hält dabei die Quellreihenfolge.
function withRequiredDefaults(tableId, data, index) {
  const defaults = REQUIRED_DEFAULTS[tableId] ?? {};
  for (const [key, value] of Object.entries(defaults)) {
    if (data[key] !== undefined && data[key] !== null) continue;
    data[key] = key === 'sortOrder' ? index : value;
  }
  return data;
}

// Some real member avatars are inline `data:` URLs from the old SQLite
// column (real ones seen in PROD run well past 300KB as base64 text) —
// Appwrite's `text` column type caps out at 65535 bytes, so importing them
// verbatim fails the whole run with a 400. Same fix as task attachments:
// upload the bytes to Storage and store a short view URL + fileId instead.
async function migrateAvatarIfNeeded(member) {
  const dataUrl = member.avatarUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return member;
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
  if (!match) throw new Error(`Ungültige Avatar-Data-URL für Mitglied ${member.id}`);
  const fileId = stableRowId(`avatar-${member.id}`);
  const bytes = Buffer.from(match[2], 'base64');
  try { await storage.createFile({ bucketId: APPWRITE_IDS.bucket, fileId, file: InputFile.fromBuffer(bytes, `${member.id}.jpg`) }); }
  catch (error) { if (Number(error?.code) !== 409) throw error; }
  const url = `${config.APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_IDS.bucket}/files/${fileId}/view?project=${encodeURIComponent(config.APPWRITE_PROJECT_ID)}`;
  return { ...member, avatarUrl: url, avatarFileId: fileId };
}

async function simpleData(resource, item) {
  const source = resource === 'members' ? await migrateAvatarIfNeeded(item) : item;
  const data = { ...source, legacyId: String(source.id) };
  delete data.id;
  if (resource === 'saved_views') { data.filtersJson = JSON.stringify(data.filters ?? {}); delete data.filters; }
  if (resource === 'activity_log') {
    data.at = new Date(data.at).toISOString();
    data.fromValue = data.from ?? null; data.toValue = data.to ?? null; data.payloadJson = data.payload ? JSON.stringify(data.payload) : null;
    delete data.from; delete data.to; delete data.payload;
  }
  return withoutUndefined(data);
}

const resourceMap = {
  projects: ['projects', manifest.resources.projects], categories: ['categories', manifest.resources.categories],
  members: ['members', manifest.resources.members], sections: ['sections', manifest.resources.sections], blockers: ['blockers', manifest.resources.blockers],
  saved_views: ['saved_views', manifest.resources.savedViews], activity_log: ['activity_log', manifest.resources.activityLog],
};

const targetTables = ['task_attachments', 'tasks', 'activity_log', 'saved_views', 'blockers', 'sections', 'members', 'categories', 'projects', 'settings'];
for (const tableId of targetTables) {
  const existing = await db.listRows({ databaseId: APPWRITE_IDS.database, tableId, queries: [Query.limit(1)], total: true });
  if (existing.total > 0 && !replace) throw new Error(`${tableId} enthält bereits ${existing.total} Zeilen. Für einen bewusst destruktiven Neuimport --replace verwenden.`);
}

if (replace) {
  for (const tableId of targetTables) {
    for (;;) {
      const page = await db.listRows({ databaseId: APPWRITE_IDS.database, tableId, queries: [Query.limit(100)], total: false });
      if (!page.rows.length) break;
      for (const row of page.rows) await db.deleteRow({ databaseId: APPWRITE_IDS.database, tableId, rowId: row.$id });
    }
  }
}

for (const [resource, [tableId, items]] of Object.entries(resourceMap)) {
  const list = items ?? [];
  for (const [index, item] of list.entries()) {
    const data = withRequiredDefaults(tableId, await simpleData(resource, item), index);
    await db.upsertRow({ databaseId: APPWRITE_IDS.database, tableId, rowId: stableRowId(item.id), data });
  }
  console.log(`${tableId}: ${list.length} importiert`);
}

for (const [key, value] of Object.entries(manifest.resources.settings ?? {})) {
  await db.upsertRow({ databaseId: APPWRITE_IDS.database, tableId: 'settings', rowId: stableRowId(key), data: { key, valueJson: JSON.stringify(value) } });
}
console.log(`settings: ${Object.keys(manifest.resources.settings ?? {}).length} importiert`);

let fileCount = 0;
for (const task of manifest.resources.tasks ?? []) {
  const migrated = [];
  for (const attachment of task.attachments ?? []) {
    if (typeof attachment.dataUrl === 'string' && attachment.dataUrl.startsWith('data:')) {
      const match = attachment.dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
      if (!match) throw new Error(`Ungültiger Data-URL-Anhang ${attachment.id} an Task ${task.id}`);
      const fileId = stableRowId(`file-${attachment.id}`);
      const bytes = Buffer.from(match[2], 'base64');
      try { await storage.createFile({ bucketId: APPWRITE_IDS.bucket, fileId, file: InputFile.fromBuffer(bytes, attachment.name) }); }
      catch (error) { if (Number(error?.code) !== 409) throw error; }
      const url = `${config.APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_IDS.bucket}/files/${fileId}/view?project=${encodeURIComponent(config.APPWRITE_PROJECT_ID)}`;
      const meta = { ...attachment, dataUrl: undefined, url };
      delete meta.dataUrl;
      migrated.push(meta);
      await db.upsertRow({ databaseId: APPWRITE_IDS.database, tableId: 'task_attachments', rowId: stableRowId(attachment.id), data: { legacyId: String(attachment.id), taskId: String(task.id), fileId, name: attachment.name, mimeType: attachment.type ?? match[1] ?? 'application/octet-stream', size: bytes.length, createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : new Date().toISOString() } });
      fileCount += 1;
    } else migrated.push(attachment);
  }
  await db.upsertRow({ databaseId: APPWRITE_IDS.database, tableId: 'tasks', rowId: stableRowId(task.id), data: taskData(task, migrated) });
}
console.log(`tasks: ${(manifest.resources.tasks ?? []).length} importiert; Dateien: ${fileCount}`);
