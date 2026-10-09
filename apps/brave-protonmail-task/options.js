const $ = (id) => document.getElementById(id);
const msg = (text, kind) => {
  $('msg').textContent = text;
  $('msg').className = 'msg' + (kind ? ' ' + kind : '');
};

async function render() {
  const who = await signedInAs();
  $('signedIn').hidden = !who;
  $('loginForm').hidden = !!who;
  $('who').textContent = who || '';
  $('serverUrl').value = await getServerUrl();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg('Anmelden…');
  try {
    await signIn($('email').value.trim(), $('password').value);
    $('password').value = '';
    await fetchProjects(); // also proves the session works end to end
    msg('');
    await render();
  } catch (err) {
    const text = String(err.message || err);
    msg(
      /origin|platform/i.test(text)
        ? 'Appwrite kennt diese Erweiterung noch nicht (Plattform fehlt) — siehe README.'
        : `Anmeldung fehlgeschlagen: ${text}`,
      'err'
    );
  }
});

$('logout').addEventListener('click', async () => {
  await signOut();
  msg('Abgemeldet.');
  await render();
});

$('saveServer').addEventListener('click', async () => {
  const url = $('serverUrl').value.trim().replace(/\/+$/, '');
  if (url) {
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return msg('Ungültige Adresse (http:// oder https://)', 'err');
    }
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) return msg('Ohne Zugriff auf diese Seite geht es nicht.', 'err');
  }
  await chrome.storage.sync.set({ serverUrl: url });
  await chrome.storage.local.remove('projects'); // other server → other projects
  msg(url ? `Testserver: ${url}` : 'Produktion.', 'ok');
  await render();
});

render();
