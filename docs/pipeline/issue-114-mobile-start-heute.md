# Mobile: App startet immer in Heute

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: APK-Update installieren) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User-Wunsch) → /req-engineer
> - 2026-10-02 requirements-done (Issue #114) → architecture-done → implementation-done → testdesign-done → gate-go → /cicd-engineer (User: „wenn getestet und abgenommen, gleich deployen")

## 1. Requirements

- **GitHub Issue:** [#114](https://github.com/SonGoku2078/SelfManaged/issues/114) — AC1–AC5.
- **Nozbe-Referenz:** Nozbe-Mobile öffnet auf der zuletzt gewählten Ansicht; hier bewusste User-Vorgabe „immer Heute".

## 2. Architektur

- `useNavHistory`: Startzustand `HOME` = Tab `today` (war `projekte`); neue `reset()` setzt den Verlauf auf `[HOME]`.
- `MobileApp`: `visibilitychange` misst die Hintergrundzeit; ab 30 s → `reset()`. Android hält die App beim Zurückholen meist im Speicher (kein Kaltstart) — ohne diesen Reset bliebe der alte Tab.
- Schutz: Erinnerungs-Tipp setzt einen Zeitstempel; ein Reset innerhalb von 2 s danach entfällt. Teilen-Flow (`share`) liegt außerhalb des Nav-Verlaufs, unberührt.

## 3. Implementierung

Branch `feat/mobile-start-heute`: `apps/mobile/src/useNavHistory.ts`, `apps/mobile/src/components/MobileApp.tsx`.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Kaltstart zeigt Titel „Heute" | AC1 |
| TF-2 | Inbox → 10 s Hintergrund → weiterhin Inbox | AC3 |
| TF-3 | Inbox → 45 s Hintergrund → Heute | AC2 |
| TF-4 | Erinnerungs-Tipp vs. Reset (Code-Review: Zeitstempel-Schutz) | AC4 |
| TF-5 | Teilen-Flow unverändert (Code-Review: außerhalb Nav-State) | AC5 |

## 5. Testausführung & Gate

- TF-1–TF-3: Playwright headless (Mobile-Viewport, gemockte Uhr + visibilitychange) gegen Test-Instanz — 4/4 PASS.
- TF-4/TF-5: Review PASS; echte Android-Benachrichtigung nicht automatisierbar → Nachprüfung durch User.
- `tsc -b`, `npm test`, `build:mobile` — PASS; ESLint ohne neue Befunde. **Gate: GO.**

## 6. CI/CD & Deployment

- PR → master, Tag `mobile-v0.5.17` → APK-Release (enthält auch #112 ☀️-Übertrag).
