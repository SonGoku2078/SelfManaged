# MCP-Server: Sprach-Assistent liest/plant/erstellt Tasks per KI (#88)

| Feld | Wert |
|---|---|
| Status | new |
| Nächste Rolle | /req-engineer |
| Owner-Rolle | orchestrator |
| Datum | 2026-09-14 |
| Issue | https://github.com/SonGoku2078/Task-Manager/issues/88 |
| Folge-Issues | #89 (Handy/Cloud + Auth), #90 (Sprachausgabe, nur Merkposten) |

> Orchestrator-Log:
> - 2026-09-14 Grill-me-Session abgeschlossen, Entscheidungen 1–8 im Issue #88 festgehalten → /req-engineer

## 0. Ausgangslage (aus der Grill-me-Session)

**Ziel:** Der User spricht am PC (Diktat) mit Claude Desktop / Claude Code; die KI fragt bei Lücken nach und liest bzw. schreibt über einen eigenen MCP-Server in die App.

**Fakten aus der Erkundung:**
- Eine REST-API existiert bereits: `server/src/routes/*` unter `/api/*` (Tasks, Projekte, Kategorien, Sektionen, Members, Blocker, Saved Views, Activity Log, Settings). Web-App, Mobile-App und Android-Widget nutzen sie.
- Keine Authentifizierung, CORS offen; einzige Absicherung ist das Secret-Token in der ICS-URL (`server/src/routes/calendar.ts`).
- Prod: 192.168.8.50:3001 (Docker, LAN). Dev: localhost:3002 (`npm run dev:server`, `dev.db`). **Prod wird bei Entwicklung/Test nie angefasst.**
- Tagesplan-Modell: `todayDate` (Datums-Key) getrennt von `dueDate`; „Heute" = Marker auf heute ODER heute fällig (`src/selectors.ts`, `isTodayFlagActive`). ★ = Nächste Aktion (`docs/GTD-FLOW.md`).
- Kein OpenAPI, kein MCP-Bezug im Repo.

**Entscheidungen (verbindlich, vom User bestätigt):**
| # | Frage | Entscheidung |
|---|---|---|
| 1 | Clients | Claude Desktop / Claude Code am PC im LAN |
| 2 | Andocken | Eigener MCP-Server (stdio) im Repo (`apps/mcp/`), dünner Adapter auf die bestehende REST-API. Keine OpenAPI. |
| 3 | Sprache | Eingabe per Diktat. Sprachausgabe = Ausblick (#90) |
| 4 | Rechte | Lesen, anlegen, planen, abhaken, sternen. **Kein Löschen, keine Projekt-/Kategorienverwaltung.** |
| 5 | „Plan für Tag X" | `todayDate` auf X. Fälligkeit = separates Werkzeug. |
| 6 | Absicherung | Keine in diesem Feature. Auth ist Voraussetzung für #89. |
| 7 | Zielserver | Pflicht-Umgebungsvariable (Base-URL), kein Standardwert; Start bricht mit klarer Meldung ab. `.mcp.json` im Repo → Dev; Claude-Desktop-Konfig des Users → Prod. |
| 8 | „Nächstes" | ★-Tasks des Projekts. Leer → KI sagt es, kann Sternen anbieten. |

**Werkzeuge (Feinschnitt durch Architekt):** siehe Issue #88, Abschnitt „Werkzeuge für die KI".

**Leitplanke für alle Rollen:** Tests ausschließlich gegen Dev (Port 3002, `dev.db`). Der MCP-Server ist ein reiner API-Konsument; Server-Änderungen nur, wenn ein Werkzeug ohne sie nicht umsetzbar ist (dann im Artefakt begründen).
