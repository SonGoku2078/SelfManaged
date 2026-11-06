import { useEffect } from 'react';
import { useStore } from '../store';
import type { ActivityEntry } from '../types';
import './ActivityLog.css';

const KIND_ICON: Record<ActivityEntry['kind'], string> = {
  created: '➕',
  updated: '✏️',
  completed: '✅',
  reopened: '↺',
  deleted: '🗑️',
  comment: '💬',
  attachment: '📎',
  subtask: '🔗',
  'project-created': '📂',
};

const describe = (e: ActivityEntry): string => {
  switch (e.kind) {
    case 'created':
      return 'erstellt';
    case 'completed':
      return 'erledigt';
    case 'reopened':
      return 'wieder geöffnet';
    case 'deleted':
      return 'gelöscht';
    case 'comment':
      return `kommentiert: „${e.to ?? ''}"`;
    case 'attachment':
      return `Anhang hinzugefügt: ${e.to ?? ''}`;
    case 'subtask':
      return `Unteraufgabe hinzugefügt: ${e.to ?? ''}`;
    case 'project-created':
      return 'Projekt erstellt';
    case 'updated':
      return `${e.field}: ${e.from ?? '—'} → ${e.to ?? '—'}`;
  }
};

const time = (d: Date) =>
  d.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function ActivityLog() {
  const activityLog = useStore((s) => s.activityLog);
  const tasks = useStore((s) => s.tasks);
  const selectTask = useStore((s) => s.selectTask);
  const restoreTask = useStore((s) => s.restoreTask);
  const loadActivityLog = useStore((s) => s.loadActivityLog);

  // Not part of the regular sync any more (Appwrite bills every row): fetched
  // when the view opens.
  useEffect(() => { void loadActivityLog(); }, [loadActivityLog]);

  if (activityLog.length === 0) {
    return (
      <div className="activity-empty">
        <div className="empty-icon">📜</div>
        <p>Noch keine Änderungen. Sobald du Aufgaben anlegst oder bearbeitest, erscheint hier die Historie.</p>
      </div>
    );
  }

  // Group entries by task (newest-first order is preserved from the log).
  const groups: { key: string; entries: ActivityEntry[] }[] = [];
  const index = new Map<string, number>();
  for (const e of activityLog) {
    const key = e.taskId ?? `misc-${e.kind}-${e.taskTitle}`;
    let gi = index.get(key);
    if (gi === undefined) {
      gi = groups.length;
      index.set(key, gi);
      groups.push({ key, entries: [] });
    }
    groups[gi].entries.push(e);
  }

  return (
    <div className="activity-log">
      {groups.map((g) => {
        const head = g.entries[0];
        const taskExists = head.taskId && tasks.some((t) => t.id === head.taskId);
        return (
          <div className="activity-group" key={g.key}>
            <button
              className={`activity-task ${taskExists ? '' : 'gone'}`}
              disabled={!taskExists}
              onClick={() => taskExists && selectTask(head.taskId!)}
              title={taskExists ? 'Aufgabe öffnen' : 'Aufgabe existiert nicht mehr'}
            >
              {head.taskNumber != null && (
                <span className="activity-num">#{head.taskNumber}</span>
              )}
              <span className="activity-title">{head.taskTitle}</span>
            </button>
            <div className="activity-changes">
              {g.entries.map((e) => {
                const canRestore =
                  e.kind === 'deleted' &&
                  !!e.payload?.task &&
                  !tasks.some((t) => t.id === e.payload!.task.id);
                return (
                  <div className="activity-change" key={e.id}>
                    <span className="activity-kind-icon">{KIND_ICON[e.kind]}</span>
                    <span className="activity-desc">{describe(e)}</span>
                    {canRestore && (
                      <button
                        className="activity-restore"
                        onClick={() => restoreTask(e.id)}
                        title="Aufgabe wiederherstellen"
                      >
                        ↩ Wiederherstellen
                      </button>
                    )}
                    <span className="activity-meta">
                      {e.actor} · {time(e.at)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
