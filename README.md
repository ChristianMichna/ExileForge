# ExileForge

Aus einer Skill-Idee für Path of Exile 2 einen vollständigen, durchgerechneten Build machen.
Jede Zahl stammt aus Path of Building, nicht aus Schätzungen.

## Stand

Erster Baustein: **Path of Building (PoE2) headless per Skript**. Ein Build-Code rein, DPS, Leben und
Resistenzen raus. Details, Funktionsweise und Grenzen: [docs/pob-headless.md](docs/pob-headless.md).

```bash
tools/setup_pob.sh                         # einmalig: PoB + passendes LuaJIT nach .pob/
python3 -m pob_bridge stats <build-code>   # oder Link (pobb.in, poe.ninja, …) oder XML-Datei
python3 -m unittest discover tests
```

Voraussetzungen: Python 3.9+, git, make, C-Compiler (Linux/macOS; Windows über WSL).
