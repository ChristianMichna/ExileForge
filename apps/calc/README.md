# @exileforge/calc

Calc-Service (F-04, WS2): ein Pool dauerhaft laufender LuaJIT-Prozesse mit dem
unveränderten, gepinnten Path of Building (PoE2), gesteuert von einem
Node-Supervisor in TypeScript. Er erfüllt den Calc-RPC-Vertrag aus
`@exileforge/contracts` (`CalcMethods`) und löst zur Laufzeit den
Python-Wrapper `pob_bridge` ab: Nutzer brauchen kein Python.

Jede Zahl kommt aus PoB. Der Supervisor rechnet keine Spielwerte, er
dekodiert nur Build-Codes, verteilt Anfragen und prüft Ein- und Ausgaben gegen
den Vertrag.

## Stand dieses Pakets

| Methode | Stand |
| --- | --- |
| `meta.version` | fertig (PoB-Version, Spielversion laut PoB, Daten-Release, Daten-Hash) |
| `build.load` | fertig (`xml` und `code`) |
| `build.export` | fertig (`xml` und `code`) |
| `build.release` | fertig |
| `calc.stats` | fertig, mit Calc-Profil und optional `mainSkill` |
| `build.applyPatch` | fertig (alle Ops aus `PatchOp`, siehe unten) |
| `calc.evalBatch`, `calc.nodePower`, `calc.itemPower`, `calc.validate` | folgen in eigenen PRs; bis dahin Fehler `unknown_method` |

## Benutzung

```ts
import { startCalcPool } from "@exileforge/calc";

const pool = await startCalcPool({ root: "." }); // config/ und .pob/ unter root
const { handle } = await pool.request("build.load", { format: "code", payload: code });
const result = await pool.request("calc.stats", { handle, profile: "as-saved" });
result.stats.CombinedDPS; // Zahl aus PoB, mit result.calcId, pobVersion, calcProfile
await pool.request("build.release", { handle });
await pool.close();
```

`request()` ist nach `CalcMethods` typisiert und validiert Parameter und
Ergebnis mit den Zod-Schemas des Vertrags. Fehler sind `CalcServiceError` mit
`kind` aus `CalcErrorKind` (`invalid_params`, `unknown_handle`,
`build_load_failed`, `calc_failed`, `timeout`, `worker_crashed`,
`protocol_mismatch`, `unknown_method`).

Kommandozeile (aus dem Repo-Wurzelverzeichnis, nach `pnpm --filter @exileforge/calc build`):

```bash
node apps/calc/dist/cli.js stats tests/fixtures/witch_spark_lvl60.xml
node apps/calc/dist/cli.js stats <build-code> --profile as-saved --json
node apps/calc/dist/cli.js golden            # evals/golden über den Pool
node apps/calc/dist/cli.js bench --workers 2  # Messungen
```

## Aufbau

```
CalcPool (Node)                         PobWorker × N (LuaJIT, cwd = PoB/src)
  request(method, params)                 lua/worker.lua
   ├ Zod-Prüfung (Vertrag)                  ├ HeadlessWrapper.lua (PoB, einmal geladen)
   ├ Build-Code ⇄ XML (zlib)   ──JSON-RPC──▶ ├ build.load / export / release
   ├ Handle-Register (XML je Handle)  stdin  ├ calc.stats (+ Profil, mainSkill)
   ├ Warteschlange, Worker-Wahl      ◀────── └ Antwortzeilen mit @@EXILEFORGE_RPC@@
   └ Timeout, Neustart, Recycling     stdout   (PoB-Logs → stderr)
```

- **Protokoll:** JSON-RPC 2.0, ein JSON-Objekt pro Zeile. Antworten tragen den
  Präfix `@@EXILEFORGE_RPC@@`, weil PoB selbst auf stdout schreiben kann;
  `print()` leitet der Worker auf stderr um. Beim Start fragt der Supervisor
  `meta.version` ab und lehnt eine andere `CALC_PROTOCOL_VERSION` ab.
- **Ein Auftrag pro Worker:** PoB hat genau ein Build-Objekt. Der Supervisor
  schickt einem Worker erst dann die nächste Anfrage, wenn die vorige
  beantwortet ist; weitere Anfragen warten in einer Warteschlange.
- **Handles gelten im ganzen Pool.** Der Supervisor merkt sich das XML je
  Handle und lädt es bei Bedarf in den Worker, der die Anfrage bedient. Er
  bevorzugt einen freien Worker, der den Build schon hat. Nach einem Neustart
  wird der Build automatisch neu geladen. Zustände sind unveränderlich: ein
  Profil oder `mainSkill` wird bei jeder Rechnung auf den gespeicherten Build
  angewandt, nie in ihn hinein.
- **Build-Codes** dekodiert und kodiert der Supervisor (Base64url + zlib), weil
  PoBs Headless-Modus `Inflate/Deflate` nur als leere Platzhalter hat. Grenze:
  `MAX_BUILD_PAYLOAD_CHARS` aus dem Vertrag, auch nach dem Entpacken.
- **Prüfung vor dem Laden:** Der Worker prüft das XML mit PoBs eigenem
  XML-Parser (Wurzel `PathOfBuilding2` mit `<Build>`), weil PoB bei kaputtem
  XML stillschweigend einen leeren Build lädt. PoE1-Builds werden abgelehnt.
  Meldet PoB beim Laden einen Fehler (`launch.promptMsg`), wird daraus
  `build_load_failed`.
- **Timeout:** Antwortet ein Worker nicht innerhalb von `requestTimeoutMs`,
  wird er beendet (PoB hängt dann in einer Rechnung) und neu gestartet; die
  Anfrage endet mit `timeout`.
- **Absturz:** Die laufende Anfrage endet mit `worker_crashed` samt den letzten
  PoB-Ausgabezeilen; der Worker wird neu gestartet (mit Wartezeit). Nach
  `maxStartFailures` Fehlstarts in Folge gibt der Pool den Platz auf; sind alle
  Plätze aufgegeben, scheitern Anfragen sofort statt ewig zu warten. Der Pool
  wiederholt keine Anfrage selbst; das entscheidet der Aufrufer.
- **Recycling:** Nach `recycleAfterRequests` Anfragen wird ein Worker ersetzt.

## Ergebnis von `calc.stats`

- `stats`: alle Zahlen aus PoBs `build.calcsTab.mainOutput` (oberste Ebene),
  Namen 1:1 von PoB. Nicht endliche Werte (∞, NaN) stehen nicht in `stats`,
  sondern werden in `warnings` genannt.
- `warnings`: PoBs eigene Hinweise aus der Seitenleiste (z. B. nicht erfüllte
  Anforderungen, zu viele Punkte).
- `unsupportedMods`: Item-Zeilen, die PoB nicht oder nur teilweise versteht
  (`modLine.extra`, rot in PoB), und Zeilen verteilter Passives, für die PoB
  keine oder nur teilweise Mods hat (dieselbe Regel wie PoBs Tree-Tooltip).
- `mainSkill`: das Label der Hauptgruppe, wie PoB es im Hauptskill-Menü zeigt
  (eigenes Label oder die aktiven Skills der Gruppe). Genau dieses Label nimmt
  `calc.stats` auch als Eingabe; mehrdeutige Labels sind `invalid_params`.
- `calcId`: `calc-` + SHA-256 über PoB-Version, Daten-Release, Daten-Hash,
  Profil (ID und Hash), `inputHash` und den gewählten Hauptskill. Gleiche Rechnung, gleiche
  ID; sie taugt damit als Cache-Schlüssel.
- `inputHash`: SHA-256 des geladenen Build-XML (nach Dekodierung des Codes).
- `dataReleaseId`: wird beim Start übergeben. Ohne veröffentlichtes
  Daten-Release (lokale Entwicklung) meldet der Worker
  `poe2-<Spielversion laut PoB>+r0`; Revision 0 vergibt die Daten-Pipeline nie.
- `meta.version.dataHash`: SHA-256 über alle `.lua`/`.json`-Dateien in PoBs
  `src/Data` und `src/TreeData` (Bilder ausgenommen), beim Pool-Start berechnet.

## `build.applyPatch`

Ein Patch wendet eine Liste von Ops auf eine Kopie des Builds an und liefert
einen **neuen Handle**; der alte Zustand bleibt unverändert. Die Ops nutzen
PoBs eigene Funktionen (bei `setSkill`/`removeSkill` mit denselben Regeln wie
die Skill-Liste: Gruppen aus ausgerüsteten Items sind geschützt, die
Hauptgruppe wandert mit). Die Zahlen eines Patch-Zustands gehören immer zum
gespeicherten XML: der nächste Rechenlauf lädt es frisch (+~0,5 s), statt auf
dem im Speicher veränderten Build zu rechnen. Scheitert eine
Op, scheitert der ganze Patch (`invalid_params` mit `op <n> (<name>)` im
Detail), und es entsteht kein halber Zustand.

| Op | Umsetzung in PoB | ID-Form (aus dem Katalog) |
| --- | --- | --- |
| `setLevel` | Charakterstufe, schaltet die automatische Stufe ab | – |
| `setClass` | `PassiveSpec:SelectClass`; nicht verbundene Passives verwirft PoB, das steht dann in `warnings` | Klassenname (`characterClass.id`) |
| `setAscendancy` | `PassiveSpec:SelectAscendClass` | `internalId` der Ascendancy (`ascendancy.id`) |
| `allocateNodes` | `PassiveSpec:AllocNode` mit PoBs Pfadsuche; optional `weaponSet` (PoBs `allocMode`, nur 1 oder 2). Nicht erreichbar = Fehler; schon vergebene Knoten bleiben unverändert (Warnung bei anderem Set) | Knoten-ID (`passiveNode.id`) |
| `deallocateNodes` | `PassiveSpec:DeallocNode`, inklusive abhängiger Knoten | Knoten-ID |
| `setSkill` | ersetzt oder ergänzt die Skill-Gruppe mit dem Label `groupKey` (mehrdeutiges Label = `invalid_params`, Gruppen ohne Label sind nicht ansprechbar); aktive Gem plus Supports, geprüft gegen PoBs Gem-Daten. `weaponSet` kennt PoB für Gruppen nicht, er wird abgelehnt | Gem-Metadata-ID (`gem.id`) |
| `removeSkill` | entfernt die Gruppe mit dem Label `groupKey` | – |
| `setItem` | liest den Item-Text mit PoBs Item-Parser, prüft den Slot, rüstet aus | PoB-Slotname |
| `removeItem` | leert den Slot | PoB-Slotname |
| `setConfig` | setzt eine Option im Config-Tab des Builds (gleiche Prüfung wie Profile) | PoB-Optionsname |

Der neue Zustand ist PoBs gespeichertes XML nach dem Patch. Die Zahlen im
Speicher, nach Export und Neuladen und auf jedem Worker sind gleich (Test in
`test/patch.pob.test.ts`). Kosten: ca. 270 ms für Patch und Speichern auf
geladenem Build; liegt im Worker gerade ein anderer Zustand, kommt ein
Neuladen dazu. Für viele Kandidaten ist `calc.evalBatch` gedacht.

`build.export` liefert genau das XML, aus dem `inputHash` berechnet wurde.

## Konfiguration

- `config/calc/pool.json`: Größe (`"auto"` = min(`maxWorkers`, CPU-Kerne − 1,
  freier Speicher / 2 / `workerMemoryMb`), mindestens 1), Timeouts, Recycling,
  Neustart-Regeln, LuaJIT-Speicherbereinigung (`luaGc`).
- `config/calc-profiles/<id>.json`: Calc-Profile. Ein Profil setzt Optionen aus
  PoBs Config-Tab, mit PoBs eigenen Optionsnamen (`Modules/ConfigOptions.lua`).
  Der Worker lehnt unbekannte Optionen und Werte ab, die nicht zum Typ der
  Option passen (`check` = boolean, Zahlen, `list` = einer der Listenwerte).
  Leeres `config` = genau die im Build gespeicherte Konfiguration.
  Bisher gibt es nur `as-saved`. Die Profile für Guides (z. B. Mapping,
  Pinnacle) legen fest, gegen welchen Gegner und unter welchen Bedingungen
  ExileForge Zahlen zeigt; das ist eine eigene Entscheidung und kommt mit
  einem eigenen PR.

## Messungen (Phase 0)

PoB v0.23.1, Linux-Container mit 4 Kernen, Build `pobb-ljOBlCON5WGB`
(Stufe 95, 11 Skill-Gruppen), Stand 24.11.2026. Werte für Windows schreibt
der Workflow `calc.yml` in sein Log.

| Messung | Wert |
| --- | --- |
| Kaltstart eines Workers (PoB laden, inkl. Daten-Hash) | ca. 1,4 s |
| `build.load` (Build in PoB laden und rechnen) | 450–650 ms |
| `calc.stats` auf schon geladenem Build | 3–8 ms |
| Wechsel des Profils (mit Überschreibungen) oder des Builds im selben Worker | wie `build.load` |
| Speicher je Worker mit `luaGc` 150/200 | ca. 380–460 MB, stabil über 40 Ladevorgänge |
| Speicher je Worker mit LuaJIT-Standard (pause 200) | wächst auf ca. 900 MB, Laden ca. 400 ms |
| Durchsatz Laden + Rechnen, 2 Worker | ca. 1,8 Builds/s |

Zum Vergleich: der Python-Wrapper brauchte 2,4–3 s pro Build, weil er PoB für
jeden Aufruf neu startete.

Folgerungen: Teuer ist das Laden eines Builds, nicht das Rechnen. Optimierer
(`calc.evalBatch`, `calc.nodePower`) müssen deshalb Änderungen auf den schon
geladenen Build anwenden, statt für jeden Kandidaten neu zu laden; das ist die
Aufgabe der nächsten PRs. `workerMemoryMb` steht auf 500.

## Tests

```bash
pnpm --filter @exileforge/calc test
```

- `test/pool.test.ts`: Supervisor gegen einen Fake-Worker
  (`test/fixtures/fake-worker.mjs`, deterministische Fantasiewerte): Laden,
  Codes, Export, Fehlerarten, Warteschlange über mehrere Worker, Absturz mit
  Neustart, Timeout, Protokollfehler, Recycling, Fehlstart, Versionskonflikt.
  Läuft überall ohne PoB.
- `test/patch.pob.test.ts`: `build.applyPatch` gegen das echte PoB; alle IDs,
  Slots und Item-Texte stammen aus den Golden-Build-Dateien.
- `test/pob.test.ts`: gegen das echte PoB: alle Golden Builds, gleiche Zahlen
  für XML, Code und re-exportiertes XML, Profil ohne Seiteneffekt, `mainSkill`,
  fehlerhafte Builds und Profile, abgeschossener Worker. Ohne `.pob/`
  übersprungen; mit `EXILEFORGE_REQUIRE_POB=1` (CI) ist fehlendes PoB ein
  Fehler.
- CI: `.github/workflows/calc.yml` unter Linux und Windows (nativ, MSVC-
  `luajit.exe` neben PoBs `lua51.dll`), dazu Golden Builds über den Pool und
  ein PoB-Pfad mit Umlauten und Leerzeichen.

## Offen

- Vertrags-PR: Antwort-Marker `@@EXILEFORGE_RPC@@` im Kommentar von
  `calc/rpc.ts` festhalten und das Profil-Dateiformat (`CalcProfileFile`) nach
  `packages/contracts` verschieben.
- Echtes Daten-Release durchreichen, sobald die App Daten-Releases lädt; bis
  dahin meldet der Worker `+r0` (lokal).
- Windows-Benutzerpfade außerhalb der ANSI-Codepage (LuaJIT öffnet Dateien
  über ANSI-APIs): mit dem Installer-Ticket prüfen.

- Weitere RPC-Methoden (siehe oben), Ergebnis-Cache (`calcId` ist der Schlüssel).
- PoB als Submodul `vendor/PathOfBuilding-PoE2` und `luajit.exe` als
  Release-Artefakt für den Installer; bis dahin `.pob/` aus `tools/setup_pob.sh`.
- Pools je PoB-Version (Schattenbetrieb bei PoB-Updates).
- Die Python-Werkzeuge (`tools/golden_builds.py record`, `real-builds.yml`)
  nutzen noch `pob_bridge`; sie laufen nur in CI und beim Entwickeln, nicht beim
  Nutzer.
