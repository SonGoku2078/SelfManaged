import crypto from 'node:crypto';
import { Client, Query, TablesDB } from 'node-appwrite';

const DATABASE_ID = 'selfmanaged-prod';
// Timed tasks without a duration last 30 minutes (Nozbe default).
export const DEFAULT_DURATION_MIN = 30;
// The function runs in UTC; the user's day and clock are Swiss. Events carry
// TZID=Europe/Zurich (+ VTIMEZONE) so every calendar app shows the same time.
const TZID = 'Europe/Zurich';
const pad = (n) => String(n).padStart(2, '0');
const zurichParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZID, year: 'numeric', month: '2-digit', day: '2-digit' });
// Calendar day of a stored dueDate as seen in Zurich → naive UTC-midnight Date
// used purely for Y/M/D arithmetic (getUTC* below), independent of server TZ.
const zurichDay = (value) => {
  const [y, m, d] = zurichParts.format(new Date(value)).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmtDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const toLocalStamp = (d) => `${fmtDate(d)}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZID}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19810329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19961027T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const toUtcStamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const escapeText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > (out.length ? 74 : 75)) { out.push(current); current = ''; bytes = 0; }
    current += char;
    bytes += size;
  }
  if (current || !out.length) out.push(current);
  return out.map((value, index) => index ? ` ${value}` : value).join('\r\n');
}

function rrule(task, allDay) {
  if (task.completed || task.recurrence === 'none') return null;
  const unit = task.recurrence === 'custom'
    ? (task.recurUnit ?? 'day')
    : ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' })[task.recurrence];
  const parts = [`FREQ=${({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' })[unit]}`];
  const interval = task.recurrence === 'custom' ? Math.max(1, task.recurInterval ?? 1) : 1;
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (unit === 'month' && task.recurMonthDay === 'first') parts.push('BYMONTHDAY=1');
  if (unit === 'month' && task.recurMonthDay === 'last') parts.push('BYMONTHDAY=-1');
  if (task.recurrenceEnd) {
    const end = zurichDay(task.recurrenceEnd);
    // RFC 5545: with a TZID DTSTART, UNTIL must be UTC.
    parts.push(`UNTIL=${allDay ? fmtDate(end) : `${fmtDate(end)}T235959Z`}`);
  }
  return `RRULE:${parts.join(';')}`;
}

export function tasksToIcs(tasks, projects) {
  const projectNames = new Map(projects.map((p) => [p.legacyId, p.name]));
  const events = tasks.filter((t) => t.dueDate).map((task) => {
    const due = zurichDay(task.dueDate);
    const allDay = task.startMinutes == null;
    const updated = new Date(task.updatedAt);
    const lines = ['BEGIN:VEVENT', fold(`UID:${task.legacyId}@selfmanaged`), `DTSTAMP:${toUtcStamp(updated)}`, `LAST-MODIFIED:${toUtcStamp(updated)}`];
    if (allDay) {
      const next = new Date(due.getTime() + 86_400_000);
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(due)}`, `DTEND;VALUE=DATE:${fmtDate(next)}`);
    } else {
      const start = new Date(due.getTime() + task.startMinutes * 60_000);
      const end = new Date(start.getTime() + (task.durationMin || DEFAULT_DURATION_MIN) * 60_000);
      lines.push(`DTSTART;TZID=${TZID}:${toLocalStamp(start)}`, `DTEND;TZID=${TZID}:${toLocalStamp(end)}`);
    }
    const recurrence = rrule(task, allDay);
    if (recurrence) lines.push(recurrence);
    lines.push(fold(`SUMMARY:${escapeText(`${task.completed ? '✓ ' : ''}${task.title}`)}`));
    if (String(task.description ?? '').trim()) lines.push(fold(`DESCRIPTION:${escapeText(task.description)}`));
    const project = projectNames.get(task.projectId);
    if (project) lines.push(fold(`CATEGORIES:${escapeText(project)}`));
    lines.push('END:VEVENT');
    return lines.join('\r\n');
  });
  return calendar('SelfManaged Aufgaben', events);
}

const calendar = (name, events) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SelfManaged//Task Manager//DE', 'CALSCALE:GREGORIAN', fold(`X-WR-CALNAME:${escapeText(name)}`), 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', `X-WR-TIMEZONE:${TZID}`, ...VTIMEZONE, ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';

// Blocker weekdays: 0 = Monday … 6 = Sunday (same as ProjectBlocker in the app).
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DAY_MS = 86_400_000;
// Monday of the Zurich week containing `value`, as naive UTC midnight.
const zurichMonday = (value) => {
  const d = zurichDay(value);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS);
};

// Project blockers as their own subscribable calendar: one weekly series per
// blocker, titled with the project name, exactly like the week grid shows them
// every week. The description lists the project's open tasks for the current
// week (starred first) — the same ones the app shows inside the blocker.
export function blockersToIcs(blockers, projects, tasks = [], now = new Date()) {
  const projectsById = new Map(projects.map((p) => [p.legacyId, p]));
  const weekStart = zurichMonday(now).getTime();
  const inThisWeek = (t) => {
    if (!t.dueDate) return false;
    const due = zurichDay(t.dueDate).getTime();
    return due >= weekStart && due < weekStart + 7 * DAY_MS;
  };
  const weekTasksOf = (projectId) => tasks
    .filter((t) => t.projectId === projectId && !t.completed && !t.parentId && (t.thisWeek || inThisWeek(t)))
    .sort((a, b) => (a.starred === b.starred ? 0 : a.starred ? -1 : 1))
    .map((t) => `${t.starred ? '★' : '•'} ${t.title}`);
  const events = blockers.flatMap((blocker) => {
    const project = projectsById.get(blocker.projectId);
    const days = [...new Set(blocker.weekdays ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (!project || !days.length) return [];
    // The series starts in the week the blocker was created, on its first weekday.
    const anchor = zurichMonday(blocker.$createdAt ?? blocker.$updatedAt ?? now);
    const start = new Date(anchor.getTime() + days[0] * DAY_MS + (blocker.startMinutes ?? 0) * 60_000);
    const end = new Date(start.getTime() + (blocker.durationMin || 60) * 60_000);
    const lines = [
      'BEGIN:VEVENT', fold(`UID:blocker-${blocker.legacyId}@selfmanaged`), `DTSTAMP:${toUtcStamp(now)}`,
      `DTSTART;TZID=${TZID}:${toLocalStamp(start)}`, `DTEND;TZID=${TZID}:${toLocalStamp(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`,
      fold(`SUMMARY:${escapeText(project.name)}`),
    ];
    if (blocker.$updatedAt) lines.push(`LAST-MODIFIED:${toUtcStamp(new Date(blocker.$updatedAt))}`);
    const weekTasks = weekTasksOf(project.legacyId);
    if (weekTasks.length) lines.push(fold(`DESCRIPTION:${escapeText(weekTasks.join('\n'))}`));
    lines.push('TRANSP:OPAQUE', 'END:VEVENT');
    return [lines.join('\r\n')];
  });
  return calendar('SelfManaged Projektblocker', events);
}

function tokenMatches(expected, received) {
  if (!expected || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export default async ({ req, res, error }) => {
  try {
    const path = new URL(req.url || req.path || '/', 'https://function.local').pathname;
    // /calendar/<token>.ics = tasks, /calendar/<token>/projektblocker.ics = blockers.
    const match = path.match(/^\/calendar\/([^/]+?)(\/projektblocker)?\.ics$/);
    if (req.method !== 'GET' || !match || !tokenMatches(process.env.ICS_TOKEN ?? '', decodeURIComponent(match[1]))) {
      return res.text('Not found', 404);
    }
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(req.headers['x-appwrite-key']);
    const db = new TablesDB(client);
    if (match[2]) {
      const [blockers, projects, tasks] = await Promise.all([
        db.listRows({ databaseId: DATABASE_ID, tableId: 'blockers', queries: [Query.limit(5000)], total: false }),
        db.listRows({ databaseId: DATABASE_ID, tableId: 'projects', queries: [Query.limit(5000)], total: false }),
        db.listRows({ databaseId: DATABASE_ID, tableId: 'tasks', queries: [Query.equal('completed', false), Query.limit(5000)], total: false }),
      ]);
      return res.text(blockersToIcs(blockers.rows, projects.rows, tasks.rows), 200, {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'inline; filename="selfmanaged-projektblocker.ics"',
        'cache-control': 'no-cache',
      });
    }
    const [tasks, projects] = await Promise.all([
      db.listRows({ databaseId: DATABASE_ID, tableId: 'tasks', queries: [Query.isNotNull('dueDate'), Query.limit(5000)], total: false }),
      db.listRows({ databaseId: DATABASE_ID, tableId: 'projects', queries: [Query.limit(5000)], total: false }),
    ]);
    return res.text(tasksToIcs(tasks.rows, projects.rows), 200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="selfmanaged.ics"',
      'cache-control': 'no-cache',
    });
  } catch (e) {
    error(e instanceof Error ? e.stack ?? e.message : String(e));
    return res.text('Internal server error', 500);
  }
};

