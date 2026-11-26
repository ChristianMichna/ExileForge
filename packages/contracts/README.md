# @astrolabe/contracts

Einzige maßgebliche Quelle für die Datenformen von Astrolabe (Leitprinzip
„Verträge zuerst", Skill `contract-first`). Zod-Schemas, daraus abgeleitete
TS-Typen (`z.infer`) und generierte JSON-Schema-Dateien unter `schemas/`.
Andere Pakete koppeln nur hierüber; Änderungen laufen als eigener Vertrags-PR.

## Inhalt (v0.3)

| Export                         | Inhalt                                                                                                                                                                                                                                                                                                                    | Konsumenten                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `@astrolabe/contracts/common`  | Katalog-IDs (gebrandet je Art), `DataReleaseId`, `PobVersion`, `CalcProfileId`, `CalcId`, Herkunft `Source`, `sourced()`, `measured()`, `CalcRef`                                                                                                                                                                         | alle                                |
| `@astrolabe/contracts/catalog` | `BaseItem`, `Mod`, `UniqueItem`, `Gem`, `PassiveNode` (mit `position.point` und `arcs`), `PassiveGroup`, `CharacterClass`, `Ascendancy`, `CraftingAction`, `StatTranslation`, `DataRelease`, `CatalogManifest`, `CatalogShard`, `CatalogDiff`                                                                             | data-pipeline, catalog-sdk, ui      |
| `@astrolabe/contracts/calc`    | `CalcResult`, `PatchOp`, `CalcMethods` (JSON-RPC: `meta.version`, `build.*`, `calc.*`), `parseCalcParams`, `parseCalcResult`                                                                                                                                                                                              | calc, calc-client, optimizer        |
| `@astrolabe/contracts/build`   | `BuildRequest` (S0), `BuildState`, `ItemSpec`, `RichText`, Stufen-Ergebnisse `SkillProfile` (S1), `ArchetypeCandidate`/`ArchetypeEvaluation` (S2/S3), `TargetBuild` (S5), `ProgressionPlan` (S6), `GearPlan` (S7), `CraftingPlan` (S8), `Finding` (mit `returnTo` für den gezielten Rücksprung), `ValidationReport` (S10) | agents, optimizer, crafting-sim, ui |
| `@astrolabe/contracts/guide`   | `GuideDocument` mit den 11 Pflichtbausteinen des Plans, `PublishedGuide` (S11, nur mit bestandenem Prüfbericht), `PatchStatus` (F-19: Revalidierung eines Guides gegen ein neues Daten-Release; Urteil folgt aus den Befunden), `GuideTools` (`guide.revalidate`: nur IDs als Eingabe, nie Pfade)                                                                                                                                                                                                           | agents, exporters, ui               |
| `@astrolabe/contracts/forge`   | MCP-Werkzeuge `forge.attach/next/submit/ask_user/status`, `ForgeTask`, `ForgeStep`, `UserIntervention`                                                                                                                                                                                                                    | server, mcp-bridge, llm-gateway     |
| `@astrolabe/contracts/economy` | `PriceBook`, `PriceQuote`, Werkzeug `economy.price` (liefert auch `fetchedAt`, `freshness` fresh/stale und bei stale `refreshError`; Preise als `measured`: `market`, bei Umrechnung `derived`; Items per `PricedItemRef` (Basis oder Unique))                                                                            | economy, server, crafting-sim       |
| `@astrolabe/contracts/craft`   | `CraftSimRequest`/`CraftSimResult`, `CraftStrategy`, `CraftGoal`, Werkzeug `craft.simulate`                                                                                                                                                                                                                               | crafting-sim, server, agents        |
| `@astrolabe/contracts/events`  | `RunEvent` (Live-Status per SSE, `seq` je Lauf)                                                                                                                                                                                                                                                                           | server, web                         |

Fehlende Quelldaten werden nicht erfunden: `BaseItem.dropLevel` und
`Ascendancy.pointUnlocks` sind optional; Mod-Zeilen, deren Werte sich nicht
eindeutig bestimmen lassen, stehen in `unresolved` (Grund `unmatched`,
`ambiguous`, `lossy` oder `hidden`). Support-Kompatibilität bekommt ein
eigenes Ausdrucksschema (UND/ODER über Skill-Typen).

Bekannte Lücken: Der Katalog kennt noch keine Bosse und keine
Atlas-Passives; `bossMechanics` und die Atlas-Strategie sind deshalb vorerst
`RichText` mit optionalem `EntityRef`. Kommen diese Entitäten ins Daten-Release,
wird `EntityKind` per Vertrags-PR erweitert. Der Zahlen-Linter muss neben
`text`-Segmenten auch Titel, Stufen-Labels und `forge.ask_user`-Fragen
prüfen.

Noch offen: IPC Electron-Main ⇄ Renderer, Teilen-Datei `.astrolabe.json`,
`.build`-Export (eigene Vertrags-PRs, sobald die Konsumenten feststehen).

## Zahlen in KI-Ausgaben

Alles, was die KI schreibt, ist `RichText`: Segmente `text`, `calc`
(Verweis auf eine Zahl eines PoB-Ergebnisses) und `entity` (Katalog-ID). Es
gibt kein Zahlen-Segment. Kosten, Chancen und Preise sind `measured()`;
Die erlaubte Herkunft ist je Größe eingeschränkt
(`measuredFrom`): Preise nur `market`/`derived`, Chancen und Versuche nur
`gamedata`/`derived`, Verhältnisse wie „Gewinn pro Kosten" nur `derived`.
Rechenergebnisse von Zuständen sind `CalcOutcome` (`ok` mit `calcId` oder
`failed`). Ob in `text`-Segmenten freie Zahlen stehen, prüft der Zahlen-Linter
in den Gates. Mindestanzahlen (Stufen, Varianten) kommen aus `config/`, das
Schema verlangt nur „nicht leer".

## Regeln im Schema

- **IDs statt Namen.** Katalog-IDs sind die internen Spiel-IDs aus dem
  Daten-Release, je Entitätsart gebrandet (`GemId` ist kein `ModId`).
- **Patch-agnostisch.** Spielklassifikationen (Item-Klasse,
  Mod-Generierungstyp, Gem-Art, Knotenart, Tags, Attribute) sind offene
  `ClassificationId`-Strings aus dem Daten-Release, keine Enums. Welche
  PoB-Stats es gibt, ist ein offenes `StatMap`; welche die UI zeigt, steht in
  `config/`. Crafting-Wirkungen sind deklarative Regeln (`op` + `params`),
  deren Vokabular `packages/crafting-sim` besitzt.
- **Keine Zahl ohne Herkunft.** `Source` ist `pob` (mit PoB-Version,
  Daten-Release, Calc-Profil, Rechen-ID), `gamedata`, `market` oder `derived`
  (Formel-ID, Version, Eingaben, ggf. Seed). Fehlende Werte sind über
  `measured()` ausdrücklich `uncalibrated` oder `failed`, nie `0`.
- **Vorwärtskompatibel lesen.** Katalog-Objekte verwerfen unbekannte Felder,
  damit eine ältere App ein neueres Daten-Release lesen kann. Formatbrüche
  zählen `CATALOG_SCHEMA_VERSION` bzw. `CALC_PROTOCOL_VERSION` hoch.

## Daten-Release-Layout

`manifest.json` (`CatalogManifest`) nennt das `DataRelease` und je
Entitätsart eine Datei (`CatalogShard`) mit SHA-256. Die ID hat die Form
`poe2-<spielversion>+r<revision>`; Spielversion und Revision im Objekt müssen
zur ID passen. `CatalogDiff` beschreibt Änderungen zur Vorversion mit
JSON-Pointer-Pfaden (Grundlage für F-19).

`DataRelease.maxCharacterLevel` und `passivePoints` (Hauptbaum-Punkte je Stufe ab
`fromLevel`, Waffensatz-Punkte je Akt) sind optional und fehlen, wenn die Pipeline
sie nicht lesen konnte, nie als `0`. Jeder Wert nennt seinen Ursprung (`game-data`,
`pob-data`, `pob-code`). Punkte aus Items oder Knoten gehören nicht ins Release.

`DataRelease.itemSlots` listet die Ausrüstungsplätze mit PoBs Slot-Namen (wie in
`EquippedItem.slot`) und den Basis-Klassen (`BaseItem.itemClass`), die PoB je Slot
annimmt. Juwelen-Sockel gehören zum Passivbaum und stehen nicht darin.

`DataRelease.rarities` listet die Seltenheiten in aufsteigender Reihenfolge mit der
höchsten Zahl an Affixen je Generationstyp (`maxAffixes`) für das Crafting. Fehlt
`maxAffixes`, trägt die Seltenheit durch Crafting keine Affixe (normal) oder wird nicht
gecraftet (einzigartig). Die Grenzen gelten je Seltenheit; Abweichungen je Item-Klasse (PoB: seltene Juwelen 4
statt 6) stehen in `maxAffixesByItemClass` und haben Vorrang. Das Feld ist optional und fehlt, wenn die Pipeline es nicht ableiten konnte.

`DataRelease.classifications` nennt, welche Klassifikations-Ids des Release
Schadensarten und Verteidigungsschichten sind (`damageTypes`, `defenceLayers`).
Der Guide prüft seine Angaben dagegen. Das Feld ist optional und fehlt, wenn die
Pipeline es nicht ableiten konnte; Prüfer melden das dann sichtbar, statt zu raten.
Befüllen muss es die Daten-Pipeline aus den Spieldaten oder PoB, nie aus dem
Gedächtnis.

## Calc-RPC

JSON-RPC 2.0, eine Zeile JSON je Nachricht über stdin/stdout des
LuaJIT-Workers. Der Worker meldet beim Start `meta.version` mit
`protocolVersion`; der Supervisor lehnt Abweichungen ab. Build-Zustände sind
unveränderlich: `build.applyPatch` liefert einen neuen Handle. Fehler tragen
`data.kind` (`timeout`, `worker_crashed`, `calc_failed` …), nie einen
Ersatzwert. `calc.evalBatch` meldet Fehler je Kandidat einzeln (`CalcErrorKind`).
Die `calcId` eines Kandidaten (Batch, Node-/Item-Power) dient nur Log und
Cache; sie ist kein Ziel eines `CalcRef`. Zahlen im Guide stammen immer aus
einem vollen `calc.stats`. `meta.version` liefert zusätzlich `dataHash` der
geladenen PoB-Daten für Cache-Schlüssel. Feste Protokollgrenzen:
`MAX_BUILD_PAYLOAD_CHARS` (Build-Payload) und 20 000 Zeichen je Item-Text.

## Befehle

```bash
pnpm --filter @astrolabe/contracts test       # Vertragstests + Schema-Snapshot
pnpm --filter @astrolabe/contracts generate   # schemas/ neu erzeugen (nicht von Hand ändern)
```

Fixtures in `test/fixtures/` sind erfunden (`Fixture/…`) und enthalten kein
Spielwissen.
