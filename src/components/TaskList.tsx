import { useRef, useState, type DragEvent } from 'react';
import type { Task } from '../types';
import { useStore } from '../store';
import {
  byCompletedAtDesc,
  isOverdue,
  countsAsToday,
  isImplicitToday,
  orderSections,
  viewShowsCompleted,
} from '../selectors';
import { beginExitCollapse, useListFlip } from '../hooks/useListFlip';
import { readTaskIds, writeTaskIds } from '../dnd';
import AvatarStack from './AvatarStack';
import { assigneesOf } from '../members';
import { formatDuration } from './TaskDetailPanel';
import './TaskList.css';

interface TaskListProps {
  tasks: Task[];
  emptyHint?: string;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onCtrlSelect?: (id: string) => void;
  onShiftSelect?: (id: string) => void;
  // When false, TaskList does not render its own Gruppen/Sektionen toggle —
  // the FilterBar shows it instead (so both toggles share one line).
  showSectionToggle?: boolean;
}

export default function TaskList({
  tasks,
  emptyHint,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  onCtrlSelect,
  onShiftSelect,
  showSectionToggle = true,
}: TaskListProps) {
  const toggleTask = useStore((s) => s.toggleTask);
  const completeTaskAnimated = useStore((s) => s.completeTaskAnimated);
  const completionHold = useStore((s) => s.completionHold);
  const completionPulse = useStore((s) => s.completionPulse);
  const toggleStar = useStore((s) => s.toggleStar);
  const selectTask = useStore((s) => s.selectTask);
  const selectProject = useStore((s) => s.selectProject);
  const selectedTaskId = useStore((s) => s.ui.selectedTaskId);
  const currentView = useStore((s) => s.ui.currentView);
  const selectedProjectId = useStore((s) => s.ui.selectedProjectId);
  const selectedProjectIds = useStore((s) => s.ui.selectedProjectIds);
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const sections = useStore((s) => s.sections);
  const members = useStore((s) => s.members);
  // Full task list to look up subtasks (the `tasks` prop excludes them).
  const allTasks = useStore((s) => s.tasks);
  const reorderTasks = useStore((s) => s.reorderTasks);
  const dropTaskOnTask = useStore((s) => s.dropTaskOnTask);
  const setTaskParent = useStore((s) => s.setTaskParent);
  const reorderSubtask = useStore((s) => s.reorderSubtask);
  const deleteTask = useStore((s) => s.deleteTask);
  const sectionsCollapsed = useStore((s) => s.settings.sectionsCollapsed ?? false);
  const setSectionsCollapsed = useStore((s) => s.setSectionsCollapsed);
  const pomodoroStartForTask = useStore((s) => s.pomodoroStartForTask);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const activePomodoroTaskId = useStore((s) => (s.pomodoro.running ? s.pomodoro.currentTaskId : null));
  // Show a per-task Pomodoro start only in the planning views (#39).
  const showPomodoroBtn = currentView === 'today' || currentView === 'nextweek';
  const assignTaskSection = useStore((s) => s.assignTaskSection);
  const reorderSections = useStore((s) => s.reorderSections);
  const addSection = useStore((s) => s.addSection);
  const renameSection = useStore((s) => s.renameSection);
  const deleteSection = useStore((s) => s.deleteSection);
  const addTask = useStore((s) => s.addTask);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // When set, hovering the central band of this root task row will nest the
  // dragged task as its subtask instead of reordering.
  const [nestId, setNestId] = useState<string | null>(null);
  // Subtask row currently hovered as a drop target (sibling reorder).
  const [overChildId, setOverChildId] = useState<string | null>(null);
  const [dragSectionId, setDragSectionId] = useState<string | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  // Inline quick-add per section (#26): section id currently adding + its text.
  const [addingTaskSecId, setAddingTaskSecId] = useState<string | null>(null);
  const [newSecTaskTitle, setNewSecTaskTitle] = useState('');
  // Refs to each rendered section, so the index bar can scroll to one.
  const sectionElRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Which parent rows have their subtasks expanded inline (local, not persisted).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Index subtasks by parent once per render, ordered by sortOrder then creation
  // (so they show in the order they were entered / drag-reordered).
  const childrenByParent = new Map<string, Task[]>();
  for (const t of allTasks) {
    if (t.parentId) {
      const arr = childrenByParent.get(t.parentId);
      if (arr) arr.push(t);
      else childrenByParent.set(t.parentId, [t]);
    }
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || +a.createdAt - +b.createdAt);
  }

  // Tasks stay draggable in selection mode too, so a multi-selection can be moved.
  const dragEnabled = true;
  // Ids that a drag carries: the whole selection if the dragged task is selected.
  const dragPayload = (id: string) =>
    selectionMode && selectedIds?.has(id) ? [...selectedIds] : undefined;
  const assignAll = (ids: string[], sectionId: string | null) =>
    ids.forEach((id) => assignTaskSection(id, sectionId));

  // Whether dropping the currently-dragged task onto `target` may NEST it as a
  // subtask: single drag, target is a different root task, and the dragged task
  // has no children of its own (we only allow one nesting level).
  const canNest = (target: Task): boolean => {
    if (!dragId || dragId === target.id) return false;
    if (target.parentId) return false; // target must be a root task
    if (childrenByParent.has(dragId)) return false; // dragged task has children
    return true;
  };
  // Pointer in the central 50% band of a row → nest; the top/bottom edges keep
  // the familiar reorder behaviour.
  const isCentralBand = (e: DragEvent): boolean => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    return y > r.height * 0.35 && y < r.height * 0.65;
  };
  // Grouping works for a single project OR for the list-style GTD views.
  const singleProject =
    (currentView === 'projects' || currentView === 'someday') &&
    !!selectedProjectId &&
    selectedProjectIds.length <= 1;
  const VIEW_GROUPABLE = ['priority', 'today', 'nextweek', 'someday'];
  const viewGrouping = VIEW_GROUPABLE.includes(currentView) && !singleProject;
  const grouped = singleProject || viewGrouping;
  // Scope key: project id for a project, otherwise a per-view key.
  const scopeKey = singleProject ? selectedProjectId! : `view:${currentView}`;
  // Only hide the project name inside a real project (it's the page title there);
  // in the list views tasks come from many projects, so keep the (coloured) name.
  const hideProject = singleProject;
  const scopeSections = grouped
    ? orderSections(sections.filter((s) => s.scope === scopeKey))
    : [];

  // #53: check-off animation. Which release the checkbox triggers depends on
  // whether this view keeps completed tasks visible; the Erledigt view IS the
  // completed area (rows show their date, no extra block).
  const completionMode = viewShowsCompleted(currentView) ? 'move' : 'exit';
  const inCompletedView = currentView === 'completed';
  const listRef = useRef<HTMLDivElement>(null);
  useListFlip(listRef, completionPulse);

  if (tasks.length === 0 && !grouped) {
    return (
      <div className="task-list-empty">
        <div className="empty-icon">🗒️</div>
        <p>{emptyHint ?? 'Keine Aufgaben hier. Füge oben eine neue hinzu.'}</p>
      </div>
    );
  }

  // Meta row (due date, recurrence, duration, GTD flags, comments, categories…)
  // shared by root tasks and subtasks, so both show the same essentials (#1).
  const renderMeta = (task: Task, hideProjectHere: boolean, inCompletedSection = false) => {
    const project = projects.find((p) => p.id === task.projectId);
    const taskCats = categories.filter((c) => task.categoryIds.includes(c.id));
    const kids = childrenByParent.get(task.id) ?? [];
    const doneKids = kids.filter((k) => k.completed).length;
    return (
      <div className="task-meta">
        {project && !hideProjectHere && (
          <span
            className="task-project task-project-link"
            style={{ color: project.color }}
            title={`Zu Projekt „${project.name}" springen`}
            onClick={(e) => {
              e.stopPropagation();
              selectProject(project.id);
            }}
          >
            <span className="task-project-dot" style={{ background: project.color }} />
            {project.name}
          </span>
        )}
        {/* Completion date only inside the ✓ Erledigt area (#53 AC6). */}
        {inCompletedSection && task.completed && task.completedAt && (
          <span className="task-completed-at" title="Erledigt am">
            ✓ {new Date(task.completedAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        {!task.completed && task.dueDate && (
          <span className={`task-time ${isOverdue(task) ? 'overdue' : ''}`}>
            📅{' '}
            {task.dueDate.toLocaleDateString('de-DE', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
        {task.recurrence !== 'none' && (
          <span className="task-recurring" title={`Wiederholt: ${task.recurrence}`}>
            ↻
          </span>
        )}
        {task.durationMin != null && task.durationMin > 0 && (
          <span className="task-duration" title="Dauer">
            ⏱ {formatDuration(task.durationMin)}
          </span>
        )}
        {task.starred && (
          <span className="task-flag flag-na" title="Nächste Aktion">★</span>
        )}
        {/* #81: auch heute faellige Tasks tragen die Markierung — sie stehen
            ohnehin in der Heute-Ansicht. */}
        {countsAsToday(task) && (
          <span
            className="task-flag flag-today"
            title={isImplicitToday(task) ? 'Heute fällig' : 'Für heute vorgemerkt'}
          >
            ☀️
          </span>
        )}
        {task.thisWeek && (
          <span className="task-flag flag-week" title="Next Week">🗓️</span>
        )}
        {task.someday && (
          <span className="task-flag flag-someday" title="Someday">🌥️</span>
        )}
        {task.waiting && (
          <span
            className="task-flag flag-waiting"
            title={task.waitingFor ? `Warten auf ${task.waitingFor}` : 'Warten auf jemand anderes'}
          >
            ⏳{task.waitingFor ? ` ${task.waitingFor}` : ''}
          </span>
        )}
        {(task.comments?.length ?? 0) > 0 && (
          <span
            className="task-comments"
            title={`${task.comments!.length} Kommentar${
              task.comments!.length === 1 ? '' : 'e'
            }`}
          >
            💬 {task.comments!.length}
          </span>
        )}
        {kids.length > 0 && (
          <span
            className="task-subcount"
            title={`${kids.length} Unteraufgabe${kids.length === 1 ? '' : 'n'}`}
          >
            ⤷ {doneKids}/{kids.length}
          </span>
        )}
        {taskCats.map((c) => (
          <span key={c.id} className="task-cat" style={{ background: c.color }}>
            {c.name}
          </span>
        ))}
      </div>
    );
  };

  // Compact row for an inline subtask. Draggable: drop on a sibling to reorder,
  // drag out to the top-level area to promote to a standalone task.
  const renderChild = (child: Task) => (
    <div
      key={child.id}
      className={`task-item is-child ${selectedTaskId === child.id ? 'selected' : ''} ${
        child.completed ? 'is-completed' : ''
      } ${dragId === child.id ? 'dragging' : ''} ${overChildId === child.id ? 'drag-over' : ''}`}
      draggable
      onDragStart={(e) => { setDragId(child.id); writeTaskIds(e, child.id); }}
      onDragOver={(e) => {
        if (!dragId || dragId === child.id) return;
        e.preventDefault();
        setOverChildId(child.id);
      }}
      onDragLeave={() => setOverChildId((cur) => (cur === child.id ? null : cur))}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const ids = readTaskIds(e).filter((id) => id !== child.id);
        if (ids.length) reorderSubtask(ids[0], child.id);
        setDragId(null);
        setOverChildId(null);
      }}
      onDragEnd={() => { setDragId(null); setOverId(null); setNestId(null); setOverChildId(null); setOverSectionId(null); }}
      title="Ziehen: auf eine andere Unteraufgabe = sortieren · in den Hauptbereich = eigenständige Aufgabe"
      onClick={() => selectTask(selectedTaskId === child.id ? null : child.id)}
    >
      <input
        type="checkbox"
        className="task-checkbox"
        checked={child.completed}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          toggleTask(child.id);
        }}
      />
      <span className="task-child-marker" title="Unteraufgabe">↳</span>
      <span className={`priority-dot priority-${child.priority}`} title={child.priority} />
      <div className="task-content">
        <div className={`task-title ${child.completed ? 'completed' : ''}`}>
          {child.title}
        </div>
        {/* Same meta as root tasks (project omitted — it's the parent's, #1). */}
        {renderMeta(child, true)}
      </div>
      <div className="task-actions">
        <button
          className={`task-star ${child.starred ? 'starred' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleStar(child.id);
          }}
          title={child.starred ? 'Stern entfernen' : 'Markieren'}
        >
          {child.starred ? '★' : '☆'}
        </button>
      </div>
    </div>
  );

  const renderTask = (task: Task, inCompletedSection = false) => {
    // --- Project-reference task: renders as a dependency chip, not a normal row ---
    if (task.linkedProjectId) {
      const linked = projects.find((p) => p.id === task.linkedProjectId);
      const linkedTasks = allTasks.filter(
        (t) => t.projectId === task.linkedProjectId && !t.parentId
      );
      const linkedDone = linkedTasks.filter((t) => t.completed).length;
      const pct = linkedTasks.length ? Math.round((linkedDone / linkedTasks.length) * 100) : 0;
      const isBlocking = !task.completed;
      // Inactive (Someday) linked projects are shown greyed out.
      const linkInactive = !!linked && linked.active !== true;
      return (
        <div key={task.id} className="task-row">
          <div
            data-flip-id={task.id}
            className={`task-item task-projref ${task.completed ? 'is-completed' : ''} ${
              overId === task.id ? 'drag-over' : ''
            } ${dragId === task.id ? 'dragging' : ''}`}
            draggable={dragEnabled}
            onDragStart={(e) => { if (!dragEnabled) return; setDragId(task.id); writeTaskIds(e, task.id, dragPayload(task.id)); }}
            onDragOver={(e) => { if (!dragEnabled || !dragId) return; e.preventDefault(); setOverId(task.id); }}
            onDragLeave={() => setOverId((cur) => (cur === task.id ? null : cur))}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const ids = readTaskIds(e).filter((id) => id !== task.id); if (dragEnabled && ids.length) { if (grouped) ids.forEach((id) => dropTaskOnTask(id, task.id)); else ids.forEach((id) => reorderTasks(id, task.id)); } setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); setOverSectionId(null); }}
          >
            <span className="task-subtoggle-spacer" />
            <input
              type="checkbox"
              className="task-checkbox"
              checked={task.completed}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => { e.stopPropagation(); toggleTask(task.id); }}
              title={task.completed ? 'Abhängigkeit aufgelöst' : 'Als abgeschlossen markieren'}
            />
            <span className="task-projref-icon" title={isBlocking ? 'Blockierendes Projekt' : 'Abgeschlossene Abhängigkeit'}>
              {isBlocking ? '🔒' : '🔓'}
            </span>
            <div className="task-content">
              {linked ? (
                <button
                  className={`task-projref-name ${linkInactive ? 'is-inactive' : ''}`}
                  style={{ color: linkInactive ? undefined : linked.color }}
                  onClick={(e) => { e.stopPropagation(); selectProject(linked.id); }}
                  title={linkInactive ? `„${linked.name}" (inaktiv / Someday)` : `Zu Projekt „${linked.name}" springen`}
                >
                  <span className="task-project-dot" style={{ background: linkInactive ? '#9ca3af' : linked.color }} />
                  {linked.name}
                  {linkInactive && <span className="task-projref-inactive-tag">inaktiv</span>}
                </button>
              ) : (
                <span className="task-projref-name task-projref-missing">
                  Projekt nicht gefunden
                </span>
              )}
              {linked && linkedTasks.length > 0 && (
                <div className="task-projref-progress">
                  <div className="task-projref-bar">
                    <div className="task-projref-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="task-projref-count">{linkedDone}/{linkedTasks.length}</span>
                </div>
              )}
            </div>
            <div className="task-actions">
              <button
                className="task-projref-del"
                title="Projekt-Verknüpfung entfernen"
                onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
              >
                ×
              </button>
            </div>
          </div>
        </div>
      );
    }

    const kids = childrenByParent.get(task.id) ?? [];
    const expanded = expandedIds.has(task.id);
    // #53: row is mid check-off animation — grey in place ('hold') or
    // collapsing out of a view that hides completed tasks ('exit').
    const holdPhase = completionHold[task.id];
    const isHolding = holdPhase != null;
    const isExiting = holdPhase === 'exit';
    return (
      <div key={task.id} className="task-row">
      {/* .task-row is display:contents — flip/collapse live on the .task-item box. */}
      <div
        key={task.id}
        data-flip-id={task.id}
        ref={isExiting ? beginExitCollapse : undefined}
        className={`task-item ${selectedTaskId === task.id ? 'selected' : ''} ${
          task.completed ? 'is-completed' : ''
        } ${isHolding ? 'is-completing' : ''} ${selectionMode && selectedIds?.has(task.id) ? 'bulk-selected' : ''} ${
          overId === task.id ? 'drag-over' : ''
        } ${nestId === task.id ? 'nest-target' : ''} ${dragId === task.id ? 'dragging' : ''}`}
        draggable={dragEnabled && !isHolding}
        onDragStart={(e) => {
          if (!dragEnabled) return;
          setDragId(task.id);
          writeTaskIds(e, task.id, dragPayload(task.id));
        }}
        onDragOver={(e) => {
          if (!dragEnabled || !dragId) return;
          e.preventDefault();
          // Central band over a valid root target → nest; edges → reorder.
          if (canNest(task) && isCentralBand(e)) {
            setNestId(task.id);
            setOverId(null);
          } else {
            setOverId(task.id);
            setNestId((cur) => (cur === task.id ? null : cur));
          }
        }}
        onDragLeave={() => {
          setOverId((cur) => (cur === task.id ? null : cur));
          setNestId((cur) => (cur === task.id ? null : cur));
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const ids = readTaskIds(e).filter((id) => id !== task.id);
          if (dragEnabled && ids.length) {
            if (nestId === task.id && canNest(task)) {
              // Nest the dragged task(s) as subtasks of this root task.
              ids.forEach((id) => setTaskParent(id, task.id));
            } else {
              // Reorder. If a dragged task is currently a subtask, promote it to
              // root first so dropping it among root tasks moves it out.
              ids.forEach((id) => {
                const dragged = allTasks.find((t) => t.id === id);
                if (dragged?.parentId) setTaskParent(id, null);
              });
              if (grouped) ids.forEach((id) => dropTaskOnTask(id, task.id));
              else ids.forEach((id) => reorderTasks(id, task.id));
            }
          }
          setDragId(null);
          setOverId(null);
          setNestId(null);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverId(null);
          setNestId(null);
          // Also clear the section highlight — a drop on a task row stops
          // propagation, so the section's own handlers never reset it (#28).
          setOverSectionId(null);
        }}
        onClick={(e) => {
          if (e.shiftKey) onShiftSelect?.(task.id);
          else if (selectionMode) onToggleSelect?.(task.id);
          else if (e.ctrlKey || e.metaKey) onCtrlSelect?.(task.id);
          else selectTask(selectedTaskId === task.id ? null : task.id);
        }}
      >
        {kids.length > 0 ? (
          <button
            className="task-subtoggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded(task.id);
            }}
            title={expanded ? 'Unteraufgaben ausblenden' : 'Unteraufgaben anzeigen'}
          >
            {expanded ? '−' : '+'}
          </button>
        ) : (
          <span className="task-subtoggle-spacer" />
        )}
        <input
          type="checkbox"
          className="task-checkbox"
          checked={selectionMode ? !!selectedIds?.has(task.id) : task.completed || isHolding}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            if (selectionMode) {
              onToggleSelect?.(task.id);
            } else if (isHolding || task.completed) {
              // Un-check during the animation (undo, AC3) or reopen from the
              // ✓ Erledigt block — both plain, no animation.
              toggleTask(task.id);
            } else {
              completeTaskAnimated(task.id, completionMode);
            }
          }}
        />
        <span className={`priority-dot priority-${task.priority}`} title={task.priority} />
        <div className="task-content">
          <div className={`task-title ${task.completed || isHolding ? 'completed' : ''}`}>
            {task.title}
          </div>
          {/* A subtask listed at root level is a search hit (#93). Nested rows
              omit the project because it is the parent's (#1) — here that same
              context is missing entirely, so name the parent instead. */}
          {task.parentId && (
            <div className="task-parent-hint" title="Unteraufgabe von">
              ↳ gehört zu: {allTasks.find((p) => p.id === task.parentId)?.title ?? 'unbekannt'}
            </div>
          )}
          {renderMeta(task, hideProject, inCompletedSection)}
        </div>
        <div className="task-actions">
          <AvatarStack members={assigneesOf(task, members)} size={20} />
          {showPomodoroBtn && !task.completed && (
            <button
              className={`task-pomodoro ${activePomodoroTaskId === task.id ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                pomodoroStartForTask(task.id);
                setSidePanel('pomodoro');
              }}
              title="Pomodoro für diese Aufgabe starten"
            >
              🍅
            </button>
          )}
          <button
            className={`task-star ${task.starred ? 'starred' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleStar(task.id);
            }}
            title={task.starred ? 'Stern entfernen' : 'Markieren'}
          >
            {task.starred ? '★' : '☆'}
          </button>
        </div>
      </div>
      {expanded && kids.length > 0 && (
        <div className="task-subtasks" data-flip-id={`${task.id}:subs`}>
          {kids.map(renderChild)}
        </div>
      )}
      </div>
    );
  };

  // One ✓ Erledigt block for every list that shows completed tasks (#53 AC5),
  // newest completion first; rows inside show their completion date.
  const renderCompletedSection = (done: Task[]) =>
    done.length > 0 ? (
      <div className="task-section completed-section">
        <div className="section-header">
          <span className="section-grip" style={{ visibility: 'hidden' }}>⠿</span>
          <span className="section-name section-name-static">✓ Erledigt</span>
          <span className="section-count">{done.length}</span>
        </div>
        <div className="section-body">{done.map((t) => renderTask(t, true))}</div>
      </div>
    ) : null;

  // --- Flat list (ungrouped views) ---
  if (!grouped) {
    // The Erledigt view IS the completed area: no extra block, rows show dates.
    if (inCompletedView) {
      return (
        <div className="task-list" ref={listRef}>
          {tasks.map((t) => renderTask(t, true))}
        </div>
      );
    }
    return (
      <div className="task-list" ref={listRef}>
        {tasks.filter((t) => !t.completed).map((t) => renderTask(t))}
        {renderCompletedSection(tasks.filter((t) => t.completed))}
      </div>
    );
  }

  // --- Grouped list (project or list view) ---
  // Open tasks stay in their group; completed tasks all sink to a final block.
  // A task belongs to a section only if that section exists in the CURRENT scope.
  // Otherwise (e.g. a project-section task shown in the Next Week view) it's treated
  // as ungrouped here, so it never silently disappears.
  const scopeSectionIds = new Set(scopeSections.map((s) => s.id));
  const ungrouped = tasks.filter(
    (t) => !t.completed && !(t.sectionId && scopeSectionIds.has(t.sectionId))
  );
  const completedTasks = [...tasks.filter((t) => t.completed)].sort(byCompletedAtDesc);
  const submitSection = () => {
    const name = newSectionName.trim();
    if (name) addSection(scopeKey, name);
    setNewSectionName('');
    setAddingSection(false);
  };

  return (
    <div className="task-list" ref={listRef}>
      {/* Section index: jump to a section or drop a task straight onto it. The
          toggle is shown here only when the FilterBar isn't (otherwise FilterBar
          renders it so both toggles share one line). */}
      {showSectionToggle && scopeSections.length > 0 && (
        <div className="section-index-head">
          <button
            className="section-index-toggle"
            onClick={() => setSectionsCollapsed(!sectionsCollapsed)}
            title={sectionsCollapsed ? 'Gruppen/Sektionen anzeigen' : 'Gruppen/Sektionen einklappen'}
          >
            {sectionsCollapsed ? '▸' : '▾'} Gruppen/Sektionen ({scopeSections.length})
          </button>
        </div>
      )}
      {scopeSections.length > 0 && !sectionsCollapsed && (
        <div className="section-index">
          {scopeSections.map((sec) => {
            const cnt = tasks.filter((t) => t.sectionId === sec.id);
            const done = cnt.filter((t) => t.completed).length;
            return (
              <button
                key={sec.id}
                className={`section-index-chip ${overSectionId === sec.id ? 'drop-over' : ''}`}
                onClick={() => {
                  // Scroll the section just BELOW the sticky jump bar / toggle
                  // instead of to the very top, otherwise those sticky headers
                  // (top:0) cover the section header + its first tasks (#38).
                  const el = sectionElRefs.current[sec.id];
                  const container = el?.closest('.task-list') as HTMLElement | null;
                  if (!el || !container) return;
                  const stickyH = Array.from(
                    container.querySelectorAll(':scope > .section-index-head, :scope > .section-index')
                  ).reduce((sum, e) => sum + (e as HTMLElement).getBoundingClientRect().height, 0);
                  const top =
                    container.scrollTop +
                    el.getBoundingClientRect().top -
                    container.getBoundingClientRect().top -
                    stickyH -
                    8;
                  container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                }}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault();
                    setOverSectionId(sec.id);
                  }
                }}
                onDragLeave={() => setOverSectionId((c) => (c === sec.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  const ids = readTaskIds(e);
                  if (ids.length) assignAll(ids, sec.id);
                  setDragId(null);
                  setOverSectionId(null);
                }}
                title={`Zu „${sec.name}" springen · Aufgabe hierher ziehen`}
              >
                {sec.name}
                <span className="section-index-count">
                  {done}/{cnt.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Ungrouped tasks (drop here to remove a task from its section) */}
      <div
        className={`section-dropzone ${overSectionId === '__none__' ? 'drop-over' : ''}`}
        onDragOver={(e) => {
          if (dragId) {
            e.preventDefault();
            setOverSectionId('__none__');
          }
        }}
        onDragLeave={() => setOverSectionId((c) => (c === '__none__' ? null : c))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) {
            // Dropping a subtask here promotes it to a standalone root task.
            if (allTasks.find((t) => t.id === dragId)?.parentId) setTaskParent(dragId, null);
            assignTaskSection(dragId, null);
          }
          setDragId(null);
          setOverSectionId(null);
        }}
      >
        {ungrouped.map((t) => renderTask(t))}
        {ungrouped.length === 0 && (
          <p className="section-empty-hint">
            {tasks.length === 0
              ? (emptyHint ?? 'Noch keine Aufgaben in diesem Projekt.')
              : 'Keine Aufgaben ohne Gruppe.'}
          </p>
        )}
      </div>

      {scopeSections.map((sec) => {
        const secTasks = tasks.filter((t) => t.sectionId === sec.id);
        const done = secTasks.filter((t) => t.completed).length;
        return (
          <div
            key={sec.id}
            className="task-section"
            ref={(el) => {
              sectionElRefs.current[sec.id] = el;
            }}
          >
            <div
              className={`section-header ${overSectionId === sec.id ? 'drop-over' : ''} ${
                dragSectionId === sec.id ? 'dragging' : ''
              }`}
              draggable
              onDragStart={(e) => {
                setDragSectionId(sec.id);
                e.stopPropagation();
              }}
              onDragOver={(e) => {
                if (dragId || dragSectionId) {
                  e.preventDefault();
                  setOverSectionId(sec.id);
                }
              }}
              onDragLeave={() => setOverSectionId((c) => (c === sec.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragSectionId) reorderSections(dragSectionId, sec.id);
                else if (dragId) assignTaskSection(dragId, sec.id);
                setDragId(null);
                setDragSectionId(null);
                setOverSectionId(null);
              }}
              onDragEnd={() => {
                setDragSectionId(null);
                setOverSectionId(null);
              }}
            >
              <span className="section-grip" title="Gruppe ziehen">⠿</span>
              <input
                className="section-name"
                value={sec.name}
                onChange={(e) => renameSection(sec.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                }}
              />
              <span className="section-count">
                {done}/{secTasks.length}
              </span>
              <button
                className="section-del"
                title="Gruppe löschen (Aufgaben bleiben erhalten)"
                onClick={() => deleteSection(sec.id)}
              >
                ×
              </button>
            </div>
            <div
              className={`section-body ${overSectionId === sec.id ? 'drop-over' : ''}`}
              onDragOver={(e) => {
                if (dragId) {
                  e.preventDefault();
                  setOverSectionId(sec.id);
                }
              }}
              onDragLeave={(e) => {
                // Only clear when really leaving the body (not moving between rows).
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setOverSectionId((c) => (c === sec.id ? null : c));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const ids = readTaskIds(e);
                if (ids.length) assignAll(ids, sec.id);
                setDragId(null);
                setOverSectionId(null);
              }}
            >
              {secTasks.map((t) => renderTask(t))}
              {secTasks.length === 0 && (
                <p className="section-empty-hint">Aufgaben hierher ziehen…</p>
              )}
              {/* Create a task directly inside this section (#26). */}
              {addingTaskSecId === sec.id ? (
                <input
                  autoFocus
                  className="section-task-add-input"
                  placeholder="Neue Aufgabe… (Enter)"
                  value={newSecTaskTitle}
                  onChange={(e) => setNewSecTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSecTaskTitle.trim()) {
                      addTask({
                        title: newSecTaskTitle.trim(),
                        projectId: singleProject ? selectedProjectId : null,
                        sectionId: sec.id,
                      });
                      setNewSecTaskTitle('');
                    }
                    if (e.key === 'Escape') {
                      setAddingTaskSecId(null);
                      setNewSecTaskTitle('');
                    }
                  }}
                  onBlur={() => {
                    if (newSecTaskTitle.trim()) {
                      addTask({
                        title: newSecTaskTitle.trim(),
                        projectId: singleProject ? selectedProjectId : null,
                        sectionId: sec.id,
                      });
                    }
                    setAddingTaskSecId(null);
                    setNewSecTaskTitle('');
                  }}
                />
              ) : (
                <button
                  className="section-task-add-btn"
                  onClick={() => {
                    setAddingTaskSecId(sec.id);
                    setNewSecTaskTitle('');
                  }}
                >
                  + Aufgabe
                </button>
              )}
            </div>
          </div>
        );
      })}

      {addingSection ? (
        <input
          autoFocus
          className="section-add-input"
          placeholder="Gruppenname… (Enter)"
          value={newSectionName}
          onChange={(e) => setNewSectionName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSection();
            if (e.key === 'Escape') {
              setAddingSection(false);
              setNewSectionName('');
            }
          }}
          onBlur={submitSection}
        />
      ) : (
        <button className="section-add-btn" onClick={() => setAddingSection(true)}>
          + Gruppe / Sektion
        </button>
      )}

      {/* All completed tasks, below every group; reopen sends them back up. */}
      {renderCompletedSection(completedTasks)}
    </div>
  );
}
