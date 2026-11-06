import { useServerSync } from '../../../src/useServerSync';

// Mobile auto-sync: the same logic as desktop/web (src/useServerSync.ts).
// Until 2026-11 this polled /health every 12 s — on Appwrite one function
// execution each — and never pulled again after the first load. Now: a delta
// pull when the app returns to the foreground and every few minutes while it
// is open; reachability is only probed while offline (src/sync/cadence.ts).
//
// Returns whether the server currently looks reachable, so the UI can tell
// "syncing" apart from "offline with pending changes".
export function useAutoSync(): boolean {
  return useServerSync().serverOnline === true;
}
