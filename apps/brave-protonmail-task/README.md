# SelfManaged – Proton Mail → Aufgabe (Brave/Chromium-Erweiterung)

Macht aus der gerade offenen Proton-Mail mit einem Klick eine Aufgabe in
SelfManaged. Manifest V3, läuft in Brave, Chrome und Edge.

## Nutzung

- **Rechtsklick** irgendwo in der offenen Mail →
  **„Als Aufgabe zu SelfManaged (Inbox)“** oder **„Als Aufgabe für Heute ☀️“**.
  Kein Fenster, das Icon zeigt kurz ✓ (oder ! bei einem Problem).
- **Icon klicken** oder **Alt+Shift+T** → Titel/Notiz anpassen, optional
  „Für Heute einplanen“, **Enter**.
- **Text markieren** vor dem Klick → nur der markierte Teil landet in der Notiz.

Die Aufgabe bekommt den Betreff als Titel; die Notiz enthält Absender, den
Link zurück zur Mail und den Mail-Text (bis ~6000 Zeichen).

## Funktionsweise

Die Erweiterung übergibt die Aufgabe an die **SelfManaged-Web-App in diesem
Browser** per Deep-Link:

```
<App-URL>/#/add?title=<Betreff>&note=<Notiz>[&heute=1]
```

Ist ein SelfManaged-Tab offen, wird er im Hintergrund wiederverwendet, sonst
öffnet sich einer im Hintergrund. Die App (`parseAddTaskHash` in
`src/config.ts`) legt die Aufgabe an und speichert sie über ihre normale
Sync-Warteschlange — auch offline. Danach entfernt sie den Link aus der
Adresszeile; daran erkennt die Erweiterung „angekommen“.

Darum braucht die Erweiterung **kein Passwort und keinen Token**: Appwrite
erlaubt API-Aufrufe ohnehin nur von der eigenen App-Seite aus.

## Installation (einmalig)

1. In Brave einmal die SelfManaged-Web-App öffnen und **anmelden**
   (`https://selfmanaged-prod-6aaa45fb.appwrite.network`).
2. `brave://extensions` öffnen → oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** → diesen Ordner
   (`apps/brave-protonmail-task`) wählen. Erweiterung anpinnen.
4. Fertig — Standard-Ziel ist PROD. Für Tests unter **Optionen** eine andere
   App-URL setzen (z. B. `http://localhost:5173`).

Nach einem Update dieses Ordners in `brave://extensions` bei der Erweiterung
auf ↻ (Neu laden) klicken.

## Grenzen

- Die Selektoren in `extract.js` sind Protons eigene `data-testid`s
  (aus ProtonMail/WebClients, Stand 2026-10-09). Ändert Proton sie, fällt
  der Betreff auf den Tab-Titel zurück; dann `extract.js` nachziehen.
- Ist die Web-App abgemeldet, holt die Erweiterung den App-Tab nach vorn;
  nach dem Anmelden wird die Aufgabe automatisch angelegt (nicht nochmals
  klicken, sonst entsteht sie doppelt).
