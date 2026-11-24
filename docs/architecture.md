# ExileForge – Architektur (Entwurf v0.1)

Stand: 2026-11-24. Erster Entwurf, noch nichts davon ist gebaut.
Annahmen und ungeprüfte Punkte sind mit **⚠ Annahme** markiert.

## 0. Harte Vorgaben

1. **Web- oder Desktopanwendung.**
2. **Die KI läuft über ein reguläres Claude-Abo** (Pro/Max), nicht über
   API-Abrechnung.
3. **Optisch ansprechend für PoE-Spieler** (Dark-Fantasy-Look, ohne Spiel-Assets
   zu kopieren, wo das nicht nötig ist).
4. **Jede Zahl stammt aus Path of Building**, nicht aus der KI.
5. Export als **`.build`-Datei** für den Build Planner im Spiel.
6. **Neuprüfung nach jedem Patch.**

## 1. Entscheidung in einem Satz

ExileForge ist eine **lokale Desktop-App (Electron + React + TypeScript)**, die
**Path of Building PoE2 headless** als Rechenkern startet und die
**installierte Claude-Code-CLI des Nutzers** als KI-Planer aufruft, wobei
ExileForge seine Werkzeuge (PoB-Rechnung, Spieldaten, Preise) als
**MCP-Server** bereitstellt.

## 2. Warum lokal und warum über Claude Code

Was Anthropic erlaubt (Stand der Recherche, siehe Quellen unten):

- Das Claude-Abo kann `claude -p` (Claude Code ohne Oberfläche) und das
  Claude Agent SDK antreiben; die Nutzung zählt dann gegen die Limits des Abos.
- Ein Endnutzer darf sich in die **unveränderte Claude-Code-CLI** mit seinem
  eigenen Abo einloggen.
- **Nicht erlaubt** ist, dass Drittanbieter-Apps einen claude.ai-Login anbieten,
  Anfragen über die Abo-Zugangsdaten **anderer** Nutzer leiten oder
  Claude-Zugangsdaten/Tokens sammeln, speichern oder durchreichen.

Daraus folgt:

- **Keine gehostete Web-App mit zentralem Server**, der für Nutzer die KI
  aufruft. Das ginge nur mit API-Key, also nicht mit dem Abo.
- Stattdessen läuft alles **auf dem Rechner des Spielers**. ExileForge ruft die
  dort installierte, vom Spieler selbst eingeloggte `claude`-CLI als
  Unterprozess auf. ExileForge sieht, speichert und verwaltet **keine**
  Zugangsdaten.
- Für Christians eigenen Gebrauch ist das klar abgedeckt.
  **⚠ Annahme / offen:** Wird ExileForge später öffentlich verteilt, ist zu
  klären, ob „App ruft die vom Nutzer selbst eingeloggte Claude-Code-CLI auf"
  für fremde Nutzer zulässig ist. Die Architektur hält dafür einen zweiten
  Weg offen: API-Key des Nutzers über dieselbe Schnittstelle (siehe 3.3).
- Die Abo-Limits gelten. Ein kompletter Guide wird viele Rechenschritte
  brauchen; der Planer muss deshalb sparsam sein (wenige, große Aufrufe,
  Zwischenergebnisse cachen, Rechnen im MCP-Werkzeug statt im Modell).

## 3. Komponenten

```
┌───────────────────────── ExileForge (Electron) ─────────────────────────┐
│                                                                          │
│  Renderer: React-UI ─── IPC ───▶ Main-Prozess (Node/TypeScript)          │
│  Tree · Items · Crafting          ├─ core: Builds, Stufen, Validierung   │
│  Varianten · Guide                ├─ pob-client ──▶ pob-worker (LuaJIT)  │
│                                   ├─ crafting · prices · exporters      │
│                                   ├─ db (SQLite)                         │
│                                   └─ planner ──▶ `claude -p` (CLI des    │
│                                                   Nutzers, sein Abo)     │
│                                                    │                     │
│                                    ExileForge-MCP-Server ◀──┘            │
│                                    (calc_stage, node_power, search_gems, │
│                                     price_of, plan_craft …)              │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 pob-worker – Path of Building headless

- Basis: [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2),
  als Git-Submodul auf einen **festen Release-Tag** gepinnt.
- PoB bringt `src/HeadlessWrapper.lua` mit, das die Oberfläche durch Stubs
  ersetzt. Darauf setzen wir ein eigenes `bridge.lua`, das in einer Schleife
  JSON-Befehle von stdin liest und Ergebnisse auf stdout schreibt:
  - `load_build(pob_xml)`, `calc()` → Werte aus `build.calcsTab.mainOutput`
  - `calc_with(changes)` → „Was wäre wenn" (Knoten, Gem, Item tauschen)
  - `node_power(stat)` → Nutzen jedes Knotens (wie PoBs Power-Report)
  - `export_code()` → PoB-Importcode (zlib + URL-sicheres Base64 des XML)
- Mehrere langlebige Prozesse als Pool, weil das Laden der Spieldaten dauert
  (**⚠ Annahme**, messen).
- LuaJIT wird mit der App ausgeliefert (Windows zuerst, da PoE2 und der Build
  Planner PC-only sind).
- **⚠ Annahme:** PoB-PoE2 läuft headless ohne Änderungen am PoB-Code. Das ist
  das größte technische Risiko und deshalb der erste Proof of Concept.
- Vorbild: bestehende Projekte wie `pob-mcp` nutzen PoB bereits headless.

### 3.2 Main-Prozess – Kernlogik in TypeScript

Eine Sprache (TypeScript) für App, Kernlogik und MCP-Server, plus Lua nur im
PoB-Worker. Kein separater Python-Server, weil die App lokal läuft.

- **core**: Builds, Varianten, Stufen, Revisionen; Prüfregeln je Stufe
  (Resistenzen gecappt, Spirit reicht, Attribute reichen für Gems, Level passt
  zum Akt).
- **pob-client**: Übersetzung unseres Datenmodells ⇄ PoB-XML, Worker-Pool.
- **crafting**: Craft-Pläne, Erwartungswerte (Versuche, Kosten).
- **prices**: Marktpreise holen und mit Zeitstempel cachen.
- **exporters**: `.build`, PoB-Code, später Markdown/PDF.
- **db**: SQLite (`better-sqlite3`). Ein Build ist ein JSON-Dokument mit
  Revisionen; daneben Tabellen für Rechenergebnisse, Preise, Patch-Läufe.

### 3.3 planner – KI über Claude Code + MCP

- ExileForge startet einen kleinen **MCP-Server** (offizielles
  TypeScript-MCP-SDK, stdio), der die Werkzeuge bereitstellt:
  `calc_stage`, `compare_variants`, `node_power`, `search_gems`,
  `search_uniques`, `search_mods`, `price_of`, `plan_craft`, `validate_stage`.
- Der Planer ruft die CLI des Nutzers auf, etwa:
  `claude -p --output-format stream-json --mcp-config <exileforge-mcp.json> --allowedTools "mcp__exileforge__*"`
  mit einem Aufgaben-Prompt und dem JSON Schema der erwarteten Antwort.
  Der Stream wird in der UI als Fortschritt gezeigt.
- Die KI kommt nur über diese Werkzeuge an Spieldaten und Zahlen, damit sie
  keine Gems oder Mods erfindet. Ihre Antwort ist strukturiertes JSON; der
  Main-Prozess validiert es gegen das Schema und rechnet jede Stufe selbst noch
  einmal durch PoB, bevor etwas gespeichert wird.
- Erklärtexte der KI dürfen keine eigenen Zahlen enthalten, nur Platzhalter
  (`{{stage.dps}}`), die beim Anzeigen aus PoB-Ergebnissen gefüllt werden.
- **Zwei Phasen:**
  1. **Varianten planen** aus Skill-Idee + Vorlieben (3–5 Varianten, jede sofort
     in PoB gerechnet, Vergleich nur mit PoB-Zahlen).
  2. **Guide ausarbeiten** für die gewählte Variante: Stufen von Akt 1 bis
     Endgame, je Stufe Tree, Gems, Items, Crafting. Fehlgeschlagene Prüfungen
     gehen mit dem PoB-Ergebnis zurück an die KI zur Korrektur.
- **Beim ersten Start** prüft die App, ob `claude` installiert und eingeloggt
  ist, und zeigt sonst eine Anleitung (Installation, `claude` einmal starten
  und selbst einloggen). Die App selbst fasst keinen Login an.
- **Ausweichweg** (für spätere Verteilung): Dieselbe Planer-Schnittstelle kann
  das Claude Agent SDK mit `ANTHROPIC_API_KEY` des Nutzers nutzen. Nicht Teil
  von v1.
- Nebeneffekt: Da die Werkzeuge ein normaler MCP-Server sind, kann Christian
  sie auch direkt in Claude Code oder Claude Desktop nutzen.

### 3.4 Oberfläche – „optisch ansprechend für PoE-Spieler"

- React + Vite + TypeScript, im Electron-Fenster. Im Entwicklungsmodus auch im
  Browser unter `localhost` nutzbar.
- **Look:** dunkler Dark-Fantasy-Stil, eigene Gestaltung:
  - Farben: Stein-Schwarz/Anthrazit als Grund, Bronze/Altgold für Rahmen und
    Akzente, gedämpftes Blutrot für Warnungen. Item-Seltenheiten in den
    vertrauten Konventionsfarben (Normal weiß, Magisch blau, Selten gelb,
    Unique orange), weil Spieler sie sofort lesen.
  - Schrift: Cinzel (frei, OFL) für Überschriften, gut lesbare Sans für Text.
  - Eigene SVG-Ornamente, Rahmen und Icons, keine kopierten Spielgrafiken.
  - Design-Tokens zentral, damit der Look überall gleich ist.
- **Passive Tree:** Canvas/WebGL mit PixiJS aus den Tree-Daten von PoB
  (Positionen, Verbindungen). Pro Stufe: neue Knoten hervorgehoben, Reihenfolge
  der Punkte, Waffenset 1/2, Zoom/Pan, Slider über die Stufen.
  **⚠ Annahme:** Die Knoten-Icons, die PoB mitbringt, dürfen in einer
  privaten Fan-App angezeigt werden (GGG duldet Fan-Tools); sonst eigene
  abstrakte Knotenformen.
- **Items:** Item-Karten im Spielstil (HTML/CSS), mit Mod-Tiers, Priorität,
  Alternativen, Bezugsquelle.
- **Crafting:** Ablauf als Flussdiagramm (React Flow): Schritt → Ergebnis →
  Plan B, mit Kosten je Schritt und Summe.
- **Kennzahlen:** Verlauf über die Stufen (DPS, EHP, Leben), jede Zahl mit
  Kennzeichnung „PoB x.y.z".

### 3.5 Daten über das Spiel

| Daten | Quelle | Bemerkung |
| --- | --- | --- |
| Tree, Gems, Basen, Mods, Uniques | Datendateien aus PoB-PoE2 | Gleiche Version wie der Rechenkern |
| Zuordnung PoB-Knoten-ID → GGG-PassiveSkills-ID, Gem-Name → `Metadata/Items/Gems/…` | Aus Spieldaten erzeugt, nach jedem Patch neu | Nötig für `.build`. **⚠ Annahme:** PoB liefert die String-IDs mit; sonst eigener Extraktor (Vorbild: Konverter `poe2-build-forge`) |
| Mod-Gewichte für Crafting | PoB-Mod-Daten, ggf. extrahierte Spieldaten | **⚠ Annahme:** reichen für Wahrscheinlichkeiten |
| Marktpreise | poe.ninja (PoE2) | **⚠ Annahme:** stabile Schnittstelle, Bedingungen prüfen |

### 3.6 Export

- **`.build`-Datei** (PoE2 ab 0.5, offiziell dokumentiert in den GGG Developer
  Docs als „Version 1 (Experimental)"): JSON mit `name`, `ascendancy`,
  `passives[]` (String-IDs, `weapon_set`), `skills[]` mit `support_skills[]`
  (BaseItemTypes-Pfade), `inventory_slots[]` (Slot, Unique-Name, Hinweistext),
  jeweils mit `level_interval` und `additional_text`.
  - Keine Item-Werte, keine Kapitel. Die Stufen des Guides bilden wir über
    `level_interval` ab; Items als Unique-Name oder Hinweistext.
  - Ablage: `Dokumente/My Games/Path of Exile 2/BuildPlanner/`. Die App kann die
    Datei direkt dort hineinschreiben.
  - Kein Versionsfeld in der Datei: wir merken uns selbst, für welche
    Spielversion sie erzeugt wurde.
  - **⚠ Annahme:** `level_interval` meint das Charakterlevel. Im Spiel testen.
- **PoB-Code** je Stufe, damit Spieler alles in PoB nachprüfen können.

### 3.7 Patch-Neuprüfung

- Die App prüft beim Start und einmal täglich im Hintergrund auf:
  1. neue Releases von PathOfBuilding-PoE2 (GitHub Releases),
  2. eine neue Spielversion (aus den PoB-Daten bzw. Patch-Notes).
- Bei neuer PoB-Version: neue Version neben der alten laden, alle Builds
  stufenweise neu rechnen, mit den alten Ergebnissen vergleichen (Schwellen
  z. B. ±5 % DPS/EHP), ungültige Teile erkennen (entfernte Gems, geänderte
  Knoten-IDs), Zuordnungstabellen für `.build` neu erzeugen.
- Ergebnis je Guide: „geprüft für Version X" oder „Änderungen nötig" mit
  Bericht. Auf Knopfdruck schlägt die KI eine Korrektur vor.
- Alte Ergebnisse bleiben (Versionierung), damit sichtbar ist, was der Patch
  geändert hat.
- **⚠ Annahme:** PoB-Updates werden von der App selbst heruntergeladen statt mit
  einem App-Update ausgeliefert. Erfordert, dass die `bridge.lua` mit neuen
  PoB-Versionen kompatibel bleibt.

## 4. Repo-Struktur (geplant)

```
ExileForge/
├─ apps/desktop/             Electron-Main, IPC, Prozessverwaltung
├─ apps/ui/                  React-Oberfläche (Design-Tokens, Tree, Items …)
├─ packages/core/            Datenmodell, Prüfregeln, Crafting, Export
├─ packages/schema/          JSON Schema = Quelle der Wahrheit → TS-Typen
├─ packages/mcp-server/      ExileForge-Werkzeuge als MCP-Server
├─ services/pob-worker/      bridge.lua, PoB-PoE2 als Submodul
├─ examples/                 Beispiel-Builds (JSON)
└─ docs/                     Architektur, Datenmodell, Entscheidungen
```

Werkzeuge: pnpm-Workspaces, Vitest, ESLint/Prettier, electron-builder.

## 5. Reihenfolge der Umsetzung (Vorschlag)

1. **PoB headless Proof of Concept:** PoB-PoE2 starten, einen PoB-Code laden,
   DPS/Leben als JSON ausgeben.
2. **Claude-Proof of Concept:** `claude -p` mit Mini-MCP-Server (ein Werkzeug
   `calc_stage`) aufrufen, strukturierte Antwort zurückbekommen.
3. JSON Schema + Übersetzung Build-Stufe ⇄ PoB-XML.
4. `.build`-Export und Test im Spiel.
5. App-Gerüst mit Design-System, Variantenvergleich, Tree-Ansicht.
6. Guide je Stufe, Items, Crafting mit Kosten.
7. Patch-Neuprüfung.

## 6. Offene Fragen

- Läuft PoB-PoE2 headless stabil, und wie schnell ist ein Rechenlauf?
- Wie viel Abo-Kontingent verbraucht ein kompletter Guide?
- Bleibt ExileForge ein privates Werkzeug, oder soll es verteilt werden?
  (Entscheidet, ob der API-Key-Weg nötig wird.)
- Woher kommen verlässliche Mod-Gewichte für Crafting-Wahrscheinlichkeiten?
- Preisquelle und deren Nutzungsbedingungen.
- Dürfen Tree-Icons aus PoB angezeigt werden?
- Lizenz: PoB steht unter MIT (**⚠ Annahme**, prüfen); welche Lizenz bekommt
  ExileForge?

## Quellen

- Anthropic, Legal and compliance (Claude Code): https://code.claude.com/docs/en/legal-and-compliance
- Anthropic, Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Anthropic Support, Agent SDK mit Claude-Abo: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- GGG Developer Docs, Build Planner: https://www.pathofexile.com/developer/docs/game
- PathOfBuilding-PoE2: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2
- poe.ninja, Build Planner Export: https://poe.ninja/posts/poe2-build-planner-prototype
