// Parse/format task durations. Accepts "30m", "1h", "1h30m", "1.5h"/"1,5h", or
// a plain number (minutes) → minutes; formatDuration renders minutes to a label.
export function parseDuration(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  // e.g. 1h30m or 1h 30m
  const hm = t.match(/^(\d+)h\s*(\d+)m?$/i);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  // e.g. 1.5h or 1,5h
  const fh = t.match(/^(\d+(?:\.\d+)?)h$/i);
  if (fh) return Math.round(parseFloat(fh[1]) * 60);
  // e.g. 30m or 90m
  const m = t.match(/^(\d+)m$/i);
  if (m) return parseInt(m[1]);
  // plain number = minutes
  const n = parseInt(t);
  if (!isNaN(n) && n > 0) return n;
  return null;
}

// Map startMinutes (minutes from midnight, null = no time) to the value of an
// <input type="time"> ("HH:MM", empty = unset) and back.
export function minutesToTimeInput(min: number | null | undefined): string {
  if (min == null) return '';
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeInputToMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} Min`;
  const h = min / 60;
  if (Number.isInteger(h)) return `${h} Std`;
  const hWhole = Math.floor(min / 60);
  const m = min % 60;
  return `${hWhole}h ${m}m`;
}

// A timed task without an explicit duration lasts 30 minutes (Nozbe default) —
// in the week grid and in the ICS calendar feed.
export const DEFAULT_DURATION_MIN = 30;
