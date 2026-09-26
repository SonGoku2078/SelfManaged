// Geteiltes Appwrite-PROD-Backend fuer den MCP-Server (#88) UND den
// gpt-actions-Adapter (#98) — Nachtrag 2026-09-26 zu #96 (AC10-Luecke:
// beide zeigten seit dem Appwrite-Cutover weiterhin auf den toten
// LAN-Server statt auf echte Produktion). Siehe
// docs/pipeline/appwrite-prod-test-migration.md, Abschnitt "Nachtrag
// 2026-09-26" fuer die verbindliche Architektur.
//
// Nutzt bewusst das oeffentliche Web/Node-SDK "appwrite" (wie
// src/appwrite/client.ts), NICHT "node-appwrite" (das Admin-SDK mit
// API-Key) — kein Admin-Key im MCP-/gpt-actions-Prozess (Sicherheitsvorgabe
// aus Abschnitt 2.5). Der Prozess meldet sich stattdessen per E-Mail/
// Passwort als normaler Appwrite-Benutzer an (dediziertes Service-Konto,
// niemals der persoenliche Account des Users) und cached die Session fuer
// die Prozesslaufzeit.
//
// Aufrufe MUESSEN ueber die Functions-Execution-API laufen
// (functions.createExecution) — ein direkter fetch() auf die Function-
// HTTP-Domain funktioniert nicht: Appwrites Edge entfernt dabei jeden
// x-appwrite-*-Header (siehe src/api/client.ts::appwriteApiFetch).
import { Client, ExecutionMethod, Functions } from 'appwrite';

// Oeffentlich, kein Secret (siehe .env.appwrite / src/appwrite/client.ts).
const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6aaa45fb0024f97b2b00';
const APPWRITE_FUNCTION_ID = 'selfmanaged-api';

// Site-Domain fuer Deep-Links (`#/t/<nummer>`) UND fuer envKind() in
// logic.ts, das `.appwrite.network`-Hosts bereits als "prod" erkennt —
// logic.ts bleibt dadurch unveraendert (Nachtrag: "logic.ts kennt keine
// Transport-Details").
export const APPWRITE_PROD_SITE_URL = 'https://selfmanaged-prod-6aaa45fb.appwrite.network';

export class AppwriteAuthError extends Error {}

interface AppwriteSession {
  functions: Functions;
}

let session: AppwriteSession | null = null;
let loginPromise: Promise<AppwriteSession> | null = null;

// Bewusst ein roher fetch() auf /account/sessions/email statt
// account.createEmailPasswordSession() aus dem SDK: Appwrite liefert das
// Session-„secret" im JSON-Body nur leer zurück (Sicherheitsmaßnahme) und
// setzt die eigentliche Session stattdessen als Set-Cookie-Header — im
// Browser fängt das die Cookie-Jar automatisch auf, in Node (fetch ohne
// Cookie-Jar) muss der Cookie-Header manuell eingesammelt und über
// client.setCookie() an alle folgenden SDK-Aufrufe weitergereicht werden
// (siehe Kommentar zu Client.setCookie() im SDK: „Used by SDKs that forward
// an incoming Cookie header in server-side runtimes"). Verifiziert gegen
// das echte Appwrite-Prod-Projekt am 2026-09-26.
async function login(): Promise<AppwriteSession> {
  const email = (process.env.APPWRITE_MCP_EMAIL ?? '').trim();
  const password = process.env.APPWRITE_MCP_PASSWORD ?? '';
  if (!email || !password) {
    throw new AppwriteAuthError(
      'APPWRITE_MCP_EMAIL/APPWRITE_MCP_PASSWORD fehlen — Appwrite-Prod-Login nicht möglich.',
    );
  }
  let res: Response;
  try {
    res = await fetch(`${APPWRITE_ENDPOINT}/account/sessions/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Appwrite-Project': APPWRITE_PROJECT_ID },
      body: JSON.stringify({ email, password }),
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new AppwriteAuthError(`Appwrite-Login nicht erreichbar: ${why}`, { cause: e });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new AppwriteAuthError(`Appwrite-Login fehlgeschlagen: ${res.status} ${text}`);
  }
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (setCookie.length === 0) {
    throw new AppwriteAuthError('Appwrite-Login lieferte keine Session (kein Set-Cookie-Header).');
  }
  const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
  const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setCookie(cookieHeader);
  return { functions: new Functions(client) };
}

// Einmaliger Login pro Prozess; parallele erste Aufrufe teilen sich den
// gleichen Login-Vorgang statt mehrfach anzumelden.
async function getSession(): Promise<AppwriteSession> {
  if (session) return session;
  if (!loginPromise) {
    loginPromise = login()
      .then((s) => {
        session = s;
        return s;
      })
      .catch((e) => {
        loginPromise = null;
        throw e;
      });
  }
  return loginPromise;
}

export interface AppwriteFetchInit {
  method?: string;
  body?: string;
}

// Analog appwriteApiFetch in src/api/client.ts, aber ohne Date-Revival —
// ApiTask in logic.ts erwartet ohnehin rohe ISO-Strings.
export async function appwriteApiFetch<T>(path: string, init?: AppwriteFetchInit): Promise<T> {
  const { functions } = await getSession();
  const method = (init?.method ?? 'GET').toUpperCase();
  let execution;
  try {
    execution = await functions.createExecution({
      functionId: APPWRITE_FUNCTION_ID,
      body: init?.body ?? '',
      async: false,
      xpath: path,
      method: method as ExecutionMethod,
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`Appwrite-Function „${APPWRITE_FUNCTION_ID}" nicht erreichbar (${why}).`, { cause: e });
  }
  if (execution.responseStatusCode >= 400) {
    throw new Error(
      `Appwrite antwortete ${execution.responseStatusCode} auf ${method} ${path}: ${execution.responseBody || execution.errors || ''}`,
    );
  }
  if (execution.responseStatusCode === 204 || !execution.responseBody) return undefined as T;
  return JSON.parse(execution.responseBody) as T;
}

// ── Umgebungs-Umschaltung (Nachtrag 2026-09-26) ─────────────────────────────
// Zwei sich bewusst ausschliessende Betriebsarten: Dev/Express (TM_API_URL)
// oder Prod/Appwrite (APPWRITE_MCP_EMAIL + APPWRITE_MCP_PASSWORD). Weder/
// beides gesetzt ist ein Konfigurationsfehler. Reine Funktion (kein
// process.exit hier), damit sie ohne echten Prozessstart testbar ist —
// index.ts entscheidet, wie der Fehler behandelt wird (Exit 1).
export type TransportMode = { kind: 'express'; baseUrl: string } | { kind: 'appwrite' };

export class TransportConfigError extends Error {}

const BEIDE_OPTIONEN_HINWEIS =
  'TM_API_URL=http://localhost:3002              (Entwicklung, Express/dev.db)\n' +
  '  APPWRITE_MCP_EMAIL=… APPWRITE_MCP_PASSWORD=…   (Appwrite-Prod, dediziertes Service-Konto)';

export function resolveTransportMode(env: NodeJS.ProcessEnv = process.env): TransportMode {
  const tmApiUrl = (env.TM_API_URL ?? '').trim();
  const email = (env.APPWRITE_MCP_EMAIL ?? '').trim();
  const password = env.APPWRITE_MCP_PASSWORD ?? '';
  const hasExpress = tmApiUrl !== '';
  const hasAppwrite = email !== '' || password !== '';

  if (hasExpress && hasAppwrite) {
    throw new TransportConfigError(
      `TM_API_URL und APPWRITE_MCP_EMAIL/-PASSWORD sind gleichzeitig gesetzt — das sind zwei sich ausschließende Betriebsarten. Bitte nur eine davon setzen:\n  ${BEIDE_OPTIONEN_HINWEIS}`,
    );
  }
  if (!hasExpress && !hasAppwrite) {
    throw new TransportConfigError(
      `Weder TM_API_URL noch APPWRITE_MCP_EMAIL/APPWRITE_MCP_PASSWORD gesetzt. Eine der beiden Betriebsarten muss konfiguriert sein:\n  ${BEIDE_OPTIONEN_HINWEIS}`,
    );
  }
  if (hasAppwrite && (!email || !password)) {
    throw new TransportConfigError(
      'APPWRITE_MCP_EMAIL und APPWRITE_MCP_PASSWORD müssen beide gesetzt sein (nur eines gefunden).',
    );
  }
  if (hasExpress) {
    const baseUrl = tmApiUrl.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw new TransportConfigError(`TM_API_URL muss mit http:// oder https:// beginnen (ist: „${baseUrl}").`);
    }
    return { kind: 'express', baseUrl };
  }
  return { kind: 'appwrite' };
}
