# SelfManaged — Nozbe Clone

A fully-functional, local-first task manager built with React, TypeScript, Vite and Zustand —
a Nozbe-inspired GTD app. Data is stored by a local Express + SQLite backend
(`~/.task-manager/`), with a durable offline write queue in the browser.

## 🌐 Environments & Releases

Two clearly separated environments, each with its **own database** — so testing never touches
your real data. Since #60, **production runs on its own LAN server** (Docker Compose), while
development stays local.

| | **Production** (daily use) | **Development & Test** (local sandbox) |
|---|---|---|
| Runs on | `192.168.8.187` (Docker Compose, `~/server/`; IP per DHCP — bei Wechsel `scripts/deploy.local.json` + MCP-Konfigs anpassen) | this machine |
| Start | managed by Docker (`unless-stopped`) | `npm run dev:server` **and** `npm run dev` (two terminals) |
| Open | http://192.168.8.187:3001 | http://localhost:5173 |
| Database | on the server | `~/.task-manager/dev.db` |
| Marker | — | 🚧 **red "ENTWICKLUNG & TEST" banner** |
| Deploy | `npm run release` (SSH → git pull → compose up --build; config: `scripts/deploy.local.json`, see `.example`) | — |

Check which version runs where: **Einstellungen → „Version & Umgebung"** (#56).

## 🤖 KI-Zugriff per MCP (Sprach-Assistent, #88)

Ein eigener **MCP-Server** (`apps/mcp/`) gibt Claude Desktop / Claude Code Werkzeuge auf den
SelfManaged: Projekte und Tasks lesen, Tagesplan abfragen, Tasks anlegen, bearbeiten (beliebige
Felder), löschen, für einen Tag planen, Fälligkeit setzen, ★ setzen, abhaken (#100: volles
Task-CRUD). **Keine Projekt-/Kategorienverwaltung** — die bleiben weiterhin nur lesbar. Der Server
ist ein dünner Adapter auf die bestehende REST-API und braucht keine Server-Änderung.

Zwei sich **gegenseitig ausschließende** Betriebsarten, je gesetzter Umgebungsvariable (kein
Standardwert; ohne eine von beiden startet der Prozess nicht — Nachtrag 2026-09-26, seit dem
Appwrite-Prod-Cutover #97):

| Umgebung | Variable(n) |
|---|---|
| Dev (Tests, Claude Code via `.mcp.json`) | `TM_API_URL=http://localhost:3002` |
| Prod (Alltag, Claude Desktop/Codex) | `APPWRITE_MCP_EMAIL=…` + `APPWRITE_MCP_PASSWORD=…` |

```bash
npm run build:mcp                 # baut apps/mcp/dist (Teil von npm run build)
npm run mcp:dev                   # startet den Server gegen Dev (stdio; zum Debuggen)
```

**Claude Code:** `.mcp.json` im Repo registriert den Server automatisch gegen Dev (`npm run dev:server` muss laufen).

**Prod braucht ein dediziertes Appwrite-Benutzerkonto:** Seit dem Appwrite-Cutover (#97) läuft
PROD nicht mehr über einen LAN-Server, sondern über die `selfmanaged-api`-Function im Appwrite-
Projekt. Der MCP-/gpt-actions-Prozess meldet sich dafür selbst per E-Mail/Passwort an — **nicht**
mit einem Admin-API-Key, damit kein KI-Tool je einen Admin-Zugriff sieht. Der User legt dieses
Konto **einmalig manuell** an: Appwrite-Konsole → **Auth → Users → Create user** (eigene
E-Mail-Adresse + generiertes Passwort reichen; das Konto braucht keine Sonderrolle, die
Appwrite-Tabellenberechtigungen greifen automatisch für jeden angemeldeten Nutzer). Dieses
Credential wird **nie** von einem KI-Tool erzeugt oder gelesen — es wird ausschließlich vom
User in der jeweiligen Client-Konfiguration (Claude Desktop, Codex) eingetragen.

**Claude Desktop (Prod):** in `%APPDATA%\Claude\claude_desktop_config.json` eintragen (Pfad anpassen):
```json
{
  "mcpServers": {
    "selfmanaged-prod": {
      "command": "node",
      "args": ["C:\\Pfad\\zum\\Repo\\apps\\mcp\\dist\\index.js"],
      "env": {
        "APPWRITE_MCP_EMAIL": "…",
        "APPWRITE_MCP_PASSWORD": "…"
      }
    }
  }
}
```

**Codex CLI (Prod):** in `~/.codex/config.toml` analog eintragen (Pfad anpassen):
```toml
[mcp_servers.selfmanaged-prod]
command = "node"
args = ["/pfad/zum/repo/apps/mcp/dist/index.js"]
env = { APPWRITE_MCP_EMAIL = "…", APPWRITE_MCP_PASSWORD = "…" }
```

Danach Claude Desktop bzw. Codex neu starten. Sprache: Windows-Diktat (Win+H) ins Eingabefeld. Beispiele:
„Was ist mein Plan für heute?", „Welche nächsten Schritte hat Projekt X?", „Leg einen Task … im Projekt … an",
„Lass uns den Plan für morgen definieren".

## 🤖 ChatGPT-Zugriff per Custom GPT Actions (#98)

Ein zweiter, unabhängiger Adapter (`apps/gpt-actions/`) gibt einem **ChatGPT Custom GPT**
denselben eingeschränkten Zugriff wie der MCP-Server oben — per REST/HTTP statt stdio, mit
Bearer-Auth statt lokalem Prozessvertrauen, weil ChatGPT den Server über das Internet erreichen
muss. Tasks können vollständig verwaltet werden (lesen, anlegen, bearbeiten, löschen, planen,
Fälligkeit setzen, sternen, abhaken — #100). **Keine Projekt-/Kategorienverwaltung** — die bleiben
weiterhin nur lesbar. 14 Routen unter `/v1/*`, beschrieben in `apps/gpt-actions/openapi.yaml`
(direkt in eine Custom-GPT-Action importierbar).

### 1. API-Key erzeugen

```bash
openssl rand -hex 32
```

Ergebnis als `GPT_ACTIONS_API_KEY` setzen (Umgebungsvariable auf dem Host, der `apps/gpt-actions`
betreibt, **kein** Hardcoding, **kein** Standardwert — ohne die Variable startet der Prozess
nicht, analog zu den Backend-Variablen unten).

Backend-Anbindung: dieselben zwei sich ausschließenden Betriebsarten wie beim MCP-Server oben
(Nachtrag 2026-09-26, seit dem Appwrite-Prod-Cutover #97):

| Umgebung | Backend-Variable(n) | `GPT_ACTIONS_API_KEY` | `GPT_ACTIONS_PORT` |
|---|---|---|---|
| Dev (Tests, `npm run gpt-actions:dev`) | `TM_API_URL=http://localhost:3002` | Platzhalter im Script | 3003 (Default) |
| Prod (ChatGPT) | `APPWRITE_MCP_EMAIL=…` + `APPWRITE_MCP_PASSWORD=…` | dein per `openssl` erzeugter Key | 3003 (Default) |

Für Prod gilt dasselbe dedizierte Appwrite-Benutzerkonto wie beim MCP-Server (siehe oben,
Abschnitt „Prod braucht ein dediziertes Appwrite-Benutzerkonto") — **ein** einmalig manuell
angelegtes Konto reicht für beide Adapter (MCP + gpt-actions), da beide nur lesen/anlegen/planen/
sternen/abhaken dürfen und dieselben Appwrite-Tabellenberechtigungen greifen.

```bash
npm run build:gpt-actions          # baut apps/gpt-actions/dist (Teil von npm run build)
npm run gpt-actions:dev            # startet den Server gegen Dev (zum Debuggen, Platzhalter-Key)
```

### 2. Cloudflare Tunnel einrichten (Prod, `selfmanaged-prod`)

`apps/gpt-actions` selbst spricht nur HTTP im LAN — ein `cloudflared`-Tunnel macht ihn öffentlich
per HTTPS erreichbar, ohne einen Router-Port zu öffnen (TLS übernimmt Cloudflare). Keine Secrets
im Repo — die Tunnel-Konfiguration bleibt lokal auf dem Prod-Host.

1. `cloudflared` auf `selfmanaged-prod` installieren (siehe Cloudflare-Doku für die Plattform).
2. Bei Cloudflare anmelden: `cloudflared tunnel login`.
3. Named Tunnel anlegen: `cloudflared tunnel create selfmanaged-gpt-actions` (erzeugt eine
   Credentials-Datei, **nicht committen**).
4. Lokale Config anlegen (z. B. `~/.cloudflared/config.yml`, **nicht** im Repo):
   ```yaml
   tunnel: selfmanaged-gpt-actions
   credentials-file: /pfad/zu/<tunnel-id>.json
   ingress:
     - hostname: gpt.deine-domain.example
       service: http://localhost:3003
     - service: http_status:404
   ```
5. DNS-Route setzen: `cloudflared tunnel route dns selfmanaged-gpt-actions gpt.deine-domain.example`.
6. Tunnel + `apps/gpt-actions` als Dienste dauerhaft laufen lassen (z. B. `cloudflared service
   install` bzw. `systemd`/Docker, je nach Setup von `selfmanaged-prod`), mit `TM_API_URL` und
   `GPT_ACTIONS_API_KEY` als Umgebungsvariablen für den Node-Prozess.

### 3. Custom GPT in ChatGPT einrichten

1. ChatGPT → **Create a GPT** → **Configure** → **Actions** → **Create new action**.
2. **Import from URL** oder Inhalt von `apps/gpt-actions/openapi.yaml` einfügen (`servers.url` auf
   deine Tunnel-Domain anpassen, z. B. `https://gpt.deine-domain.example`).
3. **Authentication** → **API Key** → **Auth Type: Bearer** → den in Schritt 1 erzeugten
   `GPT_ACTIONS_API_KEY` eintragen.
4. Speichern, testen: „Was ist mein Plan für heute?", „Leg einen Task … im Projekt … an",
   „Markiere Task #142 als Nächste Aktion" — dieselben Beispiele wie beim MCP-Server, nur über
   ChatGPT statt Claude.

### CI / Releases (GitHub)
- **CI** (`.github/workflows/ci.yml`): every push/PR builds + typechecks the app — a gate that
  catches build-breaking changes before they land.
- **Release** (`.github/workflows/release.yml`): "going to production" = tag a version:
  ```bash
  git tag v0.1.0 && git push origin v0.1.0
  ```
  GitHub then builds the app and publishes a **Release** with auto notes + a runnable bundle.

## ✨ Features

### Tier-1 (Core)
- **Inbox** — default collection of project-less tasks, with quick-add
- **CRUD** — create / edit (all fields, live) / delete tasks
- **Projects** — create, assign, rename, delete (orphans fall back to Inbox), open-task counts
- **Priority List** — your top 5 next steps (starred → high → due date)
- **Task fields** — title, description, due date, priority, project, categories, recurrence, assignee
- **Completed** — checkbox + strikethrough
- **Star / Favorite** — in the list and detail panel
- **Categories / Contexts** — create/delete, multi-assign chips, colored filter pills
- **Calendar** — interactive month grid, navigation, today, task-count dots, click-to-date
- **Recurring tasks** — daily/weekly/monthly auto-spawn on completion + optional end date
- **Filter & sort** — by project/category/priority/status; sort by priority/due/title/created
- **Full-text search** — title + description, real-time
- **Keyboard shortcuts** — `n` new, `/` search, `Esc` close, `Del` delete
- **Responsive UI** — collapses panels on narrow viewports

### Tier-2 (Management)
- **Today view** — due today + overdue
- **Bulk operations** — multi-select with batch complete/star/project/priority/delete
- **Project labels** — group projects in the sidebar
- **Custom views** — save/apply/delete filter+sort presets
- **Project templates** — pre-built project structures (Umzug, Produkt-Launch, …)

### Tier-3 (Collaboration — local)
- **Task comments** — author + timestamp
- **Activity log** — tracks task/project actions (last 200)
- **Reports** — completion metrics + per-project / per-priority charts
- **Team & permissions** — local members with roles + task assignee
- **User settings** — profile name, theme

### Tier-4 (Advanced)
- **Dark mode** — persisted theme
- **Hashtag quick-add** — `#Projekt` and `@Kategorie` tokens
- **Print / PDF export** — print-optimized layout (browser "Save as PDF")
- **Email-to-task** — paste an email → Inbox task (local demo)
- **Attachments** — files via localStorage data-URLs (≤ 400 KB)

> Deferred: native Mobile App (Electron/React Native — separate build target) and
> touch Mobile Gestures (needs touch hardware to verify). See `PM_TASKS.md`.

## 🛠 Tech Stack

- **React 19 + TypeScript**, **Vite 8**
- **Zustand 5** with `persist` middleware (localStorage + Date reviver)
- **date-fns**, custom CSS (no UI library)

## 🚀 Getting Started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint
```

## 📁 Project Structure

```
src/
├── components/
│   ├── Sidebar.tsx          # navigation + projects + saved views
│   ├── CalendarPanel.tsx    # interactive month calendar
│   ├── TaskList.tsx         # task rows (+ bulk selection mode)
│   ├── TaskDetailPanel.tsx  # full task editor (fields, comments, attachments)
│   ├── FilterBar.tsx        # filter + sort + save view
│   ├── CategoryBar.tsx      # category pills (filter + manage)
│   ├── BulkActionBar.tsx    # multi-select actions
│   ├── TemplatesGallery.tsx # project templates
│   ├── ActivityLog.tsx      # activity feed
│   ├── ReportsView.tsx      # metrics dashboard
│   └── SettingsView.tsx     # profile, theme, team, email-to-task
├── store.ts                 # Zustand store (single source of truth)
├── selectors.ts             # filter/sort/search/priority/calendar scoping
├── types.ts                 # TypeScript interfaces
├── templates.ts             # project template definitions
├── quickParse.ts            # #project / @category quick-add parser
├── dummyData.ts             # seed projects/categories/tasks
├── App.tsx                  # shell + view routing + shortcuts
└── *.css                    # styles (incl. dark theme + print)
```

## 🏗 Architecture Notes

- **Single store** (`store.ts`) holds `tasks`, `projects`, `categories`, `savedViews`,
  `activityLog`, `members`, `settings`, and `ui`. Mutating actions are immutable.
- **Persistence**: `persist` middleware serializes the data slices; a custom Date reviver
  restores `Date` objects on load. UI/filter state is intentionally not persisted.
- **Derived data**: views compute from `selectors.ts` — no duplicated state.
- **Pipeline docs**: every feature has an artifact under `docs/pipeline/`.

## 📄 License

MIT
