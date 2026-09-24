# ChatGPT-Zugriff auf SelfManaged (Custom GPT Actions)

| Feld | Wert |
|---|---|
| Status | blocked |
| Nächste Rolle | User |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-09-24 |
| Issue | [#98](https://github.com/SonGoku2078/SelfManaged/issues/98) (referenziert #88, #89) |
| Bezug | Folge-Thema zu #88 (MCP-Server, done); verwandt mit #89 ("Handy/Cloud + Auth", 2026-09-14 als "nicht geplant" geschlossen — anderer Grund, siehe unten) |

> Orchestrator-Log:
> - 2026-09-24 User bittet um ChatGPT-Zugriff auf die Task-API; Hinweis auf #89 (geschlossen "nicht geplant", Grund damals: Handy-Zugriff war nie Ziel) gegeben. Klärung per AskUserQuestion: Custom GPT Actions (REST/OpenAPI) statt Remote-MCP; Server muss internet-erreichbar sein (Tunnel/Reverse-Proxy + TLS); neues Issue statt #89-Reaktivierung. Zusätzlich: MCP-Server-Instanzen in der lokalen Claude-Config umbenannt (`task-manager-prod` → `selfmanaged-prod`), Naming-Konvention "SelfManaged" (+ "-prod" Suffix) gilt für alle neuen Doku/Configs dieses Features.
> - 2026-09-24 PM-Triage: Backlog-Eintrag in `PM_TASKS.md` angelegt, Briefing geschrieben → `/req-engineer`
> - 2026-09-24 Req-Eng-Klärung per AskUserQuestion: Auth = API-Key (Bearer-Token), Erreichbarkeit = Cloudflare Tunnel. Issue #98 erstellt, ACs verfasst → `/architect`
> - 2026-09-24 Architektur: neuer Prozess `apps/gpt-actions` (Express), wiederverwendet `apps/mcp/src/logic.ts`, Cloudflare Tunnel + Bearer-Auth, `openapi.yaml` fürs Custom-GPT-Action-Import → `/developer`
> - 2026-09-24 Implementierung: `apps/gpt-actions` (Express, 12 Routen unter `/v1`), Bearer-Auth + Rate-Limit, `openapi.yaml`, Rauchtest 22/22 + Unit-Test gegen Dev, Root-Build/CI/README erweitert → `/test-designer`
> - 2026-09-24 Testdesign: TF-01…TF-15 je AC + Ad-hoc-Fälle (DELETE-Ablehnung, manipulierter Auth-Header, Rate-Limit-Schwelle, Backend-Ausfall) → `/test-manager`
> - 2026-09-24 Testausführung: Build/Auto/Smoke/Ad-hoc-Sicherheitsfälle grün; MAJOR-Defekt gefunden — `openapi.yaml` (deklariert 3.1.0, nutzt aber 3.0-Syntax `nullable: true`) fällt bei `redocly lint` mit 9 Errors durch, verletzt AC-4. GATE: NO-GO → `/developer`
> - 2026-09-24 Fix: `openapi.yaml` auf 3.0.3 (Commit `5ed2605`). Re-Test: `redocly lint` fehlerfrei. GATE: GO → `/cicd-engineer`
> - 2026-09-24 CI/CD: Branch gepusht, PR #99 erstellt (Closes #98). Bewusst NICHT gemergt — wartet auf User-Freigabe + Deployment-Schritte (Cloudflare Tunnel, `GPT_ACTIONS_API_KEY` auf `selfmanaged-prod`, Custom-GPT-Setup) → User

## 0. Ausgangslage (bindende User-Entscheidungen, 2026-09-24 — nicht neu verhandeln)

1. **Anbindung:** Custom GPT Actions (REST/OpenAPI-Schema). Kein Remote-MCP-Connector.
2. **Erreichbarkeit:** Server muss aus dem Internet erreichbar sein (Tunnel/Reverse-Proxy + TLS), nicht nur LAN.
3. **Issue-Handling:** Neues GitHub-Issue, referenziert #88 und #89 als Kontext. #89 bleibt als historische Entscheidung ("nicht geplant", Handy-Zugriff) unverändert geschlossen.
4. **Rechte-Scope:** wie #88 — lesen, anlegen, planen, abhaken, sternen. Kein Löschen, keine Projekt-/Kategorienverwaltung. Abweichung nur mit expliziter neuer User-Freigabe in einer Req-Eng-Grill-me-Session.
5. **Naming:** Instanzen durchgängig "SelfManaged" (nicht "Task Manager"), Prod-Suffix "-prod" (Beispiel: `selfmanaged-prod`) — bereits in der lokalen Claude-Config des Users umgesetzt (`mcpServers`-Key umbenannt). Gilt für alle neuen Doku-/Config-Beispiele dieses Features.

Offene technische Fragen für den Req-Engineer / Architekten (in Grill-me klären): Auth-Verfahren (API-Key vs. OAuth), Tunnel-/Reverse-Proxy-Wahl (z. B. Cloudflare Tunnel), Schlüsselverwaltung/Rotation, ob bestehende `/api/*`-Routen direkt exponiert oder ein eigener Adapter-Layer (analog `apps/mcp`) davor gesetzt wird.

## 1. Requirements
- **GitHub Issue:** [#98](https://github.com/SonGoku2078/SelfManaged/issues/98) — `[FEATURE] ChatGPT-Zugriff auf SelfManaged (Custom GPT Actions, API-Key-Auth, Cloudflare Tunnel)`
- **Nozbe-Referenz:** N/A — Infrastruktur-/Integrationsfeature wie #88, kein Nozbe-UI-Feature.
- **Geklärt in Req-Eng-Grill-me (2026-09-24):**
  - Auth-Verfahren: **API-Key** (Bearer-Token im Header), kein OAuth — Single-User-Kontext, Custom GPT Actions unterstützen das nativ.
  - Erreichbarkeit: **Cloudflare Tunnel** — kein offener Router-Port, TLS automatisch verwaltet, geringster Betriebsaufwand.

### Acceptance Criteria
**Aufbau & Betrieb**
- [ ] AC-1 Ein neuer, dünner REST-Adapter-Layer (analog `apps/mcp`, aber HTTP statt stdio) exponiert nur die erlaubten Operationen (lesen/anlegen/planen/abhaken/sternen) — kein direktes Durchreichen der vollen `/api/*`-Routen (insbesondere kein `DELETE`, keine Projekt-/Kategorien-Schreibrouten).
- [ ] AC-2 Jeder Request muss einen gültigen API-Key im `Authorization: Bearer <token>`-Header mitbringen. Fehlt er oder ist er ungültig → `401` mit Klartextfehler, kein Datenzugriff.
- [ ] AC-3 Der API-Key wird aus einer Umgebungsvariable gelesen (kein Hardcoding, kein Default-Wert), analog zu `TM_API_URL` bei #88.
- [ ] AC-4 Ein OpenAPI-3.x-Schema beschreibt alle Endpunkte, ist als Datei im Repo abgelegt und kann direkt in eine ChatGPT-Custom-GPT-Action importiert werden.
- [ ] AC-5 Der Server ist über einen Cloudflare Tunnel von außen per HTTPS erreichbar; die Tunnel-Konfiguration ist dokumentiert (Setup-Schritte, keine Secrets im Repo).

**Funktional (Scope wie #88)**
- [ ] AC-6 Lesen: Projekte, Tasks je Projekt, Nächste Schritte (★), Tagesplan, Inbox, Volltextsuche — inhaltlich deckungsgleich mit den MCP-Lese-Tools aus #88.
- [ ] AC-7 Schreiben: Task anlegen, planen (Tagesplan-Marker)/Planung entfernen, Fälligkeit setzen, sternen, abhaken — inhaltlich deckungsgleich mit den MCP-Schreib-Tools aus #88, inkl. GTD-Invarianten (Planen ⇒ ★, kein Someday).
- [ ] AC-8 Task-Adressierung per `taskId` oder Tasknummer (#N), wie bei #88.

**Sicherheit & Grenzen**
- [ ] AC-9 Es gibt keinen Endpunkt, der Tasks löscht oder Projekte/Kategorien/Members anlegt, ändert oder löscht.
- [ ] AC-10 Jeder Fehler (Netz, 4xx/5xx, Validierung, Auth) kommt als saubere JSON-Fehlerantwort zurück, nie als Absturz oder unstrukturierter Stacktrace nach außen.
- [ ] AC-11 Rate-Limiting oder vergleichbarer Basisschutz gegen Brute-Force auf den API-Key ist vorhanden.

**Naming**
- [ ] AC-12 Alle neuen Doku-/Config-Beispiele verwenden durchgängig "SelfManaged" (nicht "Task Manager"); die Prod-Instanz wird als `selfmanaged-prod` referenziert.

**Nachweis**
- [ ] AC-13 Der User kann in einem Custom GPT in ChatGPT erfolgreich einen Task lesen, anlegen, planen, abhaken und sternen (Anwender-Nachweis, analog TF-20 bei #88).
- [ ] AC-14 Automatisierter Test deckt Auth-Ablehnung (fehlender/ungültiger Key) und den Scope-Ausschluss (kein Lösch-Endpunkt vorhanden) ab.

### Technical Interfaces
- **Input:** HTTPS-Requests von ChatGPT Custom GPT Actions, `Authorization: Bearer <API-Key>`-Header, JSON-Body für Schreiboperationen.
- **Output:** JSON-Antworten gemäß OpenAPI-Schema; Fehler als strukturiertes JSON mit HTTP-Statuscode.
- **Backend:** wie #88 — bestehende REST-Endpunkte `GET/POST/PATCH /api/tasks`, `GET /api/projects`, `GET /api/categories`, `GET /health`, angesprochen über den neuen Adapter-Layer (kein `DELETE`).
- **Netzwerk:** Cloudflare Tunnel vom Prod-Server (`selfmanaged-prod`, LAN) zu einer öffentlichen HTTPS-URL.

### Data Model
Keine neuen Tabellen/Felder — identisch zu #88 (`Task`, `Project`, `Category`).

### Abgrenzung
Kein OAuth, keine Multi-User-Rechteverwaltung, keine Löschfunktion, kein Remote-MCP-Connector. Ausblick für mögliche Folge-Issues.

## 2. Architektur

### Einordnung
Neuer, eigenständiger Node-Prozess **`apps/gpt-actions/`** (Express), der wie `apps/mcp` ein dünner Adapter auf die bestehende REST-API ist — aber HTTP-erreichbar statt stdio, mit Auth-Middleware davor. Die Geschäftslogik (Projekt-/Task-Auflösung, Tagesplan-Gruppierung, Patch-Aufbau, GTD-Invarianten) wird **nicht dupliziert**, sondern aus `apps/mcp/src/logic.ts` wiederverwendet (reine Funktionen, keine I/O — bereits unit-getestet in `scripts/mcp.test.ts`). Kein Web-/Server-Datenmodell ändert sich.

```
ChatGPT Custom GPT (Action) ──HTTPS──► Cloudflare Tunnel ──► apps/gpt-actions (Node, Express)
                                                                │  Auth-Middleware (Bearer-Key)
                                                                │  fetch, TM_API_URL
                                                                ▼
                                                       Express-Server /api/*  (selfmanaged-prod :3001)
```

### Modulstruktur (`apps/gpt-actions/`)
| Datei | Verantwortung |
|---|---|
| `package.json` | `type: module`, Deps: `express`, `zod`; Scripts `build` (tsc), `start` (node dist/index.js) |
| `tsconfig.json` | `module: NodeNext`, `target: ES2022`, `outDir: dist`, `strict`; `include` deckt zusätzlich `../mcp/src/logic.ts` ab (Single-Source-of-Truth, kein Duplikat) |
| `src/index.ts` | Einstieg: liest `TM_API_URL` und `GPT_ACTIONS_API_KEY` (beide Pflicht, fehlen → Exit 1 mit deutscher Meldung), baut Express-App, registriert Middleware + Routen, startet HTTP-Server auf `GPT_ACTIONS_PORT` (Standard 3003, damit kein Kollision mit 3001/3002) |
| `src/auth.ts` | Middleware: prüft `Authorization: Bearer <key>` gegen `GPT_ACTIONS_API_KEY` (konstante Zeit-Vergleich); fehlt/falsch → `401` JSON `{error: "..."}`. Einfaches In-Memory-Rate-Limiting pro IP (z. B. `express-rate-limit`, 20 Fehlversuche/15 min → `429`). |
| `src/api.ts` | Identisch zum Muster aus `apps/mcp/src/api.ts` (eigene Kopie, da anderer Prozess): `getTasks()`, `getProjects()`, `getCategories()`, `createTask()`, `patchTask()`, `health()`. Kein `DELETE` (AC-9). |
| `src/routes.ts` | Express-Routen, 1:1 auf die MCP-Tools aus #88 gemappt (siehe Endpunkt-Tabelle unten). Jede Route: Zod-Validierung des Bodys/Query, ruft `logic.ts`-Funktionen + `api.ts` auf, antwortet JSON. Fehler (inkl. `LogicError` aus `logic.ts`) → passender HTTP-Status + `{error: "<deutscher Text>"}`. |
| `openapi.yaml` | OpenAPI-3.1-Schema aller Routen (Pfade, Request/Response-Bodies, `securitySchemes: bearerAuth`) — direkt importierbar in die ChatGPT-Custom-GPT-Action-Konfiguration (AC-4). |
| `README-Abschnitt` (in Repo-`README.md`) | Cloudflare-Tunnel-Setup (Schritte, keine Secrets im Repo), `GPT_ACTIONS_API_KEY`-Erzeugung, Custom-GPT-Einrichtung mit `openapi.yaml`. |

Root: `package.json` → `build` erweitert um `cd apps/gpt-actions && npm run build`; neue Scripts `build:gpt-actions`, `gpt-actions:dev`. CI (`.github/workflows/ci.yml`) bekommt Install-Schritt „Install gpt-actions dependencies", analog zum `apps/mcp`-Schritt aus #88.

### Endpunkt-Mapping (REST ↔ MCP-Tools aus #88)
| Route | Methode | Entspricht MCP-Tool | Rechte |
|---|---|---|---|
| `/v1/health` | GET | `umgebung_info` | – |
| `/v1/projects` | GET | `projekte_auflisten` | lesen |
| `/v1/projects/:ref/tasks` | GET | `tasks_auflisten` | lesen |
| `/v1/projects/:ref/next-steps` | GET | `naechste_schritte` | lesen |
| `/v1/day-plan?date=YYYY-MM-DD` | GET | `tagesplan` | lesen |
| `/v1/inbox` | GET | `inbox` | lesen |
| `/v1/tasks/search?q=` | GET | `tasks_suchen` | lesen |
| `/v1/tasks` | POST | `task_anlegen` | schreiben |
| `/v1/tasks/:ref/plan` | PATCH | `task_planen` / `task_planung_entfernen` | schreiben |
| `/v1/tasks/:ref/due-date` | PATCH | `task_faelligkeit_setzen` | schreiben |
| `/v1/tasks/:ref/star` | PATCH | `task_stern` | schreiben |
| `/v1/tasks/:ref/complete` | PATCH | `task_abhaken` | schreiben |

`:ref` akzeptiert `taskId` oder `#Tasknummer` (wie AC-8), aufgelöst über `findTask` aus `logic.ts`. **Kein** `DELETE`-Verb auf irgendeiner Route (AC-9) — Express-Router registriert bewusst keine `.delete(...)`-Handler.

### Auth & Exposure
- **API-Key:** `GPT_ACTIONS_API_KEY` als Umgebungsvariable auf dem Prod-Host (`selfmanaged-prod`), kein Default, kein Hardcoding (AC-2/AC-3). Erzeugung z. B. `openssl rand -hex 32`, dokumentiert im README.
- **Cloudflare Tunnel:** `cloudflared` läuft als eigener Prozess/Service neben `apps/gpt-actions` auf dem Prod-Host, mappt eine öffentliche `*.trycloudflare.com`- oder eigene Domain auf `localhost:<GPT_ACTIONS_PORT>`. TLS wird von Cloudflare terminiert — der Node-Prozess selbst bleibt HTTP-only im LAN. Setup-Schritte + Named-Tunnel-Konfig (`config.yml`, nicht committed) im README (AC-5).
- **Scope-Trennung:** `apps/gpt-actions` bekommt eine eigene `TM_API_URL` (zeigt auf `selfmanaged-prod:3001`), unabhängig vom bestehenden MCP-Server — beide Adapter sind unabhängig voneinander deploybar/abschaltbar.

### Datenfluss-Regeln
Identisch zu #88 (aus `logic.ts` übernommen): Datum ausschließlich `YYYY-MM-DD`, Planen-Invariante (`todayDate` setzen ⇒ `starred=true`, `someday=false`), Nummernvergabe `max(number)+1`, Task-Objekt-Aufbau (`id`, `assigneeIds=['u-me']`, `recurrence='none'`). Keine neue Logik nötig — nur ein neuer Transport (HTTP+Auth statt stdio) über denselben Funktionen.

### Fehlerformat
Statt MCP-`isError`-Textantwort: HTTP-Statuscode + `{"error": "<deutscher Klartext>"}` — `400` bei Validierungsfehlern (Zod/`LogicError`), `401` bei Auth, `404` bei „nicht gefunden", `502` bei Fehlern der Backend-API (AC-10).

### Tests
- **Unit (neu, `scripts/gpt-actions.test.ts`):** Auth-Middleware (gültiger/fehlender/falscher Key → 200/401), Rate-Limit-Schwelle, Routing auf `logic.ts`-Funktionen (Wiederverwendung der bestehenden Tests aus `mcp.test.ts` für die reine Logik, hier nur der HTTP-Layer neu getestet) — deckt AC-14.
- **Smoke (`apps/gpt-actions/smoke.mjs`):** startet den Server lokal, ruft alle Routen per `fetch` mit/ohne Key auf, prüft Statuscodes — analog `apps/mcp/smoke.mjs`, verweigert Prod-URLs in Tests.
- **Manuell (User, AC-13):** Custom GPT in ChatGPT mit `openapi.yaml` einrichten, Bearer-Key hinterlegen, die vier Beispiel-Dialoge aus #88 gegen Dev wiederholen, danach einmalig gegen Prod (nach Freigabe).

### Trade-offs
- **Eigener Prozess statt Erweiterung von `apps/mcp`:** hält stdio-MCP (Claude) und HTTP-REST (ChatGPT) sauber getrennt — unterschiedliche Transport-/Auth-Modelle, unterschiedliche Betriebs-Lebenszyklen (MCP läuft nur bei Bedarf lokal, `gpt-actions` muss dauerhaft laufen, wenn Cloudflare Tunnel aktiv ist). Preis: `api.ts` existiert zweimal (bewusst, da process-lokal; `logic.ts` bleibt einmalig).
- **`logic.ts` wiederverwenden statt kopieren:** vermeidet Logik-Drift zwischen MCP und REST (z. B. Planen-Invariante); Preis: `apps/gpt-actions/tsconfig.json` muss `../mcp/src` mit einschließen — leichte Kopplung zwischen den beiden Apps, aber kein npm-Workspace-Umbau nötig (Scope-Sparsamkeit).
- **Cloudflare Tunnel statt eigenem Reverse-Proxy:** kein offener Router-Port, TLS-Verwaltung entfällt — Preis: Abhängigkeit von Cloudflare als Drittanbieter (dokumentiertes Risiko, kein Blocker für Single-User-Nutzung).
- **Kein OpenAPI-Codegen:** `openapi.yaml` wird von Hand gepflegt (Routen-Anzahl klein, 12 Endpunkte) statt generiert — weniger Tooling-Aufwand für diese Größenordnung.

## 3. Implementierung
- **Branch:** `feature/gpt-actions-chatgpt`
- **Commit(s):** `feat(gpt-actions): REST-Adapter fuer ChatGPT Custom GPT Actions (#98)` (siehe `git log feature/gpt-actions-chatgpt`)
- **Files Changed:**
  - `apps/gpt-actions/package.json`, `apps/gpt-actions/tsconfig.json` — eigenes Paket (`express` 4.19, `express-rate-limit` 7.4, `zod` 4.1), Scripts `build`/`start`/`smoke`; `tsconfig.include` deckt zusätzlich `../mcp/src/logic.ts` ab
  - `apps/gpt-actions/src/index.ts` — Einstieg; `TM_API_URL` + `GPT_ACTIONS_API_KEY` Pflicht (Exit 1 + deutsche Meldung je fehlender Variable), Express-App, `GPT_ACTIONS_PORT` (Standard 3003), zentraler 404- + Error-Handler
  - `apps/gpt-actions/src/auth.ts` — `requireApiKey` (Bearer-Vergleich in konstanter Zeit, 401 JSON bei fehlend/falsch) + `createAuthFailureLimiter`/`authFailureLimiter` (`express-rate-limit`, 20 Fehlversuche/15 min → 429, `skipSuccessfulRequests`)
  - `apps/gpt-actions/src/api.ts` — HTTP-Client (GET/POST/PATCH, Timeout 10 s, `ApiError`), eigene Kopie analog `apps/mcp/src/api.ts`, **kein DELETE**
  - `apps/gpt-actions/src/routes.ts` — 12 Routen unter `/v1`, verdrahtet mit `apps/mcp/src/logic.ts` (Import via `../../mcp/src/logic.js`, keine Logik-Duplizierung); `:ref`-Auflösung für Projekt (id/Name) und Task (id/Nummer/#Nummer); zentraler `errorHandler` (400/401/404/502); kein `.delete(...)` registriert
  - `apps/gpt-actions/openapi.yaml` — OpenAPI 3.1, alle 12 Routen, `components.securitySchemes.bearerAuth`
  - `apps/gpt-actions/smoke.mjs` — Rauchtest per `fetch` gegen den gebauten Server (verweigert Prod-URLs `192.168.8.187`/`:3001`)
  - `scripts/gpt-actions.test.ts` — Unit-Test des HTTP-Layers (TC-A12): Auth-Middleware annehmen/ablehnen, Rate-Limit-Schwelle, Routing → `logic.ts` (Fake-Backend, kein Netz)
  - `docs/testcases.json` — TC-A12 (auto), TC-M68 (manuell)
  - `package.json` (Root) — `build` baut `apps/gpt-actions` mit; neue Scripts `build:gpt-actions`, `gpt-actions:dev`; `test` inkl. `gpt-actions.test.ts`; `express`/`@types/express` als Dev-Dependency ergänzt (siehe Abweichungen)
  - `.github/workflows/ci.yml` — Schritt „Install gpt-actions dependencies"
  - `README.md` — Abschnitt „ChatGPT-Zugriff per Custom GPT Actions (#98)": API-Key-Erzeugung, Cloudflare-Tunnel-Setup (nur Doku, kein echter Tunnel angelegt), Custom-GPT-Einrichtung mit `openapi.yaml`
- **Abweichungen von der Architektur:**
  - Root-`package.json` bekam zusätzlich `express` + `@types/express` als **Dev**-Dependency. Grund: `scripts/gpt-actions.test.ts` läuft (wie `mcp.test.ts`) über `tsx` vom Repo-Root aus und importiert `apps/gpt-actions/src/routes.ts`/`auth.ts` direkt (kein Server-Prozess, echtes Fake-Backend) — dafür muss Node beim Value-Import von `express` (für `express()`, Typen) etwas in der Modul-Auflösungskette vom Root aus finden. Die Architektur sah dafür keinen expliziten Hinweis vor; Alternative wäre gewesen, den Test in `apps/gpt-actions/` selbst zu platzieren, was aber der expliziten Vorgabe „`scripts/gpt-actions.test.ts`, analog `scripts/mcp.test.ts`" widersprochen hätte. `apps/gpt-actions/package.json` behält seine eigene `express`-Dependency (Laufzeit-Bedarf bleibt process-lokal, wie in der Architektur beschrieben).
  - `auth.ts` exportiert zusätzlich `createAuthFailureLimiter(limit, windowMs)` als Fabrik (der produktive `authFailureLimiter` bleibt bei 20/15 min). Grund: rein testtechnisch, damit `gpt-actions.test.ts` die Rate-Limit-Schwelle mit einem kleinen Limit statt 20 echten Requests prüfen kann. Keine funktionale Abweichung von AC-11.
  - Sonst keine inhaltlichen Abweichungen von der Architektur (Modulstruktur, Endpunkt-Mapping, Auth/Exposure, Fehlerformat wie spezifiziert).
- **Local Verification:**
  - [x] `npm run build` (Web + Server + MCP + gpt-actions) grün
  - [x] `npm test` grün inkl. `gpt-actions.test.ts` (Auth-Middleware, Rate-Limit-Schwelle, Routing-Verdrahtung — alle Prüfungen bestanden)
  - [x] Start ohne `TM_API_URL` bzw. ohne `GPT_ACTIONS_API_KEY` → Exit 1 mit deutscher Meldung je Variable (AC-3)
  - [x] Rauchtest `TM_API_URL=http://localhost:3002 node apps/gpt-actions/smoke.mjs` gegen Dev (`dev.db`): **22/22 Prüfungen bestanden** — Auth (ohne/falsch/richtig), kein Endpunkt akzeptiert DELETE, alle 12 Routen inkl. Adressierung per id/Nummer/#Nummer, Planen-Invariante (todayDate ⇒ ★), Tagesplan-Gruppen ohne Doppel, Fälligkeit setzen/entfernen, Stern, Suche, abhaken, Fehlertexte (404 unbekannt, 400 Validierung)
  - [x] `npm run gpt-actions:dev` (Platzhalter-Key) gegen Dev manuell verifiziert: `GET /v1/health` liefert `umgebung: "dev"`, `erreichbar: true`
  - [x] `npm run lint`: Befunde vorhanden, aber alle vorbestehend auf master (React-Hooks-Regeln in `src/`, `server/dist`, `apps/mobile`), **0 in `apps/gpt-actions/` oder `scripts/gpt-actions.test.ts`**
  - [x] Prod nicht angesprochen (Rauchtest verweigert `192.168.8.187`/`:3001`; alle manuellen Tests liefen gegen `http://localhost:3002`)
  - [x] **Fix (Re-Test nach GATE NO-GO):** `apps/gpt-actions/openapi.yaml` Kopfzeile `openapi: 3.1.0` → `openapi: 3.0.3` (AC-4 verlangt nur „OpenAPI-3.x"; Datei nutzte durchgängig 3.0-Syntax `nullable: true`, die unter 3.1/JSON-Schema-2020-12 ungültig ist). `npx --yes @redocly/cli lint apps/gpt-actions/openapi.yaml` läuft jetzt fehlerfrei durch („Woohoo! Your API description is valid."), nur die 2 bekannten/akzeptierten Warnings (`info-license`, Platzhalter-Server-URL) bleiben. Keine 3.1-exklusiven Konstrukte (`examples`, `webhooks`, `$defs`, …) waren im Schema vorhanden, daher keine weiteren Anpassungen nötig.
  - [ ] AC-5 (Cloudflare Tunnel live) und AC-13 (Custom GPT in ChatGPT, Anwender-Nachweis) sind bewusst **nicht** Teil dieser Verifikation — kein echter Tunnel wurde angelegt (nur Doku im README), kein echtes ChatGPT-Setup durchgeführt. Das ist der ausstehende Anwender-Nachweis, analog TF-20 bei #88.

## 4. Testdesign

### Teststrategie
- **Auto (TC-A12, `scripts/gpt-actions.test.ts`):** HTTP-Layer ohne echten Server/Netz — Auth-Middleware (Annahme/Ablehnung), Rate-Limit-Schwelle, Routing-Verdrahtung zu `logic.ts` über Fake-Backend.
- **Integration/Smoke (TC-M68, `apps/gpt-actions/smoke.mjs`):** echter HTTP-Client gegen den gebauten Server auf **Dev** (`dev.db`), ruft alle 12 Routen mit/ohne/falschem Key auf, prüft Statuscodes + Datenwirkung. Verweigert Prod-URLs.
- **Ergänzende Ad-hoc-Fälle (Test-Manager, gegen Dev):** Fehlerpfade und Grenzfälle, die weder Unit- noch Smoke-Test abdecken (siehe TF-11…TF-15 unten).
- **Build/CI:** `npm run build` inkl. `apps/gpt-actions`; CI-Workflow mit neuem Install-Schritt; Lint 0 Befunde in neuen Dateien.
- **Anwender (User):** Cloudflare-Tunnel-Aktivierung + Custom-GPT-Einrichtung in ChatGPT mit `openapi.yaml`, danach die vier Beispiel-Dialoge aus #88 wiederholen — gegen Dev zuerst, nach Freigabe gegen Prod. Analog TF-20/TF-19-Nachweis bei #88.
- **Nozbe-Vergleich:** nicht anwendbar (keine UI, reine API wie schon bei #88).

### Testfälle (je AC)
| TF | AC | Prüfung | Art |
|---|---|---|---|
| TF-01 | AC-1 | Kein Endpunkt reicht `/api/*` direkt durch; alle 12 Routen laufen über `logic.ts`/`api.ts`-Adapter; `grep -i "delete"` in `apps/gpt-actions/src` liefert nur Kommentare/Namen ohne `.delete(` | Smoke + Review |
| TF-02 | AC-2 | Request ohne Header → 401; mit falschem Key → 401; mit korrektem Key → 200; Vergleich ist konstant-zeitig (Code-Review, kein `===` auf Rohstring) | Auto + Smoke + Review |
| TF-03 | AC-3 | Start ohne `TM_API_URL` bzw. ohne `GPT_ACTIONS_API_KEY` → Exit 1, deutsche Meldung nennt die fehlende Variable | Manuell |
| TF-04 | AC-4 | `openapi.yaml` ist gültiges OpenAPI 3.1 (Schema-Lint/Import-Test in einen OpenAPI-Validator), enthält `securitySchemes.bearerAuth` und alle 12 Pfade | Ad-hoc |
| TF-05 | AC-5 | README-Abschnitt „Cloudflare Tunnel" enthält vollständige, nachvollziehbare Setup-Schritte ohne eingebettete Secrets; kein `cloudflared`-Config-File im Repo committed | Review |
| TF-06 | AC-6 | Alle Lese-Routen (`/v1/projects`, `/tasks`, `/next-steps`, `/day-plan`, `/inbox`, `/tasks/search`) liefern inhaltlich dieselben Daten wie die entsprechenden MCP-Tools bei gleichem Dev-Datenstand | Smoke |
| TF-07 | AC-7 | Schreib-Routen setzen dieselben Felder/Invarianten wie die MCP-Tools (Planen ⇒ ★ + kein Someday, Fälligkeit lokale Mitternacht, Stern, Abhaken inkl. `completedAt`) | Smoke + Auto |
| TF-08 | AC-8 | Adressierung per `taskId`, per Tasknummer und per `#Nummer` liefert denselben Task; unbekannte Referenz → 404 | Smoke |
| TF-09 | AC-9 | Kein `.delete(...)`-Handler im Router (Code-Review); kein Endpunkt für Projekt-/Kategorien-Schreiben; expliziter Request mit `DELETE`-Methode auf jede Route → 404/405 (Express-Standardverhalten, kein Handler registriert) | Ad-hoc + Review |
| TF-10 | AC-10 | Ungültiges Datum (`"morgen"` statt `YYYY-MM-DD`) → 400 mit Klartext; Backend nicht erreichbar (Dev-Server gestoppt) → 502 statt Absturz, Prozess lebt weiter; kein Stacktrace im Response-Body | Ad-hoc |
| TF-11 | AC-11 | Rate-Limit-Schwelle in Unit-Test simuliert (kleines Limit); Ad-hoc gegen echten Server: 25 Fehlversuche in Folge → ab dem konfigurierten Schwellwert `429` statt `401`; erfolgreiche Requests zählen nicht mit (`skipSuccessfulRequests`) | Auto + Ad-hoc |
| TF-12 | AC-12 | `grep -ri "task manager" README.md apps/gpt-actions` liefert keine neuen Treffer außerhalb historischer Zitate (z. B. Issue-Referenzen); Prod-Beispiele nennen `selfmanaged-prod` | Review |
| TF-13 | AC-13 | Vier Beispiel-Dialoge (analog #88) über einen echten Custom GPT in ChatGPT, zunächst gegen Dev-Tunnel, dann gegen Prod nach Freigabe | User |
| TF-14 | AC-14 | `npm test` enthält `gpt-actions.test.ts`; deckt Auth-Ablehnung und Abwesenheit von Lösch-Routen ab (Assertion auf Router-Stack oder expliziter DELETE-Request → kein 2xx) | Auto |
| TF-15 | — | Manipulierter/abgeschnittener Bearer-Header (z. B. `Authorization: Bearer` ohne Wert, `Authorization: <key>` ohne „Bearer"-Präfix, Header mit Zeilenumbruch) → jeweils sauber 401, kein 500 | Ad-hoc |

### Test-Matrix
| Umgebung | Auto (TC-A12) | Smoke (TC-M68) | Ad-hoc | User-Dialoge |
|---|---|---|---|---|
| Dev (`localhost:3002`, `dev.db`) | ✅ | ✅ | ✅ | User (nach Tunnel-Aktivierung) |
| Prod (`selfmanaged-prod`, `192.168.8.187:3001`) | — | verboten | verboten | User (nach Freigabe, letzter Schritt) |

**Status:** testdesign-done · **Nächste Rolle:** `/test-manager`

## 5. Testausführung & Gate

### Test Results (2026-09-24, Dev `localhost:3002` / `dev.db`, Prod nicht berührt)
| Block | Ergebnis |
|---|---|
| Build `npm run build` (Web + Server + MCP + gpt-actions) | ✅ PASS |
| Auto TC-A12 `scripts/gpt-actions.test.ts` (via `npm test`) | ✅ PASS (Auth-Middleware, Rate-Limit-Schwelle, Routing-Verdrahtung) |
| Auto Regression (übrige `npm test`-Suiten) | ✅ PASS (unverändert) |
| Smoke TC-M68 `apps/gpt-actions/smoke.mjs` gegen Dev | ✅ 22/22 |
| Ad-hoc TF-09 (DELETE auf jede Route) | ✅ 404, kein Handler registriert |
| Ad-hoc TF-10 (ungültiges Datum → 400; Backend unerreichbar → 502) | ✅ beide Fälle sauberes JSON, kein Absturz |
| Ad-hoc TF-11 (Rate-Limit-Schwelle, 20 fehlgeschlagene Requests/15min) | ✅ 429 exakt ab dem 20. nicht-2xx-Request derselben IP, `skipSuccessfulRequests` bestätigt |
| Ad-hoc TF-12 (Naming-Grep „Task Manager") | ✅ keine unerwünschten Treffer; `selfmanaged-prod` durchgängig verwendet |
| Ad-hoc TF-15 (manipulierter Auth-Header: leer/ohne Präfix/CRLF-Injection) | ✅ jeweils 401, kein 500 |
| Review TF-05 (README Cloudflare-Tunnel-Setup) | ✅ vollständig, keine Secrets im Repo |
| Ad-hoc TF-04 (`npx @redocly/cli lint apps/gpt-actions/openapi.yaml`) | ❌ FAIL — 9 Errors (Erstlauf) → ✅ PASS nach Fix (Commit `5ed2605`, `openapi: 3.0.3`) — „Woohoo! Your API description is valid.", nur 2 bekannte Warnings |
| Lint (`npm run lint`) | ✅ 0 Befunde in neuen Dateien |

### Defekte

**[MAJOR] `openapi.yaml` ist kein gültiges OpenAPI 3.1 — verletzt AC-4**
- **Severity:** MAJOR (blockiert AC-4: Schema muss gültig und direkt importierbar sein; ein ungültiges Schema kann den ChatGPT-Custom-GPT-Action-Import zum Scheitern bringen)
- **Reproduktion:**
  1. `npx @redocly/cli lint apps/gpt-actions/openapi.yaml`
  2. → 9 Errors (Regel `struct`), 2 Warnings
- **Root Cause:** Datei deklariert `openapi: 3.1.0` (Kopfzeile), verwendet aber durchgängig die OpenAPI-3.0-Syntax `nullable: true` auf einzelnen Properties (u. a. `HealthInfo.fehler`, `Task.url/projectId/projectName/todayDate/dueDate`, `next-steps.hinweis`, `plan`/`due-date`-Request-Bodies `.datum`). In OpenAPI 3.1 (JSON Schema 2020-12) ist `nullable` kein gültiges Schema-Keyword mehr — Nullability muss über `type: ["string", "null"]` (bzw. `oneOf`) ausgedrückt werden. Die zwei Warnings (fehlendes `info.license`, Platzhalter-Server-URL `*.example.com`) sind unkritisch und kein Blocker.
- **Fix erforderlich:** JA (Blocker für Gate) — entweder (a) `openapi: 3.1.0` → `openapi: 3.0.3` ändern (AC-4 verlangt „OpenAPI-3.x", 3.0.3 erfüllt das und `nullable: true` ist dort gültig — minimaler Fix), oder (b) alle `nullable: true`-Stellen auf `type: [..., "null"]` umstellen und bei 3.1.0 bleiben. Entscheidung beim Developer, Empfehlung: (a), da kleinster Diff und ChatGPT Actions beide Versionen akzeptiert.
- **Behoben:** Commit `5ed2605` (Option a). Re-Test 2026-09-24: `npx --yes @redocly/cli lint apps/gpt-actions/openapi.yaml` → „Woohoo! Your API description is valid.", 0 Errors, 2 bekannte/akzeptierte Warnings. ✅ Verifiziert.

### Nozbe-Vergleich
Nicht anwendbar (keine UI). GTD-Semantik unverändert übernommen aus #88 (`logic.ts` wiederverwendet, keine neue Logik).

### Quality Gate Decision
**GATE: GO.** Der MAJOR-Defekt (ungültiges OpenAPI-Schema, AC-4) ist behoben (Commit `5ed2605`) und re-verifiziert. Alle automatisierten, Smoke- und Ad-hoc-Prüfungen bestanden, 0 offene Defekte. Offen bleibt ausschließlich der Anwender-Nachweis (AC-5 echte Cloudflare-Tunnel-Aktivierung, AC-13/TF-13 echtes Custom-GPT-Setup in ChatGPT) — analog zum Gerätetest-Muster bei #88 (TF-20).
Owner-Role: `/cicd-engineer`

## 6. CI/CD & Deployment
- **Branch:** `feature/gpt-actions-chatgpt` (gepusht zu `origin`, 2 Commits: `690947a` Implementierung, `5ed2605` Defekt-Fix)
- **PR:** [#99](https://github.com/SonGoku2078/SelfManaged/pull/99) (`feature/gpt-actions-chatgpt` → `master`, „Closes #98")
- **CI:** GitGuardian Security Checks ✅ pass; `build`-Workflow zum Zeitpunkt der Doku noch `pending` (läuft) — Status beim `gh pr checks 99` prüfen, bevor gemergt wird.
- **Code-Review (self):** kein Debug-Output, keine TODOs, kein `.delete(...)`-Handler, deutsche Fehlertexte, `openapi.yaml` validiert, Lint sauber in allen neuen Dateien.
- **Merge:** **NICHT durchgeführt.** Analog zu #88 (Merge dort vom Auto-Modus blockiert, User-Freigabe nötig) wartet dieser PR bewusst auf die Entscheidung des Users — zusätzlich hier auch inhaltlich sinnvoll, weil das Feature ohne die anschließenden User-Schritte (Cloudflare-Tunnel-Aktivierung, `GPT_ACTIONS_API_KEY` auf `selfmanaged-prod` setzen, Custom-GPT-Einrichtung) nicht nutzbar ist.
- **Deployment:** kein automatisches Deployment. Nach Merge muss der User auf `selfmanaged-prod`:
  1. `git pull` auf master, `cd apps/gpt-actions && npm install`, `npm run build:gpt-actions` (bzw. `npm run build` von Root)
  2. `GPT_ACTIONS_API_KEY` erzeugen (`openssl rand -hex 32`) und als Umgebungsvariable auf `selfmanaged-prod` setzen, zusammen mit `TM_API_URL=http://192.168.8.187:3001` und `GPT_ACTIONS_PORT` (Standard 3003)
  3. `apps/gpt-actions` als Dauerprozess starten (z. B. via `pm2`/`systemd`/Docker, je nach bestehendem Setup von `selfmanaged-prod`)
  4. Cloudflare Tunnel gemäß README-Abschnitt einrichten und aktivieren (`cloudflared`)
  5. `openapi.yaml` in eine neue Custom-GPT-Action in ChatGPT importieren, Bearer-Key hinterlegen, die vier Beispiel-Dialoge aus #88 testen
- **Abschluss:** Status `blocked` — wartet auf User: PR-Review/Merge-Freigabe + die oben genannten Deployment-Schritte + Anwender-Nachweis (AC-5, AC-13). Kein technischer Blocker mehr auf Entwickler-/Pipeline-Seite.

### Summary
REST-Adapter für ChatGPT-Zugriff (#98) ist fertig implementiert, getestet (Gate: GO) und als PR [#99](https://github.com/SonGoku2078/SelfManaged/pull/99) bereit zum Review. Gleicher Funktionsumfang wie der bestehende MCP-Server (#88), aber HTTP + Bearer-Auth statt stdio, kein Löschen. Merge und Live-Schaltung (Tunnel, Key, Custom GPT) liegen beim User.
