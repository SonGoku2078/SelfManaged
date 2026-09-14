# Task Manager — Nozbe Clone

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
Task Manager: Projekte und Tasks lesen, Tagesplan abfragen, Tasks anlegen, für einen Tag planen,
Fälligkeit setzen, ★ setzen, abhaken. **Kein Löschen, keine Projektverwaltung.** Der Server ist ein
dünner Adapter auf die bestehende REST-API und braucht keine Server-Änderung.

Die Ziel-Adresse kommt **ausschließlich** aus `TM_API_URL` (kein Standardwert; ohne Variable startet
der Prozess nicht):

| Umgebung | `TM_API_URL` |
|---|---|
| Dev (Tests, Claude Code via `.mcp.json`) | `http://localhost:3002` |
| Prod (Alltag, Claude Desktop) | `http://192.168.8.187:3001` |

```bash
npm run build:mcp                 # baut apps/mcp/dist (Teil von npm run build)
npm run mcp:dev                   # startet den Server gegen Dev (stdio; zum Debuggen)
```

**Claude Code:** `.mcp.json` im Repo registriert den Server automatisch gegen Dev (`npm run dev:server` muss laufen).

**Claude Desktop (Prod):** in `%APPDATA%\Claude\claude_desktop_config.json` eintragen (Pfad anpassen):
```json
{
  "mcpServers": {
    "task-manager": {
      "command": "node",
      "args": ["C:\\Pfad\\zum\\Repo\\apps\\mcp\\dist\\index.js"],
      "env": { "TM_API_URL": "http://192.168.8.187:3001" }
    }
  }
}
```
Danach Claude Desktop neu starten. Sprache: Windows-Diktat (Win+H) ins Eingabefeld. Beispiele:
„Was ist mein Plan für heute?", „Welche nächsten Schritte hat Projekt X?", „Leg einen Task … im Projekt … an",
„Lass uns den Plan für morgen definieren".

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
