# PM_TASKS — SelfManaged (Nozbe Clone)

**Projekt:** SelfManaged (Nozbe Clone, HTML MVP)  
**Repository:** https://github.com/SonGoku2078/SelfManaged  
**Status:** ✅ Tier-1 Core Features COMPLETE (14/14) — MVP funktionsfähig  
**Last Updated:** 2026-09-15

---

## 📥 Inbox (Ungefiltert)

Alle neuen Feature-Ideen, Requests, Bugs — unpriorisiert.

- [x] **User Settings / Preferences** — Save user theme, language, defaults
- [x] **Attachments on Tasks** — Add files/images to tasks (localStorage, ≤400 KB)
- [x] **Task Comments** — Add discussion/comments on tasks
- [x] **Email Integration** — Forward emails as tasks (lokaler Stub)
- [x] **Advanced Reporting** — Task statistics, completion rate (Berichte-Ansicht)
- [ ] **Mobile Gestures** — Swipe to delete, long-press menus (Touch Devices) — *zurückgestellt: braucht Touch-Hardware zum Verifizieren*

---

## 🎯 Backlog (Priorisiert)

Triagiert, gruppiert nach Tier.

### TIER-1-CORE (Essentiell für MVP)

**HIGH Priority:**
- [x] **[TIER-1] Inbox** — Central task collection point, default view
- [x] **[TIER-1] Create/Edit/Delete Tasks** — CRUD for Tasks with all fields
- [x] **[TIER-1] Projects Management** — Create/organize tasks in projects
- [x] **[TIER-1] Priority List** — Top 5 "Next Steps" for today
- [x] **[TIER-1] Task Fields** — Title, Description, DueDate, Priority, Category, Recurring
- [x] **[TIER-1] Completed Status** — Checkbox with strikethrough
- [x] **[TIER-1] Star/Favorite** — Mark important tasks
- [x] **[TIER-1] Categories/Contexts** — Tagging system (GTD contexts)
- [x] **[TIER-1] Calendar View** — Date-based task visualization
- [x] **[TIER-1] Recurring Tasks** — Daily/Weekly/Monthly automation
- [x] **[TIER-1] Filter & Sort** — By project, category, priority, date
- [x] **[TIER-1] Full-Text Search** — Find tasks by title/description

**MEDIUM Priority:**
- [x] **[TIER-1] Keyboard Shortcuts** — Basic navigation (Enter, Escape, Tab)
- [x] **[TIER-1] Nozbe-Exact UI** — Design 1:1 match with official Nozbe

### TIER-2-MANAGEMENT (Important, Post-MVP)

- [x] **[TIER-2] Project Templates** — Pre-built project structures
- [x] **[TIER-2] Project Labels** — Organize projects by tags
- [x] **[TIER-2] Bulk Operations** — Multi-select tasks for actions
- [x] **[TIER-2] Today View** — Special view for today's tasks
- [x] **[TIER-2] Custom Views** — User-defined filters/saved searches

### TIER-3-COLLABORATION (Team Features, Later)

- [x] **[TIER-3] Team Sharing** — Invite users, share projects (lokal/Stub)
- [x] **[TIER-3] Permissions** — Read/Write/Admin controls (Rollen, lokal)
- [x] **[TIER-3] Comments** — Discuss tasks with team (lokal/Single-User)
- [x] **[TIER-3] Activity Log** — Who changed what, when
- [x] **[TIER-3] Team Reports** — Completion tracking, productivity metrics

### TIER-4-ADVANCED (Polish, Low Priority)

- [x] **[TIER-4] Email Tasks** — Forward emails to task inbox (lokaler Stub)
- [x] **[TIER-4] Hashtag Quick-Add** — #project @category syntax
- [x] **[TIER-4] Print/PDF Export** — Export tasks as documents
- [x] **[TIER-4] Dark Mode** — Night theme
- [ ] **[TIER-4] Mobile App** — Electron/React Native version — *zurückgestellt: separater Build-Target/Epic, kein HTML-MVP-Scope*
- [x] **[TIER-4] HIGH — App-Logo & Icons** — Eigenes Branding (Haken auf Grün) für Browser-Tab, Android-Launcher/Themed/Splash, Electron. Design final vom User bestätigt → direkt in Req-Eng.

---

## 🔄 In Bearbeitung (Requirements Engineering)

Features gebrieft, beim Requirements Engineer in Arbeit.

| ID | Feature | Status | Issue | Owner |
|----|---------|---------| -----|-------|
| — | Alle Tier-1-Features abgeschlossen | done | docs/pipeline/* | — |
| #88 | **MCP-Server: Sprach-Assistent (Claude Desktop/Code)** — lesen/planen/anlegen/abhaken, kein Löschen (#89 Handy: nicht geplant, geschlossen) | done (PR #91 gemergt 2026-09-14) | [#88](https://github.com/SonGoku2078/Task-Manager/issues/88) · docs/pipeline/mcp-server.md | User: Claude Desktop einrichten |
| 015 | App-Logo & Icons (SelfManaged) | COMPLETED (PR #50, 2026-07-16) | [#49](https://github.com/SonGoku2078/Task-Manager/issues/49) | — |

### Briefing → /req-engineer: App-Logo & Icons (SelfManaged)
- **Kontext / Warum:** App läuft mit Platzhalter-Branding (Bolt-Favicon im Tab, Capacitor-Standard-Icon/-Splash auf Android, Electron-Default-Icon). Eigenes Logo schafft Wiedererkennung auf allen drei Plattformen.
- **Nozbe-Referenz:** N/A — bewusst eigenes Branding (SelfManaged), kein Nozbe-Clone-Element.
- **Ziel / Output:** Weißer Checkmark-Haken auf grüner Kachel `#2b8a3e` erscheint als Favicon im Browser-Tab, als Android-Launcher-Icon (inkl. Themed Icon + Splash) und als Electron-/Windows-Icon.
- **Scope-Hinweise:** Design + vollständiger Scope sind final vom User bestätigt und BINDEND dokumentiert in `docs/pipeline/app-logo.md` Sektion 0 (SVG-Pfaddaten, Dateiliste, Generator-Script per Playwright, kein PWA-Manifest, kein In-App-Branding). Keine Design-Fragen neu aufmachen.
- **Acceptance Criteria (grob):** Als Nutzer sehe ich im Browser-Tab, auf dem Android-Homescreen (auch themed), beim App-Start (Splash) und in der Windows-Taskbar das SelfManaged-Logo statt der Platzhalter.
- **Constraints:** Keine neuen Dependencies (Playwright vorhanden); `mobile-v*`-Tag erst nach Merge; Production niemals anfassen.
- **Definition of Done (PM-Sicht):** Kein Platzhalter-Logo mehr sichtbar auf Web/Android/Electron; APK-Release getaggt; Prod-Web-Deploy bleibt beim User.
- **History:**
  - 2026-07-16: Design-Interview mit User abgeschlossen (Variante A, Splash vollgrün), Item direkt reif → gebrieft an /req-engineer.

---

## 📊 Active GitHub Issues

**Stand 2026-09-15: 61 Issues geschlossen, 10 offen.** Der Durchlauf 2026-07-05/06 (Batches Phase 0, A–D) ist vollständig abgeschlossen — inklusive des früher als geparkt geführten #8. Details: docs/pipeline/issue-*.md; Testnachweise: docs/testcases.json (🧪 Testreport). Deploy erst nach User-Approve.

| # | Title | Priorität | Status |
|---|-------|-----------|--------|
| #92 | Suchfeld in Next Week, Someday und Kalender (+ `/` fokussiert lokal) | HIGH | offen — neu 2026-09-15 |
| #93 | Suche im Kalender-Raster + Unteraufgaben als Treffer | HIGH | ✅ done — PR #95, `a8f93fb` (Prod nach User-Deploy) |
| #59 | Bug: Doppelstart des Servers löscht kurzzeitig das DB-Lock | — | offen |
| #45 | Bug: Evernote-Integration funktioniert nicht | — | offen |
| #44 | Bug: Task kann nicht ans Ende verschoben werden | — | offen |
| #43 | App: Start dauert zu lange | — | offen |
| #41 | Bericht über Arbeitszeiten via Pomodoro | — | offen |
| #46 | Focus Music | — | offen |
| #30 | Reminder-Vorschau auf dem Smartphone + Widget | — | offen |
| #90 | [Ausblick] Sprachausgabe für den KI-Assistenten (Jarvis) | — | offen |

---

## ✅ Completed

Archive of finished features.

| ID | Feature | Completed | Issue |
|----|---------|-----------|-------|
| 001 | Inbox | 2026-06-18 | docs/pipeline/01-inbox.md |
| 002 | Create/Edit/Delete (CRUD) | 2026-06-18 | docs/pipeline/02-crud.md |
| 005 | Task Fields (all) | 2026-06-18 | docs/pipeline/05-task-fields.md |
| 006 | Completed Status | 2026-06-18 | docs/pipeline/06-completed.md |
| 007 | Star/Favorite | 2026-06-18 | docs/pipeline/07-star.md |
| 003 | Projects Management | 2026-06-18 | docs/pipeline/03-projects.md |
| 004 | Priority List (Top 5) | 2026-06-18 | docs/pipeline/04-priority-list.md |
| 008 | Categories/Contexts | 2026-06-18 | docs/pipeline/08-categories.md |
| 009 | Calendar View | 2026-06-18 | docs/pipeline/09-calendar.md |
| 010 | Recurring Tasks | 2026-06-18 | docs/pipeline/10-recurring.md |
| 011 | Filter & Sort | 2026-06-18 | docs/pipeline/11-filter-sort.md |
| 012 | Full-Text Search | 2026-06-18 | docs/pipeline/12-search.md |
| 013 | Keyboard Shortcuts | 2026-06-18 | docs/pipeline/13-shortcuts.md |
| 014 | Nozbe-Exact UI Polish | 2026-06-18 | docs/pipeline/14-ui-polish.md |
| 015 | App-Logo & Icons (SelfManaged) | 2026-07-16 | #49 / PR #50 / docs/pipeline/app-logo.md |

---

## 📋 Feature Template (for Reference)

```markdown
### [TIER-X] PRIORITY - Feature Name
- **Nozbe-Ref:** [Link to help.nozbe.com section]
- **Status:** OPEN
- **Created:** YYYY-MM-DD
- **Owner:** (PM / Req-Eng / etc.)
- **History:**
  - YYYY-MM-DD: Created inbox
```

---

## 🎬 Getting Started

**Next Step:** PM briefs **Inbox Feature** to `/req-engineer`

See PM Skill at `.claude/skills/product-manager/SKILL.md` for how features flow through pipeline.
