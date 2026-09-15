# Feature — Suche im Kalender-Raster + Unteraufgaben als Treffer (#93)

| Feld | Wert |
|---|---|
| Status | done (Wirkung auf Prod nach User-Deploy) |
| Nächste Rolle | — (User: `npm run release`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-09-15 |

> Orchestrator-Log:
> - 2026-09-15 Artefakt angelegt, Folge von #92 (docs/pipeline/issue-92-topf-suche.md) → /req-engineer
> - 2026-09-15 BLOCKED: Topf-Zuordnung von Unteraufgaben offen → Nutzerentscheidung eingeholt (Topf der Elternaufgabe), AC13 ergaenzt
> - 2026-09-15 requirements-done + architecture-done → /developer
> - 2026-09-15 implementation-done; Selbst eingeschleppter Defekt (Summen-Pille) vor dem Gate behoben
> - 2026-09-15 GATE GO — 144 Pruefungen ueber 3 Suiten x 2 Browser, 0 offene Defekte → /cicd-engineer
> - 2026-09-15 done — PR #95 squash-merged (a8f93fb), CI gruen, #93 geschlossen. Kein Deploy, kein Tag.

## 1. Requirements

- **GitHub Issue:** [#93](https://github.com/SonGoku2078/Task-Manager/issues/93)
- **Baut auf:** [#92](https://github.com/SonGoku2078/Task-Manager/issues/92) (`5165579`) — dort entstand das topf-lokale Suchfeld.
- **Nozbe-Referenz:** [filtering-and-sorting](https://help.nozbe.com/advanced/filtering-and-sorting-possibilities/) — Eingrenzung in jeder Ansicht; [searching](https://help.nozbe.com/advanced/searching/) — Suche findet auch Aufgaben-Kommentare, also ausdrücklich mehr als die oberste Ebene.

### Zwei Teilprobleme

**A — Das Kalender-Raster kennt keine Suche.** `WeekView` liest `s.tasks` roh (`WeekView.tsx:66`) und geht nicht durch `selectVisibleTasks`; `matchesSearch` greift dort nicht.

**B — Unteraufgaben sind außerhalb der globalen Suche unauffindbar.** `selectors.ts:222` filtert sie aus allen Listen heraus.

### Nachträglich geklärte Entscheidung (2026-09-15)

Das Interview zu #93 legte fest, dass Unteraufgaben bei aktiver Suche gefunden werden — **nicht** aber, welchem Topf sie dabei zugerechnet werden. Eine Auswertung des Dev-Bestands machte die Frage entscheidungsreif:

| Kennzahl (249 Unteraufgaben in `dev.db`) | Wert |
|---|---|
| ohne eigenes Projekt, Elternaufgabe aber **mit** Projekt | **47** |
| mit `someday`-Flag | **0** |
| mit `thisWeek`-Flag | **2** |

Nach eigenen Feldern eingeordnet wären diese 47 bei aktiver Suche in der **Inbox** erschienen (obwohl projektgebunden), und in Someday/Next Week hätte es praktisch **nie** einen Treffer gegeben — das Feature wäre wirkungslos geblieben.

**Nutzerentscheidung:** Eine Unteraufgabe wird dem **Topf ihrer Elternaufgabe** zugerechnet. Liegt die Elternaufgabe in Someday, ist die passende Unteraufgabe beim Suchen in Someday auffindbar.

### Acceptance Criteria

Vollständig in [#93](https://github.com/SonGoku2078/Task-Manager/issues/93) (AC1–AC12). Ergänzend aus der Zusatzentscheidung:

| AC | Kern |
|---|---|
| **AC13** (neu) | Eine Unteraufgabe erscheint bei aktiver Suche im Topf ihrer **Elternaufgabe**, nicht nach ihren eigenen Feldern. Insbesondere: eine projektgebundene Unteraufgabe ohne eigenes `projectId` erscheint **nicht** in der Inbox. |

### Datenmodell

**Unverändert.** Keine neuen Felder, keine Migration. Die Elternbeziehung wird über das bestehende `parentId` gelesen.

### Nicht im Umfang

Mobile-App; Filter-Controls für Next Week/Someday/Kalender; topfübergreifende Suche aus einem Topf heraus.

## 2. Architektur

### Teil B — Unteraufgaben in `selectVisibleTasks`

Reihenfolge ist entscheidend: **erst** die Wurzelaufgaben auf den Topf eingrenzen, **dann** die Unteraufgaben der eingegrenzten Wurzeln hinzunehmen. So erben sie die Topf-Zugehörigkeit, statt selbst gefiltert zu werden (AC13).

```ts
const searching = ui.searchQuery.trim() !== '';
let result = ui.currentView === 'search' ? tasks : tasks.filter((t) => !t.parentId);

switch (ui.currentView) { /* unverändert — grenzt die Wurzeln ein */ }

// NEU: Unteraufgaben erben den Topf ihrer Elternaufgabe.
if (searching && ui.currentView !== 'search') {
  const scoped = new Set(result.map((t) => t.id));
  result = [...result, ...tasks.filter((t) => t.parentId && scoped.has(t.parentId))];
}
// ab hier unverändert: matchesFilters (nur FILTERABLE_VIEWS), matchesSearch, sortTasks
```

Ohne Suchbegriff ist `searching` falsch — das Verhalten bleibt damit **exakt** wie heute (AC7 des Issues).

### Teil A — Suche im `WeekView`

Eine einzige gefilterte Liste am Kopf der Komponente; alles Nachgelagerte (Tagesspalten, Backlog, Blocker-Projekte) erbt sie automatisch.

```ts
const searching = searchQuery.trim() !== '';
const hit = (t: Task) => matchesSearch(t, searchQuery, members);
// Eine Wurzelaufgabe bleibt stehen, wenn sie selbst passt ODER eine ihrer
// Unteraufgaben passt — sonst wäre eine gefundene Unteraufgabe im Raster
// unerreichbar, weil sie nur unter ihrer Elternaufgabe gerendert wird.
const tasks = searching
  ? allTasks.filter((t) => hit(t) || allTasks.some((c) => c.parentId === t.id && hit(c)))
  : allTasks;
const visibleBlockers = searching ? [] : blockers;
```

`openSubtasksOf` zeigt bei aktiver Suche die passenden Unteraufgaben; hat die Elternaufgabe selbst getroffen, bleiben ihre offenen Unteraufgaben als Kontext stehen.

### Teil C — Elternhinweis an Treffer-Unteraufgaben

`TaskList` rendert Unteraufgaben-Zeilen bewusst ohne Projektangabe („it's the parent's", `TaskList.tsx:322`). Genau diese Kontextlücke schließt der Hinweis. Er erscheint an einer Unteraufgabe, die **auf oberster Ebene** gelistet ist — also in der globalen Such-View und bei aktiver Topf-Suche, nie an eingerückten Zeilen unter ihrer Elternaufgabe.

### Suchfeld im Raster

`App.tsx` rendert `ViewSearch` (aus #92) zusätzlich bei `weekGridActive`, platziert in der Modus-Leiste über dem Grid. Die Ref-Verdrahtung für `/` funktioniert unverändert.

### Trade-offs

| Entscheidung | Alternative | Warum so |
|---|---|---|
| Unteraufgaben **nach** der Topf-Eingrenzung anhängen | vor dem `switch` einhängen | Nur so erben sie den Topf; davor würden sie vom `switch` nach eigenen Feldern aussortiert (die 47-Inbox-Falle) |
| Eine gefilterte Liste am WeekView-Kopf | jede Verwendungsstelle einzeln filtern | Vier Verwendungsstellen (Tagesspalten ×2, Backlog, Blocker-Projekte) blieben sonst leicht inkonsistent |
| Wurzel bleibt bei Treffer in der Unteraufgabe stehen | nur direkte Treffer zeigen | Sonst ist eine gefundene Unteraufgabe im Raster unsichtbar — sie wird nur unter ihrer Elternaufgabe gerendert |
| Explizite FilterBar-Filter gelten weiter für eigene Felder der Unteraufgabe | Filter ebenfalls erben lassen | Bekannte, dokumentierte Grenze; greift nur, wenn ein Filter aktiv gesetzt ist |

### Berührte Dateien

| Datei | Art |
|---|---|
| `src/selectors.ts` | Unteraufgaben-Einschluss bei aktiver Suche |
| `src/components/WeekView.tsx` | gefilterte Aufgabenliste, Blocker ausblenden |
| `src/components/TaskList.tsx` | Elternhinweis an Treffer-Unteraufgaben |
| `src/App.tsx` | `ViewSearch` auch bei aktivem Raster |
| `src/components/TaskList.css` | Stil des Elternhinweises |

## 3. Implementierung

- **Branch:** `feature/93-raster-subtasks`
- **Umgebung:** ausschließlich Dev (`:5173` → `:3002`, `dev.db`). Prod unberührt.

### Geänderte Dateien

| Datei | Änderung |
|---|---|
| `src/selectors.ts` | Unteraufgaben-Einschluss bei aktiver Suche (erbt Topf der Eltern); neue exportierte `gridSearchTasks` |
| `src/components/WeekView.tsx` | nutzt `gridSearchTasks`, blendet Blocker bei aktiver Suche aus (Editor behält sie) |
| `src/components/TaskList.tsx` | Elternhinweis an Unteraufgaben auf oberster Ebene |
| `src/components/TaskList.css` | Stil `.task-parent-hint` |
| `src/App.tsx` | `ViewSearch` über dem Raster; **Summen nutzen `gridSearchTasks`** |
| `scripts/e2e-search93.mjs` | neu — AC-Verifikation |

### Umsetzungsnotizen

- **Reihenfolge trägt die Topf-Vererbung.** Unteraufgaben werden **nach** dem View-`switch` angehängt und über `parentId` an die bereits eingegrenzten Wurzeln gebunden. Vor dem `switch` eingehängt hätten sie sich selbst qualifizieren müssen — mit den in Abschnitt 1 belegten Folgen.
- **Blocker-Editor bleibt bedienbar.** Nur die im Raster gezeichneten Blöcke verschwinden; die Liste im Editor zieht weiter aus `allBlockers`, sonst wären Blocker während einer Suche nicht mehr verwaltbar.
- **`gridSearchTasks` ist geteilt.** Raster und Summen-Pille beziehen dieselbe Menge — siehe den Defekt unten.

### Während der Umsetzung gefundener und behobener Defekt

**Summen-Pille lief vom Raster weg (selbst eingeschleppt, vor dem Gate behoben).**
Das #92-Testdesign hatte „Raster und Summen müssen einig sein" als Major-Kriterium gesetzt. Zu #92-Zeiten war das gratis erfüllt, weil **keines** von beidem filterte. Sobald #93 das Raster filtern ließ, zeigte die Pille weiter alle Tagesaufgaben — im Extremfall „2" neben einer sichtbar leeren Woche. Behoben, indem die Trefferdefinition als `gridSearchTasks` in `selectors.ts` gezogen und von `WeekView` **und** den Summen in `App.tsx` genutzt wird. Eine Zusicherung dafür steckt jetzt in beiden Suiten.

## 4. Testdesign

Strategie wie bei #92: automatisierte AC-Läufe gegen Dev in zwei Browsern, plus Bestandsregression. Zusätzlich muss diese Runde **die #92-Suiten mitlaufen lassen**, weil #93 deren Annahmen bewusst verändert.

| Ebene | Mittel |
|---|---|
| AC1–AC13 | `scripts/e2e-search93.mjs` |
| Rückwirkung auf #92 | `scripts/e2e-search92.mjs`, `scripts/e2e-search92-interactions.mjs` |
| Bestand | `npm test`, `tsc --noEmit`, ESLint gegen die `master`-Baseline |
| Optik | Sichtprüfung Raster mit aktiver Suche |

**Kritische Testfälle:** AC13 (Topf-Vererbung) und die Einigkeit von Raster und Summen-Pille.

**Bewusst geänderte #92-Zusicherungen** (kein Defekt, sondern neuer Soll-Zustand):

| #92-Testfall | vorher | jetzt |
|---|---|---|
| TF-M1 „Suche grenzt die Liste ein" | Liste kann nur schrumpfen | Suche **verändert** die Liste; sie kann durch Unteraufgaben auch wachsen. Zusätzlich geprüft: Suche ohne Treffer leert die Liste |
| TF-M3 „Suchfeld im Raster nicht sichtbar" | Raster hatte bewusst keins | Raster **hat** ein Suchfeld |
| TF-M3 „Summen-Pille schrumpft NICHT" | nichts filterte | Pille **folgt** dem gefilterten Raster |

## 5. Testausführung & Gate

**Datum:** 2026-09-15 · **Umgebung:** Dev (`:5173` → `:3002`). Prod nicht angesprochen.

| Suite | Chromium | Firefox |
|---|---|---|
| `e2e-search93.mjs` (AC1–AC13) | ✅ **21/21** | ✅ **21/21** |
| `e2e-search92.mjs` | ✅ **28/28** | ✅ **28/28** |
| `e2e-search92-interactions.mjs` | ✅ **23/23** | ✅ **23/23** |
| **Summe je Browser** | ✅ **72/72** | ✅ **72/72** |

| Bestandsregression | Ergebnis |
|---|---|
| `npm test` | ✅ Exit 0 |
| `npx tsc --noEmit` | ✅ Exit 0 |
| ESLint (berührte Dateien) | ✅ 5 Findings — **identisch zur `master`-Baseline**; `selectors.ts`, `WeekView.tsx`, `TaskList.tsx` je 0 |

### Kritische Testfälle

**AC13 — Topf-Vererbung: ✅ PASS.** Prüfdaten bilden die 47er-Konstellation nach: Elternaufgabe im Projekt und in Someday, Unteraufgabe ohne eigenes `projectId`. Ergebnis: in Someday gefunden, in der **Inbox weder Kind noch Eltern**. Die Vererbung wirkt wie entschieden.

**Raster ↔ Summen: ✅ PASS.** Bei leerem Trefferraster zeigt die Pille „0"; nach Leeren des Feldes wieder den vollen Wert. In beiden Suiten abgesichert.

### Drei Befunde am Testcode (keine Produktdefekte)

1. **Blocker-Prüfung maß den falschen Knoten.** `[class*="blocker"]` traf den stets sichtbaren Umschaltknopf statt der gezeichneten Blöcke. Auf `.week-blocker-block` präzisiert.
2. **Projekte-Ansicht zeigt nur aktive Projekte.** Das Testprojekt war beliebig gewählt; die Auswahl prüft jetzt `active`/`kind === 'area'`.
3. **`calendarMode` wird persistiert und leckte zwischen Läufen.** Das #93-Skript ließ das Raster aktiv zurück, worauf spätere #92-Läufe im Kalender das Raster statt der Liste vorfanden und scheinbar grundlos fehlschlugen. Das #93-Skript setzt den Modus jetzt zurück, die #92-Suite erzwingt ihn aktiv.

**Ein weiterer Fund verdient eine Notiz:** Eine Zusicherung schlug hartnäckig fehl, obwohl beide Teilbedingungen nachweislich `true` waren. Ursache war ein **unsichtbares Backspace-Zeichen (0x08)** im regulären Ausdruck (`/^0<BS>/`), eingeschleppt durch eine Escaping-Panne beim Patchen — Editor und `grep` zeigten es nicht an. Ersetzt durch `startsWith('0')`, das kein Escaping braucht. Beide Skripte wurden auf Steuerzeichen geprüft: keine verblieben.

### Defekte

**Keine offenen.** Der eine gefundene Defekt (Summen-Pille) wurde vor dem Gate behoben und ist durch Tests abgesichert.

### Restrisiken

| Risiko | Schwere | Bewertung |
|---|---|---|
| Safari ungetestet | Minor | keine Engine verfügbar; nur bestehende CSS-Klassen wiederverwendet |
| Explizite FilterBar-Filter greifen auf die eigenen Felder der Unteraufgabe, nicht auf die der Eltern | Minor | dokumentierte Grenze; wirkt nur bei aktiv gesetztem Filter |
| Raster-Suche über sehr großen Beständen | Minor | `gridSearchTasks` ist `useMemo`-gepuffert; bei 1008 Aufgaben keine spürbare Verzögerung |

### Quality Gate

**GATE: GO** ✅

144 automatisierte Prüfungen über drei Suiten und zwei Browser, Bestandsregression grün, keine neuen Lint-Findings, keine offenen Defekte. Die beiden kritischen Testfälle — Topf-Vererbung und Einigkeit von Raster und Summen — bestehen.

## 6. CI/CD & Deployment

- **PR:** [#95](https://github.com/SonGoku2078/Task-Manager/pull/95) — squash-merged nach `master`
- **Merge-Commit:** `a8f93fb`
- **Branch:** `feature/93-raster-subtasks` (nach Merge gelöscht)
- **Issue:** [#93](https://github.com/SonGoku2078/Task-Manager/issues/93) geschlossen
- **Datum:** 2026-09-15

| Prüfung | Ergebnis |
|---|---|
| `build` (GitHub Actions) | ✅ pass (22 s) |
| GitGuardian Security Checks | ✅ pass |
| Merge-Status | ✅ `CLEAN` |
| Debug-Reste / `TODO` im Produktivcode | ✅ keine |
| Regression **nach** dem Merge auf `master` | ✅ `npm test` Exit 0, `tsc` Exit 0, alle drei E2E-Suiten 72/72 |

### Deployment

**Nicht deployt — bewusst.** Der Stand liegt auf `master`; Produktion (`192.168.8.50:3001`) läuft unverändert. Deploy ausschließlich durch den Nutzer via `npm run release`.

**Kein Release-Tag.** Desktop ist Thin Client und erbt die Weboberfläche beim nächsten Laden vom Server; Mobile ist nicht betroffen.

### Zusammenfassung

Die Suche wirkt jetzt in **jeder** Aufgaben-Ansicht, einschließlich des Kalender-Rasters, und findet auch Unteraufgaben — dort, wo ihre Elternaufgabe steht, mit sichtbarem Hinweis auf sie. Zusammen mit #92 ist die Fidelity-Lücke gegenüber Nozbe („filtering options found in each Nozbe view") vollständig geschlossen.
