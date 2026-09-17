# Appwrite-Migration — PROD in Appwrite, TEST lokal

| Feld | Wert |
|---|---|
| Status | architecture-done |
| Nächste Rolle | /developer |
| Owner-Rolle | architect |
| Datum | 2026-09-16 |

> Orchestrator-Log:
> - 2026-09-16 gestartet: Vollständiger Umzug des bestehenden React-/Express-/SQLite-Systems zu Appwrite.
> - 2026-09-16 Appwrite-API-Verbindung zum vorhandenen Projekt erfolgreich geprüft; noch keine Site angelegt.
> - 2026-09-16 Ist-Stand: neun SQLite-Tabellen, elf Express-Routenmodule, Web-/Mobile-/MCP-Clients und bestehende PROD-Daten auf separatem LAN-Server müssen berücksichtigt werden.
> - 2026-09-16 Nutzerentscheidung: Nur PROD wird nach Appwrite migriert. Entwicklung und TEST bleiben lokal mit lokaler `dev.db`; kein zweites Appwrite-Projekt.
> - 2026-09-16 Das vorhandene Appwrite-Projekt `6aaa45fb0024f97b2b00` ist das PROD-Ziel. Der bisherige Wohnzimmer-Server bleibt bis zum Cutover aktiv und danach zunächst Rollback.
> - 2026-09-16 Übergabe an /req-engineer: PROD-Zieltopologie, klare lokale-TEST/Cloud-PROD-Trennung, Auth-/Berechtigungsmodell, Datenmigration, Sonderendpunkte, Cutover und Rollback mit prüfbaren Acceptance Criteria spezifizieren.
> - 2026-09-16 Requirements abgeschlossen; GitHub Issue #96 erstellt → /architect.
> - 2026-09-16 Architektur abgeschlossen: statische Site + TablesDB + Storage + zwei Functions (API/ICS), lokale REST-/SQLite-Entwicklung bleibt erhalten → /developer.

## 1. Requirements

- **GitHub Issue:** [#96](https://github.com/SonGoku2078/Task-Manager/issues/96)
- **Feature:** SelfManaged PROD vollständig nach Appwrite Cloud migrieren
- **Ausgangslage:** Die produktive React-Anwendung wird derzeit zusammen mit einer Express-API und einer SQLite-Datenbank auf einem separaten LAN-Rechner betrieben. Entwicklung und Test laufen lokal mit einer getrennten `dev.db`.
- **Ziel:** Das vorhandene Appwrite-Projekt `6aaa45fb0024f97b2b00` übernimmt ausschließlich PROD. Lokale Entwicklung und Tests bleiben unabhängig und dürfen niemals auf PROD-Daten schreiben.
- **Rahmen:** Appwrite Free mit einer Site, einer Datenbank, einem Bucket und höchstens zwei Functions. Der vorhandene LAN-Server bleibt bis zum erfolgreichen Cutover das führende PROD-System und anschließend vorübergehend Rollback.

### Acceptance Criteria

- [ ] **AC1 – Umgebungstrennung:** Given ein lokaler Dev-/Test-Build, when die Anwendung startet, then verwendet sie ausschließlich den lokalen Express-Server und `dev.db`; Appwrite PROD wird weder gelesen noch beschrieben.
- [ ] **AC2 – Cloud-PROD:** Given der freigegebene Produktionsstand, when die Appwrite-Site geöffnet wird, then lädt sie vollständig über HTTPS und verwendet ausschließlich Ressourcen des festgelegten Appwrite-PROD-Projekts.
- [ ] **AC3 – Authentifizierung:** Given ein nicht angemeldeter Besucher, when er die PROD-Site öffnet, then sind keine Task-, Projekt-, Mitglieder-, Einstellungs- oder Aktivitätsdaten les- oder veränderbar. Ein freigegebener Benutzer kann sich sicher anmelden und abmelden.
- [ ] **AC4 – Autorisierung:** Given ein authentifizierter Benutzer, when er Daten liest oder verändert, then greifen explizite Appwrite-Berechtigungen; kein administrativer API-Key ist im Browser-, Mobile- oder Repository-Code enthalten.
- [ ] **AC5 – Datenmodell:** Given das bestehende SQLite-Schema, when Appwrite provisioniert wird, then sind Tasks, Projekte, Kategorien, Mitglieder, Sektionen, Blocker, gespeicherte Ansichten, Aktivitätslog und Einstellungen mit benötigten Typen, Pflichtfeldern, Beziehungen und Indizes abgebildet.
- [ ] **AC6 – Funktionsgleichheit:** Given ein angemeldeter Benutzer, when er vorhandene Web-Funktionen nutzt, then funktionieren CRUD, Reorder, Wiederholungen, Unteraufgaben, Kommentare, Anhänge, Links, Suche, Kalender, Einstellungen und Aktivitätslog mindestens wie vor der Migration.
- [ ] **AC7 – Atomare Fachlogik:** Given eine Operation mit mehreren abhängigen Änderungen, when sie ausgeführt wird, then verhindert serverseitige Logik inkonsistente Zwischenstände, doppelte Tasknummern und unvollständige Wiederholungs-/Löschoperationen.
- [ ] **AC8 – Dateien:** Given ein Task-Anhang, when er hochgeladen, angezeigt oder entfernt wird, then liegt die Binärdatei im Appwrite-Storage-Bucket und nur Metadaten/Referenzen liegen am Task; bestehende Data-URL-Anhänge werden migriert.
- [ ] **AC9 – ICS:** Given ein gültiger, widerrufbarer Kalender-Token, when die öffentliche ICS-URL abgerufen wird, then wird ein valider Kalenderfeed ohne Offenlegung anderer Daten geliefert; ungültige Tokens werden abgewiesen.
- [ ] **AC10 – Web/Mobile/MCP:** Given die drei Clients Web, Mobile und lokaler MCP-Server, when sie gegen PROD konfiguriert sind, then verwenden sie die neue Appwrite-Schnittstelle mit jeweils passender Authentisierung und unterstützen ihre bisherigen produktiven Funktionen.
- [ ] **AC11 – Datenmigration:** Given ein konsistenter Export der bestehenden PROD-SQLite-Datenbank, when der Import einmalig ausgeführt wird, then werden alle unterstützten Datensätze und Anhänge vollständig, referenziell korrekt und wiederholbar/verifizierbar übertragen; Quelle und Ziel werden mengen- und stichprobenmäßig verglichen.
- [ ] **AC12 – Cutover-Schutz:** Given der finale Import, when das Cutover beginnt, then wird die alte PROD-Anwendung für Schreibzugriffe gesperrt oder kontrolliert gestoppt, sodass nach dem Export keine Änderungen verloren gehen.
- [ ] **AC13 – Verifikation:** Given ein Appwrite-PROD-Kandidat, when Build, Unit-/Integrationstests, Migrationsprüfung und definierte Smoke-Tests ausgeführt werden, then sind alle verpflichtenden Prüfungen grün, bevor die Site aktiviert wird.
- [ ] **AC14 – Rollback:** Given ein Blocker nach Aktivierung, when Rollback ausgelöst wird, then kann innerhalb des dokumentierten Zeitfensters auf den unveränderten LAN-Server zurückgeschaltet werden; Appwrite-Änderungen seit Cutover werden dabei ausdrücklich behandelt.
- [ ] **AC15 – Betrieb:** Given die aktive Free-Umgebung, when Limits, Pausierung oder Fehler auftreten, then existieren dokumentierte Wiederanlauf-, Export-/Backup- und Monitoring-Schritte ohne Abhängigkeit von einem geheimen Schlüssel im Repository.
- [ ] **AC16 – Geheimnisse:** Given Build, Logs und Versionsverwaltung, when Konfiguration verarbeitet wird, then erscheinen API-Keys, Session-Geheimnisse und Import-Credentials weder in Git noch im ausgelieferten Bundle oder in Test-/Build-Logs.

### Technische Schnittstellen

- **Web:** React/Vite; Appwrite Web SDK für Auth, TablesDB, Storage und ggf. Function-Aufrufe.
- **Mobile:** Capacitor-App; gleiche fachliche Datenbasis, persistierte Benutzersitzung, Offline-Outbox bleibt funktionsfähig.
- **MCP:** lokaler Node-Prozess; authentisierter Zugriff ohne im Frontend verwendeten Admin-Key.
- **Migration:** read-only SQLite-Export vom bisherigen PROD-System; idempotenter bzw. kontrolliert einmaliger Import mit Prüfbericht.
- **Öffentlich:** Site und ICS-Endpunkt ausschließlich über HTTPS; sonstige Datenzugriffe authentisiert.

### Fachliches Datenmodell

- Kernressourcen: `tasks`, `projects`, `categories`, `members`, `sections`, `blockers`, `saved_views`, `activity_log`, `settings`.
- Task-Beziehungen: Projekt, Parent-Task, Sektion, Kategorien, Verantwortliche, verknüpftes Projekt sowie Anhänge.
- Bestehende stabile IDs und Tasknummern bleiben beim Import erhalten.
- Zeitwerte werden eindeutig als ISO-8601/UTC oder ausdrücklich als lokales Datum (`YYYY-MM-DD`) behandelt.
- JSON-Felder aus SQLite werden in native Appwrite-Felder/Relationen zerlegt, wenn dies Abfragen, Berechtigungen oder Integrität verbessert; die endgültige Abbildung bestimmt die Architektur.

### Nicht-Ziele

- Kein Appwrite-TEST-Projekt und keine Cloud-Testdatenbank.
- Kein Abschalten oder Löschen des bisherigen PROD-Servers im Migrationslauf.
- Keine ungeprüfte Änderung des Funktionsumfangs oder visuelle Neugestaltung.
- Kein produktiver Cutover ohne ausdrückliche Nutzerfreigabe nach Test- und Migrationsreport.

## 2. Architektur

### 2.1 Zieltopologie

```text
Browser / Capacitor / lokaler MCP
        │ Appwrite Auth-Session → kurzlebiges JWT
        ▼
Appwrite Site (React/Vite, statisch, HTTPS)
        │ x-appwrite-user-jwt
        ▼
Function 1: selfmanaged-api (Node 22)
        │ Benutzer-JWT, Transaktionen, Validierung
        ├── TablesDB: selfmanaged-prod
        └── Storage: task-attachments

Öffentlicher Kalender-Client
        │ /calendar/<opaque-token>.ics
        ▼
Function 2: selfmanaged-ics (Node 22)
        │ eigener minimaler dynamischer Key, Token-Prüfung
        └── TablesDB (read-only für tasks/settings)
```

Der React-Build ist statisch. Es gibt keinen dauerhaften Node-/Express-Prozess und keine SQLite-Datei in Appwrite. Appwrite Auth stellt die Benutzeridentität bereit; TablesDB ist die einzige PROD-Datenquelle.

### 2.2 Umgebungsumschaltung

- `VITE_DEPLOY_TARGET=local` (Standard für Dev/Test): bestehende relative `/api/*`-Aufrufe, Vite-Proxy, lokaler Express-Server und `dev.db`.
- `VITE_DEPLOY_TARGET=appwrite` (nur Site-Build): Appwrite Web SDK, PROD-Project-ID und API-Function-Domain aus öffentlichen Buildvariablen. Kein API-Key im Bundle.
- Die Adaptergrenze liegt unterhalb des Zustand-Stores. Komponenten und fachliche Store-Actions bleiben unverändert.
- `.env.development` bleibt lokal. Appwrite-Site-Variablen enthalten ausschließlich öffentliche IDs/URLs; Secrets liegen nur in Appwrite-Function-Variablen bzw. dynamischen Function-Keys.

### 2.3 Komponenten und Module

- `src/appwrite/client.ts`: Web-Client, Account/Auth und JWT-Erneuerung.
- `src/components/AuthGate.tsx`: Session laden, Login, Logout und geschütztes Rendern.
- `src/api/client.ts`: gemeinsamer HTTP-Transport; lokal unverändert, PROD mit Function-Base-URL und frischem Benutzer-JWT.
- Bestehende `src/api/*.ts`: REST-Verträge bleiben erhalten.
- `apps/functions/api/`: Router/Handler, DTO-Konvertierung, Validierung, Berechtigungsprüfung und TablesDB-Repositories.
- `apps/functions/ics/`: isolierter GET-Handler für Feed-Info/ICS mit Tokenprüfung.
- `scripts/appwrite/provision.mjs`: idempotente Anlage/Prüfung von Datenbank, Tabellen, Spalten, Indizes, Bucket, Functions und Site-Konfiguration.
- `scripts/appwrite/export-sqlite.mjs`: read-only Export in ein versioniertes Manifestformat.
- `scripts/appwrite/import.mjs`: kontrollierter Import mit Mapping, Upload der Anhänge und Prüfbericht.
- `scripts/appwrite/verify.mjs`: Counts, Fremdschlüssel-/ID-Prüfung und Stichproben-Hashes.

### 2.4 TablesDB-Datenmodell

Eine Datenbank `selfmanaged-prod`; Tabellen- und Spaltennamen verwenden die bestehenden fachlichen Namen in `camelCase`. Appwrite-Systemfelder (`$id`, `$createdAt`, `$updatedAt`) werden nicht als Fachfelder missbraucht.

| Tabelle | Wesentliche Spalten | Indizes |
|---|---|---|
| `tasks` | `legacyId`, `number`, `title`, `description`, `projectId`, `parentId`, `sectionId`, `dueDate`, `startMinutes`, `durationMin`, `priority`, Statusflags, Wiederholungsfelder, `completedAt`, `createdAt`, `updatedAt`, `nozbeId`, `sortOrder`, `categoryIds[]`, `assigneeIds[]`, `commentsJson`, `linksJson`, `linkedProjectId`, `focusSeconds` | unique `number`; `projectId`; `parentId`; `dueDate`; `sortOrder`; `completed`; Volltext/Schlüsselwort auf `title` soweit vom Plan unterstützt |
| `projects` | `legacyId`, `name`, `color`, `icon`, `label`, `pinned`, `active`, `kind`, `description`, `sortOrder`, `nozbeId`, `parentAreaId`, `archived` | `sortOrder`; `kind`; `parentAreaId`; `archived` |
| `categories` | `legacyId`, `name`, `color`, `sortOrder`, `nozbeId` | `sortOrder`; `name` |
| `members` | `legacyId`, `name`, `role`, `color`, `avatarFileId` | `name` |
| `sections` | `legacyId`, `scope`, `name`, `sortOrder` | `scope+sortOrder` |
| `blockers` | `legacyId`, `projectId`, `weekdays[]`, `startMinutes`, `durationMin` | `projectId` |
| `saved_views` | `legacyId`, `name`, `filtersJson`, `sortField`, `sortDir`, `searchQuery`, `sortOrder` | `sortOrder` |
| `activity_log` | `legacyId`, `at`, `actor`, `kind`, `taskId`, `taskNumber`, `taskTitle`, `field`, `fromValue`, `toValue`, `payloadJson` | `at`; `taskId` |
| `settings` | `key`, `valueJson` | unique `key` |
| `task_attachments` | `legacyId`, `taskId`, `fileId`, `name`, `mimeType`, `size`, `createdAt` | `taskId`; `fileId` |

Appwrite `$id` wird deterministisch aus der vorhandenen ID übernommen, sofern gültig. Andernfalls wird ein stabiler Hash als `$id` verwendet und die unveränderte Quell-ID bleibt in `legacyId`; die Client-DTOs liefern weiterhin die fachliche ID. Dadurch bleiben Links und Referenzen stabil.

Bewusst werden zunächst ID-Spalten statt Appwrite-Relationship-Spalten verwendet. Gründe: verlustfreier Import bestehender IDs, einfache REST-Kompatibilität, kontrolliertes Löschverhalten und weniger Berechtigungs-/Ladetiefenkomplexität. Referenzintegrität prüft die API-Function vor Writes und das Verifikationsskript nach Imports.

### 2.5 Berechtigungsmodell

- Registrierung in PROD ist deaktiviert; Benutzer werden administrativ angelegt/eingeladen.
- Tabellen gewähren `read/create/update/delete` ausschließlich `Role.users()`; anonyme Zugriffe erhalten keine Tabellen- oder Bucket-Rechte.
- Die API-Function darf von `Any` ausgeführt werden, lehnt aber alle Fachrouten ohne von Appwrite gelieferten Benutzerkontext/JWT mit `401` ab.
- Innerhalb der API-Function wird für Benutzeroperationen das `x-appwrite-user-jwt` verwendet, damit Tabellenberechtigungen gelten. Der dynamische Function-Key ist nur für eng definierte administrative/atomare Vorgänge vorgesehen.
- Der Attachment-Bucket erlaubt authentifizierten Benutzern Zugriff; Upload/Metadatenzuordnung erfolgt über die API, damit verwaiste Dateien verhindert werden.
- Die ICS-Function ist öffentlich ausführbar, besitzt nur `rows.read` auf `tasks/settings` und akzeptiert ausschließlich einen zufälligen Feed-Token. Gespeichert wird dessen Hash; Rotation invalidiert den alten Feed.
- Der lokale MCP-Server meldet sich als normaler Appwrite-Benutzer an und nutzt Session/JWT. Kein Projekt-API-Key wird in MCP-, Mobile- oder Web-Konfiguration verteilt.

### 2.6 API-Vertrag und Transaktionen

Die API-Function übernimmt die bestehenden Pfade und DTOs (`/api/tasks`, `/api/projects`, Kategorien, Mitglieder, Sektionen, Blocker, gespeicherte Ansichten, Aktivitätslog, Einstellungen). Nicht mehr benötigte lokale Pfade (`/api/lan`, `/api/admin/import-prod`, `/api/migrate`, `/api/testreport`) werden im Appwrite-Build ausgeblendet oder liefern einen klaren Nicht-verfügbar-Status.

Mehrschrittige Writes verwenden TablesDB-Transaktionen (Free-Limit: maximal 100 Operationen je Transaktion):

- Task erstellen: nächste Tasknummer atomar reservieren, Task und Activity-Eintrag gemeinsam schreiben.
- Task abschließen: Task aktualisieren, ggf. Wiederholung erzeugen und Activity-Eintrag gemeinsam committen.
- Task/Projekt löschen: Referenzen/Subtasks nach definierter Semantik ändern und Activity-Eintrag gemeinsam committen.
- Reorder: maximal 100 Änderungen pro Transaktion; größere Mengen werden abgewiesen oder in kontrollierte Batches mit expliziter Teilfehlerbehandlung zerlegt.

### 2.7 Auth- und Client-Fluss

1. `AuthGate` lädt `account.get()`.
2. Ohne Session erscheint ausschließlich der Login-Dialog.
3. Nach E-Mail/Passwort-Login wird für API-Aufrufe ein kurzlebiges JWT erzeugt und vor Ablauf erneuert.
4. `apiFetch` sendet das JWT als `x-appwrite-user-jwt` an die Function-Domain.
5. Offline-Writes bleiben in der bestehenden Outbox; ein `401` pausiert die Queue bis zur erneuten Anmeldung, Netzwerkfehler bleiben retrybar.
6. Logout leert Session, JWT im Speicher, sensible Caches und produktionsbezogene Outbox-Daten.

### 2.8 Build und Deployment

- Neuer Build: `npm run build:appwrite` erzeugt ausschließlich die statische Web-App in `dist/appwrite`.
- Site: React/static adapter, Install `npm ci`, Build `npm run build:appwrite`, Output `dist/appwrite`, Fallback `index.html`.
- Functions besitzen eigene kleine `package.json`/Lockfiles und werden getrennt gebaut/deployt.
- `appwrite.config.json` enthält IDs und nicht geheime Infrastrukturkonfiguration; `.appwrite.local` bleibt gitignoriert.
- Provisionierung und Deployment erfolgen zuerst ohne Aktivierung bzw. auf Preview-URL. Aktivierung/Cutover ist ein separates, bestätigungspflichtiges Gate.

### 2.9 Migration und Cutover

1. Lokalen Exporter gegen eine Kopie/Backup der PROD-SQLite-Datei testen.
2. Schema und leere Ressourcen idempotent provisionieren.
3. Probelauf importieren, Counts/Referenzen/Anhänge prüfen, Smoke-Tests durchführen; Appwrite bleibt noch nicht führend.
4. Vor finalem Cutover: alte PROD-Schreibzugriffe stoppen, SQLite sichern und final exportieren.
5. Zieltabellen kontrolliert leeren bzw. in eine frische, verifizierte Zielstruktur importieren; Importbericht archivieren.
6. Preview vollständig prüfen, erst nach Nutzerfreigabe Site aktivieren und Clients umstellen.
7. LAN-Server unverändert und ausgeschaltet/read-only als Rollback halten. Rollback nach neuen Appwrite-Writes erfordert einen Rückexport oder akzeptierten Datenverlust ab Cutover-Zeitpunkt; dies wird beim Gate ausdrücklich entschieden.

### 2.10 Trade-offs

- **Eine API-Function statt direkter Tabellenzugriffe:** mehr Function-Ausführungen und möglicher Cold Start, dafür minimale Client-Umschreibung, zentrale Validierung, Transaktionen und konsistente Web/Mobile/MCP-Semantik.
- **Separate ICS-Function:** verbraucht den zweiten Free-Slot, isoliert aber den einzigen anonymen Zugriff strikt von der Fach-API.
- **ID-Spalten statt Appwrite-Relationships:** weniger automatische Referenzlogik, dafür vorhersehbarer Import und kontrollierte API-Kompatibilität.
- **Lokaler Teststack bleibt Express/SQLite:** hält TEST kostenlos und unabhängig, erzeugt aber zwei Persistenzadapter. Gemeinsame Contract-Tests verhindern Drift.
- **Free-Plan:** für private Nutzung ausreichend, aber ohne Produktions-SLA und tägliche Backups. Regelmäßiger exportierbarer Daten-Snapshot und dokumentierte Wiederherstellung sind daher Pflicht.
