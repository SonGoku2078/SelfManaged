import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../store';
import {
  weekViewDays,
  addDays,
  isSameDay,
  dateKey,
  tasksOnDate,
  isInNextWeekWindow,
  gridSearchTasks,
} from '../selectors';
import type { Task } from '../types';
import { readTaskIds } from '../dnd';
import './WeekView.css';

const weekDayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // 0 = Monday

interface WeekViewProps {
  mode: 'week' | 'rolling';
}


// Side-by-side layout for overlapping items (blockers + timed tasks): assigns
// each a column within its overlap cluster → { left, width } as 0..1 fractions.
type LayoutBox = { left: number; width: number };
interface Span {
  id: string;
  start: number;
  end: number;
}
function overlapLayout(spans: Span[]): Record<string, LayoutBox> {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Record<string, LayoutBox> = {};
  let cluster: Span[] = [];
  let clusterEnd = -Infinity;
  let colEnd: number[] = [];
  const colOf: Record<string, number> = {};
  const flush = () => {
    const cols = colEnd.length || 1;
    for (const s of cluster) out[s.id] = { left: colOf[s.id] / cols, width: 1 / cols };
    cluster = [];
    colEnd = [];
  };
  for (const s of sorted) {
    if (cluster.length && s.start >= clusterEnd) flush();
    if (!cluster.length) clusterEnd = s.end;
    let col = colEnd.findIndex((e) => e <= s.start);
    if (col === -1) {
      col = colEnd.length;
      colEnd.push(s.end);
    } else {
      colEnd[col] = s.end;
    }
    colOf[s.id] = col;
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.end);
  }
  flush();
  return out;
}

export default function WeekView({ mode }: WeekViewProps) {
  const currentDate = useStore((s) => s.ui.currentDate);
  const selectedDates = useStore((s) => s.ui.selectedDates);
  const setCurrentDate = useStore((s) => s.setCurrentDate);
  const allTasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const updateTask = useStore((s) => s.updateTask);
  const toggleTask = useStore((s) => s.toggleTask);
  const addTask = useStore((s) => s.addTask);
  const selectTask = useStore((s) => s.selectTask);
  const selectTaskForEdit = useStore((s) => s.selectTaskForEdit);
  const selectedTaskId = useStore((s) => s.ui.selectedTaskId);
  const startHour = useStore((s) => s.settings.calendarStartHour ?? 6);
  const endHour = useStore((s) => s.settings.calendarEndHour ?? 22);
  const hourHeight = useStore((s) => s.settings.calendarHourHeight ?? 48);
  const setCalendarHours = useStore((s) => s.setCalendarHours);
  const setCalendarHourHeight = useStore((s) => s.setCalendarHourHeight);
  const allBlockers = useStore((s) => s.blockers);
  const addBlocker = useStore((s) => s.addBlocker);
  const deleteBlocker = useStore((s) => s.deleteBlocker);
  const searchQuery = useStore((s) => s.ui.searchQuery);
  const members = useStore((s) => s.members);

  // #93: the grid bypasses selectVisibleTasks, so it has to apply the search
  // itself. Filtering once here is what keeps the day columns, the backlog and
  // the blocker project list from disagreeing with each other.
  //
  // A root task survives when it matches OR one of its subtasks matches —
  // subtasks are only ever rendered nested under their parent, so dropping a
  // non-matching parent would hide the very subtask that was searched for.
  const searching = searchQuery.trim() !== '';
  const tasks = useMemo(
    () => gridSearchTasks(allTasks, searchQuery, members),
    [allTasks, searchQuery, members]
  );

  // Blockers carry no text of their own, so they can never be a hit — while a
  // search is active they would be the only thing left standing (#93).
  const blockers = searching ? [] : allBlockers;

  const today = new Date();
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  // Re-render every minute so the "now" line stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60000);
    return () => window.clearInterval(id);
  }, []);
  // Set true during a resize so the trailing click doesn't open the detail panel.
  const suppressClick = useRef(false);

  // Blocker editor state.
  const [showBlockers, setShowBlockers] = useState(false);
  const [allDayOpen, setAllDayOpen] = useState(true);
  // Only projects that actually have tasks in Next Week can get a blocker.
  const nextWeekProjectIds = new Set(
    tasks
      .filter((t) => !t.completed && t.projectId && (t.thisWeek || isInNextWeekWindow(t)))
      .map((t) => t.projectId as string)
  );
  const blockerProjects = projects.filter((p) => nextWeekProjectIds.has(p.id));
  const [blkProject, setBlkProject] = useState('');
  const [blkDays, setBlkDays] = useState<number[]>([0, 1, 2]);
  const [blkFrom, setBlkFrom] = useState(8);
  const [blkTo, setBlkTo] = useState(12);
  // Drag-to-create a blocker directly on the grid (#40): while dragging we track
  // the day + start/current y (px from the column top); on release a small
  // project picker pops up and creates the blocker for that weekday only.
  const [blkDrag, setBlkDrag] = useState<{ day: Date; colTop: number; startY: number; curY: number } | null>(null);
  const [blkPop, setBlkPop] = useState<{ day: Date; startMinutes: number; durationMin: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!blkPop) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBlkPop(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blkPop]);

  const projectById = (id: string) => projects.find((p) => p.id === id);
  // A project's Next Week tasks (open, flagged this week or dated this week),
  // starred first — these are shown inside the project's blocker.
  const nextWeekTasksOf = (projectId: string): Task[] =>
    tasks
      .filter(
        (t) =>
          t.projectId === projectId &&
          !t.completed &&
          !t.parentId &&
          (t.thisWeek || isInNextWeekWindow(t))
      )
      .sort((a, b) => (a.starred === b.starred ? 0 : a.starred ? -1 : 1));

  // Open subtasks of a task — shown nested under their parent in the calendar.
  const openSubtasksOf = (taskId: string): Task[] =>
    tasks.filter((c) => c.parentId === taskId && !c.completed);

  // Which days become columns — shared with the header totals (#47).
  const days = weekViewDays(mode, currentDate, selectedDates, today);

  const selectedSet = new Set(selectedDates);

  // Zoom → time granularity. Taller rows reveal finer slots.
  const slots = hourHeight >= 110 ? 4 : hourHeight >= 64 ? 2 : 1;
  const snap = 60 / slots;
  const slotPx = hourHeight / slots;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = (endHour - startHour) * hourHeight;
  // Shared column track so header, all-day row and time grid always line up.
  const cols = `56px repeat(${days.length}, minmax(72px, 1fr))`;

  // Next Week backlog: open thisWeek tasks not already placed on a visible day
  // and whose project has no blocker (those are shown inside the blocker instead).
  const blockedProjectIds = new Set(blockers.map((b) => b.projectId));
  const onVisibleDay = (t: Task) =>
    !!t.dueDate && days.some((d) => isSameDay(d, t.dueDate as Date));
  const backlog = tasks.filter(
    (t) =>
      !t.parentId &&
      !t.completed &&
      t.thisWeek &&
      !onVisibleDay(t) &&
      !(t.projectId && blockedProjectIds.has(t.projectId))
  );

  const shiftWeek = (delta: number) =>
    setCurrentDate(addDays(days[0], delta * days.length));
  const goToday = () => setCurrentDate(new Date());

  // y (px from column top) → snapped minutes-from-midnight, clamped to the range.
  const yToMinutes = (y: number) => {
    const raw = startHour * 60 + (y / hourHeight) * 60;
    const snapped = Math.round(raw / snap) * snap;
    return Math.max(startHour * 60, Math.min(endHour * 60 - snap, snapped));
  };

  const dropOnNoTime = (date: Date) => (e: React.DragEvent) => {
    e.preventDefault();
    readTaskIds(e).forEach((id) =>
      updateTask(id, { dueDate: new Date(date), startMinutes: null })
    );
  };

  const dropOnTime = (date: Date, colEl: HTMLElement | null) => (e: React.DragEvent) => {
    e.preventDefault();
    const ids = readTaskIds(e);
    if (!ids.length || !colEl) return;
    const y = e.clientY - colEl.getBoundingClientRect().top;
    const start = yToMinutes(y);
    ids.forEach((id) => {
      const t = tasks.find((x) => x.id === id);
      updateTask(id, {
        dueDate: new Date(date),
        startMinutes: start,
        durationMin: t?.durationMin ?? 60,
      });
    });
  };

  const createAt = (date: Date, startMinutes: number | null) => {
    const created = addTask({
      title: 'Neue Aufgabe',
      dueDate: new Date(date),
      startMinutes,
      durationMin: startMinutes == null ? null : 60,
    });
    selectTaskForEdit(created.id);
  };

  // Drag the bottom edge of a timed block to change its duration.
  const startResizeBlock = (task: Task, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    suppressClick.current = true;
    const startY = e.clientY;
    const startDur = task.durationMin ?? 60;
    const onMove = (ev: MouseEvent) => {
      const deltaMin = ((ev.clientY - startY) / hourHeight) * 60;
      const next = Math.max(snap, Math.round((startDur + deltaMin) / snap) * snap);
      updateTask(task.id, { durationMin: next });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Keep suppressing until just after the click that follows mouseup.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // A grid drag (start/current y in px from the column top) → snapped range.
  const dragToRange = (d: { startY: number; curY: number }) => {
    const a = yToMinutes(Math.min(d.startY, d.curY));
    const b = yToMinutes(Math.max(d.startY, d.curY));
    return { startMinutes: Math.min(a, b), durationMin: Math.max(snap, Math.abs(b - a)) };
  };

  // Click-drag on empty grid space draws a blocker range (#40); on release a
  // project picker pops up (only projects with tasks this week) and the blocker
  // is created for the dragged weekday.
  const startBlockerDrag = (day: Date, e: React.MouseEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return; // empty column bg only
    e.preventDefault();
    const colTop = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    const y0 = e.clientY - colTop;
    const cur = { startY: y0, curY: y0 };
    setBlkPop(null);
    setBlkDrag({ day, colTop, startY: y0, curY: y0 });
    const onMove = (ev: MouseEvent) => {
      cur.curY = ev.clientY - colTop;
      setBlkDrag({ day, colTop, startY: y0, curY: cur.curY });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setBlkDrag(null);
      if (Math.abs(cur.curY - cur.startY) > 4) {
        const { startMinutes, durationMin } = dragToRange(cur);
        setBlkPop({ day, startMinutes, durationMin, x: ev.clientX, y: ev.clientY });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Drag the time gutter vertically to zoom (reveals 30-/15-min slots).
  const startZoom = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = hourHeight;
    const onMove = (ev: MouseEvent) => {
      setCalendarHourHeight(startH + (ev.clientY - startY) * 0.6);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Tasks are coloured by the project they belong to.
  const projColor = (task: Task) =>
    projects.find((p) => p.id === task.projectId)?.color;

  const hexToRgba = (hex: string, a: number) => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (Number.isNaN(n)) return hex;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  // Left accent + faint fill in the project colour, so each task reads as its project.
  const taskStyle = (task: Task) => {
    const c = projColor(task);
    return c ? { borderLeftColor: c, backgroundColor: hexToRgba(c, 0.16) } : undefined;
  };

  const toggleOpen = (id: string) => {
    if (suppressClick.current) return; // ignore the click after a resize
    selectTask(selectedTaskId === id ? null : id);
  };

  const rangeLabel =
    `${days[0].toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} – ` +
    days[days.length - 1].toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <div className="week-view">
      <div className="week-toolbar">
        <div className="week-nav">
          <button className="week-nav-btn" onClick={() => shiftWeek(-1)} title="Zurück">
            ‹
          </button>
          <button className="week-today-btn" onClick={goToday}>
            Heute
          </button>
          <button className="week-nav-btn" onClick={() => shiftWeek(1)} title="Weiter">
            ›
          </button>
          <span className="week-range">{rangeLabel}</span>
        </div>

        <div className="week-hours-ctrl">
          <span>Zeit</span>
          <label>
            von
            <input
              type="number"
              min={0}
              max={23}
              value={startHour}
              onChange={(e) => setCalendarHours(Number(e.target.value), endHour)}
            />
          </label>
          <label>
            bis
            <input
              type="number"
              min={1}
              max={24}
              value={endHour}
              onChange={(e) => setCalendarHours(startHour, Number(e.target.value))}
            />
          </label>
          <span>Uhr</span>
          <button
            className={`week-blocker-toggle ${showBlockers ? 'on' : ''}`}
            onClick={() => setShowBlockers((v) => !v)}
            title="Projekt-Blocker verwalten"
          >
            🧱 Blocker
          </button>
        </div>
      </div>

      {showBlockers && (
        <div className="week-blocker-editor">
          <div className="week-blocker-form">
            <select value={blkProject} onChange={(e) => setBlkProject(e.target.value)}>
              <option value="">
                {blockerProjects.length ? 'Projekt wählen…' : 'Keine Projekte in Next Week'}
              </option>
              {blockerProjects.map((p) => (
                <option key={p.id} value={p.id} style={{ color: p.color }}>
                  ● {p.name}
                </option>
              ))}
            </select>
            <div className="week-blocker-days">
              {weekDayLabels.map((lbl, i) => (
                <button
                  key={lbl}
                  className={blkDays.includes(i) ? 'on' : ''}
                  onClick={() =>
                    setBlkDays((d) =>
                      d.includes(i) ? d.filter((x) => x !== i) : [...d, i]
                    )
                  }
                >
                  {lbl}
                </button>
              ))}
            </div>
            <label>
              von
              <input type="number" min={0} max={23} value={blkFrom}
                onChange={(e) => setBlkFrom(Number(e.target.value))} />
            </label>
            <label>
              bis
              <input type="number" min={1} max={24} value={blkTo}
                onChange={(e) => setBlkTo(Number(e.target.value))} />
            </label>
            <button
              className="week-blocker-add"
              disabled={!blkProject || blkDays.length === 0 || blkTo <= blkFrom}
              onClick={() => {
                addBlocker({
                  projectId: blkProject,
                  weekdays: [...blkDays].sort(),
                  startMinutes: blkFrom * 60,
                  durationMin: (blkTo - blkFrom) * 60,
                });
              }}
            >
              + Blocker
            </button>
          </div>
          <div className="week-blocker-list">
            {/* The editor always lists the real blockers — hiding them during a
                search would make them unmanageable; only the grid hides them. */}
            {allBlockers.length === 0 && <span className="week-blocker-empty">Noch keine Blocker.</span>}
            {allBlockers.map((b) => {
              const p = projectById(b.projectId);
              const fromH = Math.floor(b.startMinutes / 60);
              const toH = Math.floor((b.startMinutes + b.durationMin) / 60);
              return (
                <span key={b.id} className="week-blocker-chip" style={{ borderColor: p?.color }}>
                  {p?.name ?? 'Projekt'} · {b.weekdays.map((w) => weekDayLabels[w]).join('')}{' '}
                  {fromH}–{toH} Uhr
                  <button onClick={() => deleteBlocker(b.id)} title="Löschen">×</button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {backlog.length > 0 && (
        <div className="week-backlog">
          <span className="week-backlog-label">🗓️ Next Week ({backlog.length}) — auf einen Tag ziehen:</span>
          <div className="week-backlog-items">
            {backlog.map((t) => (
              <div
                key={t.id}
                className={`week-task ${t.completed ? 'done' : ''} ${
                  selectedTaskId === t.id ? 'selected' : ''
                }`}
                style={taskStyle(t)}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                onClick={() => toggleOpen(t.id)}
                title={t.title}
              >
                <input
                  type="checkbox"
                  className="week-task-check"
                  checked={t.completed}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleTask(t.id);
                  }}
                />
                <span className="week-task-title">{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="week-grid-scroll">
      {/* Column headers */}
      <div className="week-head" style={{ gridTemplateColumns: cols }}>
        <div className="week-gutter-head" />
        {days.map((d) => (
          <div
            key={dateKey(d)}
            className={`week-col-head ${isSameDay(d, today) ? 'is-today' : ''} ${
              selectedSet.has(dateKey(d)) ? 'is-selected' : ''
            }`}
          >
            <span className="week-col-day">{weekDayLabels[(d.getDay() + 6) % 7]}</span>
            <span className="week-col-date">{d.getDate()}.</span>
          </div>
        ))}
      </div>

      {/* "ohne Zeit" — tasks that only have a date */}
      <div className="week-allday" style={{ gridTemplateColumns: cols }}>
        <div
          className="week-gutter-label week-gutter-label-toggle"
          onClick={() => setAllDayOpen((v) => !v)}
          title={allDayOpen ? 'Einklappen' : 'Ausklappen'}
        >
          <span className="week-allday-arrow">{allDayOpen ? '▾' : '▸'}</span>
          ohne&nbsp;Zeit
        </div>
        {days.map((d) => {
          const dayTasks = tasksOnDate(tasks, d).filter(
            (t) => !t.parentId && t.startMinutes == null
          );
          if (!allDayOpen) {
            return (
              <div
                key={dateKey(d)}
                className="week-allday-cell week-allday-cell-collapsed"
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('text/plain')) e.preventDefault();
                }}
                onDrop={dropOnNoTime(d)}
                onDoubleClick={() => { setAllDayOpen(true); createAt(d, null); }}
                title={dayTasks.length ? dayTasks.map((t) => t.title).join('\n') : undefined}
              >
                {dayTasks.map((t) => (
                  <span
                    key={t.id}
                    className={`week-allday-dot ${t.completed ? 'done' : ''}`}
                    style={{ background: (projects.find((p) => p.id === t.projectId)?.color) ?? 'var(--accent)' }}
                    onClick={(e) => { e.stopPropagation(); toggleOpen(t.id); }}
                  />
                ))}
              </div>
            );
          }
          return (
            <div
              key={dateKey(d)}
              className="week-allday-cell"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/plain')) e.preventDefault();
              }}
              onDrop={dropOnNoTime(d)}
              onDoubleClick={() => createAt(d, null)}
            >
              {dayTasks.map((t) => (
                <div
                  key={t.id}
                  className={`week-task ${t.completed ? 'done' : ''} ${
                    selectedTaskId === t.id ? 'selected' : ''
                  }`}
                  style={taskStyle(t)}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                  onClick={() => toggleOpen(t.id)}
                  title={t.title}
                >
                  <input
                    type="checkbox"
                    className="week-task-check"
                    checked={t.completed}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleTask(t.id);
                    }}
                  />
                  <span className="week-task-title">{t.title}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
        <div className="week-grid" style={{ gridTemplateColumns: cols }}>
          <div className="week-gutter" style={{ height: gridHeight }} onMouseDown={startZoom} title="Ziehen zum Zoomen (Stunden / 30 / 15 Min)">
            {hours.map((h) => (
              <div key={h} className="week-hour-label" style={{ height: hourHeight }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map((d) => {
            const colRef = { current: null as HTMLElement | null };
            const timed = tasksOnDate(tasks, d).filter(
              (t) => !t.parentId && t.startMinutes != null
            );
            const wd = weekdayIndex(d);
            const dayBlockers = blockers.filter((b) => b.weekdays.includes(wd));
            // Lay blockers and timed tasks side by side wherever they overlap.
            const layout = overlapLayout([
              ...dayBlockers.map((b) => ({
                id: b.id,
                start: b.startMinutes,
                end: b.startMinutes + b.durationMin,
              })),
              ...timed.map((t) => {
                const s = t.startMinutes ?? startHour * 60;
                return { id: t.id, start: s, end: s + (t.durationMin ?? 60) };
              }),
            ]);
            // Inline horizontal placement (overrides the CSS left/right insets).
            const boxStyle = (id: string, inset: number) => {
              const b = layout[id] ?? { left: 0, width: 1 };
              return {
                left: `calc(${b.left * 100}% + ${inset}px)`,
                width: `calc(${b.width * 100}% - ${inset * 2}px)`,
                right: 'auto' as const,
              };
            };
            return (
              <div
                key={dateKey(d)}
                className={`week-col ${isSameDay(d, today) ? 'is-today' : ''}`}
                style={{
                  height: gridHeight,
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--border-light) 0, var(--border-light) 1px, transparent 1px, transparent ${slotPx}px)`,
                }}
                ref={(el) => {
                  colRef.current = el;
                }}
                onMouseDown={(e) => startBlockerDrag(d, e)}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('text/plain')) e.preventDefault();
                }}
                onDrop={(e) => dropOnTime(d, colRef.current)(e)}
                onDoubleClick={(e) => {
                  const y = e.clientY - (colRef.current?.getBoundingClientRect().top ?? 0);
                  createAt(d, yToMinutes(y));
                }}
              >
                {/* Drag-to-create blocker preview (#40) */}
                {blkDrag && isSameDay(blkDrag.day, d) && (() => {
                  const { startMinutes, durationMin } = dragToRange(blkDrag);
                  return (
                    <div
                      className="week-blocker-preview"
                      style={{
                        top: ((startMinutes - startHour * 60) / 60) * hourHeight,
                        height: Math.max(4, (durationMin / 60) * hourHeight),
                      }}
                    >
                      {String(Math.floor(startMinutes / 60)).padStart(2, '0')}:
                      {String(startMinutes % 60).padStart(2, '0')}–
                      {String(Math.floor((startMinutes + durationMin) / 60)).padStart(2, '0')}:
                      {String((startMinutes + durationMin) % 60).padStart(2, '0')}
                    </div>
                  );
                })()}

                {/* Current-time indicator (red line) on today's column */}
                {isSameDay(d, today) &&
                  nowMinutes >= startHour * 60 &&
                  nowMinutes < endHour * 60 && (
                    <div
                      className="week-now-line"
                      style={{ top: ((nowMinutes - startHour * 60) / 60) * hourHeight }}
                    />
                  )}

                {/* Project blockers (background) with the project's current next action */}
                {dayBlockers.map((b) => {
                  const p = projectById(b.projectId);
                  const top = ((b.startMinutes - startHour * 60) / 60) * hourHeight;
                  const height = Math.max(18, (b.durationMin / 60) * hourHeight);
                  const nwTasks = nextWeekTasksOf(b.projectId);
                  return (
                    <div
                      key={b.id}
                      className="week-blocker-block"
                      style={{
                        top,
                        height,
                        ...boxStyle(b.id, 1),
                        background: p ? hexToRgba(p.color, 0.16) : 'rgba(0,0,0,0.05)',
                        borderColor: p?.color ?? 'var(--border-light)',
                        color: p?.color ?? 'var(--text-secondary)',
                      }}
                      title={`${p?.name ?? 'Projekt'} (Aktiv) – ${nwTasks.length} Next-Week-Aufgabe(n)`}
                    >
                      <span className="week-blocker-name" style={{ color: p?.color }}>
                        ● {p?.name}
                      </span>
                      <div className="week-blocker-tasks">
                        {nwTasks.map((t) => (
                          <div key={t.id}>
                            <button
                              className={`week-blocker-na ${selectedTaskId === t.id ? 'selected' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleOpen(t.id);
                              }}
                              title={`Öffnen: ${t.title}`}
                            >
                              {t.title}
                            </button>
                            {openSubtasksOf(t.id).map((s) => (
                              <button
                                key={s.id}
                                className={`week-blocker-na week-blocker-sub ${selectedTaskId === s.id ? 'selected' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleOpen(s.id);
                                }}
                                title={`Öffnen: ${s.title}`}
                              >
                                ↳ {s.title}
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {timed.map((t) => {
                  const start = t.startMinutes ?? startHour * 60;
                  const top = ((start - startHour * 60) / 60) * hourHeight;
                  const height = Math.max(18, ((t.durationMin ?? 60) / 60) * hourHeight);
                  return (
                    <div
                      key={t.id}
                      className={`week-block ${t.completed ? 'done' : ''} ${
                        selectedTaskId === t.id ? 'selected' : ''
                      }`}
                      style={{
                        top,
                        height,
                        ...boxStyle(t.id, 2),
                        borderLeftColor: 'var(--accent)',
                        ...taskStyle(t),
                      }}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      onClick={() => toggleOpen(t.id)}
                      title={t.title}
                    >
                      <span className="week-block-time">
                        {String(Math.floor(start / 60)).padStart(2, '0')}:
                        {String(start % 60).padStart(2, '0')}
                      </span>
                      <span className="week-block-title">{t.title}</span>
                      <span
                        className="week-block-resize"
                        onMouseDown={(e) => startResizeBlock(t, e)}
                        title="Dauer ziehen"
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Project picker after drawing a blocker on the grid (#40). */}
      {blkPop && (
        <>
          <div className="week-blkpop-backdrop" onMouseDown={() => setBlkPop(null)} />
          <div
            className="week-blkpop"
            style={{
              left: Math.min(blkPop.x, window.innerWidth - 240),
              top: Math.min(blkPop.y, window.innerHeight - 280),
            }}
          >
            <div className="week-blkpop-head">
              <span>
                Blocker {String(Math.floor(blkPop.startMinutes / 60)).padStart(2, '0')}:
                {String(blkPop.startMinutes % 60).padStart(2, '0')}–
                {String(Math.floor((blkPop.startMinutes + blkPop.durationMin) / 60)).padStart(2, '0')}:
                {String((blkPop.startMinutes + blkPop.durationMin) % 60).padStart(2, '0')}
              </span>
              <span className="week-blkpop-day">{weekDayLabels[weekdayIndex(blkPop.day)]}</span>
            </div>
            {blockerProjects.length === 0 ? (
              <p className="week-blkpop-empty">Keine Projekte mit Aufgaben in dieser Woche.</p>
            ) : (
              <div className="week-blkpop-list">
                {blockerProjects.map((p) => (
                  <button
                    key={p.id}
                    className="week-blkpop-item"
                    onClick={() => {
                      addBlocker({
                        projectId: p.id,
                        weekdays: [weekdayIndex(blkPop.day)],
                        startMinutes: blkPop.startMinutes,
                        durationMin: blkPop.durationMin,
                      });
                      setBlkPop(null);
                    }}
                  >
                    <span className="week-blkpop-dot" style={{ background: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            <button className="week-blkpop-cancel" onClick={() => setBlkPop(null)}>
              Abbrechen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
