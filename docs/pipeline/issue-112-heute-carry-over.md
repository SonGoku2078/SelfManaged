# Heute: ☀️-Markierung bleibt bis erledigt

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: Deploy-Freigabe `appwrite-v6`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User: Tasks verschwinden am Folgetag aus Heute) → Analyse
> - 2026-10-02 BLOCKED: Produktentscheidung (Quick-Add-Verhalten, alte Markierungen) → User entschieden
> - 2026-10-02 requirements-done (Issue #112) → architecture-done → implementation-done → testdesign-done → gate-go → PR/Deploy

## 1. Requirements

- **GitHub Issue:** [#112](https://github.com/SonGoku2078/SelfManaged/issues/112)
- **Befund (lokaler Cache des Fat Clients, nur lesend):** Die 5 Aufgaben aus dem User-Screenshot hatten keine ☀️-Markierung, nur `dueDate` = 1. Okt. — Quick-Add in Heute setzte ein Fälligkeitsdatum. Am Folgetag → überfällig → nur noch in Nächste Aktion. 18 offene Aufgaben tragen alte Markierungen (Juli–Sept.), 84 erledigte ebenfalls.
- **User-Entscheidung:** Quick-Add in Heute setzt ☀️ (keine Fälligkeit); alte Markierungen werden wieder angezeigt.
- **ACs:** siehe Issue #112.
- **Nozbe-Referenz:** Nozbe „Priority/Heute" ist ein Plan-Marker, keine Deadline — die Trennung Markierung ≠ Fälligkeit entspricht dem.

## 2. Architektur

- `isTodayFlagActive`: aktiv bei `todayDate <= heute` (YYYY-MM-DD-Stringvergleich) statt `=== heute`. Wirkt zentral für Web-Heute, Mobile-Heute (`mobileToday`), Markierungs-Anzeige, Suche.
- Heute-Ansicht: erledigte Aufgaben nur, wenn heute markiert oder heute erledigt (sonst 84 alte Erledigte im Erledigt-Block).
- `App.handleAddTask`: Heute → `todayDate`, kein `dueDate` (Kalender-Ansicht unverändert mit Datum). `addTask` setzt ★ Nächste Aktion wie bisher implizit.
- MCP `groupDayPlan`: Plan für heute enthält auch ältere offene Markierungen; Pläne für andere Tage unverändert exakt.
- Keine Datenmigration (User-Entscheidung), kein Schema-/Server-Change.

## 3. Implementierung

Branch `fix/heute-carry-over`: `src/selectors.ts`, `src/App.tsx`, `src/components/BulkActionBar.tsx` + `TaskDetailPanel.tsx` (Tooltip), `apps/mcp/src/logic.ts`, Tests.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Flag gestern → aktiv; Flag morgen → inaktiv | AC1, AC2 |
| TF-2 | Heute-Ansicht (Web + Mobile): fällig heute ∪ offene Flags ≤ heute | AC1, AC5 |
| TF-3 | Erledigt + altes Flag → nicht in Heute; heute erledigt → in Heute | AC4 |
| TF-4 | MCP-Tagesplan heute enthält Flag von gestern | AC1 |
| TF-5 | Browser (headless, Uhr gemockt): Quick-Add in Heute → `todayDate` gesetzt, `dueDate` null; am Folgetag weiter in Heute | AC3, AC1 |

## 5. Testausführung & Gate

- TF-1–TF-4: `scripts/todayflag.test.ts`, `todaymarker.test.ts`, `mcp.test.ts` angepasst/erweitert — `npm test` grün.
- TF-5: Playwright headless gegen Test-Instanz — 3/3 PASS.
- `tsc -b`, ESLint — PASS. **Gate: GO.**

## 6. CI/CD & Deployment

- PR → master, Tag `appwrite-v6` (enthält auch #108). Mobile-App übernimmt die Regel mit dem nächsten Mobile-Release.
