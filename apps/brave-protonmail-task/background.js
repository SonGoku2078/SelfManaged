// Does the actual sending, so the popup can close at once ("übergeben,
// vergessen"). Entry points:
// - popup → message { type: 'deliver', job }
// - right-click → "Als Aufgabe zu SelfManaged (Inbox)" / "… für Heute ☀️"
// - Alt+Shift+M → Inbox
// Ticked list mails become one task each. The icon badge shows … / ✓; only a
// failure speaks up (badge ! + a notification saying what to do).
//
// The menu is not limited by documentUrlPatterns: the mail text sits in an
// about:blank iframe that never matches "https://mail.proton.me/*". Entries
// are shown only while a Proton tab is active instead. (In the message LIST
// Proton replaces the browser menu with its own — use Alt+Shift+M there.)
importScripts('shared.js');

const MENU_INBOX = 'sm-add-inbox';
const MENU_TODAY = 'sm-add-today';

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    const common = { contexts: ['page', 'selection', 'link', 'frame', 'image'], visible: false };
    chrome.contextMenus.create({ ...common, id: MENU_INBOX, title: 'Als Aufgabe zu SelfManaged (Inbox)' });
    chrome.contextMenus.create({ ...common, id: MENU_TODAY, title: 'Als Aufgabe für Heute ☀️' });
    void syncMenuVisibility();
  });
}

async function syncMenuVisibility() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const visible = !!tab && PROTON_URL.test(tab.url || '');
  for (const id of [MENU_INBOX, MENU_TODAY]) {
    chrome.contextMenus.update(id, { visible }, () => void chrome.runtime.lastError);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  createMenus();
  // First install: sign in once.
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(createMenus);
chrome.tabs.onActivated.addListener(() => void syncMenuVisibility());
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url) void syncMenuVisibility(); });
chrome.windows.onFocusChanged.addListener(() => void syncMenuVisibility());

// Several jobs may overlap (send, send, send): count them for the badge.
let running = 0;
let badgeTimer = null;
function badge(text, color, clearAfterMs) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  if (clearAfterMs) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: '' }), clearAfterMs);
}

function fail(message) {
  badge('!', '#b91c1c', 15000);
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'SelfManaged – nicht übergeben',
    message,
  });
}

async function send(job) {
  if (!job.tasks.length) return fail('Keine Mail offen oder angehakt.');
  running++;
  badge(running > 1 ? String(running) : '…', '#6b7280');
  try {
    await deliverTask(job);
    if (--running === 0) badge('✓', '#2b8a3e', 3000);
  } catch (e) {
    running--;
    console.error('SelfManaged: Übergabe fehlgeschlagen', e);
    if (e instanceof NotSignedIn) {
      fail('Bitte einmal in den Optionen der Erweiterung anmelden — dann nochmals senden.');
      chrome.runtime.openOptionsPage();
    } else {
      fail(`${e.message || e} — die Mail(s) bitte nochmals senden.`);
    }
  }
}

async function sendFromTab(tab, { today, selectionText }) {
  if (!tab || !PROTON_URL.test(tab.url || '')) return fail('Bitte in Proton Mail verwenden.');
  let mail;
  try {
    mail = await extractFromTab(tab.id);
  } catch (e) {
    return fail(`Proton-Seite nicht lesbar: ${e.message || e}`);
  }
  if (!mail) return fail('E-Mail konnte nicht gelesen werden.');
  // No project here: GTD — everything lands in the Inbox first.
  await send({ tasks: tasksFromMail(mail, selectionText), today, projectId: null });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'deliver') {
    void send(msg.job);
    reply({ queued: true }); // popup closes right away
  } else if (msg && msg.type === 'refreshProjects') {
    fetchProjects().then((p) => reply({ projects: p }), () => reply({ projects: null }));
    return true; // async reply
  }
  return false;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_INBOX && info.menuItemId !== MENU_TODAY) return;
  void sendFromTab(tab, { today: info.menuItemId === MENU_TODAY, selectionText: info.selectionText });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'add-inbox') return;
  const target = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  void sendFromTab(target, { today: false });
});
