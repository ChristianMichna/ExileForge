# @astrolabe/data-pipeline

Daten-Pipeline für den Spieldaten-Katalog (F-01, WS1). Sie baut aus dem
gepinnten Path of Building (PoE2) einen **Roh-Snapshot**, vergleicht zwei
Snapshots und bildet einen Snapshot auf die Katalog-Verträge
(`@astrolabe/contracts/catalog`) ab, geprüft gegen die Schemas. Das
Veröffentlichen als Daten-Release folgt in einem eigenen PR.

## Ablauf

1. `tools/setup_pob.sh` installiert PoB-PoE2 (Release-Tag) und LuaJIT nach `.pob/`.
2. `snapshot` startet `lua/extract.lua` in PoB. Das Skript lädt PoBs eigene
   Datenmodule (kein Lua-Parsing per Regex) und schreibt je Art eine JSON-Datei.
   Welche Module zu welcher Art gehören, steht in
   `config/data-pipeline/pob-sources.json`. Eine neue Datendatei in einem
   PoB-Release ist damit eine Konfigurationsänderung, kein Code.
3. `manifest.json` hält Release-ID (`poe2-<spielversion>+r<n>`), PoB-Version,
   Tree-Version, SHA-256 je Datei und die Hashes von Konfiguration und
   Extraktor.
4. `diff` vergleicht zwei Snapshots je Art: neu, entfernt, geändert mit
   Feldpfaden als JSON-Pointer (Form wie `CatalogDiff` im Vertragspaket).

```bash
tools/setup_pob.sh
pnpm --filter @astrolabe/data-pipeline build
node apps/data-pipeline/dist/cli.js snapshot --game-version 0.5 --revision 1 --out data-snapshots/poe2-0.5+r1
node apps/data-pipeline/dist/cli.js diff data-snapshots/alt data-snapshots/poe2-0.5+r1
```

`data-snapshots/` ist git-ignoriert. In GitHub Actions baut
`.github/workflows/data-snapshot.yml` den Snapshot (bei PRs als Smoke-Test,
per „Run workflow" mit Spielversion und optionalem Vergleich gegen einen
älteren PoB-Tag) und lädt ihn als Artefakt hoch.

## Arten im Roh-Snapshot

| Art                | Quelle in PoB                                                           | ID                                                    |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `itemBases`        | `Data/Bases/*.lua`                                                      | Basis-Name (PoB führt keine Metadata-ID für Basen)    |
| `mods`             | `Data/Mod*.lua`, Feld `domains` = Herkunftsdatei (Dateiname ohne `Mod`) | Mod-ID des Spiels                                     |
| `runes`            | `Data/ModRunes.lua`                                                     | Name                                                  |
| `essences`         | `Data/Essence.lua`                                                      | Metadata-ID                                           |
| `gems`             | `Data/Gems.lua`                                                         | Metadata-ID                                           |
| `skills`           | `Data/Skills/*.lua` (ohne `SkillAssets.lua`)                            | Granted-Effect-ID                                     |
| `statDescriptions` | `Data/StatDescriptions/*.lua` (Auswahl in der Konfig)                   | `<scope>:<index>`, mit `tradeHash` (PoBs `HashStats`) |
| `uniques`          | `main.uniqueDB` (von PoBs Item-Parser gelesen)                          | `Titel, Basis`                                        |
| `passiveTree`      | `TreeData/<version>/tree.lua`                                           | Knoten-ID; `group:<id>`, `class:<name>`, `constants`  |

Regeln des Extraktors:

- Ausgabe ist deterministisch (sortierte Schlüssel, festes Zahlenformat), damit
  Hashes und Diffs stabil sind.
- Funktionen, Zyklen und NaN/Unendlich brechen die Extraktion ab. Einzige
  Ausnahme: `skills` enthält PoBs Rechenfunktionen; dort steht sichtbar
  `"$lua-function"`.
- Dieselbe ID aus zwei Quellen ist nur erlaubt, wenn der Inhalt identisch ist
  (z. B. ein Mod für Flasks und Charms); sonst Fehler.
- `uniques` und `passiveTree` übernehmen eine feste Feldauswahl (siehe
  Loader in `lua/extract.lua`); neue PoB-Felder dort erscheinen erst nach
  Anpassung des Loaders im Snapshot und im Diff. Alle anderen Arten werden
  vollständig übernommen.
- `SkillType`-Werte werden als Namen ausgegeben, nicht als PoB-interne Zahlen.
- Eine leere Art, ein Glob ohne Treffer oder ein Snapshot mit falschem Hash ist
  ein Fehler, nie ein leeres Ergebnis.

## Stat-IDs für Mods

PoB führt Mods nur als Anzeigetext. `src/normalize/stat-matcher.ts` bildet
den Text auf Stat-IDs und Rohwerte zurück, ausschließlich mit PoB-Daten:

1. Jeder Mod nennt in `tradeHashes` PoBs Hash über die Stat-IDs einer
   Beschreibung. Darüber ist die Beschreibung eindeutig, auch wenn zwei
   Beschreibungen gleichen Text haben (z. B. lokal und global).
2. Der Text wird gegen die Vorlagen dieser Beschreibung geprüft; Handler wie
   `negate` oder `milliseconds_to_seconds` werden umgekehrt, Limits geprüft.
3. Wie PoB gilt nur die erste Variante, deren Limits passen.
4. Rundet die Anzeige (z. B. `per_minute_to_per_second_0dp`) so, dass mehrere
   Rohwerte denselben Text ergeben, ist die Zeile `lossy` und bleibt offen.
5. Zeilen ohne Hash laufen über einen Text-Index. Mehrdeutige, verlustbehaftete
   oder nicht passende Zeilen bleiben je Mod in `unresolved` sichtbar, nichts
   wird geraten.

`astrolabe-data stat-coverage <snapshot> [--out unresolved.json]` meldet die
Abdeckung. Stand PoB 0.23.1: 86,5 % der Zeilengruppen, 85,7 % der Mods voll
aufgelöst. Offen: 741 `hidden` (Text ohne Zahl, z. B. reine Effekt-Zeilen; der
Stat-Wert ist darin nicht sichtbar, die Stat-IDs stehen dabei), 435 ohne
passende Beschreibung (vor allem Radius-Jewel-Mods, deren Hash einen
Zusatz-Stat enthält), 138 verlustbehaftet gerundet, 14 mehrdeutig.

## Katalog aus dem Snapshot

```bash
node apps/data-pipeline/dist/cli.js catalog data-snapshots/poe2-0.5+r1 --out data-snapshots/catalog
```

`catalog` normalisiert den Roh-Snapshot (`src/normalize/catalog.ts`), prüft
jede Entität gegen ihr Vertragsschema, eindeutige IDs und alle Referenzen
(`src/normalize/validate.ts`) und schreibt je Art eine `CatalogShard`-Datei
plus `manifest.json` (`CatalogManifest`). Steuerung über
`config/data-pipeline/normalize.json` (Anzeigesprache, Stat-Scopes, Knotenarten,
Mod-Stufen, Eigenschaftsgruppen); nichts davon ist im Code an eine Spielversion
gebunden.

IDs (Entscheidung: nur PoB-Daten, keine dat-/GGPK-Extraktion):

| Art               | ID                                            |
| ----------------- | --------------------------------------------- |
| Mod               | PoB-Mod-ID                                    |
| Basis             | Name der Basis                                |
| Unique            | `Titel, Basis`                                |
| Gem               | Spiel-ID des Gems                             |
| Passive           | numerische Knoten-ID (als Text)               |
| Passiv-Gruppe     | PoB-Gruppen-ID (als Text)                     |
| Klasse / Aufstieg | Name bzw. PoB-interne Aufstiegs-ID            |
| Stat-Text         | Beschreibungs-ID aus PoBs Stat-Beschreibungen |

Tree-Geometrie (wie PoBs `Classes/PassiveTree.lua`): Jede Passive bekommt
`position.point` (Baum-Einheiten, y nach unten) aus Gruppenmitte,
`constants.orbitRadii` und `constants.orbitAnglesByOrbit` (`ProcessNode`).
`arcs` hält die Bögen aus `BuildConnector` mit Mittelpunkt und Radius (immer
der kürzere Bogen): Verbindungen mit Orbit ≠ 0 bei Abstand unter dem
Durchmesser, und Verbindungen mit Orbit 0 auf demselben Orbit derselben
Gruppe (Bogen um die Gruppenmitte). Alles andere zeichnet PoB gerade,
auch Verbindungen mit einem Orbit, den die Konstanten nicht kennen
(PoB-Platzhalterwert); das ist kein Befund. Wie PoB zeichnen Renderer keine
Verbindung in einen Klassenstart oder zwischen verschiedenen Aufstiegsklassen.
Reine Bildknoten (`isOnlyImage`) heißen `decoration` und haben wie in PoB
keine Verbindungen. `passiveGroup` hält Gruppenmitte und Orbit-Radien nur für
die Darstellung; die ID ist PoBs Layout-Index und wird von Builds nie
referenziert. Gespeicherte Werte sind auf 0,001 gerundet (Zwischenwerte nicht).
Fehlen die Konstanten, ist das ein Fehler; kann ein Knoten nicht platziert
werden, eine Warnung mit Grund, und er bleibt ohne `point` (nie `0,0`).

`findings.json` enthält:

- `errors`: fehlender Pflichtwert in PoB (nie durch `0` oder `""` ersetzt),
  Vertragsverstoß, doppelte ID, kaputte Referenz (auch Unique-Varianten). Der
  Lauf bricht ab; es werden keine Katalogdateien und kein Manifest geschrieben.
- `warnings`: Daten, die PoB nicht eindeutig hergibt, sichtbar statt geraten:
  Basis-Implicits ohne genau einen passenden Mod (z. B. „Grants Skill"-Zeilen),
  Baum-Verbindungen zu fehlenden Knoten, Startknoten unbekannter Klassen,
  Unique-Zeilen mit nicht vorhandenen Varianten, Aufstiege ohne Knoten.
- `unresolved`: offene Stat-Zeilen von Passiven mit Grund (der Vertrag hat bei
  `PassiveNode` dafür kein Feld; Mods und Uniques tragen `unresolved` selbst).
- `hiddenStatGroups`: Mods mit Stats, deren Beschreibung keinen Text erzeugt.
- `summary`: Zählung aller offenen Zeilen je Art und Grund und von allem, was
  nicht in den Katalog übernommen wird (Mods ohne Generierungsart, von PoB zur
  Laufzeit interpolierte Gem-Werte, weitere Stat-Sets, Gem-Stufenfelder ohne
  Platz im Vertrag wie Kosten, übersprungene Stat-Text-Varianten).

Gem-Stufen enthalten unter `stats` nur Stat-IDs mit wörtlichen Werten aus dem
ersten Stat-Set von PoB plus dessen konstante Stats.

Stand PoB 0.23.1: 0 Fehler, 479 Warnungen, rund 2,5 s. Offene Stat-Zeilen:

| Art | unmatched | ambiguous | lossy | hidden |
|---|---|---|---|---|
| Mod | 411 | 14 | 138 | 741 |
| Unique (von 4167 Zeilen) | 1476 | 492 | 54 | 335 |
| Passive | 131 | 555 | 25 | 467 |

Bei Uniques fehlen PoB Trade-Hashes; mehrdeutig ist vor allem lokal gegen
global (gleicher Text), nicht passend sind v. a. PoB-eigene Zeilen wie
„Allocates …", „Grants Skill: …" und Radius-Zeilen von Juwelen.

## Rechtliches

PoB ist MIT-lizenziert; die Spieldaten darin sind © Grinding Gear Games. Der
Snapshot enthält nur Daten aus PoB, **keine Grafiken**: Icon- und Bildfelder
bleiben Pfadangaben, Tree-Grafiktabellen (`assets`, `ddsCoords` usw.) werden
verworfen. Ob und wie Icons in den Katalog kommen, wird separat entschieden.

## Tests

`pnpm --filter @astrolabe/data-pipeline test`. Diff, Konfiguration, Job und
Snapshot-Prüfung laufen mit synthetischen Daten. Der Integrationstest gegen
das echte PoB läuft nur, wenn `.pob/` existiert (lokal nach
`tools/setup_pob.sh` und im Workflow `data-snapshot.yml`), sonst wird er als
übersprungen gemeldet.
