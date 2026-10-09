const input = document.getElementById('appUrl');
const saved = document.getElementById('saved');

chrome.storage.sync.get('appUrl').then(({ appUrl }) => {
  input.value = appUrl || DEFAULT_APP_URL;
});

document.getElementById('save').addEventListener('click', async () => {
  const appUrl = input.value.trim().replace(/\/+$/, '');
  if (appUrl && !/^https?:\/\/[^/]+/.test(appUrl)) {
    saved.textContent = 'Ungültige Adresse (http:// oder https://)';
    saved.hidden = false;
    return;
  }
  // The extension reads the project list from the app tab → it needs access
  // to that site. PROD and localhost are granted at install; ask for others.
  if (appUrl && appUrl !== DEFAULT_APP_URL) {
    const granted = await chrome.permissions.request({ origins: [`${new URL(appUrl).origin}/*`] });
    if (!granted) {
      saved.textContent = 'Ohne Zugriff auf diese Seite gibt es keine Projektliste.';
      saved.hidden = false;
    }
  }
  await chrome.storage.sync.set({ appUrl: appUrl === DEFAULT_APP_URL ? '' : appUrl });
  await chrome.storage.local.remove('projects'); // other app → other projects
  input.value = appUrl || DEFAULT_APP_URL;
  saved.textContent = 'Gespeichert ✓';
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});
