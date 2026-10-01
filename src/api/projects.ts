import type { Project } from '../types';
import { apiFetch, reorderChunked } from './client';

export const projectsApi = {
  getAll:  ()                                 => apiFetch<Project[]>('/api/projects'),
  create:  (p: Project)                       => apiFetch<Project>('/api/projects', { method: 'POST', body: JSON.stringify(p) }),
  update:  (id: string, p: Partial<Project>) => apiFetch<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  remove:  (id: string)                       => apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  reorder: (ids: string[])                    => reorderChunked('/api/projects/reorder', ids),
};
