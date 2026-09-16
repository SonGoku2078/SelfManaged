export const APPWRITE_IDS = Object.freeze({
  database: 'selfmanaged-prod',
  bucket: 'task-attachments',
  apiFunction: 'selfmanaged-api',
  icsFunction: 'selfmanaged-ics',
  site: 'selfmanaged-prod',
});

export function readLocalConfig(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return values;
}

