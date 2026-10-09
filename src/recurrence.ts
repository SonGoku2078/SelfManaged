import type { Task } from './types';

// Build the next occurrence of a recurring task (`before`, now due `nextDue`),
// carrying its subtasks over FRESH — reparented to the new occurrence, reset to
// "to do", renumbered after the parent, with comments/attachments cleared.
// Pure (ids come from `makeId`) so it can be unit-tested without the store.
// This is the fix for #20: completing a recurring task must not drop subtasks.
export function buildOccurrence(
  before: Task,
  subtasks: Task[],
  baseNum: number,
  nextDue: Date,
  now: Date,
  makeId: () => string,
): { parent: Task; subs: Task[] } {
  const parentId = makeId();
  const parent: Task = {
    ...before,
    id: parentId,
    number: baseNum,
    completed: false,
    completedAt: null,
    dueDate: nextDue,
    // Day/week-scoped commitments don't carry over to a future occurrence:
    // an inherited thisWeek pinned next month's instance into Next Week (#18).
    thisWeek: false,
    todayDate: null,
    createdAt: now,
    updatedAt: now,
    comments: [],
    attachments: [],
  };
  const subs = [...subtasks]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || +a.createdAt - +b.createdAt)
    .map((s, i) => ({
      ...s,
      id: makeId(),
      number: baseNum + 1 + i,
      parentId,
      completed: false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      comments: [],
      attachments: [],
    }));
  return { parent, subs };
}

// Does the series of an OPEN recurring task have an occurrence on `day`,
// although its stored dueDate lies before that day? The ICS feed exports the
// task as an RRULE, so the calendar shows every occurrence — while the app only
// knows the one stored dueDate. A weekly task left undone since 28.08. showed in
// Proton on every Friday, but never in Heute. Mirrors the RRULE built in
// apps/functions/ics/src/main.js + server/src/ics.ts (unit/interval/month-day/UNTIL).
// Local calendar days; day differences via UTC so DST never shifts them.
export function recursOn(task: Task, day: Date): boolean {
  if (task.completed || !task.recurrence || task.recurrence === 'none' || !task.dueDate) return false;
  const due = task.dueDate;
  const dayNo = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const diff = dayNo(day) - dayNo(due);
  if (diff <= 0) return false; // on/before the stored date: the dueDate itself decides
  if (task.recurrenceEnd && dayNo(day) > dayNo(task.recurrenceEnd)) return false;
  const unit =
    task.recurrence === 'custom'
      ? task.recurUnit ?? 'day'
      : ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const)[task.recurrence];
  const n = task.recurrence === 'custom' ? Math.max(1, task.recurInterval ?? 1) : 1;
  const months = (day.getFullYear() - due.getFullYear()) * 12 + day.getMonth() - due.getMonth();
  switch (unit) {
    case 'day':
      return diff % n === 0;
    case 'week':
      return diff % (7 * n) === 0;
    case 'month': {
      if (months % n !== 0) return false;
      const lastOfMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
      if (task.recurMonthDay === 'first') return day.getDate() === 1;
      if (task.recurMonthDay === 'last') return day.getDate() === lastOfMonth;
      // RRULE semantics: months without that date (e.g. the 31st) are skipped.
      return day.getDate() === due.getDate();
    }
    case 'year':
      return months % (12 * n) === 0 && day.getDate() === due.getDate();
    default:
      return false;
  }
}

// Due date of the occurrence that follows a completion: one step after the
// stored date, then on past today. A weekly task left undone for six weeks and
// checked off now must not respawn into each missed week (one click per week
// to catch up) — the time has passed; the series resumes with the next date
// after today. Completed on time or early, this is just the one step.
// `step` advances one recurrence interval (nextRecurrence in store.ts).
export function nextDueAfterCompletion(due: Date, now: Date, step: (d: Date) => Date): Date {
  const dayNo = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  const today = dayNo(now);
  let next = step(due);
  // Bounded: a daily series 10 years overdue is ~3650 steps.
  for (let i = 0; i < 10_000 && dayNo(next) <= today; i++) {
    const after = step(next);
    if (+after <= +next) break; // no progress (no recurrence) — never loop forever
    next = after;
  }
  return next;
}
