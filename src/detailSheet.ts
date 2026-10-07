import { useLayoutEffect, useState } from 'react';

// Task detail: docked on the right when there is room, otherwise a bottom
// sheet over the lower part of the task list (narrow / half-screen window), so
// the list stays visible and clickable above it.

// The task list needs at least this much width next to a docked panel.
export const MIN_LIST_WIDTH = 480;

// Pure decision, testable: room for the list = viewport minus everything left
// of the main content (sidebar, projects/calendar panel) minus the panel.
export const shouldUseSheet = (viewportWidth: number, mainLeft: number, panelWidth: number): boolean =>
  viewportWidth - mainLeft - panelWidth < MIN_LIST_WIDTH;

export interface DetailLayout {
  sheet: boolean;
  /** Left edge of the main content — the sheet spans from here to the right. */
  left: number;
}

export function useDetailLayout(panelWidth: number): DetailLayout {
  const [layout, setLayout] = useState<DetailLayout>({ sheet: false, left: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const main = document.querySelector('.main-content');
      const left = main ? Math.round(main.getBoundingClientRect().left) : 0;
      const sheet = shouldUseSheet(window.innerWidth, left, panelWidth);
      setLayout((cur) => (cur.sheet === sheet && cur.left === left ? cur : { sheet, left }));
    };
    measure();
    window.addEventListener('resize', measure);
    // Sidebar / side panels can change width without a window resize.
    const main = document.querySelector('.main-content');
    const ro = main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (main && ro) ro.observe(main);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [panelWidth]);
  return layout;
}

// Sheet height as a fraction of the window — per device, remembered locally.
const SHEET_KEY = 'tm-detail-sheet-h';
export const clampSheet = (f: number) => Math.max(0.25, Math.min(0.85, f));
export function loadSheetFraction(): number {
  try {
    const v = Number(localStorage.getItem(SHEET_KEY));
    return v ? clampSheet(v) : 0.55;
  } catch {
    return 0.55;
  }
}
export function saveSheetFraction(f: number): void {
  try { localStorage.setItem(SHEET_KEY, String(clampSheet(f))); } catch { /* storage blocked */ }
}
