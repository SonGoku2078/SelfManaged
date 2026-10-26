# Projektblocker als eigener Kalender-Feed (ICS)

| Feld | Wert |
|---|---|
| Status | gate-go |
| Nächste Rolle | cicd-engineer |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-26 |

> Orchestrator-Log:
> - 2026-10-26 gestartet (User-Wunsch: Blocker im Proton-Kalender, als zweiter Kalender ein-/ausblendbar)
> - 2026-10-26 requirements-done (Issue #152, AC1–AC6) → architecture → implementation → testdesign → gate-go
>
> Abkürzung (dokumentiert): kleines Feature, alle Rollen in einer Session durchlaufen.

## 1. Requirements

- **GitHub Issue:** [#152](https://github.com/SonGoku2078/SelfManaged/issues/152)
- Blocker haben kein Datum (Wochenvorlage: `weekdays`, `startMinutes`, `durationMin`) und erscheinen in der Wochenansicht jede Woche → im Kalender als wöchentliche Serie.
- **ACs:** siehe Issue (AC1 eigener Pfad, AC2 Serie, AC3 Titel/Beschreibung, AC4 Auslassen, AC5 Einstellungen, AC6 Task-Feed unverändert).

## 2. Architektur

- `apps/functions/ics/src/main.js`: Pfad `/calendar/<token>/projektblocker.ics` (gleiches `ICS_TOKEN`). `blockersToIcs(blockers, projects, tasks, now)`: UID `blocker-<id>@selfmanaged`, `DTSTART` = erster Blocker-Wochentag in der Zürcher Woche von `$createdAt`, `RRULE:FREQ=WEEKLY;BYDAY=…`, `SUMMARY` = Projektname, `DESCRIPTION` = Tasks der aktuellen Woche (wie `nextWeekTasksOf` in `WeekView`). Kalendername „SelfManaged Projektblocker“.
- Leserecht: Function-Scope `rows.read` ist tabellenübergreifend → keine Provisionierungsänderung.
- `apps/functions/api/src/main.js`: `/api/calendar-feed` liefert zusätzlich `blockerUrls`.
- UI: `CalendarFeedSection` (Web) und Mobile-`Settings` zeigen die zweite URL.
- Nicht umgesetzt: Legacy-LAN-Server (`server/`).

## 3. Implementierung

Branch `feat/blocker-calendar-feed`. Dateien: `apps/functions/ics/src/main.js`, `apps/functions/api/src/main.js`, `src/api/other.ts`, `src/components/SettingsView.tsx`, `apps/mobile/src/components/Settings.tsx`, `scripts/ics-appwrite.test.ts`.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Kalendername, UID, DTSTART/DTEND Zürich, RRULE MO,WE, Titel | AC2, AC3 |
| TF-2 | Beschreibung: nur diese Woche, nur Root-Tasks, nur eigenes Projekt, Stern zuerst | AC3 |
| TF-3 | Gelöschtes Projekt / leere Wochentage → kein VEVENT | AC4 |
| TF-4 | Sonntags-Blocker verankert auf Sonntag der Anlagewoche | AC2 |
| TF-5 | Bestehende Task-Feed-Asserts unverändert grün | AC6 |
| TF-6 | Nach Deploy: Feed 200, falsches Token 404, URL in Einstellungen, Abo in Proton | AC1, AC5 |

## 5. Testausführung & Gate

- TF-1–TF-5: `scripts/ics-appwrite.test.ts` PASS unter `TZ=UTC` und `TZ=America/New_York`; ganze `npm test`-Suite PASS.
- `tsc -b`, ESLint, `npm run build:mobile` PASS.
- TF-6: offen bis nach Deploy.
- **Gate: GO.**

## 6. CI/CD & Deployment

- offen
