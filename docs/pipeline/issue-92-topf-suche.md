# Feature — Suchfeld in Next Week, Someday und Kalender (#92)

| Feld | Wert |
|---|---|
| Status | implementation-done |
| Nächste Rolle | /test-designer |
| Owner-Rolle | developer |
| Datum | 2026-09-15 |

> Orchestrator-Log:
> - 2026-09-15 Artefakt angelegt nach Grill-Interview (10 Entscheidungen), Issue #92 erstellt → /req-engineer
> - 2026-09-15 requirements-done (Nozbe-Fidelity-Lücke bestätigt) → /architect
> - 2026-09-15 architecture-done (rein darstellend, Logik unberührt) → /developer
> - 2026-09-15 implementation-done (28/28 ACs gegen Dev verifiziert) → /test-designer

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
