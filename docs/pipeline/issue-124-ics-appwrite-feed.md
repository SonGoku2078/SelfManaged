# Kalender-Feed (ICS) auf Appwrite: URL kopierbar, 30 Min Standard, Zeitzone Zürich

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: Deploy-Freigabe `appwrite-v8`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-05 |

## 1. Requirements

- **GitHub Issue:** [#124](https://github.com/SonGoku2078/SelfManaged/issues/124)
- **Befund:** `selfmanaged-ics` lief live (200, falsches Token 404), aber die Einstellungen holten `/api/calendar-feed` per rohem `fetch` → unter Appwrite keine URL sichtbar. Standarddauer 60 Min, Uhrzeiten ohne Zeitzone.
- **ACs:** siehe Issue #124.

## 2. Architektur

- `calendarFeedApi.get()` (`src/api/other.ts`) über `apiFetch` → Appwrite-Execution mit User-JWT bzw. LAN-Server. Web `CalendarFeedSection` und Mobile `Settings` nutzen es.
- `apps/functions/ics/src/main.js`: Kalendertag per `Intl` in Europe/Zurich (unabhängig von der Function-TZ), `DTSTART/DTEND;TZID=Europe/Zurich` + `VTIMEZONE`, `UNTIL` in UTC, `DEFAULT_DURATION_MIN = 30`.
- `src/duration.ts` `DEFAULT_DURATION_MIN = 30` für die Desktop-Wochenansicht; Legacy-`server/src/ics.ts` ebenfalls 30.

## 3. Test

| TF | Prüft | AC | Ergebnis |
|---|---|---|---|
| TF-1 | `scripts/ics-appwrite.test.ts` (TZ=UTC und America/New_York): 30 Min, TZID, Zürich-Mitternacht, Winterzeit, über Mitternacht, UNTIL | AC2, AC3 | PASS |
| TF-2 | `scripts/ics.test.ts` (Legacy, 30 Min) | AC2 | PASS |
| TF-3 | `tsc -b`, ESLint, `build`, `build:mobile` | — | PASS |
| TF-4 | Live-Feed vor Release abgerufen: 200 / falsches Token 404 | — | PASS |
| TF-5 | URL in ⚙ Einstellungen sichtbar + kopierbar | AC1 | User, nach `appwrite-v8` / `mobile-v0.5.22` |

**Gate: GO.**

## 4. CI/CD

- PR → master, Tags `appwrite-v8` (Functions + Site) und `mobile-v0.5.22`.
