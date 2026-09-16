import { Account, Client, Functions } from 'appwrite';

export const IS_APPWRITE_PROD = import.meta.env.VITE_DEPLOY_TARGET === 'appwrite';

// The Function ID our custom API backend runs as. Calls MUST go through the
// Appwrite Functions Execution API (see apiFetch in api/client.ts) — a direct
// fetch() to the function's own HTTP domain does not work: Appwrite's edge
// strips every x-appwrite-* request header (including our JWT) before it
// reaches the function, and only the Execution API resolves the calling
// user's identity into the function's req.headers. Verified against the live
// project on 2026-09-16; see docs/pipeline/appwrite-prod-test-migration.md.
export const APPWRITE_API_FUNCTION_ID = 'selfmanaged-api';

const endpoint = (import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined) ?? '';
const projectId = (import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined) ?? '';

const client = new Client();
if (IS_APPWRITE_PROD) {
  if (!endpoint || !projectId) {
    throw new Error('Appwrite PROD requires VITE_APPWRITE_ENDPOINT and VITE_APPWRITE_PROJECT_ID.');
  }
  client.setEndpoint(endpoint).setProject(projectId);
}

export const account = new Account(client);
export const functions = new Functions(client);

let jwtCache: { value: string; expiresAt: number } | null = null;

export async function getUserJwt(): Promise<string> {
  if (!IS_APPWRITE_PROD) return '';
  if (jwtCache && jwtCache.expiresAt > Date.now() + 60_000) return jwtCache.value;
  const result = await account.createJWT({ duration: 900 });
  jwtCache = { value: result.jwt, expiresAt: Date.now() + 14 * 60_000 };
  return result.jwt;
}

export function clearUserJwt(): void {
  jwtCache = null;
}

