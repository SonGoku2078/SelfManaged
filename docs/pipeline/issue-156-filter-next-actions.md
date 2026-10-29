# Filter: nur Next Actions (★) + Filterleiste ohne Seitwärts-Scrollen

| Feld | Wert |
|---|---|
| Status | gate-go |
| Nächste Rolle | cicd-engineer |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-29 |

> Orchestrator-Log:
> - 2026-10-29 gestartet (User: in grossen Projekten mit Sektionen nach ★ Next Actions filtern; Filterleiste scrollt seitwärts)
> - 2026-10-29 requirements-done (Issue #156, AC1–AC5) → architecture → implementation → testdesign → gate-go
>
> Abkürzung (dokumentiert): kleines Feature, alle Rollen in einer Session durchlaufen.

## 1. Requirements

- **GitHub Issue:** [#156](https://github.com/SonGoku2078/SelfManaged/issues/156)
- **ACs:** siehe Issue (AC1 Schalter, AC2 Parent mit ★-Subtask, AC3 leere Sektionen, AC4 Badge/Reset/gespeicherte Ansicht, AC5 Umbruch).

## 2. Architektur

- `Filters.starred?: boolean` (optional → alte gespeicherte Ansichten bleiben gültig), Default `false` in `defaultUIState`.
- `selectors.matchesFilters`: bei `starred` nur `task.starred` oder Parent einer offenen ★-Subtask (`starredParents`, einmal pro `selectVisibleTasks` berechnet). Wirkt wie alle FilterBar-Filter nur in `FILTERABLE_VIEWS`.
- `FilterBar`: Schalter `★ Next Actions` direkt nach der Suche, in beiden Zuständen (ein-/ausgeklappt); zählt in `activeCount`/`hasActiveFilter`.
- `TaskList`: Leer-Hinweise bei aktivem Filter („☆ Noch keine Next Action in dieser Gruppe“).
- `FilterBar.css`: `flex-wrap: wrap` statt `overflow-x: auto`.

## 3. Implementierung

Branch `feat/filter-starred`. Dateien: `src/types.ts`, `src/store.ts`, `src/selectors.ts`, `src/components/FilterBar.tsx`, `src/components/FilterBar.css`, `src/components/TaskList.tsx`, `scripts/starredfilter.test.ts` (neu, in `npm test`).

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Filter aus: alle Root-Tasks des Projekts | AC1 |
| TF-2 | Filter an: ★-Root + Parent mit offener ★-Subtask; Parent mit nur erledigter ★-Subtask nicht | AC1, AC2 |
| TF-3 | Sichttest Projekt mit Sektionen: Leer-Hinweis, Badge, ✕, Speichern als Ansicht | AC3, AC4 |
| TF-4 | Sichttest schmales Fenster: Leiste bricht um, Zeitraum-Popover sichtbar | AC5 |

## 5. Testausführung & Gate

- TF-1, TF-2: `scripts/starredfilter.test.ts` PASS; ganze `npm test`-Suite PASS.
- `tsc -b`, ESLint, `npm run build` PASS.
- TF-3, TF-4: User nach Deploy.
- **Gate: GO.**

## 6. CI/CD & Deployment

- offen
