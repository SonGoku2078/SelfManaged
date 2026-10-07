import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent } from 'react';
import { marked } from 'marked';
import type { Task, Attachment } from '../types';
import { useStore } from '../store';
import { dateKey, isTodayFlagActive, countsAsToday, isImplicitToday } from '../selectors';
import { taskShareUrl } from '../config';
import ClearableInput from './ClearableInput';
import Avatar from './Avatar';
import AvatarStack from './AvatarStack';
import { assigneesOf } from '../members';
import SearchSelect from './SearchSelect';
import type { SearchOption } from './SearchSelect';
import { DescToolbar } from './DescToolbar';
import AttachmentPreview, { previewKind } from './AttachmentPreview';
import './TaskDetailPanel.css';
import './ProjectDetailPanel.css';

// Shared Markdown renderer (links open in new tab).
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) =>
  `<a href="${href ?? ''}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;
marked.setOptions({ renderer, breaks: true });

function renderMarkdown(text: string): string {
  return (marked.parse(text) as string)
    .replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/g, '')
    .replace(/<li>\n?<p>([\s\S]*?)<\/p>\n?<\/li>/g, '<li>$1</li>');
}

// Render description: detect "Referenz :" lines and style them separately.
function renderTaskDesc(text: string): string {
  const html = renderMarkdown(text);
  return html.replace(
    /Referenz\s*:\s*([^<]*)/g,
    '<span class="desc-ref-badge">📎 Ref</span><span class="desc-ref-path">$1</span>',
  );
}

interface TaskDetailPanelProps {
  task: Task;
  // Set when the open task is part of an active multi-selection: GTD flag
  // buttons then apply to all of these ids (#13).
  bulkSelectedIds?: string[];
}

// Comments render as markdown now (#16); marked's GFM autolinking keeps
// plain URLs clickable, so the old renderWithLinks helper is gone.

// Duration parse/format live in a shared util (also used by the mobile app).
import { parseDuration, formatDuration, minutesToTimeInput, timeInputToMinutes } from '../duration';
import { fmtFocus } from '../pomodoro';
import { useDetailLayout, loadSheetFraction, saveSheetFraction, clampSheet } from '../detailSheet';
import { isEvernoteUrl, DEFAULT_EVERNOTE_TITLE } from '../evernote';
export { parseDuration, formatDuration };

const toDateInput = (d: Date | null) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function TaskDetailPanel({ task, bulkSelectedIds }: TaskDetailPanelProps) {
  const updateTask = useStore((s) => s.updateTask);
  const bulkUpdate = useStore((s) => s.bulkUpdate);
  const deleteTask = useStore((s) => s.deleteTask);
  const selectTask = useStore((s) => s.selectTask);
  const toggleStar = useStore((s) => s.toggleStar);
  // GTD flag clicks apply to the whole multi-selection when the open task is
  // part of it (#13) — otherwise they only touch this task.
  const applyFlag = (patch: Partial<Task>) => {
    if (bulkSelectedIds?.length) bulkUpdate(bulkSelectedIds, patch);
    else updateTask(task.id, patch);
  };
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const members = useStore((s) => s.members);
  const addComment = useStore((s) => s.addComment);
  const deleteComment = useStore((s) => s.deleteComment);
  const updateComment = useStore((s) => s.updateComment);
  // Comment editing (#16): id of the comment in edit mode + its draft text.
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const commentTaRef = useRef<HTMLTextAreaElement>(null);
  const editCommentTaRef = useRef<HTMLTextAreaElement>(null);
  const addAttachment = useStore((s) => s.addAttachment);
  const deleteAttachment = useStore((s) => s.deleteAttachment);
  const tasks = useStore((s) => s.tasks);
  const addSubtask = useStore((s) => s.addSubtask);
  const toggleTask = useStore((s) => s.toggleTask);
  const toggleTaskAssignee = useStore((s) => s.toggleTaskAssignee);
  const addTaskLink = useStore((s) => s.addTaskLink);
  const removeTaskLink = useStore((s) => s.removeTaskLink);
  const openTaskLink = useStore((s) => s.openTaskLink);
  const editTitleTaskId = useStore((s) => s.ui.editTitleTaskId);
  const clearEditTitle = useStore((s) => s.clearEditTitle);
  const titleRef = useRef<HTMLInputElement>(null);

  // After creating a task (e.g. calendar double-click) focus + select its title.
  useEffect(() => {
    if (editTitleTaskId === task.id && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
      clearEditTitle();
    }
  }, [editTitleTaskId, task.id, clearEditTitle]);

  const storedWidth = useStore((s) => s.settings.detailPanelWidth);
  const setDetailPanelWidth = useStore((s) => s.setDetailPanelWidth);
  const [width, setWidth] = useState(storedWidth ?? 420);

  useEffect(() => {
    if (storedWidth) setWidth(storedWidth);
  }, [storedWidth]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const clamp = (px: number) => Math.max(320, Math.min(720, px));
    const onMove = (ev: MouseEvent) => {
      setWidth(clamp(window.innerWidth - ev.clientX));
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDetailPanelWidth(clamp(window.innerWidth - ev.clientX));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Not enough room on the right → slide in from the bottom instead.
  const layout = useDetailLayout(width);
  const [sheetFraction, setSheetFraction] = useState(loadSheetFraction);
  const sheetHeight = Math.round(window.innerHeight * sheetFraction);

  // Sheet open: pad the task list so its last rows can scroll above the sheet,
  // and keep the selected row visible above it.
  useEffect(() => {
    if (!layout.sheet) return;
    const root = document.documentElement;
    root.style.setProperty('--detail-sheet-h', `${sheetHeight}px`);
    root.classList.add('detail-sheet-open');
    return () => {
      root.classList.remove('detail-sheet-open');
      root.style.removeProperty('--detail-sheet-h');
    };
  }, [layout.sheet, sheetHeight]);
  useEffect(() => {
    if (!layout.sheet) return;
    const row = document.querySelector<HTMLElement>('.task-item.selected');
    const list = row?.closest<HTMLElement>('.task-list');
    if (!row || !list) return;
    const sheetTop = window.innerHeight - sheetHeight;
    const rect = row.getBoundingClientRect();
    if (rect.bottom > sheetTop - 8) list.scrollBy({ top: rect.bottom - sheetTop + 48, behavior: 'smooth' });
    // Only when the opened task changes or the sheet appears — not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.sheet, task.id]);

  const startSheetResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const fractionAt = (y: number) => clampSheet((window.innerHeight - y) / window.innerHeight);
    const onMove = (ev: MouseEvent) => setSheetFraction(fractionAt(ev.clientY));
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveSheetFraction(fractionAt(ev.clientY));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const [commentText, setCommentText] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationInput, setDurationInput] = useState('');
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusInput, setFocusInput] = useState('');
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [attachError, setAttachError] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  // Evernote note link inputs (#8).
  const [evnUrl, setEvnUrl] = useState('');
  const [evnTitle, setEvnTitle] = useState('');
  const [evnError, setEvnError] = useState('');
  // Newest comments first (#37). createdAt may be a string after a server
  // roundtrip, so normalise via new Date() before comparing.
  const comments = [...(task.comments ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const attachments = task.attachments ?? [];
  const subtasks = tasks.filter((t) => t.parentId === task.id);
  const doneSubtasks = subtasks.filter((s) => s.completed).length;
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : null;
  const assignees = assigneesOf(task, members);
  const unassigned = members.filter((m) => !assignees.some((a) => a.id === m.id));

  // Options for the searchable "Verknüpfung hinzufügen" picker.
  const linkOptions: SearchOption[] = [
    ...projects.map((p) => ({
      value: `project:${p.id}`,
      label: p.name,
      group: 'Projekte',
      color: p.color,
    })),
    ...tasks
      .filter((t) => t.id !== task.id && !t.parentId)
      .map((t) => ({
        value: `task:${t.id}`,
        label: `#${t.number} ${t.title}`,
        group: 'Aufgaben',
      })),
  ];

  const MAX_ATTACH_BYTES = 1.5 * 1024 * 1024; // 1.5 MB (localStorage gesamt ~5 MB)

  const submitSubtask = () => {
    const t = subtaskTitle.trim();
    if (t) {
      addSubtask(task.id, t);
      setSubtaskTitle('');
    }
  };

  const copyLink = async () => {
    const url = taskShareUrl(task.number);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard may be blocked; still update the hash below */
    }
    window.location.hash = `#/t/${task.number}`;
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1500);
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          handleFile(file);
          e.preventDefault();
        }
      }
    }
  };

  // Files dropped anywhere on the panel become attachments (#5). Task-row
  // drags carry no files, so they fall through untouched.
  const [fileDragOver, setFileDragOver] = useState(false);
  const handleFileDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragOver(false);
    for (const file of e.dataTransfer.files) handleFile(file);
  };
  // Lightbox (#4/#25): attachment id currently shown enlarged.
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const lightbox = attachments.find((a) => a.id === lightboxId);
  useEffect(() => {
    if (!lightboxId) return;
    // Capture phase + stopPropagation so Escape only closes the lightbox,
    // not also the whole detail panel underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setLightboxId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightboxId]);
  const isImage = (a: Attachment) => previewKind(a) === 'image';
  const hasPreview = (a: Attachment) => previewKind(a) !== 'none';

  const handleFile = (file: File | undefined) => {
    setAttachError('');
    if (!file) return;
    if (file.size > MAX_ATTACH_BYTES) {
      setAttachError(
        `Datei zu groß (max. 1.5 MB). „${file.name}" ist ${formatSize(file.size)}.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      addAttachment(task.id, {
        id: `att-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: String(reader.result),
      });
    };
    reader.readAsDataURL(file);
  };

  const submitComment = () => {
    const text = commentText.trim();
    if (text) {
      addComment(task.id, text);
      setCommentText('');
    }
  };

  const toggleCategory = (id: string) => {
    const has = task.categoryIds.includes(id);
    updateTask(task.id, {
      categoryIds: has
        ? task.categoryIds.filter((c) => c !== id)
        : [...task.categoryIds, id],
    });
  };

  return (
    <div
      className={`task-detail-panel ${layout.sheet ? 'detail-sheet' : ''} ${fileDragOver ? 'file-drag-over' : ''}`}
      onPaste={handlePaste}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setFileDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDragOver(false);
      }}
      onDrop={handleFileDrop}
      style={layout.sheet ? { left: layout.left, height: sheetHeight } : { width }}
    >
      {layout.sheet ? (
        <div
          className="detail-sheet-resize"
          title="Höhe ziehen"
          onMouseDown={startSheetResize}
        />
      ) : (
        <div
          className="detail-resize"
          title="Breite ziehen"
          onMouseDown={startResize}
        />
      )}
      <div className="panel-header">
        <h3>
          <span className="detail-number">#{task.number}</span>{' '}
          {parent ? 'Unteraufgabe' : 'Aufgabe'}
        </h3>
        <div className="panel-header-actions">
          <button
            className={`detail-complete ${task.completed ? 'done' : ''}`}
            onClick={() => toggleTask(task.id)}
            title={task.completed ? 'Wieder öffnen' : 'Als erledigt markieren'}
          >
            {task.completed ? '↺ Öffnen' : '✓ Erledigen'}
          </button>
          <button
            className="detail-delete"
            title="Aufgabe löschen"
            onClick={() => {
              if (
                window.confirm(
                  'Aufgabe wirklich löschen? Sie kann über die Aktivität wiederhergestellt werden.'
                )
              ) {
                deleteTask(task.id);
              }
            }}
          >
            🗑 Löschen
          </button>
          <button
            className="detail-link"
            onClick={copyLink}
            title="Link zu dieser Aufgabe kopieren"
          >
            {linkCopied ? '✓ kopiert' : '🔗'}
          </button>
          <button
            className={`detail-star ${task.starred ? 'starred' : ''}`}
            onClick={() => toggleStar(task.id)}
            title="Markieren"
          >
            {task.starred ? '★' : '☆'}
          </button>
          <button className="panel-close" onClick={() => selectTask(null)}>
            ✕
          </button>
        </div>
      </div>

      <div className="panel-content">
        {parent && (
          <button
            className="detail-parent-link"
            onClick={() => selectTask(parent.id)}
            title="Zur Hauptaufgabe"
          >
            ↑ Hauptaufgabe: #{parent.number} {parent.title}
          </button>
        )}

        {/* GTD quick flags — apply to the whole selection in bulk mode (#13). */}
        <div className="detail-flags">
          {assignees.length > 0 && <AvatarStack members={assignees} size={64} />}
          <div className="detail-flag-buttons">
            <button
              className={`detail-flag ${task.starred ? 'on' : ''}`}
              onClick={() => applyFlag({ starred: !task.starred })}
              title="Nächste Aktion (Stern)"
            >
              ★ Nächste Aktion
            </button>
            {/* #81: Bei heute faelligen Tasks ist die Markierung implizit —
                aktiv dargestellt, aber gesperrt: ein Umschalten waere wirkungslos,
                der Task bliebe durch sein Faelligkeitsdatum in der Heute-Ansicht. */}
            <button
              className={`detail-flag ${countsAsToday(task) ? 'on' : ''}`}
              disabled={isImplicitToday(task)}
              onClick={() =>
                applyFlag({
                  todayDate: isTodayFlagActive(task) ? null : dateKey(new Date()),
                })
              }
              title={
                isImplicitToday(task)
                  ? 'Heute fällig — erscheint automatisch in Heute'
                  : 'Für heute vormerken (bleibt, bis erledigt oder entfernt)'
              }
            >
              ☀️ Heute
            </button>
            <button
              className={`detail-flag ${task.thisWeek ? 'on' : ''}`}
              onClick={() => applyFlag({ thisWeek: !task.thisWeek })}
              title="Für diese Woche (Next Week)"
            >
              🗓️ Next Week
            </button>
            <button
              className={`detail-flag ${task.someday ? 'on' : ''}`}
              onClick={() => applyFlag({ someday: !task.someday })}
              title="Nach Someday parken"
            >
              🌥️ Someday
            </button>
            <button
              className={`detail-flag ${task.waiting ? 'on' : ''}`}
              onClick={() => applyFlag({ waiting: !task.waiting })}
              title="Warten auf jemand anderes"
            >
              ⏳ Warten auf
            </button>
          </div>
        </div>
        {bulkSelectedIds && bulkSelectedIds.length > 1 && (
          <p className="detail-bulk-hint">
            ⚡ Mehrfachauswahl aktiv — Flags wirken auf {bulkSelectedIds.length} Aufgaben.
          </p>
        )}


        {task.waiting && (
          <div className="detail-field">
            <label className="detail-label">Warten auf (Person)</label>
            <ClearableInput
              className="detail-input"
              placeholder="Name der Person…"
              value={task.waitingFor ?? ''}
              onChange={(e) => updateTask(task.id, { waitingFor: e.target.value })}
              onClear={() => updateTask(task.id, { waitingFor: '' })}
            />
          </div>
        )}

        <div className="detail-field">
          <label className="detail-label">Titel</label>
          <ClearableInput
            ref={titleRef}
            type="text"
            className={`detail-input ${task.completed ? 'title-done' : ''}`}
            value={task.title}
            onChange={(e) => updateTask(task.id, { title: e.target.value })}
            onClear={() => updateTask(task.id, { title: '' })}
          />
        </div>

        <div className="detail-field">
          <label className="detail-label">Beschreibung</label>
          {editingDesc ? (
            <div className="desc-editor-wrap">
              <DescToolbar
                taRef={descRef}
                onSave={() => setEditingDesc(false)}
                saveLabel="✓ Fertig"
              />
              <textarea
                ref={descRef}
                className="detail-input detail-textarea"
                autoFocus
                value={task.description}
                onChange={(e) => updateTask(task.id, { description: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); setEditingDesc(false); }
                  if (e.key === 'Escape') setEditingDesc(false);
                }}
                placeholder="Notizen hinzufügen… (Markdown)"
              />
            </div>
          ) : task.description ? (
            <div
              className="detail-input detail-textarea detail-desc-view markdown-body"
              onClick={() => setEditingDesc(true)}
              title="Zum Bearbeiten klicken"
              dangerouslySetInnerHTML={{ __html: renderTaskDesc(task.description) }}
            />
          ) : (
            <div
              className="detail-input detail-textarea detail-desc-view detail-desc-empty"
              onClick={() => setEditingDesc(true)}
            >
              Notizen hinzufügen…
            </div>
          )}
        </div>

        <div className="detail-field">
          <label className="detail-label">
            Anhänge {attachments.length > 0 && `(${attachments.length})`}
          </label>
          {/* Image attachments show as thumbnails; click opens the lightbox
              instead of forcing a download (#4/#25). */}
          {attachments.some(isImage) && (
            <div className="attach-thumbs">
              {attachments.filter(isImage).map((a) => (
                <button
                  key={a.id}
                  className="attach-thumb"
                  title={`${a.name} — klicken für Großansicht`}
                  onClick={() => setLightboxId(a.id)}
                >
                  <img src={a.dataUrl || a.url} alt={a.name} loading="lazy" />
                </button>
              ))}
            </div>
          )}
          <div className="attach-list">
            {attachments.map((a) => {
              const remote = !!a.url && !a.dataUrl;
              return (
              <div key={a.id} className="attach-item">
                {/* Supported types open the in-app preview (#27); links and
                    remote urls keep their old behavior. */}
                {!remote && a.type !== 'link' && hasPreview(a) ? (
                  <button
                    className="attach-link attach-link-btn"
                    title={`${a.name} — klicken für Vorschau`}
                    onClick={() => setLightboxId(a.id)}
                  >
                    {isImage(a) ? '🖼' : '📄'} {a.name}
                  </button>
                ) : (
                <a
                  href={a.url || a.dataUrl}
                  download={remote ? undefined : a.name}
                  target={remote ? '_blank' : undefined}
                  rel={remote ? 'noopener noreferrer' : undefined}
                  className="attach-link"
                  title={remote ? a.name : `${a.name} (${formatSize(a.size)})`}
                >
                  {a.type === 'link' ? '🔗' : '📎'} {a.name}
                </a>
                )}
                <span className="attach-size">
                  {remote ? '↗' : formatSize(a.size)}
                </span>
                <button
                  className="attach-del"
                  title="Entfernen"
                  onClick={() => deleteAttachment(task.id, a.id)}
                >
                  ×
                </button>
              </div>
              );
            })}
          </div>
          <label className="attach-add-btn">
            + Datei anhängen
            <input
              type="file"
              hidden
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <p className="attach-hint">
            Tipp: Screenshot/Datei direkt hier einfügen (Strg/Cmd+V). Max. 1.5 MB pro
            Datei (lokaler Speicher ~5 MB gesamt).
          </p>
          {attachError && <p className="attach-error">{attachError}</p>}
        </div>

        {!parent && (
          <div className="detail-field">
            <label className="detail-label">
              Unteraufgaben{' '}
              {subtasks.length > 0 && `(${doneSubtasks}/${subtasks.length})`}
            </label>
            <div className="subtask-list">
              {subtasks.map((s) => (
                <div key={s.id} className="subtask-item">
                  <input
                    type="checkbox"
                    className="subtask-check"
                    checked={s.completed}
                    onChange={() => toggleTask(s.id)}
                  />
                  <span className="subtask-num">#{s.number}</span>
                  <span
                    className={`subtask-title ${s.completed ? 'done' : ''}`}
                    onClick={() => selectTask(s.id)}
                  >
                    {s.title}
                  </span>
                </div>
              ))}
            </div>
            <div className="subtask-add">
              <ClearableInput
                wrapperClassName="grow"
                type="text"
                className="detail-input"
                placeholder="Unteraufgabe hinzufügen…"
                value={subtaskTitle}
                onChange={(e) => setSubtaskTitle(e.target.value)}
                onClear={() => setSubtaskTitle('')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitSubtask();
                }}
              />
              <button className="btn btn-primary subtask-send" onClick={submitSubtask}>
                +
              </button>
            </div>
          </div>
        )}

        <div className="detail-field">
          <label className="detail-label">
            Kommentare {comments.length > 0 && `(${comments.length})`}
          </label>
          <div className="comment-list">
            {comments.map((c) => (
              <div key={c.id} className="comment-item">
                <div className="comment-head">
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-date">
                    {c.createdAt.toLocaleDateString('de-DE', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    className="comment-edit"
                    title="Bearbeiten"
                    onClick={() => {
                      setEditingCommentId(c.id);
                      setEditCommentText(c.text);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="comment-del"
                    title="Löschen"
                    onClick={() => deleteComment(task.id, c.id)}
                  >
                    ×
                  </button>
                </div>
                {editingCommentId === c.id ? (
                  <div className="comment-edit-wrap">
                    <DescToolbar
                      taRef={editCommentTaRef}
                      onSave={() => {
                        const text = editCommentText.trim();
                        if (text) updateComment(task.id, c.id, text);
                        setEditingCommentId(null);
                      }}
                    />
                    <textarea
                      ref={editCommentTaRef}
                      autoFocus
                      className="detail-input detail-textarea comment-editarea"
                      rows={3}
                      value={editCommentText}
                      onChange={(e) => setEditCommentText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          const text = editCommentText.trim();
                          if (text) updateComment(task.id, c.id, text);
                          setEditingCommentId(null);
                        }
                        if (e.key === 'Escape') setEditingCommentId(null);
                      }}
                    />
                  </div>
                ) : (
                  <div
                    className="comment-text markdown-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(c.text) }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="comment-add comment-add-multiline">
            <DescToolbar taRef={commentTaRef} onSave={submitComment} saveLabel="+ Kommentar" />
            <textarea
              ref={commentTaRef}
              className="detail-input detail-textarea comment-editarea"
              rows={2}
              placeholder="Kommentar hinzufügen… (Strg+Enter zum Senden, Markdown möglich)"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitComment();
              }}
            />
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-field">
            <label className="detail-label">Projekt</label>
            <SearchSelect
              value={task.projectId ?? ''}
              placeholder="Inbox (kein Projekt)"
              options={[
                { value: '', label: 'Inbox (kein Projekt)' },
                ...projects.map((p) => ({
                  value: p.id,
                  label: p.name,
                  color: p.color,
                })),
              ]}
              onSelect={(v) => updateTask(task.id, { projectId: v || null })}
            />
          </div>

          <div className="detail-field">
            <label className="detail-label">Priorität</label>
            <select
              className="detail-select"
              value={task.priority}
              onChange={(e) =>
                updateTask(task.id, { priority: e.target.value as Task['priority'] })
              }
            >
              <option value="low">Niedrig</option>
              <option value="medium">Mittel</option>
              <option value="high">Hoch</option>
            </select>
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-field">
            <label className="detail-label">Fälligkeit</label>
            <input
              type="date"
              className="detail-input"
              value={toDateInput(task.dueDate)}
              onChange={(e) =>
                updateTask(task.id, {
                  dueDate: e.target.value ? new Date(e.target.value) : null,
                })
              }
            />
          </div>

          <div className="detail-field">
            <label className="detail-label">Uhrzeit</label>
            <input
              type="time"
              className="detail-input"
              value={minutesToTimeInput(task.startMinutes)}
              onChange={(e) =>
                updateTask(task.id, { startMinutes: timeInputToMinutes(e.target.value) })
              }
            />
          </div>

          {/* Soll und Ist stehen nebeneinander (#73): geplante Dauer und
              tatsaechlich erfasste Pomodoro-Zeit gehoeren zusammen. */}
          <div className="detail-field">
            <label className="detail-label">⏱ Soll</label>
            {editingDuration ? (
              <input
                autoFocus
                className="detail-input detail-duration-input"
                value={durationInput}
                placeholder="30m · 1h · 1.5h · 90m"
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={() => {
                  const val = parseDuration(durationInput);
                  updateTask(task.id, { durationMin: val });
                  setEditingDuration(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseDuration(durationInput);
                    updateTask(task.id, { durationMin: val });
                    setEditingDuration(false);
                  } else if (e.key === 'Escape') {
                    setEditingDuration(false);
                  }
                }}
              />
            ) : (
              <span
                className="detail-input detail-duration-display"
                title="Geplante Dauer — klicken zum Bearbeiten"
                onClick={() => {
                  setDurationInput(task.durationMin ? formatDuration(task.durationMin) : '');
                  setEditingDuration(true);
                }}
              >
                {task.durationMin ? formatDuration(task.durationMin) : '—'}
              </span>
            )}
          </div>

          <div className="detail-field">
            <label className="detail-label">🍅 Ist</label>
            {editingFocus ? (
              <input
                autoFocus
                className="detail-input detail-duration-input"
                value={focusInput}
                placeholder="30m · 1h · 1.5h · 90m"
                onChange={(e) => setFocusInput(e.target.value)}
                onBlur={() => {
                  // Leer = Reset auf 0; ungültige Eingabe wird verworfen (AC10).
                  const t = focusInput.trim();
                  const min = t === '' ? 0 : parseDuration(t);
                  if (min != null) updateTask(task.id, { focusSeconds: min * 60 });
                  setEditingFocus(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    setEditingFocus(false);
                  }
                }}
              />
            ) : (
              <span
                className="detail-input detail-duration-display"
                title="Mit dem Pomodoro-Timer erfasste Zeit — klicken zum manuellen Überschreiben"
                onClick={() => {
                  // Vorbelegung in parseDuration-tauglicher Form (nicht fmtFocus,
                  // dessen "12 Min"/"1h 5m"-Labels nur teilweise parsebar sind).
                  const m = Math.round((task.focusSeconds ?? 0) / 60);
                  setFocusInput(
                    m === 0
                      ? ''
                      : m % 60 === 0
                        ? `${m / 60}h`
                        : m < 60
                          ? `${m}m`
                          : `${Math.floor(m / 60)}h ${m % 60}m`
                  );
                  setEditingFocus(true);
                }}
              >
                {(task.focusSeconds ?? 0) > 0 ? fmtFocus(task.focusSeconds ?? 0) : '—'}
              </span>
            )}
          </div>
        </div>

        {/* Wiederholung + Custom-Editor auf EINER Zeile (#7): Select, „alle",
            schmales Zahlenfeld und Einheit teilen sich die Breite. */}
        <div className="detail-field">
          <label className="detail-label">Wiederholung</label>
          <div className="recur-row">
            <select
              className="detail-select recur-kind"
              value={task.recurrence}
              onChange={(e) =>
                updateTask(task.id, {
                  recurrence: e.target.value as Task['recurrence'],
                })
              }
            >
              <option value="none">Keine</option>
              <option value="daily">Täglich</option>
              <option value="weekly">Wöchentlich</option>
              <option value="monthly">Monatlich</option>
              <option value="yearly">Jährlich</option>
              <option value="custom">Benutzerdefiniert…</option>
            </select>
            {task.recurrence === 'custom' && (
              <>
                <span className="recur-alle">alle</span>
                <input
                  type="number"
                  min={1}
                  className="detail-input recur-interval"
                  value={task.recurInterval ?? 1}
                  onChange={(e) =>
                    updateTask(task.id, { recurInterval: Math.max(1, Number(e.target.value)) })
                  }
                />
                <select
                  className="detail-select recur-unit"
                  value={task.recurUnit ?? 'day'}
                  onChange={(e) =>
                    updateTask(task.id, { recurUnit: e.target.value as Task['recurUnit'] })
                  }
                >
                  <option value="day">Tage</option>
                  <option value="week">Wochen</option>
                  <option value="month">Monate</option>
                  <option value="year">Jahre</option>
                </select>
              </>
            )}
          </div>
        </div>

        {task.recurrence === 'custom' && (
          (task.recurUnit ?? 'day') === 'month' && (
            <div className="detail-field recur-custom-extra">
              <select
                className="detail-select recur-monthday"
                value={task.recurMonthDay ?? 'date'}
                onChange={(e) =>
                  updateTask(task.id, {
                    recurMonthDay: e.target.value as Task['recurMonthDay'],
                  })
                }
              >
                <option value="date">am gleichen Tag</option>
                <option value="first">am 1. des Monats</option>
                <option value="last">am letzten Tag des Monats</option>
              </select>
            </div>
          )
        )}

        {task.recurrence !== 'none' && (
          <div className="detail-field">
            <label className="detail-label">Wiederholung endet (optional)</label>
            <input
              type="date"
              className="detail-input"
              value={toDateInput(task.recurrenceEnd ?? null)}
              onChange={(e) =>
                updateTask(task.id, {
                  recurrenceEnd: e.target.value ? new Date(e.target.value) : null,
                })
              }
            />
            <p className="detail-hint">
              ↻ Beim Abhaken wird automatisch die nächste Aufgabe erstellt.
            </p>
            <button
              type="button"
              className="detail-recur-stop"
              title="Diese Aufgabe wiederholt sich danach nicht mehr"
              onClick={() => updateTask(task.id, { recurrence: 'none', recurrenceEnd: null })}
            >
              ⏹ Wiederholung beenden
            </button>
          </div>
        )}

        <div className="detail-field">
          <label className="detail-label">Kategorien</label>
          <div className="cat-chips">
            {categories.length === 0 && (
              <span className="cat-empty">Noch keine Kategorien angelegt</span>
            )}
            {categories.map((c) => {
              const active = task.categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  className={`cat-chip ${active ? 'active' : ''}`}
                  style={active ? { background: c.color, borderColor: c.color } : { borderColor: c.color, color: c.color }}
                  onClick={() => toggleCategory(c.id)}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="detail-row">
          <div className="detail-field">
            <label className="detail-label">Verantwortlich</label>
            <div className="detail-assignees">
              {assignees.map((m) => (
                <span key={m.id} className="detail-assignee-chip">
                  <Avatar member={m} size={20} />
                  {m.name}
                  <button
                    className="detail-assignee-del"
                    title="Entfernen"
                    onClick={() => toggleTaskAssignee(task.id, m.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {unassigned.length > 0 && (
              <select
                className="detail-select"
                value=""
                onChange={(e) => {
                  if (e.target.value) toggleTaskAssignee(task.id, e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="">+ Verantwortliche/n hinzufügen…</option>
                {unassigned.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="detail-field">
            <label className="detail-label">Verknüpfungen</label>
            <div className="detail-links">
              {(task.links ?? []).map((link) => {
                if (link.type === 'evernote') {
                  return (
                    <span key={`evernote:${link.id}`} className="detail-link-chip detail-link-evernote">
                      <a
                        className="detail-link-open"
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={link.url}
                      >
                        🐘 {link.title || DEFAULT_EVERNOTE_TITLE}
                      </a>
                      <button
                        className="detail-link-del"
                        title="Verknüpfung entfernen"
                        onClick={() => removeTaskLink(task.id, link)}
                      >
                        ×
                      </button>
                    </span>
                  );
                }
                const isProject = link.type === 'project';
                const proj = isProject ? projects.find((p) => p.id === link.id) : null;
                const linked = !isProject ? tasks.find((t) => t.id === link.id) : null;
                if (isProject && !proj) return null;
                if (!isProject && !linked) return null;
                return (
                  <span key={`${link.type}:${link.id}`} className="detail-link-chip">
                    <button
                      className="detail-link-open"
                      onClick={() => openTaskLink(link)}
                      title={isProject ? 'Projekt öffnen' : 'Aufgabe öffnen'}
                    >
                      {isProject ? (
                        <>
                          <span
                            className="detail-link-dot"
                            style={{ background: proj!.color }}
                          />
                          {proj!.name}
                        </>
                      ) : (
                        <>🔗 #{linked!.number} {linked!.title}</>
                      )}
                    </button>
                    <button
                      className="detail-link-del"
                      title="Verknüpfung entfernen"
                      onClick={() => removeTaskLink(task.id, link)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <SearchSelect
              options={linkOptions}
              placeholder="+ Verknüpfung hinzufügen…"
              onSelect={(v) => {
                const [type, id] = v.split(':');
                addTaskLink(task.id, { type: type as 'task' | 'project', id });
              }}
            />
            {/* Evernote note link (#8): paste a web link or an evernote:/// deep link. */}
            <div className="detail-evernote-add">
              <input
                className="detail-input"
                placeholder="🐘 Evernote-Notiz-Link (https://www.evernote.com/… oder evernote:///…)"
                value={evnUrl}
                onChange={(e) => { setEvnUrl(e.target.value); setEvnError(''); }}
              />
              <input
                className="detail-input"
                placeholder="Titel (optional)"
                value={evnTitle}
                onChange={(e) => setEvnTitle(e.target.value)}
              />
              <button
                className="btn"
                onClick={() => {
                  const url = evnUrl.trim();
                  if (!isEvernoteUrl(url)) { setEvnError('Kein gültiger Evernote-Link (evernote:/// oder evernote.com).'); return; }
                  addTaskLink(task.id, {
                    type: 'evernote',
                    id: `evn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                    url,
                    title: evnTitle.trim() || undefined,
                  });
                  setEvnUrl(''); setEvnTitle(''); setEvnError('');
                }}
              >
                + Evernote
              </button>
            </div>
            {evnError && <p className="detail-evernote-error">{evnError}</p>}
          </div>
        </div>
      </div>

      {/* Lightbox: typed in-app preview with download option (#4/#25/#27). */}
      {lightbox && (
        <div className="attach-lightbox" onClick={() => setLightboxId(null)}>
          <div className="attach-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <AttachmentPreview attachment={lightbox} />
            <div className="attach-lightbox-bar">
              <span className="attach-lightbox-name">{lightbox.name}</span>
              <a
                className="btn"
                href={lightbox.dataUrl || lightbox.url}
                download={lightbox.name}
              >
                ⬇ Herunterladen
              </a>
              <button className="btn" onClick={() => setLightboxId(null)}>
                ✕ Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
