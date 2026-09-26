# Mobile: Task per Diktat anlegen (Mikrofon-Button)

| Feld | Wert |
|---|---|
| Status | implementation-done |
| Nächste Rolle | User |
| Owner-Rolle | orchestrator |
| Datum | 2026-09-26 |
| Issue | [#101](https://github.com/SonGoku2078/SelfManaged/issues/101) |
| Bezug | Vereinfachte Sofort-Variante von `docs/pipeline/t4-06-voice-task-capture.md` (dort: KI-Interpretation, Web zuerst — zurückgestellt); dieses Issue: nur Mobile, kein KI-Schritt |

> Orchestrator-Log:
> - 2026-09-26 User bittet um Diktier-Button in der Mobile-App: Diktat = Titel, Task landet in Inbox, kein KI-Zwischenschritt. Issue #101 angelegt → `/developer`.
> - 2026-09-26 Developer implementiert Mikrofonbutton (`@capacitor-community/speech-recognition`) in `QuickAdd.tsx`; Build/Lint/`npm test` grün. Nativer Geräte-Test ist ausschließlich beim User möglich → `/user`.

## 1. Requirements
Siehe Issue #101 (AC-1..AC-6).

## 2. Architektur
- Neues Capacitor-Plugin für native Spracherkennung (z. B. `@capacitor-community/speech-recognition`), in `apps/mobile/package.json` + Android-Manifest-Permission (`RECORD_AUDIO`).
- Neue kleine Komponente (z. B. `apps/mobile/src/components/VoiceQuickAdd.tsx` oder Erweiterung der bestehenden Inbox-/Quick-Add-Komponente): Mikrofon-Button → Plugin-Aufruf → Ergebnistext ins bestehende Titel-Eingabefeld → bestehender „Task anlegen"-Flow (Inbox, kein Projekt) unverändert wiederverwendet.
- Keine neue Persistenz-/Sync-Logik — nutzt exakt den bestehenden lokalen Task-Anlage-Pfad der Mobile-App (Outbox/Sync bleibt unverändert).
- Berechtigungsfehler (Mikrofon verweigert) → Klartext-Hinweis in der UI, kein Absturz.

## 3. Implementierung
- **Branch:** `master` (direkt, siehe Pipeline-Vorgabe für dieses Issue).
- **Plugin-Wahl:** `@capacitor-community/speech-recognition@7.0.1`. Einzige gepflegte Community-Lösung für native Android-Spracherkennung über Capacitor; deren `peerDependencies` verlangen nur `@capacitor/core >= 7.0.0` (offene Obergrenze), daher installierbar neben den vorhandenen `@capacitor/*`-Paketen in `^8.x`. **Kompatibilitäts-Caveat:** Es existiert (Stand 2026-09-26) kein eigenes, für Capacitor 8 getestetes Release des Plugins — die letzte Version ist 7.0.1. Das Risiko wird als gering eingeschätzt, da das Plugin nur dünne Android-`SpeechRecognizer`-APIs kapselt (kein Bridge-Breaking-Change zwischen Capacitor 7/8 bekannt), aber ein echter Geräte-Smoke-Test ist deshalb umso wichtiger (siehe unten).
- **Files Changed:**
  - `apps/mobile/package.json` — neue Abhängigkeit `@capacitor-community/speech-recognition` (für `cap sync`, das dieses Manifest scannt)
  - `package.json`, `package-lock.json` (Repo-Root) — dieselbe Abhängigkeit im tatsächlich genutzten `node_modules` (Mobile-App nutzt das Root-`node_modules` laut `apps/mobile/vite.config.ts`)
  - `apps/mobile/android/app/src/main/AndroidManifest.xml` — `<uses-permission android:name="android.permission.RECORD_AUDIO" />`
  - `apps/mobile/src/voice.ts` (neu) — `ensureMicrophonePermission()`, `listenOnce()`; kapselt Verfügbarkeits-Check, Berechtigungsfluss und den einmaligen Diktier-Aufruf; Fehler werden zu deutschen Klartext-Meldungen statt Exceptions
  - `apps/mobile/src/components/QuickAdd.tsx` — Mikrofon-Button neben Eingabefeld/Add-Button; Tap → `listenOnce()` → Ergebnis füllt `title`-State (kein Auto-Submit, AC-3); Fehlertext erscheint unter der Zeile; bestehender `submit()`-Pfad (Inbox, `projectId: null` als Default) unverändert wiederverwendet
  - `apps/mobile/src/styles.css` — `.m-quickadd-wrap`, `.m-quickadd-mic` (inkl. Listening-Puls-Animation), `.m-quickadd-voice-error`
- **Key Code Sections:**
  - `apps/mobile/src/voice.ts`: `listenOnce()` prüft `SpeechRecognition.available()`, dann `ensureMicrophonePermission()` (check → request, analog zu `notifications.ts`s `ensureNotificationPermission()`), startet `SpeechRecognition.start({ language: 'de-DE', maxResults: 1, popup: false })` und liefert `{ ok: true, text }` oder `{ ok: false, error }`.
  - `apps/mobile/src/components/QuickAdd.tsx`: `dictate()` ruft `listenOnce()`, setzt bei Erfolg nur `setTitle(result.text)` — die Sichtkontrolle/Korrektur (AC-3) bleibt dadurch zwingend vor dem eigentlichen `submit()`.
- **Abweichungen von der Architektur:** keine inhaltliche; die Doku schlug optional `VoiceQuickAdd.tsx` als eigene Komponente vor — stattdessen wurde die Logik in `voice.ts` (Modul) + direkter Erweiterung von `QuickAdd.tsx` (UI) umgesetzt, da der Eingriff so minimal und lesbar bleibt (kein neues State-Sharing zwischen zwei Komponenten nötig).
- **Local Verification:**
  - [x] `npm run build:mobile` (Vite-Build der Mobile-App) — grün
  - [x] `npx tsc --noEmit -p apps/mobile` — keine Typfehler
  - [x] `npx eslint` auf `QuickAdd.tsx` + `voice.ts` — keine Befunde
  - [x] `npm test` (Root-Testsuite, alle Pakete inkl. `apps/mcp`, `apps/gpt-actions`) — grün, unbeeinflusst von den Mobile-Änderungen
  - [x] Self-Review des Codepfads: Diktat füllt nur `title`, kein Auto-Submit (AC-3); `projectId` bleibt `null` ohne `#Projekt`-Token im Diktat → Task landet in der Inbox (AC-4, bestehendes `addTask`-Default, keine neue Logik); Berechtigungsverweigerung/Fehler laufen über `try/catch` in `voice.ts` zu einer UI-Meldung, kein Crash (AC-5); es wird keine neue Persistenz-/Sync-Logik berührt (AC-6)
  - [ ] **Offen — nur beim User möglich:** echter Geräte-/Emulator-Test auf Android (kein Emulator in dieser Umgebung verfügbar). Insbesondere zu prüfen: Berechtigungsdialog erscheint und wird korrekt behandelt, Spracherkennung liefert tatsächlich Text, Verhalten bei Ablehnung/kein Mikrofon, sowie ob `@capacitor-community/speech-recognition@7.0.1` unter Capacitor 8 tatsächlich beschwerdefrei mit `cap sync` und auf dem Zielgerät läuft (Kompatibilitäts-Caveat oben).

**Offen bleibt ausschließlich der Anwender-Nachweis** (echter Diktier-Durchlauf auf einem Android-Gerät/Emulator, inkl. Berechtigungsdialog) — analog zum Gerätetest-Muster früherer Runden (z. B. `docs/pipeline/mcp-server.md`), da native Spracherkennung in dieser Umgebung nicht automatisiert verifizierbar ist.
