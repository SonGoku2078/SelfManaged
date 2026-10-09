// Shared by popup.js and background.js (importScripts): read the open mail,
// build the task, hand it to the SelfManaged web app.
//
// Delivery goes through the app itself — the "#/add?…" deep link — so the
// task is saved by the signed-in app with its normal sync queue. The
// extension never holds a password or token, and Appwrite's origin check
// (only the app's own site may call the API) stays intact.

const DEFAULT_APP_URL = 'https://selfmanaged-prod-6aaa45fb.appwrite.network';
const PROTON_URL = /^https:\/\/mail\.proton\.me\//;
// Fresh tab: page load + sign-in check + first render can take a while.
const RECEIVE_TIMEOUT_MS = 20000;

async function getAppUrl() {
  const { appUrl } = await chrome.storage.sync.get('appUrl');
  return (appUrl || DEFAULT_APP_URL).trim().replace(/\/+$/, '');
}

async function extractFromTab(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
  return (res && res.result) || null;
}

// Note: sender + link back to the mail, then the marked text or the mail body.
function buildNote(mail) {
  const head = [];
  if (mail.sender) head.push(`**Von:** ${mail.sender}`);
  if (mail.url) head.push(`**Mail:** ${mail.url}`);
  const text = mail.selected || mail.body;
  return [head.join('  \n'), text].filter(Boolean).join('\n\n');
}

// Batch item from a ticked list entry: no body, just who + link.
function buildListNote(item) {
  const head = [];
  if (item.sender) head.push(`**Von:** ${item.sender}`);
  head.push(`**Mail:** ${item.url}`);
  return head.join('  \n');
}

// One or more tasks, all into the same project (null = Inbox, GTD default).
function addHash({ tasks, today, projectId }) {
  const q = new URLSearchParams();
  if (tasks.length === 1) {
    q.set('title', tasks[0].title);
    if (tasks[0].note) q.set('note', tasks[0].note);
  } else {
    q.set('tasks', JSON.stringify(tasks.map((t) => ({ title: t.title, note: t.note || undefined }))));
  }
  if (projectId) q.set('project', projectId);
  if (today) q.set('heute', '1');
  return `#/add?${q.toString()}`;
}

// Main app tab of this app (not an extra "?fenster=" window), if one is open.
async function findAppTab(appUrl) {
  const tabs = await chrome.tabs.query({ url: `${appUrl}/*` });
  return tabs.find((t) => !/[?&]fenster=/.test(t.url || '')) || null;
}

// The app clears the hash right after it created the task.
async function waitForReceipt(tabId) {
  const until = Date.now() + RECEIVE_TIMEOUT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false; // tab closed
    }
    if (tab.status === 'complete' && !(tab.url || '').includes('#/add?')) return true;
  }
  return false;
}

async function waitLoaded(tabId) {
  const until = Date.now() + RECEIVE_TIMEOUT_MS;
  while (Date.now() < until) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

// Projects of the signed-in app, read from its offline cache (tm-cache) in the
// app tab — no API access needed. Cached in the extension for an instant list.
// Returns null when the app has no data yet (signed out / first start).
async function fetchProjects() {
  const appUrl = await getAppUrl();
  let tab = await findAppTab(appUrl);
  if (!tab) tab = await chrome.tabs.create({ url: `${appUrl}/`, active: false });
  await waitLoaded(tab.id);
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      try {
        const snap = JSON.parse(localStorage.getItem('tm-cache') || 'null');
        if (!snap || !Array.isArray(snap.projects)) return null;
        return snap.projects
          .filter((p) => p && !p.archived)
          .map((p) => ({ id: p.id, name: p.name, kind: p.kind, active: p.active, pinned: !!p.pinned }));
      } catch {
        return null;
      }
    },
  });
  const projects = res && res.result;
  if (projects) await chrome.storage.local.set({ projects });
  return projects;
}

async function cachedProjects() {
  const { projects } = await chrome.storage.local.get('projects');
  return Array.isArray(projects) ? projects : [];
}

// Returns { ok: true } or { ok: false, error }. Never steals focus on success;
// on failure the app tab is brought up (usually: sign-in needed).
// job = { tasks: [{ title, note }], today, projectId }
async function deliverTask(job) {
  const appUrl = await getAppUrl();
  const hash = addHash(job);
  let tab = await findAppTab(appUrl);
  if (tab) {
    const base = (tab.url || appUrl).split('#')[0];
    // Same document, new hash → the app's hashchange handler takes it.
    tab = await chrome.tabs.update(tab.id, { url: base + hash });
  } else {
    tab = await chrome.tabs.create({ url: `${appUrl}/${hash}`, active: false });
  }
  if (await waitForReceipt(tab.id)) return { ok: true };
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    /* tab gone */
  }
  // The link stays in that tab: once signed in, the app still creates the
  // task — so no "try again" (that would add it twice).
  return {
    ok: false,
    error: 'SelfManaged ist noch nicht bereit — bitte im geöffneten Tab anmelden, die Aufgabe wird danach angelegt.',
  };
}
