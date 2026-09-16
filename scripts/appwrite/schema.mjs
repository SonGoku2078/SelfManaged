const v = (key, size, required = false, xdefault, array = false) => ({ type: 'varchar', key, size, required, xdefault, array });
const text = (key, required = false, xdefault) => ({ type: 'text', key, required, xdefault });
const longtext = (key, required = false, xdefault) => ({ type: 'longtext', key, required, xdefault });
const integer = (key, required = false, xdefault, min, max, array = false) => ({ type: 'integer', key, required, xdefault, min, max, array });
const bool = (key, required = false, xdefault) => ({ type: 'boolean', key, required, xdefault });
const datetime = (key, required = false) => ({ type: 'datetime', key, required });
const idx = (key, type, columns, orders) => ({ key, type, columns, orders });

export const TABLES = [
  {
    id: 'tasks', name: 'Tasks',
    columns: [
      v('legacyId', 255, true), integer('number', true), v('title', 1000, true, ''), longtext('description', true, ''),
      v('projectId', 255), v('parentId', 255), v('sectionId', 255), datetime('dueDate'), integer('startMinutes'), integer('durationMin'),
      v('priority', 16, true, 'medium'), bool('completed', true, false), bool('starred', true, false), bool('someday', true, false),
      bool('thisWeek', true, false), bool('waiting', true, false), v('waitingFor', 500), v('todayDate', 10),
      v('recurrence', 16, true, 'none'), datetime('recurrenceEnd'), integer('recurInterval'), v('recurUnit', 16), v('recurMonthDay', 16),
      datetime('completedAt'), datetime('createdAt', true), datetime('updatedAt', true), v('nozbeId', 255), integer('sortOrder', true, 0),
      v('categoryIds', 255, false, undefined, true), v('assigneeIds', 255, false, undefined, true),
      longtext('commentsJson', true, '[]'), longtext('attachmentsJson', true, '[]'), longtext('linksJson', true, '[]'),
      v('linkedProjectId', 255), integer('focusSeconds', true, 0, 0),
    ],
    // 'number' is NOT unique: the legacy Express/SQLite server assigns task
    // numbers purely client-side with no server-side uniqueness check, and
    // real PROD data has 133 genuine collisions across otherwise-unrelated
    // tasks (confirmed against a real export on 2026-09-16 — e.g. 18
    // different tasks all sharing number 1454). A unique index here silently
    // drops every task but the first per colliding number on import. Keep a
    // plain key index for lookup speed without enforcing an invariant the
    // source data never actually had.
    indexes: [idx('task_number', 'key', ['number']), idx('task_project', 'key', ['projectId']), idx('task_parent', 'key', ['parentId']), idx('task_due', 'key', ['dueDate']), idx('task_order', 'key', ['sortOrder'])],
  },
  {
    id: 'projects', name: 'Projects',
    columns: [v('legacyId', 255, true), v('name', 500, true, ''), v('color', 16, true, '#4caf50'), v('icon', 32, true, '📁'), v('label', 255), bool('pinned', true, false), bool('active', true, true), v('kind', 16, true, 'project'), text('description'), integer('sortOrder', true, 0), v('nozbeId', 255), v('parentAreaId', 255), bool('archived', true, false)],
    indexes: [idx('project_order', 'key', ['sortOrder']), idx('project_parent_area', 'key', ['parentAreaId'])],
  },
  { id: 'categories', name: 'Categories', columns: [v('legacyId', 255, true), v('name', 255, true), v('color', 16, true, '#4caf50'), integer('sortOrder', true, 0), v('nozbeId', 255)], indexes: [idx('category_order', 'key', ['sortOrder'])] },
  { id: 'members', name: 'Members', columns: [v('legacyId', 255, true), v('name', 255, true), v('role', 16, true, 'editor'), v('color', 16, true, '#4caf50'), text('avatarUrl'), v('avatarFileId', 255)], indexes: [idx('member_name', 'key', ['name'])] },
  { id: 'sections', name: 'Sections', columns: [v('legacyId', 255, true), v('scope', 255, true), v('name', 500, true), integer('sortOrder', true, 0)], indexes: [idx('section_scope_order', 'key', ['scope', 'sortOrder'])] },
  { id: 'blockers', name: 'Project blockers', columns: [v('legacyId', 255, true), v('projectId', 255, true), integer('weekdays', false, undefined, 0, 6, true), integer('startMinutes', true, 0), integer('durationMin', true, 60)], indexes: [idx('blocker_project', 'key', ['projectId'])] },
  { id: 'saved_views', name: 'Saved views', columns: [v('legacyId', 255, true), v('name', 500, true), longtext('filtersJson', true, '{}'), v('sortField', 32, true, 'manual'), v('sortDir', 8, true, 'asc'), v('searchQuery', 1000, true, ''), integer('sortOrder', true, 0)], indexes: [idx('saved_view_order', 'key', ['sortOrder'])] },
  { id: 'activity_log', name: 'Activity log', columns: [v('legacyId', 255, true), datetime('at', true), v('actor', 255, true, ''), v('kind', 64, true), v('taskId', 255), integer('taskNumber'), v('taskTitle', 1000, true, ''), v('field', 255), text('fromValue'), text('toValue'), longtext('payloadJson')], indexes: [idx('activity_at', 'key', ['at']), idx('activity_task', 'key', ['taskId'])] },
  { id: 'settings', name: 'Settings', columns: [v('key', 255, true), longtext('valueJson', true)], indexes: [idx('setting_key_unique', 'unique', ['key'])] },
  { id: 'task_attachments', name: 'Task attachments', columns: [v('legacyId', 255, true), v('taskId', 255, true), v('fileId', 255, true), v('name', 1000, true), v('mimeType', 255, true), integer('size', true, 0, 0), datetime('createdAt', true)], indexes: [idx('attachment_task', 'key', ['taskId']), idx('attachment_file', 'unique', ['fileId'])] },
];

// Pflichtspalten haben in Appwrite keinen Server-Default (provision.mjs sendet
// xdefault nur für optionale Spalten). Der Import muss fehlende Pflichtwerte
// deshalb selbst füllen — Quelle der Wahrheit bleibt diese Datei.
export const REQUIRED_DEFAULTS = Object.fromEntries(TABLES.map((table) => [
  table.id,
  Object.fromEntries(table.columns
    .filter((column) => column.required && column.xdefault !== undefined)
    .map((column) => [column.key, column.xdefault])),
]));
