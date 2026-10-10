import { useState } from 'react';
import { useStore } from '../store';
import { groupProjects } from '../projectGroups';
import type { Project } from '../types';

// Project choice for the share sheet and the task detail — same groups, order
// and colour dots as the desktop "Projekte" panel. Someday projects stay
// hidden like there, but a search still finds them. `collapsible`: shows only
// the current project until tapped (the detail sheet is long enough already).
export default function ProjectPicker({
  value,
  onChange,
  collapsible = false,
}: {
  value: string | null; // null = Inbox
  onChange: (projectId: string | null) => void;
  collapsible?: boolean;
}) {
  const projects = useStore((s) => s.projects);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!collapsible);

  const searching = query.trim() !== '';
  const groups = groupProjects(projects, query);
  const someday = searching ? groups.someday : [];
  const noMatch = groups.projects.length + groups.areas.length + someday.length === 0;
  const chosen = value ? projects.find((p) => p.id === value) : undefined;

  const pick = (id: string | null) => {
    onChange(id);
    setQuery('');
    if (collapsible) setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur?.(); // drop the keyboard
  };
  const item = (p: Project) => (
    <button
      key={p.id}
      className={`m-share-projitem ${value === p.id ? 'on' : ''}`}
      onClick={() => pick(p.id)}
    >
      <span className="m-dot" style={{ background: p.color ?? '#9ca3af' }} />
      <span className="m-share-projname">{p.kind === 'area' ? '∞ ' : ''}{p.name}</span>
    </button>
  );
  const chosenLabel = (
    <>
      {chosen && <span className="m-dot" style={{ background: chosen.color ?? '#9ca3af' }} />}
      <strong className="m-share-projname">
        {chosen ? `${chosen.kind === 'area' ? '∞ ' : ''}${chosen.name}` : '📥 Inbox'}
      </strong>
    </>
  );

  return (
    <div className="m-field">
      {collapsible ? (
        <>
          <span>Projekt</span>
          <button
            type="button"
            className="m-proj-current"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {chosenLabel}
            <span className="m-proj-current-caret">{open ? '▴' : '▾'}</span>
          </button>
        </>
      ) : (
        <span className="m-share-chosen">Projekt: {chosenLabel}</span>
      )}
      {open && (
        <>
          <input
            className="m-share-projsearch"
            placeholder="Projekt suchen… (leer = Inbox)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="m-share-projlist">
            <button
              className={`m-share-projitem ${!value ? 'on' : ''}`}
              onClick={() => pick(null)}
            >
              📥 Inbox (kein Projekt)
            </button>
            {groups.projects.map(item)}
            {groups.areas.length > 0 && (
              <>
                <div className="m-share-projgroup">📦 Areas</div>
                {groups.areas.map(item)}
              </>
            )}
            {someday.length > 0 && (
              <>
                <div className="m-share-projgroup">🌥️ Someday</div>
                {someday.map(item)}
              </>
            )}
            {noMatch && <p className="m-settings-hint">Kein Projekt gefunden.</p>}
          </div>
        </>
      )}
    </div>
  );
}
