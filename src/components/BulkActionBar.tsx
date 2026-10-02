import { useState } from 'react';
import { useStore } from '../store';
import { dateKey } from '../selectors';
import type { Priority, Task } from '../types';
import './BulkActionBar.css';

interface BulkActionBarProps {
  selectedIds: string[];
  totalVisible: number;
  onSelectAll: () => void;
  onClear: () => void;
}

export default function BulkActionBar({
  selectedIds,
  totalVisible,
  onSelectAll,
  onClear,
}: BulkActionBarProps) {
  const bulkUpdate = useStore((s) => s.bulkUpdate);
  const bulkDelete = useStore((s) => s.bulkDelete);
  const projects = useStore((s) => s.projects);
  const currentView = useStore((s) => s.ui.currentView);

  const count = selectedIds.length;
  const disabled = count === 0;

  // Only show actions that make sense for the current view.
  const inCompleted = currentView === 'completed';
  const inNextWeek = currentView === 'nextweek';
  const inSomeday = currentView === 'someday';
  const inToday = currentView === 'today';

  // Brief "✓ done" feedback so a bulk action is visibly acknowledged.
  const [flash, setFlash] = useState('');
  const apply = (updates: Partial<Task>, label: string) => {
    bulkUpdate(selectedIds, updates);
    setFlash(`✓ ${count} → ${label}`);
    window.setTimeout(() => setFlash(''), 1800);
  };

  return (
    <div className="bulk-bar">
      <label className="bulk-selectall">
        <input
          type="checkbox"
          checked={count > 0 && count === totalVisible}
          ref={(el) => {
            if (el) el.indeterminate = count > 0 && count < totalVisible;
          }}
          onChange={(e) => (e.target.checked ? onSelectAll() : onClear())}
        />
        {count} ausgewählt
      </label>

      <div className="bulk-actions">
        {!inCompleted && (
          <button
            className="bulk-btn"
            disabled={disabled}
            onClick={() => apply({ completed: true }, 'erledigt')}
          >
            ✓ Erledigen
          </button>
        )}
        {inCompleted && (
          <button
            className="bulk-btn"
            disabled={disabled}
            onClick={() => apply({ completed: false }, 'geöffnet')}
          >
            ↺ Öffnen
          </button>
        )}
        <button
          className="bulk-btn"
          disabled={disabled}
          onClick={() => apply({ starred: true }, 'Nächste Aktion')}
        >
          ★ Markieren
        </button>

        <select
          className="bulk-select"
          disabled={disabled}
          value=""
          onChange={(e) => {
            if (e.target.value) {
              const isInbox = e.target.value === '__inbox';
              apply(
                { projectId: isInbox ? null : e.target.value },
                isInbox ? 'Inbox' : projects.find((p) => p.id === e.target.value)?.name ?? 'Projekt'
              );
              e.target.value = '';
            }
          }}
        >
          <option value="">Projekt setzen…</option>
          <option value="__inbox">Inbox (kein Projekt)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id} style={{ color: p.color }}>
              ● {p.name}
            </option>
          ))}
        </select>

        <select
          className="bulk-select"
          disabled={disabled}
          value=""
          onChange={(e) => {
            if (e.target.value) {
              apply({ priority: e.target.value as Priority }, `Priorität ${e.target.value}`);
              e.target.value = '';
            }
          }}
        >
          <option value="">Priorität…</option>
          <option value="high">Hoch</option>
          <option value="medium">Mittel</option>
          <option value="low">Niedrig</option>
        </select>

        <label className="bulk-date" title="Fälligkeit für die Auswahl setzen">
          📅
          <input
            type="date"
            className="bulk-select bulk-date-input"
            disabled={disabled}
            value=""
            onChange={(e) => {
              if (e.target.value) {
                apply({ dueDate: new Date(e.target.value) }, 'Datum gesetzt');
                e.target.value = '';
              }
            }}
          />
        </label>
        <button
          className="bulk-btn"
          disabled={disabled}
          title="Fälligkeit von der Auswahl entfernen"
          onClick={() => apply({ dueDate: null }, 'Datum entfernt')}
        >
          🗓✕ Datum entfernen
        </button>

        {!inToday && (
          <button
            className="bulk-btn"
            disabled={disabled}
            title="Für heute vormerken (bleibt, bis erledigt oder entfernt)"
            onClick={() => apply({ todayDate: dateKey(new Date()) }, 'Heute')}
          >
            ☀️ Heute
          </button>
        )}
        {inToday && (
          <button
            className="bulk-btn"
            disabled={disabled}
            title="Heute-Markierung entfernen"
            onClick={() => apply({ todayDate: null }, 'aus Heute')}
          >
            ✕ Heute
          </button>
        )}
        {!inNextWeek && (
          <button
            className="bulk-btn"
            disabled={disabled}
            title="Für diese Woche markieren (Next Week)"
            onClick={() => apply({ thisWeek: true }, 'Next Week')}
          >
            🗓️ Next Week
          </button>
        )}
        {inNextWeek && (
          <button
            className="bulk-btn"
            disabled={disabled}
            title="Aus Next Week entfernen"
            onClick={() => apply({ thisWeek: false }, 'aus Next Week')}
          >
            ✕ Next Week
          </button>
        )}
        {!inSomeday && (
          <button
            className="bulk-btn"
            disabled={disabled}
            title="Nach Someday verschieben"
            onClick={() => apply({ someday: true }, 'Someday')}
          >
            🌥️ Someday
          </button>
        )}
        {inSomeday && (
          <button
            className="bulk-btn"
            disabled={disabled}
            title="Aus Someday holen (wird Single-Task, falls kein Projekt)"
            onClick={() => apply({ someday: false }, 'aus Someday')}
          >
            ✕ Someday
          </button>
        )}

        {flash && <span className="bulk-flash">{flash}</span>}

        <button
          className="bulk-btn bulk-btn-danger"
          disabled={disabled}
          onClick={() => {
            bulkDelete(selectedIds);
            onClear();
          }}
        >
          🗑 Löschen
        </button>
      </div>

      <button className="bulk-cancel" onClick={onClear}>
        ✕ Auswahl beenden
      </button>
    </div>
  );
}
