# Kalendertermine verlinken zurück in SelfManaged

| Feld | Wert |
|---|---|
| Status | gate-go |
| Nächste Rolle | cicd-engineer |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-10-26 |

> Orchestrator-Log:
> - 2026-10-26 gestartet (User-Wunsch: Termine im Kalender verschieben/Dauer ändern → Task synchron)
> - 2026-10-26 Analyse: Proton hat keine CalDAV/API, Abos sind read-only → Zwei-Wege-Sync unmöglich. User wählt Option 1 (Link zurück in die App).
> - 2026-10-26 requirements-done (Issue #154) → architecture → implementation → testdesign → gate-go
>
> Abkürzung (dokumentiert): kleines Feature, alle Rollen in einer Session durchlaufen.

## 1. Requirements

- **GitHub Issue:** [#154](https://github.com/SonGoku2078/SelfManaged/issues/154)
- Verworfen: Zwei-Wege-Sync mit Proton (keine Schnittstelle). Alternativen dokumentiert: SelfManaged als CalDAV-Server (nur für CalDAV-Clients, nicht Proton), Wechsel zu Google/Outlook.

## 2. Architektur

- `apps/functions/ics/src/main.js`: `SITE_URL` (Env `SITE_URL`, Default PROD-Site). `taskUrl` → `#/t/<number>` (bestehendes Hash-Routing in `App.tsx`), `projectUrl` → `?fenster=project&id=<id>` (`src/windows.ts`). Link als letzte Zeile in `DESCRIPTION` + `URL:`-Property.

## 3. Implementierung

Branch `feat/calendar-open-links`. Dateien: `apps/functions/ics/src/main.js`, `scripts/ics-appwrite.test.ts`.

## 4. Testdesign

| TF | Prüft | AC |
|---|---|---|
| TF-1 | Task mit Notiz: Link nach Notiz, `URL:` gesetzt | AC1 |
| TF-2 | Task ohne Notiz: nur Link | AC1 |
| TF-3 | Task ohne Nummer: kein `URL:` | AC3 |
| TF-4 | Blocker: Projektfenster-Link nach Taskliste, `URL:` | AC2 |
| TF-5 | Nach Deploy: Link in Proton anklicken → Task/Projekt offen | AC4 |

## 5. Testausführung & Gate

- TF-1–TF-4: `scripts/ics-appwrite.test.ts` PASS (TZ=UTC, America/New_York); ganze `npm test`-Suite PASS; ESLint PASS.
- TF-5: offen bis nach Deploy.
- **Gate: GO.**

## 6. CI/CD & Deployment

- offen
