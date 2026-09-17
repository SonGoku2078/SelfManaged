import crypto from 'node:crypto';
import { Client, Query, TablesDB } from 'node-appwrite';

const DATABASE_ID = 'selfmanaged-prod';
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const toLocalStamp = (d) => `${fmtDate(d)}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
    const end = new Date(task.recurrenceEnd);
    parts.push(`UNTIL=${allDay ? fmtDate(end) : `${fmtDate(end)}T235959`}`);
  }
  return `RRULE:${parts.join(';')}`;
}

function tasksToIcs(tasks, projects) {
  const projectNames = new Map(projects.map((p) => [p.legacyId, p.name]));
  const events = tasks.filter((t) => t.dueDate).map((task) => {
    const due = new Date(task.dueDate);
    const allDay = task.startMinutes == null;
    const updated = new Date(task.updatedAt);
    const lines = ['BEGIN:VEVENT', fold(`UID:${task.legacyId}@selfmanaged`), `DTSTAMP:${toUtcStamp(updated)}`, `LAST-MODIFIED:${toUtcStamp(updated)}`];
    if (allDay) {
      const next = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${fmtDate(due)}`, `DTEND;VALUE=DATE:${fmtDate(next)}`);
    } else {
      const start = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0, task.startMinutes);
      const end = new Date(start.getTime() + (task.durationMin ?? 60) * 60_000);
      lines.push(`DTSTART:${toLocalStamp(start)}`, `DTEND:${toLocalStamp(end)}`);
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
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SelfManaged//Task Manager//DE', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:SelfManaged Aufgaben', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
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

