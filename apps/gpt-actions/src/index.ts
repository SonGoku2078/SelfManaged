#!/usr/bin/env node
// REST-Adapter für ChatGPT Custom GPT Actions (#98): HTTP + Bearer-Auth statt
// stdio (wie apps/mcp). Läuft dauerhaft, üblicherweise hinter einem
// Cloudflare Tunnel auf dem Prod-Host (selfmanaged-prod).
//
// Zwei sich ausschließende Betriebsarten fürs Backend (Nachtrag 2026-09-26
// zu #96/#98, siehe docs/pipeline/appwrite-prod-test-migration.md):
//   Dev/Express  (unveraendert): TM_API_URL gesetzt.
//                  Dev:  TM_API_URL=http://localhost:3002
//   Prod/Appwrite (neu): APPWRITE_MCP_EMAIL + APPWRITE_MCP_PASSWORD gesetzt.
//                  Dediziertes Appwrite-Service-Konto, kein Admin-Key.
// Weder/beides gesetzt → Exit 1 mit deutscher Klartextmeldung.
//
//   GPT_ACTIONS_API_KEY  Pflicht, kein Standardwert. Erzeugen z. B. mit
//                          openssl rand -hex 32
//   GPT_ACTIONS_PORT     Optional, Standard 3003 (kollidiert nicht mit
//                          Dev :3002 / Prod :3001).
//
// Dies ist ein normaler HTTP-Server (kein MCP-stdio-Kanal) — console.log/
// console.error für Diagnose ist hier unproblematisch.
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { authFailureLimiter, requireApiKey } from './auth.js';
import { AppwriteTaskManagerApi, TaskManagerApi, type TaskApi } from './api.js';
import { resolveTransportMode, TransportConfigError, type TransportMode } from '../../mcp/src/appwriteApi.js';
import { buildRouter, errorHandler } from './routes.js';

function readEnv(name: string, beispiel: string): string {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) {
    console.error(
      `FEHLER: Umgebungsvariable ${name} fehlt. Beispiel:\n  ${name}=${beispiel}\n` +
        'Es gibt absichtlich keinen Standardwert.',
    );
    process.exit(1);
  }
  return raw;
}

function buildApi(): TaskApi {
  let mode: TransportMode;
  try {
    mode = resolveTransportMode();
  } catch (e) {
    const msg = e instanceof TransportConfigError ? e.message : String(e);
    console.error(`FEHLER: ${msg}`);
    process.exit(1);
  }
  return mode.kind === 'express' ? new TaskManagerApi(mode.baseUrl) : new AppwriteTaskManagerApi();
}

const apiKey = readEnv('GPT_ACTIONS_API_KEY', '(z. B. mit: openssl rand -hex 32)');
const port = Number(process.env.GPT_ACTIONS_PORT ?? 3003);

const api = buildApi();
const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.use('/v1', authFailureLimiter, requireApiKey(apiKey), buildRouter(api));

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Unbekannte Route.' });
});

// Fängt Fehler aus den Routen (AC-10) — nie ein Absturz, nie ein Stacktrace
// nach außen. Muss als letztes registriert werden (4-Parameter-Signatur).
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  errorHandler(err, req, res, next);
});

app.listen(port, () => {
  console.log(`gpt-actions verbunden mit ${api.baseUrl}, hört auf Port ${port}.`);
});
