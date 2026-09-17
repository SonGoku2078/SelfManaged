import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// #56/#84: Version + Build-Zeit ins Bundle backen.
//
// Reihenfolge (erste Quelle gewinnt):
//   1. VITE_APP_VERSION  — CI-Builds (Mobile-APK setzt das so)
//   2. .version-Datei    — vom Deploy-Skript in den Checkout geschrieben.
//      Notwendig, weil der Prod-Build IM DOCKER-CONTAINER laeuft, wo kein
//      Git-Repo liegt — dort lieferte git describe frueher 'unbekannt' (#84).
//   3. git describe      — lokale Builds
//   4. 'unbekannt'
//
// --match "v*": Nur Projekt-Tags zaehlen. Sonst schnappt sich describe den
// neuesten Tag ueberhaupt — zuletzt "desktop-v1.3.0-4-g...", was aussieht, als
// liefe die Desktop-Version im Browser (#84).
const versionFromFile = (): string | null => {
  try {
    const v = readFileSync('.version', 'utf8').trim()
    return v || null
  } catch {
    return null
  }
}

const gitVersion = (): string => {
  try {
    return execSync('git describe --tags --match "v*" --always --dirty', { encoding: 'utf8' }).trim()
  } catch {
    return 'unbekannt'
  }
}

const APP_VERSION = process.env.VITE_APP_VERSION ?? versionFromFile() ?? gitVersion()

// Die ausgelieferte Version zusaetzlich als Meta-Tag in die index.html — so
// laesst sie sich ohne JavaScript-Ausfuehrung abfragen (das Deploy-Skript
// prueft damit, was WIRKLICH live ist, statt nur was gebaut wurde).
const versionMetaPlugin = () => ({
  name: 'app-version-meta',
  transformIndexHtml: (html: string) =>
    html.replace('</head>', `  <meta name="app-version" content="${APP_VERSION}" />\n  </head>`),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionMetaPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // Output into server/public so the Express server can serve the SPA.
    outDir: 'server/public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Dev/Test backend runs on 3002 (separate dev.db). See .env.development.
      // Ueberschreibbar via VITE_DEV_API_PORT — noetig, um eine zweite lokale
      // Instanz (z.B. Testserver-Checkout unter C:\dev) parallel ohne
      // Port-Kollision laufen zu lassen (Muster wie im portfolio-app-Repo).
      '/api': { target: `http://localhost:${process.env.VITE_DEV_API_PORT || 3002}`, changeOrigin: true },
      '/health': { target: `http://localhost:${process.env.VITE_DEV_API_PORT || 3002}`, changeOrigin: true },
      '/nozbe-api': {
        target: 'https://api.nozbe.com:3000',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/nozbe-api/, ''),
      },
    },
  },
})
