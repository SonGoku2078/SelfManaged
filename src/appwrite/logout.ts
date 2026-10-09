import { account, clearUserJwt } from './client';
import { pendingCount } from '../api/outbox';

// Appwrite-PROD logout. Lives in Einstellungen → Konto: the old fixed
// top-right button sat exactly where the task detail's close-X is.
export async function logout(): Promise<void> {
  // Logout clears the local outbox — unsynced edits would be lost.
  const pending = pendingCount();
  if (
    pending > 0 &&
    !window.confirm(`${pending} Änderung(en) sind noch nicht synchronisiert und gehen beim Abmelden verloren. Trotzdem abmelden?`)
  ) return;
  try {
    await account.deleteSession({ sessionId: 'current' });
  } finally {
    clearUserJwt();
    localStorage.removeItem('tm-cache');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tm-outbox')) localStorage.removeItem(key);
    }
    window.location.reload();
  }
}
