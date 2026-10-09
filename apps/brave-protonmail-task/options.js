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
  await chrome.storage.sync.set({ appUrl: appUrl === DEFAULT_APP_URL ? '' : appUrl });
  input.value = appUrl || DEFAULT_APP_URL;
  saved.textContent = 'Gespeichert ✓';
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});
