// Popup: one open mail → one task (title/note editable), or several mails
// ticked in the list → one task each. Project defaults to the Inbox (GTD:
// everything lands there first; planning moves it later). Alt+Shift+T opens it.
// "Anlegen" hands the job to background.js and closes immediately.

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const noteEl = $('note');
const projectEl = $('project');
const todayEl = $('today');
const addBtn = $('add');
const statusEl = $('status');

// null until a mail was read; then { mode: 'single' } or { mode: 'batch', items }.
let job = null;

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// Inbox first (selected), then active projects (pinned on top), areas, Someday.
function fillProjects(projects) {
  const keep = projectEl.value;
  projectEl.length = 1; // the Inbox option
  const groups = [
    ['Aktive Projekte', projects.filter((p) => p.kind !== 'area' && p.active === true)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))],
    ['Bereiche', projects.filter((p) => p.kind === 'area')],
    ['Someday', projects.filter((p) => p.kind !== 'area' && p.active !== true)],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    const og = document.createElement('optgroup');
    og.label = label;
    for (const p of list) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      og.appendChild(o);
    }
    projectEl.appendChild(og);
  }
  projectEl.value = keep;
  if (projectEl.value !== keep) projectEl.value = '';
}

async function loadProjects() {
  fillProjects(await cachedProjects());
  const res = await chrome.runtime.sendMessage({ type: 'refreshProjects' });
  if (res && res.projects) fillProjects(res.projects);
}

function showBatch(items) {
  job = { mode: 'batch', items };
  $('single').hidden = true;
  $('batch').hidden = false;
  $('heading').textContent = `${items.length} Mails als Aufgaben`;
  const list = $('batchList');
  list.textContent = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = it.subject;
    li.title = it.sender ? `${it.subject} — ${it.sender}` : it.subject;
    list.appendChild(li);
  }
  addBtn.textContent = `${items.length} Aufgaben anlegen`;
  addBtn.disabled = false;
  addBtn.focus();
}

async function loadEmail() {
  if (!(await signedInAs())) {
    setStatus('Einmal anmelden: Optionen öffnen (Link unten).', 'err');
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !PROTON_URL.test(tab.url || '')) {
    setStatus('Bitte Proton Mail öffnen.', 'err');
    return;
  }
  try {
    const mail = await extractFromTab(tab.id);
    if (!mail) {
      setStatus('E-Mail konnte nicht gelesen werden.', 'err');
      return;
    }
    // Several ticked → batch. One ticked and nothing open → batch of one.
    if (mail.checked.length > 1 || (mail.checked.length === 1 && !mail.hasOpenMail)) {
      showBatch(mail.checked);
      return;
    }
    if (!mail.hasOpenMail) {
      setStatus('Mail öffnen oder in der Liste Mails anhaken.', 'err');
      return;
    }
    job = { mode: 'single' };
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
  if (!job || addBtn.disabled) return;
  let tasks;
  if (job.mode === 'batch') {
    tasks = job.items.map((it) => ({ title: it.subject, note: buildListNote(it) }));
  } else {
    const title = titleEl.value.trim();
    if (!title) {
      setStatus('Titel darf nicht leer sein.', 'err');
      return;
    }
    tasks = [{ title, note: noteEl.value.trim() }];
  }
  // Hand over and close at once — the background sends it (badge ✓, or a
  // notification if something went wrong).
  addBtn.disabled = true;
  await chrome.runtime.sendMessage({
    type: 'deliver',
    job: { tasks, today: todayEl.checked, projectId: projectEl.value || null },
  });
  window.close();
}

addBtn.addEventListener('click', add);
// Enter in the title = add; Ctrl+Enter anywhere.
titleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') add();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add();
});

$('opts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadEmail();
loadProjects();
