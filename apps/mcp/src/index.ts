#!/usr/bin/env node
// MCP-Server für SelfManaged (#88): KI-Clients (Claude Desktop / Claude
// Code) sprechen ihn per stdio an; er ruft die bestehende REST-API auf.
//
// Zwei sich ausschließende Betriebsarten (Nachtrag 2026-09-26 zu #96/#98,
// siehe docs/pipeline/appwrite-prod-test-migration.md):
//   Dev/Express  (unveraendert seit #88): TM_API_URL gesetzt.
//     TM_API_URL=http://localhost:3002
//   Prod/Appwrite (neu): APPWRITE_MCP_EMAIL + APPWRITE_MCP_PASSWORD gesetzt.
//     Dediziertes Appwrite-Service-Konto, einmalig manuell in der Appwrite-
//     Konsole angelegt — niemals der persoenliche Account, niemals ein
//     Admin-API-Key. Endpoint/Projekt/Function-ID sind oeffentlich und in
//     appwriteApi.ts fest hinterlegt.
// Weder/beides gesetzt → Exit 1 mit deutscher Klartextmeldung.
//
// stdout ist der MCP-Kanal — Diagnose ausschließlich über stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppwriteTaskManagerApi, TaskManagerApi, type TaskApi } from './api.js';
import { resolveTransportMode, TransportConfigError, type TransportMode } from './appwriteApi.js';
import { envKind } from './logic.js';
import { registerTools } from './tools.js';

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

async function main(): Promise<void> {
  const api = buildApi();
  const server = new McpServer({ name: 'task-manager', version: '1.0.0' });
  registerTools(server, api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`task-manager MCP verbunden mit ${api.baseUrl} (${envKind(api.baseUrl)})`);
}

main().catch((e) => {
  console.error('FEHLER beim Start des MCP-Servers:', e);
  process.exit(1);
});
