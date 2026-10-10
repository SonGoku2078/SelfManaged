import type { Project } from './types';

export interface ProjectGroups {
  projects: Project[];
  areas: Project[];
  someday: Project[];
}

// Same grouping + order as the desktop "Projekte" panel (ProjectsPanel.tsx):
// the store keeps projects in their manual (drag) order — the server returns
// them by sort_order — so we never re-sort alphabetically. Active projects
// with pinned ones first, then areas in store order. Archived are left out;
// inactive/Someday projects only come back as their own group (the caller
// decides whether to show them, e.g. only while searching).
export function groupProjects(all: Project[], query = ''): ProjectGroups {
  const q = query.trim().toLowerCase();
  const list = all.filter((p) => !p.archived && (!q || (p.name ?? '').toLowerCase().includes(q)));
  const pinnedFirst = (l: Project[]) => [...l.filter((p) => p.pinned), ...l.filter((p) => !p.pinned)];
  return {
    projects: pinnedFirst(list.filter((p) => p.kind !== 'area' && p.active === true)),
    areas: list.filter((p) => p.kind === 'area'),
    someday: pinnedFirst(list.filter((p) => p.kind !== 'area' && p.active !== true)),
  };
}
