# ExileForge – Architektur (Entwurf v0.2)

Stand: 2026-11-24. Entwurf, noch nichts davon ist gebaut.
Annahmen und ungeprüfte Punkte sind mit **⚠ Annahme** markiert.

## 0. Harte Vorgaben

1. **Web- oder Desktopanwendung.**
2. **Die KI läuft über ein reguläres Claude-Abo** (Pro/Max), nicht über
   API-Abrechnung.
3. **Leicht zugänglich für Christians Freunde**: einfach installieren, einfach
   aktualisieren, jeder mit seinem eigenen Claude-Abo.
4. **Optisch ansprechend für PoE-Spieler** (Dark-Fantasy-Look, ohne
   Spielgrafiken zu kopieren, wo das nicht nötig ist).
5. **Jede Zahl stammt aus Path of Building**, nicht aus der KI.
6. Export als **`.build`-Datei** für den Build Planner im Spiel.
7. **Neuprüfung nach jedem Patch.**

## 1. Entscheidung in einem Satz

ExileForge besteht aus **zwei Teilen, die jeder Freund mit einem Klick
installiert**: einer **Desktop-App** (Electron + React + TypeScript) zum
Ansehen, Vergleichen und Exportieren der Builds, und einer
**ExileForge-Erweiterung für Claude** (MCP-Server als Claude-Desktop-Erweiterung
`.mcpb`, zusätzlich als Claude-Code-Plugin). Geplant wird im Chat von Claude
Desktop oder Claude Code, also in Anthropics eigener App mit dem eigenen Abo
des Freundes. Claude ruft dabei die ExileForge-Werkzeuge auf, die mit
**Path of Building PoE2** rechnen und die Ergebnisse in die App schreiben.

## 2. Claude-Abo und Weitergabe an Freunde

### Was Anthropic erlaubt (Stand der Recherche, Quellen unten)

- Ein Endnutzer darf sich mit seinem eigenen Abo in Anthropics eigene Apps
  einloggen (Claude Desktop, unveränderte Claude-Code-CLI) und dort
  **lokale MCP-Server bzw. Erweiterungen** von Dritten nutzen. Dafür gibt es
  sogar ein Ein-Klick-Format (`.mcpb`, Claude Desktop Extensions).
- **Nicht erlaubt** ohne Genehmigung von Anthropic: Drittanbieter-Apps, die
  einen claude.ai-Login anbieten, Anfragen über die Abo-Zugangsdaten ihrer
  Nutzer leiten, Abo-Tokens sammeln/speichern/durchreichen oder die
  Abo-Limits für ihr eigenes Produkt nutzen („offer claude.ai login or rate
  limits for their products, including agents built on the Claude Agent SDK").

### Was das für ExileForge heißt

| Ansatz | Für Freunde erlaubt? | Entscheidung |
| --- | --- | --- |
| Gehostete Web-App, Server ruft Claude für alle auf | Nur mit API-Key, also kein Abo | ✗ |
| App startet heimlich die `claude`-CLI des Freundes (`claude -p`) | Fällt sehr wahrscheinlich unter „Abo-Limits für das eigene Produkt nutzen" | ✗ (nur noch als private Option für Christian denkbar, nicht Teil des Produkts) |
| App mit eingebautem Claude-Login (Agent SDK + Abo) | Ausdrücklich verboten | ✗ |
| **Freund plant selbst im Claude-Chat, ExileForge liefert Werkzeuge per MCP** | **Ja, das ist die vorgesehene Nutzung von MCP-Erweiterungen** | **✓** |
| Freund trägt eigenen API-Key ein | Erlaubt, kostet aber nach Verbrauch | Optionaler Zusatz später |

**⚠ Annahme:** Unsere Lesart der Regeln. Sie ist für den MCP-Weg eindeutig,
weil der Freund selbst in Anthropics App arbeitet und ExileForge nie mit Claude
spricht. Wer völlige Gewissheit will, fragt Anthropic per Support.

Folgen für das Design:

- **Die ExileForge-App ruft nie selbst Claude auf** und fasst keine
  Claude-Zugangsdaten an.
- Die KI-Schritte (Varianten planen, Guide ausarbeiten, nach Patch korrigieren)
  passieren im Chat. Ein mitgelieferter **Skill/Prompt** sorgt dafür, dass
  Claude dabei dem festen ExileForge-Ablauf folgt.
- Alles, was **keine KI braucht** (rechnen, anzeigen, exportieren, Patch-Prüfung
  der Zahlen), kann die App allein, auch ohne offenen Chat.
- Die Abo-Limits des Freundes gelten. Die Werkzeuge rechnen deshalb so viel wie
  möglich selbst (z. B. `node_power`, `optimize_tree_path`), damit Claude wenige,
  große Schritte machen kann.

## 3. Komponenten

```
 Rechner eines Freundes
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  Claude Desktop / Claude Code  (Anthropics App, eigenes Abo)            │
│      │  Chat: "Plane mir einen Build mit Blitzpfeilen …"                │
│      │  MCP (stdio)                                                      │
│      ▼                                                                   │
│  ExileForge-Erweiterung (.mcpb / Plugin)                                 │
│   └─ MCP-Server (Node/TS): calc_stage, node_power, search_gems,          │
│      save_variant, save_stage, plan_craft, price_of, export_build …      │
│           │                         │                                    │
│           ▼                         ▼                                    │
│     pob-worker (LuaJIT)      ExileForge-Daten (SQLite im App-Ordner)     │
│     PathOfBuilding-PoE2             ▲                                    │
│                                     │ liest/schreibt, live aktualisiert  │
│  ExileForge-App (Electron + React) ─┘                                    │
│   Varianten · Guide · Tree · Items · Crafting · Export · Patch-Prüfung   │
│   nutzt denselben pob-worker für Neuberechnungen                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 pob-worker – Path of Building headless

- Basis: [PathOfBuildingCommunity/PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2),
  auf einen **festen Release-Tag** gepinnt.
- PoB bringt `src/HeadlessWrapper.lua` mit, das die Oberfläche durch Stubs
  ersetzt. Darauf setzen wir ein eigenes `bridge.lua`, das JSON-Befehle über
  stdin/stdout annimmt:
  - `load_build(pob_xml)`, `calc()` → Werte aus `build.calcsTab.mainOutput`
  - `calc_with(changes)` → „Was wäre wenn" (Knoten, Gem, Item tauschen)
  - `node_power(stat)` → Nutzen jedes Knotens (wie PoBs Power-Report)
  - `export_code()` → PoB-Importcode (zlib + URL-sicheres Base64 des XML)
- Langlebige Prozesse, weil das Laden der Spieldaten dauert
  (**⚠ Annahme**, messen).
- LuaJIT und PoB werden mitgeliefert; Freunde müssen nichts extra
  installieren.
- **⚠ Annahme:** PoB-PoE2 läuft headless ohne Änderungen am PoB-Code. Größtes
  technisches Risiko, daher erster Proof of Concept. Vorbild: `pob-mcp`.

### 3.2 Kernlogik (TypeScript, gemeinsam für App und MCP-Server)

Eine Bibliothek `packages/core`, die App und MCP-Server beide nutzen:

- Builds, Varianten, Stufen, Revisionen; Prüfregeln je Stufe (Resistenzen
  gecappt, Spirit reicht, Attribute reichen für Gems, Level passt zum Akt).
- Übersetzung Datenmodell ⇄ PoB-XML, Client für den pob-worker.
- Crafting (erwartete Versuche und Kosten), Preise mit Zeitstempel.
- Exporter: `.build`, PoB-Code, später Markdown/PDF.
- Speicher: SQLite (`better-sqlite3`) im App-Datenordner des Nutzers. Ein Build
  ist ein JSON-Dokument mit Revisionen; daneben Tabellen für Rechenergebnisse,
  Preise, Patch-Läufe. App und MCP-Server greifen auf dieselbe Datei zu
  (WAL-Modus), die App merkt Änderungen und aktualisiert die Anzeige live.

### 3.3 ExileForge-Erweiterung für Claude (MCP-Server + Skill)

- MCP-Server mit dem offiziellen TypeScript-MCP-SDK, Transport stdio.
- **Werkzeuge:**
  - Lesen/Suchen: `search_gems`, `search_uniques`, `search_mods`,
    `search_nodes`, `price_of`, `list_builds`, `get_build`
  - Rechnen: `calc_stage`, `compare_variants`, `node_power`,
    `optimize_tree_path`, `validate_stage`, `plan_craft`
  - Speichern: `create_build`, `save_variant`, `save_stage`, `choose_variant`
  - Export: `export_build_file`, `export_pob_code`
  - Ansehen: `open_in_app` (öffnet den Build in der ExileForge-App)
- Die Werkzeuge nehmen strukturiertes JSON nach unserem Schema an, validieren
  es und **rechnen jede gespeicherte Stufe selbst durch PoB**. Claude bekommt
  die PoB-Zahlen zurück, schreibt aber nie selbst Zahlen in den Build.
- Erklärtexte dürfen keine eigenen Zahlen enthalten, nur Platzhalter
  (`{{calc.stats.life}}`), die die App aus PoB-Ergebnissen füllt.
- **Ablauf als Skill/Prompt** (mitgeliefert, in Claude Desktop als
  MCP-Prompt `/exileforge-plan`, in Claude Code als Plugin-Skill):
  1. Skill-Idee und Vorlieben abfragen.
  2. 3–5 Varianten entwerfen, jede per `calc_stage` rechnen, mit
     `save_variant` speichern. Vergleich nur mit PoB-Zahlen.
  3. Nach Wahl des Freundes: Stufen von Akt 1 bis Endgame ausarbeiten, jede mit
     `validate_stage` prüfen und korrigieren, bis alle Prüfungen grün sind.
  4. Craft-Pläne mit Kosten, Export.
- **Verpackung:**
  - **Claude Desktop:** `.mcpb`-Datei (Claude Desktop Extension), Installation
    per Doppelklick. Enthält den MCP-Server; PoB und LuaJIT liegen in der App
    und werden darüber gefunden. **⚠ Annahme:** Alternativ bündelt die `.mcpb`
    alles selbst; entscheiden wir nach dem Proof of Concept anhand der Größe.
  - **Claude Code:** Plugin über einen Plugin-Marketplace im ExileForge-Repo
    (`/plugin install …`), mit MCP-Server und Skill.
  - Die App bietet beim ersten Start einen Knopf „Mit Claude verbinden", der die
    `.mcpb` öffnet bzw. die Plugin-Befehle zeigt.

### 3.4 ExileForge-App

- Electron + React + Vite + TypeScript. Windows zuerst (PoE2 und der Build
  Planner sind PC-only), macOS/Linux später.
- **Ansichten:** Build-Liste, Variantenvergleich, Guide je Stufe, Tree, Items,
  Crafting, Export, Patch-Bericht, Einrichtung (Claude-Verbindung prüfen).
- **Was die App allein kann (ohne Claude):** Builds ansehen, Stufen neu rechnen,
  Items/Gems von Hand ändern und neu rechnen, `.build` direkt in den
  BuildPlanner-Ordner schreiben, PoB-Codes kopieren, Patch-Prüfung.
- **Builds teilen:** Export/Import einer ExileForge-Datei (JSON), damit Freunde
  sich Builds schicken können, ohne neu zu planen. **⚠ Annahme:** Ein
  gemeinsamer Online-Speicher ist für v1 nicht nötig.

### 3.5 Oberfläche – „optisch ansprechend für PoE-Spieler"

- **Look:** dunkler Dark-Fantasy-Stil, eigene Gestaltung:
  - Farben: Stein-Schwarz/Anthrazit als Grund, Bronze/Altgold für Rahmen und
    Akzente, gedämpftes Blutrot für Warnungen. Item-Seltenheiten in den
    vertrauten Konventionsfarben (Normal weiß, Magisch blau, Selten gelb,
    Unique orange), weil Spieler sie sofort lesen.
  - Schrift: Cinzel (frei, OFL) für Überschriften, gut lesbare Sans für Text.
  - Eigene SVG-Ornamente, Rahmen und Icons, keine kopierten Spielgrafiken.
  - Design-Tokens zentral, damit der Look überall gleich ist.
- **Passive Tree:** Canvas/WebGL mit PixiJS aus den Tree-Daten von PoB. Pro
  Stufe: neue Knoten hervorgehoben, Reihenfolge der Punkte, Waffenset 1/2,
  Zoom/Pan, Slider über die Stufen.
  **⚠ Annahme:** Die Knoten-Icons aus PoB dürfen in einer kostenlosen Fan-App
  angezeigt werden (GGG duldet Fan-Tools); sonst eigene abstrakte Knotenformen.
- **Items:** Item-Karten im Spielstil (HTML/CSS) mit Mod-Tiers, Priorität,
  Alternativen, Bezugsquelle.
- **Crafting:** Ablauf als Flussdiagramm (React Flow): Schritt → Ergebnis →
  Plan B, Kosten je Schritt und Summe.
- **Kennzahlen:** Verlauf über die Stufen (DPS, EHP, Leben), jede Zahl mit
  „PoB x.y.z" gekennzeichnet.

### 3.6 Installation und Updates für Freunde

- **Ein Installer** für Windows (`ExileForge-Setup.exe`, electron-builder/NSIS),
  zum Download auf der GitHub-Releases-Seite des Repos.
- **Automatische Updates** der App über `electron-updater` aus GitHub Releases.
- **PoB-Daten-Updates** (neue PoB-Version nach Patch) lädt die App selbst
  nach, ohne neuen Installer.
- **Einrichtung in drei Schritten** (Assistent beim ersten Start):
  1. Claude Desktop installieren und mit dem eigenen Abo einloggen (Link).
  2. „Mit Claude verbinden" → `.mcpb` öffnen → in Claude Desktop bestätigen.
  3. Im Claude-Chat „Plane mir einen Build" schreiben (oder `/exileforge-plan`).
- **⚠ Annahme / Kosten:** Ohne Code-Signing-Zertifikat zeigt Windows beim
  ersten Start eine SmartScreen-Warnung („Weitere Informationen → Trotzdem
  ausführen"). Für einen Freundeskreis vertretbar; ein Zertifikat kostet Geld
  pro Jahr und ist später möglich.
- **Voraussetzung pro Freund:** eigenes Claude-Abo (Pro oder höher, **⚠
  Annahme**: ob Free mit lokalen MCP-Erweiterungen reicht, prüfen wir) und ein
  PC mit Windows.

### 3.7 Daten über das Spiel

| Daten | Quelle | Bemerkung |
| --- | --- | --- |
| Tree, Gems, Basen, Mods, Uniques | Datendateien aus PoB-PoE2 | Gleiche Version wie der Rechenkern |
| Zuordnung PoB-Knoten-ID → GGG-PassiveSkills-ID, Gem-Name → `Metadata/Items/Gems/…` | Aus Spieldaten erzeugt, nach jedem Patch neu | Nötig für `.build`. **⚠ Annahme:** PoB liefert die String-IDs mit; sonst eigener Extraktor (Vorbild: `poe2-build-forge`) |
| Mod-Gewichte für Crafting | PoB-Mod-Daten, ggf. extrahierte Spieldaten | **⚠ Annahme:** reichen für Wahrscheinlichkeiten |
| Marktpreise | poe.ninja (PoE2) | **⚠ Annahme:** stabile Schnittstelle, Bedingungen prüfen |

### 3.8 Export

- **`.build`-Datei** (PoE2 ab 0.5, GGG Developer Docs, „Version 1
  (Experimental)"): JSON mit `name`, `ascendancy`, `passives[]` (String-IDs,
  `weapon_set`), `skills[]` mit `support_skills[]` (BaseItemTypes-Pfade),
  `inventory_slots[]` (Slot, Unique-Name, Hinweistext), jeweils mit
  `level_interval` und `additional_text`.
  - Keine Item-Werte, keine Kapitel. Die Stufen bilden wir über
    `level_interval` ab; Items als Unique-Name oder Hinweistext.
  - Die App schreibt die Datei direkt nach
    `Dokumente/My Games/Path of Exile 2/BuildPlanner/`.
  - Kein Versionsfeld in der Datei: wir merken uns die Spielversion selbst.
  - **⚠ Annahme:** `level_interval` meint das Charakterlevel. Im Spiel testen.
- **PoB-Code** je Stufe, damit jeder alles in PoB nachprüfen kann.

### 3.9 Patch-Neuprüfung

- Die App prüft beim Start und einmal täglich auf neue Releases von
  PathOfBuilding-PoE2 und eine neue Spielversion.
- Bei neuer PoB-Version (ohne Claude, nur PoB): neue Version laden, alle Builds
  stufenweise neu rechnen, mit alten Ergebnissen vergleichen (Schwellen z. B.
  ±5 % DPS/EHP), ungültige Teile erkennen (entfernte Gems, geänderte
  Knoten-IDs), Zuordnungstabellen für `.build` neu erzeugen.
- Ergebnis je Guide: „geprüft für Version X" oder „Änderungen nötig" mit
  Bericht in der App.
- **Korrektur mit KI:** Knopf „In Claude reparieren" kopiert einen fertigen
  Auftrag (bzw. Prompt `/exileforge-fix <build>`); Claude holt sich den Bericht
  über `get_build` und speichert die Korrektur. Der Freund löst das selbst im
  Chat aus.
- Alte Ergebnisse bleiben erhalten, damit sichtbar ist, was der Patch geändert
  hat.

## 4. Repo-Struktur (geplant)

```
ExileForge/
├─ apps/desktop/             Electron-Main, Installer, Auto-Update
├─ apps/ui/                  React-Oberfläche (Design-Tokens, Tree, Items …)
├─ packages/core/            Datenmodell, Prüfregeln, Crafting, Export, SQLite
├─ packages/schema/          JSON Schema = Quelle der Wahrheit → TS-Typen
├─ packages/mcp-server/      ExileForge-Werkzeuge als MCP-Server
├─ packages/claude-extension/ .mcpb-Manifest, Prompts/Skill
├─ .claude-plugin/           Claude-Code-Plugin-Marketplace
├─ services/pob-worker/      bridge.lua, PoB-PoE2 als Submodul
├─ examples/                 Beispiel-Builds (JSON)
└─ docs/                     Architektur, Datenmodell, Entscheidungen
```

Werkzeuge: pnpm-Workspaces, Vitest, ESLint/Prettier, electron-builder,
GitHub Actions für Release-Builds.

## 5. Reihenfolge der Umsetzung (Vorschlag)

1. **PoB headless Proof of Concept:** PoB-PoE2 starten, einen PoB-Code laden,
   DPS/Leben als JSON ausgeben.
2. **MCP Proof of Concept:** Mini-MCP-Server mit `calc_stage` als `.mcpb` in
   Claude Desktop installieren und im Chat einen Build rechnen lassen.
3. JSON Schema + Übersetzung Build-Stufe ⇄ PoB-XML, SQLite-Speicher.
4. `.build`-Export und Test im Spiel.
5. App-Gerüst mit Design-System, Build-Liste, Variantenvergleich, Tree.
6. Planungs-Skill, Guide je Stufe, Items, Crafting mit Kosten.
7. Installer, Auto-Update, Einrichtungsassistent; erster Test mit 1–2 Freunden.
8. Patch-Neuprüfung.

## 6. Offene Fragen

- Läuft PoB-PoE2 headless stabil, und wie schnell ist ein Rechenlauf?
- Wie viel Abo-Kontingent verbraucht ein kompletter Guide im Chat?
- Reicht ein Claude-Free-Konto für lokale Erweiterungen, oder brauchen Freunde
  Pro?
- Nutzen die Freunde eher Claude Desktop oder Claude Code? (Claude Desktop ist
  für Nicht-Entwickler einfacher und daher der Standardweg.)
- Woher kommen verlässliche Mod-Gewichte für Crafting-Wahrscheinlichkeiten?
- Preisquelle und deren Nutzungsbedingungen.
- Dürfen Tree-Icons aus PoB angezeigt werden?
- Code-Signing ja/nein.
- Lizenz: PoB steht unter MIT (**⚠ Annahme**, prüfen); welche Lizenz bekommt
  ExileForge?

## Quellen

- Anthropic, Legal and compliance (Claude Code): https://code.claude.com/docs/en/legal-and-compliance
- Anthropic, Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Anthropic Support, Agent SDK mit Claude-Abo: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- Anthropic, Desktop Extensions (`.mcpb`): https://www.anthropic.com/engineering/desktop-extensions
- Anthropic Support, Lokale MCP-Server in Claude Desktop: https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
- GGG Developer Docs, Build Planner: https://www.pathofexile.com/developer/docs/game
- PathOfBuilding-PoE2: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2
- poe.ninja, Build Planner Export: https://poe.ninja/posts/poe2-build-planner-prototype
