# Golden Builds

Feste Sammlung von PoE2-Builds mit Sollwerten. Die Sollwerte hat der
gepinnte headless Path of Building berechnet, nie ein Mensch und nie ein
Modell. Jede Änderung an Bridge, Calc-Service, Exportern oder PoB-Version
rechnet gegen diese Sammlung (Testebene „Calc-Golden" im Projektplan, Skill
`tdd-workflow`).

## Dateien

| Datei | Inhalt |
|---|---|
| `manifest.json` | Liste der Builds: `id`, `source` (Link, Build-Code oder Pfad im Repo), `note` |
| `config.json` | Welche PoB-Werte verglichen werden und mit welcher Toleranz |
| `builds/<id>.xml` | Der Build selbst, einmal geladen und eingefroren (keine Abhängigkeit von Links, die verschwinden) |
| `expected/<id>.json` | Sollwerte: alle Werte, die der Runner liefert, plus PoB-Version, gepinnter PoB-Commit, Aufnahmezeit und, nur zur Information, die Werte, die die PoB-GUI in der Datei gespeichert hatte |

## Ablauf

```bash
python tools/golden_builds.py fetch     # fehlende builds/<id>.xml laden
python tools/golden_builds.py record --missing   # Sollwerte für neue Builds
python tools/golden_builds.py check     # alles gegen die Sollwerte rechnen
```

Voraussetzung: PoB-Bridge (`pob_bridge/`, `tools/setup_pob.sh`, PR #2) und
`tools/dev-setup.sh` bzw. `tools/setup_pob.sh`. Ohne Bridge überspringt die
CI den Vergleich mit einem Hinweis.

`check` meldet je Build:

- ✅ unverändert
- ❌ **Abweichung**: ein verglichener Wert liegt außerhalb der Toleranz. Ein
  fehlender Wert zählt als Abweichung, nie als 0.
- ❌ **Fehler**: PoB konnte den Build nicht laden oder rechnen.
- 🔁 **PoB-Version gewechselt**: aufgezeichnet mit einem anderen PoB-Commit
  als dem gepinnten. Neu aufzeichnen und den Diff der Sollwerte prüfen; das
  ist die geplante Patch-Neuprüfung im Kleinen.
- ⚠️ **nicht aufgezeichnet**: neu im Manifest. Wird gemeldet, lässt den Lauf
  aber nicht scheitern, damit offene PRs nicht rot werden.

## Build hinzufügen

1. Eintrag in `manifest.json` mit stabiler `id` (Kleinbuchstaben, Bindestriche)
   und `source`.
2. Lokal `fetch` und `record --missing`, oder PR öffnen: Die CI lädt und
   rechnet neue Builds und legt sie als Artefakt `golden-recorded` ab. Dateien
   aus dem Artefakt in den PR übernehmen.
3. Im PR die neuen `expected/<id>.json` ansehen (Klasse, Level, Hauptskill,
   `gui.differs`). Werte nie von Hand ändern.

## Nach einem PoB-Update

1. `POB_REF` in `tools/setup_pob.sh` ändern (eigener PR).
2. Workflow *Golden builds* von Hand mit `mode: record` starten oder lokal
   `record` ausführen.
3. Den Diff aller `expected/*.json` im PR prüfen und begründen. Unerwartete
   Änderungen sind entweder ein PoB-Fehler (upstream melden) oder ein Fehler
   bei uns.

## Welche Builds taugen als Golden Build

Nur Builds, die headless **genau** die Werte ergeben, die die PoB-GUI beim
Speichern in die Datei geschrieben hat. `record` lehnt andere ab (Meldung
`REJECTED`). Builds aus älteren Patches oder anderen PoB-Versionen rechnen
heute anders und wären falsche Sollwerte. Ausnahme nur mit
`"acceptGuiDiff": "<Begründung>"` im Manifest.

Der breite Vergleich vieler öffentlicher Builds mit den GUI-Werten läuft in
`real-builds.yml` (PR #2, bei jedem PR und montags). Die Golden Builds doppeln
das nicht: Sie laufen nur, wenn sich etwas ändert, das eine Zahl ändern kann
(Bridge, PoB-Pin, Calc-Pakete, Verträge, Korpus), und prüfen dann, dass sich
unsere Werte nicht unbemerkt verschieben.

## Herkunft der Builds

- `pr2-synthetic-fixture`: synthetischer Testbuild aus den Bridge-Tests
  (PR #2), mit PoB-Release v0.23.1 aufgezeichnet.
- `pobb-ljOBlCON5WGB`: öffentlicher Build von pobb.in (Tree 0.5), der im
  PR-#2-Lauf vom 2026-11-24 exakt den GUI-Werten entsprach. In der CI geladen
  und aufgezeichnet, weil pobb.in aus der Entwicklungs-Sandbox nicht
  erreichbar ist.
- Abgelehnt: `pobb-fFCc0Ca4ROzt` (Tree 0.4). Stimmt bei DPS, Leben und
  Resistenzen, aber Rüstung, Ausweichen und EHP weichen von den GUI-Werten ab
  (PR #2 vergleicht diese Werte nicht).
