---
name: contract-first
description: Leitprinzip „Verträge zuerst" – Schnittstellen und Datenformen in ExileForge werden im Vertragspaket festgelegt, bevor implementiert wird; Vertragsänderungen laufen als eigener Vertrags-PR, Implementierungen arbeiten bis dahin gegen Fakes. Verwenden beim Hinzufügen oder Ändern von Katalog-, Build-, Guide-, CalcRPC-, Pipeline-Stufen-, MCP-Tool-, IPC-, Event- oder Exportformaten.
---

<!-- Adaptiert aus everything-claude-code (skills/contract-first),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Gekürzt auf JSON Schema (kein OpenAPI/AsyncAPI/Protobuf im Stack). -->

# Verträge zuerst

Leitprinzip aus `docs/projektplan.md`: Schemas und Schnittstellen werden
**vor** der Implementierung festgelegt, damit parallele Agenten unabhängig
arbeiten können. Workstreams koppeln nur über das Vertragspaket.

**Wo:** laut Projektplan `packages/contracts` (Zod-Schemas, daraus JSON
Schema, OpenAPI und LLM-Tool-Definitionen generiert); der Architektur-
Entwurf nennt noch `packages/schema` (JSON Schema). Bis eine ADR das
festlegt, nicht selbst entscheiden. Prinzip in beiden Fällen: **eine**
maßgebliche Quelle, alles andere generiert.

**Wer:** WS0 (Architektur) besitzt die Verträge. Andere Agenten ändern sie
nur per eigenem Vertrags-PR, den der Architektur-Verantwortliche freigibt.

## Grenzen

Verträge aus dem Plan: `Catalog` (BaseItem, Mod, UniqueItem, Gem,
PassiveNode, Ascendancy, CraftingAction, StatTranslation, DataRelease),
`CalcRPC` (`build.load`, `calc.stats`, `calc.evalBatch` …), `BuildRequest`,
Stufen-Ergebnisse (`SkillProfile`, `ArchetypeCandidate`, `TargetBuild`,
`ProgressionPlan`, `GearPlan`, `CraftingPlan`), `GuideDocument`, Events.
Dazu je nach Stack-Variante:

| Grenze | Produzent → Konsument |
|---|---|
| Build-Modell (`Build`, `Stage`, `Sourced<T>`) | core ⇄ db ⇄ UI ⇄ Export |
| IPC | Main ⇄ Renderer (Preload) |
| MCP-Tools | MCP-Server ⇄ Claude (Desktop/Code des Nutzers) |
| Worker-Protokoll | Node ⇄ `bridge.lua` (JSON über stdio) |
| Gemeinsame DB | MCP-Server ⇄ App (beide über `packages/core`) |
| Teilen-Datei | ExileForge ⇄ ExileForge eines Freundes (JSON) |
| `.build`-Export | ExileForge → Build Planner im Spiel (GGG-Format) |

Für jede Grenze gibt es **genau ein** maßgebliches Schema im
Vertragspaket. Keine parallel gepflegten Typen, Mocks oder Doku-Tabellen mit
eigener Form.

## Ablauf

1. **Bedarf des Konsumenten klären**: Welche Felder braucht die UI bzw. der
   Export wirklich? Was bedeutet fehlend/leer/null?
2. **Vertrag ändern** (eigener PR): Pflichtfelder, Enums, `null`
   ausdrücklich, Beschreibungen je Feld. Zahlen mit Spielbezug nur als
   Referenz auf Calc-Ergebnisse (`calcRef`/`Sourced`), Entitäten nur als
   Katalog-ID – LLM-Ausgabeverträge haben **keine** Ergebniszahlen.
3. **Generieren** (Generator im Paket gepinnt), generierte Dateien nicht von
   Hand ändern.
4. **Fakes** für den neuen Vertrag bereitstellen (`calc-fake`,
   `llm-replay`, Fixture-Daten), damit abhängige Workstreams sofort
   weiterarbeiten können.
5. **Validierung an der Grenze**: Laufzeitprüfung (Ajv oder aus dem Schema
   abgeleitetes zod) beim Empfang – IPC-Handler, MCP-Tool-Eingang,
   Worker-Antwort, Import einer Teilen-Datei.
6. **Vertragstests**: Fixtures/Beispiele gegen das Schema, Schema-Snapshot,
   generierte Clients kompilieren.
7. **Doku**: `docs/data-model.md` anpassen; bei Bruch eine ADR.

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
