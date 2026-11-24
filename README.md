# ExileForge

**Aus einer Skill-Idee ein vollständiger, durchgerechneter Build für
Path of Exile 2.**

Du wählst einen Skill und sagst, wie du spielen willst. ExileForge plant
mehrere Build-Varianten und arbeitet die gewählte zu einem lückenlosen Guide
aus: Leveling von Akt 1 bis Endgame, Passive Tree je Stufe, Gems, Ausrüstung
und Crafting mit Kosten.

> **Status:** Planungsphase. Es gibt noch keinen lauffähigen Code, nur
> Architektur und Datenmodell (Entwurf v0.1).

## Versprechen

- **Jede Zahl kommt aus Path of Building.** Die KI schlägt vor, PoB rechnet.
  Keine geschätzten DPS- oder Lebenswerte.
- **Läuft mit deinem Claude-Abo.** ExileForge nutzt die Claude-Code-CLI, die du
  selbst installierst und mit deinem Pro/Max-Abo einloggst. Kein API-Key, und
  ExileForge fasst deine Zugangsdaten nie an.
- **Für Spieler gemacht.** Dunkler Dark-Fantasy-Look, Passive Tree, Item-Karten
  und Crafting-Abläufe grafisch.
- **Direkt im Spiel nutzbar.** Export als `.build`-Datei für den Build Planner
  von PoE2, plus PoB-Code je Stufe.
- **Bleibt aktuell.** Nach jedem Patch bzw. PoB-Update werden alle Guides neu
  gerechnet und Abweichungen gemeldet.

## Wie es funktioniert (kurz)

ExileForge ist eine Desktop-App (Electron + React + TypeScript), die lokal
läuft:

1. **Path of Building PoE2** läuft unsichtbar im Hintergrund und rechnet.
2. Die **Claude-Code-CLI** plant Varianten und Guide und greift dabei über einen
   ExileForge-**MCP-Server** auf PoB, Spieldaten und Preise zu.
3. Die **Oberfläche** zeigt Varianten, Stufen, Tree, Items und Crafting.

Details: [docs/architecture.md](docs/architecture.md) ·
Datenmodell: [docs/data-model.md](docs/data-model.md) ·
Beispiel: [examples/build.example.json](examples/build.example.json)

## Voraussetzungen (geplant)

- Windows (PoE2 und der Build Planner sind PC-only; macOS/Linux später)
- [Claude Code](https://code.claude.com) installiert und einmal mit deinem
  Claude-Abo eingeloggt
- Path of Exile 2 ab Patch 0.5 für den `.build`-Import

## Nächste Schritte

1. Proof of Concept: Path of Building PoE2 headless rechnen lassen
2. Proof of Concept: `claude -p` mit ExileForge-MCP-Werkzeug
3. JSON Schema und Übersetzung ins PoB-Format
4. `.build`-Export im Spiel testen
5. App-Gerüst mit Design-System

## Hinweise

ExileForge ist ein Fan-Projekt und steht in keiner Verbindung zu Grinding Gear
Games oder Anthropic. Path of Exile ist eine Marke von Grinding Gear Games.
Path of Building ist ein Community-Projekt
([PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)).
