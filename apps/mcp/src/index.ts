#!/usr/bin/env node
// MCP-Server für den Task Manager (#88): KI-Clients (Claude Desktop / Claude
// Code) sprechen ihn per stdio an; er ruft die bestehende REST-API auf.
//
// Konfiguration: TM_API_URL (Pflicht, kein Standardwert — Entscheidung 7).
//   Dev:  TM_API_URL=http://localhost:3002
//   Prod: TM_API_URL=http://192.168.8.187:3001
//
// stdout ist der MCP-Kanal — Diagnose ausschließlich über stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TaskManagerApi } from './api.js';
import { envKind } from './logic.js';
import { registerTools } from './tools.js';

function readBaseUrl(): string {
  const raw = (process.env.TM_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    console.error(
      'FEHLER: Umgebungsvariable TM_API_URL fehlt. Sie muss auf den Task-Manager-Server zeigen, z. B.\n' +
        '  TM_API_URL=http://localhost:3002        (Entwicklung)\n' +
        '  TM_API_URL=http://192.168.8.187:3001     (Produktion)\n' +
        'Es gibt absichtlich keinen Standardwert.',
    );
    process.exit(1);
  }
  if (!/^https?:\/\//i.test(raw)) {
    console.error(`FEHLER: TM_API_URL muss mit http:// oder https:// beginnen (ist: „${raw}").`);
    process.exit(1);
  }
  return raw;
}

async function main(): Promise<void> {
  const baseUrl = readBaseUrl();
  const api = new TaskManagerApi(baseUrl);
  const server = new McpServer({ name: 'task-manager', version: '1.0.0' });
  registerTools(server, api);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`task-manager MCP verbunden mit ${baseUrl} (${envKind(baseUrl)})`);
}

main().catch((e) => {
  console.error('FEHLER beim Start des MCP-Servers:', e);
  process.exit(1);
});
