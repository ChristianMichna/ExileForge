# @exileforge/data-pipeline

Daten-Pipeline für den Spieldaten-Katalog (F-01, WS1). Dieser erste Teil baut
aus dem gepinnten Path of Building (PoE2) einen **Roh-Snapshot** und vergleicht
zwei Snapshots miteinander. Die Abbildung auf die Katalog-Verträge
(`@exileforge/contracts/catalog`), die Validierung und das Veröffentlichen als
Daten-Release folgen in eigenen PRs.

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
pnpm --filter @exileforge/data-pipeline build
node apps/data-pipeline/dist/cli.js snapshot --game-version 0.5 --revision 1 --out data-snapshots/poe2-0.5+r1
node apps/data-pipeline/dist/cli.js diff data-snapshots/alt data-snapshots/poe2-0.5+r1
```

`data-snapshots/` ist git-ignoriert. In GitHub Actions baut
`.github/workflows/data-snapshot.yml` den Snapshot (bei PRs als Smoke-Test,
per „Run workflow" mit Spielversion und optionalem Vergleich gegen einen
älteren PoB-Tag) und lädt ihn als Artefakt hoch.

## Arten im Roh-Snapshot

| Art | Quelle in PoB | ID |
| --- | --- | --- |
| `itemBases` | `Data/Bases/*.lua` | Basis-Name (PoB führt keine Metadata-ID für Basen) |
| `mods` | `Data/Mod*.lua`, Feld `domains` = Herkunftsdatei (Dateiname ohne `Mod`) | Mod-ID des Spiels |
| `runes` | `Data/ModRunes.lua` | Name |
| `essences` | `Data/Essence.lua` | Metadata-ID |
| `gems` | `Data/Gems.lua` | Metadata-ID |
| `skills` | `Data/Skills/*.lua` (ohne `SkillAssets.lua`) | Granted-Effect-ID |
| `statDescriptions` | `Data/StatDescriptions/*.lua` (Auswahl in der Konfig) | `<scope>:<index>`, mit `tradeHash` (PoBs `HashStats`) |
| `uniques` | `main.uniqueDB` (von PoBs Item-Parser gelesen) | `Titel, Basis` |
| `passiveTree` | `TreeData/<version>/tree.lua` | Knoten-ID; `group:<id>`, `class:<name>`, `constants` |

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

`exileforge-data stat-coverage <snapshot> [--out unresolved.json]` meldet die
Abdeckung. Stand PoB 0.23.1: 94,0 % der Zeilengruppen, 93,7 % der Mods voll
aufgelöst. Offen: 435 ohne passende Beschreibung (vor allem Radius-Jewel-Mods,
deren Hash einen Zusatz-Stat enthält), 138 verlustbehaftet gerundet,
14 mehrdeutig.

## Rechtliches

PoB ist MIT-lizenziert; die Spieldaten darin sind © Grinding Gear Games. Der
Snapshot enthält nur Daten aus PoB, **keine Grafiken**: Icon- und Bildfelder
bleiben Pfadangaben, Tree-Grafiktabellen (`assets`, `ddsCoords` usw.) werden
verworfen. Ob und wie Icons in den Katalog kommen, wird separat entschieden.

## Tests

`pnpm --filter @exileforge/data-pipeline test`. Diff, Konfiguration, Job und
Snapshot-Prüfung laufen mit synthetischen Daten. Der Integrationstest gegen
das echte PoB läuft nur, wenn `.pob/` existiert (lokal nach
`tools/setup_pob.sh` und im Workflow `data-snapshot.yml`), sonst wird er als
übersprungen gemeldet.
