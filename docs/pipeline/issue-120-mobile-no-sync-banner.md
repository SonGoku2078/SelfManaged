# Mobile: Sync-/Offline-Balken entfernen

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: APK-Update installieren) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-02 |

> Orchestrator-Log:
> - 2026-10-02 gestartet (User: Balken schiebt Liste bei jedem Abhaken) → /req-engineer
> - 2026-10-02 requirements-done (Issue #120) → architecture-done → implementation-done → testdesign-done → gate-go → /cicd-engineer

## 1. Requirements

- **GitHub Issue:** [#120](https://github.com/SonGoku2078/SelfManaged/issues/120) — AC1–AC4.
- Pendant zum Desktop (#106: dort schwebender Toast); für Mobile wünscht der User gar keine Anzeige.

## 2. Architektur

- `MobileApp`: die drei Balken (`m-sync-banner`, `m-pending-offline`, `m-offline-banner`) entfernt, samt `pending`-State und CSS. `useAutoSync()` läuft unverändert.
- `Settings`: abonniert die Outbox-Anzahl und zeigt sie im Hinweis unter „Jetzt synchronisieren".
- Pull-to-Refresh unverändert (zeigt beim Ziehen „✕ Server nicht erreichbar").

## 3. Implementierung

Branch `fix/mobile-no-sync-banner`: `apps/mobile/src/components/MobileApp.tsx`, `Settings.tsx`, `styles.css`.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Abhaken bei künstlich verlangsamter API (1,5 s): kein Balken-Element im DOM | AC1 |
| TF-2 | Kopfzeile bleibt an derselben Position | AC2 |
| TF-3 | Andere Aufgaben werden nie nach unten verschoben (nur hoch, wenn die erledigte verschwindet) | AC2 |
| TF-4 | Hintergrund-Sync/Pull-to-Refresh/Settings-Hinweis (Code-Review + Build) | AC3, AC4 |

## 5. Testausführung & Gate

- TF-1–TF-3: Playwright headless (Mobile-Viewport) gegen Test-Instanz — 3/3 PASS.
- TF-4: Review PASS; `tsc -b`, Mobile-Typecheck, `build:mobile`, `npm test` — PASS; ESLint ohne neue Befunde. **Gate: GO.**

## 6. CI/CD & Deployment

- PR → master, Tag `mobile-v0.5.20` → APK-Release.
