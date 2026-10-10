import { useState } from 'react';
import { useStore } from '../store';
import { parseDuration, formatDuration, minutesToTimeInput, timeInputToMinutes } from '../duration';
import { dateKey, isTodayFlagActive, countsAsToday, isImplicitToday } from '../selectors';
import { useSwipeDown } from '../gestures';
import { isEvernoteUrl, DEFAULT_EVERNOTE_TITLE } from '../evernote';
import type { Priority, RecurrenceType, RecurUnit, RecurMonthDay, TaskLink, Task } from '../types';
import ProjectPicker from './ProjectPicker';

const toInput = (d: Date | null | undefined) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
const fromInput = (v: string): Date | null => (v ? new Date(`${v}T00:00:00`) : null);

export default function TaskDetailModal({
  taskId,
  onClose,
  onOpenTask,
  onOpenProject,
}: {
  taskId: string;
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onOpenProject?: (id: string) => void;
}) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const members = useStore((s) => s.members);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const toggleTask = useStore((s) => s.toggleTask);
  const toggleStar = useStore((s) => s.toggleStar);
  const addSubtask = useStore((s) => s.addSubtask);
  const addComment = useStore((s) => s.addComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const addTaskLink = useStore((s) => s.addTaskLink);
  const removeTaskLink = useStore((s) => s.removeTaskLink);
  const toggleTaskAssignee = useStore((s) => s.toggleTaskAssignee);

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [durationInput, setDurationInput] = useState(task?.durationMin ? formatDuration(task.durationMin) : '');
  // Swipe the sheet down to close (commits edits first, like ✕). The thunk
  // defers to `close` defined below — only invoked on touch-end.
  const swipe = useSwipeDown(() => close());

  if (!task) return null;
  const t = task;

  // Commit free-text fields (title/description/duration) — on blur and on close,
  // so a swipe-down / ✕ never loses edits.
  const commitText = () => {
    const patch: Partial<Task> = {};
    if (title.trim() && title.trim() !== t.title) patch.title = title.trim();
    if (description !== t.description) patch.description = description;
    if (Object.keys(patch).length) updateTask(t.id, patch);
  };
  const commitDuration = () => {
    const val = durationInput.trim() ? parseDuration(durationInput) : null;
    if (val !== (t.durationMin ?? null)) updateTask(t.id, { durationMin: val });
    setDurationInput(val ? formatDuration(val) : '');
  };
  const close = () => { commitText(); onClose(); };
  // Delete sits in the head now, right next to Save — ask before a mis-tap
  // throws the task away.
  const remove = () => {
    if (!window.confirm(`#${t.number} „${t.title}" löschen?`)) return;
    deleteTask(t.id);
    onClose();
  };

  const assigneeIds = t.assigneeIds ?? (t.assigneeId ? [t.assigneeId] : []);
  const subtasks = tasks.filter((s) => s.parentId === t.id);
  const doneSubs = subtasks.filter((s) => s.completed).length;

  return (
    <div className="m-modal-backdrop" onClick={close}>
      <div className="m-modal" onClick={(e) => e.stopPropagation()} style={swipe.style} {...swipe.handlers}>
        {/* Sticky head with Save + Delete — reachable while the keyboard
            covers the bottom of the sheet (same as the share sheet). */}
        <div className="m-modal-head m-share-head">
          <span className="m-modal-num">#{t.number}</span>
          <div className="m-modal-head-actions">
            <button
              className={`m-complete ${t.completed ? 'done' : ''}`}
              onClick={() => toggleTask(t.id)}
            >
              {t.completed ? '↺ Öffnen' : '✓ Erledigen'}
            </button>
            <button className={`m-star ${t.starred ? 'on' : ''}`} onClick={() => toggleStar(t.id)}>
              {t.starred ? '★' : '☆'}
            </button>
            <button className="m-head-del" onClick={remove} aria-label="Löschen" title="Löschen">🗑</button>
            <button className="m-share-save" onClick={close}>Speichern</button>
          </div>
        </div>

        {t.parentId && (
          <button className="m-back" onClick={() => onOpenTask(t.parentId!)}>‹ Übergeordnete Aufgabe</button>
        )}

        <label className="m-field">
          <span>Titel</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commitText} />
        </label>

        <label className="m-field">
          <span>Beschreibung</span>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commitText} />
        </label>

        {/* GTD flags relevant on mobile (Someday/Warten stay browser-only). */}
        <div className="m-gtd-row">
          <button className={`m-gtd-btn ${t.starred ? 'on' : ''}`} onClick={() => toggleStar(t.id)}>★ Nächste Aktion</button>
          {/* #81: heute faellig = implizit markiert, deshalb aktiv, aber
              gesperrt — Umschalten waere wirkungslos. */}
          <button
            className={`m-gtd-btn ${countsAsToday(t) ? 'on' : ''}`}
            disabled={isImplicitToday(t)}
            title={isImplicitToday(t) ? 'Heute fällig — erscheint automatisch in Heute' : undefined}
            onClick={() => updateTask(t.id, { todayDate: isTodayFlagActive(t) ? null : dateKey(new Date()) })}
          >
            ☀️ Heute
          </button>
          <button className={`m-gtd-btn ${t.thisWeek ? 'on' : ''}`} onClick={() => updateTask(t.id, { thisWeek: !t.thisWeek })}>🗓️ Next Week</button>
        </div>

        <div className="m-field-row">
          <label className="m-field">
            <span>Priorität</span>
            <select value={t.priority} onChange={(e) => updateTask(t.id, { priority: e.target.value as Priority })}>
              <option value="high">Hoch</option>
              <option value="medium">Mittel</option>
              <option value="low">Niedrig</option>
            </select>
          </label>
          <label className="m-field">
            <span>Fällig</span>
            <input type="date" value={toInput(t.dueDate)} onChange={(e) => updateTask(t.id, { dueDate: fromInput(e.target.value) })} />
          </label>
        </div>

        {/* Zwei Felder pro Reihe — native date/time-Inputs schrumpfen nicht,
            drei nebeneinander sprengten die Breite (#30-Feedback). */}
        <div className="m-field-row">
          <label className="m-field">
            <span>Uhrzeit</span>
            <input
              type="time"
              value={minutesToTimeInput(t.startMinutes)}
              onChange={(e) => updateTask(t.id, { startMinutes: timeInputToMinutes(e.target.value) })}
            />
          </label>
          <label className="m-field">
            <span>Dauer</span>
            <input
              value={durationInput}
              placeholder="z.B. 30m, 1h30m"
              inputMode="text"
              onChange={(e) => setDurationInput(e.target.value)}
              onBlur={commitDuration}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
          </label>
        </div>

        <div className="m-field-row">
          <label className="m-field">
            <span>Wiederholung</span>
            <select value={t.recurrence} onChange={(e) => updateTask(t.id, { recurrence: e.target.value as RecurrenceType })}>
              <option value="none">Keine</option>
              <option value="daily">Täglich</option>
              <option value="weekly">Wöchentlich</option>
              <option value="monthly">Monatlich</option>
              <option value="yearly">Jährlich</option>
              <option value="custom">Benutzerdefiniert…</option>
            </select>
          </label>
        </div>

        {t.recurrence === 'custom' && (
          <div className="m-field-row">
            <label className="m-field m-field-num">
              <span>Alle</span>
              <input
                type="number"
                min={1}
                value={t.recurInterval ?? 1}
                onChange={(e) => updateTask(t.id, { recurInterval: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <label className="m-field">
              <span>Einheit</span>
              <select value={t.recurUnit ?? 'week'} onChange={(e) => updateTask(t.id, { recurUnit: e.target.value as RecurUnit })}>
                <option value="day">Tage</option>
                <option value="week">Wochen</option>
                <option value="month">Monate</option>
                <option value="year">Jahre</option>
              </select>
            </label>
            {(t.recurUnit ?? 'week') === 'month' && (
              <label className="m-field">
                <span>Im Monat</span>
                <select value={t.recurMonthDay ?? 'date'} onChange={(e) => updateTask(t.id, { recurMonthDay: e.target.value as RecurMonthDay })}>
                  <option value="date">am Datum</option>
                  <option value="first">1. Wochentag</option>
                  <option value="last">letzter Tag</option>
                </select>
              </label>
            )}
          </div>
        )}

        {t.recurrence !== 'none' && (
          <div className="m-field-row">
            <label className="m-field">
              <span>Endet am (optional)</span>
              <input type="date" value={toInput(t.recurrenceEnd)} onChange={(e) => updateTask(t.id, { recurrenceEnd: fromInput(e.target.value) })} />
            </label>
            <button className="m-btn-ghost" title="Wiederholung beenden" onClick={() => updateTask(t.id, { recurrence: 'none', recurrenceEnd: null })}>⏹ Beenden</button>
          </div>
        )}

        <ProjectPicker
          collapsible
          value={t.projectId ?? null}
          onChange={(projectId) => updateTask(t.id, { projectId })}
        />

        {categories.length > 0 && (
          <div className="m-field">
            <span>Kategorien</span>
            <div className="m-cats">
              {categories.map((c) => {
                const on = t.categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    className={`m-cat ${on ? 'on' : ''}`}
                    style={on ? { background: c.color, borderColor: c.color } : undefined}
                    onClick={() =>
                      updateTask(t.id, {
                        categoryIds: on ? t.categoryIds.filter((id) => id !== c.id) : [...t.categoryIds, c.id],
                      })
                    }
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {members.length > 0 && (
          <div className="m-field">
            <span>Verantwortlich</span>
            <div className="m-cats">
              {members.map((m) => {
                const on = assigneeIds.includes(m.id);
                return (
                  <button key={m.id} className={`m-cat ${on ? 'on' : ''}`} onClick={() => toggleTaskAssignee(t.id, m.id)}>
                    {on ? '✓ ' : ''}{m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <SubtasksSection
          subtasks={subtasks}
          done={doneSubs}
          onToggle={toggleTask}
          onOpen={onOpenTask}
          onAdd={(title) => addSubtask(t.id, title)}
        />

        <LinksSection
          links={t.links ?? []}
          tasks={tasks}
          projects={projects}
          selfId={t.id}
          onAdd={(link) => addTaskLink(t.id, link)}
          onRemove={(link) => removeTaskLink(t.id, link)}
          onOpenTask={onOpenTask}
          onOpenProject={onOpenProject}
        />

        <CommentsSection
          comments={t.comments ?? []}
          onAdd={(text) => addComment(t.id, text)}
          onDelete={(id) => deleteComment(t.id, id)}
        />

        <label className="m-toggle">
          <input type="checkbox" checked={t.completed} onChange={() => toggleTask(t.id)} />
          <span>Erledigt</span>
        </label>
      </div>
    </div>
  );
}

// ── Subtasks ──
function SubtasksSection({
  subtasks, done, onToggle, onOpen, onAdd,
}: {
  subtasks: Task[];
  done: number;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onAdd: (title: string) => void;
}) {
  const [val, setVal] = useState('');
  const add = () => { const v = val.trim(); if (v) { onAdd(v); setVal(''); } };
  return (
    <div className="m-field">
      <span>Unteraufgaben {subtasks.length > 0 && `(${done}/${subtasks.length})`}</span>
      {subtasks.map((s) => (
        <div key={s.id} className={`m-subtask ${s.completed ? 'done' : ''}`}>
          <input type="checkbox" className="m-check" checked={s.completed} onChange={() => onToggle(s.id)} />
          <span className="m-subtask-title" onClick={() => onOpen(s.id)}>{s.title}</span>
        </div>
      ))}
      <div className="m-quickadd m-inline-add">
        <input
          className="m-quickadd-input"
          placeholder="+ Unteraufgabe…"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button className="m-quickadd-add" onClick={add} disabled={!val.trim()}>+</button>
      </div>
    </div>
  );
}

// ── Links ──
function LinksSection({
  links, tasks, projects, selfId, onAdd, onRemove, onOpenTask, onOpenProject,
}: {
  links: TaskLink[];
  tasks: Task[];
  projects: { id: string; name: string }[];
  selfId: string;
  onAdd: (link: TaskLink) => void;
  onRemove: (link: TaskLink) => void;
  onOpenTask: (id: string) => void;
  onOpenProject?: (id: string) => void;
}) {
  const rootTasks = tasks.filter((t) => !t.parentId && t.id !== selfId && !t.completed);
  const [evnUrl, setEvnUrl] = useState('');
  const [evnTitle, setEvnTitle] = useState('');
  const [evnError, setEvnError] = useState('');
  const addEvernote = () => {
    const url = evnUrl.trim();
    if (!isEvernoteUrl(url)) { setEvnError('Kein gültiger Evernote-Link.'); return; }
    onAdd({ type: 'evernote', id: `evn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, url, title: evnTitle.trim() || undefined });
    setEvnUrl(''); setEvnTitle(''); setEvnError('');
  };
  return (
    <div className="m-field">
      <span>Verknüpfungen</span>
      {links.length > 0 && (
        <div className="m-cats">
          {links.map((link) => {
            if (link.type === 'evernote') {
              return (
                <span key={`evernote:${link.id}`} className="m-link-chip m-link-evernote">
                  <a className="m-link-open" href={link.url} target="_blank" rel="noopener noreferrer">
                    🐘 {link.title || DEFAULT_EVERNOTE_TITLE}
                  </a>
                  <button className="m-link-del" onClick={() => onRemove(link)}>×</button>
                </span>
              );
            }
            const isProject = link.type === 'project';
            const proj = isProject ? projects.find((p) => p.id === link.id) : null;
            const lt = !isProject ? tasks.find((x) => x.id === link.id) : null;
            const label = isProject ? `🎯 ${proj?.name ?? '?'}` : `🔗 #${lt?.number ?? '?'} ${lt?.title ?? ''}`;
            return (
              <span key={`${link.type}:${link.id}`} className="m-link-chip">
                <button
                  className="m-link-open"
                  onClick={() => (isProject ? onOpenProject?.(link.id) : onOpenTask(link.id))}
                >
                  {label}
                </button>
                <button className="m-link-del" onClick={() => onRemove(link)}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <select
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          const [type, id] = e.target.value.split(':');
          onAdd({ type: type as 'task' | 'project', id });
          e.target.value = '';
        }}
      >
        <option value="">+ Verknüpfung hinzufügen…</option>
        <optgroup label="Projekte">
          {projects.map((p) => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}
        </optgroup>
        <optgroup label="Aufgaben">
          {rootTasks.map((rt) => <option key={rt.id} value={`task:${rt.id}`}>#{rt.number} {rt.title}</option>)}
        </optgroup>
      </select>
      {/* Evernote note link (#8) */}
      <div className="m-evernote-add">
        <input
          placeholder="🐘 Evernote-Link (evernote:/// oder evernote.com)"
          value={evnUrl}
          onChange={(e) => { setEvnUrl(e.target.value); setEvnError(''); }}
        />
        <input placeholder="Titel (optional)" value={evnTitle} onChange={(e) => setEvnTitle(e.target.value)} />
        <button className="m-evernote-btn" onClick={addEvernote}>+ Evernote</button>
      </div>
      {evnError && <p className="m-settings-hint" style={{ color: '#e5484d' }}>{evnError}</p>}
    </div>
  );
}

// ── Comments ──
function CommentsSection({
  comments, onAdd, onDelete,
}: {
  comments: { id: string; text: string; author: string; createdAt: Date }[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [val, setVal] = useState('');
  const add = () => { const v = val.trim(); if (v) { onAdd(v); setVal(''); } };
  return (
    <div className="m-field">
      <span>Kommentare</span>
      {comments.map((c) => (
        <div key={c.id} className="m-comment">
          <div className="m-comment-head">
            <span className="m-comment-author">{c.author}</span>
            <span className="m-comment-date">{new Date(c.createdAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}</span>
            <button className="m-comment-del" onClick={() => onDelete(c.id)}>×</button>
          </div>
          <div className="m-comment-text">{c.text}</div>
        </div>
      ))}
      <div className="m-quickadd m-inline-add">
        <input
          className="m-quickadd-input"
          placeholder="+ Kommentar…"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button className="m-quickadd-add" onClick={add} disabled={!val.trim()}>+</button>
      </div>
    </div>
  );
}
