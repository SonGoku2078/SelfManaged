import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client, Permission, Role, Storage, TablesDB, Teams } from 'node-appwrite';
import { APPWRITE_IDS, readLocalConfig } from './config.mjs';
import { TABLES } from './schema.mjs';

// Datenzugriff war bisher an Role.users() gebunden — jeder, der sich
// irgendwie ein Konto anlegt (Appwrite Cloud kennt fuer Email/Password
// keinen reinen "Login ohne Registrierung"-Schalter, der Umschalter in der
// Console deckt beides ab), haette vollen Lese-/Schreibzugriff auf alle
// echten Daten bekommen. Ersetzt das durch ein Team: nur Mitglieder haben
// Zugriff, neue Personen einladen = Team-Mitgliedschaft vergeben statt
// Registrierung erlauben.
const root = process.cwd();
const config = readLocalConfig(await fs.readFile(path.join(root, '.appwrite.local'), 'utf8'));
const adminUserId = process.argv[2];
if (!adminUserId) throw new Error('Aufruf: node scripts/appwrite/setup-team.mjs <admin-user-id>');

const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID).setKey(config.APPWRITE_API_KEY);
const teams = new Teams(client);
const tables = new TablesDB(client);
const storage = new Storage(client);

async function ensureTeam() {
  try {
    const team = await teams.get({ teamId: APPWRITE_IDS.team });
    console.log(`exists team ${team.$id}`);
    return team;
  } catch (e) {
    if (Number(e?.code) !== 404) throw e;
  }
  const team = await teams.create({ teamId: APPWRITE_IDS.team, name: 'SelfManaged' });
  console.log(`created team ${team.$id}`);
  return team;
}

async function ensureMembership(userId) {
  const existing = await teams.listMemberships({ teamId: APPWRITE_IDS.team });
  if (existing.memberships.some((m) => m.userId === userId)) {
    console.log(`exists membership for ${userId}`);
    return;
  }
  // userId statt email -> bestehender Nutzer wird direkt (ohne Einladungsmail)
  // als bestaetigtes Mitglied aufgenommen, da der Aufruf mit API-Key laeuft.
  await teams.createMembership({ teamId: APPWRITE_IDS.team, roles: ['owner'], userId });
  console.log(`added membership for ${userId} (owner)`);
}

const teamPermissions = [
  Permission.read(Role.team(APPWRITE_IDS.team)),
  Permission.create(Role.team(APPWRITE_IDS.team)),
  Permission.update(Role.team(APPWRITE_IDS.team)),
  Permission.delete(Role.team(APPWRITE_IDS.team)),
];

async function retagTablePermissions() {
  for (const table of TABLES) {
    const current = await tables.getTable({ databaseId: APPWRITE_IDS.database, tableId: table.id });
    await tables.updateTable({
      databaseId: APPWRITE_IDS.database,
      tableId: table.id,
      name: current.name,
      permissions: teamPermissions,
      rowSecurity: false,
    });
    console.log(`updated permissions: table ${table.id}`);
  }
}

async function retagBucketPermissions() {
  const bucket = await storage.getBucket({ bucketId: APPWRITE_IDS.bucket });
  await storage.updateBucket({
    bucketId: APPWRITE_IDS.bucket,
    name: bucket.name,
    permissions: teamPermissions,
    fileSecurity: false,
    enabled: true,
  });
  console.log(`updated permissions: bucket ${APPWRITE_IDS.bucket}`);
}

await ensureTeam();
await ensureMembership(adminUserId);
await retagTablePermissions();
await retagBucketPermissions();
console.log('\nFertig: Nur noch Team-Mitglieder haben Zugriff auf Tasks/Projekte/Anhaenge.');
console.log(`Weitere Person einladen: teams.createMembership({ teamId: '${APPWRITE_IDS.team}', roles: ['member'], email/userId: … }) — z. B. ueber die Appwrite-Konsole unter Auth -> Teams.`);
