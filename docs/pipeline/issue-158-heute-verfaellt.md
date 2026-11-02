# Heute: ☀️-Markierung verfällt über Nacht

| Feld | Wert |
|---|---|
| Status | done |
| Nächste Rolle | — (User: Deploy-Freigabe `appwrite-v21`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-11-03 |

## 1. Requirements

- **GitHub Issue:** [#158](https://github.com/SonGoku2078/SelfManaged/issues/158)
- **User-Entscheidung:** ☀️ gilt nur am Tag, an dem sie gesetzt wurde; jeden Morgen wird neu aus Nächste Aktion / Nächste Woche gepickt. Second Brain übernimmt täglich alle Heute-Tasks automatisch. Nimmt das Carry-over aus #112 zurück (Quick-Add in Heute setzt weiterhin ☀️ statt Fälligkeit).

## 2. Architektur

- `isTodayFlagActive`: `todayDate === heute` statt `<= heute`. Wirkt zentral für Web-Heute, Mobile-Heute/Widget/08:00-Übersicht (`mobileAgenda`), Markierungs-Anzeige, Suche.
- Heute-Ansicht: Sonderregel für alte erledigte Markierungen entfällt — fällig heute ∪ heute markiert.
- MCP `groupDayPlan`: geplant = `todayDate === Datum` für jeden Tag.
- Keine Datenmigration: alte `todayDate`-Werte bleiben gespeichert, werden ignoriert.

## 3. Implementierung

Branch `fix/heute-expires-overnight`: `src/selectors.ts`, `apps/mcp/src/logic.ts`, Kommentare in `src/App.tsx` / `apps/mobile/src/selectors.ts`, Tests.

## 4. Testdesign & Ausführung

| TF | Prüft | AC | Test |
|---|---|---|---|
| TF-1 | Flag heute aktiv, gestern abgelaufen, morgen noch nicht | AC1–AC3 | `todayflag.test.ts`, `todaymarker.test.ts` |
| TF-2 | Heute-Ansicht Web + Mobile ohne gestrige Markierungen; heute markiert + erledigt sichtbar | AC2, AC4 | `todayflag.test.ts` |
| TF-3 | MCP-Tagesplan ohne gestrige Markierung | AC2 | `mcp.test.ts` |
| TF-4 | 08:00-Übersicht: ☀️ für morgen zählt, ☀️ von heute morgen nicht mehr | AC2, AC3 | `dailysummary.test.ts` |

`npm test` grün, `tsc -b` PASS, ESLint der geänderten Logikdateien PASS. **Gate: GO.**

## 5. CI/CD & Deployment

- PR → master, Tags `appwrite-v21` (Web/Functions) und `mobile-v0.5.28` (APK). MCP-Server übernimmt die Regel nach `npm run build` in `apps/mcp`.
