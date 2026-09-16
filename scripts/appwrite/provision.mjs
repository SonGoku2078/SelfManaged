import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  Client, Permission, Query, Role, Storage, TablesDB, TablesDBIndexType,
} from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';
import { TABLES } from './schema.mjs';

const root = process.cwd();
const config = readLocalConfig(fs.readFileSync(path.join(root, '.appwrite.local'), 'utf8'));
const dryRun = process.argv.includes('--dry-run');

for (const key of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY']) {
  if (!config[key]) throw new Error(`${key} fehlt in .appwrite.local`);
}

const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const tables = new TablesDB(client);
const storage = new Storage(client);
const userPermissions = [Permission.read(Role.users()), Permission.create(Role.users()), Permission.update(Role.users()), Permission.delete(Role.users())];

const log = (message) => console.log(`${dryRun ? '[PLAN] ' : ''}${message}`);
const isConflict = (error) => Number(error?.code) === 409;

async function ensure(label, create) {
  if (dryRun) return log(`ensure ${label}`);
  try { await create(); log(`created ${label}`); }
  catch (error) { if (isConflict(error)) log(`exists ${label}`); else throw error; }
}

async function ensureById(label, get, create) {
  if (dryRun) return log(`ensure ${label}`);
  try { await get(); log(`exists ${label}`); return; }
  catch (error) { if (Number(error?.code) !== 404) throw error; }
  await create();
  log(`created ${label}`);
}

async function createColumn(tableId, column) {
  const common = { databaseId: APPWRITE_IDS.database, tableId, key: column.key, required: column.required };
  const xdefault = column.required ? undefined : column.xdefault;
  if (column.type === 'varchar') return tables.createVarcharColumn({ ...common, size: column.size, xdefault, array: column.array ?? false });
  if (column.type === 'text') return tables.createTextColumn({ ...common, xdefault });
  if (column.type === 'longtext') return tables.createLongtextColumn({ ...common, xdefault });
  if (column.type === 'integer') return tables.createIntegerColumn({ ...common, min: column.min, max: column.max, xdefault, array: column.array ?? false });
  if (column.type === 'boolean') return tables.createBooleanColumn({ ...common, xdefault });
  if (column.type === 'datetime') return tables.createDatetimeColumn(common);
  throw new Error(`Unknown column type ${column.type}`);
}

async function waitForColumns(table) {
  if (dryRun) return;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await tables.listColumns({ databaseId: APPWRITE_IDS.database, tableId: table.id, queries: [Query.limit(100)], total: false });
    const selected = result.columns.filter((column) => table.columns.some((expected) => expected.key === column.key));
    const failed = selected.find((column) => column.status === 'failed');
    if (failed) throw new Error(`Column ${table.id}.${failed.key} failed: ${failed.error ?? 'unknown error'}`);
    if (selected.length === table.columns.length && selected.every((column) => column.status === 'available')) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timeout waiting for columns in ${table.id}`);
}

log(`project ${config.APPWRITE_PROJECT_ID} at ${config.APPWRITE_ENDPOINT}`);
await ensureById(
  `database ${APPWRITE_IDS.database}`,
  () => tables.get({ databaseId: APPWRITE_IDS.database }),
  () => tables.create({ databaseId: APPWRITE_IDS.database, name: 'SelfManaged PROD' }),
);

for (const table of TABLES) {
  await ensure(`table ${table.id}`, () => tables.createTable({ databaseId: APPWRITE_IDS.database, tableId: table.id, name: table.name, permissions: userPermissions, rowSecurity: false }));
  for (const column of table.columns) await ensure(`column ${table.id}.${column.key}`, () => createColumn(table.id, column));
  await waitForColumns(table);
  for (const index of table.indexes) {
    await ensure(`index ${table.id}.${index.key}`, () => tables.createIndex({
      databaseId: APPWRITE_IDS.database,
      tableId: table.id,
      key: index.key,
      type: index.type === 'unique' ? TablesDBIndexType.Unique : TablesDBIndexType.Key,
      columns: index.columns,
      orders: index.orders,
    }));
  }
}

await ensureById(
  `bucket ${APPWRITE_IDS.bucket}`,
  () => storage.getBucket({ bucketId: APPWRITE_IDS.bucket }),
  () => storage.createBucket({
    bucketId: APPWRITE_IDS.bucket,
    name: 'Task attachments',
    permissions: userPermissions,
    fileSecurity: false,
    enabled: true,
    maximumFileSize: 50_000_000,
    encryption: true,
    antivirus: true,
  }),
);

log('schema provisioning complete');
