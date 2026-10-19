# Sync-Hinweis minutenlang: ein Drag renumbert die ganze Taskliste

| Feld | Wert |
|---|---|
| Status | in-deploy |
| Nächste Rolle | cicd-engineer (Deploy `appwrite-v17`, danach Migration) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-19 |

> Orchestrator-Log:
> - 2026-10-19 gestartet (User-Meldung mit Screenshot „2 Änderung(en) werden synchronisiert…“, ~20 min) → Analyse
> - 2026-10-19 requirements-done (Issue #149, AC1–AC6) → architecture → implementation → testdesign → gate-go
>
> Abkürzung (dokumentiert): dringender Bugfix, alle Rollen in einer Session durchlaufen.

## 1. Requirements

- **GitHub Issue:** [#149](https://github.com/SonGoku2078/SelfManaged/issues/149)
- **Befund (nur lesend):**
  - Outbox der Desktop-App: `task.update` + `task.reorder` mit 1.919 IDs.
  - Gegen PROD gerechnet: dieser Reorder braucht 731 Einzel-Writes (dichte Nummerierung 0..n).
  - Die API-Function schreibt mit dem JWT des Nutzers → ~120 Writes/Minute (vgl. #144: 429 nach ~120 Updates) und 30-s-Timeout. Ergebnis: rund 10 Minuten Banner; die Outbox war um 16:3x leer.
- **ACs:** siehe Issue (AC1 1 Write pro Drag, AC2 Sortierwert neuer Tasks, AC3 Zeitbudget, AC4 kein Hinweis für Sortierung, AC5 Migration, AC6 alte Reorders verwerfen).

## 2. Architektur

- `src/taskOrder.ts`: Abstände `ORDER_STEP = 1024`. `placeMoved` gibt dem verschobenen Task den Mittelwert der Nachbarn (1 Write). Ist die Lücke aufgebraucht, verteilt `respaceWindow` das kleinste Fenster mit Platz (≤ 50 Tasks). Nur bei inkonsistenter lokaler Ordnung gibt es einen vollen `task.reorder` mit `step`. Es zählt nur dieselbe Ebene (Top-Level bzw. Geschwister).
- `store.ts`: `reorderTasks`, `dropTaskOnTask` und `assignTaskSection` persistieren per `task.update { sortOrder }` (sectionId fährt mit). Neue Tasks bekommen `edgeOrder` (oben/unten).
- Function `PATCH …/reorder`: optional `step`, Zeitbudget 20 s, Antwort `{ updated, remaining }`. Der Client sendet sofort erneut (max. 20 Runden).
- Outbox: `visiblePendingCount()` ohne Reorders für das Banner (Verzögerung 15 s). Alte `task.reorder` ohne `step` werden beim Laden verworfen.
- Migration `scripts/appwrite/respace-task-order.mjs` (API-Key, kein Nutzer-Limit): Top-Level auf `index * 1024`, Reihenfolge exakt wie beim App-Load.

## 3. Implementierung

Branch `fix/sync-reorder-single-write`. Dateien: `src/taskOrder.ts` (neu), `src/store.ts`, `src/api/outbox.ts`, `src/api/client.ts`, `src/api/tasks.ts`, `src/App.tsx`, `apps/functions/api/src/main.js`, `server/src/routes/tasks.ts`, `scripts/appwrite/respace-task-order.mjs` (neu), `scripts/taskorder.test.ts` (neu).

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | 9 Drags in gespreizter Liste (1.900 Tasks) → je genau 1 Write, Ordnung strikt steigend | AC1 |
| TF-2 | 40 Drops an dieselbe Stelle → nie voller Reorder, max. ≤ 10 Writes | AC1 |
| TF-3 | Dichte Liste (vor Migration) → begrenzt (≤ 50) oder 1 Reorder | AC1 |
| TF-4 | Subtasks: eigene Ordnung, Top-Level-Drag ignoriert sie | AC1 |
| TF-5 | `edgeOrder` oben/unten, Drag direkt nach Anlegen = 1 Write | AC2 |
| TF-6 | `forEachLimited` stoppt am Zeitbudget | AC3 |
| TF-7 | Nach Deploy + Migration: Drag in PROD → Outbox sofort leer, kein Banner | AC4, AC5 |

## 5. Testausführung & Gate

- TF-1–TF-6: `scripts/taskorder.test.ts` PASS (in `npm test` aufgenommen); ganze `npm test`-Suite PASS.
- `tsc -b`, `npm run build`, `npm run build:mobile` PASS.
- Migration Probelauf gegen PROD: 1.919 Tasks, 1.216 Top-Level, 1.215 zu schreiben.
- TF-7: offen bis nach Deploy.
- **Gate: GO.**

## 6. CI/CD & Deployment

- offen
