# Mobile: neuer Task oben + sichtbar, Teilen schnell, Heute/Next Week im Teilen-Dialog

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: Deploy-Freigabe `appwrite-v7`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-03 |

## 1. Requirements

- **GitHub Issue:** [#122](https://github.com/SonGoku2078/SelfManaged/issues/122)
- **Befund:** Inbox übernahm die Array-Reihenfolge (Desktop-Einstellung „oben/unten einfügen“, Server-Reload), Heute sortierte undatierte ☀️-Tasks ans Ende; Teilen legte immer in der Inbox an, auch wenn Heute offen war. AuthGate wartete bei jedem Kaltstart auf `account.get()`. Der Teilen-Dialog kannte nur Titel/Projekt/Beschreibung.
- **ACs:** siehe Issue #122.

## 2. Architektur

- `apps/mobile/src/selectors.ts`: `newestFirst` (createdAt absteigend) für `mobileInbox`, `mobileToday`; Next-Week-Gruppen als Tiebreaker. `mobileAgenda` (08:00-Übersicht) bleibt nach Fälligkeit.
- `apps/mobile/src/reveal.ts`: scrollt die Zeile (`data-flip-id`) in den Blick und hebt sie kurz hervor (`.m-row-new`).
- `ShareCapture`: Toggles ☀️/🗓️/★, `onSaved(task)`; `MobileApp` navigiert in die Ziel-Liste.
- `src/components/AuthGate.tsx`: mit lokalem Snapshot sofort `signed-in` + `loadAll`, `account.get()` im Hintergrund; echte Ablehnung → Login, Reload nach Login. Outbox behandelt 401 als transient (keine verlorenen Änderungen).

## 3. Testdesign & Ausführung

| TF | Prüft | AC | Ergebnis |
|---|---|---|---|
| TF-1 | Heute/Inbox/Next-Week: neuester zuerst (`scripts/mobilenewtop.test.ts`) | AC1 | PASS |
| TF-2 | Bestehende Heute-Regeln unverändert (`todayflag`, `todaymarker`, `dailysummary`) | — | PASS |
| TF-3 | `tsc -b`, `build:mobile`, ESLint (keine neuen Befunde) | — | PASS |
| TF-4 | AC2–AC5 Gerätetest | AC2–AC5 | User, mit `mobile-v0.5.21` |

**Gate: GO.**

## 4. CI/CD

- PR → master, Tags `mobile-v0.5.21` (APK) und `appwrite-v7` (Web/Desktop, AuthGate).
