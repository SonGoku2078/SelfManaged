import crypto from 'node:crypto';
import { Client, Query, TablesDB } from 'node-appwrite';

const DATABASE_ID = 'selfmanaged-prod';
const JSON_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-appwrite-user-jwt',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

const configs = {
  projects: { order: ['sortOrder'], defaults: { color: '#4caf50', icon: '📁', pinned: false, active: true, kind: 'project', sortOrder: 0, archived: false } },
  categories: { order: ['sortOrder'], defaults: { color: '#4caf50', sortOrder: 0 } },
  members: { order: ['name'], defaults: { role: 'editor', color: '#4caf50' } },
  sections: { order: ['sortOrder'], defaults: { sortOrder: 0 } },
  blockers: { order: ['projectId'], defaults: { weekdays: [], startMinutes: 0, durationMin: 60 } },
  saved_views: { order: ['sortOrder'], defaults: { filtersJson: '{}', sortField: 'manual', sortDir: 'asc', searchQuery: '', sortOrder: 0 } },
  activity_log: { orderDesc: ['at'], defaults: { actor: '', taskTitle: '' } },
};

function stableRowId(value) {
  const id = String(value ?? '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(id)
    ? id
    : crypto.createHash('sha256').update(id).digest('hex').slice(0, 36);
}

function cleanSystemFields(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith('$')) out[key] = value;
  }
  return out;
}

function taskFromRow(row) {
  const data = cleanSystemFields(row);
  return {
    ...data,
    id: data.legacyId,
    comments: JSON.parse(data.commentsJson || '[]'),
    attachments: JSON.parse(data.attachmentsJson || '[]'),
    links: JSON.parse(data.linksJson || '[]'),
  };
}

function taskToRow(task) {
  const now = new Date().toISOString();
  return {
    legacyId: String(task.id),
    number: Number(task.number),
    title: task.title ?? '',
    description: task.description ?? '',
    projectId: task.projectId ?? null,
    parentId: task.parentId ?? null,
    sectionId: task.sectionId ?? null,
    dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
    startMinutes: task.startMinutes ?? null,
    durationMin: task.durationMin ?? null,
    priority: task.priority ?? 'medium',
    completed: Boolean(task.completed),
    starred: Boolean(task.starred),
    someday: Boolean(task.someday),
    thisWeek: Boolean(task.thisWeek),
    waiting: Boolean(task.waiting),
    waitingFor: task.waitingFor ?? null,
    todayDate: task.todayDate ?? null,
    recurrence: task.recurrence ?? 'none',
    recurrenceEnd: task.recurrenceEnd ? new Date(task.recurrenceEnd).toISOString() : null,
    recurInterval: task.recurInterval ?? null,
    recurUnit: task.recurUnit ?? null,
    recurMonthDay: task.recurMonthDay ?? null,
    completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
    createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : now,
    updatedAt: now,
    nozbeId: task.nozbeId ?? null,
    sortOrder: Number(task.sortOrder ?? 0),
    categoryIds: task.categoryIds ?? [],
    assigneeIds: task.assigneeIds ?? [],
    commentsJson: JSON.stringify(task.comments ?? []),
    attachmentsJson: JSON.stringify(task.attachments ?? []),
    linksJson: JSON.stringify(task.links ?? []),
    linkedProjectId: task.linkedProjectId ?? null,
    focusSeconds: Math.max(0, Math.round(Number(task.focusSeconds ?? 0)) || 0),
  };
}

function simpleToRow(resource, input) {
  const cfg = configs[resource];
  const data = { ...cfg.defaults, ...input, legacyId: String(input.id) };
  delete data.id;
  if (resource === 'saved_views') {
    data.filtersJson = JSON.stringify(input.filters ?? JSON.parse(data.filtersJson));
    delete data.filters;
  }
  if (resource === 'activity_log') {
    data.at = new Date(input.at).toISOString();
    data.fromValue = input.from ?? null;
    data.toValue = input.to ?? null;
    data.payloadJson = input.payload ? JSON.stringify(input.payload) : null;
    delete data.from;
    delete data.to;
    delete data.payload;
  }
  return data;
}

function simpleFromRow(resource, row) {
  const data = cleanSystemFields(row);
  const result = { ...data, id: data.legacyId };
  delete result.legacyId;
  if (resource === 'saved_views') {
    result.filters = JSON.parse(data.filtersJson || '{}');
    delete result.filtersJson;
  }
  if (resource === 'activity_log') {
    result.from = data.fromValue ?? null;
    result.to = data.toValue ?? null;
    result.payload = data.payloadJson ? JSON.parse(data.payloadJson) : null;
    delete result.fromValue;
    delete result.toValue;
    delete result.payloadJson;
  }
  return result;
}

async function listAll(db, tableId, order = [], orderDesc = []) {
  const queries = [Query.limit(5000), ...order.map(Query.orderAsc), ...orderDesc.map(Query.orderDesc)];
  return (await db.listRows({ databaseId: DATABASE_ID, tableId, queries, total: false })).rows;
}

// Deletes every row matching `matchQuery` in batches that fit the Appwrite
// Free-plan transaction limit (100 ops), instead of one big transaction that
// throws once a project/task subtree exceeds that limit. Each batch commits
// atomically on its own; a failure mid-run leaves earlier batches deleted
// (documented trade-off — the alternative was refusing the delete outright
// for any project/task with >~99 descendants, which real PROD data exceeds).
const DELETE_BATCH_SIZE = 90;
async function deleteAllRows(db, tableId, matchQuery) {
  for (;;) {
    const page = await db.listRows({ databaseId: DATABASE_ID, tableId, queries: [matchQuery, Query.limit(DELETE_BATCH_SIZE)], total: false });
    if (!page.rows.length) return;
    const transaction = await db.createTransaction({ ttl: 60 });
    try {
      for (const row of page.rows) await db.deleteRow({ databaseId: DATABASE_ID, tableId, rowId: row.$id, transactionId: transaction.$id });
      await db.updateTransaction({ transactionId: transaction.$id, commit: true });
    } catch (e) {
      await db.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
      throw e;
    }
    if (page.rows.length < DELETE_BATCH_SIZE) return;
  }
}

function parseRequestPath(req) {
  const url = new URL(req.url || req.path || '/', 'https://function.local');
  return url.pathname.replace(/\/+$/, '') || '/';
}

function response(res, body, status = 200, headers = {}) {
  return res.json(body, status, { ...JSON_HEADERS, ...headers });
}

function empty(res, status = 204) {
  // res.empty() ignores extra arguments in the Appwrite Node runtime — it
  // always replies with no headers. That silently dropped our CORS headers
  // on every OPTIONS preflight (still 204, but without
  // Access-Control-Allow-Origin/Methods/Headers), which makes a real browser
  // block every actual GET/POST/PATCH/DELETE call to this function once the
  // site and the function live on different domains. res.send() does honor
  // the headers argument, so use that for an empty body instead.
  return res.send('', status, JSON_HEADERS);
}

export default async ({ req, res, error }) => {
  try {
    if (req.method === 'OPTIONS') return empty(res, 204);
    const path = parseRequestPath(req);
    if (path === '/health') return response(res, { ok: true, platform: 'appwrite' });

    // The client calls this function through the Appwrite Functions
    // Execution API (see apiFetch in src/api/client.ts), not via a plain
    // fetch() to this function's own HTTP domain. That distinction matters:
    // Appwrite's edge strips every x-appwrite-* header — including a
    // client-supplied JWT — from requests made directly to a function's
    // domain, and only the Execution API resolves the calling SDK client's
    // JWT into these trusted headers. Confirmed against the live project on
    // 2026-09-16 (see docs/pipeline/appwrite-prod-test-migration.md). A
    // client-scoped Client below is used for every TablesDB call, so an
    // invalid/expired JWT still fails safely on the first real request
    // against Appwrite rather than relying only on this header check.
    const jwt = req.headers['x-appwrite-user-jwt'];
    if (!jwt) return response(res, { error: 'Authentication required' }, 401);

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setJWT(jwt);
    const db = new TablesDB(client);
    // req.bodyJson is a getter that runs JSON.parse() eagerly and THROWS for
    // an empty body — every GET/DELETE call (no body at all) crashed this
    // function with a 500 before it even reached the method/path routing
    // below. req.bodyText is plain text and never throws, so parse that
    // ourselves and treat "no body" as an empty object.
    const bodyText = req.bodyText ?? '';
    let body = {};
    if (bodyText.trim()) {
      try { body = JSON.parse(bodyText); } catch { return response(res, { error: 'Invalid JSON body' }, 400); }
    }

    if (path === '/api/calendar-feed') {
      const baseUrl = (process.env.ICS_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
      const token = process.env.ICS_TOKEN ?? '';
      if (!baseUrl || !token) return response(res, { error: 'ICS feed is not configured' }, 503);
      return response(res, { token, baseUrl, urls: [`${baseUrl}/calendar/${token}.ics`] });
    }

    if (path === '/api/settings') {
      if (req.method === 'GET') {
        const rows = await listAll(db, 'settings');
        return response(res, Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.valueJson)])));
      }
      if (req.method === 'PATCH') {
        for (const [key, value] of Object.entries(body)) {
          await db.upsertRow({ databaseId: DATABASE_ID, tableId: 'settings', rowId: stableRowId(key), data: { key, valueJson: JSON.stringify(value) } });
        }
        const rows = await listAll(db, 'settings');
        return response(res, Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.valueJson)])));
      }
    }

    const match = path.match(/^\/api\/(tasks|projects|categories|members|sections|blockers|saved-views|activity-log)(?:\/([^/]+))?$/);
    if (!match) return response(res, { error: 'Not found' }, 404);
    const routeName = match[1];
    const routeId = match[2] ? decodeURIComponent(match[2]) : null;
    const resource = routeName.replace('-', '_');
    const tableId = resource;
    const isTasks = resource === 'tasks';
    const fromRow = (row) => isTasks ? taskFromRow(row) : simpleFromRow(resource, row);
    const toRow = (value) => isTasks ? taskToRow(value) : simpleToRow(resource, value);

    if (req.method === 'GET' && !routeId) {
      const cfg = isTasks ? { order: ['sortOrder', 'createdAt'] } : configs[resource];
      const rows = await listAll(db, tableId, cfg?.order ?? [], cfg?.orderDesc ?? []);
      return response(res, rows.map(fromRow));
    }

    if (req.method === 'POST' && !routeId) {
      const data = toRow(body);
      const row = await db.upsertRow({ databaseId: DATABASE_ID, tableId, rowId: stableRowId(body.id), data });
      return response(res, fromRow(row), 201);
    }

    if (req.method === 'PATCH' && routeId === 'reorder' && ['tasks', 'projects', 'sections'].includes(resource)) {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      if (ids.length > 100) return response(res, { error: 'Maximum 100 reorder operations' }, 400);
      const transaction = await db.createTransaction({ ttl: 60 });
      try {
        await Promise.all(ids.map((id, index) => db.updateRow({ databaseId: DATABASE_ID, tableId, rowId: stableRowId(id), data: { sortOrder: index }, transactionId: transaction.$id })));
        await db.updateTransaction({ transactionId: transaction.$id, commit: true });
      } catch (e) {
        await db.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
        throw e;
      }
      return empty(res);
    }

    if (req.method === 'PATCH' && routeId) {
      let current;
      try { current = await db.getRow({ databaseId: DATABASE_ID, tableId, rowId: stableRowId(routeId) }); }
      catch { return response(res, { error: 'Not found' }, 404); }
      const merged = { ...fromRow(current), ...body, id: routeId };
      const row = await db.updateRow({ databaseId: DATABASE_ID, tableId, rowId: stableRowId(routeId), data: toRow(merged) });
      return response(res, fromRow(row));
    }

    if (req.method === 'DELETE' && routeId) {
      if (resource === 'tasks') {
        await deleteAllRows(db, 'tasks', Query.equal('parentId', [routeId]));
      }
      if (resource === 'projects') {
        await deleteAllRows(db, 'tasks', Query.equal('projectId', [routeId]));
        await deleteAllRows(db, 'sections', Query.equal('scope', [routeId]));
      }
      const transaction = await db.createTransaction({ ttl: 60 });
      try {
        await db.deleteRow({ databaseId: DATABASE_ID, tableId, rowId: stableRowId(routeId), transactionId: transaction.$id });
        await db.updateTransaction({ transactionId: transaction.$id, commit: true });
      } catch (e) {
        await db.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {});
        throw e;
      }
      return empty(res);
    }

    return response(res, { error: 'Method not allowed' }, 405);
  } catch (e) {
    error(e instanceof Error ? e.stack ?? e.message : String(e));
    const status = Number(e?.code) >= 400 && Number(e?.code) < 600 ? Number(e.code) : 500;
    return response(res, { error: status === 500 ? 'Internal server error' : e.message }, status);
  }
};
