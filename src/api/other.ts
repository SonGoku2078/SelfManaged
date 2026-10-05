import type { Section, ProjectBlocker, SavedView, ActivityEntry, Settings } from '../types';
import { apiFetch, reorderChunked } from './client';

export const sectionsApi = {
  getAll: ()                                  => apiFetch<Section[]>('/api/sections'),
  create: (s: Section)                        => apiFetch<Section>('/api/sections', { method: 'POST', body: JSON.stringify(s) }),
  update: (id: string, p: Partial<Section>)  => apiFetch<Section>(`/api/sections/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  remove: (id: string)                        => apiFetch<void>(`/api/sections/${id}`, { method: 'DELETE' }),
  reorder: (ids: string[])                    => reorderChunked('/api/sections/reorder', ids),
};

export const blockersApi = {
  getAll: ()                                       => apiFetch<ProjectBlocker[]>('/api/blockers'),
  create: (b: ProjectBlocker)                      => apiFetch<ProjectBlocker>('/api/blockers', { method: 'POST', body: JSON.stringify(b) }),
  update: (id: string, p: Partial<ProjectBlocker>) => apiFetch<ProjectBlocker>(`/api/blockers/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  remove: (id: string)                             => apiFetch<void>(`/api/blockers/${id}`, { method: 'DELETE' }),
};

export const savedViewsApi = {
  getAll: ()             => apiFetch<SavedView[]>('/api/saved-views'),
  create: (v: SavedView) => apiFetch<SavedView>('/api/saved-views', { method: 'POST', body: JSON.stringify(v) }),
  remove: (id: string)   => apiFetch<void>(`/api/saved-views/${id}`, { method: 'DELETE' }),
};

export const activityLogApi = {
  getAll:  ()                  => apiFetch<ActivityEntry[]>('/api/activity-log'),
  append:  (e: ActivityEntry)  => apiFetch<void>('/api/activity-log', { method: 'POST', body: JSON.stringify(e) }),
};

export const settingsApi = {
  getAll: ()                               => apiFetch<Settings & { nextTaskNumber: number }>('/api/settings'),
  patch:  (p: Partial<Settings & { nextTaskNumber: number }>) =>
    apiFetch<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(p) }),
};

// Token-secured ICS feed URL(s) for subscribing from an external calendar
// (#24). Goes through apiFetch so it works on Appwrite (function execution
// with the user's JWT) as well as against the LAN server.
export const calendarFeedApi = {
  get: () => apiFetch<{ token?: string; baseUrl?: string; urls?: string[] }>('/api/calendar-feed'),
};
