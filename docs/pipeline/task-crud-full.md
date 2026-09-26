# Volles Task-CRUD für MCP (#88) und GPT-Actions (#98)

| Feld | Wert |
|---|---|
| Status | implementation-done |
| Nächste Rolle | test-manager |
| Owner-Rolle | orchestrator |
| Datum | 2026-09-26 |
| Issue | [#100](https://github.com/SonGoku2078/SelfManaged/issues/100) |
| Bezug | Erweitert #88 (MCP) und #98 (GPT-Actions) — hebt die dort bewusste Einschränkung (kein Löschen) für Tasks explizit auf, per User-Freigabe |

> Orchestrator-Log:
> - 2026-09-26 User bittet um volles Task-CRUD (erstellen/bearbeiten/löschen/abhaken/lesen) über MCP+GPT-Actions. Klärung: nur Tasks, nicht Projekte/Kategorien (die bleiben schreibgeschützt). Issue #100 angelegt → `/developer`.
> - 2026-09-26 implementation-done (`editPatch`/`deleteTask` in beiden Adaptern, 2 neue MCP-Tools, 2 neue GPT-Actions-Routen, `openapi.yaml`/README aktualisiert; Rauchtest 27/27 + Live-PATCH/DELETE gegen Dev, kein Zugriff auf Prod) → `/test-manager`.

## 1. Requirements
Siehe Issue #100 (AC-1..AC-8). Kein Architektur-Neuentwurf nötig — reine Erweiterung des bestehenden Adapter-Patterns aus #88/#98 (gleiche Tool-/Routen-Struktur, gleiche Transport-Schicht `apps/mcp/src/api.ts`/`appwriteApi.ts`). Backend (`apps/functions/api/src/main.js`) unterstützt PATCH/DELETE bereits vollständig — keine Server-Änderung.

## 2. Architektur
- Neue Funktionen in `apps/mcp/src/logic.ts`: `editPatch(fields)` (baut ein PATCH-Objekt aus beliebigen erlaubten Feldern, analog `planPatch`/`duePatch`/`starPatch`).
- Neue Methode `deleteTask(id)` in `apps/mcp/src/api.ts` (Express-Pfad: `DELETE /api/tasks/:id`) und im Appwrite-Pfad (`appwriteApiFetch('DELETE', '/api/tasks/:id')`) — Backend unterstützt beides bereits.
- Neues MCP-Tool `task_bearbeiten` (Zod-Schema: optionale Felder title/beschreibung/projektId/projektName/prioritaet/kategorien) und `task_loeschen` (taskId/taskNummer, Rückfrage-Hinweis in der Tool-Beschreibung).
- Neue GPT-Actions-Routen `PATCH /v1/tasks/:ref` und `DELETE /v1/tasks/:ref`, `openapi.yaml` entsprechend erweitert.
- Projekte/Kategorien bleiben unangetastet — keine neuen Schreib-Pfade dafür.

## 3. Implementierung
- **Branch:** `master` (direkt, kleine additive Erweiterung, User-Freigabe vorab)
- **Commit:** `feat(mcp,gpt-actions): volles Task-CRUD (bearbeiten + löschen, #100)` (siehe `git log`)
- **Files Changed:**
  - `apps/mcp/src/logic.ts` — neue Funktion `editPatch(fields, {projects, categories})`: baut ein PATCH-Objekt aus beliebigen angegebenen Feldern (title/beschreibung/projekt/prioritaet/kategorien), nutzt bestehende `resolveProject`/`resolveCategories`; `projekt: null` → Inbox, `projekt` weggelassen → unverändert; kein Feld angegeben → `LogicError`
  - `apps/mcp/src/api.ts` — `TaskApi.deleteTask(id)` ergänzt (Interface + beide Implementierungen: Express `DELETE /api/tasks/:id`, Appwrite `appwriteApiFetch('DELETE', …)`); Kommentarkopf „bewusst ohne DELETE" entfernt
  - `apps/gpt-actions/src/api.ts` — dieselbe `deleteTask`-Ergänzung, analog (eigene Kopie des Interfaces, siehe Architektur-Trade-off aus #98)
  - `apps/mcp/src/tools.ts` — zwei neue Werkzeuge: `task_bearbeiten` (Zod-Schema title/beschreibung/PROJECT_REF/`inInboxVerschieben`/prioritaet/kategorien, ruft `findTask`+`editPatch`+`patchTask`) und `task_loeschen` (ruft `findTask`+`deleteTask`; Beschreibung weist die KI explizit an, vor dem Aufruf beim Nutzer zu bestätigen); jetzt 15 Werkzeuge
  - `apps/gpt-actions/src/routes.ts` — `PATCH /v1/tasks/:ref` (generisches Feld-Update, gleiche Felder wie das MCP-Tool) und `DELETE /v1/tasks/:ref`; jetzt 14 Routen
  - `apps/gpt-actions/openapi.yaml` — Pfad `/v1/tasks/{ref}` mit `patch`/`delete`-Operationen ergänzt (Response-Schema, Fehlerfälle 400/401/404 analog bestehender Routen); Top-Level-Beschreibung aktualisiert (kein „Kein Löschen" mehr, Hinweis an ChatGPT zur Nutzerbestätigung vor DELETE)
  - `apps/mcp/smoke.mjs` — Zähler auf 15 Werkzeuge korrigiert (statt 13), veraltete Prüfung „kein Lösch-Werkzeug" durch „task_bearbeiten + task_loeschen registriert" ersetzt; neue Rauchtest-Schritte für beide Werkzeuge (bearbeiten inkl. `inInboxVerschieben`, leerer Patch → Fehler, löschen, danach nicht mehr auffindbar)
  - `scripts/mcp.test.ts` — Unit-Tests für `editPatch` (einzelne Felder, Kombination, Projekt per Name/`null`, leerer Patch → Fehler, unbekanntes Projekt/Kategorie → Fehler)
  - `scripts/gpt-actions.test.ts` — Kopfkommentar aktualisiert; die veraltete Prüfung „DELETE ist auf keiner Route registriert" (AC-9, jetzt überholt) entfernt; neue Tests für `PATCH /v1/tasks/:ref` (Erfolg, leerer Body → 400, unbekannter Task → 404) und `DELETE /v1/tasks/:ref` (unbekannt → 404, real → 200 + Task wirklich aus dem Fake-Backend entfernt); `FakeApi.deleteTask` ergänzt
  - `README.md` — beide Abschnitte („KI-Zugriff per MCP", „ChatGPT-Zugriff per Custom GPT Actions"): „Kein Löschen"-Aussage für Tasks entfernt, Projekte/Kategorien bleiben explizit nur lesbar; Routenzahl 12→14
  - `docs/pipeline/task-crud-full.md` — dieser Abschnitt
- **Abweichungen von der Architektur:** keine. Die Architektur sah `deleteTask` nur als neue Methode vor — `editPatch` bekommt zusätzlich den Kontext `{projects, categories}` als zweiten Parameter (statt implizit über Closures), damit die Funktion weiterhin eine reine, unit-testbare Funktion ohne I/O bleibt (Vorbild: bestehende Werkzeuge laden Projekte/Kategorien selbst und übergeben sie).
- **Local Verification:**
  - [x] `npm run build` (Web + Server + MCP + gpt-actions) grün
  - [x] `npm test` grün, inkl. neuer Prüfungen in `mcp.test.ts` und `gpt-actions.test.ts`
  - [x] `npm run lint`: 37 Befunde, alle vorbestehend (React-Komponenten, `nozbe.ts`), keiner in den geänderten/neuen Dateien (`apps/mcp/*`, `apps/gpt-actions/*`, `scripts/*.test.ts`)
  - [x] Rauchtest `TM_API_URL=http://localhost:3002 node apps/mcp/smoke.mjs` gegen Dev: **27/27 Prüfungen bestanden**, inkl. `task_bearbeiten` (Titel/Priorität/Projekt ändern, `inInboxVerschieben`, leerer Patch → Fehler) und `task_loeschen` (löschen + danach „nicht gefunden")
  - [x] Live-Smoke von `apps/gpt-actions` gegen Dev (`TM_API_URL=http://localhost:3002`, lokaler Testport 3099): Task angelegt → `PATCH /v1/tasks/:ref` (Titel+Priorität geändert, leerer Body → 400) → `DELETE /v1/tasks/:ref` (unbekannt → 404, real → 200) → per Suche verifiziert, dass der Task wirklich weg ist
  - [x] Appwrite-Prod **nicht** angesprochen: keine Schreib-/Löschtests gegen echte Prod-Daten; alle Verifikation ausschließlich gegen Dev (`localhost:3002`, `dev.db`), wie von AC-8 gefordert. Für Prod bleibt der Appwrite-Transport (`appwriteApi.ts`) unverändert bis auf die neue `DELETE`-Methode, die denselben, bereits produktiv genutzten `appwriteApiFetch`-Pfad nutzt wie GET/POST/PATCH.
