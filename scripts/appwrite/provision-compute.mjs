import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  Adapter, BuildRuntime, Client, Framework, Functions, ProjectKeyScopes, Proxy, Query, Role, Runtime, Sites,
} from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

const root = process.cwd();
const localPath = path.join(root, '.appwrite.local');
const runtimePath = path.join(root, '.appwrite.runtime.local');
const config = readLocalConfig(await fs.readFile(localPath, 'utf8'));
let runtime = {};
try { runtime = readLocalConfig(await fs.readFile(runtimePath, 'utf8')); } catch { /* first run */ }
if (!runtime.ICS_TOKEN) {
  runtime.ICS_TOKEN = crypto.randomBytes(32).toString('base64url');
  await fs.writeFile(runtimePath, `ICS_TOKEN=${runtime.ICS_TOKEN}\n`, { encoding: 'utf8', flag: 'wx' });
}

const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const functions = new Functions(client);
const sites = new Sites(client);
const proxy = new Proxy(client);
const region = new URL(config.APPWRITE_ENDPOINT).hostname.split('.')[0];

// Eine per API angelegte Function bekommt — anders als eine in der Konsole
// angelegte — KEINE Domain. Ohne Proxy-Regel ist sie über HTTP nicht
// erreichbar; die früher hier geratene Adresse <functionId>.<region>.appwrite.run
// existierte nicht. Domain deshalb suchen und nur anlegen, wenn sie fehlt.
async function ensureFunctionDomain(functionId) {
  const rules = await proxy.listRules({ queries: [Query.limit(100)] });
  const existing = rules.rules.find((rule) => rule.deploymentResourceType === 'function' && rule.deploymentResourceId === functionId);
  if (existing) {
    console.log(`exists domain ${existing.domain} -> ${functionId}`);
    return `https://${existing.domain}`;
  }
  const domain = `${functionId}-${config.APPWRITE_PROJECT_ID.slice(0, 8)}.${region}.appwrite.run`;
  try {
    const rule = await proxy.createFunctionRule({ domain, functionId });
    console.log(`created domain ${rule.domain} -> ${functionId}`);
    return `https://${rule.domain}`;
  } catch (error) {
    throw new Error(
      `Domain für ${functionId} konnte nicht angelegt werden (${error.code} ${error.message}).\n`
      + 'Entweder dem API-Key in der Appwrite-Konsole den Scope "rules.write" geben '
      + `oder die Domain dort manuell unter Functions → ${functionId} → Domains anlegen.`,
    );
  }
}

async function ensureById(label, get, create) {
  try { const value = await get(); console.log(`exists ${label}`); return value; }
  catch (error) { if (Number(error?.code) !== 404) throw error; }
  const value = await create();
  console.log(`created ${label}`);
  return value;
}

async function upsertFunctionVariable(functionId, variableId, key, value, secret = false) {
  try {
    await functions.getVariable({ functionId, variableId });
    await functions.updateVariable({ functionId, variableId, key, value, secret });
    console.log(`updated variable ${functionId}.${key}`);
  } catch (error) {
    if (Number(error?.code) !== 404) throw error;
    await functions.createVariable({ functionId, variableId, key, value, secret });
    console.log(`created variable ${functionId}.${key}`);
  }
}

async function upsertSiteVariable(variableId, key, value) {
  try {
    await sites.getVariable({ siteId: APPWRITE_IDS.site, variableId });
    await sites.updateVariable({ siteId: APPWRITE_IDS.site, variableId, key, value, secret: false });
    console.log(`updated site variable ${key}`);
  } catch (error) {
    if (Number(error?.code) !== 404) throw error;
    await sites.createVariable({ siteId: APPWRITE_IDS.site, variableId, key, value, secret: false });
    console.log(`created site variable ${key}`);
  }
}

await ensureById(
  `function ${APPWRITE_IDS.apiFunction}`,
  () => functions.get({ functionId: APPWRITE_IDS.apiFunction }),
  () => functions.create({
    functionId: APPWRITE_IDS.apiFunction,
    name: 'SelfManaged API',
    runtime: Runtime.Node22,
    execute: [Role.any()],
    timeout: 30,
    enabled: true,
    logging: true,
    entrypoint: 'src/main.js',
    commands: 'npm ci',
    scopes: [],
    deploymentRetention: 14,
  }),
);

await ensureById(
  `function ${APPWRITE_IDS.icsFunction}`,
  () => functions.get({ functionId: APPWRITE_IDS.icsFunction }),
  () => functions.create({
    functionId: APPWRITE_IDS.icsFunction,
    name: 'SelfManaged ICS',
    runtime: Runtime.Node22,
    execute: [Role.any()],
    timeout: 30,
    enabled: true,
    logging: true,
    entrypoint: 'src/main.js',
    commands: 'npm ci',
    scopes: [ProjectKeyScopes.RowsRead],
    deploymentRetention: 14,
  }),
);

const apiUrl = await ensureFunctionDomain(APPWRITE_IDS.apiFunction);
const icsUrl = await ensureFunctionDomain(APPWRITE_IDS.icsFunction);

await upsertFunctionVariable(APPWRITE_IDS.apiFunction, 'ics-token', 'ICS_TOKEN', runtime.ICS_TOKEN, true);
await upsertFunctionVariable(APPWRITE_IDS.apiFunction, 'ics-base-url', 'ICS_PUBLIC_BASE_URL', icsUrl, false);
await upsertFunctionVariable(APPWRITE_IDS.icsFunction, 'ics-function-token', 'ICS_TOKEN', runtime.ICS_TOKEN, true);

await ensureById(
  `site ${APPWRITE_IDS.site}`,
  () => sites.get({ siteId: APPWRITE_IDS.site }),
  () => sites.create({
    siteId: APPWRITE_IDS.site,
    name: 'SelfManaged PROD',
    framework: Framework.Vite,
    buildRuntime: BuildRuntime.Node22,
    enabled: true,
    logging: true,
    timeout: 15,
    installCommand: 'npm ci',
    buildCommand: 'npm run build:appwrite',
    outputDirectory: 'dist/appwrite',
    adapter: Adapter.Static,
    fallbackFile: 'index.html',
    deploymentRetention: 14,
    scopes: [],
  }),
);

await upsertSiteVariable('deploy-target', 'VITE_DEPLOY_TARGET', 'appwrite');
await upsertSiteVariable('appwrite-endpoint', 'VITE_APPWRITE_ENDPOINT', config.APPWRITE_ENDPOINT);
await upsertSiteVariable('appwrite-project', 'VITE_APPWRITE_PROJECT_ID', config.APPWRITE_PROJECT_ID);
await upsertSiteVariable('appwrite-api-url', 'VITE_APPWRITE_API_URL', apiUrl);
await upsertSiteVariable('app-env', 'VITE_APP_ENV', 'production');

// Der lokale Appwrite-Build (`npm run build:appwrite`) liest .env.appwrite und
// muss dieselbe API-Domain treffen wie ein Build in der Appwrite-Site.
await fs.writeFile(path.join(root, '.env.appwrite'), [
  'VITE_DEPLOY_TARGET=appwrite',
  'VITE_APP_ENV=production',
  `VITE_APPWRITE_ENDPOINT=${config.APPWRITE_ENDPOINT}`,
  `VITE_APPWRITE_PROJECT_ID=${config.APPWRITE_PROJECT_ID}`,
  `VITE_APPWRITE_API_URL=${apiUrl}`,
  '',
].join('\n'), 'utf8');

console.log(`API domain: ${apiUrl}`);
console.log(`ICS domain: ${icsUrl}`);
console.log(`ICS feed:   ${icsUrl}/calendar/<ICS_TOKEN>.ics`);
console.log('Compute resources provisioned; no code deployment was activated.');
