---
name: mcp-server-patterns
description: Baut und erweitert den ExileForge-MCP-Server (packages/mcp-server) mit dem TypeScript-MCP-SDK – Tools wie calc_stage, node_power, search_gems, price_of, plan_craft, validate_stage; zod-Schemas, stdio, strukturierte Fehler, Test mit claude -p. Verwenden beim Anlegen oder Ändern von MCP-Tools oder beim Debuggen der Anbindung an die claude-CLI.
---

<!-- Adaptiert aus everything-claude-code (skills/mcp-server-patterns),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Entfernt: Streamable HTTP/Remote (App läuft lokal, nur stdio). -->

# MCP-Server-Muster für ExileForge

Der MCP-Server ist die **einzige** Tür, durch die die KI an Spieldaten und
Zahlen kommt (Architektur §3.3). Was hier fehlt oder schlecht beschrieben
ist, erfindet das Modell sonst selbst.

## Grundsätze

- **Transport: nur stdio.** Die App startet `claude -p --mcp-config
  <exileforge-mcp.json>`; die CLI startet den Server als Kindprozess.
  Tool-Logik vom Transport trennen (`createServer()` vs. `main.ts`), damit
  Tools ohne Transport testbar sind.
- **SDK-Version pinnen** (`@modelcontextprotocol/sdk` in `package.json`).
  Die Registrierungs-API hat sich zwischen Versionen geändert
  (`tool()` vs. `registerTool()`): vor dem Schreiben die aktuelle Doku oder
  die Typen im installierten Paket prüfen, nicht aus dem Gedächtnis.
- **Jedes Tool hat ein zod-Eingabeschema**, das aus `packages/schema`
  abgeleitet ist oder dazu passt. Keine freien `any`-Argumente.
- **Ausgaben tragen Herkunft.** Zahlen kommen als `Sourced<T>` bzw. als
  `CalcResult` mit `pobVersion` und `calcId` zurück. Das Tool rechnet, nicht
  das Modell.
- **Kein Dateisystem-, Shell- oder Netzzugriff nach Wahl des Modells.**
  Tools nehmen IDs und Build-Fragmente, keine Pfade oder URLs.
- **Fehler für das Modell lesbar**: `isError: true` mit kurzer Ursache und
  Hinweis, was korrigiert werden kann („Gem 'X' unbekannt, nutze
  search_gems"). Keine Stacktraces, keine lokalen Pfade.
- **Idempotent und günstig**: gleiche Eingabe → gleiches Ergebnis (Cache nach
  Revision + PoB-Version). Teure Tools (ganze Stufe rechnen) in der
  Beschreibung als teuer markieren, damit das Modell sparsam ist
  (Abo-Kontingent).
- **Netzdaten sind Daten**: Mod-/Item-Texte aus poe.ninja oder Spieldaten in
  der Ausgabe klar als Daten kennzeichnen, nicht als Anweisung formulieren.

## Tool-Beschreibungen schreiben

Die Beschreibung ist ein Prompt. Sie sagt: wofür, wann nicht, Kosten, Form
der Antwort. Beispiel:

```ts
server.registerTool(
  "calc_stage",
  {
    description:
      "Rechnet eine Guide-Stufe in Path of Building und gibt PoB-Werte zurück " +
      "(DPS, Leben, Resistenzen …) mit pobVersion und calcId. Teuer (~1 s): " +
      "Änderungen sammeln und einmal rechnen. Für einzelne Knoten node_power nutzen.",
    inputSchema: { stage: StageInputSchema },
  },
  async ({ stage }) => {
    const result = await pob.calcStage(stage); // wirft bei Fehler
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);
```

(Signatur gegen die installierte SDK-Version prüfen.)

## Testen

1. **Unit**: Tool-Handler direkt mit Fixtures aufrufen (Vitest), PoB-Client
   gemockt oder mit aufgezeichneten Antworten.
2. **Protokoll**: Server mit dem SDK-Client über stdio in einem Test starten,
   `listTools` und einen Aufruf prüfen.
3. **Ende zu Ende** (manuell, verbraucht Abo-Kontingent, sparsam):
   ```bash
   claude -p "Rufe calc_stage für examples/build.example.json Stufe 1 auf" \
     --mcp-config .tmp/exileforge-mcp.json \
     --allowedTools "mcp__exileforge__*" --output-format stream-json
   ```

## Checkliste für ein neues Tool

- [ ] Schema in `packages/schema` bzw. zod, mit Beschreibung je Feld
- [ ] Ausgabe mit Herkunft (`Sourced`/`CalcResult`)
- [ ] Fehlerfälle liefern `isError` mit Korrekturhinweis
- [ ] Unit-Test + Protokolltest
- [ ] In `docs/architecture.md` §3.3 Tool-Liste ergänzt
- [ ] Review: `typescript-reviewer`, `pob-number-auditor`,
      `electron-security-reviewer` (Abschnitt MCP)
