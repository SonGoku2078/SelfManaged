// Right-click in Proton Mail → "Als Aufgabe zu SelfManaged" (Inbox) or
// "… für Heute ☀️": one click, no popup. The icon badge shows the result.
importScripts('shared.js');

const MENU_INBOX = 'sm-add-inbox';
const MENU_TODAY = 'sm-add-today';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const common = {
      contexts: ['page', 'selection', 'link', 'frame'],
      documentUrlPatterns: ['https://mail.proton.me/*'],
    };
    chrome.contextMenus.create({ ...common, id: MENU_INBOX, title: 'Als Aufgabe zu SelfManaged (Inbox)' });
    chrome.contextMenus.create({ ...common, id: MENU_TODAY, title: 'Als Aufgabe für Heute ☀️' });
  });
});

function badge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_INBOX && info.menuItemId !== MENU_TODAY) return;
  if (!tab || !PROTON_URL.test(tab.url || '')) return;
  badge('…', '#6b7280');
  try {
    const mail = await extractFromTab(tab.id);
    if (!mail) throw new Error('E-Mail konnte nicht gelesen werden.');
    // Right-clicking a marked passage: that passage is the note.
    if (info.selectionText && !mail.selected) mail.selected = info.selectionText;
    const res = await deliverTask({
      title: mail.subject,
      note: buildNote(mail),
      today: info.menuItemId === MENU_TODAY,
    });
    if (res.ok) badge('✓', '#2b8a3e');
    else badge('!', '#b91c1c');
  } catch (e) {
    console.error('SelfManaged: Aufgabe aus Mail fehlgeschlagen', e);
    badge('!', '#b91c1c');
  }
});
