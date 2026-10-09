// Proton Mail → SelfManaged without the popup:
// - Right-click → "Als Aufgabe zu SelfManaged (Inbox)" / "… für Heute ☀️"
// - Alt+Shift+M → straight into the Inbox
// The icon badge shows the result (✓ / !).
//
// The menu is not limited by documentUrlPatterns: the mail text sits in an
// about:blank iframe, which never matches "https://mail.proton.me/*", so the
// entry was missing exactly where you right-click a mail. Instead the entries
// are shown only while a Proton tab is active. (In the message LIST Proton
// replaces the browser menu with its own — no extension can add to that one.)
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

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);
chrome.tabs.onActivated.addListener(() => void syncMenuVisibility());
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url) void syncMenuVisibility(); });
chrome.windows.onFocusChanged.addListener(() => void syncMenuVisibility());

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

async function addFromTab(tab, { today, selectionText }) {
  if (!tab || !PROTON_URL.test(tab.url || '')) {
    badge('!', '#b91c1c');
    return;
  }
  badge('…', '#6b7280');
  try {
    const mail = await extractFromTab(tab.id);
    if (!mail) throw new Error('E-Mail konnte nicht gelesen werden.');
    // Right-clicking a marked passage: that passage is the note.
    if (selectionText && !mail.selected) mail.selected = selectionText;
    const res = await deliverTask({ title: mail.subject, note: buildNote(mail), today });
    badge(res.ok ? '✓' : '!', res.ok ? '#2b8a3e' : '#b91c1c');
  } catch (e) {
    console.error('SelfManaged: Aufgabe aus Mail fehlgeschlagen', e);
    badge('!', '#b91c1c');
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_INBOX && info.menuItemId !== MENU_TODAY) return;
  void addFromTab(tab, { today: info.menuItemId === MENU_TODAY, selectionText: info.selectionText });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'add-inbox') return;
  const target = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  void addFromTab(target, { today: false });
});
