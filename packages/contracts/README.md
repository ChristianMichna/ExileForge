# @exileforge/contracts

Einzige maßgebliche Quelle für die Datenformen von ExileForge (Leitprinzip
„Verträge zuerst", Skill `contract-first`). Zod-Schemas, daraus abgeleitete
TS-Typen (`z.infer`) und generierte JSON-Schema-Dateien unter `schemas/`.
Andere Pakete koppeln nur hierüber; Änderungen laufen als eigener Vertrags-PR.

## Inhalt (v0.1)

| Export | Inhalt | Konsumenten |
| --- | --- | --- |
| `@exileforge/contracts/common` | Katalog-IDs (gebrandet je Art), `DataReleaseId`, `PobVersion`, `CalcProfileId`, `CalcId`, Herkunft `Source`, `sourced()`, `measured()`, `CalcRef` | alle |
| `@exileforge/contracts/catalog` | `BaseItem`, `Mod`, `UniqueItem`, `Gem`, `PassiveNode`, `CharacterClass`, `Ascendancy`, `CraftingAction`, `StatTranslation`, `DataRelease`, `CatalogManifest`, `CatalogShard`, `CatalogDiff` | data-pipeline, catalog-sdk, ui |
| `@exileforge/contracts/calc` | `CalcResult`, `PatchOp`, `CalcMethods` (JSON-RPC: `meta.version`, `build.*`, `calc.*`), `parseCalcParams`, `parseCalcResult` | calc, calc-client, optimizer |

Noch nicht enthalten (nächster Vertrags-PR): `BuildRequest`, Stufen-Ergebnisse
S1–S8, `GuideDocument`, `forge.*`-MCP-Tools, Live-Events.

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
pnpm --filter @exileforge/contracts test       # Vertragstests + Schema-Snapshot
pnpm --filter @exileforge/contracts generate   # schemas/ neu erzeugen (nicht von Hand ändern)
```

Fixtures in `test/fixtures/` sind erfunden (`Fixture/…`) und enthalten kein
Spielwissen.
