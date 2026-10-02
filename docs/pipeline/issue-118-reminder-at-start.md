# Mobile: Erinnerung zur Startzeit, Vorlaufzeit zusätzlich

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: APK-Update installieren, einmal öffnen) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User: Erinnerung um 09:07 zur Startzeit, Vorlaufzeit zusätzlich) → /req-engineer
> - 2026-10-02 requirements-done (Issue #118) → architecture-done → implementation-done → testdesign-done → gate-go → /cicd-engineer

## 1. Requirements

- **GitHub Issue:** [#118](https://github.com/SonGoku2078/SelfManaged/issues/118) — AC1–AC5.
- **Befund:** `scheduleReminders` plante je Aufgabe genau eine Meldung bei `Start − Vorlaufzeit` (bei Vorlaufzeit > 0 also keine zur Startzeit) und nur für heute fällige Aufgaben.

## 2. Architektur

- Reiner Builder `buildTaskReminders(tasks, leadMin, now)` in `apps/mobile/src/dailySummary.ts`: je Aufgabe mit Startzeit im Fenster [jetzt, heute + 8 Tage) eine Meldung zur Startzeit (ID = Tasknummer) und bei Vorlaufzeit eine weitere davor (ID = Tasknummer + 1.000.000).
- `scheduleReminders` nutzt den Builder; Neuplanung bei jedem Sync wie bisher.
- Einstellungen: Texte „Zusätzliche Erinnerung vorher? (zur Startzeit wird immer erinnert)" / „+ N Minuten vorher".

## 3. Implementierung

Branch `fix/reminder-at-start`: `apps/mobile/src/dailySummary.ts`, `notifications.ts`, `components/Settings.tsx`, `scripts/dailysummary.test.ts`.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Ohne Vorlaufzeit: 09:07 heute + 09:07 morgen; vergangene/ohne Zeit/erledigte/ferne nicht | AC1, AC3, AC4 |
| TF-2 | Vorlaufzeit 15: 08:52 zusätzlich zu 09:07, eindeutige IDs | AC2 |
| TF-3 | Start in < Vorlaufzeit: nur die zur Startzeit | AC2 |

## 5. Testausführung & Gate

- TF-1–TF-3 PASS (`scripts/dailysummary.test.ts`, in `npm test`); `tsc -b`, `build:mobile`, ESLint — PASS.
- Nicht automatisierbar: Auslösung auf dem Gerät → Nachprüfung durch User. **Gate: GO.**

## 6. CI/CD & Deployment

- PR → master, Tag `mobile-v0.5.19` → APK-Release.
