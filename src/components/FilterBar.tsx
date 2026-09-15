import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { selectScopeSections } from '../selectors';
import ClearableInput from './ClearableInput';
import { SEARCH_PLACEHOLDER } from './ViewSearch';
import type { Priority, SortField } from '../types';
import './FilterBar.css';

const SORT_LABELS: Record<SortField, string> = {
  manual: 'Standard',
  number: 'Nummer',
  priority: 'Priorität',
  dueDate: 'Fälligkeit',
  title: 'Titel',
  createdAt: 'Erstellt',
};

export default function FilterBar({
  searchRef,
}: {
  /** Focus target for the `/` shortcut (#92 AC8); shared with ViewSearch,
      which is never rendered at the same time as the FilterBar. */
  searchRef?: React.Ref<HTMLInputElement>;
}) {
  const filters = useStore((s) => s.ui.filters);
  const sortField = useStore((s) => s.ui.sortField);
  const sortDir = useStore((s) => s.ui.sortDir);
  const currentView = useStore((s) => s.ui.currentView);
  const selectedProjectId = useStore((s) => s.ui.selectedProjectId);
  const selectedProjectIds = useStore((s) => s.ui.selectedProjectIds);
  const projects = useStore((s) => s.projects);
  const categories = useStore((s) => s.categories);
  const members = useStore((s) => s.members);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const searchQuery = useStore((s) => s.ui.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const setSort = useStore((s) => s.setSort);
  const addSavedView = useStore((s) => s.addSavedView);
  const applySavedView = useStore((s) => s.applySavedView);
  const collapsed = useStore((s) => s.settings.filtersCollapsed ?? false);
  const setFiltersCollapsed = useStore((s) => s.setFiltersCollapsed);
  const sections = useStore((s) => s.sections);
  const ui = useStore((s) => s.ui);
  const sectionsCollapsed = useStore((s) => s.settings.sectionsCollapsed ?? false);
  const setSectionsCollapsed = useStore((s) => s.setSectionsCollapsed);
  const scopeSections = selectScopeSections(ui, sections);
  const sectionToggle = scopeSections.length > 0 && (
    <button
      className="filter-toggle"
      title={sectionsCollapsed ? 'Gruppen/Sektionen anzeigen' : 'Gruppen/Sektionen einklappen'}
      onClick={() => setSectionsCollapsed(!sectionsCollapsed)}
    >
      {sectionsCollapsed ? '▸' : '▾'} Gruppen/Sektionen ({scopeSections.length})
    </button>
  );

  // Inside a single open project the project dropdown is redundant.
  const inSingleProject =
    (currentView === 'projects' || currentView === 'custom') &&
    !!selectedProjectId &&
    (selectedProjectIds?.length ?? 0) <= 1;

  const [dateOpen, setDateOpen] = useState(false);
  const dateWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dateOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!dateWrapRef.current?.contains(e.target as Node)) setDateOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [dateOpen]);

  const hasActiveFilter =
    filters.projectId !== null ||
    filters.categoryId !== null ||
    filters.priority !== null ||
    filters.completed !== null ||
    filters.dueFrom !== null ||
    filters.dueTo !== null ||
    (filters.assigneeId ?? null) !== null;
  const activeCount = [
    filters.projectId,
    filters.categoryId,
    filters.priority,
    filters.completed,
    filters.dueFrom || filters.dueTo ? 'date' : null,
    filters.assigneeId ?? null,
  ].filter((v) => v !== null && v !== undefined).length;
  const dateActive = filters.dueFrom !== null || filters.dueTo !== null;

  if (collapsed) {
    return (
      <div className="filter-bar filter-bar-collapsed">
        <button
          className="filter-toggle"
          title="Filter anzeigen"
          onClick={() => setFiltersCollapsed(false)}
        >
          ▸ Filter
        </button>
        {sectionToggle}
        {/* Title filter stays available even with collapsed filters (#9). */}
        {currentView !== 'search' && (
          <ClearableInput
            ref={searchRef}
            wrapperClassName="filter-search-wrap"
            className="filter-search"
            type="text"
            placeholder={SEARCH_PLACEHOLDER}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
          />
        )}
        {activeCount > 0 && <span className="filter-active-badge">{activeCount}</span>}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={resetFilters}>
            ✕ zurücksetzen
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="filter-bar">
      <button
        className="filter-toggle"
        title="Filter einklappen"
        onClick={() => setFiltersCollapsed(true)}
      >
        ▾ Filter
      </button>
      {sectionToggle}

      {/* Title filter within the current view, e.g. inside a project (#9).
          The query resets automatically on view change (setView). */}
      {currentView !== 'search' && (
        <ClearableInput
          ref={searchRef}
          wrapperClassName="filter-search-wrap"
          className="filter-search"
          type="text"
          placeholder={SEARCH_PLACEHOLDER}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={() => setSearchQuery('')}
        />
      )}

      {!inSingleProject && (
        <select
          className="filter-select"
          value={filters.projectId ?? ''}
          onChange={(e) => setFilter('projectId', e.target.value || null)}
        >
          <option value="">Alle Projekte</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id} style={{ color: p.color }}>
              ● {p.name}
            </option>
          ))}
        </select>
      )}

      <select
        className="filter-select"
        value={filters.categoryId ?? ''}
        onChange={(e) => setFilter('categoryId', e.target.value || null)}
      >
        <option value="">Alle Kategorien</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        className="filter-select"
        value={filters.priority ?? ''}
        onChange={(e) =>
          setFilter('priority', (e.target.value || null) as Priority | null)
        }
      >
        <option value="">Jede Priorität</option>
        <option value="high">Hoch</option>
        <option value="medium">Mittel</option>
        <option value="low">Niedrig</option>
      </select>

      <select
        className="filter-select"
        value={filters.completed === null ? '' : filters.completed ? 'done' : 'open'}
        onChange={(e) => {
          const v = e.target.value;
          setFilter('completed', v === '' ? null : v === 'done');
        }}
      >
        <option value="">Alle Status</option>
        <option value="open">Offen</option>
        <option value="done">Erledigt</option>
      </select>

      <select
        className="filter-select"
        value={filters.assigneeId ?? ''}
        onChange={(e) => setFilter('assigneeId', e.target.value || null)}
        title="Verantwortlich"
      >
        <option value="">Alle Personen</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {/* Date range behind one compact button + popover */}
      <div className="filter-date-wrap" ref={dateWrapRef}>
        <button
          className={`filter-select filter-date-btn ${dateActive ? 'active' : ''}`}
          onClick={() => setDateOpen((o) => !o)}
          title="Fälligkeit von – bis"
        >
          📅 Zeitraum{dateActive ? ' •' : ''}
        </button>
        {dateOpen && (
          <div className="filter-date-pop" onClick={(e) => e.stopPropagation()}>
            <label className="filter-date-row">
              <span>Von</span>
              <input
                type="date"
                className="filter-select"
                value={filters.dueFrom ?? ''}
                onChange={(e) => setFilter('dueFrom', e.target.value || null)}
              />
            </label>
            <label className="filter-date-row">
              <span>Bis</span>
              <input
                type="date"
                className="filter-select"
                value={filters.dueTo ?? ''}
                onChange={(e) => setFilter('dueTo', e.target.value || null)}
              />
            </label>
            {dateActive && (
              <button
                className="filter-reset filter-date-clear"
                onClick={() => { setFilter('dueFrom', null); setFilter('dueTo', null); }}
              >
                ✕ Zeitraum löschen
              </button>
            )}
          </div>
        )}
      </div>

      <div className="filter-spacer" />

      <label className="filter-sort-label">Sortieren</label>
      <select
        className="filter-select"
        value={sortField}
        onChange={(e) => setSort(e.target.value as SortField, sortDir)}
      >
        {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
          <option key={f} value={f}>
            {SORT_LABELS[f]}
          </option>
        ))}
      </select>
      <button
        className="filter-dir-btn"
        title={sortDir === 'asc' ? 'Aufsteigend' : 'Absteigend'}
        disabled={sortField === 'manual'}
        onClick={() => setSort(sortField, sortDir === 'asc' ? 'desc' : 'asc')}
      >
        {sortDir === 'asc' ? '↑' : '↓'}
      </button>

      {hasActiveFilter && (
        <>
          <button
            className="filter-save"
            title="Aktuelle Filter als Ansicht speichern"
            onClick={() => {
              const name = window.prompt('Name der gespeicherten Ansicht:');
              if (name && name.trim()) {
                const view = addSavedView(name.trim());
                applySavedView(view.id);
              }
            }}
          >
            💾
          </button>
          <button className="filter-reset" onClick={resetFilters}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}
