// Nachfassen bei Netzaussetzern zu Appwrite (Second Brain, 05.11.2026): Der Verbindungsaufbau zur
// Appwrite-Cloud braucht zeitweise über 10 s (gemessen 0,8–15 s, auch mit curl). Node gibt nach 10 s
// mit „fetch failed“ (UND_ERR_CONNECT_TIMEOUT) auf, und der ganze Werkzeug-Aufruf scheitert.
//
// Sicher wiederholbar ist ein Aufruf nur, wenn er den Server sicher nicht erreicht hat:
// - Verbindungsaufbau gescheitert (Codes unten): immer, auch bei POST/PATCH/DELETE.
// - Lesend (GET): jeder Netzfehler (auch Abbruch mitten in der Antwort).
// Antworten des Servers (z. B. 4xx/5xx) werden nie wiederholt.

/** Fehlercodes, bei denen die Anfrage den Server nicht erreicht hat. */
const CONNECT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN',
]);

/** Fehlercodes der Kette (Fehler → cause → …), z. B. TypeError „fetch failed“ → ConnectTimeoutError. */
function codes(e: unknown): string[] {
  const out: string[] = [];
  for (let cur = e, depth = 0; cur && typeof cur === 'object' && depth < 6; depth++) {
    const c = cur as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof c.code === 'string') out.push(c.code);
    if (Array.isArray(c.errors)) for (const x of c.errors) out.push(...codes(x)); // AggregateError (IPv4/IPv6)
    cur = c.cause;
  }
  return out;
}

/** Netzfehler von fetch (nicht: Antwort des Servers). */
export function isNetworkError(e: unknown): boolean {
  if (codes(e).length) return true;
  return e instanceof TypeError && /fetch failed/i.test(e.message);
}

/** Darf dieser Fehler für diese Methode wiederholt werden? */
export function isRetryable(e: unknown, method = 'GET'): boolean {
  if (codes(e).some((c) => CONNECT_CODES.has(c))) return true;
  return method.toUpperCase() === 'GET' && isNetworkError(e);
}

/** fn bis zu delays.length + 1 Mal ausführen; wiederholt nur, was isRetryable erlaubt. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  method = 'GET',
  delays: number[] = [500, 1500],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !isRetryable(e, method)) throw e;
      await sleep(delays[attempt]);
    }
  }
}
