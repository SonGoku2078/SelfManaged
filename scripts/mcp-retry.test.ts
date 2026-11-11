// Nachfassen bei Netzaussetzern zu Appwrite (apps/mcp/src/retry.ts). Kein Netz.
// Run: npx tsx scripts/mcp-retry.test.ts
import assert from 'node:assert';
import { isNetworkError, isRetryable, withRetry } from '../apps/mcp/src/retry';

// so wirft Node/undici: TypeError „fetch failed“ mit cause
const fetchFailed = (code?: string) => Object.assign(new TypeError('fetch failed'), code ? { cause: Object.assign(new Error(code), { code }) } : {});
const connect = fetchFailed('UND_ERR_CONNECT_TIMEOUT');
const reset = fetchFailed('ECONNRESET');
const server = Object.assign(new Error('Appwrite antwortete 500'), { status: 500 });

assert.equal(isNetworkError(connect), true);
assert.equal(isNetworkError(fetchFailed()), true, 'ohne Code, aber fetch failed');
assert.equal(isNetworkError(server), false);
assert.equal(isRetryable(connect, 'POST'), true, 'Verbindung nie zustande gekommen: auch schreibend');
assert.equal(isRetryable(reset, 'GET'), true, 'lesend: jeder Netzfehler');
assert.equal(isRetryable(reset, 'PATCH'), false, 'schreibend: könnte angekommen sein');
assert.equal(isRetryable(fetchFailed(), 'POST'), false, 'schreibend ohne Code: nicht raten');
assert.equal(isRetryable(server, 'GET'), false, 'Antwort des Servers nie');
// AggregateError (IPv4 und IPv6 gescheitert)
assert.equal(isRetryable(Object.assign(new TypeError('fetch failed'), { cause: new AggregateError([Object.assign(new Error('x'), { code: 'ETIMEDOUT' })]) }), 'DELETE'), true);

const noSleep = async () => {};
async function run() {
  let n = 0;
  assert.equal(await withRetry(async () => { if (++n < 3) throw connect; return 'ok'; }, 'POST', [1, 1], noSleep), 'ok');
  assert.equal(n, 3, 'zweimal nachgefasst');

  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw connect; }, 'GET', [1, 1], noSleep), /fetch failed/);
  assert.equal(n, 3, 'höchstens 3 Versuche');

  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw server; }, 'GET', [1, 1], noSleep), /500/);
  assert.equal(n, 1, 'Serverantwort: kein zweiter Versuch');

  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw reset; }, 'PATCH', [1, 1], noSleep));
  assert.equal(n, 1, 'schreibend nach Abbruch: kein zweiter Versuch (sonst doppelt)');

  const waited: number[] = [];
  n = 0;
  await withRetry(async () => { if (++n < 3) throw connect; }, 'GET', [500, 1500], async (ms) => { waited.push(ms); });
  assert.deepEqual(waited, [500, 1500]);
  console.log('mcp-retry.test.ts: alle Prüfungen bestanden ✔');
}
run().catch((e) => { console.error(e); process.exit(1); });
