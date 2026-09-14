# MCP-Server: Sprach-Assistent liest/plant/erstellt Tasks per KI (#88)

| Feld | Wert |
|---|---|
| Status | implementation-done |
| Nächste Rolle | /test-designer |
| Owner-Rolle | developer |
| Datum | 2026-09-14 |
| Issue | https://github.com/SonGoku2078/Task-Manager/issues/88 |
| Folge-Issues | #89 (Handy/Cloud + Auth), #90 (Sprachausgabe, nur Merkposten) |

> Orchestrator-Log:
> - 2026-09-14 Grill-me-Session abgeschlossen, Entscheidungen 1–8 im Issue #88 festgehalten → /req-engineer
> - 2026-09-14 requirements-done (AC-1…AC-21) → /architect
> - 2026-09-14 architecture-done (apps/mcp, 13 Tools, logic.ts unit-testbar) → /developer
> - 2026-09-14 implementation-done (Branch feature/mcp-server, Rauchtest 25/25 gegen Dev) → /test-designer

## 0. Ausgangslage (aus der Grill-me-Session)

**Ziel:** Der User spricht am PC (Diktat) mit Claude Desktop / Claude Code; die KI fragt bei Lücken nach und liest bzw. schreibt über einen eigenen MCP-Server in die App.

**Fakten aus der Erkundung:**
- Eine REST-API existiert bereits: `server/src/routes/*` unter `/api/*` (Tasks, Projekte, Kategorien, Sektionen, Members, Blocker, Saved Views, Activity Log, Settings). Web-App, Mobile-App und Android-Widget nutzen sie.
- Keine Authentifizierung, CORS offen; einzige Absicherung ist das Secret-Token in der ICS-URL (`server/src/routes/calendar.ts`).
- Prod: 192.168.8.50:3001 (Docker, LAN). Dev: localhost:3002 (`npm run dev:server`, `dev.db`). **Prod wird bei Entwicklung/Test nie angefasst.**
- Tagesplan-Modell: `todayDate` (Datums-Key) getrennt von `dueDate`; „Heute" = Marker auf heute ODER heute fällig (`src/selectors.ts`, `isTodayFlagActive`). ★ = Nächste Aktion (`docs/GTD-FLOW.md`).
- Kein OpenAPI, kein MCP-Bezug im Repo.

**Entscheidungen (verbindlich, vom User bestätigt):**
| # | Frage | Entscheidung |
|---|---|---|
| 1 | Clients | Claude Desktop / Claude Code am PC im LAN |
| 2 | Andocken | Eigener MCP-Server (stdio) im Repo (`apps/mcp/`), dünner Adapter auf die bestehende REST-API. Keine OpenAPI. |
| 3 | Sprache | Eingabe per Diktat. Sprachausgabe = Ausblick (#90) |
| 4 | Rechte | Lesen, anlegen, planen, abhaken, sternen. **Kein Löschen, keine Projekt-/Kategorienverwaltung.** |
| 5 | „Plan für Tag X" | `todayDate` auf X. Fälligkeit = separates Werkzeug. |
| 6 | Absicherung | Keine in diesem Feature. Auth ist Voraussetzung für #89. |
| 7 | Zielserver | Pflicht-Umgebungsvariable (Base-URL), kein Standardwert; Start bricht mit klarer Meldung ab. `.mcp.json` im Repo → Dev; Claude-Desktop-Konfig des Users → Prod. |
| 8 | „Nächstes" | ★-Tasks des Projekts. Leer → KI sagt es, kann Sternen anbieten. |

**Werkzeuge (Feinschnitt durch Architekt):** siehe Issue #88, Abschnitt „Werkzeuge für die KI".

**Leitplanke für alle Rollen:** Tests ausschließlich gegen Dev (Port 3002, `dev.db`). Der MCP-Server ist ein reiner API-Konsument; Server-Änderungen nur, wenn ein Werkzeug ohne sie nicht umsetzbar ist (dann im Artefakt begründen).

## 1. Requirements
- **GitHub Issue:** #88 — `[FEATURE] MCP-Server: Sprach-Assistent liest/plant/erstellt Tasks per KI (Claude Desktop/Code)`
- **Nozbe-Referenz:** Nozbe bietet selbst keine KI-Schnittstelle; fachlich relevant sind die GTD-Begriffe dieser App (`docs/GTD-FLOW.md`): ★ = Nächste Aktion (Nozbe „Priority"), Heute-Marker = Tagesplan, Fälligkeit = Termin. Die KI muss diese Unterscheidung in den Werkzeugbeschreibungen erklärt bekommen.

### Acceptance Criteria
**Aufbau & Betrieb**
- [ ] AC-1 Der MCP-Server liegt unter `apps/mcp/`, ist TypeScript, spricht stdio (MCP-Standard für lokale Clients) und baut mit `npm run build` (Root) mit. CI (`.github/workflows/ci.yml`) bleibt grün.
- [ ] AC-2 Die Base-URL des Task-Manager-Servers kommt ausschließlich aus der Umgebungsvariable `TM_API_URL`. Fehlt sie oder ist sie leer, beendet sich der Prozess mit Exit-Code 1 und einer deutschen Meldung, die den Variablennamen und ein Beispiel nennt. Es gibt keinen eingebauten Standardwert.
- [ ] AC-3 Das Werkzeug `umgebung_info` liefert die konfigurierte Base-URL, das Ergebnis von `GET /health` und die Kennzeichnung `dev`/`prod`/`unbekannt` (Port 3002 → dev, sonst per Heuristik: `192.168.8.50:3001` → prod).
- [ ] AC-4 `.mcp.json` im Repo registriert den Server für Claude Code mit `TM_API_URL=http://localhost:3002` (Dev). Ein README-Abschnitt beschreibt die Claude-Desktop-Einrichtung mit der Prod-URL (nur Doku, kein Prod-Zugriff durch Tests).

**Lesen**
- [ ] AC-5 `projekte_auflisten`: alle nicht archivierten Projekte und Areas mit `id`, `name`, `kind`, `active` (Someday = inaktiv), Anzahl offener Tasks. Optionaler Filter `nurAktive`.
- [ ] AC-6 `tasks_auflisten`: offene Tasks eines Projekts (per `projektId` **oder** per `projektName`, Name unscharf/case-insensitiv, mehrdeutig → Fehler mit Kandidatenliste) in App-Reihenfolge (`sortOrder`, `createdAt`), je Task: `id`, `number`, `title`, `starred`, `todayDate`, `thisWeek`, `dueDate`, `priority`, `someday`, `waiting`. Erledigte Tasks nur mit `inklusiveErledigte=true`.
- [ ] AC-7 `naechste_schritte`: nur die **★-Tasks** (offen, nicht Someday) eines Projekts; leer → Antworttext „Keine Nächste Aktion markiert" plus Anzahl offener Tasks, damit die KI Sternen anbieten kann (Entscheidung 8).
- [ ] AC-8 `tagesplan`: für ein Datum (`YYYY-MM-DD`, Standard heute; „morgen" wird von der KI in ein Datum übersetzt) drei gekennzeichnete Gruppen: `geplant` (todayDate = Datum), `faellig` (dueDate am Datum), `ueberfaellig` (dueDate < Datum, offen; nur wenn Datum = heute oder Vergangenheit sinnvoll, sonst leer). Jeder Task genau einmal, Gruppe nach Priorität geplant > fällig > überfällig.
- [ ] AC-9 `inbox`: offene Tasks ohne Projekt (nicht Someday), gleiche Felder wie AC-6.
- [ ] AC-10 `tasks_suchen`: Volltext in Titel + Beschreibung (case-insensitiv), Standard nur offene, max. 50 Treffer, mit Projektname.

**Schreiben** (alle liefern den geänderten Task zurück)
- [ ] AC-11 `task_anlegen`: Pflicht `title`; optional `projektId`/`projektName`, `beschreibung`, `faelligAm` (YYYY-MM-DD), `prioritaet` (low/medium/high), `kategorien` (Namen → ids, unbekannte → Fehler), `planenFuer` (YYYY-MM-DD → todayDate). Der Server vergibt keine Nummer: das Werkzeug ermittelt `number = max(number)+1` über `GET /api/tasks`. `id` im App-Format (`task-<zeit>-<zufall>`), `assigneeIds=['u-me']`, `recurrence='none'`.
- [ ] AC-12 `task_planen`: setzt `todayDate` auf ein Datum; setzt gemäß App-Invariante zugleich `starred=true` und `someday=false`. `task_planung_entfernen`: `todayDate=null` (Stern bleibt).
- [ ] AC-13 `task_faelligkeit_setzen`: `dueDate` auf Datum (Mitternacht lokal) oder `null` zum Entfernen.
- [ ] AC-14 `task_stern`: `starred` true/false.
- [ ] AC-15 `task_abhaken`: `completed=true`, `completedAt=jetzt`; `erledigt=false` macht es rückgängig. Wiederkehrende Tasks: nur abhaken, **kein** Folge-Task erzeugen (das Spawnen ist Client-Logik; Hinweis im Rückgabetext, damit die KI es sagt).
- [ ] AC-16 Task-Adressierung in allen Schreibwerkzeugen per `taskId` **oder** `taskNummer` (#N). Unbekannt → Fehler „Task nicht gefunden".

**Sicherheit & Grenzen**
- [ ] AC-17 Es existiert kein Werkzeug, das Tasks löscht oder Projekte/Kategorien/Members anlegt, ändert oder löscht. Der Adapter ruft nie `DELETE` auf.
- [ ] AC-18 Jeder Fehler (Netz, 4xx/5xx, Validierung) kommt als MCP-Fehlerantwort mit deutscher Klartextmeldung zurück, nie als Prozessabsturz.
- [ ] AC-19 Alle Werkzeugbeschreibungen sind deutsch und erklären der KI: ★ = Nächste Aktion; „für Tag planen" ≠ „fällig am"; bei fehlendem Projekt/Datum nachfragen statt raten.

**Nachweis**
- [ ] AC-20 Die vier Beispiel-Dialoge aus Issue #88 sind in Claude Code gegen Dev (`localhost:3002`, `dev.db`) durchführbar; Prod wird nicht angesprochen.
- [ ] AC-21 Automatisierter Test (`scripts/mcp.test.ts`, in `npm test` + `run-tests.mjs`) prüft die reine Logik: Datumsgruppierung des Tagesplans, Nummernvergabe, Projektnamen-Auflösung (eindeutig/mehrdeutig/unbekannt), Invariante Planen ⇒ Stern.

### Technical Interfaces
- **Input:** MCP-Tool-Aufrufe über stdio (JSON-RPC) vom KI-Client. Konfiguration: `TM_API_URL`.
- **Output:** Tool-Ergebnisse als Text (kompakt, deutsch, für Sprachausgabe geeignet) **plus** strukturierte Daten (JSON) im selben Ergebnis, damit die KI sowohl vorlesen als auch weiterarbeiten kann.
- **Backend:** ausschließlich bestehende REST-Endpunkte `GET/POST/PATCH /api/tasks`, `GET /api/projects`, `GET /api/categories`, `GET /health`. Keine Server-Änderung vorgesehen.

### Data Model
Keine neuen Tabellen/Felder. Verwendete Task-Felder: `id, number, title, description, projectId, dueDate, priority, categoryIds, completed, completedAt, starred, someday, thisWeek, todayDate, waiting, sortOrder, createdAt`. Projekt: `id, name, kind, active, archived`. Kategorie: `id, name`.

### Nicht-funktional
- Node 24 (wie CI), keine neuen Root-Abhängigkeiten außer `@modelcontextprotocol/sdk` + `zod` in `apps/mcp/package.json`.
- Antwortzeit: eine Tool-Antwort = maximal zwei API-Aufrufe (Tasks + Projekte), keine Caches (die App ändert Daten parallel).

## 2. Architektur

### Einordnung
Der MCP-Server ist ein **eigenständiger Node-Prozess** (`apps/mcp/`), den der KI-Client startet und über stdio anspricht. Er hält keinen Zustand und spricht die bestehende REST-API an. Keine Server-Änderung.

```
Claude Desktop / Claude Code ──stdio (JSON-RPC, MCP)──► apps/mcp (Node)
                                                            │ fetch, TM_API_URL
                                                            ▼
                                                   Express-Server /api/*  (Dev :3002 | Prod :3001)
```

### Modulstruktur (`apps/mcp/`)
| Datei | Verantwortung |
|---|---|
| `package.json` | `type: module`, Deps `@modelcontextprotocol/sdk` ^1.30, `zod` ^4; Scripts `build` (tsc), `start` (node dist/index.js) |
| `tsconfig.json` | `module: NodeNext`, `target: ES2022`, `outDir: dist`, `strict` |
| `src/index.ts` | Einstieg: liest `TM_API_URL` (fehlt → stderr-Meldung + `process.exit(1)`), baut `McpServer`, registriert Tools, verbindet `StdioServerTransport`. **Nie `console.log`** (stdout ist der MCP-Kanal) — Diagnose nur über `console.error`. |
| `src/api.ts` | Dünner HTTP-Client: `getTasks()`, `getProjects()`, `getCategories()`, `createTask(task)`, `patchTask(id, patch)`, `health()`. Timeout 10 s, Fehler → `ApiError` mit deutscher Meldung (Status + Text). Kein `DELETE`-Aufruf vorhanden (AC-17). |
| `src/logic.ts` | **Reine Funktionen ohne I/O** (unit-getestet): `resolveProject(projects, {id?, name?})`, `nextTaskNumber(tasks)`, `newTaskId()`, `buildNewTask(input, ctx)`, `planPatch(date)` / `unplanPatch()`, `groupDayPlan(tasks, dateKey, todayKey)`, `nextSteps(tasks, projectId)`, `resolveCategories(cats, names)`, `findTask(tasks, {id?, number?})`, `formatTaskLine(task, projectName)`, `envKind(url)`, `dateKey(Date)`. |
| `src/tools.ts` | Registriert die 13 Tools (Zod-Schemas, deutsche Beschreibungen) und verdrahtet `api` + `logic`. Jede Antwort: `content: [{type:'text', text: <deutscher Kurztext>}]` + `structuredContent: {…}`. Fehler → `isError: true` mit Klartext. |

Root: `package.json` → `build` erweitert um `cd apps/mcp && npm run build`; CI bekommt einen Schritt „Install mcp dependencies" (`npm install` in `apps/mcp`). `.gitignore` deckt `dist` bereits ab (Muster `dist`).

### Werkzeugschnitt (13 Tools)
| Tool | Input (Zod) | Backend-Aufrufe | Rückgabe |
|---|---|---|---|
| `umgebung_info` | – | `GET /health` | url, ok, kind (`dev`/`prod`/`unbekannt`) |
| `projekte_auflisten` | `nurAktive?: bool` | projects, tasks | Liste {id, name, kind, active, offen} |
| `tasks_auflisten` | `projektId?`, `projektName?`, `inklusiveErledigte?` | projects, tasks | Projekt + Tasks (Flags) |
| `naechste_schritte` | `projektId?`, `projektName?` | projects, tasks | ★-Tasks; leer → Hinweis + Anzahl offener |
| `tagesplan` | `datum?: YYYY-MM-DD` | tasks, projects | {geplant[], faellig[], ueberfaellig[]} |
| `inbox` | – | tasks | Tasks ohne Projekt |
| `tasks_suchen` | `suche`, `inklusiveErledigte?` | tasks, projects | ≤50 Treffer |
| `task_anlegen` | `title`, `projektId?`, `projektName?`, `beschreibung?`, `faelligAm?`, `prioritaet?`, `kategorien?: string[]`, `planenFuer?` | projects, categories, tasks (für Nummer), `POST /api/tasks` | neuer Task |
| `task_planen` | `taskId?`/`taskNummer?`, `datum` | tasks, `PATCH` | Task |
| `task_planung_entfernen` | `taskId?`/`taskNummer?` | tasks, `PATCH` | Task |
| `task_faelligkeit_setzen` | `taskId?`/`taskNummer?`, `datum: YYYY-MM-DD \| null` | tasks, `PATCH` | Task |
| `task_stern` | `taskId?`/`taskNummer?`, `stern: bool` | tasks, `PATCH` | Task |
| `task_abhaken` | `taskId?`/`taskNummer?`, `erledigt?: bool = true` | tasks, `PATCH` | Task (+ Hinweis bei Wiederholung) |

Projektnamen-Auflösung: exakt (case-insensitiv) → sonst „enthält" → 0 Treffer = Fehler „Projekt … nicht gefunden", >1 = Fehler mit Kandidatenliste (die KI fragt dann nach). Nur nicht archivierte Projekte.

### Datenfluss-Regeln
- **Datum:** Tools nehmen ausschließlich `YYYY-MM-DD` (die KI rechnet „morgen" selbst um; `umgebung_info` liefert dafür zusätzlich `heute` als lokalen Datums-Key des MCP-Prozesses). `todayDate` = Key; `dueDate` = lokale Mitternacht als ISO-String.
- **Planen-Invariante** (aus `gtdInvariants` im Store): `todayDate` setzen ⇒ `starred=true`, `someday=false`.
- **Nummer:** `max(number)+1` aus `GET /api/tasks` (Store-Konvention; Server vergibt nichts). Bei leerer DB: 1.
- **Task-Objekt beim Anlegen** spiegelt `store.addTask`: `id=task-<base36 zeit>-<base36 zufall>`, `assigneeIds=['u-me']`, `recurrence='none'`, `priority='medium'`, `categoryIds=[]`, `sortOrder=0`, `createdAt/updatedAt=jetzt`.
- **Activity-Log:** nicht beschrieben (Client-Konvention, kein AC). Trade-off dokumentiert: die Web-App sieht KI-Änderungen beim nächsten Refresh (#86 Auto-Refresh), aber ohne Log-Eintrag „erstellt von KI". Kandidat für ein Folge-Issue.

### Antwortformat (für Sprachausgabe)
Text kompakt und vorlesbar, z. B. `★ #142 Angebot schreiben (fällig 16.09., hoch)`; Gruppen als Überschriften. `structuredContent` enthält dieselben Daten maschinenlesbar.

### Tests
- `scripts/mcp.test.ts` (tsx, in `npm test` + `run-tests.mjs` als **TC-A10**): testet nur `logic.ts` mit Fixture-Tasks — keine Netzverbindung.
- Manuell (Test-Manager): MCP-Server gegen Dev starten, Tools per MCP-Inspector-Skript oder Claude Code aufrufen; die vier Beispiel-Dialoge.

### Trade-offs
- **stdio statt HTTP-MCP:** deckt Entscheidung 1/3 (lokal) ab; HTTP kommt mit #89.
- **Eigenes `package.json` statt Root-Deps:** hält SDK/Zod aus dem Web-Bundle heraus; Preis: ein Install-Schritt mehr in CI.
- **Kein Cache:** jede Tool-Antwort lädt frisch (Datenmenge im Alltag < 2.000 Tasks, LAN-Latenz vernachlässigbar), dafür nie veraltete Antworten neben der Web-App.
- **Zod v4 mit MCP-SDK 1.30:** unterstützt; falls Inkompatibilität, Fallback auf Zod 3.x (Developer entscheidet, dokumentiert).

## 3. Implementierung
- **Branch:** `feature/mcp-server`
- **Commit:** `feat(mcp): MCP-Server fuer KI-Zugriff …` (siehe `git log feature/mcp-server`)
- **Files Changed:**
  - `apps/mcp/package.json`, `apps/mcp/tsconfig.json` — eigenes Paket (`@modelcontextprotocol/sdk` 1.30, `zod` 4.6), Scripts `build`/`start`/`smoke`
  - `apps/mcp/src/index.ts` — Einstieg; `TM_API_URL` Pflicht (Exit 1 + deutsche Meldung), stdio-Transport, Diagnose nur auf stderr
  - `apps/mcp/src/api.ts` — HTTP-Client (GET/POST/PATCH, Timeout 10 s, `ApiError`), **kein DELETE**
  - `apps/mcp/src/logic.ts` — reine Logik: Projektauflösung, Nummernvergabe, Task-Aufbau, Patches (Planen ⇒ ★/kein Someday), Tagesplan-Gruppierung, Suche, Formatierung, `envKind`
  - `apps/mcp/src/tools.ts` — 13 Werkzeuge mit deutschen Beschreibungen inkl. GTD-Hinweis (★ ≠ Termin, nachfragen statt raten); Text + `structuredContent`; Fehler als `isError`
  - `apps/mcp/smoke.mjs` — Rauchtest per stdio-Client gegen `TM_API_URL` (verweigert Prod-URLs)
  - `scripts/mcp.test.ts` — Unit-Test der Logik (TC-A11), in `npm test` + `run-tests.mjs`
  - `docs/testcases.json` — TC-A11 (auto), TC-M67 (manuell)
  - `package.json` — `build` baut `apps/mcp` mit; neue Scripts `build:mcp`, `mcp:dev`; `test` inkl. mcp.test
  - `.github/workflows/ci.yml` — Schritt „Install MCP-server dependencies"
  - `.mcp.json` — Claude Code → Dev (`http://localhost:3002`)
  - `README.md` — Abschnitt „KI-Zugriff per MCP" (Claude Desktop → Prod, Beispiele, Ausblick #89/#90)
- **Abweichungen von der Architektur:** keine. TC-Nummern: TC-A10/TC-M64 waren bereits belegt (#47) → TC-A11/TC-M67.
- **Local Verification:**
  - [x] `npm run build` (Web + Server + MCP) grün
  - [x] `npm test` grün inkl. `mcp.test.ts`
  - [x] Start ohne `TM_API_URL` → Exit 1 mit Meldung (AC-2)
  - [x] Rauchtest `TM_API_URL=http://localhost:3002 node apps/mcp/smoke.mjs` gegen Dev (`dev.db`): **25/25 Prüfungen bestanden** — 13 Tools registriert, kein Lösch-Tool, dev erkannt, anlegen (Projekt/Inbox, Nummer max+1), planen ⇒ todayDate+★, Tagesplan-Gruppen (kein Doppel), Fälligkeit setzen/entfernen, Stern, Suche, abhaken, Fehlertexte (unbekanntes Projekt/#N)
  - [x] `npm run lint`: 40 Befunde, alle vorbestehend auf master, keiner in neuen Dateien
  - [x] Prod nicht angesprochen (Rauchtest verweigert `192.168.8.50`/`:3001`)
