# Mobile: Tages-Übersicht-Notification mit Taskname & Tap-Deeplink

| Feld | Wert |
|---|---|
| Status | blocked |
| Nächste Rolle | User (PR-Merge-Freigabe) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-09-29 |

> Orchestrator-Log:
> - 2026-09-29 gestartet → /req-engineer
> - 2026-09-29 requirements-done (Issue #102) → /architect
> - 2026-09-29 architecture-done → /developer
> - 2026-09-29 implementation-done (Branch feature/mobile-notification-deeplink, Commit 218befe) → /test-designer
> - 2026-09-29 testdesign-done (TF-1…TF-6, TF-6 = Geräte-Verifikation an User) → /test-manager
> - 2026-09-29 gate-go (TF-1…TF-5 PASS, TF-6 offen/kein Blocker) → /cicd-engineer
> - 2026-09-29 PR #104 erstellt, BLOCKED: wartet auf User-Merge-Freigabe (Projekt-Konvention)

## 0. PM-Briefing (Referenz)

Vollständiges Briefing: `PM_TASKS.md` → „### Briefing → /req-engineer: Mobile — Tages-Übersicht-Notification mit Taskname & Tap-Deeplink".

**Kurzfassung:** Bug in `apps/mobile/src/notifications.ts`, Funktion `scheduleReminders()`. Die tägliche 08:00-Sammel-Notification (`SUMMARY_ID`, ~Zeile 125–133) zeigt bei 1 fälligem Task nur generischen Zähltext ("1 Aufgabe heute fällig") statt dessen Namen und hat kein `extra.taskId` — springt beim Antippen also nicht in den Task. Die Einzel-Reminder-Notifications direkt darüber (~Zeile 108–123) machen es bereits richtig: Titel `⏰ ${t.title}` und `extra: { taskId: t.id }`; der Tap-Handler `onReminderTap()` existiert schon und ist verdrahtet — als Vorbild nutzen, nicht neu bauen.

**Ziel:** Bei genau 1 fälligem Task zeigt die 08:00-Notification dessen Namen und öffnet beim Antippen direkt den Task. Verhalten bei mehreren fälligen Tasks ist durch Req-Engineer/Architekt zu spezifizieren (Out-of-Scope: Widgets/Reminder-Vorschau-Erweiterung, das ist Issue #30).

**Verifikation:** Nur auf echtem Android-Gerät möglich (User bestätigt final).

## 1. Requirements

- **GitHub Issue:** [#102](https://github.com/SonGoku2078/SelfManaged/issues/102)
- **Feature:** Mobile: Tages-Übersicht-Notification mit Taskname & Tap-Deeplink
- **Nozbe-Referenz:** N/A — eigenständiges Mobile-Notification-Feature, kein Nozbe-UI-Vergleich.
- **Offene Frage geklärt (Verhalten bei >1 fälligem Task):** Zähltext bleibt bei >1 Task erhalten (kein Task ist eindeutig zuordenbar); Tap öffnet nur die App (kein Sprung in einen bestimmten Task). Nur der Fall "genau 1 Task fällig" bekommt Taskname + Tap-Deeplink.
- **Acceptance Criteria:** siehe Issue #102 (Given/When/Then, 7 ACs — 1 Task: Name+Deeplink, >1 Task: unverändert, 0 Tasks: unverändert, Einzel-Reminder: keine Regression, Geräte-Verifikation).
- **Technical Interfaces:**
  - Betroffene Funktion: `scheduleReminders(tasks: Task[], prefs: ReminderPrefs)` in `apps/mobile/src/notifications.ts`.
  - Wiederzuverwendender Mechanismus: `extra: { taskId }` + bestehender `onReminderTap(callback)`-Listener (bereits für Einzel-Reminder verdrahtet, siehe Zeile 41-52 und Aufrufstelle in `MobileApp.tsx`).
  - Kein neuer Tap-Handler nötig — nur die `SUMMARY_ID`-Notification muss bei `dueToday.length === 1` denselben `title`/`extra`-Aufbau wie die Einzel-Reminder bekommen.
- **Data Model:** Keine Änderung am Datenmodell (`Task`). Nur Notification-Payload (`title`, `body`, `extra.taskId`) für den 1-Task-Fall.
- **Browser-/Plattform-Anforderungen:** Nur nativ (Capacitor/Android) relevant — im Browser/Dev laufen die Notification-Aufrufe ohnehin still ins Leere (bestehendes Verhalten, siehe Kommentarkopf der Datei).

## 2. Architektur

### Betroffene Komponente

Keine neue Komponente/Datei nötig. Änderung ausschließlich in `apps/mobile/src/notifications.ts`, Funktion `scheduleReminders()`, im Abschnitt der die `SUMMARY_ID`-Notification zusammenbaut (aktuell Zeile ~125-133). Alles andere in der Datei (Channel-Setup, Einzel-Reminder-Loop, `onReminderTap`-Listener, Aufrufstelle in `MobileApp.tsx`) bleibt unverändert.

### Logik-Entwurf

Die bestehende `dueToday`-Liste (Zeile 103-105) ist bereits vorhanden und nach Startzeit ungefiltert — sie enthält alle heute fälligen Top-Level-Tasks (`!t.parentId && !t.completed && t.dueDate`), unabhängig davon ob sie eine `startMinutes`-Uhrzeit haben. Für die Summary-Notification wird daraus abgeleitet:

```
const single = dueToday.length === 1 ? dueToday[0] : null;

notifications.push({
  id: SUMMARY_ID,
  title: single ? `📋 ${single.title}` : '📋 SelfManaged',
  body: single
    ? 'Heute fällig — antippen für Details'
    : dueToday.length
      ? `${dueToday.length} Aufgaben heute fällig`
      : 'Heute keine fälligen Aufgaben 🎉',
  channelId,
  extra: single ? { taskId: single.id } : undefined,
  schedule: { on: { hour: 8, minute: 0 }, allowWhileIdle: true },
});
```

Begründung der Formulierung:
- `title` trägt bei genau 1 Task den Tasknamen (analog zum `⏰ ${t.title}`-Muster der Einzel-Reminder, aber mit dem bisherigen 📋-Icon der Summary statt ⏰, damit optisch weiter erkennbar ist "das ist die Tagesübersicht", nicht ein Zeit-Reminder).
- `body` bleibt bei 1 Task ein kurzer Hinweistext statt Wiederholung des Namens (der steht schon im Titel) — vermeidet Redundanz.
- Bei 0 oder >1 Tasks: **unverändert** gegenüber Ist-Zustand (Zähltext, kein `extra`) — erfüllt AC 3/4/5 aus Issue #102 (kein Sprung in einen bestimmten Task, wenn nicht eindeutig zuordenbar).
- `extra: undefined` statt `extra: { taskId: ... }` wenn nicht `single`: Capacitor/Android behandelt ein fehlendes `extra`-Feld wie bisher (Tap öffnet nur die App) — kein Verhaltensunterschied zum bestehenden Code, der `extra` für die Summary bisher gar nicht setzt.

### Schnittstellen (unverändert, nur referenziert)

- **Tap-Deeplink-Mechanismus:** `onReminderTap(callback)` (Zeile 43-52) liest `a.notification.extra?.taskId` und ruft `callback(taskId)`. Die Aufrufstelle in `MobileApp.tsx`, die daraus tatsächlich zum Task navigiert, bleibt unangetastet — sie funktioniert bereits für Einzel-Reminder und braucht keine Anpassung, weil die Summary-Notification jetzt denselben `extra`-Vertrag (`{ taskId }`) nutzt.
- **`ReminderPrefs`, `ensureChannels`, Permission-Handling:** keine Änderung.

### Trade-offs

- **Alternative verworfen:** Bei >1 fälligen Tasks den ersten/nächsten Task als Ziel nehmen und dorthin verlinken. Verworfen, weil das Requirement (Issue #102, AC 3/4) explizit "kein Sprung in einen bestimmten Task, wenn nicht eindeutig" verlangt — Nutzer könnte sonst denken, der verlinkte Task sei "der wichtige" von mehreren.
- **Alternative verworfen:** Separates Icon/Emoji für den 1-Task-Fall (z. B. ⏰ statt 📋). Beibehaltung von 📋 gewählt, damit die Summary-Notification (auch im 1-Task-Fall) visuell weiter als "Tagesübersicht" erkennbar bleibt und sich nicht mit den zeitgesteuerten Einzel-Remindern (⏰) verwechseln lässt, die parallel auftreten können.
- **Keine neue Utility-Funktion** für das title/body/extra-Bauen — der Block ist klein genug, um inline zu bleiben (kein Over-Engineering für 3 Fallunterscheidungen).

## 3. Implementierung

- **Branch:** `feature/mobile-notification-deeplink`
- **Commits:** `218befe` — "Implement mobile notification deeplink: Tagesuebersicht zeigt Taskname bei 1 faelligem Task (#102)"
- **Files Changed:**
  - `apps/mobile/src/notifications.ts` (Funktion `scheduleReminders()`, `SUMMARY_ID`-Notification-Block)
- **Key Code Sections:** `notifications.ts` — `const single = dueToday.length === 1 ? dueToday[0] : null;` gefolgt vom `SUMMARY_ID`-Push mit bedingtem `title`/`body`/`extra` exakt wie im Architektur-Abschnitt entworfen.
- **Local Verification:**
  - [x] TypeScript-Typecheck (`npx tsc --noEmit`) im `apps/mobile`-Package fehlerfrei.
  - [x] Logik gegen alle 3 Fälle (0 / 1 / >1 fällige Tasks) am Code durchgespielt — entspricht den ACs aus Issue #102.
  - [x] Bestehender Code-Pfad für Einzel-Reminder unverändert (kein Diff außerhalb des SUMMARY_ID-Blocks).
  - [ ] Auf echtem Android-Gerät verifiziert — **nicht möglich in dieser Umgebung** (kein Touch-Hardware-Zugriff), laut PM-Briefing/DoD ausdrücklich User-Verifikation vorgesehen.

## 4. Testdesign

### Teststrategie

Reine Notification-Erstellungslogik in `scheduleReminders()` — kein UI-Rendering, kein localStorage-Bezug. Zwei Ebenen:
1. **Logik-Verifikation ohne Gerät** (hier ausführbar): Die Funktion `scheduleReminders()` wird mit synthetischen `Task[]`-Arrays aufgerufen und die an `LocalNotifications.schedule()` übergebenen Notification-Objekte inspiziert (title/body/extra), da `@capacitor/local-notifications` im Node/Dev-Kontext ohnehin nur try/catch-geschluckt still fehlschlägt (siehe Dateikopf-Kommentar) — die eigentliche Objekt-Konstruktion läuft aber unabhängig vom nativen Aufruf durch.
2. **Geräte-Verifikation** (nicht hier ausführbar, an User delegiert): Tatsächliches Erscheinen der Notification um 08:00 und Tap-Verhalten auf echtem Android.

Kein Nozbe-Vergleich nötig (Feature ist kein Nozbe-UI-Element, siehe Requirements-Abschnitt).

### Testfälle

**TF-1 — Genau 1 fälliger Task (AC 1 + AC 2)**
- Voraussetzung: `tasks` enthält 1 Top-Level-Task mit `dueDate = heute`, `completed: false`.
- Schritte: `scheduleReminders(tasks, prefs)` aufrufen.
- Erwartet: Gepushtes `SUMMARY_ID`-Objekt hat `title: '📋 <Tasktitel>'`, `body: 'Heute fällig — antippen für Details'`, `extra: { taskId: <id des Tasks> }`.

**TF-2 — Mehrere fällige Tasks (AC 3 + AC 4)**
- Voraussetzung: `tasks` enthält 3 heute fällige Top-Level-Tasks.
- Erwartet: `title: '📋 SelfManaged'`, `body: '3 Aufgaben heute fällig'`, **kein** `extra`-Feld am `SUMMARY_ID`-Objekt.

**TF-3 — Keine fälligen Tasks (AC 5)**
- Voraussetzung: `tasks` leer oder ohne heute fällige Einträge.
- Erwartet: `title: '📋 SelfManaged'`, `body: 'Heute keine fälligen Aufgaben 🎉'`, kein `extra`.

**TF-4 — Subtask/erledigter Task wird nicht als "einzelner Task" gezählt (Edge-Case zu AC 1)**
- Voraussetzung: 1 heute fälliger Top-Level-Task + 1 heute fälliger Subtask (`parentId` gesetzt) + 1 heute fälliger, aber bereits `completed: true` Task.
- Erwartet: `dueToday`-Filter (bestehende Logik, unverändert) schließt Subtask und erledigten Task aus → weiterhin als "1 Task"-Fall behandelt (Titel des einen verbleibenden Top-Level-Tasks), nicht fälschlich als "3".

**TF-5 — Einzel-Reminder-Notifications unverändert (AC 6, Regressionstest)**
- Voraussetzung: 1 Task mit `startMinutes` gesetzt und `dueDate = heute`.
- Erwartet: Notification-Objekt für diesen Task (nicht `SUMMARY_ID`) hat weiterhin `title: '⏰ <Tasktitel>'`, `body` mit Vorlaufzeit-Text, `extra: { taskId }` — exakt wie vor der Änderung (kein Diff am Einzel-Reminder-Codepfad, siehe Implementierung).

**TF-6 — Geräte-Verifikation (AC 7, an User delegiert)**
- Voraussetzung: Android-Gerät, App installiert, Benachrichtigungsrecht erteilt, genau 1 Task für heute angelegt.
- Schritte: Bis 08:00 warten (oder Testmechanismus nutzen, falls vorhanden) → Notification-Shade prüfen → auf Notification tippen.
- Erwartet: Notification zeigt Tasknamen; Tap öffnet App direkt im Task-Detail.
- **Hinweis:** Kann nicht von einer Code-Umgebung aus ausgeführt werden — wird dem Test-Manager als offener Punkt für User-Verifikation übergeben (vgl. bereits zurückgestelltes „Mobile Gestures"-Item in `PM_TASKS.md`, gleiche Einschränkung).

### Nozbe-Vergleich

Entfällt — kein Nozbe-Referenzfeature (siehe `## 1. Requirements`).

## 5. Testausführung & Gate

### Test Results

Ausgeführt gegen Branch `feature/mobile-notification-deeplink`, Commit `218befe`. Da `@capacitor/local-notifications` außerhalb eines nativen Android-Kontexts nicht lauffähig ist und `apps/mobile` kein Test-Framework/Mocking-Setup hat, wurde die SUMMARY_ID-Blocklogik line-for-line in einem isolierten Node-Script nachgebildet (aus dem tatsächlichen Diff des Commits übernommen, siehe unten) und gegen die Testfälle geprüft.

| Testfall | Ergebnis |
|---|---|
| TF-1 (1 Task → Name + `extra.taskId`) | ✅ PASS — title, body, extra korrekt |
| TF-2 (3 Tasks → Zähltext, kein extra) | ✅ PASS |
| TF-3 (0 Tasks → Feier-Text, kein extra) | ✅ PASS |
| TF-4 (Subtask + erledigter Task nicht mitgezählt) | ✅ PASS — `dueToday`-Filter (unverändert) schließt beide korrekt aus, 1-Task-Fall bleibt korrekt erkannt |
| TF-5 (Einzel-Reminder unverändert) | ✅ PASS — `git diff master...feature/mobile-notification-deeplink -- apps/mobile/src/notifications.ts` zeigt ausschließlich den SUMMARY_ID-Block verändert (Zeile 125-139), Einzel-Reminder-Loop (Zeile 108-123) unangetastet |
| TF-6 (Geräte-Verifikation) | ⏳ OFFEN — an User delegiert, siehe unten |

11/11 Logik-Assertions bestanden (TF-1 bis TF-4).

### Defekte

Keine.

### Nozbe-Vergleich

Entfällt (siehe Testdesign).

### Offener Punkt (kein Blocker)

TF-6 (Notification erscheint auf echtem Android-Gerät mit korrektem Text, Tap springt in Task) kann in dieser Umgebung nicht ausgeführt werden. Das ist im PM-Briefing/DoD (`PM_TASKS.md`) explizit als User-Verifikation vorgesehen — kein Automatisierungs-Blocker für diese Pipeline-Stufe. **User-Aktion nach Deployment:** App auf Android aktualisieren, 1 Task für heute mit `dueDate` anlegen, 08:00-Notification prüfen (Name im Titel, Tap → Task-Detail).

### Quality Gate Decision

**GATE: GO**
Begründung: Alle automatisiert prüfbaren ACs (1-5 aus Issue #102) bestehen, keine Defekte, keine Regression am bestehenden Einzel-Reminder-Verhalten. AC 7 (Geräte-Verifikation) ist laut PM-DoD bewusst User-seitig, nicht Teil des automatisierten Gates.
Owner-Rolle: `/cicd-engineer`

## 6. CI/CD & Deployment

- **PR:** [#104](https://github.com/SonGoku2078/SelfManaged/pull/104)
- **Branch:** `feature/mobile-notification-deeplink` (gepusht zu origin)
- **Merge-Commit:** noch offen — **wartet auf User-Freigabe** (Projekt-Konvention: alle bisherigen PRs in diesem Repo wurden vom User selbst gemergt, nicht automatisiert von der Pipeline, z. B. #91, #94, #95, #97, #99; ebenso #98 aktuell "wartet auf User: Merge-Freigabe"). Kein eigenmächtiger Merge durch CI/CD-Rolle.
- **Test Status:** Gate GO (siehe Abschnitt 5), TF-6 Geräte-Verifikation offen.
- **Deployment:** Noch nicht live. Nach Merge zusätzlich: neuer Android-Build/APK-Release nötig (Mobile-App, kein reiner Web-Deploy) — das obliegt dem User (vgl. bestehende Mobile-Release-Praxis, z. B. `mobile-v*`-Tags).

### Summary
Feature "Mobile: Tages-Übersicht-Notification mit Taskname & Tap-Deeplink" ist code-fertig, getestet (Gate GO) und als PR #104 bereit. **Nächster Schritt liegt beim User:** PR reviewen + mergen, danach neuen Mobile-Build/APK erstellen und auf dem Gerät testen (TF-6).
