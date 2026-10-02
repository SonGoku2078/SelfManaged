# PROD Fat Client: Outbox hängt (207 Änderungen), Dauer-Offline-Toast

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: Deploy-Freigabe `appwrite-v5`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User-Meldung mit Screenshots, >24h kein Sync) → Analyse
> - 2026-10-02 requirements-done (Issue #108, AC1–AC7) → /architect
> - 2026-10-02 architecture-done → /developer
> - 2026-10-02 implementation-done → /test-designer
> - 2026-10-02 testdesign-done → /test-manager
> - 2026-10-02 gate-go → /cicd-engineer
> - 2026-10-02 PR gemergt, Tag `appwrite-v5` gepusht, wartet auf Environment-Freigabe
>
> Abkürzung (dokumentiert): Bugfix-Folge von #106/#107; alle Rollen in einer Session durchlaufen, keine Stufe übersprungen.

## 1. Requirements

- **GitHub Issue:** [#108](https://github.com/SonGoku2078/SelfManaged/issues/108)
- **Nozbe-Referenz:** N/A — Sync-/Betriebsbug.
- **Befund (localStorage des Fat Clients, nur lesend ausgewertet):**
  - Outbox: 207 Einträge (1× `task.reorder` mit 1.664 IDs am Kopf, attempts=3; 1× `task.create`; 205× `task.update`).
  - Seit #106 wurde der Reorder in 17 Appwrite-Executions à 100 IDs (je eine DB-Transaktion) gesendet. Zusammen mit Pulls (9 Calls), Fokus-Pulls und Health überschreitet das das Appwrite-Execution-Rate-Limit pro Nutzer → 429/Timeouts → Queue-Abbruch; Health scheitert → „Offline"-Toast. FIFO: der Reorder blockiert alle 206 Edits dahinter.
  - localStorage ~5,2 MB (`tm-cache` 4,7 MB) — bei Quota-Überlauf wäre die Outbox still nur noch im RAM.
  - Desktop 1.3.3 nutzt den neuen userData-Ordner `selfmanaged-electron` (App-Umbenennung) → einmaliger Neu-Login; alte Outbox war leer, kein Datenverlust.
- **ACs:** siehe Issue #108 (AC1 Reorder in 1 Call, nur Diff-Writes · AC2 Reorder blockiert nicht · AC3 kein Pull bei voller Outbox, Fokus-Pull-Drossel · AC4 Offline nur ohne HTTP-Antwort · AC5 Timeouts zählen · AC6 Quota-Fallback · AC7 bestehende 207 Edits kommen an).

## 2. Architektur

- **Function `PATCH /api/<tasks|projects|sections>/reorder`:** liest einmal `rowId → sortOrder` (Query.select, Fallback volle Rows), schreibt nur geänderte Zeilen mit Parallelität 8, überspringt unbekannte IDs, keine Transaktion (idempotent; Retry vollendet Rest). Limit 10.000 IDs; `offset` bleibt im Protokoll. Antwort `{ updated }`.
- **Client:** Reorder als ein Call (Chunk 5.000). Outbox: fehlschlagender/rate-limitierter Reorder wird ans Queue-Ende verschoben (setzt nur sortOrder, nichts hängt davon ab); Timeouts zählen als Fehlversuch; veraltete Reorders werden nach MAX verworfen statt dead-lettered und nicht aus Dead-Letters reanimiert. `persist()` opfert bei Quota `tm-cache`.
- **Last senken:** `loadAll` lädt nicht, solange die Outbox nicht leer ist; Fokus-Pull max. alle 30 s; Health wertet jede HTTP-Antwort als erreichbar.
- Verworfen: Health überspringen nach kürzlicher API-Antwort — Ersparnis minimal, verzögerte Offline-Erkennung auf ~45 s (im E2E aufgefallen).

## 3. Implementierung

Branch `fix/sync-stall-reorder`. Dateien: `apps/functions/api/src/main.js`, `src/api/client.ts`, `src/api/outbox.ts`, `src/store.ts`, `src/useServerSync.ts`, `src/App.tsx` (Tooltip).

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | 1.664 IDs → genau 1 Request | AC1 |
| TF-2 | Function: Verschiebung → nur 4 Writes, Ghost-ID übersprungen, Re-Send 0 Writes, select-Fallback, Offset | AC1 |
| TF-3 | Reorder 429 am Kopf → Edits dahinter gehen durch, Reorder 1×/Flush | AC2 |
| TF-4 | Reorder-Timeout → zählt, nach MAX verworfen, nicht dead-lettered; Edits dahinter gehen durch | AC2, AC5 |
| TF-5 | Quota bei Outbox-Persist → `tm-cache` entfernt, Outbox gespeichert | AC6 |
| TF-6 | Regression Browser-E2E offline→online (#106), headless | AC3, AC4 |
| TF-7 | Nach Deploy: User-Outbox (207) läuft leer | AC7 |

## 5. Testausführung & Gate

- TF-1, TF-3–TF-5: Outbox-Checks (gemockter Server) — PASS. Bestehende #106-Checks angepasst (1 Call statt 3 Chunks) — PASS.
- TF-2: Function-Handler gegen gemockte TablesDB — PASS.
- TF-6: Playwright headless 12/12 PASS.
- `tsc -b`, `npm test`, Server-Typecheck, Appwrite-Build — PASS.
- TF-7: offen bis nach Deploy (User-Beobachtung).
- **Gate: GO.**

## 6. CI/CD & Deployment

- PR → master, Tag `appwrite-v5` (Function + Site). Keine neue Desktop-EXE nötig (Thin Client lädt die Site).
