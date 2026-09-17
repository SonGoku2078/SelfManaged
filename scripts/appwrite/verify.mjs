import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Query, TablesDB } from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

const input = process.argv.find((arg) => !arg.startsWith('--') && arg.endsWith('.json'));
if (!input) throw new Error('Aufruf: node scripts/appwrite/verify.mjs <export.json>');
const expected = JSON.parse(await fs.readFile(input, 'utf8')).resources;
const config = readLocalConfig(await fs.readFile(path.join(process.cwd(), '.appwrite.local'), 'utf8'));
const db = new TablesDB(new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY));
const mappings = { tasks: 'tasks', projects: 'projects', categories: 'categories', members: 'members', sections: 'sections', blockers: 'blockers', savedViews: 'saved_views', activityLog: 'activity_log' };
let failed = false;
for (const [source, tableId] of Object.entries(mappings)) {
  const actual = await db.listRows({ databaseId: APPWRITE_IDS.database, tableId, queries: [Query.limit(1)], total: true });
  const wanted = expected[source]?.length ?? 0;
  const ok = actual.total === wanted;
  console.log(`${ok ? 'OK' : 'FAIL'} ${tableId}: source=${wanted} target=${actual.total}`);
  if (!ok) failed = true;
}
const settings = await db.listRows({ databaseId: APPWRITE_IDS.database, tableId: 'settings', queries: [Query.limit(1)], total: true });
const settingsExpected = Object.keys(expected.settings ?? {}).length;
console.log(`${settings.total === settingsExpected ? 'OK' : 'FAIL'} settings: source=${settingsExpected} target=${settings.total}`);
if (settings.total !== settingsExpected) failed = true;
if (failed) process.exitCode = 1;

