# PM_TASKS — SelfManaged (Nozbe Clone)

**Projekt:** SelfManaged (Nozbe Clone, HTML MVP)  
**Repository:** https://github.com/SonGoku2078/SelfManaged  
**Status:** ✅ Tier-1 Core Features COMPLETE (14/14) — MVP funktionsfähig  
**Last Updated:** 2026-09-18

---

## 📥 Inbox (Ungefiltert)

Alle neuen Feature-Ideen, Requests, Bugs — unpriorisiert.

- [x] **User Settings / Preferences** — Save user theme, language, defaults
- [x] **Attachments on Tasks** — Add files/images to tasks (localStorage, ≤400 KB)
- [x] **Task Comments** — Add discussion/comments on tasks
- [x] **Email Integration** — Forward emails as tasks (lokaler Stub)
- [x] **Advanced Reporting** — Task statistics, completion rate (Berichte-Ansicht)
- [ ] **Mobile Gestures** — Swipe to delete, long-press menus (Touch Devices) — *zurückgestellt: braucht Touch-Hardware zum Verifizieren*
- [x] **Sprachsteuerung zur Task-Erfassung (Mikrofon-Button)** — Diktier-Button in der App (Web + perspektivisch Handy), Speech-to-Text + KI-Interpretation legt Task an; landet je nach gesprochenem Inhalt in Inbox oder direkt in einem Projekt. Ziel: Idee → Button → Diktat → Task ist erledigt, ohne Tippen oder manuelle Ablage-Entscheidung. → triagiert, siehe Backlog TIER-4.
- [x] **ChatGPT-Zugriff auf SelfManaged (Custom GPT Actions)** — User will Tasks nicht nur über Claude (MCP, #88), sondern auch über ChatGPT lesen/anlegen/planen/abhaken/sternen können. Verwandt mit dem 2026-09-14 als "nicht geplant" geschlossenen #89 (damals: Handy-Zugriff war nie Ziel) — heute expliziter neuer Wunsch mit anderem Ziel (ChatGPT statt Handy). User-Entscheidungen 2026-09-24 bindend: Custom GPT Actions (REST/OpenAPI, kein Remote-MCP), Server muss internet-erreichbar sein (Tunnel/Reverse-Proxy + TLS), neues Issue statt #89-Reaktivierung. → triagiert, siehe Eintrag „In Bearbeitung".

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
- [ ] **[TIER-4] HIGH — Sprachsteuerung zur Task-Erfassung (Mikrofon-Button)** — Mikrofon-Button in der UI (Web zuerst, Handy später) startet Diktat; Speech-to-Text-Transkript geht an die KI, die daraus Titel/Details extrahiert und den Task per bestehender Task-Anlage-Logik erstellt. KI erkennt aus dem Gesagten, ob ein Projektbezug genannt wurde (→ Task landet direkt im Projekt) oder nicht (→ Inbox, wie bisheriger Default). Kernanforderung User: max. Schnelligkeit/Reibungslosigkeit, keine manuelle Nacharbeit nötig. Ergänzt den bestehenden MCP-Sprach-Assistenten (#88, Claude Desktop/Code) um einen In-App-Weg ohne externes Tool; thematisch verwandt mit #90 (Sprachausgabe/Jarvis, aber das ist Output statt Input).

---

## 🔄 In Bearbeitung (Requirements Engineering)

Features gebrieft, beim Requirements Engineer in Arbeit.

| ID | Feature | Status | Issue | Owner |
|----|---------|---------| -----|-------|
| — | Alle Tier-1-Features abgeschlossen | done | docs/pipeline/* | — |
| #88 | **MCP-Server: Sprach-Assistent (Claude Desktop/Code)** — lesen/planen/anlegen/abhaken, kein Löschen (#89 Handy: nicht geplant, geschlossen) | done (PR #91 gemergt 2026-09-14) | [#88](https://github.com/SonGoku2078/Task-Manager/issues/88) · docs/pipeline/mcp-server.md | User: Claude Desktop einrichten |
| #98 | **ChatGPT-Zugriff auf SelfManaged (Custom GPT Actions)** — REST-API mit Auth, internet-erreichbar (Tunnel/TLS), gleicher Rechte-Scope wie #88 | blocked (Gate GO, PR offen — wartet auf User: Merge-Freigabe + Cloudflare-Tunnel/Key/ChatGPT-Setup) | [#98](https://github.com/SonGoku2078/SelfManaged/issues/98) · [PR #99](https://github.com/SonGoku2078/SelfManaged/pull/99) · docs/pipeline/chatgpt-api-access.md | User: PR reviewen, mergen, Tunnel+Key+Custom-GPT einrichten |
| 015 | App-Logo & Icons (SelfManaged) | COMPLETED (PR #50, 2026-07-16) | [#49](https://github.com/SonGoku2078/Task-Manager/issues/49) | — |

### Briefing → /req-engineer: ChatGPT-Zugriff auf SelfManaged (Custom GPT Actions)
- **Kontext / Warum:** Der User nutzt bereits Claude (MCP-Server, #88) für KI-gestützten Task-Zugriff und will denselben Funktionsumfang jetzt auch über ChatGPT nutzen können. Issue #89 ("Handy/Cloud + Auth") wurde 2026-09-14 bewusst als "nicht geplant" geschlossen, aber mit anderer Begründung (Handy-Zugriff war nie Ziel) — der heutige Wunsch (ChatGPT) ist ein neues, vom User heute (2026-09-24) explizit bestätigtes Ziel und rollt diese alte Entscheidung nicht auf, sondern ergänzt sie.
- **Nozbe-Referenz:** N/A — Infrastruktur-/Integrationsfeature wie #88, kein Nozbe-UI-Feature.
- **Ziel / Output:** ChatGPT (Custom GPT mit Actions) kann über eine authentifizierte, öffentlich erreichbare HTTPS-API Tasks lesen, anlegen, planen (Tagesplan-Marker), abhaken und sternen — analog zu den bestehenden 13 MCP-Tools aus #88, aber via REST/OpenAPI statt stdio-MCP.
- **Scope-Hinweise (bindend aus User-Klärung 2026-09-24, nicht neu verhandeln):**
  1. Anbindung: **Custom GPT Actions (REST/OpenAPI-Schema)** — kein Remote-MCP-Connector.
  2. Erreichbarkeit: Server muss **aus dem Internet erreichbar** sein (Tunnel/Reverse-Proxy + TLS), nicht nur LAN.
  3. Neues GitHub-Issue anlegen (nicht #89 reaktivieren); #88 und #89 als Kontext verlinken.
  4. Rechte-Scope wie #88: lesen/anlegen/planen/abhaken/sternen. **Kein Löschen, keine Projekt-/Kategorienverwaltung** — Abweichung nur mit expliziter neuer User-Freigabe in der Req-Eng-Grill-me-Session.
  5. Naming: Instanz-Bezeichnungen durchgängig „SelfManaged" (nicht „Task Manager"), Prod-Suffix „-prod" (z. B. `selfmanaged-prod`) — bereits in der lokalen Claude-Config des Users so umgesetzt; in aller neuen Doku/Config-Beispielen durchziehen.
- **Acceptance Criteria (grob):** Als User kann ich in einem Custom GPT in ChatGPT per natürlicher Sprache Tasks aus SelfManaged abfragen und anlegen/planen/abhaken/sternen, ohne dass ChatGPT löschen oder Projekte/Kategorien verwalten kann; der Zugriff ist durch einen Auth-Mechanismus (Token/API-Key) geschützt, den nur ich kenne.
- **Constraints:** Bestehende REST-API (`server/src/routes/*`) wird wiederverwendet/erweitert, kein Parallel-Backend; Auth-Schicht ist neu (bestehende API hat aktuell keine); TLS/Tunnel-Wahl technisch beim Architekten entscheiden (Kandidaten z. B. Cloudflare Tunnel, Reverse-Proxy mit eigenem Zertifikat) — Kosten-/Betriebsimplikationen im Architektur-Abschnitt benennen, da neu ggü. #88 (das war rein lokal/LAN).
- **Definition of Done (PM-Sicht):** Auth-geschützte HTTPS-API ist von außen erreichbar, OpenAPI-Schema für Custom GPT Actions vorhanden, gleicher funktionaler Umfang wie MCP #88 (minus Löschen/Verwaltung), User hat ChatGPT erfolgreich getestet.
- **History:**
  - 2026-09-24: Aus User-Anfrage inkl. Grill-me/Klärung triagiert (Custom GPT Actions, Internet-erreichbar, neues Issue) → direkt gebrieft an /req-engineer.

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
