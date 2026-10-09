// Popup: read the open Proton mail, let the user tweak the task, then hand it
// to SelfManaged (shared.js). Alt+Shift+T opens it.

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const noteEl = $('note');
const todayEl = $('today');
const addBtn = $('add');
const statusEl = $('status');

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function loadEmail() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !PROTON_URL.test(tab.url || '')) {
    setStatus('Bitte eine E-Mail in Proton Mail öffnen.', 'err');
    return;
  }
  try {
    const mail = await extractFromTab(tab.id);
    if (!mail) {
      setStatus('E-Mail konnte nicht gelesen werden.', 'err');
      return;
    }
    titleEl.value = mail.subject;
    noteEl.value = buildNote(mail);
    addBtn.disabled = false;
    titleEl.focus();
    titleEl.select();
  } catch (e) {
    setStatus('Zugriff auf die Seite fehlgeschlagen: ' + e.message, 'err');
  }
}

async function add() {
  const title = titleEl.value.trim();
  if (!title) {
    setStatus('Titel darf nicht leer sein.', 'err');
    return;
  }
  addBtn.disabled = true;
  setStatus('Wird an SelfManaged übergeben…');
  const res = await deliverTask({ title, note: noteEl.value.trim(), today: todayEl.checked });
  if (res.ok) {
    setStatus(todayEl.checked ? '✓ In SelfManaged für Heute angelegt' : '✓ In der SelfManaged-Inbox angelegt', 'ok');
    setTimeout(() => window.close(), 1200);
  } else {
    setStatus(res.error, 'err');
  }
}

addBtn.addEventListener('click', add);
// Enter in the title = add (Ctrl+Enter anywhere).
titleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !addBtn.disabled) add();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !addBtn.disabled) add();
});

$('opts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadEmail();
