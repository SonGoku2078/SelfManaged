import type { Task } from '../types';
import { apiFetch, reorderChunked } from './client';

export const tasksApi = {
  getAll:  ()                              => apiFetch<Task[]>('/api/tasks'),
  create:  (t: Task)                       => apiFetch<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(t) }),
  update:  (id: string, p: Partial<Task>) => apiFetch<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  remove:  (id: string)                   => apiFetch<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  reorder: (ids: string[])                => reorderChunked('/api/tasks/reorder', ids),
};
