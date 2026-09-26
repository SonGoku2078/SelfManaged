// Nachtrag 2026-09-26 zu #96/#88/#98: reine Logik der Transport-Umschaltung
// zwischen Dev/Express (TM_API_URL) und Prod/Appwrite (APPWRITE_MCP_EMAIL/
// -PASSWORD) für apps/mcp UND apps/gpt-actions — kein Netz, kein echter
// Appwrite-Login. Siehe docs/pipeline/appwrite-prod-test-migration.md,
// Abschnitt "Nachtrag 2026-09-26".
// Run: npx tsx scripts/appwrite-transport.test.ts
import assert from 'node:assert';
import { resolveTransportMode, TransportConfigError } from '../apps/mcp/src/appwriteApi';

const env = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({ ...overrides } as NodeJS.ProcessEnv);

// ── Nur TM_API_URL gesetzt → Express-Modus ──────────────────────────────────
{
  const mode = resolveTransportMode(env({ TM_API_URL: 'http://localhost:3002' }));
  assert.deepEqual(mode, { kind: 'express', baseUrl: 'http://localhost:3002' }, 'Express-Modus aus TM_API_URL');
}
{
  // Trailing Slash wird entfernt, wie beim bisherigen readClassicBaseUrl().
  const mode = resolveTransportMode(env({ TM_API_URL: 'http://localhost:3002/' }));
  assert.deepEqual(mode, { kind: 'express', baseUrl: 'http://localhost:3002' }, 'Trailing Slash entfernt');
}

// ── Nur APPWRITE_MCP_EMAIL/-PASSWORD gesetzt → Appwrite-Modus ───────────────
{
  const mode = resolveTransportMode(env({ APPWRITE_MCP_EMAIL: 'a@b.de', APPWRITE_MCP_PASSWORD: 'geheim' }));
  assert.deepEqual(mode, { kind: 'appwrite' }, 'Appwrite-Modus aus E-Mail+Passwort');
}

// ── Beide gesetzt → Fehler (sich ausschließende Betriebsarten) ──────────────
assert.throws(
  () => resolveTransportMode(env({ TM_API_URL: 'http://localhost:3002', APPWRITE_MCP_EMAIL: 'a@b.de', APPWRITE_MCP_PASSWORD: 'geheim' })),
  (e: unknown) => e instanceof TransportConfigError && /ausschließ/.test((e as Error).message),
  'beide gesetzt → TransportConfigError',
);

// ── Weder noch gesetzt → Fehler ──────────────────────────────────────────────
assert.throws(
  () => resolveTransportMode(env({})),
  (e: unknown) => e instanceof TransportConfigError && /Weder TM_API_URL/.test((e as Error).message),
  'nichts gesetzt → TransportConfigError',
);

// ── Nur eine der beiden Appwrite-Variablen gesetzt → Fehler ─────────────────
assert.throws(
  () => resolveTransportMode(env({ APPWRITE_MCP_EMAIL: 'a@b.de' })),
  (e: unknown) => e instanceof TransportConfigError && /beide gesetzt sein/.test((e as Error).message),
  'nur E-Mail ohne Passwort → TransportConfigError',
);
assert.throws(
  () => resolveTransportMode(env({ APPWRITE_MCP_PASSWORD: 'geheim' })),
  (e: unknown) => e instanceof TransportConfigError && /beide gesetzt sein/.test((e as Error).message),
  'nur Passwort ohne E-Mail → TransportConfigError',
);

// ── TM_API_URL ohne http(s)-Schema → Fehler ─────────────────────────────────
assert.throws(
  () => resolveTransportMode(env({ TM_API_URL: 'localhost:3002' })),
  (e: unknown) => e instanceof TransportConfigError && /http:\/\/ oder https:\/\//.test((e as Error).message),
  'TM_API_URL ohne Schema → TransportConfigError',
);

// ── Passwort erscheint nie in einer Fehlermeldung ───────────────────────────
try {
  resolveTransportMode(env({ TM_API_URL: 'http://localhost:3002', APPWRITE_MCP_EMAIL: 'a@b.de', APPWRITE_MCP_PASSWORD: 'super-secret-pw' }));
  assert.fail('sollte werfen');
} catch (e) {
  assert.ok(!(e as Error).message.includes('super-secret-pw'), 'Passwort nicht in Fehlermeldung');
}

console.log('appwrite-transport.test.ts: alle Prüfungen bestanden.');
