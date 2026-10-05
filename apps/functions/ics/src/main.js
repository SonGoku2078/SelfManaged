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
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SelfManaged//Task Manager//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:SelfManaged Aufgaben', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', `X-WR-TIMEZONE:${TZID}`, ...VTIMEZONE, ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

function tokenMatches(expected, received) {
  if (!expected || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export default async ({ req, res, error }) => {
  try {
    const path = new URL(req.url || req.path || '/', 'https://function.local').pathname;
    const match = path.match(/^\/calendar\/([^/]+)\.ics$/);
    if (req.method !== 'GET' || !match || !tokenMatches(process.env.ICS_TOKEN ?? '', decodeURIComponent(match[1]))) {
      return res.text('Not found', 404);
    }
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(req.headers['x-appwrite-key']);
    const db = new TablesDB(client);
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

