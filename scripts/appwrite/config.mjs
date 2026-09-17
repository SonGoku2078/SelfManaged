export const APPWRITE_IDS = Object.freeze({
  database: 'selfmanaged-prod',
  bucket: 'task-attachments',
  apiFunction: 'selfmanaged-api',
  icsFunction: 'selfmanaged-ics',
  site: 'selfmanaged-prod',
  // Alle Tabellen-/Bucket-Berechtigungen haengen an diesem Team, NICHT an
  // Role.users() — jeder, der sich irgendwie ein Appwrite-Konto anlegt (die
  // Console kennt keinen reinen "Login ohne Registrierung"-Schalter fuer
  // Email/Password), soll ohne Team-Mitgliedschaft null Zugriff auf echte
  // Daten haben. Weitere Personen einladen = Team-Mitgliedschaft vergeben.
  team: 'selfmanaged-team',
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

