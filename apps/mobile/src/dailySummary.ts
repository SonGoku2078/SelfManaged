// 08:00 daily summary (#116) — pure content builder, no Capacitor import so it
// can be unit-tested. The old summary was ONE repeating 08:00 notification
// whose text was computed at the last sync: it showed only "N Aufgaben heute
// fällig" (no names) and, if the app last synced yesterday, yesterday's count.
// Now: one notification per upcoming morning, each with that day's own list.
import type { Task } from './types';
import { mobileAgenda } from './selectors';

export const SUMMARY_BASE_ID = 900001;
export const SUMMARY_DAYS = 7; // mornings planned ahead; re-planned on every sync
export const SUMMARY_HOUR = 8;
const MAX_LINES = 8;

export interface DailySummary {
  id: number;
  at: Date;
  title: string;
  body: string; // collapsed view: names inline
  largeBody?: string; // expanded view: one task per line
  taskId?: string; // single task → tap opens it
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const line = (t: Task) => (t.startMinutes != null ? `${hhmm(t.startMinutes)}  ${t.title}` : t.title);

export function buildDailySummaries(tasks: Task[], now = new Date()): DailySummary[] {
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), SUMMARY_HOUR, 0);
  if (first <= now) first.setDate(first.getDate() + 1); // today's 08:00 already passed
  const out: DailySummary[] = [];
  for (let i = 0; i < SUMMARY_DAYS; i++) {
    // Not addDays(): that resets the time to midnight.
    const at = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, SUMMARY_HOUR, 0);
    // Timed tasks first, in time order; then the rest as in the Heute tab.
    const agenda = mobileAgenda(tasks, at).sort(
      (a, b) => (a.startMinutes ?? Infinity) - (b.startMinutes ?? Infinity)
    );
    const id = SUMMARY_BASE_ID + i;
    if (agenda.length === 0) {
      out.push({ id, at, title: '📋 Heute', body: 'Keine Aufgaben für heute 🎉' });
      continue;
    }
    if (agenda.length === 1) {
      const t = agenda[0];
      out.push({ id, at, title: `📋 ${t.title}`, body: 'Heute — antippen für Details', taskId: t.id });
      continue;
    }
    const shown = agenda.slice(0, MAX_LINES).map((t) => `• ${line(t)}`);
    const more = agenda.length - MAX_LINES;
    if (more > 0) shown.push(`… und ${more} weitere`);
    out.push({
      id,
      at,
      title: `📋 Heute: ${agenda.length} Aufgaben`,
      body: agenda.map((t) => t.title).join(' · '),
      largeBody: shown.join('\n'),
    });
  }
  return out;
}

// ── Task reminders (#118) ─────────────────────────────────────────────────
// Every task with a start time reminds AT its start time; a configured lead
// time adds an EARLIER reminder on top (it used to replace the one at the
// start time). Planned for the same window as the summaries, so a task for
// tomorrow 09:07 reminds even if the app is not opened tomorrow morning.

export interface TaskReminder {
  id: number;
  at: Date;
  title: string;
  body: string;
  taskId: string;
}

// Lead reminders get their own id range next to the task number.
const LEAD_ID_OFFSET = 1_000_000;

export function buildTaskReminders(tasks: Task[], leadMin: number, now = new Date()): TaskReminder[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SUMMARY_DAYS + 1);
  const out: TaskReminder[] = [];
  for (const t of tasks) {
    if (t.parentId || t.completed || !t.dueDate || t.startMinutes == null) continue;
    const d = new Date(t.dueDate);
    const startAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, t.startMinutes);
    if (startAt <= now || startAt >= end) continue;
    const time = hhmm(t.startMinutes);
    out.push({ id: t.number, at: startAt, title: `⏰ ${t.title}`, body: `Jetzt fällig (${time})`, taskId: t.id });
    if (leadMin > 0) {
      const leadAt = new Date(startAt.getTime() - leadMin * 60_000);
      if (leadAt > now) {
        out.push({ id: t.number + LEAD_ID_OFFSET, at: leadAt, title: `⏰ ${t.title}`, body: `In ${leadMin} Min fällig (um ${time})`, taskId: t.id });
      }
    }
  }
  return out;
}
