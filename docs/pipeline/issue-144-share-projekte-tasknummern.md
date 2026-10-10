# #144 — Share-Projektauswahl wie Desktop + eindeutige Task-Nummern

| Feld | Wert |
|---|---|
| Status | gate-go |
| Nächste Rolle | /cicd-engineer |
| Owner-Rolle | orchestrator |
| Datum | 2026-10-10 |
| Issue | #144 (aus SelfManaged-Task #1775 „Projekt auswahl schlecht") |

> Orchestrator-Log:
> - 2026-10-10 Nutzer-Feedback direkt umgesetzt (Abkürzung: Req/Architektur/Dev in einem Durchgang, dokumentiert unten), danach Gate → /cicd-engineer
> - 2026-10-10 gate-go → Commit, PR, Merge, Tags appwrite-v16 + mobile-v0.5.25

## 1. Requirements

Siehe Issue #144. AC1–AC3: Share-Sheet (Android). AC4–AC6: Task-Nummern.

- **AC1:** Die Share-Projektauswahl entspricht dem Desktop-Panel: Inbox, dann die aktiven Projekte in manueller Reihenfolge (angepinnte zuerst), dann Areas. Someday-Projekte nur bei Suche, archivierte nie. Jedes Projekt hat seinen Farbpunkt.
- **AC2:** Der mobile Projekte-Tab hat dieselbe Reihenfolge (bisher alphabetisch).
- **AC3:** Speichern ist oben im fixierten Kopf und auch bei offener Tastatur erreichbar. Enter im Titel speichert, und die Projektwahl schliesst die Tastatur.
- **AC4:** Der Server vergibt keine Nummer doppelt, auch nicht bei gleichzeitigem Anlegen.
- **AC5:** Der Client übernimmt die Nummer aus der Server-Antwort.
- **AC6:** Altlasten werden einmalig repariert (der älteste Task behält die Nummer).

## 2. Architektur

- **Projektgruppen:** `apps/mobile/src/projectGroups.ts` (`groupProjects`) bildet dieselbe Gruppierung wie `src/components/ProjectsPanel.tsx`. Die Reihenfolge ist die Array-Reihenfolge im Store (der Server liefert nach `sort_order`), es wird also nicht neu sortiert.
- **Ursache der Doppelnummern:** Jeder Client (Desktop, Handy, MCP, Mail-Extension) berechnet #N lokal. Der Server (`apps/functions/api/src/main.js`) speichert die Nummer ungeprüft. Ein Unique-Index ist keine Option, weil PROD 130+ Altlasten hat (siehe `scripts/appwrite/schema.mjs`).
- **Lösung: Der Server hat das letzte Wort.**
  - **POST:** Eine belegte Nummer wird zu max+1. Ein Retry behält die gespeicherte Nummer. Nach dem Schreiben folgt ein Race-Check: Die ältere Zeile behält die Nummer, die neuere bekommt max+1.
  - **PATCH mit `number`:** Dieselbe Prüfung.
  - **`POST /api/tasks/renumber-duplicates`:** Repariert alle Altlasten in einer Ausführung. Das ist deterministisch, sodass zwei Geräte gleichzeitig dasselbe Ergebnis schreiben.
  - **Client:** `onTaskRenumbered` in der Outbox übernimmt die Server-Nummer. `loadAll` ruft die Reparatur höchstens einmal pro Sitzung auf, wenn `duplicateNumberTasks` etwas findet.
  - **Parität:** Der SQLite-Dev-Server (`server/src/routes/tasks.ts`) verhält sich gleich.

## 3. Implementierung

- **Mobile:** `ShareCapture.tsx`, `Projects.tsx`, `styles.css`, `projectGroups.ts`
- **Server und Funktion:** `apps/functions/api/src/main.js`, `server/src/routes/tasks.ts`
- **Client:** `src/api/outbox.ts`, `src/api/tasks.ts`, `src/store.ts`, `src/taskNumber.ts`
- **Doku:** Kommentar in `apps/mcp/src/logic.ts` angepasst

## 4. Testdesign

- **TC-A07 (erweitert):** `groupProjects` prüft Reihenfolge, Pinned-first, Areas, Someday/Archiv und Suche.
- **TC-A13 (neu, `scripts/tasknumber.test.ts`):** Die Funktions-Helfer laufen gegen eine In-Memory-TablesDB. Geprüft werden: belegte Nummer, freie Nummer, eigene Nummer, fehlende Nummer, Race (der ältere behält) und Altlasten-Reparatur inklusive Idempotenz. Ausserdem `duplicateNumberTasks` auf dem Client.
- **SQLite-Smoke** auf einer temporären DB: Kollision → max+1, Retry behält die Nummer, PATCH auf eine belegte Nummer → max+1.

## 5. Testausführung & Gate

- `node scripts/run-tests.mjs`: alle Auto-Tests pass (TC-A01…A13) inklusive Web- und Mobile-Build. Typecheck für Root, Server und Mobile ist ok.
- **Review des Diffs:** keine Defekte.
- **Restrisiko:** Bremst Appwrite die einmalige Reparatur per Rate-Limit (130+ Updates), bleibt sie unvollständig. Sie ist deterministisch und wird beim nächsten App-Start fortgesetzt.
- **Folge der Reparatur:** Umnummerierte Alt-Tasks bekommen neue #N. Alte Links auf diese Nummern waren ohnehin mehrdeutig.
- **Nicht geprüft:** das Share-Sheet auf einem echten Gerät (fixierter Kopf mit Tastatur). Das prüft der Nutzer nach der Installation der APK.
- **Gate: GO.**

## 6. CI/CD & Deployment

_(wird vom CI/CD-Schritt ergänzt)_
