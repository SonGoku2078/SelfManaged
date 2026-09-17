import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { Client, Functions, Sites } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

const root = process.cwd();
const config = readLocalConfig(await fs.readFile(path.join(root, '.appwrite.local'), 'utf8'));
const out = path.join(root, 'outputs', 'appwrite-packages');
await fs.mkdir(out, { recursive: true });

function archive(name, directory, entries) {
  const target = path.join(out, `${name}.tar.gz`);
  // --force-local: on Windows, GNU tar otherwise reads the "C:" drive letter
  // as a "host:" remote-archive spec and tries to ssh out instead of writing
  // a local file. Harmless no-op on macOS/Linux.
  const result = spawnSync('tar', ['--force-local', '-czf', target, '-C', directory, ...entries], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar ${name} failed: ${result.stderr || result.stdout}`);
  return target;
}

async function waitFor(getDeployment, label) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const deployment = await getDeployment();
    console.log(`${label}: ${deployment.status}`);
    if (['ready', 'active'].includes(deployment.status)) return deployment;
    if (deployment.status === 'failed') throw new Error(`${label} failed:\n${deployment.buildLogs ?? deployment.buildStdout ?? ''}\n${deployment.buildErrors ?? deployment.buildStderr ?? ''}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`${label}: build timeout`);
}

const apiArchive = archive('selfmanaged-api', path.join(root, 'apps', 'functions', 'api'), ['package.json', 'package-lock.json', 'src']);
const icsArchive = archive('selfmanaged-ics', path.join(root, 'apps', 'functions', 'ics'), ['package.json', 'package-lock.json', 'src']);
const siteArchive = archive('selfmanaged-site', path.join(root, 'dist', 'appwrite'), ['.']);

const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const functions = new Functions(client);
const sites = new Sites(client);

const api = await functions.createDeployment({ functionId: APPWRITE_IDS.apiFunction, code: InputFile.fromPath(apiArchive), activate: true, entrypoint: 'src/main.js', commands: 'npm ci' });
await waitFor(() => functions.getDeployment({ functionId: APPWRITE_IDS.apiFunction, deploymentId: api.$id }), 'API function');

const ics = await functions.createDeployment({ functionId: APPWRITE_IDS.icsFunction, code: InputFile.fromPath(icsArchive), activate: true, entrypoint: 'src/main.js', commands: 'npm ci' });
await waitFor(() => functions.getDeployment({ functionId: APPWRITE_IDS.icsFunction, deploymentId: ics.$id }), 'ICS function');

const site = await sites.createDeployment({ siteId: APPWRITE_IDS.site, code: InputFile.fromPath(siteArchive), installCommand: '', buildCommand: '', outputDirectory: '.', activate: false });
await waitFor(() => sites.getDeployment({ siteId: APPWRITE_IDS.site, deploymentId: site.$id }), 'Site preview');

console.log(`API deployment: ${api.$id} (active)`);
console.log(`ICS deployment: ${ics.$id} (active)`);
console.log(`Site deployment: ${site.$id} (ready, NOT active)`);
