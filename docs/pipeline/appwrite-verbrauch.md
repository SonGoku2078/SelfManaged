# Appwrite-Verbrauch: Projekt gesperrt (2026-11-06)

Branch `fix/appwrite-verbrauch`. Das Projekt «SelfManaged» (Org «privat», Free) wurde gesperrt.
Nach rund einem Tag zählte Appwrite 32,8 Mio. Lesezugriffe (Limit 500'000), 17,1 GB Bandbreite
(Limit 5 GB) und 36'900 Function-Ausführungen.

## Ursache (im Code belegt)

1. **Second Brain → MCP (Hauptursache, seit 2026-10-29).** Second Brain (`C:\dev\SecondBrain`,
   `lib/selfmanaged.js`) holte jede Minute für jeden `{{#nr}}`-Verweis in sichtbaren Notizen
   `task_holen` und für jedes betroffene Projekt `tasks_auflisten`. Jedes MCP-Werkzeug lud die
   ganze Task- und Projekt-Tabelle: 2 Ausführungen, rund 1'850 Lesezugriffe und rund 1 MB pro
   Aufruf. 12 Aufrufe pro Minute ergeben rund 35'000 Ausführungen, 32 Mio. Lesezugriffe und rund
   17–20 GB pro Tag. Angeheftete Notizfenster und ein verdecktes, nicht verstecktes Hauptfenster
   gelten als sichtbar.
2. **App, Fenster offen.** Die App lud alle 60 s alle 9 Tabellen (`loadAll`), dazu bei jedem
   Fokuswechsel. Das sind pro Fenster und Tag rund 950 volle Ladevorgänge mit je ~7'000 Zeilen
   (das `activity_log` wuchs auf Appwrite unbegrenzt). Dazu kam alle 15–30 s `/health`, auf dem
   Handy alle 12 s, jedes Mal als Function-Ausführung.
3. Kleinere Posten: Die ICS-Feeds lasen alle Tasks mit Fälligkeit und alle offenen Tasks plus alle
   Projekte, PATCH `/api/settings` las danach die ganze Tabelle.

Endlosschleifen gibt es keine. Die Outbox meldet anderen Fenstern nur dann eine Änderung, wenn
wirklich etwas beim Server ankam.

## Lösung

- **`GET /api/sync?since=<serverTime>`** (`apps/functions/api/src/sync.js`): Liefert nur geänderte
  Zeilen aller Tabellen in einer Ausführung (`$updatedAt > since − 30 s`), mit Cursor-Paging.
  Ohne Cursor, bei einem Cursor älter als 29 Tage oder ohne Tabelle `deletions`: alles (`full: true`).
- **Tombstones**: Jedes DELETE (auch mitgelöschte Subtasks, Projektinhalte) schreibt in derselben
  Transaktion eine Zeile in `deletions`. Aufbewahrung 30 Tage, das DELETE räumt Alte nebenbei ab.
  Ein ID-Abgleich wäre ohne neue Tabelle gegangen, kostet aber trotz `Query.select` einen
  Lesezugriff pro Zeile. Ein Lösch-Flag hätte jede Abfrage geändert. Als Sicherheitsnetz für
  Löschungen ohne Tombstone (z. B. in der Konsole) lädt die App höchstens alle 7 Tage einmal voll,
  auf dem Handy zusätzlich über «Jetzt synchronisieren».
- **MCP und gpt-actions** (`apps/mcp/src/syncedApi.ts`): Tasks, Projekte und Kategorien liegen im
  Speicher und werden höchstens alle 10 s per Delta abgeglichen. Der Stand liegt in
  `~/.selfmanaged/mcp-cache-<modus>.json`, damit ein Neustart kein Volllade auslöst
  (`TM_MCP_CACHE=off` schaltet die Datei ab). Neues Werkzeug `tasks_zustand`: viele Nummern in
  einem Aufruf.
- **App** (`src/sync/`, `src/useServerSync.ts`): Ein Pull ist ein Delta. Er kommt bei Rückkehr in
  den Vordergrund (höchstens alle 2 min), im fokussierten Fenster alle 5 min, in sichtbaren, aber
  nicht fokussierten Fenstern alle 15 min, in verdeckten Fenstern nie. Auf Appwrite gibt es keinen
  Health-Takt mehr; geprüft wird nur, solange offline. Die Outbox wird erneut angestossen, solange
  etwas wartet. Der Schutz für lokale Änderungen bleibt: Bei wartenden oder während des Abrufs
  entstandenen Änderungen wird nichts übernommen und der Cursor rückt nicht vor. Das Handy nutzt
  denselben Hook.
- **Aktivitätsprotokoll**: Nicht mehr im Sync. Die Ansicht lädt beim Öffnen die neuesten 200
  Einträge, die Function liefert auch alten Clients höchstens 500.
- **ICS**: Gelesen wird nur noch, was im Kalender landet. Erledigte Tasks nur aus den letzten
  60 Tagen, nur referenzierte Projekte, im Blocker-Feed nur offene Haupt-Tasks der blockierten
  Projekte in dieser Woche.
- **Express** (`server/`): Unbekannte `/api/*`-Routen liefern ein JSON-404 statt `index.html`.
  App und MCP fallen dort auf die bisherigen Tabellen-GETs zurück (lokal gratis).

## Schätzung

| | Vorher | Nachher |
|---|---|---|
| Lesezugriffe pro Tag, 1 Fenster (14 h sichtbar) | ~7 Mio. | ~1'000–3'000 |
| Ausführungen pro Tag, 1 Fenster | ~10'500 | ~200 |
| Second Brain, 10 min mit 20 Verweisen (Test) | ~320'000 Lesezugriffe | < 50 |
| ICS stündlich, beide Feeds, pro Tag | ~55'000 | ~1'000–10'000 |
| Monat (4 Fenster, Handy, MCP, ICS) | ~1 Mrd. Lesezugriffe | ~0,3–0,6 Mio. |

## Rollout (Reihenfolge)

1. `npm run appwrite:provision` legt die Tabelle `deletions` an (idempotent, Team-Rechte).
2. Function und Site deployen (`appwrite-v*`-Tag). Function vor Site ist egal: Ohne
   `/api/sync` fällt der Client auf volles Laden zurück, ohne `deletions` liefert die Function
   immer `full`.
3. Desktop-Apps neu starten und Browser-Tabs neu laden (Thin Client, kein neues Electron-Build).
4. Neues APK (`mobile-v*`). Alte APKs prüfen weiterhin alle 12 s `/health`.
5. MCP neu bauen, und zwar dort, wo `~/.claude.json` hinzeigt (Proton-Drive-Clone,
   `apps/mcp/dist`), danach Claude und Second Brain neu starten.
6. Second Brain: Patch `C:\dev\SecondBrain-selfmanaged-abfragen.patch` (Sammelaufruf, Takte 5/10 min).
