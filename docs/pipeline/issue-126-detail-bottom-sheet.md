# Desktop: Aufgaben-Details von unten, wenn rechts kein Platz ist

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-07 |

## 1. Requirements

- **GitHub Issue:** [#126](https://github.com/SonGoku2078/SelfManaged/issues/126)
- **Befund (User-Screenshot, Fenster halbe Bildschirmbreite):** Detailansicht von rechts überdeckt die Liste fast vollständig.
- **ACs:** siehe Issue #126.

## 2. Architektur

- `src/detailSheet.ts`: `shouldUseSheet(viewport, mainLeft, panelWidth)` — Liste < 480 px → Bottom-Sheet. `useDetailLayout` misst die linke Kante von `.main-content` (Sidebar + Projekte-/Kalender-Panel) bei Fenster-Resize und via `ResizeObserver`.
- `TaskDetailPanel`: Klasse `detail-sheet`, `left` = Kante der Hauptspalte, Höhe = Anteil am Fenster (25–85 %, `localStorage` `tm-detail-sheet-h`), Griff oben statt Breiten-Griff. Während das Sheet offen ist: `--detail-sheet-h` als Abstand unten in `.task-list`, ausgewählte Zeile wird über das Sheet gescrollt.
- CSS überschreibt die bisherige Vollhöhen-Überlagerung (≤ 860 px) aus `App.css`.

## 3. Test

| TF | Prüft | AC | Ergebnis |
|---|---|---|---|
| TF-1 | `scripts/detailsheet.test.ts`: Schwelle 480 px, Laptop mit breitem Panel, Projekte-Panel, Höhe 25–85 % | AC1, AC4, AC5 | PASS |
| TF-2 | Playwright headless, Wegwerf-DB: 960 px → Sheet ab y=450, gewählte Zeile darüber, Klick auf andere Aufgabe wechselt Details; 1600 px → rechts angedockt | AC1–AC3, AC5 | PASS |
| TF-3 | `tsc -b`, `build`, ESLint (keine neuen Befunde) | — | PASS |

**Gate: GO.**

## 4. CI/CD

- PR → master, Tag `appwrite-v9` (Web; der Desktop-Client lädt die Web-App).
