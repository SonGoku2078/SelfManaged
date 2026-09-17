// In-app update check: compares the baked app version against the latest
// `mobile-v*` GitHub Release and (when newer) points the user at the APK.
const REPO = 'SonGoku2078/SelfManaged';
const TAG_PREFIX = 'mobile-v';

// Baked at build time as e.g. 'mobile-v0.2.0' → normalize to bare '0.2.0'.
export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.replace(/^mobile-v?/, '') ?? 'dev';

function parseVer(tag: string): number[] {
  return tag.replace(/^mobile-v/, '').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
}
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface UpdateInfo {
  available: boolean;
  latest: string; // e.g. 'mobile-v0.2.0'
  apkUrl: string | null;
  current: string;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const releases = (await res.json()) as Array<{
      tag_name: string;
      assets: Array<{ name: string; browser_download_url: string }>;
    }>;
    const mobile = releases.filter((r) => r.tag_name.startsWith(TAG_PREFIX));
    if (!mobile.length) return null;
    mobile.sort((a, b) => cmp(parseVer(b.tag_name), parseVer(a.tag_name)));
    const latest = mobile[0];
    const apk = latest.assets.find((a) => a.name.endsWith('.apk'));
    const available = APP_VERSION !== 'dev' && cmp(parseVer(latest.tag_name), parseVer(APP_VERSION)) > 0;
    return { available, latest: latest.tag_name, apkUrl: apk?.browser_download_url ?? null, current: APP_VERSION };
  } catch {
    return null;
  }
}

// Open the APK download URL externally so Android's installer takes over.
export function openApk(url: string): void {
  window.open(url, '_system');
}
