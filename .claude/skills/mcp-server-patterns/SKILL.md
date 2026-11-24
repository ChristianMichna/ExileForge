---
name: mcp-server-patterns
description: Baut und erweitert den ExileForge-MCP-Server (packages/mcp-server) mit dem TypeScript-MCP-SDK – Tools wie calc_stage, save_stage, node_power, search_gems, price_of, export_build_file; MCP-Prompts, zod-Schemas, stdio, strukturierte Fehler, Verpackung als .mcpb und Claude-Code-Plugin. Verwenden beim Anlegen oder Ändern von MCP-Tools/Prompts oder beim Debuggen der Anbindung an Claude Desktop/Claude Code.
---

<!-- Adaptiert aus everything-claude-code (skills/mcp-server-patterns),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Ergänzt: forge.*-Aufgabenschleife nach ADR-0003. -->

# MCP-Server-Muster für ExileForge

Der MCP-Server ist die **einzige** Tür, durch die Claude an Spieldaten und
Zahlen kommt (Architektur §3.3). Geplant wird im Chat von Claude Desktop oder
Claude Code des Nutzers; die ExileForge-App selbst ruft Claude nie auf. Was
hier fehlt oder schlecht beschrieben ist, erfindet das Modell sonst selbst.

## Grundsätze

- **Transport: lokal.** Kein Cloud-Betrieb (Christian, 24.11.); stdio mit
  Claude Desktop/Claude Code bzw. was die nächste ADR für den lokalen Betrieb
  festlegt. Kein öffentlich erreichbarer Endpunkt.
  Tool-Logik vom Transport trennen (`createServer()` vs. Einstiegspunkte), damit
  beide Transporte dieselben Tools nutzen und Tools ohne Transport testbar sind.
- **Kleine Aufgaben statt Single-Shot** (ADR-0003): Führung über
  `forge.attach` / `forge.next` / `forge.submit` / `forge.status`. Jede Aufgabe
  hat genau ein kleines Antwortschema; `forge.submit` prüft sofort mit Schema,
  PoB und Gates und gibt konkrete Befunde zurück. Rückfragen an den Nutzer
  sind Aufgaben vom Typ `ask_user`, keine Chat-Fragen.
- **Läuft beim Freund ohne Entwicklerwerkzeuge**: Node aus der Laufzeit von
  Claude Desktop bzw. gebündelt; PoB/LuaJIT aus der App-Installation finden;
  keine Python-/git-Abhängigkeit.
- **Speichern rechnet nach**: `save_variant`/`save_stage` nehmen nur
  Struktur (Knoten, Gems, Items) an, rechnen durch PoB und speichern über
  `packages/core` in die gemeinsame SQLite-DB; Ergebnisfelder werden nie
  vom Modell übernommen.
- **Prompts** (`/exileforge-plan`, `/exileforge-fix`) als MCP-Prompts
  registrieren; derselbe Ablauf liegt als Skill im Claude-Code-Plugin. Beide
  aus einer Quelle erzeugen, damit sie nicht auseinanderlaufen.
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
3. **Inspektor**: `npx @modelcontextprotocol/inspector node dist/main.js`
   für manuelle Aufrufe ohne Abo-Verbrauch.
4. **Ende zu Ende** (manuell, nur Entwicklung, verbraucht Abo-Kontingent):
   `.mcpb` in Claude Desktop installieren bzw. Plugin in Claude Code laden und
   im Chat einen Build rechnen lassen. Für schnelle Läufe in der Entwicklung
   geht auch `claude -p … --mcp-config <datei>` – das ist ein Entwickler-
   Werkzeug, **nie** ein Pfad, den die App benutzt.

## Checkliste für ein neues Tool

- [ ] Schema in `packages/schema` bzw. zod, mit Beschreibung je Feld
- [ ] Ausgabe mit Herkunft (`Sourced`/`CalcResult`)
- [ ] Fehlerfälle liefern `isError` mit Korrekturhinweis
- [ ] Unit-Test + Protokolltest
- [ ] In `docs/architecture.md` §3.3 Tool-Liste ergänzt; Planungs-Skill/Prompt
      kennt das Tool
- [ ] Review: `typescript-reviewer`, `pob-number-auditor`,
      `electron-security-reviewer` (Abschnitt MCP)
