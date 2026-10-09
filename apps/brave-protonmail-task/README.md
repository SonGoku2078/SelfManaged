# SelfManaged – Proton Mail → Aufgabe (Brave/Chromium-Erweiterung)

Mails in Proton Mail anhaken → senden → vergessen. Jede Mail wird eine Aufgabe
in SelfManaged, **direkt online**, ohne App-Tab. Manifest V3, läuft in Brave,
Chrome und Edge.

## Nutzung

Alles landet standardmäßig in der **Inbox** (GTD: erst sammeln, beim Planen
einem Projekt zuordnen). Es wird kein Projekt „Inbox“ angelegt.

- **Mehrere Mails:** in der Proton-Liste **anhaken**, dann
  - **Alt+Shift+M** → alle in die Inbox, ohne Fenster, oder
  - **Icon / Alt+Shift+T** → Projekt wählen (Vorgabe 📥 Inbox) → Enter.
- **Eine offene Mail:** Rechtsklick in den Mail-Text → „Als Aufgabe zu
  SelfManaged (Inbox)“ / „… für Heute ☀️“, oder Alt+Shift+M, oder das Icon
  (Titel/Notiz/Projekt anpassen).
- **Text markieren** vor dem Klick → nur der markierte Teil landet in der Notiz.

Das Fenster schließt sofort; gesendet wird im Hintergrund. Das Icon zeigt
kurz ✓. Nur wenn etwas schiefgeht, gibt es ein **!** und eine Meldung.
In der App erscheinen die Aufgaben beim nächsten Abgleich (Fensterwechsel
oder spätestens nach einer Minute).

Je Mail: Betreff als Titel; Notiz mit Absender, Link zurück zur Mail und —
bei einer offenen Mail — dem Mail-Text.

*In der Mail-Liste* ersetzt Proton das Rechtsklick-Menü durch sein eigenes —
dort Alt+Shift+M oder das Icon nutzen. Kürzel ändern: `brave://extensions/shortcuts`.

## Einrichtung (einmalig)

1. **Appwrite: Erweiterung als Plattform eintragen** (nur einmal, für alle
   Geräte): Appwrite-Konsole → Projekt *selfmanaged-prod* → **Overview** →
   **Add platform** → **Web** (bzw. *Chrome extension*) → Hostname bzw.
   Extension-ID:

   ```
   mhejhliajgbncbdcjhnbbniakhbgipjk
   ```

   Die ID ist fest (Schlüssel `key` in `manifest.json`) — unabhängig davon, in
   welchem Ordner die Erweiterung liegt.
2. `brave://extensions` → **Entwicklermodus** an → **Entpackte Erweiterung
   laden** → diesen Ordner wählen. Erweiterung anpinnen.
3. Die Optionen öffnen sich: mit dem **SelfManaged-Konto anmelden**.
   Gespeichert wird nur die Sitzung, nie das Passwort.

Nach einem Update dieses Ordners in `brave://extensions` auf ↻ klicken.

## Funktionsweise

Die Erweiterung ruft dieselbe API-Funktion auf wie die App
(`apps/functions/api`, über die Appwrite Functions Execution API — wie der
MCP-Server in `apps/mcp/src/appwriteApi.ts`):

1. `GET /api/tasks` → höchste Nummer (der gespeicherte Zähler ist unzuverlässig),
2. je Mail `POST /api/tasks` (gleiche Felder wie `addTask` in `src/store.ts`),
3. `PATCH /api/settings { nextTaskNumber }`.

Die Sitzung liegt als `X-Fallback-Cookies` in `chrome.storage.local`.

**Testserver:** In den Optionen unter „Für Tests: anderer Server“ eine URL wie
`http://127.0.0.1:5173` setzen → ohne Anmeldung direkt an deren `/api`.

## Grenzen

- Die Selektoren in `extract.js` sind Protons eigene `data-testid`s
  (ProtonMail/WebClients, Stand 2026-10-09). Ändert Proton sie, fällt der
  Betreff auf den Tab-Titel zurück; dann `extract.js` nachziehen.
- Angehakte Mails liefern Betreff, Absender und Link, aber keinen Mail-Text
  (der steht erst beim Öffnen im Browser).
