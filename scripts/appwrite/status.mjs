import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Functions, Sites, Storage, TablesDB, Query, Users } from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

const root = process.cwd();
const config = readLocalConfig(await fs.readFile(path.join(root, '.appwrite.local'), 'utf8'));
const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const tables = new TablesDB(client);
const storage = new Storage(client);
const functions = new Functions(client);
const sites = new Sites(client);
const users = new Users(client);

const safe = async (label, fn) => {
  try { return await fn(); } catch (e) { console.log(`  !! ${label}: ${e.code ?? ''} ${e.message}`); return null; }
};

console.log(`# Projekt ${config.APPWRITE_PROJECT_ID} @ ${config.APPWRITE_ENDPOINT}\n`);

console.log('## Datenbank');
const db = await safe('database', () => tables.get({ databaseId: APPWRITE_IDS.database }));
if (db) {
  const list = await tables.listTables({ databaseId: APPWRITE_IDS.database, queries: [Query.limit(50)] });
  for (const t of list.tables) {
    const cols = await tables.listColumns({ databaseId: APPWRITE_IDS.database, tableId: t.$id, queries: [Query.limit(100)] });
    const idx = await tables.listIndexes({ databaseId: APPWRITE_IDS.database, tableId: t.$id, queries: [Query.limit(100)] });
    const rows = await safe(`rows ${t.$id}`, () => tables.listRows({ databaseId: APPWRITE_IDS.database, tableId: t.$id, queries: [Query.limit(1)] }));
    const bad = cols.columns.filter((c) => c.status !== 'available').map((c) => `${c.key}:${c.status}`);
    console.log(`  ${t.$id.padEnd(18)} cols=${cols.total} idx=${idx.total} rows=${rows?.total ?? '?'} ${bad.length ? 'PROBLEM ' + bad.join(',') : ''}`);
  }
}

console.log('\n## Bucket');
const bucket = await safe('bucket', () => storage.getBucket({ bucketId: APPWRITE_IDS.bucket }));
if (bucket) {
  const files = await safe('files', () => storage.listFiles({ bucketId: APPWRITE_IDS.bucket, queries: [Query.limit(1)] }));
  console.log(`  ${bucket.$id} enabled=${bucket.enabled} files=${files?.total ?? '?'}`);
}

console.log('\n## Functions');
for (const id of [APPWRITE_IDS.apiFunction, APPWRITE_IDS.icsFunction]) {
  const fn = await safe(`function ${id}`, () => functions.get({ functionId: id }));
  if (!fn) continue;
  console.log(`  ${id}: enabled=${fn.enabled} deployment=${fn.deploymentId || '(keine)'} scopes=${JSON.stringify(fn.scopes)}`);
  const deps = await safe('deployments', () => functions.listDeployments({ functionId: id, queries: [Query.limit(3), Query.orderDesc('$createdAt')] }));
  for (const d of deps?.deployments ?? []) console.log(`    - ${d.$id} status=${d.status} created=${d.$createdAt}`);
  const vars = await safe('vars', () => functions.listVariables({ functionId: id }));
  console.log(`    vars: ${(vars?.variables ?? []).map((v) => v.key).join(', ') || '(keine)'}`);
}

console.log('\n## Site');
const site = await safe('site', () => sites.get({ siteId: APPWRITE_IDS.site }));
if (site) {
  console.log(`  ${site.$id}: enabled=${site.enabled} deployment=${site.deploymentId || '(keine)'} framework=${site.framework}`);
  const deps = await safe('site deployments', () => sites.listDeployments({ siteId: APPWRITE_IDS.site, queries: [Query.limit(3), Query.orderDesc('$createdAt')] }));
  for (const d of deps?.deployments ?? []) console.log(`    - ${d.$id} status=${d.status} created=${d.$createdAt}`);
  const vars = await safe('site vars', () => sites.listVariables({ siteId: APPWRITE_IDS.site }));
  console.log(`    vars: ${(vars?.variables ?? []).map((v) => v.key).join(', ') || '(keine)'}`);
  const domains = await safe('domains', () => sites.listDeployments ? client.call('GET', new URL(`${config.APPWRITE_ENDPOINT}/proxy/rules?queries[0]=${encodeURIComponent(JSON.stringify({method:'equal',attribute:'deploymentResourceId',values:[APPWRITE_IDS.site]}))}`)) : null);
  if (domains) console.log(`    domains: ${(domains.rules ?? []).map((r) => r.domain).join(', ')}`);
}

console.log('\n## Users');
const u = await safe('users', () => users.list({ queries: [Query.limit(10)] }));
if (u) console.log(`  total=${u.total} ${u.users.map((x) => x.email || x.$id).join(', ')}`);
