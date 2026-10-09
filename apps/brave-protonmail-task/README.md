# SelfManaged – Proton Mail → Aufgabe (Brave/Chromium-Erweiterung)

Macht aus der gerade offenen Proton-Mail mit einem Klick eine Aufgabe in
SelfManaged. Manifest V3, läuft in Brave, Chrome und Edge.

## Nutzung

Alles landet standardmäßig in der **Inbox** (GTD: erst sammeln, beim Planen
einem Projekt zuordnen). Es wird kein Projekt „Inbox“ angelegt.

- **Eine Mail:** Mail öffnen, dann
  - **Rechtsklick in den Mail-Text** → „Als Aufgabe zu SelfManaged (Inbox)“ /
    „… für Heute ☀️“ — ohne Fenster, das Icon zeigt kurz ✓, oder
  - **Alt+Shift+M** → direkt in die Inbox, oder
  - **Icon / Alt+Shift+T** → Titel, Notiz und **Projekt** wählen, Enter.
- **Mehrere Mails:** in der Proton-Liste **anhaken**, dann
  - **Icon / Alt+Shift+T** → Liste prüfen, **Projekt** wählen (Vorgabe Inbox),
    „N Aufgaben anlegen“, oder
  - **Alt+Shift+M** → alle direkt in die Inbox.
  Je Mail eine Aufgabe: Betreff als Titel, Absender + Link zur Mail als Notiz.
- **Text markieren** vor dem Klick → nur der markierte Teil landet in der Notiz.

*In der Mail-Liste* ersetzt Proton das Rechtsklick-Menü durch sein eigenes —
dort Alt+Shift+M oder das Icon nutzen.

## Funktionsweise

Die Erweiterung übergibt die Aufgabe an die **SelfManaged-Web-App in diesem
Browser** per Deep-Link:

```
<App-URL>/#/add?title=<Betreff>&note=<Notiz>[&project=<id>][&heute=1]
<App-URL>/#/add?tasks=[{"title":…,"note":…},…][&project=<id>]
```

Ist ein SelfManaged-Tab offen, wird er im Hintergrund wiederverwendet, sonst
öffnet sich einer im Hintergrund. Die App (`parseAddTaskHash` in
`src/config.ts`) legt die Aufgabe an und speichert sie über ihre normale
Sync-Warteschlange — auch offline. Danach entfernt sie den Link aus der
Adresszeile; daran erkennt die Erweiterung „angekommen“.

Die Projektliste liest die Erweiterung aus dem Offline-Speicher der App im
App-Tab (`tm-cache`).

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

Tastenkürzel ändern: `brave://extensions/shortcuts`.

Nach einem Update dieses Ordners in `brave://extensions` bei der Erweiterung
auf ↻ (Neu laden) klicken.

## Grenzen

- Die Selektoren in `extract.js` sind Protons eigene `data-testid`s
  (aus ProtonMail/WebClients, Stand 2026-10-09). Ändert Proton sie, fällt
  der Betreff auf den Tab-Titel zurück; dann `extract.js` nachziehen.
- Ist die Web-App abgemeldet, holt die Erweiterung den App-Tab nach vorn;
  nach dem Anmelden wird die Aufgabe automatisch angelegt (nicht nochmals
  klicken, sonst entsteht sie doppelt).
