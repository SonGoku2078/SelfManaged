import { useCallback, useState } from 'react';
import type { MobileTab } from './components/Navigation';

// A single navigable screen state. Everything visible is derived from this, so
// back/forward (swipe + hardware back) can move through history like a browser.
export interface NavState {
  tab: MobileTab;
  projectId: string | null; // drilled-into project (Projekte tab)
  taskId: string | null; // open task detail
  overlay: 'settings' | 'search' | null;
}

// The app always starts on Heute (#114) — the day's agenda is what you open it for.
export const HOME: NavState = { tab: 'today', projectId: null, taskId: null, overlay: null };

const same = (a: NavState, b: NavState) =>
  a.tab === b.tab && a.projectId === b.projectId && a.taskId === b.taskId && a.overlay === b.overlay;

export interface NavApi {
  state: NavState;
  navigate: (partial: Partial<NavState>) => void;
  back: () => void;
  forward: () => void;
  /** Fresh start on Heute — drops the back/forward history. */
  reset: () => void;
  canBack: boolean;
  canForward: boolean;
}

export function useNavHistory(): NavApi {
  const [nav, setNav] = useState<{ stack: NavState[]; index: number }>({ stack: [HOME], index: 0 });

  const navigate = useCallback((partial: Partial<NavState>) => {
    setNav((n) => {
      const cur = n.stack[n.index];
      const next = { ...cur, ...partial };
      if (same(cur, next)) return n; // no dup entries
      const stack = n.stack.slice(0, n.index + 1);
      stack.push(next);
      // Cap history so it can't grow without bound.
      const trimmed = stack.length > 50 ? stack.slice(stack.length - 50) : stack;
      return { stack: trimmed, index: trimmed.length - 1 };
    });
  }, []);

  const back = useCallback(() => setNav((n) => (n.index > 0 ? { ...n, index: n.index - 1 } : n)), []);
  const forward = useCallback(
    () => setNav((n) => (n.index < n.stack.length - 1 ? { ...n, index: n.index + 1 } : n)),
    [],
  );

  const reset = useCallback(() => setNav({ stack: [HOME], index: 0 }), []);

  return {
    state: nav.stack[nav.index],
    navigate,
    back,
    forward,
    reset,
    canBack: nav.index > 0,
    canForward: nav.index < nav.stack.length - 1,
  };
}
