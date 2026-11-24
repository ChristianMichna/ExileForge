---
name: mcp-server-patterns
description: Baut und erweitert den MCP-Endpunkt von ExileForge (lokaler Server in der App, 127.0.0.1) und die Claude-Desktop-Erweiterung (.mcpb, stdio-Brücke) mit dem TypeScript-MCP-SDK – forge.attach/next/submit-Aufgabenschleife, Lese- und Rechenwerkzeuge (catalog.*, calc.*, optimize.*, craft.*, economy.price), Zod-Schemas, strukturierte Befunde. Verwenden beim Anlegen oder Ändern von MCP-Tools/Prompts oder beim Debuggen der Anbindung an Claude Desktop/Claude Code.
---

<!-- Adaptiert aus everything-claude-code (skills/mcp-server-patterns),
     MIT, © 2026 Affaan Mustafa. Siehe .claude/THIRD_PARTY_NOTICES.md.
     Ergänzt: lokaler Betrieb nach ADR-0004, forge.*-Aufgabenschleife nach ADR-0003. -->

# MCP-Muster für ExileForge

Der MCP-Endpunkt ist die **einzige** Tür, durch die Claude an Spieldaten und
Zahlen kommt. Geplant wird im Claude Desktop oder Claude Code des Nutzers mit
dessen eigenem Abo; die App ruft Claude mit dem Abo nie selbst auf. Was hier
fehlt oder schlecht beschrieben ist, erfindet das Modell sonst selbst.

## Aufbau (ADR-0004)

```
Claude Desktop ── stdio ── apps/mcp-bridge (.mcpb) ── HTTP ──┐
Claude Code ───────── HTTP (claude mcp add --transport http) ─┤
                                                              ▼
                     ExileForge-App: apps/server auf 127.0.0.1/mcp
                     (Pipeline-Zustandsmaschine, Calc, Katalog, SQLite)
```

- **Tool-Logik lebt im App-Server** (`apps/server`), getrennt vom Transport.
  Die `.mcpb`-Erweiterung ist nur eine dünne stdio↔HTTP-Brücke ohne eigene
  Logik und ohne eigene Daten.
- **Nur `127.0.0.1`**, nie `0.0.0.0`; kein öffentlicher Endpunkt, kein Konto,
  kein OAuth. Der Sitzungscode wählt nur den Lauf.
- Läuft die App nicht, antwortet die Brücke mit einem klaren Fehler
  („ExileForge-App starten"), statt zu hängen.
- **Beim Freund ohne Entwicklerwerkzeuge**: Brücke als `.mcpb` per Doppelklick;
  kein Python, kein git, keine globale Node-Installation voraussetzen.

## Aufgabenschleife statt Single-Shot (ADR-0003)

- Führung über `forge.attach(code)`, `forge.next(runId)`,
  `forge.submit(task, payload)`, `forge.status`.
- Jede Aufgabe hat **genau ein kleines Antwortschema** aus dem Vertragspaket.
  Was deterministisch geht, rechnet der Server ohne Claude.
- `forge.submit` prüft sofort: Schema → Katalog-IDs (G1) → PoB → Gates. Bei
  Fehlern kommt ein **konkreter Befund** zurück, dieselbe Aufgabe bleibt offen;
  maximal drei Korrekturen, dann Eskalation an den Nutzer.
- Rückfragen sind Aufgaben vom Typ `ask_user`; das Frontend zeigt sie als Karte.
  Eingriffe aus dem Frontend kommen über die Feedback-Warteschlange in die
  nächste Aufgabe.
- Werkzeugbeschreibungen und der MCP-Prompt (`/exileforge`) sagen Claude, die
  Schleife bis `done` fortzusetzen.

## Grundsätze für jedes Tool

- **SDK-Version pinnen** (`@modelcontextprotocol/sdk`). Die Registrierungs-API
  hat sich zwischen Versionen geändert: Signaturen in den installierten Typen
  prüfen, nicht aus dem Gedächtnis.
- **Eingabeschema aus `packages/contracts`** (Zod). Keine freien
  `any`-Argumente.
- **Keine Ergebniszahlen als Eingabe.** Abgaben enthalten Struktur
  (Knoten-IDs, Gem-IDs, Item-Profile) und Begründungen; Zahlen rechnet der
  Server und gibt sie mit `calcRef`, PoB-Version und Calc-Profil zurück.
- **Entitäten nur als Katalog-ID**; unbekannte IDs → Befund mit Hinweis
  („unbekannt, nutze catalog.search").
- **Kein Dateisystem-, Shell- oder Netzzugriff nach Wahl des Modells.**
- **Fehler für das Modell lesbar**: `isError: true`, kurze Ursache,
  Korrekturhinweis; keine Stacktraces, keine lokalen Pfade.
- **Idempotent und günstig**: Cache nach (pobVersion, Build-Zustand,
  Calc-Profil). Teure Tools in der Beschreibung als teuer markieren
  (Abo-Kontingent des Nutzers).
- **Netzdaten sind Daten**: Mod-/Item-Texte als Daten kennzeichnen, nicht als
  Anweisung formulieren.

## Testen

1. **Unit**: Tool-Handler direkt mit Fixtures und `calc-fake`.
2. **Protokoll**: Server in einem Test starten, mit dem SDK-Client `listTools`
   und einen Aufruf prüfen; Brücke separat gegen einen Fake-Server.
3. **Schleife**: `forge.*` mit `llm-replay`-Abgaben durchspielen, inklusive
   Befund → Korrektur.
4. **Inspektor**: `npx @modelcontextprotocol/inspector` für manuelle Aufrufe
   ohne Abo-Verbrauch.
5. **Ende zu Ende** (manuell, verbraucht Abo-Kontingent): `.mcpb` in Claude
   Desktop installieren und eine Sitzung durchspielen.

## Checkliste für ein neues Tool

- [ ] Schema in `packages/contracts`, Beschreibung je Feld
- [ ] Ausgabe mit Herkunft, Entitäten als IDs
- [ ] Fehlerfälle liefern `isError` mit Korrekturhinweis
- [ ] Unit- und Protokolltest
- [ ] Tool-Liste in `docs/architecture.md` ergänzt; Prompt kennt das Tool
- [ ] Review: `typescript-reviewer`, `pob-number-auditor`,
      `catalog-integrity-auditor`, `electron-security-reviewer` (MCP)
