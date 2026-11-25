# Astrolabe

**Aus einer Skill-Idee ein vollständiger, durchgerechneter Build für
Path of Exile 2.**

Du wählst einen Skill und sagst, wie du spielen willst. Astrolabe plant
mehrere Build-Varianten und arbeitet die gewählte zu einem lückenlosen Guide
aus: Leveling von Akt 1 bis Endgame, Passive Tree je Stufe, Gems, Ausrüstung
und Crafting mit Kosten.

> **Status:** Planungsphase. Maßgeblich ist der [Projektplan](docs/projektplan.md)
> (Konzeptversion 1.0). Es gibt noch keinen lauffähigen Produktcode, nur einen
> Machbarkeitsnachweis für Path of Building headless.

## Versprechen

- **Jede Zahl kommt aus Path of Building.** Die KI schlägt vor, PoB rechnet.
  Keine geschätzten DPS- oder Lebenswerte.
- **Läuft mit deinem Claude-Abo.** Du arbeitest im Astrolabe-Frontend; die
  KI-Schritte erledigt Claude in deinem eigenen Claude Desktop (oder Claude Code)
  über die Astrolabe-Erweiterung, Schritt für Schritt und sofort mit PoB geprüft.
  Astrolabe sieht deine Claude-Zugangsdaten nie. Wer lieber einen API-Key nutzt,
  kann das auch, mit Claude oder anderen Modellen.
- **Läuft bei dir lokal.** Eine Windows-App, kein Server, keine Cloud. Freunden
  schickst du einfach den Installer; Guides lassen sich als Datei teilen.
- **Für Spieler gemacht.** Dunkler Dark-Fantasy-Look, Passive Tree mit
  Level-Zeitleiste, Item-Tooltips und Crafting-Abläufe grafisch.
- **Direkt im Spiel nutzbar.** Export als `.build`-Datei für den Build Planner
  von PoE2, plus PoB-Code je Stufe.
- **Bleibt aktuell.** Jeder Patch ist ein neues Daten-Release; gespeicherte
  Guides werden automatisch neu geprüft.

## Wie es funktioniert (kurz)

1. Du installierst Astrolabe (Windows) und verbindest es per Klick mit
   Claude Desktop. In der App wählst du Skill und Vorlieben.
2. Astrolabe analysiert den Skill, Claude entwirft 3–6 Varianten, jede wird in
   **Path of Building PoE2** gerechnet. Du wählst eine.
3. Daraus entsteht ein vollständiger Guide von Akt 1 bis Endgame, der erst
   ausgeliefert wird, wenn er alle Prüfungen besteht.

Projektplan: [docs/projektplan.md](docs/projektplan.md) ·
Architektur: [docs/architecture.md](docs/architecture.md) ·
Abgleich mit dem bisherigen Stand: [docs/plan-abgleich.md](docs/plan-abgleich.md) ·
Entscheidungen: [docs/adr/](docs/adr/) ·
Datenmodell: [docs/data-model.md](docs/data-model.md)

## Proof of Concept: Path of Building headless

Ein Build-Code rein, DPS, Leben und Resistenzen raus, gerechnet von PoB selbst.
Läuft unter Linux/macOS und nativ unter Windows (in GitHub Actions getestet).
Details und Grenzen: [docs/pob-headless.md](docs/pob-headless.md).

```bash
tools/setup_pob.sh                         # einmalig: PoB + passendes LuaJIT nach .pob/
python3 -m pob_bridge stats <build-code>   # oder Link (pobb.in, poe.ninja, …) oder XML-Datei
python3 -m unittest discover tests
```

## Zeitplan

PoE2 1.0 erscheint am 11.12.2026. Bis dahin entsteht das Fundament
(Daten-Pipeline, Katalog, Rechenkern), der Build-Generator folgt, sobald
Path of Building für 1.0 aktualisiert ist.

## Hinweise

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
Astrolabe ist ein Fan-Projekt und steht in keiner Verbindung zu Grinding Gear
Games oder Anthropic. Path of Exile ist eine Marke von Grinding Gear Games.
Path of Building ist ein Community-Projekt
([PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)).
