import type { Task } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

// Floating local datetime: YYYYMMDDTHHMMSS (no timezone — interpreted as local).
const toLocalStamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// UTC stamp with trailing Z for DTSTAMP.
const toUtcStamp = (d: Date) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const escapeText = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// Fold lines longer than 75 octets per RFC 5545 (simple char-based fold).
const fold = (line: string) => {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
};

export function tasksToICS(tasks: Task[], calName = 'Nozbe Aufgaben'): string {
  const now = new Date();
  const dtstamp = toUtcStamp(now);

  const events = tasks
    .filter((t) => t.dueDate)
    .map((t) => {
      const start = t.dueDate as Date;
      const end = new Date(start.getTime() + 60 * 60 * 1000); // +1h
      const summary = `${t.completed ? '✓ ' : ''}${t.title}`;
      const lines = [
        'BEGIN:VEVENT',
        fold(`UID:${t.id}@nozbe-clone`),
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${toLocalStamp(start)}`,
        `DTEND:${toLocalStamp(end)}`,
        fold(`SUMMARY:${escapeText(summary)}`),
      ];
      if (t.description.trim()) {
        lines.push(fold(`DESCRIPTION:${escapeText(t.description)}`));
      }
      if (t.completed) lines.push('STATUS:CONFIRMED');
      lines.push('END:VEVENT');
      return lines.join('\r\n');
    });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SelfManaged//Task Manager//DE',
    'CALSCALE:GREGORIAN',
    fold(`X-WR-CALNAME:${escapeText(calName)}`),
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

// Trigger a browser download of the given tasks as an .ics file.
export function downloadICS(tasks: Task[], filename = 'nozbe-tasks.ics') {
  const ics = tasksToICS(tasks);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
