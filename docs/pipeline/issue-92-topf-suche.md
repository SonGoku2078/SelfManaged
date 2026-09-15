# Feature — Suchfeld in Next Week, Someday und Kalender (#92)

| Feld | Wert |
|---|---|
| Status | done (Wirkung auf Prod nach User-Deploy) |
| Nächste Rolle | — (User: `npm run release`) |
| Owner-Rolle | cicd-engineer |
| Datum | 2026-09-15 |

> Orchestrator-Log:
> - 2026-09-15 Artefakt angelegt nach Grill-Interview (10 Entscheidungen), Issue #92 erstellt → /req-engineer
> - 2026-09-15 requirements-done (Nozbe-Fidelity-Lücke bestätigt) → /architect
> - 2026-09-15 architecture-done (rein darstellend, Logik unberührt) → /developer
> - 2026-09-15 implementation-done (28/28 ACs gegen Dev verifiziert) → /test-designer
> - 2026-09-15 testdesign-done (7 Wechselwirkungs-, 6 Sonderzeichen-Testfälle) → /test-manager
> - 2026-09-15 GATE GO — 100/100 in Chromium+Firefox, 0 Defekte → /cicd-engineer
> - 2026-09-15 done — PR #94 squash-merged (5165579), CI gruen, #92 geschlossen. Kein Deploy, kein Tag.

## 1. Requirements

- **GitHub Issue:** [#92](https://github.com/SonGoku2078/Task-Manager/issues/92)
- **Feature:** Suchfeld in Next Week, Someday und Kalender ergänzen (+ `/` fokussiert lokal)
- **Vorgeschichte:** Fortsetzung von #9 („Suche nach Taskname", geschlossen 2026-07-05), das die topf-lokale Suche eingeführt hat — allerdings nur in den Ansichten, die die `FilterBar` rendern.

### Nozbe-Referenz

| Quelle | Erkenntnis |
|---|---|
| [help.nozbe.com/advanced/searching](https://help.nozbe.com/advanced/searching/) | Nozbe hat eine **eigene Such-Sektion** in der Icobar für Projekte, Aufgaben und Kommentare — entspricht unserer globalen Such-View. |
| [help.nozbe.com/advanced/filtering-and-sorting-possibilities](https://help.nozbe.com/advanced/filtering-and-sorting-possibilities/) | Filter-/Sortieroptionen sind **„found in each Nozbe view"** — in *jeder* Ansicht über die Info-Leiste erreichbar. |

**Fidelity-Befund:** Das Fehlen der Suche in Next Week, Someday und Kalender ist nicht nur eine interne Inkonsistenz, sondern auch eine **Abweichung vom Original**. Nozbe stellt die Eingrenzung in jeder Ansicht bereit. #92 schließt damit eine echte Fidelity-Lücke.

**Bewusste Abweichung:** Nozbe versteckt Filter hinter der Info-Leiste („i"-Symbol oben rechts). Wir zeigen das Suchfeld stattdessen permanent unter der Quick-Add-Zeile — Nutzerentscheidung aus dem Interview, begründet mit „dort suchen, wo ich auch erfasse". Die übrigen Filter-Controls bleiben in diesen drei Ansichten bewusst ausgeblendet.

### Acceptance Criteria

Vollständig in [#92](https://github.com/SonGoku2078/Task-Manager/issues/92). Übersicht:

| AC | Kern | Verifizierbar durch |
|---|---|---|
| AC1 | Suchfeld in Next Week, Someday, Kalender-Liste sichtbar | Sichtprüfung/DOM je Ansicht |
| AC2 | Position identisch zu Inbox/Heute/Projekte | DOM-Reihenfolge relativ zu `.quick-add` |
| AC3 | Keine Filter-Controls, kein Filter-Badge | DOM-Abwesenheit `.filter-select`, `.filter-active-badge` |
| AC4 | Suche wirkt topf-lokal | Aufgabe mit Treffer-Begriff in anderem Topf erscheint nicht |
| AC5 | Suchumfang wie bestehend (Titel, `#Nr`, Beschreibung, Person, Status) | je Feld ein Suchlauf |
| AC6 | Begriff wird beim Ansichtswechsel geleert | Wechsel → Feld leer, Liste vollständig |
| AC7 | Verständlicher Leerzustand | Suche ohne Treffer |
| AC8 | `/` fokussiert lokales Feld; Fallback global wo keins existiert | Tastendruck je Ansicht |
| AC9 | `/` stiehlt keinen Fokus beim Tippen | `/` in Quick-Add eintippen |
| AC10 | Platzhalter benennt echten Suchumfang, überall gleich | Textvergleich über alle Ansichten |
| AC11 | Keine Regression in bestehenden Ansichten | Bestandstests + Regressionslauf |

### Technische Schnittstellen (Was, nicht Wie)

- **Input:** Freitext des Nutzers; Tastendruck `/`.
- **Verarbeitung:** bestehende Trefferdefinition `matchesSearch(task, query, members)` — wird **nicht** verändert (Basis für AC5).
- **Output:** gefilterte Aufgabenliste der aktuellen Ansicht; unveränderte Liste bei leerem Feld.
- **Zustand:** `ui.searchQuery` (bestehend, ein Wert ohne Ansichts-Zuordnung — tragfähig, weil beim Ansichtswechsel geleert wird, AC6).

### Datenmodell

**Unverändert.** Keine neuen Felder an `Task`, keine Migration, keine Persistenz. `ui.searchQuery` ist flüchtiger UI-Zustand.

### Browser-/Plattform-Anforderungen

- Web (Chrome/Firefox/Edge) und Electron-Desktop — Desktop ist Thin Client und erbt die Änderung vom Server, **kein EXE-Build nötig**.
- Mobile ausdrücklich **nicht** im Umfang (dort existiert bereits eine global suchende Lupe in jedem Tab).
- Keine neuen Browser-Fähigkeiten nötig.

### Nicht im Umfang

Kalender-Raster und Unteraufgaben-Treffer → [#93](https://github.com/SonGoku2078/Task-Manager/issues/93). Filter-Controls für die drei Ansichten → offen, kein Issue.

### Offene Punkte

Keine. Alle zehn Entscheidungen wurden im Grill-Interview 2026-09-15 mit dem Nutzer geklärt.

## 2. Architektur

### Leitgedanke

Die Suchlogik existiert bereits und wirkt ungefiltert in **jeder** Ansicht (`selectors.ts:329`). Das Feature ist daher **rein darstellend**: Es fehlt nur das Eingabefeld. Entsprechend wird weder `matchesSearch`, noch `selectVisibleTasks`, noch `FILTERABLE_VIEWS`, noch der Store angefasst. Das hält das Regressionsrisiko für AC11 minimal.

### Komponenten-Struktur

```
App
├── quick-add (bestehend)
├── ViewSearch          ◄── NEU: nur Suchfeld, Ansichten ohne FilterBar
│     └── ClearableInput (bestehend)
├── FilterBar           ◄── GEÄNDERT: nimmt searchRef, gemeinsame Platzhalter-Konstante
│     └── ClearableInput (bestehend)
└── TaskList            ◄── GEÄNDERT: suchbewusster emptyHint
```

`ViewSearch` und `FilterBar` sind **wechselseitig exklusiv** — nie beide gleichzeitig sichtbar. Beide sitzen an derselben Stelle im Baum, unmittelbar nach `quick-add`, wodurch AC2 (identische Position) strukturell garantiert ist statt per CSS nachgestellt.

### Neue Komponente: `src/components/ViewSearch.tsx`

Bewusst minimal — kein eigener State, keine Props außer der Ref:

```tsx
const ViewSearch = forwardRef<HTMLInputElement>(function ViewSearch(_props, ref) {
  const searchQuery = useStore((s) => s.ui.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  return (
    <div className="view-search-bar">
      <ClearableInput
        ref={ref}
        wrapperClassName="filter-search-wrap"
        className="filter-search"
        type="text"
        placeholder={SEARCH_PLACEHOLDER}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onClear={() => setSearchQuery('')}
      />
    </div>
  );
});
```

Wiederverwendung der bestehenden CSS-Klassen `filter-search-wrap` / `filter-search` sorgt für identische Optik ohne neue Stile; `view-search-bar` trägt nur den Abstand, den sonst `filter-bar` liefert.

### Sichtbarkeits-Regel (App.tsx)

```ts
const showViewSearch =
  !isFilterView &&
  (ui.currentView === 'nextweek' ||
   ui.currentView === 'someday' ||
   (ui.currentView === 'calendar' && !weekGridActive));
```

`weekGridActive` (`App.tsx:304`) existiert bereits und grenzt den Kalender korrekt auf den Listenmodus ein — das Raster bleibt damit automatisch außen vor und gehört zu #93.

### Gemeinsame Platzhalter-Konstante (AC10)

```ts
export const SEARCH_PLACEHOLDER = '🔍 Suchen: Titel, #Nr, Beschreibung, Person, Status…';
```

Exportiert aus `ViewSearch.tsx`, importiert von `FilterBar.tsx` (beide Vorkommen: eingeklappt und ausgeklappt). Eine Quelle, drei Verwendungsstellen — AC10 kann nicht auseinanderlaufen.

### Tastenkürzel `/` (AC8, AC9)

Eine **gemeinsame Ref** `localSearchRef`, die an das jeweils gerenderte Feld geht. Da nie zwei gleichzeitig existieren, genügt ein Ref-Objekt:

```ts
} else if (e.key === '/') {
  e.preventDefault();
  if (localSearchRef.current) localSearchRef.current.focus();
  else setView('search');          // Fallback: Ansichten ohne lokales Feld
}
```

Empfänger der Ref:
| Ansicht | Feld | Ergebnis von `/` |
|---|---|---|
| nextweek, someday, calendar-Liste | `ViewSearch` | fokussiert lokal |
| inbox, priority, projects, today, categories, custom, completed | `FilterBar` (neue Prop `searchRef`) | fokussiert lokal |
| search (globale Such-View) | großes `search-input` (`App.tsx:775`) bekommt dieselbe Ref | fokussiert das Suchfeld |
| reports, settings, activity, templates, members | keins → Ref ist `null` | öffnet globale Such-View |

**AC9** ist bereits durch den bestehenden Wächter `if (typing) return;` (`App.tsx:274`) erfüllt — `/` löst nicht aus, während in einem Feld getippt wird. Kein Zusatzaufwand, aber explizit zu testen.

### Leerzustand (AC7)

`TaskList` besitzt bereits die Prop `emptyHint` (`TaskList.tsx:21`). App reicht bei aktiver Suche einen passenden Text durch:

```ts
emptyHint={ui.searchQuery.trim()
  ? `Keine Treffer für „${ui.searchQuery}" in dieser Ansicht.`
  : undefined}
```

Der Hinweis benennt ausdrücklich **„in dieser Ansicht"** — das entschärft die bekannte Sackgasse der topf-lokalen Suche (Treffer liegt in einem anderen Topf), ohne die im Interview verworfene zweite Zählung einzuführen.

### Datenmodell

**Unverändert.** Kein Feld an `Task`, keine Migration, keine Persistenz, kein Server-Kontakt. `ui.searchQuery` bleibt flüchtiger UI-Zustand mit bestehendem Reset in `store.ts:1986` (AC6 gratis).

### Store/State

**Unverändert.** `setSearchQuery` und `setView` existieren und werden nur konsumiert.

### Trade-offs

| Entscheidung | Alternative | Warum so |
|---|---|---|
| Eigene Komponente `ViewSearch` | FilterBar mit Prop `searchOnly` rendern | FilterBar müsste dann `FILTERABLE_VIEWS` erweitern, sonst zeigt sie Controls ohne Wirkung. Genau davor warnt `selectors.ts:324`. Getrennte Komponente hält die Filter-Semantik unangetastet. |
| Gemeinsame Ref an beide Felder | DOM-Query per `querySelector` im Handler | Ref ist typsicher und überlebt Umbenennungen von CSS-Klassen. Möglich, weil die Felder exklusiv sind. |
| Platzhalter als exportierte Konstante | Text dreimal literal | AC10 verlangt Gleichheit über alle Ansichten; eine Konstante macht Abweichung unmöglich. |
| `emptyHint` wiederverwenden | Eigene Leer-Komponente | Prop existiert bereits, null neue Struktur. |
| Bestehende CSS-Klassen wiederverwenden | Eigenes Styling für `ViewSearch` | Garantiert identische Optik (AC2) und vermeidet Stil-Drift. |

### Berührte Dateien

| Datei | Art |
|---|---|
| `src/components/ViewSearch.tsx` | neu |
| `src/components/ViewSearch.css` | neu (nur Abstände) |
| `src/components/FilterBar.tsx` | Prop `searchRef`, Platzhalter-Konstante |
| `src/App.tsx` | ViewSearch rendern, `localSearchRef`, `/`-Handler, `emptyHint` |

**Nicht berührt:** `selectors.ts`, `store.ts`, `types.ts`, Server, Mobile.

## 3. Implementierung

- **Branch:** `feature/92-topf-suche`
- **Umgebung:** ausschließlich Dev — Vite `:5173` → Proxy → Dev-Backend `:3002` (`dev.db`). Prod (`192.168.8.50:3001`) wurde **nicht berührt**.

### Geänderte/neue Dateien

| Datei | Änderung |
|---|---|
| `src/components/ViewSearch.tsx` | **neu** — Suchfeld-Komponente + exportierte Konstante `SEARCH_PLACEHOLDER` |
| `src/components/ViewSearch.css` | **neu** — spiegelt den `.filter-bar`-Rahmen (Padding, Unterkante), deckelt die Feldbreite auf 320 px |
| `src/components/FilterBar.tsx` | Prop `searchRef`, beide Suchfelder (eingeklappt + ausgeklappt) nutzen `SEARCH_PLACEHOLDER` |
| `src/App.tsx` | `localSearchRef`, `showViewSearch`, `<ViewSearch>` gerendert, `/`-Handler, suchbewusster `emptyHint`, Ref am globalen Suchfeld |
| `src/App.css` | `.view-search-bar` in die bestehenden Dark-Theme- und `@media print`-Regeln aufgenommen |
| `scripts/e2e-search92.mjs` | **neu** — automatisierte AC-Verifikation (Playwright) |

**Nicht angefasst:** `selectors.ts`, `store.ts`, `types.ts`, Server, Mobile — wie in der Architektur vorgesehen.

### Umsetzungsnotizen

- **Ein Ref für alle drei Suchfelder.** `FilterBar`, `ViewSearch` und das große Feld der globalen Such-View teilen sich `localSearchRef`. Das funktioniert, weil nie zwei gleichzeitig im Baum hängen; `null` in Ansichten ohne Feld ist genau das Signal für den Fallback auf die globale Suche.
- **AC9 war bereits erfüllt.** Der Wächter `if (typing) return;` im bestehenden Shortcut-Handler verhindert den Fokusdiebstahl — kein Code nötig, aber getestet.
- **Dark Mode / Print nicht vergessen.** `.filter-bar` bezieht seine dunkle Fläche aus `App.css`, nicht aus `FilterBar.css`. Ohne Aufnahme von `.view-search-bar` in beide Selektorlisten wäre die neue Leiste im dunklen Theme weiß geblieben und im Ausdruck sichtbar gewesen. Verifiziert: Hintergrund im Dark Mode `rgb(36, 42, 48)`.
- **`emptyHint` speist zwei Zweige.** `TaskList` rendert den Leer-Hinweis je nach Gruppierung als `.task-list-empty` (Kalender) oder `.section-empty-hint` (Someday/Next Week sind `VIEW_GROUPABLE`). Beide Pfade wurden geprüft.

### Lokale Verifikation

`node scripts/e2e-search92.mjs` — legt zwei eindeutige Proben-Tasks über die Dev-API an, prüft, räumt auf.

| Prüfung | Ergebnis |
|---|---|
| **AC-Lauf gesamt** | ✅ **28/28** |
| AC1 Feld in Next Week / Someday / Kalender | ✅ 3/3 |
| AC2 Position `quick-add + view-search-bar` (Inbox als Referenz) | ✅ 4/4 |
| AC3 keine `.filter-select` / `.filter-active-badge` / `.filter-toggle` | ✅ 3/3 |
| AC4 topf-lokal — Inbox-Probe erscheint in Someday nicht | ✅ |
| AC5 Treffer über Titel, Beschreibung, `#Nummer` | ✅ 3/3 |
| AC6 Feld nach Ansichtswechsel leer (hin und zurück) | ✅ 2/2 |
| AC7 Leer-Hinweis „Keine Treffer … in dieser Ansicht" (beide Zweige) | ✅ 3/3 |
| AC8 `/` fokussiert lokal; Einstellungen → globale Such-View | ✅ 5/5 |
| AC9 `/` stiehlt keinen Fokus, landet als Zeichen im Feld | ✅ 2/2 |
| AC10 Platzhalter in 5 Ansichten identisch + nennt echten Umfang | ✅ 2/2 |
| **AC11 Regression** | ✅ `npm test` grün, `tsc --noEmit` sauber |
| Lint | ✅ **keine neuen Findings** — `master` hat dieselben 5 Alt-Fehler (`react-hooks/*` in unberührtem Code), neue Dateien 0 |
| Dark Mode + Ausdruck | ✅ Sichtprüfung beide Themes, `.view-search-bar` erbt `--hover-bg` |
| Testdaten | ✅ rückstandsfrei entfernt (0 verbliebene Proben) |

**Nicht automatisiert prüfbar:** Optik in Firefox/Safari (nur Chromium getestet) — geringes Risiko, da ausschließlich bestehende CSS-Klassen wiederverwendet werden.

## 4. Testdesign

### Teststrategie

Das Feature ist **rein darstellend** — Suchlogik, Store und Datenmodell sind unverändert. Das verschiebt den Testschwerpunkt: Nicht die Trefferberechnung ist das Risiko (die lief seit #9 unverändert in allen Ansichten mit), sondern **Darstellung, Verdrahtung und Wechselwirkung** mit bestehenden Mechaniken.

| Ebene | Mittel | Abdeckung |
|---|---|---|
| AC-Regression, automatisiert | `scripts/e2e-search92.mjs` (Playwright/Chromium, Dev-Backend) | AC1–AC11, 28 Prüfungen, legt Proben-Tasks an und räumt auf |
| Bestandsregression | `npm test`, `npx tsc --noEmit`, `npx eslint` | Selektor-/Recurrence-/Totals-Logik, Typen, Lint-Baseline |
| Wechselwirkungen | manuell, Dev | Gruppen/Sektionen, Bulk-Modus, Kalendermodus-Wechsel, gespeicherte Ansichten |
| Sonderzeichen & Grenzen | manuell, Dev | Umlaute, `#`, Anführungszeichen, Emoji, sehr lange Begriffe, Leerzeichen |
| Zweitbrowser | manuell, Firefox | Optik und Fokusverhalten |
| Nozbe-Fidelity | Sichtvergleich gegen help.nozbe.com | Vorhandensein der Eingrenzung je Ansicht |

**Umgebung verbindlich:** Vite `:5173` → Dev-Backend `:3002` (`dev.db`). **Prod (`192.168.8.50:3001`) wird nicht angefasst** — weder lesend über die App noch schreibend.

### Automatisiert abgedeckte Testfälle

Ausführung: `node scripts/e2e-search92.mjs` (Dev-Backend muss laufen). Deckt AC1–AC11 mit 28 Prüfungen ab; Details siehe Abschnitt 3.

### Manuelle Testfälle — Wechselwirkungen

#### TF-M1 — Suche in gruppierter Ansicht (Sektionen)
**Voraussetzung:** Someday geöffnet, mindestens eine Gruppe/Sektion vorhanden, Aufgaben in und außerhalb der Gruppe.
**Schritte:** 1. Begriff eintippen, der nur eine Aufgabe **innerhalb** einer Gruppe trifft. 2. Beobachten. 3. Feld leeren.
**Erwartet:** Die Gruppe bleibt sichtbar und zeigt nur den Treffer; Gruppen ohne Treffer zeigen ihren Leer-Hinweis oder verschwinden, ohne dass die Ansicht springt. Nach dem Leeren steht die Liste vollständig wie zuvor.
**Warum:** `someday`/`nextweek` sind `VIEW_GROUPABLE` — der Leer-Hinweis läuft hier über `.section-empty-hint` statt `.task-list-empty`.

#### TF-M2 — Gruppen eingeklappt + Suche
**Schritte:** Sektionen einklappen, dann suchen.
**Erwartet:** Treffer sind auffindbar; die Suche erzeugt keinen Zustand, in dem Treffer existieren, aber unsichtbar bleiben, ohne dass die Gruppe dies anzeigt.

#### TF-M3 — Kalender: Moduswechsel mit aktiver Suche
**Schritte:** 1. Kalender → „Tag / Liste". 2. Begriff eintippen, Treffer sehen. 3. Auf „Woche (Mo–So)" umschalten. 4. Zurück auf „Tag / Liste".
**Erwartet:** Im Raster verschwindet das Suchfeld; das Raster filtert **nicht** (das ist #93) und die Summen-Pille im Kopf zeigt weiterhin die Tages-Summen des Rasters — **Raster und Summen bleiben einig**. Nach dem Rückwechsel steht der Begriff noch im Feld und die Liste ist wieder gefiltert.
**Warum:** Der Moduswechsel ruft `setCalendarMode`, nicht `setView` — `searchQuery` wird also **nicht** geleert. Die Summen ziehen bei aktivem Raster aus `tasks` statt aus `visibleTasks` (`App.tsx:319`), weshalb kein Auseinanderlaufen entstehen darf.
**Kritisch:** Zeigt die Pille im Raster eine durch die Suche geschrumpfte Zahl, ist das ein **Major-Defekt**.

#### TF-M4 — Bulk-Modus + Suche
**Schritte:** 1. In Someday mehrere Aufgaben selektieren. 2. Suchbegriff eintippen, der einen Teil der Selektion ausblendet. 3. „Alle auswählen" in der Bulk-Leiste.
**Erwartet:** Die Bulk-Leiste bezieht sich nachvollziehbar auf die **sichtbaren** Aufgaben; „Alle auswählen" selektiert nicht unsichtbare Aufgaben mit. Keine Aktion trifft ausgeblendete Aufgaben unbemerkt.
**Kritisch:** Eine Massenaktion auf unsichtbaren Aufgaben wäre ein **Blocker**.

#### TF-M5 — Suche + Sortierung/Verschieben
**Schritte:** Bei aktiver Suche eine Trefferzeile per Drag&Drop verschieben, danach Feld leeren.
**Erwartet:** Entweder das Verschieben ist sinnvoll möglich, oder es passiert nichts — keine willkürliche Umsortierung der ausgeblendeten Aufgaben.

#### TF-M6 — Gespeicherte Ansichten (`custom`)
**Schritte:** Eine gespeicherte Ansicht öffnen, `/` drücken, suchen.
**Erwartet:** `custom` ist eine FilterBar-Ansicht — Feld vorhanden, neuer Platzhalter, `/` fokussiert lokal.

#### TF-M7 — Erledigt-Ansicht
**Erwartet:** Neuer Platzhalter, `/` fokussiert lokal, bestehender Leer-Hinweis der Ansicht bleibt erhalten, solange nicht gesucht wird.

### Manuelle Testfälle — Sonderzeichen und Grenzen

#### TF-S1 — Umlaute und Groß/Klein
Begriffe `Prüfung`, `prüfung`, `PRÜFUNG` liefern dieselben Treffer.

#### TF-S2 — Führende und alleinige Leerzeichen
Nur Leerzeichen im Feld → Liste bleibt **vollständig** (kein Leerzustand), da `matchesSearch` auf `trim()` prüft.

#### TF-S3 — Rautezeichen ohne Zahl
`#` allein und `#abc` → kein Absturz, Behandlung als Freitext.

#### TF-S4 — Anführungszeichen im Begriff
Begriff mit `"` → der Leer-Hinweis `Keine Treffer für „…"` bleibt lesbar und bricht das Layout nicht.

#### TF-S5 — Sehr langer Begriff
200+ Zeichen → Feld bleibt bedienbar, Leiste bricht nicht um, kein horizontales Scrollen der Ansicht.

#### TF-S6 — Emoji
Begriff mit Emoji → kein Absturz.

### Test-Matrix

| Prüfung | Chromium | Firefox | Electron-Desktop |
|---|---|---|---|
| AC1–AC11 automatisiert | ✅ 28/28 (Dev) | offen | entfällt¹ |
| Optik hell/dunkel | ✅ | offen | entfällt¹ |
| `/`-Fokus | ✅ | offen | offen² |
| Wechselwirkungen TF-M1…M7 | offen | — | — |
| Sonderzeichen TF-S1…S6 | offen | — | — |

¹ Desktop ist Thin Client und lädt dieselbe Weboberfläche vom Server — kein eigener Build, keine eigene Renderpfad-Prüfung nötig.
² `/` sollte in der Desktop-Hülle identisch wirken; einmal stichprobenartig bestätigen, falls die App ohnehin offen ist.

### Nozbe-Fidelity-Checkliste

| Punkt | Referenz | Soll |
|---|---|---|
| Eingrenzung in jeder Ansicht verfügbar | [filtering-and-sorting](https://help.nozbe.com/advanced/filtering-and-sorting-possibilities/) („found in each Nozbe view") | ✅ nach #92 erfüllt |
| Separate globale Suche bleibt bestehen | [searching](https://help.nozbe.com/advanced/searching/) | globale Such-View unverändert erreichbar |
| Bewusste Abweichung dokumentiert | — | Nozbe versteckt Filter hinter der Info-Leiste; wir zeigen das Feld dauerhaft (Nutzerentscheidung) |

### Gate-Kriterien

- **Blocker/Major:** offene Defekte in TF-M3 (Summen laufen auseinander) oder TF-M4 (Massenaktion auf Unsichtbarem) → **no-go**.
- **Minor:** kosmetische Abweichungen in Firefox oder bei Sonderzeichen → dokumentieren, Gate darf trotzdem **go** lauten.
- Bestandsregression (`npm test`, `tsc`, Lint-Baseline) muss grün sein.

## 5. Testausführung & Gate

**Umgebung:** Vite `:5173` → Dev-Backend `:3002` (`dev.db`, 1008 Aufgaben). **Prod (`192.168.8.50:3001`) wurde zu keinem Zeitpunkt angesprochen.**
**Datum:** 2026-09-15

### Ergebnisübersicht

| Lauf | Chromium | Firefox |
|---|---|---|
| `scripts/e2e-search92.mjs` (AC1–AC11) | ✅ **28/28** | ✅ **28/28** |
| `scripts/e2e-search92-interactions.mjs` (TF-M*, TF-S*) | ✅ **22/22** | ✅ **22/22** |
| **Summe** | ✅ **50/50** | ✅ **50/50** |

| Bestandsregression | Ergebnis |
|---|---|
| `npm test` | ✅ Exit 0 |
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npx eslint` (berührte Dateien) | ✅ 5 Findings — **identisch zur `master`-Baseline**, alle in unberührtem Code (`react-hooks/*`); neue Dateien 0 |

### Gate-kritische Testfälle

**TF-M3 — Kalender-Moduswechsel mit aktiver Suche: ✅ PASS**
Beim Wechsel Liste → Raster verschwindet das Suchfeld, `searchQuery` bleibt aber gesetzt (der Wechsel ruft `setCalendarMode`, nicht `setView`). Der befürchtete Widerspruch tritt **nicht** ein: Die Summen-Pille zeigt im Raster denselben Wert mit und ohne aktiven Suchbegriff, weil die Summen bei aktivem Raster aus `tasks` nach Tag gezogen werden statt aus `visibleTasks` (`App.tsx:314-320`). Raster und Kopfzeile bleiben einig. Nach Rückwechsel steht der Begriff noch im Feld und die Liste ist wieder gefiltert — nachvollziehbar.

**TF-M4 — Bulk-Modus + Suche: ✅ PASS**
„Alle auswählen" selektiert **genau** die sichtbaren Aufgaben und greift nicht auf ausgeblendete durch (`onSelectAll` speist sich aus `visibleTasks`, `App.tsx:840`). Verifiziert mit einem Begriff, der mehrere, aber nicht alle Aufgaben stehen lässt: Auswahl = sichtbare Menge < Gesamtmenge. Eine Massenaktion auf Unsichtbarem ist damit ausgeschlossen.

### Weitere Testfälle

| ID | Prüfung | Ergebnis |
|---|---|---|
| TF-M1 | Suche in gruppierter Ansicht, Gruppenstruktur überlebt, Liste nach Leeren vollständig | ✅ 3/3 |
| TF-M6 | Gespeicherte Ansichten | ⚪ **n/a** — im Dev-Bestand sind keine gespeicherten Ansichten angelegt |
| TF-M7 | Erledigt: neuer Platzhalter, `/` fokussiert lokal | ✅ 2/2 |
| TF-S1 | Groß/Kleinschreibung mit Umlaut (`löschen` / `LÖSCHEN`) liefert gleiche Treffer | ✅ |
| TF-S2 | Nur Leerzeichen → Liste bleibt vollständig | ✅ |
| TF-S3 | `#` allein und `#abc` ohne Absturz | ✅ 2/2 |
| TF-S4 | Anführungszeichen im Begriff, Hinweis bleibt lesbar | ✅ |
| TF-S5 | 220-Zeichen-Begriff: kein Querscrollen, Feld bedienbar | ✅ 2/2 |
| TF-S6 | Emoji als Suchbegriff | ✅ |

**Nicht ausgeführt:** TF-M2 (eingeklappte Gruppen) und TF-M5 (Drag&Drop bei aktiver Suche) — beides Verhalten, das die Suche nur mittelbar berührt und in keinem AC gefordert ist. Als Minor-Restrisiko dokumentiert, siehe unten.

### Zwei Befunde am Testcode (keine Produktdefekte)

1. **AC7 schlug zunächst fehl**, weil der Selektor nur `.task-list-empty` prüfte. `someday`/`nextweek` sind `VIEW_GROUPABLE` und rendern den Hinweis als `.section-empty-hint`. Der `emptyHint` speist beide Zweige korrekt — Testfall auf beide Selektoren erweitert und in beiden Zweigen bestätigt.
2. **TF-M4 schlug zweimal fehl** — einmal, weil der Suchbegriff `a` alle 441 Aufgaben traf (die Suche blendete also nichts aus und prüfte den Fall gar nicht), einmal, weil ein zu enger Begriff genau die markierte Aufgabe übrig ließ, wodurch die Checkbox bereits auf „checked" stand und der Klick abwählte statt auszuwählen. Beide Male lag der Fehler in der Testanlage, nicht im Produkt.

### Nozbe-Vergleich

| Punkt | Ergebnis |
|---|---|
| Eingrenzung in jeder Ansicht verfügbar ([Referenz](https://help.nozbe.com/advanced/filtering-and-sorting-possibilities/)) | ✅ Fidelity-Lücke geschlossen |
| Globale Suche weiterhin separat erreichbar ([Referenz](https://help.nozbe.com/advanced/searching/)) | ✅ unverändert |
| Bewusste Abweichung: Feld dauerhaft sichtbar statt hinter der Info-Leiste | ✅ dokumentiert, Nutzerentscheidung |
| Optik hell/dunkel | ✅ Sichtprüfung beider Themes; `.view-search-bar` erbt im Dark Mode `rgb(36,42,48)` |

### Defekte

**Keine.** Weder Blocker noch Major noch Minor.

### Restrisiken

| Risiko | Schwere | Bewertung |
|---|---|---|
| TF-M2/TF-M5 nicht ausgeführt | Minor | Berührt keinen AC; Suche ändert nur die sichtbare Menge, nicht die Sortier- oder Gruppierlogik |
| Safari ungetestet | Minor | Keine Safari-Engine verfügbar; ausschließlich bestehende CSS-Klassen wiederverwendet |
| TF-M6 mangels Daten n/a | Minor | `custom` ist eine FilterBar-Ansicht und erbt das Verhalten der geprüften Ansichten |

### Quality Gate

**GATE: GO** ✅

**Begründung:** 100/100 automatisierte Prüfungen in zwei Browsern, beide gate-kritischen Testfälle bestanden, Bestandsregression vollständig grün, keine neuen Lint-Findings, null Defekte. Die verbleibenden Restrisiken sind sämtlich Minor und berühren keinen Acceptance-Criterion.

**Nächste Rolle:** `/cicd-engineer`

## 6. CI/CD & Deployment

- **PR:** [#94](https://github.com/SonGoku2078/Task-Manager/pull/94) — squash-merged nach `master`
- **Merge-Commit:** `5165579`
- **Branch:** `feature/92-topf-suche` (nach Merge gelöscht)
- **Issue:** [#92](https://github.com/SonGoku2078/Task-Manager/issues/92) geschlossen
- **Datum:** 2026-09-15

### Branch-Review vor dem Merge

| Prüfung | Ergebnis |
|---|---|
| Commit-Historie aussagekräftig | ✅ zwei Commits, fachlich getrennt (Feature / Tests) |
| Debug-Ausgaben, `TODO`/`FIXME`/`debugger` im Produktivcode | ✅ keine |
| Kommentare erklären das Warum, nicht das Offensichtliche | ✅ |
| Umfang entspricht den Requirements | ✅ keine Ausweitung; Raster und Unteraufgaben sauber nach #93 abgegrenzt |

### CI

| Prüfung | Ergebnis |
|---|---|
| `build` (GitHub Actions) | ✅ pass (19 s) |
| GitGuardian Security Checks | ✅ pass |
| Merge-Status | ✅ `MERGEABLE` / `CLEAN` |
| Regression auf `master` nach Merge | ✅ `npm test` Exit 0, `tsc --noEmit` Exit 0 |

### Deployment

**Nicht deployt — bewusst.** Der Stand liegt auf `master`, die Produktion (`192.168.8.50:3001`) läuft unverändert weiter. Der Deploy erfolgt ausschließlich durch den Nutzer via `npm run release` (SSH → `git pull` → `docker compose up -d --build` → Health-Poll).

**Kein Release-Tag.** Die Desktop-App ist Thin Client und lädt die Weboberfläche beim nächsten Start vom Server — ein EXE-Build ist nicht nötig. Die Mobile-App ist von #92 nicht betroffen, ein `mobile-v*`-Tag entfällt.

### Zusammenfassung

Die topf-lokale Suche steht jetzt in allen Aufgaben-Ansichten zur Verfügung, an einheitlicher Position direkt unter der Erfassungszeile. `/` führt dorthin, wo man gerade ist. Damit ist die seit #9 offene Fidelity-Lücke gegenüber Nozbe geschlossen.

Wiederholbare Nachweise liegen als `scripts/e2e-search92.mjs` und `scripts/e2e-search92-interactions.mjs` im Repo — beide browserparametrierbar (`chromium` | `firefox`).
