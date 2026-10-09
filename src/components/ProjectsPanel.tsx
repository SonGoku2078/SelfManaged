import { useEffect, useRef, useState } from 'react';
import { useStore, DEFAULT_PALETTE } from '../store';
import type { Project } from '../types';
import { readTaskIds } from '../dnd';
import ClearableInput from './ClearableInput';
import { useWindowMenu } from './WindowMenu';
import './ProjectsPanel.css';

const EMPTY_LABELS: Record<string, string> = {};

interface ProjectsPanelProps {
  mode?: 'projects' | 'someday' | 'all';
  calendarShown?: boolean;
  onToggleCalendar?: () => void;
  onOpenDetail?: () => void;
  // When set, a ✕ in the header calls this (used by the Inbox assign panel, #32).
  onClose?: () => void;
}

export default function ProjectsPanel({
  mode = 'projects',
  calendarShown,
  onToggleCalendar,
  onOpenDetail,
  onClose,
}: ProjectsPanelProps) {
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);
  const selectedProjectId = useStore((s) => s.ui.selectedProjectId);
  const selectedProjectIds = useStore((s) => s.ui.selectedProjectIds);
  const selectProject = useStore((s) => s.selectProject);
  const toggleProjectSelected = useStore((s) => s.toggleProjectSelected);
  const addProject = useStore((s) => s.addProject);
  const reorderProjects = useStore((s) => s.reorderProjects);
  const updateProject = useStore((s) => s.updateProject);
  const updateTask = useStore((s) => s.updateTask);
  const colorPalette = useStore((s) => Array.isArray(s.settings.colorPalette) ? s.settings.colorPalette : DEFAULT_PALETTE);
  const colorLabels = useStore((s) => (s.settings.colorLabels && typeof s.settings.colorLabels === 'object' ? s.settings.colorLabels : EMPTY_LABELS));
  const addPaletteColor = useStore((s) => s.addPaletteColor);
  const removePaletteColor = useStore((s) => s.removePaletteColor);
  const storedWidth = useStore((s) => s.settings.projectsPanelWidth);
  const setProjectsPanelWidth = useStore((s) => s.setProjectsPanelWidth);

  const someday = mode === 'someday';
  const windowMenu = useWindowMenu();

  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<false | 'project' | 'area'>(false);
  const [newName, setNewName] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Which project's colour popover is open (null = none).
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Close the colour popover on an outside click.
  useEffect(() => {
    if (!colorPickerId) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.projects-color-wrap')) setColorPickerId(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [colorPickerId]);

  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(storedWidth ?? 240);

  useEffect(() => {
    if (storedWidth) setWidth(storedWidth);
  }, [storedWidth]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const left = panelRef.current?.getBoundingClientRect().left ?? 0;
    const onMove = (ev: MouseEvent) => setWidth(Math.max(200, Math.min(560, ev.clientX - left)));
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setProjectsPanelWidth(Math.max(200, Math.min(560, ev.clientX - left)));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const openCount = (projectId: string) =>
    tasks.filter((t) => t.projectId === projectId && !t.completed).length;

  const matchesQuery = (p: Project) =>
    (p.name ?? '').toLowerCase().includes(query.trim().toLowerCase());

  // Group the projects depending on the panel mode. Archived projects are kept
  // out of every normal group and only shown in the dedicated Archiv section.
  const all = projects.filter(matchesQuery);
  const activeProjects = all.filter((p) => p.kind !== 'area' && p.active === true && !p.archived);
  const areas = all.filter((p) => p.kind === 'area' && !p.archived);
  const somedayProjects = all.filter((p) => p.kind !== 'area' && p.active !== true && !p.archived);
  const archivedProjects = all.filter((p) => p.archived);

  const pinnedFirst = (list: Project[]) => [
    ...list.filter((p) => p.pinned),
    ...list.filter((p) => !p.pinned),
  ];
  const anyPinned = activeProjects.some((p) => p.pinned);

  const submitProject = () => {
    const name = newName.trim();
    if (name) {
      const project = addProject(name, undefined, undefined, {
        active: !someday,
        kind: adding === 'area' ? 'area' : 'project',
      });
      selectProject(project.id);
    }
    setNewName('');
    setAdding(false);
  };

  const renderItem = (p: Project) => (
    <div
      key={p.id}
      className={`projects-item ${
        (selectedProjectIds.length ? selectedProjectIds.includes(p.id) : selectedProjectId === p.id)
          ? 'active'
          : ''
      } ${anyPinned && !p.pinned && p.kind !== 'area' ? 'dimmed' : ''} ${
        overId === p.id ? 'drag-over' : ''
      } ${dragId === p.id ? 'dragging' : ''}`}
      draggable
      onClick={(e) =>
        e.ctrlKey || e.metaKey ? toggleProjectSelected(p.id) : selectProject(p.id)
      }
      onContextMenu={windowMenu.onContextMenu({ kind: 'project', projectId: p.id })}
      onDragStart={() => setDragId(p.id)}
      onDragOver={(e) => {
        // Accept either a project (reorder) or a task (move into this project).
        if (!dragId && !e.dataTransfer.types.includes('text/plain')) return;
        e.preventDefault();
        setOverId(p.id);
      }}
      onDragLeave={() => setOverId((cur) => (cur === p.id ? null : cur))}
      onDrop={(e) => {
        e.preventDefault();
        // Don't bubble into the Areas-section drop handler — it would also
        // convert the dragged project into an area (#10).
        e.stopPropagation();
        if (dragId) {
          // Dragging a project that is part of the Ctrl-selection moves the
          // whole selection together (#14), keeping its current order.
          const moveIds = (
            selectedProjectIds.includes(dragId) ? selectedProjectIds : [dragId]
          ).filter((id) => id !== p.id);
          const dragged = projects.find((x) => x.id === dragId);
          if (p.kind === 'area' && dragged && dragged.kind !== 'area') {
            // Drop project(s) onto area → assign to area (activate if someday)
            moveIds.forEach((id) => {
              if (projects.find((x) => x.id === id)?.kind !== 'area') {
                updateProject(id, { parentAreaId: p.id, active: true });
              }
            });
          } else {
            moveIds.forEach((id) => reorderProjects(id, p.id));
          }
        } else {
          // A task (or multi-selection) dropped here moves to this project.
          readTaskIds(e).forEach((id) => updateTask(id, { projectId: p.id }));
        }
        setDragId(null);
        setOverId(null);
      }}
      onDragEnd={() => {
        setDragId(null);
        setOverId(null);
      }}
    >
      {p.pinned && <span className="projects-active-dot" title="Aktiv">●</span>}
      <span className="projects-color-wrap">
        <button
          className="projects-dot"
          style={{ background: p.color }}
          title="Farbe ändern"
          onClick={(e) => {
            e.stopPropagation();
            setColorPickerId((cur) => (cur === p.id ? null : p.id));
          }}
        />
        {colorPickerId === p.id && (
          <div className="projects-color-pop" onClick={(e) => e.stopPropagation()}>
            <div className="projects-swatches">
              {colorPalette
                .filter(
                  (c) =>
                    (colorLabels[c] ?? '').trim() !== '' ||
                    (p.color ?? '').toLowerCase() === c
                )
                .map((c) => {
                const label = colorLabels[c] ?? '';
                return (
                  // The whole row selects the color — not just the dot (#12).
                  <div
                    key={c}
                    className="projects-swatch-wrap"
                    onClick={() => {
                      updateProject(p.id, { color: c });
                      setColorPickerId(null);
                    }}
                  >
                    <button
                      className={`projects-swatch ${(p.color ?? '').toLowerCase() === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      title={label || c}
                    />
                    {label && <span className="projects-swatch-label">{label}</span>}
                    <button
                      className="projects-swatch-del"
                      title="Farbe entfernen"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePaletteColor(c);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <label className="projects-color-custom">
              Hinzufügen
              <input
                type="color"
                defaultValue="#888888"
                title="Farbe zur Palette hinzufügen"
                onChange={(e) => {
                  updateProject(p.id, { color: e.target.value });
                }}
                onBlur={(e) => addPaletteColor(e.target.value)}
              />
            </label>
          </div>
        )}
      </span>
      <span
        className="projects-item-name"
        title={p.name ?? ''}
        onDoubleClick={(e) => { e.stopPropagation(); onOpenDetail?.(); }}
      >
        {p.name ?? '(kein Name)'}
        {p.label && <span className="projects-item-label">{p.label}</span>}
      </span>
      <span className="projects-item-count">{openCount(p.id)}</span>
    </div>
  );

  return (
    <div className="projects-panel" ref={panelRef} style={{ width }}>
      <div className="projects-panel-head">
        <span className="projects-panel-title">
          {mode === 'all' ? '📂 Zu Projekt zuweisen' : someday ? '🌥️ Someday' : '📂 Projekte'}
        </span>
        <div className="projects-add-group">
          <button
            className="projects-add-btn"
            title={someday ? 'Someday-Projekt hinzufügen' : 'Projekt hinzufügen'}
            onClick={() => {
              setAdding('project');
              setNewName('');
            }}
          >
            +
          </button>
          {!someday && onToggleCalendar && (
            <button
              className={`projects-add-btn ${calendarShown ? 'on' : ''}`}
              title={calendarShown ? 'Kalender ausblenden' : 'Kalender einblenden'}
              onClick={onToggleCalendar}
            >
              📅
            </button>
          )}
          {onClose && (
            <button className="projects-add-btn" title="Panel ausblenden" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      <ClearableInput
        className="projects-search"
        placeholder="Suchen…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery('')}
      />

      {adding && (
        <ClearableInput
          autoFocus
          className="projects-add-input"
          placeholder={adding === 'area' ? 'Area-Name…' : 'Projektname…'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onClear={() => setNewName('')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitProject();
            if (e.key === 'Escape') {
              setAdding(false);
              setNewName('');
            }
          }}
          onBlur={submitProject}
        />
      )}

      <div className="projects-list">
        {someday ? (
          <>
            {pinnedFirst(somedayProjects).map(renderItem)}
            {somedayProjects.length === 0 && (
              <p className="projects-empty">Keine inaktiven Projekte.</p>
            )}
          </>
        ) : (
          <>
            {pinnedFirst(activeProjects).map(renderItem)}
            {activeProjects.length === 0 && (
              <p className="projects-empty">Keine aktiven Projekte.</p>
            )}

            <div className="projects-divider" />
            <div
              className={`projects-areas-section ${overId === '__areas__' ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                // Over a child item the item's own green indicator wins (#10) —
                // the section highlight only means "drop here to become an area".
                if ((e.target as HTMLElement).closest('.projects-item')) return;
                setOverId('__areas__');
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setOverId((cur) => cur === '__areas__' ? null : cur);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) {
                  const dragged = projects.find((x) => x.id === dragId);
                  if (dragged && dragged.kind !== 'area') {
                    updateProject(dragId, { kind: 'area' });
                  }
                }
                setDragId(null);
                setOverId(null);
              }}
            >
              <div className="projects-group-head">
                <span className="projects-group-title">📦 Areas</span>
              </div>
              {areas.map(renderItem)}
              {areas.length === 0 && (
                <p className="projects-empty">Projekte hierher ziehen um sie zu Areas zu machen.</p>
              )}
            </div>

            {/* The Inbox assign panel (#32) lists every project, so it also
                surfaces inactive/Someday ones — you can file a task there. */}
            {mode === 'all' && somedayProjects.length > 0 && (
              <>
                <div className="projects-divider" />
                <div className="projects-group-head">
                  <span className="projects-group-title">🌥️ Someday</span>
                </div>
                {pinnedFirst(somedayProjects).map(renderItem)}
              </>
            )}

            {archivedProjects.length > 0 && (
              <>
                <div className="projects-divider" />
                <div
                  className="projects-group-head projects-archive-head"
                  onClick={() => setArchiveOpen((o) => !o)}
                >
                  <span className="projects-group-title">
                    {archiveOpen ? '▾' : '▸'} 🗄 Archiv ({archivedProjects.length})
                  </span>
                </div>
                {archiveOpen && archivedProjects.map(renderItem)}
              </>
            )}
          </>
        )}
      </div>

      <div className="projects-resize" title="Breite ziehen" onMouseDown={startResize} />
      {windowMenu.element}
    </div>
  );
}
