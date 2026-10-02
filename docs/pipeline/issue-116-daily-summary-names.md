# Mobile: 08:00-Übersicht mit Aufgabennamen

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: APK-Update installieren, Meldung am nächsten Morgen prüfen) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User-Screenshot „3 Aufgaben heute fällig", Wiederholung von #102) → /req-engineer
> - 2026-10-02 requirements-done (Issue #116) → architecture-done → implementation-done → testdesign-done
> - 2026-10-02 defects-open: Meldezeit 00:00 statt 08:00 (addDays setzt Mitternacht) → /developer → behoben
> - 2026-10-02 gate-go → /cicd-engineer (User: „gleich deployen")

## 1. Requirements

- **GitHub Issue:** [#116](https://github.com/SonGoku2078/SelfManaged/issues/116) — AC1–AC5.
- **Ursachen:** (a) #102 deckte nur „genau 1 Aufgabe" ab; (b) eine wiederholte 08:00-Meldung mit beim letzten Sync berechnetem Text → am nächsten Morgen ggf. Stand von gestern; (c) nur `dueDate` gezählt, ☀️ ignoriert.

## 2. Architektur

- Neuer reiner Builder `apps/mobile/src/dailySummary.ts` (`buildDailySummaries(tasks, now)`), ohne Capacitor-Import → testbar.
- 7 einmalige Meldungen (IDs 900001–900007) für die nächsten 7 Morgen statt `schedule.on`-Wiederholung; `scheduleReminders` storniert wie bisher alle offenen und plant bei jedem Sync neu.
- Inhalt je Tag über `mobileAgenda(tasks, day)` — dieselbe Regel wie der Heute-Tab (`mobileToday` nutzt sie jetzt auch).
- Android: `body` (eingeklappt, Namen mit „·") + `largeBody` (BigTextStyle, eine Zeile je Aufgabe).

## 3. Implementierung

Branch `fix/daily-summary-names`: `apps/mobile/src/dailySummary.ts` (neu), `notifications.ts`, `selectors.ts`, `scripts/dailysummary.test.ts` (neu, in `npm test`).

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Abends gesynct → erste Meldung morgen 08:00, 7 Meldungen, eindeutige IDs | AC3, AC5 |
| TF-2 | Inhalt morgen: fällige + ☀️ mit Namen, Uhrzeit zuerst; ohne Erledigte/Unteraufgaben | AC1, AC2 |
| TF-3 | Übermorgen: eigener Inhalt | AC3 |
| TF-4 | 1 Aufgabe → Titel + Deeplink; 0 → Hinweis | AC4 |
| TF-5 | Vor 08:00 → erste Meldung heute | AC5 |
| TF-6 | 11 Aufgaben → 8 Zeilen + „… und 3 weitere" | AC1 |

## 5. Testausführung & Gate

- Lauf 1: TF-1 **FAIL** — Meldezeit 00:00 (Defekt). Fix: Datum ohne `addDays`.
- Lauf 2: TF-1–TF-6 PASS (`scripts/dailysummary.test.ts`); `npm test`, `tsc -b`, `build:mobile`, ESLint — PASS.
- Nicht automatisierbar: Darstellung auf dem echten Android-Gerät → Nachprüfung durch User am nächsten Morgen.
- **Gate: GO.**

## 6. CI/CD & Deployment

- PR → master, Tag `mobile-v0.5.18` → APK-Release. Wirksam nach Installation + erstem Öffnen/Sync (plant die Meldungen neu).
