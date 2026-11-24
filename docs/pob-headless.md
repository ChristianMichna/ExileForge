# Path of Building (PoE2) headless anbinden

Stand: 2026-11-24, Proof of Concept. Getestet mit Path of Building PoE2 **v0.23.1** unter Linux.

## Was es kann

Ein Build (Build-Code, Link oder XML-Datei) geht rein, Path of Building rechnet, und heraus kommen u. a.
DPS, Leben, Energieschild und Resistenzen als JSON. Die Zahlen kommen ausschließlich von PoB selbst,
der Bridge-Code rechnet nichts nach.

```bash
tools/setup_pob.sh                                  # einmalig, ca. 30 s, ~800 MB in .pob/
python3 -m pob_bridge stats <build-code>            # Kurzübersicht
python3 -m pob_bridge stats tests/fixtures/witch_spark_lvl60.xml --json
python3 -m pob_bridge stats https://pobb.in/XXXX    # Links von pobb.in, poe.ninja, maxroll, poe2db, pastebin
echo "<build-code>" | python3 -m pob_bridge stats -
```

Beispielausgabe:

```
Path of Building 0.23.1  |  Witch / None  |  Level 60
Main skill: Spark

  DPS (Combined)   117.9
  Hit DPS          117.9
  Life             1,124.0
  Energy Shield    294.0
  Fire Res         -20%
  Cold Res         -25%
  Lightning Res    -15%
  Chaos Res        20%
```

Aus Python:

```python
from pob_bridge.pob import PathOfBuilding
result = PathOfBuilding().evaluate("<build-code oder Link oder XML>")
result["stats"]["CombinedDPS"], result["stats"]["Life"], result["stats"]["FireResist"]
```

## Wie es funktioniert

```
Build-Code / Link / XML
      │  pob_bridge/pob.py   (Python: Link laden, Code dekodieren = base64 + zlib, XML prüfen)
      ▼
luajit pob_bridge/lua/runner.lua   (Unterprozess, Arbeitsverzeichnis = PoB/src)
      │  lädt PoBs eigenen HeadlessWrapper.lua (offizieller Headless-Einstieg von PoB)
      │  loadBuildFromXML() → PoB rechnet wie in der GUI
      ▼
build.calcsTab.mainOutput  →  JSON-Zeile mit Marker  →  Python-Dict
```

- **PoB-Quellcode** wird in `.pob/PathOfBuilding-PoE2` an einem festen Commit ausgecheckt (nicht im Repo, git-ignored).
- **LuaJIT**: PoB nutzt neue Syntax (`x += 1`, `a?.b`), die nur sehr aktuelles LuaJIT kann. Distro-Pakete
  (z. B. Ubuntu `luajit`) scheitern daran. Das Skript baut deshalb exakt den LuaJIT-Commit, den PoB selbst
  verwendet (aus PoBs SimpleGraphic-Repo, `vcpkg-ports/ports/luajit`).
- **lua-utf8** ist das einzige native Modul, das PoB headless braucht; es wird mit kompiliert.
- Build-Codes dekodiert Python, weil PoBs Headless-Modus `Inflate/Deflate` nur als leere Platzhalter hat.
- PoB schreibt eigene Logzeilen auf stdout. Das Ergebnis steht deshalb in einer Zeile mit dem Präfix
  `@@EXILEFORGE_RESULT@@`.

## Ausgegebene Werte

`stats` enthält PoBs interne Namen 1:1 (fehlende Werte = `null`):

| Bereich | Felder |
|---|---|
| Schaden | `CombinedDPS`, `TotalDPS` (Hit), `TotalDot`, `FullDPS`, `AverageHit`, `Speed`, `CritChance`, `CritMultiplier`, `HitChance` |
| Pools | `Life`, `LifeUnreserved`, `EnergyShield`, `Mana`, `ManaUnreserved`, `Spirit`, `SpiritUnreserved` |
| Resistenzen | `FireResist`, `ColdResist`, `LightningResist`, `ChaosResist` (wirksam, nach Cap), `…ResistTotal` (ungecappt), `…ResistOverCap` |
| Defensive | `Armour`, `Evasion`, `TotalEHP`, `EffectiveMovementSpeedMod` |

Mehr Werte sind trivial: Namen in `STAT_KEYS` in `pob_bridge/lua/runner.lua` ergänzen. Alles, was PoB in der
Seitenleiste zeigt, steht in `build.calcsTab.mainOutput`.

## Tests

```bash
python3 -m unittest discover tests
```

- Build-Code hin und zurück, ungültige Codes, ungültiges XML.
- Testbuild `tests/fixtures/witch_spark_lvl60.xml` wird durch PoB gerechnet, die erwarteten Zahlen sind
  fest eingetragen. Ändert ein PoB-Update diese Zahlen, schlägt der Test fehl. Genau das ist später die
  Basis für „nach jedem Patch neu prüfen“.

## Grenzen und offene Punkte

1. **Nicht mit echten Spieler-Builds getestet.** Die Sandbox, in der das gebaut wurde, durfte pobb.in &
   Co. nicht erreichen. Der Testbuild ist synthetisch (per PoB-API erzeugt: Witch 60, 3 Items, 12 Passives,
   Spark). Der Download-Code für Links ist geschrieben, aber ungetestet. **Nächster Schritt: 3–5 echte
   Build-Codes durchlaufen lassen und mit der PoB-GUI vergleichen.**
2. **Nur PoE2.** PoE1-Builds werden erkannt und mit Fehlermeldung abgelehnt.
3. **Rechenergebnis = PoB-Konfiguration im Build.** Die Werte gelten für die im Build gespeicherten
   Einstellungen (Config-Tab: Gegner, Buffs, Ladungen, Hauptskill). Eine andere Hauptfertigkeit oder andere
   Config ändert DPS massiv. Für die Guides müssen wir diese Annahmen später bewusst setzen und anzeigen.
4. **Ca. 2,5–3 s pro Aufruf**, fast alles davon PoB-Start (Baum + Item-Datenbank laden). Für viele
   Varianten hintereinander (Leveling-Stufen, Item-Vergleiche) sollte später ein dauerhaft laufender
   PoB-Prozess mehrere Builds nacheinander rechnen. Vermutung: dann deutlich unter 0,5 s pro Build.
5. **Windows nicht getestet.** Das Setup-Skript braucht git, make und einen C-Compiler (Linux/macOS, unter
   Windows über WSL). Für eine Desktop-App unter Windows müsste man LuaJIT mitliefern; ungeprüft.
6. **„missing node …“-Meldungen** beim Start kommen von PoB selbst (Baumdaten), sie beeinflussen die
   Rechnung nach bisherigem Stand nicht. Ungeprüft im Detail.
7. **Keine Sandbox um PoB.** Der Lua-Prozess hat normale Dateirechte. Für eine Web-App mit fremden
   Build-Codes sollte er später in einem Container ohne Netz und mit Zeitlimit laufen (Zeitlimit: 120 s
   ist schon eingebaut).
8. **PoB-Version fest gepinnt** (`POB_REF` in `tools/setup_pob.sh`). Für ein Update: neuen Commit eintragen,
   LuaJIT-Commit mit PoBs SimpleGraphic abgleichen, Setup neu laufen lassen, Tests prüfen.

## Fundstück für später: .build-Export

PoB-PoE2 enthält bereits `src/Modules/BuildExportPoE2.lua`, das Builds als Datei für den Build-Planer im
Spiel exportiert (mit Game-IDs für Gems, Inventar-Slots, Loadouts). Das deckt sich direkt mit dem
ExileForge-Ziel „.build-Datei fürs Spiel“ und sollte sich über denselben Headless-Weg ansprechen lassen.
Noch nicht ausprobiert.

## Passt das in eine Web- oder Desktop-App?

Ja, nach jetzigem Stand: Die Bridge ist eine kleine Python-Bibliothek ohne Abhängigkeiten außer der
Standardbibliothek. Ein Web-Backend (z. B. FastAPI) oder eine Desktop-App kann `PathOfBuilding().evaluate()`
direkt aufrufen. Die Rechnung läuft lokal und braucht keinen API-Schlüssel und kein KI-Kontingent; die
Claude-Subscription betrifft nur die KI-Teile (Varianten planen, Guide schreiben), nicht diese Zahlen.
