// Cross-window "data changed" signal. With several windows open (src/windows.ts)
// an edit in one would otherwise only show up in the others on their next
// focus/background pull. The outbox announces every drain that reached the
// server; the other windows reload (useServerSync).
const CHANNEL = 'tm-sync';

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

export function announceChange(): void {
  try {
    channel?.postMessage({ type: 'changed', at: Date.now() });
  } catch {
    /* closed channel — nothing to tell */
  }
}

// A BroadcastChannel never delivers to its own sender, so this fires only for
// changes made in another window.
export function onRemoteChange(fn: () => void): () => void {
  if (!channel) return () => {};
  const handler = (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === 'changed') fn();
  };
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
