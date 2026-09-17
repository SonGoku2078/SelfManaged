import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Sites, Proxy, Query } from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';

// Explicit, separate cutover step (never bundled into deploy-preview.mjs,
// which deliberately always leaves the site deployment inactive). Run this
// ONLY after the user has approved going live — it makes the Appwrite site
// the real, publicly reachable PROD instance.
const root = process.cwd();
const config = readLocalConfig(await fs.readFile(path.join(root, '.appwrite.local'), 'utf8'));
const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const sites = new Sites(client);
const proxy = new Proxy(client);

const site = await sites.get({ siteId: APPWRITE_IDS.site });
if (!site.latestDeploymentId || site.latestDeploymentStatus !== 'ready') {
  throw new Error(`Keine deploybereite Site-Deployment gefunden (status=${site.latestDeploymentStatus}). Erst "npm run appwrite:deploy-preview" ausführen.`);
}

// Stable domain tied to the SITE (not a specific deployment) — it always
// serves whichever deployment is currently active, unlike the per-deployment
// preview domains (*.appwrite.network per deploy) used during testing.
async function ensureSiteDomain() {
  const rules = await proxy.listRules({ queries: [Query.limit(100)] });
  // trigger:'manual' is what distinguishes OUR stable domain from the
  // auto-generated trigger:'deployment' preview-URL rule every deploy creates
  // — both share deploymentResourceType/-Id, so those two fields alone are
  // not enough to tell them apart.
  const existing = rules.rules.find((r) => r.trigger === 'manual' && r.deploymentResourceType === 'site' && r.deploymentResourceId === APPWRITE_IDS.site);
  if (existing) return `https://${existing.domain}`;
  const domain = `${APPWRITE_IDS.site}-${config.APPWRITE_PROJECT_ID.slice(0, 8)}.appwrite.network`;
  const rule = await proxy.createSiteRule({ domain, siteId: APPWRITE_IDS.site });
  return `https://${rule.domain}`;
}

const prodUrl = await ensureSiteDomain();
console.log(`Stabile PROD-Domain: ${prodUrl}`);

await sites.updateSiteDeployment({ siteId: APPWRITE_IDS.site, deploymentId: site.latestDeploymentId });
console.log(`Deployment ${site.latestDeploymentId} als aktiv gesetzt.`);

const after = await sites.get({ siteId: APPWRITE_IDS.site });
console.log(`Site live=${after.live} deploymentId=${after.deploymentId}`);
console.log(`\nPROD ist jetzt live unter: ${prodUrl}`);
