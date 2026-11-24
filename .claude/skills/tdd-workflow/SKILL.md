---
name: tdd-workflow
description: Testgetriebene Entwicklung in ExileForge mit Vitest – erst fehlschlagender Test, dann minimale Umsetzung, dann Aufräumen; inklusive Golden-Tests gegen Path of Building mit aufgezeichneten Ergebnissen. Verwenden bei neuer Kernlogik (Prüfregeln, Build ⇄ PoB-XML, PoB-Code, .build-Export, Crafting-Erwartungswerte, Patch-Vergleich) und bei jedem Bugfix.
---

<!-- Adaptiert aus everything-claude-code (skills/tdd-workflow),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Stark gekürzt; Web-/Jest-/Playwright-Teile entfernt, PoB-Golden-Tests ergänzt. -->

# TDD in ExileForge

## Zyklus

1. **Rot**: Test schreiben, der das gewünschte Verhalten beschreibt. Laufen
   lassen und sehen, dass er **aus dem richtigen Grund** fehlschlägt.
2. **Grün**: kleinste Änderung, die den Test bestehen lässt.
3. **Aufräumen**: Struktur verbessern, Tests bleiben grün.
4. Bei Bugfix: zuerst ein Test, der den Bug nachstellt.

Nur betroffene Tests erneut laufen lassen:
`pnpm --filter <paket> test -- <datei>`; die ganze Suite erst vor dem PR
(Skill `verification-loop`).

## Was getestet wird, und wie

| Bereich | Testart |
|---|---|
| Prüfregeln je Stufe (Resistenzen, Spirit, Attribute, Level/Akt) | Unit, tabellengetrieben (`it.each`) |
| Build ⇄ PoB-XML, PoB-Code (zlib + Base64) | Round-Trip: `decode(encode(x))` = `x`; echte PoB-Codes als Fixture |
| `.build`-Export | Snapshot gegen Schema + feste Erwartung für `examples/build.example.json`; ID-Zuordnungen mit bekannten Knoten/Gems |
| Crafting-Erwartungswerte | Unit mit kleinen, von Hand nachrechenbaren Gewichten; `derived.formula` geprüft |
| Patch-Vergleich | Zwei aufgezeichnete `CalcResult`s, Schwellen ±x % |
| MCP-Tools | Handler direkt + Protokolltest (Skill `mcp-server-patterns`) |
| Speichernde MCP-Tools | Fixture-Eingabe → PoB-Nachrechnung → DB-Inhalt; Ergebnisfelder aus der Eingabe werden ignoriert |
| Planungs-Skill/Prompts | Statisch prüfen (Tools existieren, keine Zahlen im Text); **nie** echte Claude-Aufrufe in der Testsuite |

## Golden-Tests gegen PoB

Ziel: Änderungen an Übersetzung oder Bridge fallen auf, ohne dass Tests
Zahlen erfinden.

- Eingabe: Beispiel-Builds in `examples/` (bzw. `fixtures/pob/`).
- Erwartung: **von PoB erzeugte** Ergebnisse, aufgezeichnet mit
  `pobVersion` im Dateinamen oder Kopf, z. B.
  `fixtures/pob/<build>.<pobVersion>.calc.json`. Niemals von Hand
  geschriebene Erwartungswerte für DPS/Leben.
- Neu aufzeichnen nur bewusst (eigenes Skript, z. B. `pnpm fixtures:record`),
  mit Diff im PR und Begründung (PoB-Update, Bridge-Fix).
- Tests, die LuaJIT brauchen, mit `describe.skipIf(!hasLuaJit)` kennzeichnen
  und im Bericht als übersprungen melden – nicht stillschweigend grün.

## Regeln

- Tests prüfen Verhalten, nicht Implementierungsdetails.
- Keine Tests deaktivieren oder Erwartungen „passend machen", um grün zu
  werden. Fehlschlag verstehen, dann beheben.
- Abdeckung: Kernlogik in `packages/core` und `packages/schema` hoch
  (Richtwert 80 %+); UI nach Bedarf.
- Zufall und Zeit (Preise `fetchedAt`) im Test fixieren.
