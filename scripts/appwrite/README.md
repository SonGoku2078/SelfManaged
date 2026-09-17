# Appwrite-Skripte: welcher Key wofür

Kein Skript hier läuft ohne einen **statischen Projekt-API-Key** (`APPWRITE_API_KEY`
in `.appwrite.local` bzw. als GitHub-Secret). Die Laufzeit-App braucht diesen Key
dagegen **nicht** — `selfmanaged-api` läuft mit dem User-JWT, `selfmanaged-ics`
mit Appwrite's dynamischem Function-Key (Scope `rows.read`, siehe
`provision-compute.mjs`). Der statische Key ist ausschließlich ein
Admin-/CI-Werkzeug.

Damit er nicht mehr Rechte hat als nötig, zwei getrennte Keys statt einem:

## 1. CI-Deploy-Key (GitHub Environment `appwrite-production`)

Nur für `npm run appwrite:deploy-preview` und `npm run appwrite:activate`
(Functions/Site deployen + aktivieren, stabile Domain-Regel anlegen).

Benötigte Scopes: `functions.read`, `functions.write`, `sites.read`,
`sites.write`, `rules.read`, `rules.write`. Sonst nichts — kein
`databases.*`, kein `teams.*`, kein `users.*`.

## 2. Lokaler Admin-Key (nur in deiner eigenen `.appwrite.local`, nie in Git/CI)

Für die selten laufenden Setup-/Wartungsskripte: `provision.mjs`,
`provision-compute.mjs`, `setup-team.mjs`, `import-export.mjs`,
`export-current-prod.mjs`, `schema.mjs`, `verify.mjs`, `status.mjs`.

Benötigte Scopes: `functions.read`, `functions.write`, `sites.read`,
`sites.write`, `rules.read`, `rules.write`, `tables.read`, `tables.write`,
`collections.read`, `collections.write`, `rows.read`, `rows.write`,
`teams.read`, `teams.write`, `buckets.read`, `buckets.write`, `files.read`,
`files.write` (Bucket-Anlage in `provision.mjs`, Datei-Uploads/-Listing in
`import-export.mjs` und `status.mjs`).

Es gibt **keinen** Scope namens `databases.*` — Appwrite trennt das
Datenbank-Modell in `tables.*` (Tabellen-Schema), `collections.*`
(Spalten/Indizes/Attribute) und `rows.*` (Zeilendaten). Alle drei Paare
werden gebraucht, sonst schlägt schon ein simpler `status`-Lauf mit
`missing scopes ["tables.read","collections.read"]` fehl (so getestet am
2026-09-16).

Da diese Skripte nur gelegentlich laufen, kann dieser Key auch bewusst
kurzlebig gehalten werden: im Appwrite Console erzeugen, Skript laufen
lassen, Key danach löschen oder deaktivieren.

## Rotation/Erstellung

Appwrite Console → Projekt → Settings → API Keys. Keys lassen sich nicht per
Skript anlegen (das wäre selbst wieder ein Henne-Ei-Problem mit Scopes), das
ist ein manueller Schritt. Nach dem Anlegen des neuen CI-Keys: GitHub →
Settings → Environments → `appwrite-production` → Secret `APPWRITE_API_KEY`
aktualisieren. Den alten, breit berechtigten Key danach löschen.
