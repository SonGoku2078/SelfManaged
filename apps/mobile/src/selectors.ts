// Reuse the main app's selector helpers, plus a few small mobile-specific
// composers for the 4 MVP views.
import type { Task } from './types';
import {
  selectPriorityTasks,
  isInNextWeekWindow,
  isOverdue,
  isTodayFlagActive,
  tasksOnDate,
  addDays,
  isSameDay,
  dateKey,
  startOfWeek,
  weekDays7,
  matchesSearch,
  applyCompletionHold,
  countsAsToday,
  isImplicitToday,
} from '../../../src/selectors';

export { selectPriorityTasks, isInNextWeekWindow, isOverdue, isTodayFlagActive, tasksOnDate, addDays, isSameDay, dateKey, startOfWeek, weekDays7, matchesSearch, applyCompletionHold, countsAsToday, isImplicitToday };

const root = (t: Task) => !t.parentId; // hide subtasks from the flat mobile lists

// Inbox: open tasks with no project.
export const mobileInbox = (tasks: Task[]): Task[] =>
  tasks.filter((t) => root(t) && !t.completed && !t.projectId);

// Next Action: top-5 by ⭐ > priority > due date.
export const mobileNextAction = (tasks: Task[]): Task[] =>
  selectPriorityTasks(tasks.filter(root), 5);

// Completed within the last 7 days (rolling window), newest first. Shown at the
// bottom of the Woche tab so recently finished work stays visible for a while.
export const mobileDoneThisWeek = (tasks: Task[]): Task[] => {
  const since = addDays(new Date(), -7);
  return tasks
    .filter((t) => root(t) && t.completed && t.completedAt != null && t.completedAt >= since)
    .sort((a, b) => +(b.completedAt as Date) - +(a.completedAt as Date));
};

// Heute on a given day: open tasks due that day OR pinned via the ☀️ Heute
// flag (carries over until done, #112), sorted by due date (undated pins
// last). Shared by the Heute tab and the 08:00 summary for future days.
export const mobileAgenda = (tasks: Task[], day: Date): Task[] =>
  tasks
    .filter(
      (t) =>
        root(t) &&
        !t.completed &&
        ((t.dueDate && isSameDay(t.dueDate, day)) || isTodayFlagActive(t, day))
    )
    .sort(
      (a, b) => (a.dueDate ? +a.dueDate : Infinity) - (b.dueDate ? +b.dueDate : Infinity)
    );

export const mobileToday = (tasks: Task[]): Task[] => mobileAgenda(tasks, new Date());

// Completed today — shown collapsed at the bottom of the Heute tab.
export const mobileDoneToday = (tasks: Task[]): Task[] => {
  const now = new Date();
  return tasks
    .filter((t) => root(t) && t.completed && t.completedAt != null && isSameDay(t.completedAt, now))
    .sort((a, b) => +(b.completedAt as Date) - +(a.completedAt as Date));
};

export interface NextWeekGroup {
  key: 'overdue' | 'today' | 'tomorrow' | 'week' | 'future';
  label: string;
  tasks: Task[];
}

// Next Week: open tasks due within the next 7 days (or flagged thisWeek),
// grouped Overdue / Today / Tomorrow / This Week / Future, each sorted by due
// date. Overdue tasks get their own group (#64): they used to fall into
// "Diese Woche" (the due-date filter had no lower bound), which buried months
// of backlog under a heading that claimed to show the current week.
export const mobileNextWeek = (tasks: Task[]): NextWeekGroup[] => {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);

  const relevant = tasks.filter((t) => {
    if (!root(t) || t.completed) return false;
    if (t.dueDate && t.dueDate <= weekEnd) return true;
    return isInNextWeekWindow(t) || t.thisWeek === true;
  });

  const byDue = (a: Task, b: Task) =>
    (a.dueDate ? +a.dueDate : Infinity) - (b.dueDate ? +b.dueDate : Infinity);

  const groups: NextWeekGroup[] = [
    { key: 'overdue', label: 'Überfällig', tasks: [] },
    { key: 'today', label: 'Heute', tasks: [] },
    { key: 'tomorrow', label: 'Morgen', tasks: [] },
    { key: 'week', label: 'Diese Woche', tasks: [] },
    { key: 'future', label: 'Ohne Datum / später', tasks: [] },
  ];

  for (const t of relevant) {
    // Overdue first — isOverdue compares against the start of today, so a task
    // due later today still belongs in "Heute".
    if (isOverdue(t)) groups[0].tasks.push(t);
    else if (t.dueDate && isSameDay(t.dueDate, today)) groups[1].tasks.push(t);
    else if (t.dueDate && isSameDay(t.dueDate, tomorrow)) groups[2].tasks.push(t);
    else if (t.dueDate && t.dueDate <= weekEnd) groups[3].tasks.push(t);
    else groups[4].tasks.push(t);
  }
  for (const g of groups) g.tasks.sort(byDue); // oldest due date first in Überfällig
  return groups.filter((g) => g.tasks.length > 0);
};
