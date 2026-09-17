import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
let baseUrl = sourceArg?.slice('--source='.length) ?? '';

if (!baseUrl) {
  const localDeploy = JSON.parse(await fs.readFile(path.join(process.cwd(), 'scripts', 'deploy.local.json'), 'utf8'));
  baseUrl = String(localDeploy.healthUrl).replace(/\/health\/?$/, '');
}
baseUrl = baseUrl.replace(/\/+$/, '');

const endpoints = {
  tasks: '/api/tasks',
  projects: '/api/projects',
  categories: '/api/categories',
  members: '/api/members',
  sections: '/api/sections',
  blockers: '/api/blockers',
  savedViews: '/api/saved-views',
  activityLog: '/api/activity-log',
  settings: '/api/settings',
};

async function fetchJson(route) {
  const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

const resources = Object.fromEntries(await Promise.all(
  Object.entries(endpoints).map(async ([name, route]) => [name, await fetchJson(route)]),
));

const manifest = {
  format: 'selfmanaged-appwrite-migration',
  version: 1,
  source: baseUrl,
  exportedAt: new Date().toISOString(),
  resources,
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = outputArg?.slice('--output='.length) ?? path.join('outputs', `appwrite-prod-export-${stamp}.json`);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });

console.log(`Export geschrieben: ${output}`);
for (const [name, value] of Object.entries(resources)) {
  console.log(`${name}: ${Array.isArray(value) ? value.length : Object.keys(value).length}`);
}

