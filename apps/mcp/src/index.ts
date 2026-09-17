#!/usr/bin/env node
// MCP-Server für SelfManaged (#88): KI-Clients (Claude Desktop / Claude
// Code) sprechen ihn per stdio an; er ruft die bestehende REST-API auf.
//
// Zwei Backends, je nach gesetzten Umgebungsvariablen (#98):
//   Appwrite-PROD: TM_APPWRITE_EMAIL + TM_APPWRITE_PASSWORD gesetzt.
//     TM_APPWRITE_PROJECT_ID  Appwrite-Projekt-ID
//     TM_APPWRITE_ENDPOINT    Appwrite-API-Endpunkt (Default: fra.cloud.appwrite.io/v1)
//     TM_APPWRITE_FUNCTION_ID Function-ID der API (Default: selfmanaged-api)
//     TM_APPWRITE_SITE_URL    Site-URL fuer Deep-Links (Default: die PROD-Domain)
//   Klassisch (Express/SQLite, Dev/Test und der alte LAN-Server):
//     TM_API_URL (Pflicht, kein Standardwert — Entscheidung 7).
//       Dev:  TM_API_URL=http://localhost:3002
//       Alt-Prod: TM_API_URL=http://192.168.8.187:3001
//
// stdout ist der MCP-Kanal — Diagnose ausschließlich über stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TaskManagerApi, type TaskApi } from './api.js';
import { AppwriteTaskManagerApi } from './appwriteApi.js';
import { envKind } from './logic.js';
import { registerTools } from './tools.js';

const DEFAULT_APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const DEFAULT_APPWRITE_FUNCTION_ID = 'selfmanaged-api';
const DEFAULT_APPWRITE_SITE_URL = 'https://selfmanaged-prod-6aaa45fb.appwrite.network';

function readClassicBaseUrl(): string {
  const raw = (process.env.TM_API_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    console.error(
      'FEHLER: Weder TM_APPWRITE_EMAIL/TM_APPWRITE_PASSWORD noch TM_API_URL gesetzt. Eines von beiden muss den Server festlegen, z. B.\n' +
        '  TM_API_URL=http://localhost:3002        (Entwicklung)\n' +
        '  TM_API_URL=http://192.168.8.187:3001     (alter LAN-Server)\n' +
        '  TM_APPWRITE_EMAIL=… TM_APPWRITE_PASSWORD=…  (Appwrite-PROD)\n' +
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

function buildApi(): TaskApi {
  const email = (process.env.TM_APPWRITE_EMAIL ?? '').trim();
  const password = process.env.TM_APPWRITE_PASSWORD ?? '';
  if (email && password) {
    const projectId = (process.env.TM_APPWRITE_PROJECT_ID ?? '').trim();
    if (!projectId) {
      console.error('FEHLER: TM_APPWRITE_PROJECT_ID fehlt (noetig zusammen mit TM_APPWRITE_EMAIL/-PASSWORD).');
      process.exit(1);
    }
    return new AppwriteTaskManagerApi({
      endpoint: (process.env.TM_APPWRITE_ENDPOINT ?? DEFAULT_APPWRITE_ENDPOINT).trim().replace(/\/+$/, ''),
      projectId,
      functionId: (process.env.TM_APPWRITE_FUNCTION_ID ?? DEFAULT_APPWRITE_FUNCTION_ID).trim(),
      siteUrl: (process.env.TM_APPWRITE_SITE_URL ?? DEFAULT_APPWRITE_SITE_URL).trim().replace(/\/+$/, ''),
      email,
      password,
    });
  }
  if (email || password) {
    console.error('FEHLER: TM_APPWRITE_EMAIL und TM_APPWRITE_PASSWORD müssen beide gesetzt sein (nur eines gefunden).');
    process.exit(1);
  }
  return new TaskManagerApi(readClassicBaseUrl());
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
