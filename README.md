# ExileForge

**Aus einer Skill-Idee ein vollständiger, durchgerechneter Build für
Path of Exile 2.**

Du wählst einen Skill und sagst, wie du spielen willst. ExileForge plant
mehrere Build-Varianten und arbeitet die gewählte zu einem lückenlosen Guide
aus: Leveling von Akt 1 bis Endgame, Passive Tree je Stufe, Gems, Ausrüstung
und Crafting mit Kosten.

> **Status:** Planungsphase. Architektur und Datenmodell (Entwurf v0.2) plus
> ein erster lauffähiger Baustein: Path of Building PoE2 headless (siehe unten).

## Versprechen

- **Jede Zahl kommt aus Path of Building.** Die KI schlägt vor, PoB rechnet.
  Keine geschätzten DPS- oder Lebenswerte.
- **Läuft mit deinem Claude-Abo.** Du planst im Chat von Claude Desktop (oder
  Claude Code) mit deinem eigenen Pro/Max-Abo. ExileForge liefert die
  Werkzeuge dazu als Claude-Erweiterung. Kein API-Key, und ExileForge fasst
  deine Zugangsdaten nie an.
- **Für Freunde gemacht.** Ein Installer, automatische Updates, die
  Claude-Erweiterung per Doppelklick. Builds lassen sich als Datei teilen.
- **Für Spieler gemacht.** Dunkler Dark-Fantasy-Look, Passive Tree, Item-Karten
  und Crafting-Abläufe grafisch.
- **Direkt im Spiel nutzbar.** Export als `.build`-Datei für den Build Planner
  von PoE2, plus PoB-Code je Stufe.
- **Bleibt aktuell.** Nach jedem Patch bzw. PoB-Update werden alle Guides neu
  gerechnet und Abweichungen gemeldet.

## Wie es funktioniert (kurz)

1. Du installierst die **ExileForge-App** (Windows) und verbindest sie mit
   **Claude Desktop** (Doppelklick auf die ExileForge-Erweiterung).
2. Im Claude-Chat sagst du, welchen Skill du spielen willst und wie.
   Claude plant Varianten und den Guide und nutzt dabei die
   ExileForge-Werkzeuge, die mit **Path of Building PoE2** rechnen.
3. Die **App** zeigt Varianten, Stufen, Tree, Items und Crafting, exportiert
   die `.build`-Datei und prüft nach jedem Patch alles neu.

Details: [docs/architecture.md](docs/architecture.md) ·
Datenmodell: [docs/data-model.md](docs/data-model.md) ·
Beispiel: [examples/build.example.json](examples/build.example.json)

## Voraussetzungen (geplant)

- Windows-PC (PoE2 und der Build Planner sind PC-only)
- [Claude Desktop](https://claude.ai/download) mit deinem eigenen Claude-Abo
  (oder Claude Code)
- Path of Exile 2 ab Patch 0.5 für den `.build`-Import

## Proof of Concept: Path of Building headless

Ein Build-Code rein, DPS, Leben und Resistenzen raus, gerechnet von PoB selbst.
Läuft unter Linux/macOS und nativ unter Windows (in GitHub Actions getestet).
Details und Grenzen: [docs/pob-headless.md](docs/pob-headless.md).

```bash
tools/setup_pob.sh                         # einmalig: PoB + passendes LuaJIT nach .pob/
python3 -m pob_bridge stats <build-code>   # oder Link (pobb.in, poe.ninja, …) oder XML-Datei
python3 -m unittest discover tests
```

## Nächste Schritte

1. Proof of Concept: Path of Building PoE2 headless rechnen lassen
2. Proof of Concept: ExileForge-Werkzeug als Erweiterung in Claude Desktop
3. JSON Schema und Übersetzung ins PoB-Format
4. `.build`-Export im Spiel testen
5. App-Gerüst mit Design-System

## Hinweise

ExileForge ist ein Fan-Projekt und steht in keiner Verbindung zu Grinding Gear
Games oder Anthropic. Path of Exile ist eine Marke von Grinding Gear Games.
Path of Building ist ein Community-Projekt
([PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)).
