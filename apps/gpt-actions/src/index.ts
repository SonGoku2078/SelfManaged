#!/usr/bin/env node
// REST-Adapter für ChatGPT Custom GPT Actions (#98): HTTP + Bearer-Auth statt
// stdio (wie apps/mcp). Läuft dauerhaft, üblicherweise hinter einem
// Cloudflare Tunnel auf dem Prod-Host (selfmanaged-prod).
//
//   TM_API_URL          Pflicht, kein Standardwert (wie bei #88).
//                          Dev:  TM_API_URL=http://localhost:3002
//                          Prod: TM_API_URL=http://192.168.8.187:3001
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
import { TaskManagerApi } from './api.js';
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

function readBaseUrl(): string {
  const raw = readEnv('TM_API_URL', 'http://localhost:3002').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) {
    console.error(`FEHLER: TM_API_URL muss mit http:// oder https:// beginnen (ist: „${raw}").`);
    process.exit(1);
  }
  return raw;
}

const apiKey = readEnv('GPT_ACTIONS_API_KEY', '(z. B. mit: openssl rand -hex 32)');
const baseUrl = readBaseUrl();
const port = Number(process.env.GPT_ACTIONS_PORT ?? 3003);

const api = new TaskManagerApi(baseUrl);
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
  console.log(`gpt-actions verbunden mit ${baseUrl}, hört auf Port ${port}.`);
});
