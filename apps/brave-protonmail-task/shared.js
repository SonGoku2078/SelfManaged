// Shared by popup.js, options.js and background.js (importScripts): read the
// open mail, build the tasks, send them straight to the SelfManaged server.
//
// Online, no app tab: the extension signs in once (options page) as your
// SelfManaged user and calls the same API function the app uses, through the
// Appwrite Functions Execution API (like apps/mcp/src/appwriteApi.ts). Only
// the session is kept — never the password. Appwrite accepts this origin
// because the extension (fixed ID via manifest "key") is registered as a Web
// platform with hostname = extension ID.
//
// Test/LAN mode: with a server URL set in the options (e.g. the dev app
// http://127.0.0.1:5173) the same /api/* routes are called directly.

const APPWRITE_ENDPOINT = 'https://fra.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '6aaa45fb0024f97b2b00';
const APPWRITE_FUNCTION_ID = 'selfmanaged-api';
const PROTON_URL = /^https:\/\/mail\.proton\.me\//;
const SELF_MEMBER_ID = 'u-me';

class NotSignedIn extends Error {}

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  return (serverUrl || '').trim().replace(/\/+$/, '');
}

// ── Appwrite session (X-Fallback-Cookies, stored in chrome.storage.local) ──
async function appwriteFetch(path, init = {}) {
  const { session } = await chrome.storage.local.get('session');
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    ...init,
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': APPWRITE_PROJECT_ID,
      ...(session ? { 'X-Fallback-Cookies': session } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.status === 401) throw new NotSignedIn((data && data.message) || 'Nicht angemeldet');
  if (!res.ok) throw new Error((data && data.message) || `Appwrite ${res.status}`);
  return { data, res };
}

async function signIn(email, password) {
  await chrome.storage.local.remove('session');
  const { data, res } = await appwriteFetch('/account/sessions/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const fallback = res.headers.get('X-Fallback-Cookies');
  if (!fallback) throw new Error('Appwrite lieferte keine Sitzung zurück.');
  await chrome.storage.local.set({ session: fallback, account: data && data.providerUid ? data.providerUid : email });
}

async function signOut() {
  try { await appwriteFetch('/account/sessions/current', { method: 'DELETE' }); } catch { /* already gone */ }
  await chrome.storage.local.remove(['session', 'account', 'projects']);
}

async function signedInAs() {
  if (await getServerUrl()) return 'Testserver';
  const { session, account } = await chrome.storage.local.get(['session', 'account']);
  return session ? account || 'angemeldet' : null;
}

// One /api/* call, PROD via the Execution API, test server directly.
async function api(path, method = 'GET', body) {
  const server = await getServerUrl();
  if (server) {
    const res = await fetch(`${server}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  const { session } = await chrome.storage.local.get('session');
  if (!session) throw new NotSignedIn('Nicht angemeldet');
  const { data } = await appwriteFetch(`/functions/${APPWRITE_FUNCTION_ID}/executions`, {
    method: 'POST',
    body: JSON.stringify({
      body: body === undefined ? '' : JSON.stringify(body),
      async: false,
      path,
      method,
    }),
  });
  if (data.responseStatusCode === 401) throw new NotSignedIn('Sitzung abgelaufen');
  if (data.responseStatusCode >= 400) throw new Error(`API ${path}: ${data.responseStatusCode}`);
  return data.responseBody ? JSON.parse(data.responseBody) : null;
}

// ── Mail → task text ──────────────────────────────────────────────────────
async function extractFromTab(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
  return (res && res.result) || null;
}

// Note: link back to the mail first, then sender, then the mail itself
// (Markdown from extract.js) — or only the marked passage.
function buildNote(mail) {
  const head = [];
  if (mail.url) head.push(`**Mail:** ${mail.url}`);
  if (mail.sender) head.push(`**Von:** ${mail.sender}`);
  const text = mail.selected || mail.body;
  return [head.join('  \n'), text].filter(Boolean).join('\n\n---\n\n');
}

// Ticked list entries: what the list shows, used if a mail can't be opened.
function listMail(item) {
  return { subject: item.subject, sender: item.sender, url: item.url, body: '', selected: '' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read ticked mails one by one in a minimized background window: Proton
// decrypts a mail only when it is opened. The user's own tab is untouched.
// Returns one mail object per item (falls back to the list data).
async function readMails(items, onProgress) {
  const OPEN_TIMEOUT_MS = 25000;
  const win = await chrome.windows.create({ url: items[0].url, state: 'minimized', focused: false });
  const tabId = win.tabs[0].id;
  const mails = [];
  try {
    for (let i = 0; i < items.length; i++) {
      if (onProgress) onProgress(i, items.length);
      if (i > 0) await chrome.tabs.update(tabId, { url: items[i].url });
      let mail = null;
      const until = Date.now() + OPEN_TIMEOUT_MS;
      while (Date.now() < until) {
        await sleep(700);
        try {
          const m = await extractFromTab(tabId);
          // Same mail, decrypted: body present (or the page settled without one).
          if (m && m.hasOpenMail && m.bodyReady) { mail = m; break; }
          if (m && m.hasOpenMail) mail = m;
        } catch {
          /* page still loading */
        }
      }
      mails.push(
        mail
          ? { ...mail, subject: mail.subject || items[i].subject, sender: mail.sender || items[i].sender, url: items[i].url, selected: '' }
          : listMail(items[i]),
      );
    }
  } finally {
    chrome.windows.remove(win.id).catch(() => {});
  }
  return mails;
}

// What to send: { tasks } for the open mail, { items } for ticked list
// entries (read later, in the background — see resolveTasks).
function jobFromMail(mail, selectionText) {
  if (mail.checked.length > 1 || (mail.checked.length === 1 && !mail.hasOpenMail)) {
    return { items: mail.checked };
  }
  if (!mail.hasOpenMail) return { tasks: [] };
  if (selectionText && !mail.selected) mail.selected = selectionText;
  return { tasks: [{ title: mail.subject, note: buildNote(mail) }] };
}

async function resolveTasks(job, onProgress) {
  if (!job.items) return job.tasks;
  const mails = await readMails(job.items, onProgress);
  return mails.map((m) => ({ title: m.subject, note: buildNote(m) }));
}

// ── Create on the server ──────────────────────────────────────────────────
const localDateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Same shape as addTask in src/store.ts. Inbox = projectId null (GTD).
function newTask({ title, note }, number, { projectId, today }, now) {
  const iso = now.toISOString();
  const todayDate = today ? localDateKey(now) : null;
  return {
    id: `task-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    number,
    title,
    description: note || '',
    projectId: projectId || null,
    parentId: null,
    sectionId: null,
    dueDate: null,
    startMinutes: null,
    durationMin: null,
    priority: 'medium',
    categoryIds: [],
    completed: false,
    starred: !!todayDate, // Heute implies Next Action (app invariant)
    someday: false,
    thisWeek: false,
    todayDate,
    assigneeIds: [SELF_MEMBER_ID],
    recurrence: 'none',
    recurrenceEnd: null,
    linkedProjectId: null,
    sortOrder: 0,
    createdAt: iso,
    updatedAt: iso,
  };
}

// job = { tasks: [{ title, note }], today, projectId }. Numbers continue after
// the highest existing one (the stored counter is unreliable). The app shows
// the tasks on its next sync (window focus / within a minute).
async function deliverTask(job) {
  const existing = await api('/api/tasks');
  let next = 1 + existing.reduce((m, t) => (typeof t.number === 'number' && t.number > m ? t.number : m), 0);
  const now = new Date();
  for (const t of job.tasks) await api('/api/tasks', 'POST', newTask(t, next++, job, now));
  try { await api('/api/settings', 'PATCH', { nextTaskNumber: next }); } catch { /* counter is advisory */ }
  return job.tasks.length;
}

// Projects for the popup list, cached for an instant display.
async function fetchProjects() {
  const projects = (await api('/api/projects'))
    .filter((p) => p && !p.archived)
    .map((p) => ({ id: p.id, name: p.name, kind: p.kind, active: p.active, pinned: !!p.pinned }));
  await chrome.storage.local.set({ projects });
  return projects;
}

async function cachedProjects() {
  const { projects } = await chrome.storage.local.get('projects');
  return Array.isArray(projects) ? projects : [];
}
