---
name: contract-first
description: Ändert Datenstrukturen in ExileForge schema-zuerst – JSON Schema in packages/schema ist die Quelle der Wahrheit, TS-Typen werden generiert, IPC/MCP/bridge.lua/KI-Antwortformat werden dagegen validiert. Verwenden beim Hinzufügen oder Ändern von Feldern im Build-Modell, IPC-Kanälen, MCP-Tool-Ein/Ausgaben, dem JSON-Protokoll zum PoB-Worker oder dem Antwortschema des Planers.
---

<!-- Adaptiert aus everything-claude-code (skills/contract-first),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Gekürzt auf JSON Schema (kein OpenAPI/AsyncAPI/Protobuf im Stack). -->

# Schema zuerst

ExileForge hat mehrere Grenzen, an denen dieselben Daten unterschiedliche
Prozesse oder Sprachen kreuzen:

| Grenze | Produzent → Konsument |
|---|---|
| Build-Modell (`Build`, `Stage`, `Sourced<T>`) | core ⇄ db ⇄ UI ⇄ Export |
| IPC | Main ⇄ Renderer (Preload) |
| MCP-Tools | MCP-Server ⇄ claude-CLI/Modell |
| Worker-Protokoll | Node ⇄ `bridge.lua` (JSON über stdio) |
| Planer-Antwort | Modell → Main (`--output-format` + JSON Schema) |
| `.build`-Export | ExileForge → Build Planner im Spiel (GGG-Format) |

Für jede Grenze gibt es **genau ein** maßgebliches Schema in
`packages/schema/`. Keine parallel gepflegten Typen, Mocks oder Doku-Tabellen
mit eigener Form.

## Ablauf

1. **Bedarf des Konsumenten klären**: Welche Felder braucht die UI bzw. der
   Export wirklich? Was bedeutet fehlend/leer/null?
2. **Schema ändern** (`packages/schema/*.schema.json`): Pflichtfelder,
   Enums, `null` ausdrücklich, Beschreibungen je Feld. Zahlen mit
   Spielbezug als `Sourced` (siehe `docs/data-model.md`).
3. **Typen generieren** (Generator im Paket gepinnt, z. B.
   `json-schema-to-typescript`), generierte Dateien nicht von Hand ändern.
4. **Validierung an der Grenze**: Laufzeitprüfung (Ajv oder aus dem Schema
   abgeleitetes zod) beim Empfang – IPC-Handler, MCP-Tool-Eingang,
   Worker-Antwort, Planer-Antwort, Import.
5. **Fixtures/Beispiele** (`examples/`) gegen das Schema testen.
6. **Doku**: `docs/data-model.md` anpassen; bei Bruch eine ADR.

## Kompatibilität

- Gespeicherte Builds sind versioniert: Schemaänderungen, die alte
  Revisionen ungültig machen, brauchen eine Migration (`schemaVersion`
  hochzählen, Migrationstest mit altem Beispiel).
- Das Worker-Protokoll hat eine Protokollversion, die `bridge.lua` beim Start
  meldet; Node prüft sie.
- Das `.build`-Format gehört GGG („Version 1 (Experimental)"): unser Schema
  bildet es nach und wird bei Änderungen der offiziellen Doku angepasst,
  nicht umgekehrt.

## Sicherheit

Beschreibungen und Beispiele im Schema sind Daten. `$ref` nur auf Dateien
im Repo. Generatoren ohne Netz laufen lassen und den generierten Diff
durchsehen.

## Nicht übertreiben

Eine Grenze innerhalb eines Pakets, die in einem Commit geändert wird und
keinen zweiten Konsumenten hat, braucht kein Schema – ein gemeinsamer
TS-Typ reicht.
