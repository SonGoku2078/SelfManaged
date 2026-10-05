// ICS (RFC 5545) generator for the subscribable calendar feed (issue #24).
//
// Server-side sibling of src/ics.ts (the browser download exporter). Kept
// separate because server/tsconfig.json has rootDir "src" and compiles to
// CommonJS, so it cannot import frontend modules. This version additionally
// supports all-day vs timed events (startMinutes/durationMin) and RRULE.
//
// All event times are floating local datetimes (no VTIMEZONE): server and
// calendar clients share one household timezone on the LAN.

export interface IcsTask {
  id: string;
  title: string;
  description: string;
  dueDate: Date | null;
  startMinutes: number | null; // minutes from midnight; null = all-day
  durationMin: number | null; // event length in minutes (default 60 when timed)
  completed: boolean;
  updatedAt: Date;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  recurrenceEnd: Date | null;
  recurInterval: number | null;
  recurUnit: 'day' | 'week' | 'month' | 'year' | null;
  recurMonthDay: 'date' | 'first' | 'last' | null;
  projectName?: string | null; // rendered as CATEGORIES
}

const pad = (n: number) => String(n).padStart(2, '0');

// Floating local datetime: YYYYMMDDTHHMMSS (no timezone — interpreted as local).
const toLocalStamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// Local date only: YYYYMMDD (for all-day events and UNTIL on all-day series).
const fmtDate = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// UTC stamp with trailing Z for DTSTAMP/LAST-MODIFIED.
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

// Fold lines longer than 75 octets per RFC 5545. Counts UTF-8 bytes, not
// chars — "✓" and umlauts are multi-byte and a char-based fold can overflow.
const fold = (line: string): string => {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    // Continuation lines carry a leading space, leaving a 74-octet budget.
    if (bytes + b > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  if (cur || out.length === 0) out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ' ' + l)).join('\r\n');
};

// Map the app's recurrence model to an RRULE. Only OPEN tasks project a
// series: completing a recurring task spawns a fresh row for the next
// occurrence (src/recurrence.ts), so a completed row emitting an RRULE would
// duplicate the series the spawned row already represents.
// recurMonthDay semantics mirror nextRecurrence (src/store.ts): 'first' = day
// 1 of the month, 'last' = last calendar day. DTSTART may not itself lie on
// that day — clients tolerate this and start the pattern at the next match.
const buildRRule = (t: IcsTask, allDay: boolean): string | null => {
  if (t.completed || t.recurrence === 'none') return null;
  const unit =
    t.recurrence === 'custom'
      ? t.recurUnit ?? 'day'
      : ({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const)[t.recurrence];
  const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[unit];
  const parts = [`FREQ=${freq}`];
  const interval = t.recurrence === 'custom' ? Math.max(1, t.recurInterval ?? 1) : 1;
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (unit === 'month') {
    if (t.recurMonthDay === 'first') parts.push('BYMONTHDAY=1');
    else if (t.recurMonthDay === 'last') parts.push('BYMONTHDAY=-1');
  }
  if (t.recurrenceEnd) {
    // UNTIL matches the DTSTART form: date for all-day, floating local for timed.
    parts.push(`UNTIL=${allDay ? fmtDate(t.recurrenceEnd) : `${fmtDate(t.recurrenceEnd)}T235959`}`);
  }
  return `RRULE:${parts.join(';')}`;
};

export function tasksToICS(tasks: IcsTask[], calName = 'SelfManaged Aufgaben'): string {
  const events = tasks
    .filter((t) => t.dueDate)
    .map((t) => {
      const due = t.dueDate as Date;
      const allDay = t.startMinutes == null;
      const stamp = toUtcStamp(t.updatedAt);
      const lines = [
        'BEGIN:VEVENT',
        fold(`UID:${t.id}@selfmanaged`),
        `DTSTAMP:${stamp}`,
        `LAST-MODIFIED:${stamp}`,
      ];
      if (allDay) {
        const nextDay = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
        lines.push(`DTSTART;VALUE=DATE:${fmtDate(due)}`, `DTEND;VALUE=DATE:${fmtDate(nextDay)}`);
      } else {
        const start = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 0, t.startMinutes as number);
        const end = new Date(start.getTime() + (t.durationMin || 30) * 60_000);
        lines.push(`DTSTART:${toLocalStamp(start)}`, `DTEND:${toLocalStamp(end)}`);
      }
      const rrule = buildRRule(t, allDay);
      if (rrule) lines.push(rrule);
      lines.push(fold(`SUMMARY:${escapeText(`${t.completed ? '✓ ' : ''}${t.title}`)}`));
      if (t.description.trim()) lines.push(fold(`DESCRIPTION:${escapeText(t.description)}`));
      if (t.projectName) lines.push(fold(`CATEGORIES:${escapeText(t.projectName)}`));
      lines.push('END:VEVENT');
      return lines.join('\r\n');
    });

  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SelfManaged//Task Manager//DE',
      'CALSCALE:GREGORIAN',
      fold(`X-WR-CALNAME:${escapeText(calName)}`),
      // Suggested polling interval for subscribing clients (advisory only).
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}
