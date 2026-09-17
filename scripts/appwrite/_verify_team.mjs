import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, Functions, ExecutionMethod } from 'node-appwrite';
import { readLocalConfig } from './config.mjs';

const config = readLocalConfig(await fs.readFile(path.join(process.cwd(), '.appwrite.local'), 'utf8'));
const endpoint = config.APPWRITE_ENDPOINT.replace(/\/+$/, '');
const projectId = config.APPWRITE_PROJECT_ID;
const email = process.argv[2];
const password = process.argv[3];

const sessionRes = await fetch(`${endpoint}/account/sessions/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-appwrite-project': projectId },
  body: JSON.stringify({ email, password }),
});
const cookieHeader = sessionRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
await sessionRes.json();
const jwtRes = await fetch(`${endpoint}/account/jwts`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-appwrite-project': projectId, cookie: cookieHeader } });
const { jwt } = await jwtRes.json();

const client = new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt);
const functions = new Functions(client);
const exec = await functions.createExecution({ functionId: 'selfmanaged-api', body: '', async: false, xpath: '/api/tasks', method: ExecutionMethod.GET });
console.log('status', exec.responseStatusCode, 'tasks:', exec.responseStatusCode === 200 ? JSON.parse(exec.responseBody).length : exec.responseBody);

await fetch(`${endpoint}/account/sessions/current`, { method: 'DELETE', headers: { 'x-appwrite-project': projectId, cookie: cookieHeader } });
