// #56: Version & Umgebung für die Einstellungen. Die Werte werden von Vite
// beim Build/Dev-Start eingebacken (vite.config.ts, define). typeof-Guards,
// damit das Modul auch ohne die Defines lädt (mobile Bundles, tsx-Tests).
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME: string | null =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;

// --- Zuletzt veroeffentlichte Versionen je Plattform (#84) ---------------
// Aus den GitHub-Releases dieses (oeffentlichen) Repos — kein Token noetig.
// Zeigt, ob irgendwo etwas hinterherhaengt; die auf dem HANDY installierte
// Version kann der PC prinzipiell nicht wissen, nur die veroeffentlichte.
const REPO = 'SonGoku2078/SelfManaged';

export interface ReleasedVersions {
  desktop: string | null;
  mobile: string | null;
}

const newestTag = (releases: Array<{ tag_name: string }>, prefix: string): string | null => {
  const parse = (t: string) =>
    t.replace(prefix, '').split('.').map((x) => parseInt(x, 10) || 0);
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return d;
    }
    return 0;
  };
  const matching = releases.filter((r) => r.tag_name.startsWith(prefix));
  if (!matching.length) return null;
  matching.sort((a, b) => cmp(parse(b.tag_name), parse(a.tag_name)));
  return matching[0].tag_name;
};

export async function fetchReleasedVersions(): Promise<ReleasedVersions | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as Array<{ tag_name: string }>;
    return {
      desktop: newestTag(releases, 'desktop-v'),
      mobile: newestTag(releases, 'mobile-v'),
    };
  } catch {
    // Offline oder GitHub nicht erreichbar — die Oberflaeche zeigt dann einen
    // neutralen Platzhalter statt eines Fehlers.
    return null;
  }
}

export interface ApiEnvironment {
  url: string;
  label: string;
  kind: 'prod' | 'dev' | 'custom';
}

// Which environment the app is talking to, derived from the resolved API base
// (getBaseUrl(): '' in production builds = same origin that served the app).
// Port is the project convention: 3001 = Produktion (data.db), 3002 = Dev/Test
// (dev.db); everything else (vite dev, LAN-IP overrides, …) is custom.
export const apiEnvironment = (base: string, origin: string): ApiEnvironment => {
  const url = base || origin;
  let port = '';
  try {
    port = new URL(url).port;
  } catch {
    /* malformed override — keep 'custom' */
  }
  if (port === '3001') return { url, label: 'Produktion', kind: 'prod' };
  if (port === '3002') return { url, label: 'Dev/Test', kind: 'dev' };
  return { url, label: 'Custom', kind: 'custom' };
};
