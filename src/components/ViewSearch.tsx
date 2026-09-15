import { forwardRef } from 'react';
import { useStore } from '../store';
import ClearableInput from './ClearableInput';
import './ViewSearch.css';

/**
 * Placeholder for every task search field. `matchesSearch` looks at far more
 * than the title, so the text names what is really searched (#92 AC10).
 * Shared with FilterBar so the wording cannot drift apart between views.
 */
export const SEARCH_PLACEHOLDER = '🔍 Suchen: Titel, #Nr, Beschreibung, Person, Status…';

/**
 * Standalone search field for the views that do not render a FilterBar
 * (Next Week, Someday, Kalender-Liste — #92). Deliberately search only: those
 * views stay out of FILTERABLE_VIEWS, so showing the other filter controls
 * would offer switches that silently do nothing (see selectors.ts).
 *
 * Reuses the FilterBar's input classes so both fields look identical.
 */
const ViewSearch = forwardRef<HTMLInputElement>(function ViewSearch(_props, ref) {
  const searchQuery = useStore((s) => s.ui.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);

  return (
    <div className="view-search-bar">
      <ClearableInput
        ref={ref}
        wrapperClassName="filter-search-wrap"
        className="filter-search"
        type="text"
        placeholder={SEARCH_PLACEHOLDER}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onClear={() => setSearchQuery('')}
      />
    </div>
  );
});

export default ViewSearch;
