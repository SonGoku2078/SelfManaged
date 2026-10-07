import { useStore } from '../store';
import { isOverdue, countsAsToday, isImplicitToday } from '../selectors';
import { beginExitCollapse } from '../hooks';
import type { Task } from '../types';

export default function TaskRow({
  task,
  onOpen,
  completionMode = 'move',
  showCompletedDate = false,
}: {
  task: Task;
  onOpen: (id: string) => void;
  // 'exit': this list hides completed tasks, so after the grey hold the row
  // collapses out instead of staying/moving (#53 AC2).
  completionMode?: 'move' | 'exit';
  // The ✓ completion date is only shown inside ✓ Erledigt sections (#53 AC6).
  showCompletedDate?: boolean;
}) {
  const toggleTask = useStore((s) => s.toggleTask);
  const completeTaskAnimated = useStore((s) => s.completeTaskAnimated);
  const holdPhase = useStore((s) => s.completionHold[task.id]);
  const toggleStar = useStore((s) => s.toggleStar);
  const projects = useStore((s) => s.projects);
  const project = projects.find((p) => p.id === task.projectId);
  const isHolding = holdPhase != null;
  const isExiting = holdPhase === 'exit';

  return (
    <div
      className={`m-row ${task.completed ? 'done' : ''} ${isHolding ? 'completing' : ''} ${
        isExiting ? 'exiting' : ''
      }`}
      data-flip-id={task.id}
      ref={isExiting ? beginExitCollapse : undefined}
      onClick={() => onOpen(task.id)}
    >
      <input
        type="checkbox"
        className="m-check"
        checked={task.completed || isHolding}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          if (isHolding || task.completed) {
            // Un-check mid animation (undo, AC3) or reopen — both plain.
            toggleTask(task.id);
          } else {
            completeTaskAnimated(task.id, completionMode);
          }
        }}
      />
      <span className={`m-prio m-prio-${task.priority}`} />
      <div className="m-row-body">
        <div className="m-row-title">{task.title}</div>
        <div className="m-row-meta">
          {project && (
            <span className="m-row-project">
              <span className="m-dot" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
          {showCompletedDate && task.completedAt && (
            <span className="m-row-doneat" title="Erledigt am">
              ✓ {new Date(task.completedAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {task.dueDate && (
            <span className={`m-row-due ${isOverdue(task) ? 'overdue' : ''}`}>
              📅 {task.dueDate.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {task.durationMin ? <span className="m-row-dur">⏱ {task.durationMin}m</span> : null}
          {countsAsToday(task) && (
            <span className="m-flag-today" title={isImplicitToday(task) ? 'Heute fällig' : 'Für heute vorgemerkt'}>☀️</span>
          )}
          {task.thisWeek && <span className="m-flag-week" title="Next Week">🗓️</span>}
          {task.recurrence !== 'none' && <span title={task.recurrence}>↻</span>}
          {!!task.description?.trim() && <span title="Hat eine Beschreibung">📜</span>}
        </div>
      </div>
      <button
        className={`m-star ${task.starred ? 'on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleStar(task.id);
        }}
      >
        {task.starred ? '★' : '☆'}
      </button>
    </div>
  );
}
